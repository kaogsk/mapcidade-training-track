/**
 * Store on node:sqlite (no native module, no server). Mirrors the production PostgreSQL schema:
 * the full state as a JSON document, plus normalised tables for what the dashboard aggregates
 * (lesson completion dates, every answer, access history).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProgressState } from "../shared/engine.js";
import { type Answer, userKey } from "./progress.js";
import type { AccessEvent, AccessRow, AnalystRow, Completion, Manager, QuestionStat, Store } from "./store.js";

const SCHEMA = `
pragma foreign_keys = on;
create table if not exists analyst (
  username   text primary key,
  name       text not null,
  first_seen text not null,
  last_seen  text not null
);
create table if not exists progress (
  username   text primary key references analyst on delete cascade,
  state      text not null,
  updated_at text not null
);
create table if not exists lesson_completed (
  username     text not null references analyst on delete cascade,
  lesson_id    text not null,
  completed_at text not null,
  primary key (username, lesson_id)
);
create table if not exists answer (
  id         integer primary key autoincrement,
  username   text not null references analyst on delete cascade,
  lesson_id  text not null,
  question   integer not null,
  option     integer not null,
  correct    integer not null,
  first_try  integer not null,
  created_at text not null
);
create index if not exists answer_question_idx on answer (lesson_id, question) where first_try = 1;
create index if not exists answer_user_idx on answer (username);
create table if not exists access_log (
  id       integer primary key autoincrement,
  username text not null,
  event    text not null,
  ip       text,
  at       text not null
);
create table if not exists manager (
  username text primary key,
  added_by text,
  added_at text not null
);
`;

export interface SqliteStoreOptions {
  /** Fixed managers, re-asserted on every boot with added_by = 'config'. */
  managers?: string[];
  now?: () => Date;
}

export type SqliteStore = Store & { close(): void; db: DatabaseSync };

export function openSqliteStore(file: string, opts: SqliteStoreOptions = {}): SqliteStore {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("pragma journal_mode = wal;");
  db.exec(SCHEMA);
  const now = () => (opts.now ?? (() => new Date()))().toISOString();

  const fixed = (opts.managers ?? []).map(userKey);
  const insFixed = db.prepare(
    `insert into manager (username, added_by, added_at) values (?, 'config', ?)
     on conflict (username) do update set added_by = 'config'`,
  );
  for (const m of fixed) insFixed.run(m, now());
  // Taking someone out of MANAGERS revokes access on the next boot (otherwise a "config" row,
  // which the UI refuses to delete, would outlive the setting that created it).
  db.prepare(`delete from manager where added_by = 'config' and username not in (select value from json_each(?))`).run(JSON.stringify(fixed));

  const touch = db.prepare(
    `insert into analyst (username, name, first_seen, last_seen) values (?, ?, ?, ?)
     on conflict (username) do update set name = excluded.name, last_seen = excluded.last_seen`,
  );
  const doTouch = (username: string, name: string, at: string) => touch.run(userKey(username), name || username, at, at);

  const tx = <T>(fn: () => T): T => {
    db.exec("begin");
    try {
      const r = fn();
      db.exec("commit");
      return r;
    } catch (e) {
      db.exec("rollback");
      throw e;
    }
  };

  return {
    db,
    close: () => db.close(),

    async touchUser(username, name) {
      doTouch(username, name, now());
    },

    async recordAccess(username, event: AccessEvent, ip) {
      db.prepare(`insert into access_log (username, event, ip, at) values (?, ?, ?, ?)`).run(userKey(username).slice(0, 120), event, ip, now());
    },

    async recentAccess(limit) {
      const rows = db.prepare(`select username, event, ip, at from access_log order by id desc limit ?`).all(limit) as unknown as AccessRow[];
      return rows.map((r) => ({ ...r }));
    },

    async readProgress(username) {
      const row = db.prepare(`select state, updated_at from progress where username = ?`).get(userKey(username)) as
        | { state: string; updated_at: string }
        | undefined;
      return row ? { state: JSON.parse(row.state) as ProgressState, updatedAt: row.updated_at } : null;
    },

    async saveProgress(username, name, state) {
      const u = userKey(username);
      const at = now();
      const done = Object.keys(state.done);
      return tx(() => {
        doTouch(u, name, at);
        db.prepare(
          `insert into progress (username, state, updated_at) values (?, ?, ?)
           on conflict (username) do update set state = excluded.state, updated_at = excluded.updated_at`,
        ).run(u, JSON.stringify(state), at);
        // A lesson's date is the first time it showed up as done; "start over" clears it.
        const ins = db.prepare(`insert into lesson_completed (username, lesson_id, completed_at) values (?, ?, ?) on conflict do nothing`);
        for (const id of done) ins.run(u, id, at);
        db.prepare(`delete from lesson_completed where username = ? and lesson_id not in (select value from json_each(?))`).run(u, JSON.stringify(done));
        return at;
      });
    },

    async recordAnswer(username, a: Answer) {
      db.prepare(
        `insert into answer (username, lesson_id, question, option, correct, first_try, created_at) values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(userKey(username), a.lessonId, a.question, a.option, a.correct ? 1 : 0, a.firstTry ? 1 : 0, now());
    },

    async analysts(): Promise<AnalystRow[]> {
      const rows = db
        .prepare(
          `select a.username, a.name, a.first_seen, a.last_seen, p.state, p.updated_at
             from analyst a left join progress p using (username) order by a.username`,
        )
        .all() as { username: string; name: string; first_seen: string; last_seen: string; state: string | null; updated_at: string | null }[];
      return rows.map((r) => ({
        username: r.username,
        name: r.name,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        state: r.state ? (JSON.parse(r.state) as ProgressState) : null,
        updatedAt: r.updated_at,
      }));
    },

    async completions(username): Promise<Completion[]> {
      const rows = db
        .prepare(`select lesson_id, completed_at from lesson_completed where username = ? order by completed_at desc, lesson_id`)
        .all(userKey(username)) as { lesson_id: string; completed_at: string }[];
      return rows.map((r) => ({ lessonId: r.lesson_id, completedAt: r.completed_at }));
    },

    async questionStats(username?: string): Promise<QuestionStat[]> {
      const rows = db
        .prepare(
          `select lesson_id, question, count(*) as attempts, sum(case when correct = 0 then 1 else 0 end) as errors
             from answer
            where first_try = 1 and (? is null or username = ?)
            group by lesson_id, question`,
        )
        .all(username ? userKey(username) : null, username ? userKey(username) : null) as {
        lesson_id: string;
        question: number;
        attempts: number;
        errors: number;
      }[];
      return rows.map((r) => ({ lessonId: r.lesson_id, question: Number(r.question), attempts: Number(r.attempts), errors: Number(r.errors) }));
    },

    async managers(): Promise<Manager[]> {
      const rows = db.prepare(`select username, added_by, added_at from manager order by username`).all() as {
        username: string;
        added_by: string | null;
        added_at: string;
      }[];
      return rows.map((r) => ({ username: r.username, addedBy: r.added_by, addedAt: r.added_at }));
    },

    async isManager(username) {
      return db.prepare(`select 1 from manager where username = ?`).get(userKey(username)) !== undefined;
    },

    async addManager(username, by) {
      db.prepare(`insert into manager (username, added_by, added_at) values (?, ?, ?) on conflict (username) do nothing`).run(userKey(username), userKey(by), now());
    },

    async removeManager(username) {
      db.prepare(`delete from manager where username = ? and added_by is not 'config'`).run(userKey(username));
    },
  };
}
