import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Content, Lesson } from "../shared/engine.js";
import { type LoadedContent, parseContent } from "../src/content.js";

export const root = resolve(import.meta.dirname, "..");
export const realContent = (): LoadedContent => parseContent(readFileSync(resolve(root, "content", "content.json"), "utf8"));
export const legacyHtml = () => readFileSync(resolve(root, "legacy", "legacy-track.html"), "utf8");

export function lesson(id: string, over: Partial<Lesson> = {}): Lesson {
  return {
    id,
    num: null,
    title: id,
    xp: 20,
    boss: false,
    blocks: [{ title: "b", html: "<p>x</p>", figures: [] }],
    questions: [
      { prompt: "q1", cloze: null, options: ["a", "b", "c"], answer: 1, explanation: "", image: null },
      { prompt: "q2", cloze: null, options: ["a", "b"], answer: 0, explanation: "", image: null },
    ],
    ...over,
  };
}

/** Two tracks: A (3 lessons over 2 chapters), B (1 boss lesson). */
export function tinyContent(): Content {
  return {
    schema: 1,
    tracks: [
      {
        key: "A",
        name: "Alpha",
        icon: "map",
        chapters: [
          { num: "1", title: "c1", lessons: [lesson("A-1-1"), lesson("A-1-2")] },
          { num: "2", title: "c2", lessons: [lesson("A-2-1", { xp: 40 })] },
        ],
      },
      { key: "B", name: "Beta", icon: "pen", chapters: [{ num: "3", title: "c3", lessons: [lesson("B-3-1", { boss: true, blocks: [] })] }] },
    ],
    figures: {},
  };
}
