/**
 * Gamification engine: content model, XP, levels, streaks, lesson unlocking and badges.
 *
 * Pure functions only, no DOM and no Node APIs. The same module is compiled twice: for the
 * browser (it drives the lesson UI) and for the server (management dashboard, plausibility
 * checks on saved progress). One implementation means the dashboard can never disagree with
 * what the analyst saw on screen.
 */

// ---------------------------------------------------------------- content model

export interface Block {
  title: string;
  /** Trusted, authored HTML (comes from the extractor, never from users). */
  html: string;
  /** Figure ids shown under the block. */
  figures: string[];
}

export interface Question {
  prompt: string;
  /** Optional fill-in-the-blank sentence; `_____` marks the gap. */
  cloze: string | null;
  options: string[];
  /** Index into `options`. */
  answer: number;
  explanation: string;
  /** Optional figure id ("which button is this?"). */
  image: string | null;
}

export interface Lesson {
  /** Stable id (`<track>-<chapter>-<n>`). Progress is keyed by it, so it must survive re-extraction. */
  id: string;
  num: string | null;
  title: string;
  xp: number;
  /** Chapter review: questions only, no reading step. */
  boss: boolean;
  blocks: Block[];
  questions: Question[];
}

export interface Chapter {
  num: string;
  title: string;
  lessons: Lesson[];
}

export interface Track {
  key: string;
  name: string;
  icon: string;
  chapters: Chapter[];
}

export interface Figure {
  file: string;
  num: string;
  caption: string;
}

export interface Content {
  schema: 1;
  tracks: Track[];
  figures: Record<string, Figure>;
}

// ---------------------------------------------------------------- progress state

/** What the browser keeps and the server stores per analyst. Field names are the wire format. */
export interface ProgressState {
  xp: number;
  /** Consecutive first-try correct answers. */
  streak: number;
  /** Best streak ever. */
  best: number;
  done: Record<string, 1>;
  /** Questions answered correctly on the first try. */
  first: number;
  /** Questions answered correctly at all (first try or not). `first / tot` is the accuracy. */
  tot: number;
  /** Lessons finished without a single first-try mistake. */
  perfect: number;
  badges: Record<string, 1>;
  /** Track currently open in the UI. */
  tab: string;
  /** When true, lessons unlock in order within each track. */
  lock: boolean;
}

export const XP_PER_LEVEL = 150;
export const XP_FIRST_TRY = 10;
export const STREAK_BADGE_AT = 10;

export function initialState(tab = ""): ProgressState {
  return { xp: 0, streak: 0, best: 0, done: {}, first: 0, tot: 0, perfect: 0, badges: {}, tab, lock: true };
}

/** "Start over" wipes the score but keeps UI preferences. */
export function resetState(s: ProgressState): ProgressState {
  return { ...initialState(s.tab), lock: s.lock };
}

// ---------------------------------------------------------------- levels

export const levelOf = (xp: number): number => Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP still missing for the next level. */
  toNext: number;
  pct: number;
}

export function levelProgress(xp: number): LevelProgress {
  const into = Math.max(0, xp) % XP_PER_LEVEL;
  return { level: levelOf(xp), into, toNext: XP_PER_LEVEL - into, pct: Math.round((into / XP_PER_LEVEL) * 100) };
}

/** First-try accuracy in percent, or null before the first answer. */
export const accuracy = (s: Pick<ProgressState, "first" | "tot">): number | null =>
  s.tot > 0 ? Math.round((s.first / s.tot) * 100) : null;

// ---------------------------------------------------------------- content index

export interface LessonRef {
  lesson: Lesson;
  track: Track;
  /** Position inside the track (0-based, across chapters). */
  position: number;
}

export interface ContentIndex {
  content: Content;
  lessons: Map<string, LessonRef>;
  /** Lesson ids of each track, in unlock order. */
  order: Map<string, string[]>;
  total: number;
}

export function indexContent(content: Content): ContentIndex {
  const lessons = new Map<string, LessonRef>();
  const order = new Map<string, string[]>();
  for (const track of content.tracks) {
    const ids: string[] = [];
    for (const ch of track.chapters)
      for (const lesson of ch.lessons) {
        lessons.set(lesson.id, { lesson, track, position: ids.length });
        ids.push(lesson.id);
      }
    order.set(track.key, ids);
  }
  return { content, lessons, order, total: lessons.size };
}

export interface Completion {
  done: number;
  total: number;
  pct: number;
}

const completion = (done: number, total: number): Completion => ({
  done,
  total,
  pct: total ? Math.round((done / total) * 100) : 0,
});

