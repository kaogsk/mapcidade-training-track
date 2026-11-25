/**
 * Legacy single-file page → structured content.
 *
 *   const TRACKS=[...terse lesson tree...];const CAP={id:[num,caption]};const IMG={id:"data:image/...;base64,..."}
 *
 * becomes a `Content` object (readable keys, served by /api/content) plus one image file per
 * screenshot. Pure: takes the HTML string, returns content, files and a list of issues. Writing to
 * disk lives in write.ts, so every rule here is unit-testable without touching the filesystem.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Block, Content, Figure, Lesson, Question, Track } from "../../shared/engine.js";
import { ExtractError, readDataDeclarations } from "./scanner.js";

export interface Issue {
  level: "error" | "warning";
  code: string;
  message: string;
  /** Where in the source tree (e.g. `Viewer-1-2 / question 1`). */
  where?: string;
}

export interface ExtractResult {
  content: Content;
  /** File name → bytes. Only images that some lesson references. */
  files: Map<string, Buffer>;
  issues: Issue[];
  stats: { tracks: number; chapters: number; lessons: number; questions: number; images: number; inlineImages: number; bytes: number };
}

// ---------------------------------------------------------------- terse source schema

const LegacyQuestion = z.object({
  q: z.string().min(1),
  s: z.string().optional(),
  o: z.array(z.string()),
  a: z.number().int(),
  e: z.string().default(""),
  img: z.string().optional(),
});
const LegacyLesson = z.object({
  id: z.string().min(1),
  t: z.string().min(1),
  num: z.string().nullable().optional(),
  xp: z.number().int().min(0).max(1000),
  boss: z.boolean().optional(),
  b: z.array(z.object({ t: z.string(), h: z.string(), f: z.array(z.string()).default([]) })).default([]),
  q: z.array(LegacyQuestion).default([]),
});
const LegacyTracks = z
  .array(
    z.object({
      key: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "track key must be alphanumeric"),
      name: z.string().min(1),
      icon: z.string().default("book"),
      ch: z.array(z.object({ t: z.string(), num: z.string(), l: z.array(LegacyLesson) })),
    }),
  )
  .min(1);
const LegacyCaptions = z.record(z.string(), z.tuple([z.string(), z.string()]));
const LegacyImages = z.record(z.string(), z.string());

/** Lesson ids are the progress keys; `<track>-<chapter>-<n>` keeps them stable and readable. */
export const LESSON_ID = /^[A-Za-z][A-Za-z0-9]*-\d+-\d+$/;
export const IMAGE_ID = /^[A-Za-z0-9_-]+$/;

const MIME_EXT: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg" };

export interface DecodedImage {
  ext: string;
  bytes: Buffer;
}

/** data URI → bytes. Only raster formats we serve and SVG that cannot run script. */
export function decodeDataUri(uri: string): DecodedImage {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri.trim());
  if (!m) throw new ExtractError("not a base64 data URI", "bad-data-uri");
  const mime = m[1]!.toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw new ExtractError(`unsupported image type ${mime}`, "bad-mime");
  const bytes = Buffer.from(m[2]!.replace(/\s+/g, ""), "base64");
  if (!bytes.length) throw new ExtractError("empty image", "empty-image");
  if (ext === "svg") {
    // Served from our own origin: an SVG with script or event handlers is stored XSS.
    const text = bytes.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) throw new ExtractError("svg payload has no <svg> root", "bad-svg");
    if (/<script|\son[a-z]+\s*=|javascript:/i.test(text)) throw new ExtractError("svg contains script or event handlers", "unsafe-svg");
  }
  return { ext, bytes };
}

function zodIssues(err: z.ZodError, what: string): Issue[] {
  return err.issues.map((i) => ({
    level: "error" as const,
    code: "schema",
    message: `${what}: ${i.message}`,
    where: i.path.join("."),
  }));
}

/**
 * Runs the whole extraction. Throws `ExtractError` only when the page cannot be read at all
 * (declarations missing or not JSON); everything else becomes an `Issue`, so one run reports
 * every problem instead of stopping at the first.
 */
