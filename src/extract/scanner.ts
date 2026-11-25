/**
 * Finds top-level `const NAME = <JSON literal>` declarations inside inline JavaScript.
 *
 * The first version of the real extractor did `line.indexOf(";const CAP=")` on the data line.
 * That works until a lesson's text (or a comment, or a help string) contains that same sequence,
 * and then it silently cuts the JSON in the wrong place. This scanner walks the source once,
 * skipping string literals, template literals, comments and regex literals, so a declaration is
 * only recognised in code position, and reads the value as a balanced JSON literal.
 */

export class ExtractError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

export interface Declaration {
  name: string;
  /** Offset of the value's first character (`[` or `{`). */
  start: number;
  /** Offset just past the value. */
  end: number;
  raw: string;
}

/** Inline `<script>` bodies (scripts with `src=` are skipped: they carry no data). */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) if (!/\bsrc\s*=/i.test(m[1] ?? "")) out.push(m[2] ?? "");
  return out;
}

const IDENT = /[A-Za-z0-9_$]/;
/** After these characters a `/` starts a regex literal, not a division. */
const REGEX_PREV = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

function skipString(src: string, i: number): number {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === q) return j + 1;
    else if (q !== "`" && c === "\n") return j; // unterminated: give up at end of line
  }
  return src.length;
}

function skipRegex(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j]!)) j++; // flags
      return j;
    } else if (c === "\n") return j;
  }
  return src.length;
}

/** Last non-space character before `i`, used to tell regex literals from division. */
function prevSignificant(src: string, i: number): string {
  for (let j = i - 1; j >= 0; j--) if (!/\s/.test(src[j]!)) return src[j]!;
  return "";
}

/**
 * Reads one JSON value starting at `start` (`[` or `{`) and returns the offset just past it.
 * Strings are skipped with their escapes, so brackets inside text do not count.
 */
export function readJsonLiteral(src: string, start: number): number {
  const open = src[start];
  if (open !== "[" && open !== "{") throw new ExtractError(`expected [ or { at offset ${start}`, "not-json");
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i = skipString(src, i) - 1;
    } else if (c === "[" || c === "{") {
      depth++;
    } else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new ExtractError(`unbalanced JSON literal starting at offset ${start}`, "unbalanced");
}

/**
 * Scans `src` for `const NAME=[...]` / `const NAME={...}` in code position. Stops early once every
 * name in `wanted` was found (the data line comes first in practice, and the app code after it is
 * the part most likely to confuse a hand-rolled scanner).
 */
export function findDeclarations(src: string, wanted?: string[]): Map<string, Declaration> {
  const found = new Map<string, Declaration>();
  const decl = /const\s+([A-Za-z_$][\w$]*)\s*=\s*/y;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
    } else if (c === "/" && n === "/") {
      const e = src.indexOf("\n", i);
      i = e < 0 ? src.length : e + 1;
    } else if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
    } else if (c === "/" && REGEX_PREV.has(prevSignificant(src, i))) {
      i = skipRegex(src, i);
    } else if (c === "c" && (i === 0 || !IDENT.test(src[i - 1]!))) {
      decl.lastIndex = i;
      const m = decl.exec(src);
      if (!m) {
        i++;
        continue;
      }
      const name = m[1]!;
      const start = decl.lastIndex;
      if ((src[start] === "[" || src[start] === "{") && (!wanted || wanted.includes(name)) && !found.has(name)) {
        const end = readJsonLiteral(src, start);
        found.set(name, { name, start, end, raw: src.slice(start, end) });
        if (wanted && wanted.every((w) => found.has(w))) break;
        i = end;
      } else {
        i = start;
      }
    } else {
      i++;
    }
  }
  return found;
}

/** Finds and JSON-parses the wanted declarations across every inline script of the page. */
export function readDataDeclarations(html: string, wanted: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const script of inlineScripts(html)) {
    const missing = wanted.filter((w) => !(w in out));
    if (!missing.length) break;
    for (const [name, d] of findDeclarations(script, missing)) {
      try {
        out[name] = JSON.parse(d.raw);
      } catch (e) {
        throw new ExtractError(`const ${name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, "bad-json");
      }
    }
  }
  const missing = wanted.filter((w) => !(w in out));
  if (missing.length) throw new ExtractError(`declaration(s) not found: ${missing.map((m) => `const ${m}=`).join(", ")}`, "missing-declaration");
  return out;
}
