/** Wire schemas for the progress API. */
import { z } from "zod";
import type { ProgressState } from "../shared/engine.js";

const counter = z.number().int().min(0).max(10_000_000);
const marks = z.record(z.string().max(120), z.literal(1));

/** Same shape as `ProgressState` in shared/engine.ts; the type below is checked against it. */
export const StateSchema = z.object({
  xp: counter,
  streak: counter,
  best: counter,
  done: marks,
  first: counter,
  tot: counter,
  perfect: counter,
  badges: marks,
  tab: z.string().max(40),
  lock: z.boolean(),
});

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compile-time guard: the schema and the engine's state type cannot drift apart. */
export const STATE_SCHEMA_MATCHES_ENGINE: Same<z.infer<typeof StateSchema>, ProgressState> = true;

export const AnswerSchema = z.object({
  lessonId: z.string().max(120),
  question: z.number().int().min(0).max(200),
  option: z.number().int().min(0).max(50),
  firstTry: z.boolean(),
});

export type Answer = z.infer<typeof AnswerSchema> & { correct: boolean };

/** Directory username, normalised: the analyst's key in every table. */
export const userKey = (username: string) => username.trim().toLowerCase();

export const USERNAME = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[A-Za-z0-9._-]+$/, "invalid username");
