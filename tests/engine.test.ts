import { describe, expect, it } from "vitest";
import {
  type ProgressState,
  STREAK_BADGE_AT,
  XP_FIRST_TRY,
  accuracy,
  advance,
  badgeCatalog,
  finishLesson,
  indexContent,
  initialState,
  isUnlocked,
  levelOf,
  levelProgress,
  maxPossibleXp,
  newlyEarned,
  overallCompletion,
  pick,
  resetState,
  sanitizeState,
  startRun,
  trackCompletion,
} from "../shared/engine.js";
import { simulate } from "../src/simulate.js";
import { realContent, tinyContent } from "./helpers.js";

const idx = indexContent(tinyContent());
const L = (id: string) => idx.lessons.get(id)!.lesson;

/** Plays a whole lesson; `wrongFirst` lists question indexes answered wrong before right. */
function play(state: ProgressState, id: string, wrongFirst: number[] = []) {
  const lesson = L(id);
  let run = startRun(lesson, state);
  let s = state;
  for (;;) {
    const st = advance(run, lesson);
    run = st.run;
    if (st.finished) break;
    const q = lesson.questions[run.question]!;
    if (wrongFirst.includes(run.question)) {
      const r = pick(run, s, lesson, (q.answer + 1) % q.options.length);
      run = r.run;
      s = r.state;
    }
    const r = pick(run, s, lesson, q.answer);
    run = r.run;
    s = r.state;
  }
  return finishLesson(s, run, idx);
}

describe("levels", () => {
  it("150 XP per level, starting at level 1", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(149)).toBe(1);
    expect(levelOf(150)).toBe(2);
    expect(levelOf(-5)).toBe(1);
    expect(levelProgress(160)).toEqual({ level: 2, into: 10, toNext: 140, pct: 7 });
  });

  it("accuracy is first-try over answered, null before any answer", () => {
    expect(accuracy({ first: 0, tot: 0 })).toBeNull();
    expect(accuracy({ first: 2, tot: 3 })).toBe(67);
  });
});

describe("unlocking", () => {
  it("unlocks in order inside each track, across chapters", () => {
    const s = initialState("A");
    expect(isUnlocked(idx, s, "A-1-1")).toBe(true);
    expect(isUnlocked(idx, s, "A-1-2")).toBe(false);
    expect(isUnlocked(idx, s, "B-3-1")).toBe(true); // first of its own track
    const s2 = { ...s, done: { "A-1-1": 1 as const, "A-1-2": 1 as const } };
    expect(isUnlocked(idx, s2, "A-2-1")).toBe(true);
  });

  it("lock off opens everything; unknown ids never open", () => {
    expect(isUnlocked(idx, { done: {}, lock: false }, "A-2-1")).toBe(true);
    expect(isUnlocked(idx, { done: {}, lock: false }, "nope")).toBe(false);
  });
});

describe("answering", () => {
  const lesson = L("A-1-1");

  it("first-try right: +10 XP, streak and best go up", () => {
    let run = advance(startRun(lesson, initialState()), lesson).run;
    const r = pick(run, { ...initialState(), streak: 3, best: 3 }, lesson, 1);
    run = r.run;
    expect(r.correct).toBe(true);
    expect(r.xpGained).toBe(XP_FIRST_TRY);
    expect(r.state).toMatchObject({ xp: 10, streak: 4, best: 4, first: 1, tot: 1 });
    expect(run.answered).toBe(true);
  });

  it("first-try wrong resets the streak; the later right answer gives no XP", () => {
    const run0 = advance(startRun(lesson, initialState()), lesson).run;
    const wrong = pick(run0, { ...initialState(), streak: 5, best: 5 }, lesson, 0);
    expect(wrong.correct).toBe(false);
    expect(wrong.state.streak).toBe(0);
    expect(wrong.state.best).toBe(5);
    expect(wrong.run).toMatchObject({ firstTry: false, errors: 1, wrong: [0] });
    const again = pick(wrong.run, wrong.state, lesson, 2); // second wrong: not a first try
    expect(again.run.errors).toBe(1);
    const right = pick(again.run, again.state, lesson, 1);
    expect(right).toMatchObject({ correct: true, xpGained: 0, wasFirstTry: false });
    expect(right.state).toMatchObject({ xp: 0, first: 0, tot: 1, streak: 0 });
  });

  it("ignores repeated wrong options, out-of-range options and picks after answering", () => {
    const run0 = advance(startRun(lesson, initialState()), lesson).run;
    const w = pick(run0, initialState(), lesson, 0);
    expect(pick(w.run, w.state, lesson, 0).run).toBe(w.run);
    expect(pick(w.run, w.state, lesson, 9).run).toBe(w.run);
    const ok = pick(w.run, w.state, lesson, 1);
    expect(pick(ok.run, ok.state, lesson, 1).run).toBe(ok.run);
  });

  it("cannot advance past an unanswered question; reading step always advances", () => {
    const run0 = startRun(lesson, initialState());
    expect(run0.question).toBe(-1);
    const r1 = advance(run0, lesson);
    expect(r1.run.question).toBe(0);
    expect(advance(r1.run, lesson).run).toBe(r1.run);
  });

  it("boss lessons skip the reading step", () => {
    expect(startRun(L("B-3-1"), initialState()).question).toBe(0);
  });
});

