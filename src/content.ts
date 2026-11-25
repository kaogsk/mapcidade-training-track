/** Loads content/content.json (written by the extractor) and builds the indexes the API needs. */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { type Content, type ContentIndex, indexContent, maxPossibleXp } from "../shared/engine.js";

const QuestionSchema = z.object({
  prompt: z.string(),
  cloze: z.string().nullable(),
  options: z.array(z.string()).min(2),
  answer: z.number().int().min(0),
  explanation: z.string(),
  image: z.string().nullable(),
});
const LessonSchema = z.object({
  id: z.string(),
  num: z.string().nullable(),
  title: z.string(),
  xp: z.number().int().min(0),
  boss: z.boolean(),
  blocks: z.array(z.object({ title: z.string(), html: z.string(), figures: z.array(z.string()) })),
  questions: z.array(QuestionSchema),
});
export const ContentSchema = z.object({
  schema: z.literal(1),
  tracks: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      icon: z.string(),
      chapters: z.array(z.object({ num: z.string(), title: z.string(), lessons: z.array(LessonSchema) })),
    }),
  ),
  figures: z.record(z.string(), z.object({ file: z.string(), num: z.string(), caption: z.string() })),
});

export interface LoadedContent extends ContentIndex {
  /** Served as-is by /api/content (parsed once at boot, never re-serialised per request). */
  json: string;
  maxXp: number;
}

export function parseContent(json: string): LoadedContent {
  const content = ContentSchema.parse(JSON.parse(json)) as Content;
  return { ...indexContent(content), json, maxXp: maxPossibleXp(content) };
}

export const loadContent = (file: string): LoadedContent => parseContent(readFileSync(file, "utf8"));
