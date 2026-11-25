/** Manager dashboard: every analyst's progress, per-analyst detail, the questions that trip people up. */
import { accuracy, badgeCatalog, levelOf, overallCompletion, trackCompletion } from "../shared/engine.js";
import type { LoadedContent } from "./content.js";
import type { AnalystRow, QuestionStat, Store } from "./store.js";

export interface AnalystSummary {
  username: string;
  name: string;
  lessons: number;
  pct: number;
  xp: number;
  level: number;
  /** First-try accuracy in percent (null = has not answered anything yet). */
  accuracy: number | null;
  badges: number;
  byTrack: Record<string, number>;
  firstSeen: string;
  lastActivity: string;
}

export function summarize(row: AnalystRow, c: LoadedContent): AnalystSummary {
  const s = row.state;
  const done = { done: s?.done ?? {} };
  const badgeIds = new Set(badgeCatalog(c).map((b) => b.id));
  const overall = overallCompletion(c, done);
  return {
    username: row.username,
    name: row.name,
    lessons: overall.done,
    pct: overall.pct,
    xp: s?.xp ?? 0,
    level: levelOf(s?.xp ?? 0),
    accuracy: s ? accuracy(s) : null,
    badges: Object.keys(s?.badges ?? {}).filter((b) => badgeIds.has(b)).length,
    byTrack: Object.fromEntries(c.content.tracks.map((t) => [t.key, trackCompletion(c, done, t.key).done])),
    firstSeen: row.firstSeen,
    lastActivity: [row.lastSeen, row.updatedAt].filter((x): x is string => !!x).sort().at(-1)!,
  };
}

export interface HardQuestion {
  lessonId: string;
  track: string;
  lesson: string;
  question: number;
  prompt: string;
  attempts: number;
  errors: number;
  errorRate: number;
}

/**
 * Most missed on the first try. `minAttempts` keeps one isolated mistake from showing up as a
 * 100% error rate at the top of the list.
 */
export function hardestQuestions(stats: QuestionStat[], c: LoadedContent, minAttempts = 2, limit = 15): HardQuestion[] {
  return stats
    .filter((s) => s.errors > 0 && s.attempts >= minAttempts)
    .flatMap((s) => {
      const ref = c.lessons.get(s.lessonId);
      const q = ref?.lesson.questions[s.question];
      if (!ref || !q) return []; // question removed from the content since it was answered
      return [
        {
          lessonId: s.lessonId,
          track: ref.track.name,
          lesson: ref.lesson.title,
          question: s.question,
          prompt: q.cloze ? `${q.prompt} ${q.cloze}` : q.prompt,
          attempts: s.attempts,
          errors: s.errors,
          errorRate: Math.round((s.errors / s.attempts) * 100),
        },
      ];
    })
    .sort((a, b) => b.errorRate - a.errorRate || b.errors - a.errors || a.lessonId.localeCompare(b.lessonId) || a.question - b.question)
    .slice(0, limit);
}

export async function dashboard(store: Store, c: LoadedContent) {
  const [rows, stats] = await Promise.all([store.analysts(), store.questionStats()]);
  return {
    tracks: c.content.tracks.map((t) => ({ key: t.key, name: t.name, total: c.order.get(t.key)!.length })),
    totalLessons: c.total,
    analysts: rows.map((r) => summarize(r, c)).sort((a, b) => b.pct - a.pct || b.xp - a.xp || a.username.localeCompare(b.username)),
    questions: hardestQuestions(stats, c),
  };
}

export async function analystDetail(store: Store, c: LoadedContent, username: string) {
  const row = (await store.analysts()).find((r) => r.username === username.trim().toLowerCase());
  if (!row) return null;
  const [completions, stats] = await Promise.all([store.completions(username), store.questionStats(username)]);
  return {
    summary: summarize(row, c),
    completions: completions.flatMap((x) => {
      const ref = c.lessons.get(x.lessonId);
      return ref ? [{ ...x, track: ref.track.name, lesson: ref.lesson.title, num: ref.lesson.num }] : [];
    }),
    firstTryMisses: hardestQuestions(stats, c, 1, 50),
  };
}

// ---------------------------------------------------------------- CSV export

/**
 * RFC 4180 quoting plus a guard against spreadsheet formula injection: a display name such as
 * `=HYPERLINK(...)` comes from the directory, not from us, and Excel would execute it.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function dashboardCsv(d: Awaited<ReturnType<typeof dashboard>>): string {
  const head = ["username", "name", "lessons", "pct", "xp", "level", "accuracy", "badges", ...d.tracks.map((t) => t.name), "last_activity"];
  const lines = d.analysts.map((a) =>
    [a.username, a.name, a.lessons, a.pct, a.xp, a.level, a.accuracy ?? "", a.badges, ...d.tracks.map((t) => a.byTrack[t.key] ?? 0), a.lastActivity]
      .map(csvCell)
      .join(","),
  );
  // BOM so spreadsheet apps detect UTF-8 (accented names).
  return `\uFEFF${[head.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}
