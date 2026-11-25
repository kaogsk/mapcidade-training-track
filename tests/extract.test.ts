import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeDataUri, diffLessonIds, extractLegacy } from "../src/extract/legacy.js";
import { ExtractError, findDeclarations, inlineScripts, readDataDeclarations, readJsonLiteral } from "../src/extract/scanner.js";
import { writeExtraction } from "../src/extract/write.js";
import { parseContent } from "../src/content.js";
import { legacyHtml, realContent } from "./helpers.js";

const svg = (body = "<rect width='1' height='1'/>") => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`).toString("base64")}`;
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64")}`;

interface Src {
  tracks?: unknown;
  cap?: unknown;
  img?: unknown;
}
const baseTracks = () => [
  {
    key: "T",
    name: "Track",
    icon: "map",
    ch: [
      {
        t: "Ch",
        num: "1",
        l: [
          { id: "T-1-1", t: "One", num: "1.1", xp: 10, b: [{ t: "b", h: "<p>x</p>", f: ["T_1"] }], q: [{ q: "?", o: ["a", "b"], a: 0, e: "" }] },
          { id: "T-1-2", t: "Two", num: "1.2", xp: 10, b: [{ t: "b", h: "<p>y</p>", f: [] }], q: [] },
        ],
      },
    ],
  },
];
function page({ tracks = baseTracks(), cap = { T_1: ["1", "cap"] }, img = { T_1: svg() } }: Src = {}): string {
  return `<html><script>const TRACKS=${JSON.stringify(tracks)};const CAP=${JSON.stringify(cap)};const IMG=${JSON.stringify(img)};</script></html>`;
}
const codes = (r: ReturnType<typeof extractLegacy>, level?: "error" | "warning") =>
  r.issues.filter((i) => !level || i.level === level).map((i) => i.code);

describe("scanner", () => {
  it("reads balanced JSON, ignoring brackets inside strings", () => {
    const src = `x=[1,"]}[{",{"a":"\\"]"}];rest`;
    expect(src.slice(2, readJsonLiteral(src, 2))).toBe(`[1,"]}[{",{"a":"\\"]"}]`);
    expect(() => readJsonLiteral("[1,2", 0)).toThrow(ExtractError);
  });

  it("finds declarations in code position only (not in strings, comments, regex or templates)", () => {
    const src = [
      `// const A=[1]`,
      `/* const A=[2] */`,
      `const S="const A=[3]";`,
      "const T=`const A=[4]`;",
      `const R=/const A=["']/g;`,
      `const A=[5,"const B={}"];const B={"k":"v"};`,
    ].join("\n");
    const d = findDeclarations(src);
    expect(JSON.parse(d.get("A")!.raw)).toEqual([5, "const B={}"]);
    expect(JSON.parse(d.get("B")!.raw)).toEqual({ k: "v" });
    expect(d.has("S")).toBe(false); // string values are not data declarations
  });

  it("a lesson text containing ';const CAP=' does not cut the data (the indexOf bug)", () => {
    const tracks = baseTracks();
    tracks[0]!.ch[0]!.l[0]!.t = 'Data line looks like ...];const CAP={"x":1}';
    const r = extractLegacy(page({ tracks }));
    expect(codes(r, "error")).toEqual([]);
    expect(r.content.tracks[0]!.chapters[0]!.lessons[0]!.title).toContain(";const CAP=");
    expect(r.content.figures.T_1!.caption).toBe("cap");
  });

  it("regex literals with quotes do not derail the scan; division is not a regex", () => {
    const src = `const esc=(s)=>s.replace(/[&<>"]/g,"");const n=a/2/3;const D={"ok":true};`;
    expect(JSON.parse(findDeclarations(src).get("D")!.raw)).toEqual({ ok: true });
  });

  it("skips <script src> tags and searches every inline script", () => {
    const html = `<script src="x.js">const TRACKS=[]</script><script>const TRACKS=[1]</script><script>const CAP={}</script>`;
    expect(inlineScripts(html)).toHaveLength(2);
    expect(readDataDeclarations(html, ["TRACKS", "CAP"])).toEqual({ TRACKS: [1], CAP: {} });
  });

  it("reports missing declarations and invalid JSON as fatal", () => {
    expect(() => readDataDeclarations("<script>const TRACKS=[]</script>", ["TRACKS", "IMG"])).toThrow(/const IMG=/);
    expect(() => readDataDeclarations("<script>const TRACKS=[1,]</script>", ["TRACKS"])).toThrow(/not valid JSON/);
  });
});

