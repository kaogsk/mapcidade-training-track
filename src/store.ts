/**
 * What the app persists. The production version runs on PostgreSQL; this repo implements the
 * same contract on node:sqlite (sqliteStore.ts). The interface stays async so either backend fits.
 */
import type { ProgressState } from "../shared/engine.js";
import type { Answer } from "./progress.js";

export interface AnalystRow {
  username: string;
  name: string;
  firstSeen: string;
  lastSeen: string;
  state: ProgressState | null;
  updatedAt: string | null;
}

export interface Completion {
  lessonId: string;
  completedAt: string;
}

/** First-try answers only: that is what tells whether the material was understood. */
export interface QuestionStat {
  lessonId: string;
  question: number;
  attempts: number;
  errors: number;
}

export interface Manager {
  username: string;
  /** `config` = fixed in the server's environment, cannot be removed from the UI. */
  addedBy: string | null;
  addedAt: string;
}

export type AccessEvent = "login" | "logout" | "login_refused";

export interface AccessRow {
  username: string;
  event: AccessEvent;
  ip: string | null;
  at: string;
}

export interface Store {
  /** Creates/updates the analyst and bumps last activity. */
  touchUser(username: string, name: string): Promise<void>;
  recordAccess(username: string, event: AccessEvent, ip: string | null): Promise<void>;
  recentAccess(limit: number): Promise<AccessRow[]>;
  readProgress(username: string): Promise<{ state: ProgressState; updatedAt: string } | null>;
  /** Stores the state and syncs completed lessons (keeping each first completion date). Returns the write time. */
  saveProgress(username: string, name: string, state: ProgressState): Promise<string>;
  recordAnswer(username: string, a: Answer): Promise<void>;
  analysts(): Promise<AnalystRow[]>;
  completions(username: string): Promise<Completion[]>;
  questionStats(username?: string): Promise<QuestionStat[]>;
  managers(): Promise<Manager[]>;
  isManager(username: string): Promise<boolean>;
  addManager(username: string, by: string): Promise<void>;
  removeManager(username: string): Promise<void>;
}
