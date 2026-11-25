/** Writes an extraction to disk: content JSON plus the image folder, kept in sync. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Content } from "../../shared/engine.js";
import type { ExtractResult } from "./legacy.js";

const IMAGE_EXT = /\.(webp|png|jpg|svg)$/i;

export interface WriteReport {
  written: string[];
  unchanged: number;
  removed: string[];
}

export function readPreviousContent(file: string): Content | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Content;
  } catch {
    return null;
  }
}

/**
 * Pretty-printed, stable JSON (diffs of a new handbook version stay reviewable). Images are only
 * rewritten when their bytes changed, and files no lesson references any more are removed.
 */
export function writeExtraction(result: ExtractResult, opts: { contentFile: string; imageDir: string }): WriteReport {
  if (result.issues.some((i) => i.level === "error")) throw new Error("refusing to write an extraction that has errors");
  mkdirSync(dirname(opts.contentFile), { recursive: true });
  mkdirSync(opts.imageDir, { recursive: true });

  const report: WriteReport = { written: [], unchanged: 0, removed: [] };
  for (const f of readdirSync(opts.imageDir)) {
    if (IMAGE_EXT.test(f) && !result.files.has(f)) {
      rmSync(resolve(opts.imageDir, f));
      report.removed.push(f);
    }
  }
  for (const [name, bytes] of result.files) {
    const path = resolve(opts.imageDir, name);
    if (existsSync(path) && readFileSync(path).equals(bytes)) {
      report.unchanged++;
      continue;
    }
    writeFileSync(path, bytes);
    report.written.push(name);
  }
  writeFileSync(opts.contentFile, `${JSON.stringify(result.content, null, 2)}\n`);
  return report;
}