export function trackCompletion(idx: ContentIndex, s: Pick<ProgressState, "done">, trackKey: string): Completion {
  const ids = idx.order.get(trackKey) ?? [];
  return completion(ids.filter((id) => s.done[id]).length, ids.length);
}

/** Only lessons that still exist count: a lesson removed from the content stops counting. */
export function overallCompletion(idx: ContentIndex, s: Pick<ProgressState, "done">): Completion {
  return completion(Object.keys(s.done).filter((id) => idx.lessons.has(id)).length, idx.total);
}

/** With the lock on, a lesson opens once the previous one of the same track is done. */
export function isUnlocked(idx: ContentIndex, s: Pick<ProgressState, "done" | "lock">, lessonId: string): boolean {
  const ref = idx.lessons.get(lessonId);
  if (!ref) return false;
  if (!s.lock || ref.position === 0) return true;
  const prev = idx.order.get(ref.track.key)![ref.position - 1]!;
  return !!s.done[prev];
}

/** Upper bound of XP an honest client can hold: every lesson's bonus plus first-try XP for every question. */
export function maxPossibleXp(content: Content): number {
  let xp = 0;
  for (const t of content.tracks)
    for (const ch of t.chapters) for (const l of ch.lessons) xp += l.xp + l.questions.length * XP_FIRST_TRY;
  return xp;
}

// ---------------------------------------------------------------- badges

export interface Badge {
  id: string;
  icon: string;
  title: string;
  description: string;
  earned(s: ProgressState, idx: ContentIndex): boolean;
}

export function badgeCatalog(idx: ContentIndex): Badge[] {
  return [
    {
      id: "first",
      icon: "sprout",
      title: "First step",
      description: "Finish your first lesson",
      earned: (s, i) => overallCompletion(i, s).done >= 1,
    },
    ...idx.content.tracks.map(
      (t): Badge => ({
        id: `track-${t.key}`,
        icon: t.icon,
        title: `${t.name} track`,
        description: `Finish every lesson of ${t.name}`,
        earned: (s, i) => {
          const c = trackCompletion(i, s, t.key);
          return c.total > 0 && c.done === c.total;
        },
      }),
    ),
    {
      id: "perfect",
      icon: "target",
      title: "Sharp shooter",
      description: "Finish a lesson without a single mistake",
      earned: (s) => s.perfect >= 1,
    },
    {
      id: "streak",
      icon: "flame",
      title: "On fire",
      description: `${STREAK_BADGE_AT} first-try answers in a row`,
      earned: (s) => s.best >= STREAK_BADGE_AT,
    },
    {
      id: "all",
      icon: "crown",
      title: "MapCidade master",
      description: "Finish every track",
      earned: (s, i) => i.total > 0 && overallCompletion(i, s).done === i.total,
    },
  ];
}

/** Badges are sticky: once earned they stay, even if the content later grows. */
export function newlyEarned(s: ProgressState, idx: ContentIndex, catalog = badgeCatalog(idx)): Badge[] {
  return catalog.filter((b) => !s.badges[b.id] && b.earned(s, idx));
}

// ---------------------------------------------------------------- lesson run

/**
 * One pass through a lesson. `question === -1` is the reading step; boss lessons start at 0.
 * `firstTry` resets per question; `errors` counts first-try mistakes in the whole lesson.
 */
export interface LessonRun {
  lessonId: string;
  question: number;
  firstTry: boolean;
  answered: boolean;
  errors: number;
  /** Options already tried and wrong for the current question. */
  wrong: number[];
  /** XP when the lesson was opened: a level reached mid-lesson (question XP) is still announced at the end. */
  xpAtStart: number;
}

export function startRun(lesson: Lesson, state: Pick<ProgressState, "xp">): LessonRun {
  return { lessonId: lesson.id, question: lesson.boss ? 0 : -1, firstTry: true, answered: false, errors: 0, wrong: [], xpAtStart: state.xp };
}

export interface PickResult {
  run: LessonRun;
  state: ProgressState;
  correct: boolean;
  /** Whether this pick was the first attempt at the question (what the server records). */
  wasFirstTry: boolean;
  /** The lesson was already done: feedback only, the score does not move. */
  review: boolean;
  xpGained: number;
}

/**
 * Applies an answer. First-try correct: +XP and streak++. First-try wrong: streak resets and the
 * lesson stops being "perfect". Later attempts never move XP or the streak. Re-picking a wrong
 * option or answering an already answered question is a no-op.
 *
 * Replaying a finished lesson is a review and leaves the score untouched. Without that rule a
 * lesson could be replayed forever for +10 XP per question, and `maxPossibleXp` (which the server
 * uses to reject forged progress) would stop being an upper bound.
 */