describe("finishing a lesson", () => {
  it("awards completion XP, perfect and the first-lesson badge", () => {
    const r = play(initialState("A"), "A-1-1");
    expect(r.xpGained).toBe(20);
    expect(r.state.xp).toBe(20 + 2 * XP_FIRST_TRY);
    expect(r.state.done).toEqual({ "A-1-1": 1 });
    expect(r.perfect).toBe(true);
    expect(r.state.perfect).toBe(1);
    expect(r.newBadges.map((b) => b.id).sort()).toEqual(["first", "perfect"]);
  });

  it("a mistake costs the 'perfect' mark but not completion", () => {
    const r = play(initialState("A"), "A-1-1", [0]);
    expect(r.perfect).toBe(false);
    expect(r.state.perfect).toBe(0);
    expect(r.state.done["A-1-1"]).toBe(1);
  });

  it("replaying a finished lesson is a review: no bonus, no second perfect", () => {
    const first = play(initialState("A"), "A-1-1").state;
    const again = play(first, "A-1-1");
    expect(again.alreadyDone).toBe(true);
    expect(again.xpGained).toBe(0);
    expect(again.state.perfect).toBe(1);
    expect(again.state).toEqual(first); // not even first-try XP: no farming by replaying
  });

  it("answers during a review give feedback but never move the score", () => {
    const done = play(initialState("A"), "A-1-1").state;
    const lesson = L("A-1-1");
    const run = advance(startRun(lesson, initialState()), lesson).run;
    const wrong = pick(run, { ...done, streak: 4 }, lesson, 0);
    expect(wrong).toMatchObject({ correct: false, review: true, xpGained: 0 });
    expect(wrong.state.streak).toBe(4);
    const right = pick(wrong.run, wrong.state, lesson, 1);
    expect(right).toMatchObject({ correct: true, review: true });
    expect(right.state).toBe(wrong.state);
  });

  it("reports level ups", () => {
    const r = play({ ...initialState("A"), xp: 140 }, "A-1-1");
    expect(r.levelUp).toEqual({ from: 1, to: 2 });
  });

  it("track and master badges once every lesson is done", () => {
    let s = initialState("A");
    for (const id of ["A-1-1", "A-1-2", "A-2-1"]) s = play(s, id).state;
    expect(s.badges["track-A"]).toBe(1);
    expect(s.badges.all).toBeUndefined();
    const last = play(s, "B-3-1");
    expect(last.newBadges.map((b) => b.id).sort()).toEqual(["all", "track-B"]);
    expect(trackCompletion(idx, last.state, "A")).toEqual({ done: 3, total: 3, pct: 100 });
  });

  it("streak badge at 10 first-try answers in a row", () => {
    const s = { ...initialState(), best: STREAK_BADGE_AT };
    expect(newlyEarned(s, idx).map((b) => b.id)).toContain("streak");
  });

  it("badges are sticky and never re-announced", () => {
    const s = play(initialState("A"), "A-1-1").state;
    expect(newlyEarned(s, idx).map((b) => b.id)).not.toContain("first");
  });
});

describe("server-side hygiene", () => {
  it("drops removed lessons and unknown badges, repairs inconsistent counters", () => {
    const s: ProgressState = {
      ...initialState("A"),
      done: { "A-1-1": 1, "Old-9-9": 1 },
      badges: { first: 1, "made-up": 1 },
      streak: 7,
      best: 3,
      first: 9,
      tot: 4,
    };
    const clean = sanitizeState(s, idx);
    expect(clean.done).toEqual({ "A-1-1": 1 });
    expect(clean.badges).toEqual({ first: 1 });
    expect(clean.best).toBe(7);
    expect(clean.first).toBe(4);
    expect(overallCompletion(idx, s).done).toBe(1);
  });

  it("max XP is every lesson bonus plus first-try XP for every question", () => {
    expect(maxPossibleXp(tinyContent())).toBe(20 + 20 + 40 + 20 + 8 * XP_FIRST_TRY);
  });

  it("resetting keeps tab and lock", () => {
    const s = { ...play(initialState("B"), "B-3-1").state, lock: false };
    expect(resetState(s)).toEqual({ ...initialState("B"), lock: false });
  });

  it("badge catalog has one badge per track plus the fixed ones", () => {
    expect(badgeCatalog(idx).map((b) => b.id)).toEqual(["first", "track-A", "track-B", "perfect", "streak", "all"]);
  });
});

describe("simulated analysts on the real content", () => {
  const c = realContent();

  it("a perfect analyst reaches exactly the maximum XP and every badge but streak-dependent ones", () => {
    const sim = simulate(c, { seed: 1, skill: 1, lessons: 99 });
    expect(sim.state.xp).toBe(c.maxXp);
    expect(Object.keys(sim.state.done)).toHaveLength(c.total);
    expect(sim.state.first).toBe(sim.state.tot);
    expect(Object.keys(sim.state.badges).sort()).toEqual(badgeCatalog(c).map((b) => b.id).sort());
  });

  it("invariants hold for any seed: xp within bounds, first ≤ tot, one first-try answer per question", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = simulate(c, { seed, skill: 0.5, lessons: 99 });
      expect(sim.state.xp).toBeLessThanOrEqual(c.maxXp);
      expect(sim.state.first).toBeLessThanOrEqual(sim.state.tot);
      expect(sim.state.best).toBeGreaterThanOrEqual(sim.state.streak);
      const firstTries = sim.answers.filter((a) => a.firstTry);
      expect(firstTries).toHaveLength(sim.state.tot);
      expect(firstTries.filter((a) => a.correct)).toHaveLength(sim.state.first);
    }
  });
});