export function extractLegacy(html: string): ExtractResult {
  const raw = readDataDeclarations(html, ["TRACKS", "CAP", "IMG"]);
  const issues: Issue[] = [];
  const err = (code: string, message: string, where?: string) => issues.push({ level: "error", code, message, where });
  const warn = (code: string, message: string, where?: string) => issues.push({ level: "warning", code, message, where });

  const tracksP = LegacyTracks.safeParse(raw.TRACKS);
  const capP = LegacyCaptions.safeParse(raw.CAP);
  const imgP = LegacyImages.safeParse(raw.IMG);
  if (!tracksP.success) issues.push(...zodIssues(tracksP.error, "TRACKS"));
  if (!capP.success) issues.push(...zodIssues(capP.error, "CAP"));
  if (!imgP.success) issues.push(...zodIssues(imgP.error, "IMG"));
  const empty = { tracks: 0, chapters: 0, lessons: 0, questions: 0, images: 0, inlineImages: 0, bytes: 0 };
  if (!tracksP.success || !capP.success || !imgP.success) {
    return { content: { schema: 1, tracks: [], figures: {} }, files: new Map(), issues, stats: empty };
  }

  // ---- screenshots from IMG
  const decoded = new Map<string, DecodedImage>();
  for (const [id, uri] of Object.entries(imgP.data)) {
    if (!IMAGE_ID.test(id)) {
      err("bad-image-id", `image id "${id}" is not a safe file name`, `IMG.${id}`);
      continue;
    }
    try {
      decoded.set(id, decodeDataUri(uri));
    } catch (e) {
      err(e instanceof ExtractError ? e.code : "bad-image", `image ${id}: ${e instanceof Error ? e.message : String(e)}`, `IMG.${id}`);
    }
  }

  // ---- images pasted straight into lesson HTML: hoisted to files named by content hash
  const inline = new Map<string, DecodedImage>();
  const hoist = (html: string, where: string): string =>
    html.replace(/(<img\b[^>]*?\bsrc=)(["'])(data:[^"']+)\2/gi, (all, pre: string, q: string, uri: string) => {
      try {
        const img = decodeDataUri(uri);
        const id = `inline-${createHash("sha256").update(img.bytes).digest("hex").slice(0, 12)}`;
        inline.set(id, img);
        return `${pre}${q}img/${id}.${img.ext}${q}`;
      } catch (e) {
        err("bad-inline-image", `inline image: ${e instanceof Error ? e.message : String(e)}`, where);
        return all;
      }
    });

  // ---- lesson tree
  const used = new Set<string>();
  const seenIds = new Set<string>();
  const figureRef = (id: string, where: string) => {
    if (!decoded.has(id)) err("missing-image", `figure ${id} is referenced but has no image`, where);
    else used.add(id);
  };

  let chapters = 0;
  let questions = 0;
  const tracks: Track[] = tracksP.data.map((t) => ({
    key: t.key,
    name: t.name,
    icon: t.icon,
    chapters: t.ch.map((ch) => {
      chapters++;
      return {
        num: ch.num,
        title: ch.t,
        lessons: ch.l.map((l): Lesson => {
          if (seenIds.has(l.id)) err("duplicate-id", `lesson id ${l.id} appears twice`, l.id);
          seenIds.add(l.id);
          if (!LESSON_ID.test(l.id)) err("bad-lesson-id", `lesson id ${l.id} does not match <track>-<chapter>-<n>`, l.id);
          else if (!l.id.startsWith(`${t.key}-`)) err("bad-lesson-id", `lesson ${l.id} sits in track ${t.key}`, l.id);
          if (l.boss && l.b.length) warn("boss-with-reading", `review lesson ${l.id} has reading blocks; they are never shown`, l.id);
          if (!l.b.length && !l.q.length) err("empty-lesson", `lesson ${l.id} has neither blocks nor questions`, l.id);

          const blocks: Block[] = l.b.map((b, bi) => {
            const where = `${l.id} / block ${bi + 1}`;
            b.f.forEach((f) => figureRef(f, where));
            return { title: b.t, html: hoist(b.h, where), figures: b.f.filter((f) => decoded.has(f)) };
          });

          const qs: Question[] = l.q.map((q, qi) => {
            questions++;
            const where = `${l.id} / question ${qi + 1}`;
            if (q.o.length < 2) err("few-options", "a question needs at least two options", where);
            if (q.a < 0 || q.a >= q.o.length) err("answer-out-of-range", `answer index ${q.a} with ${q.o.length} options`, where);
            if (new Set(q.o).size !== q.o.length) warn("duplicate-option", "two options have the same text", where);
            if (q.s !== undefined && !q.s.includes("_____")) warn("cloze-without-gap", "fill-in sentence has no _____ gap", where);
            if (q.img) figureRef(q.img, where);
            return {
              prompt: q.q,
              cloze: q.s ?? null,
              options: q.o,
              answer: q.a,
              explanation: q.e,
              image: q.img && decoded.has(q.img) ? q.img : null,
            };
          });

          return { id: l.id, num: l.num ?? null, title: l.t, xp: l.xp, boss: !!l.boss, blocks, questions: qs };
        }),
      };
    }),
  }));

  // ---- figures: referenced images only, with captions
  const figures: Record<string, Figure> = {};
  const files = new Map<string, Buffer>();
  for (const id of [...used].sort()) {
    const img = decoded.get(id)!;
    const cap = capP.data[id];
    if (!cap) warn("missing-caption", `figure ${id} has no caption`, `CAP.${id}`);
    const file = `${id}.${img.ext}`;
    figures[id] = { file, num: cap?.[0] ?? "", caption: cap?.[1] ?? "" };
    files.set(file, img.bytes);
  }
  for (const id of decoded.keys()) if (!used.has(id)) warn("orphan-image", `image ${id} is not referenced by any lesson (skipped)`, `IMG.${id}`);
  for (const id of Object.keys(capP.data)) if (!imgP.data[id]) warn("orphan-caption", `caption ${id} has no image`, `CAP.${id}`);
  for (const [id, img] of inline) files.set(`${id}.${img.ext}`, img.bytes);

  let bytes = 0;
  for (const b of files.values()) bytes += b.length;
  return {
    content: { schema: 1, tracks, figures },
    files,
    issues,
    stats: {
      tracks: tracks.length,
      chapters,
      lessons: seenIds.size,
      questions,
      images: used.size,
      inlineImages: inline.size,
      bytes,
    },
  };
}

// ---------------------------------------------------------------- id stability

export interface IdDiff {
  added: string[];
  removed: string[];
  /** Removed id whose title reappears under a new id in the same track: progress would be lost. */
  suspectedRenames: { from: string; to: string; title: string }[];
}

function lessonTitles(c: Content): Map<string, { title: string; track: string }> {
  const m = new Map<string, { title: string; track: string }>();
  for (const t of c.tracks) for (const ch of t.chapters) for (const l of ch.lessons) m.set(l.id, { title: l.title, track: t.key });
  return m;
}

/**
 * Compares lesson ids with the previous extraction. Analysts' progress is keyed by lesson id, so a
 * removed id silently drops completed lessons from everyone's totals, and a renumbered id looks
 * like "removed + added". The CLI refuses to write in `--strict` mode when anything was removed.
 */
export function diffLessonIds(prev: Content | null, next: Content): IdDiff {
  const a = prev ? lessonTitles(prev) : new Map<string, { title: string; track: string }>();
  const b = lessonTitles(next);
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const suspectedRenames = removed.flatMap((from) => {
    const old = a.get(from)!;
    const to = added.find((id) => b.get(id)!.track === old.track && b.get(id)!.title.trim().toLowerCase() === old.title.trim().toLowerCase());
    return to ? [{ from, to, title: old.title }] : [];
  });
  return { added, removed, suspectedRenames };
}
