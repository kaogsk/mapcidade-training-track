/**
 * Plays lessons through the real engine with a seeded random "analyst". Used by `npm run seed`
 * to fill the demo database, and by tests as an end-to-end check of the engine's invariants.
 */
import { type ContentIndex, type ProgressState, advance, finishLesson, initialState, pick, startRun } from "../shared/engine.js";
import type { Answer } from "./progress.js";

/** mulberry32: tiny deterministic PRNG, good enough for demo data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Simulation {
  state: ProgressState;
  answers: Answer[];
}

/**
 * Takes the first `lessons` lessons of each track in `tracks` (in unlock order). `skill` is the
 * chance of answering right on the first try; after a miss the analyst tries the other options in
 * order, like someone eliminating choices.
 */
export function simulate(idx: ContentIndex, opts: { seed: number; skill: number; lessons: number; tracks?: string[] }): Simulation {
  const random = rng(opts.seed);
  let state = initialState(idx.content.tracks[0]?.key ?? "");
  const answers: Answer[] = [];
  for (const t of idx.content.tracks) {
    if (opts.tracks && !opts.tracks.includes(t.key)) continue;
    for (const id of (idx.order.get(t.key) ?? []).slice(0, opts.lessons)) {
      const lesson = idx.lessons.get(id)!.lesson;
      let run = startRun(lesson, state);
      for (;;) {
        const step = advance(run, lesson);
        run = step.run;
        if (step.finished) break;
        const q = lesson.questions[run.question]!;
        const wrongOrder = q.options.map((_, i) => i).filter((i) => i !== q.answer);
        let attempt = random() < opts.skill ? q.answer : wrongOrder[Math.floor(random() * wrongOrder.length)]!;
        while (!run.answered) {
          const r = pick(run, state, lesson, attempt);
          answers.push({ lessonId: id, question: run.question, option: attempt, firstTry: r.wasFirstTry && !r.review, correct: r.correct });
          run = r.run;
          state = r.state;
          attempt = run.answered ? attempt : (wrongOrder.find((o) => !run.wrong.includes(o)) ?? q.answer);
          if (run.wrong.length >= wrongOrder.length) attempt = q.answer;
        }
      }
      state = finishLesson(state, run, idx).state;
      state = { ...state, tab: t.key };
    }
  }
  return { state, answers };
}