describe("data URIs", () => {
  it("decodes png and svg, rejects unknown types and scripted svg", () => {
    expect(decodeDataUri(PNG).ext).toBe("png");
    expect(decodeDataUri(svg()).ext).toBe("svg");
    expect(() => decodeDataUri("data:image/gif;base64,R0lG")).toThrow(/unsupported/);
    expect(() => decodeDataUri("http://example.invalid/a.png")).toThrow(/data URI/);
    expect(() => decodeDataUri(svg("<script>alert(1)</script>"))).toThrow(/script/);
    expect(() => decodeDataUri(svg('<rect onload="x()"/>'))).toThrow(/event handlers/);
  });
});

describe("extractLegacy on the synthetic legacy page", () => {
  const r = extractLegacy(legacyHtml());

  it("extracts every track, lesson and question without errors", () => {
    expect(codes(r, "error")).toEqual([]);
    expect(r.stats).toMatchObject({ tracks: 3, chapters: 5, lessons: 15, questions: 23, images: 10, inlineImages: 1 });
    expect(r.content.tracks.map((t) => t.key)).toEqual(["Viewer", "Edit", "Admin"]);
  });

  it("maps terse keys to the readable schema the app validates", () => {
    const parsed = parseContent(JSON.stringify(r.content));
    const q = parsed.lessons.get("Viewer-1-2")!.lesson.questions[0]!;
    expect(q.cloze).toContain("_____");
    expect(parsed.lessons.get("Viewer-2-3")!.lesson.boss).toBe(true);
    expect(parsed.lessons.get("Viewer-1-3")!.lesson.questions[0]!.image).toBe("Viewer_3");
  });

  it("hoists an image pasted into lesson HTML into a content-addressed file", () => {
    const html = r.content.tracks[1]!.chapters[1]!.lessons[0]!.blocks[1]!.html;
    expect(html).not.toContain("data:");
    const m = /src="img\/(inline-[0-9a-f]{12}\.svg)"/.exec(html);
    expect(m).not.toBeNull();
    expect(r.files.has(m![1]!)).toBe(true);
  });

  it("skips the unreferenced screenshot with a warning", () => {
    expect(r.issues).toContainEqual(expect.objectContaining({ level: "warning", code: "orphan-image", where: "IMG.Viewer_99" }));
    expect(r.content.figures.Viewer_99).toBeUndefined();
    expect([...r.files.keys()].some((f) => f.startsWith("Viewer_99"))).toBe(false);
  });

  it("matches the committed content.json byte for byte (the build is reproducible)", () => {
    expect(JSON.parse(JSON.stringify(r.content))).toEqual(realContent().content);
  });
});