export function pick(run: LessonRun, state: ProgressState, lesson: Lesson, option: number): PickResult {
  const q = lesson.questions[run.question];
  const review = !!state.done[lesson.id];
  const noop = { run, state, correct: false, wasFirstTry: false, review, xpGained: 0 };
  if (!q || run.answered || option < 0 || option >= q.options.length || run.wrong.includes(option)) return noop;

  const wasFirstTry = run.firstTry;
  if (review) {
    const correct = option === q.answer;
    const next = correct
      ? { ...run, answered: true }
      : { ...run, firstTry: false, errors: run.errors + (wasFirstTry ? 1 : 0), wrong: [...run.wrong, option] };
    return { run: next, state, correct, wasFirstTry, review, xpGained: 0 };
  }
  if (option === q.answer) {
    const xpGained = wasFirstTry ? XP_FIRST_TRY : 0;
    const streak = wasFirstTry ? state.streak + 1 : state.streak;
    return {
      run: { ...run, answered: true },
      state: {
        ...state,
        tot: state.tot + 1,
        first: state.first + (wasFirstTry ? 1 : 0),
        xp: state.xp + xpGained,
        streak,
        best: Math.max(state.best, streak),
      },
      correct: true,
      wasFirstTry,
      review,
      xpGained,
    };
  }
  return {
    run: { ...run, firstTry: false, errors: run.errors + (wasFirstTry ? 1 : 0), wrong: [...run.wrong, option] },
    state: wasFirstTry ? { ...state, streak: 0 } : state,
    correct: false,
    wasFirstTry,
    review,
    xpGained: 0,
  };
}

/** Moves to the next question. Returns `finished` once past the last one. */
export function advance(run: LessonRun, lesson: Lesson): { run: LessonRun; finished: boolean } {
  const reading = run.question === -1;
  if (!reading && !run.answered) return { run, finished: false };
  const next = run.question + 1;
  if (next >= lesson.questions.length) return { run: { ...run, question: lesson.questions.length }, finished: true };
  return { run: { ...run, question: next, firstTry: true, answered: false, wrong: [] }, finished: false };
}

export interface FinishResult {
  state: ProgressState;
  alreadyDone: boolean;
  xpGained: number;
  perfect: boolean;
  levelUp: { from: number; to: number } | null;
  newBadges: Badge[];
}

/** Completion bonus and badges. Replaying a finished lesson is a review: no XP, no "perfect". */
export function finishLesson(state: ProgressState, run: LessonRun, idx: ContentIndex): FinishResult {
  const ref = idx.lessons.get(run.lessonId);
  if (!ref) throw new Error(`unknown lesson ${run.lessonId}`);
  const { lesson } = ref;
  const alreadyDone = !!state.done[lesson.id];
  const perfect = run.errors === 0 && lesson.questions.length > 0;
  let next = state;
  if (!alreadyDone) {
    next = {
      ...state,
      xp: state.xp + lesson.xp,
      done: { ...state.done, [lesson.id]: 1 },
      perfect: state.perfect + (perfect ? 1 : 0),
    };
  }
  const newBadges = newlyEarned(next, idx);
  if (newBadges.length) next = { ...next, badges: { ...next.badges, ...Object.fromEntries(newBadges.map((b) => [b.id, 1 as const])) } };
  const from = levelOf(Math.min(run.xpAtStart, state.xp));
  const to = levelOf(next.xp);
  return {
    state: next,
    alreadyDone,
    xpGained: alreadyDone ? 0 : lesson.xp,
    perfect: perfect && !alreadyDone,
    levelUp: to > from ? { from, to } : null,
    newBadges,
  };
}

// ---------------------------------------------------------------- server-side hygiene

/**
 * What the server keeps from a client-sent state: lessons that no longer exist are dropped (they
 * would inflate the dashboard), unknown badges are dropped, and the streak can't beat the record.
 */
export function sanitizeState(s: ProgressState, idx: ContentIndex): ProgressState {
  const badgeIds = new Set(badgeCatalog(idx).map((b) => b.id));
  return {
    ...s,
    done: Object.fromEntries(Object.keys(s.done).filter((id) => idx.lessons.has(id)).map((id) => [id, 1 as const])),
    badges: Object.fromEntries(Object.keys(s.badges).filter((id) => badgeIds.has(id)).map((id) => [id, 1 as const])),
    best: Math.max(s.best, s.streak),
    first: Math.min(s.first, s.tot),
  };
}
