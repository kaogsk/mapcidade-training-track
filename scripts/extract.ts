/**
 * Regenerates content/content.json and public/img/ from the legacy single-file page.
 *
 * Usage: npm run extract [-- path/to/legacy.html] [--strict] [--dry-run]
 *   --strict   fail when a lesson id from the previous content.json disappears
 *              (analysts' progress is keyed by lesson id)
 *   --dry-run  report only, write nothing
 * Exit code: 0 ok, 1 errors in the source, 2 strict id check failed.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffLessonIds, extractLegacy } from "../src/extract/legacy.js";
import { ExtractError } from "../src/extract/scanner.js";
import { readPreviousContent, writeExtraction } from "../src/extract/write.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const source = resolve(args.find((a) => !a.startsWith("--")) ?? resolve(root, "legacy", "legacy-track.html"));
const contentFile = resolve(root, "content", "content.json");
const imageDir = resolve(root, "public", "img");

let result;
try {
  result = extractLegacy(readFileSync(source, "utf8"));
} catch (e) {
  if (e instanceof ExtractError) {
    console.error(`extract: ${e.message} [${e.code}]`);
    process.exit(1);
  }
  throw e;
}

for (const i of result.issues) console.log(`${i.level === "error" ? "ERROR" : "warn "} ${i.code.padEnd(20)} ${i.message}${i.where ? `  (${i.where})` : ""}`);
const errors = result.issues.filter((i) => i.level === "error").length;
const s = result.stats;
console.log(
  `${s.tracks} tracks, ${s.chapters} chapters, ${s.lessons} lessons, ${s.questions} questions, ` +
    `${s.images} screenshots + ${s.inlineImages} inline image(s) (${(s.bytes / 1024).toFixed(1)} KB)`,
);
if (errors) {
  console.error(`extract: ${errors} error(s); nothing written`);
  process.exit(1);
}

const diff = diffLessonIds(readPreviousContent(contentFile), result.content);
if (diff.added.length) console.log(`lesson ids added:   ${diff.added.join(", ")}`);
if (diff.removed.length) console.log(`lesson ids REMOVED: ${diff.removed.join(", ")} (completed lessons stop counting for everyone)`);
for (const r of diff.suspectedRenames) console.log(`  looks renamed: ${r.from} -> ${r.to} ("${r.title}"); keep the old id to preserve progress`);
if (flags.has("--strict") && diff.removed.length) {
  console.error("extract: --strict and lesson ids were removed; nothing written");
  process.exit(2);
}

if (flags.has("--dry-run")) {
  console.log("dry run: nothing written");
} else {
  const w = writeExtraction(result, { contentFile, imageDir });
  console.log(`wrote ${contentFile}; images: ${w.written.length} written, ${w.unchanged} unchanged, ${w.removed.length} removed`);
}