describe("extractLegacy validation", () => {
  it("figure without image is an error; caption without image is a warning", () => {
    const r = extractLegacy(page({ img: {}, cap: { T_1: ["1", "c"] } }));
    expect(codes(r, "error")).toContain("missing-image");
    expect(codes(r, "warning")).toContain("orphan-caption");
  });

  it("missing caption is a warning and leaves an empty caption", () => {
    const r = extractLegacy(page({ cap: {} }));
    expect(codes(r, "error")).toEqual([]);
    expect(codes(r, "warning")).toContain("missing-caption");
    expect(r.content.figures.T_1).toEqual({ file: "T_1.svg", num: "", caption: "" });
  });

  it("answer index out of range, too few options, duplicate and malformed ids", () => {
    const tracks = baseTracks();
    const ls = tracks[0]!.ch[0]!.l as Record<string, unknown>[];
    ls[0]!.q = [{ q: "?", o: ["only"], a: 3, e: "" }];
    ls[1]!.id = "T-1-1";
    ls.push({ id: "Other-1-3", t: "x", num: null, xp: 1, b: [{ t: "b", h: "", f: [] }], q: [] });
    ls.push({ id: "bad id", t: "x", num: null, xp: 1, b: [{ t: "b", h: "", f: [] }], q: [] });
    const r = extractLegacy(page({ tracks }));
    expect(codes(r, "error")).toEqual(expect.arrayContaining(["answer-out-of-range", "few-options", "duplicate-id", "bad-lesson-id"]));
    expect(r.issues.filter((i) => i.code === "bad-lesson-id")).toHaveLength(2);
  });

  it("schema errors come back as issues with a path", () => {
    const r = extractLegacy(page({ tracks: [{ key: "T", name: "x", ch: [{ t: "c", num: "1", l: [{ id: "T-1-1", t: "x", xp: "ten" }] }] }] }));
    expect(r.issues[0]).toMatchObject({ level: "error", code: "schema", where: "0.ch.0.l.0.xp" });
  });

  it("unsafe or unknown images become errors, not files", () => {
    const r = extractLegacy(page({ img: { T_1: svg("<script>x</script>"), "../evil": PNG } }));
    expect(codes(r, "error")).toEqual(expect.arrayContaining(["unsafe-svg", "bad-image-id", "missing-image"]));
    expect(r.files.size).toBe(0);
  });

  it("identical inline images are stored once", () => {
    const tracks = baseTracks();
    const l = tracks[0]!.ch[0]!.l[1]!;
    l.b = [{ t: "b", h: `<img src="${PNG}"><img alt="again" src='${PNG}'>`, f: [] }];
    const r = extractLegacy(page({ tracks }));
    expect(r.stats.inlineImages).toBe(1);
    expect(r.content.tracks[0]!.chapters[0]!.lessons[1]!.blocks[0]!.html.match(/img\/inline-/g)).toHaveLength(2);
  });
});

describe("lesson id stability", () => {
  const c = realContent().content;

  it("first extraction: everything is added", () => {
    expect(diffLessonIds(null, c).added).toHaveLength(15);
  });

  it("flags removed ids and suspects renumbering by title", () => {
    const next = structuredClone(c);
    next.tracks[0]!.chapters[0]!.lessons[0]!.id = "Viewer-1-9";
    next.tracks[2]!.chapters[0]!.lessons.pop();
    const d = diffLessonIds(c, next);
    expect(d.removed.sort()).toEqual(["Admin-5-4", "Viewer-1-1"]);
    expect(d.added).toEqual(["Viewer-1-9"]);
    expect(d.suspectedRenames).toEqual([{ from: "Viewer-1-1", to: "Viewer-1-9", title: "The workspace at a glance" }]);
  });
});

describe("writeExtraction", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("writes content and images, removes stale files, leaves unchanged images alone", () => {
    dir = mkdtempSync(join(tmpdir(), "extract-"));
    const imageDir = join(dir, "img");
    const contentFile = join(dir, "content.json");
    const r = extractLegacy(page());
    expect(writeExtraction(r, { contentFile, imageDir })).toEqual({ written: ["T_1.svg"], unchanged: 0, removed: [] });

    writeFileSync(join(imageDir, "Old_1.webp"), "x");
    writeFileSync(join(imageDir, "notes.txt"), "kept: not an image");
    expect(writeExtraction(r, { contentFile, imageDir })).toEqual({ written: [], unchanged: 1, removed: ["Old_1.webp"] });
    expect(readdirSync(imageDir).sort()).toEqual(["T_1.svg", "notes.txt"]);
    expect(JSON.parse(readFileSync(contentFile, "utf8")).tracks[0].key).toBe("T");
  });

  it("refuses to write a result with errors", () => {
    dir = mkdtempSync(join(tmpdir(), "extract-"));
    const r = extractLegacy(page({ img: {} }));
    expect(() => writeExtraction(r, { contentFile: join(dir, "c.json"), imageDir: join(dir, "img") })).toThrow(/errors/);
    expect(existsSync(join(dir, "c.json"))).toBe(false);
  });
});
