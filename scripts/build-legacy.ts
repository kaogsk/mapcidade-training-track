/**
 * Builds legacy/legacy-track.html: a synthetic stand-in for the original single-file training
 * page (inline CSS, one minified data line with every lesson and every screenshot as a data URI,
 * then the app code). Only the extractor reads it.
 *
 * Usage: npm run legacy:build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGES, INLINE_IMAGE, INLINE_PLACEHOLDER, TRACKS, mockSvg } from "./legacy-source.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

const inline = dataUri(mockSvg(INLINE_IMAGE));
const tracks = JSON.stringify(TRACKS).split(INLINE_PLACEHOLDER).join(inline);
const cap = JSON.stringify(Object.fromEntries(Object.entries(IMAGES).map(([id, v]) => [id, v.caption])));
const img = JSON.stringify(Object.fromEntries(Object.entries(IMAGES).map(([id, v]) => [id, dataUri(mockSvg(v.mock))])));

// The app code mimics what sat next to the data in the original: comments, strings and regex
// literals that mention the same declaration names (a naive indexOf-based extractor trips on them).
const appCode = String.raw`
// Data format reminder: const IMG={id:dataUri}
const HELP="The data line holds const TRACKS=[...];const CAP={...};const IMG={...}";
const KEY="training-track-v2";
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const lvlOf=(xp)=>Math.floor(xp/150)+1;
let S=JSON.parse(localStorage.getItem(KEY)||"null")||{xp:0,done:{},badges:{}};
function save(){localStorage.setItem(KEY,JSON.stringify(S));}
function render(){document.getElementById("app").innerHTML=TRACKS.map((t)=>"<h2>"+esc(t.name)+"</h2>").join("")+"<p>Level "+lvlOf(S.xp)+"</p>";}
render();
`;

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MapCidade training track (legacy single-file build)</title>
<style>
:root{--ink:#1d2433;--accent:#2f80ed}body{font-family:system-ui,sans-serif;color:var(--ink);margin:0}
#app{max-width:900px;margin:0 auto;padding:24px}h2{color:var(--accent)}
</style>
</head><body>
<div id="app"></div>
<script src="https://cdn.example.invalid/analytics.js"></script>
<script>
const TRACKS=${tracks};const CAP=${cap};const IMG=${img};
${appCode}</script>
</body></html>
`;

const out = resolve(root, "legacy", "legacy-track.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB, ${Object.keys(IMAGES).length + 1} embedded images)`);
