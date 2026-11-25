/** Manager dashboard: progress of every analyst, per-analyst detail, hardest questions, managers. */
import { icon } from "./icons.js";

interface TrackInfo { key: string; name: string; total: number }
interface Summary {
  username: string; name: string; lessons: number; pct: number; xp: number; level: number;
  accuracy: number | null; badges: number; byTrack: Record<string, number>; firstSeen: string; lastActivity: string;
}
interface HardQuestion { lessonId: string; track: string; lesson: string; question: number; prompt: string; attempts: number; errors: number; errorRate: number }
interface Dashboard { tracks: TrackInfo[]; totalLessons: number; analysts: Summary[]; questions: HardQuestion[] }
interface Detail {
  summary: Summary;
  completions: { lessonId: string; completedAt: string; track: string; lesson: string; num: string | null }[];
  firstTryMisses: HardQuestion[];
}
interface Manager { username: string; addedBy: string | null; addedAt: string }
interface Access { username: string; event: string; ip: string | null; at: string }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  if (r.status === 401) {
    location.href = "/login?next=/management";
    throw new Error("session expired");
  }
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

let data: Dashboard;
let sortKey: keyof Summary = "pct";
let filter = "";

function bar(pct: number): string {
  return `<span class="bar"><i style="width:${pct}%"></i></span>`;
}

function renderTable(): void {
  const rows = data.analysts
    .filter((a) => !filter || `${a.username} ${a.name}`.toLowerCase().includes(filter))
    .sort((a, b) => {
      const x = a[sortKey] ?? -1, y = b[sortKey] ?? -1;
      return typeof x === "string" ? String(y).localeCompare(x) : (y as number) - (x as number);
    });
  $("analysts").innerHTML =
    `<thead><tr><th data-s="name">Analyst</th><th data-s="pct">Track</th>${data.tracks.map((t) => `<th>${esc(t.name)}</th>`).join("")}<th data-s="xp">XP</th><th data-s="level">Level</th><th data-s="accuracy">1st-try</th><th data-s="badges">Badges</th><th data-s="lastActivity">Last activity</th></tr></thead><tbody>` +
    rows
      .map(
        (a) =>
          `<tr data-u="${esc(a.username)}"><td><strong>${esc(a.name)}</strong><small>${esc(a.username)}</small></td>` +
          `<td>${bar(a.pct)} ${a.pct}% <small>${a.lessons}/${data.totalLessons}</small></td>` +
          data.tracks.map((t) => `<td>${a.byTrack[t.key] ?? 0}/${t.total}</td>`).join("") +
          `<td>${a.xp}</td><td>${a.level}</td><td>${a.accuracy === null ? "-" : `${a.accuracy}%`}</td><td>${a.badges}</td><td>${when(a.lastActivity)}</td></tr>`,
      )
      .join("") +
    `</tbody>`;
  if (!rows.length) $("analysts").insertAdjacentHTML("beforeend", `<tbody><tr><td colspan="99" class="empty">Nobody yet.</td></tr></tbody>`);
  document.querySelectorAll<HTMLElement>("#analysts th[data-s]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.s === sortKey);
    th.onclick = () => {
      sortKey = th.dataset.s as keyof Summary;
      renderTable();
    };
  });
  document.querySelectorAll<HTMLTableRowElement>("#analysts tbody tr[data-u]").forEach((tr) => (tr.onclick = () => void showDetail(tr.dataset.u!)));
}

function questionsList(qs: HardQuestion[], empty: string): string {
  if (!qs.length) return `<p class="empty">${empty}</p>`;
  return `<ol class="questions">${qs
    .map((q) => `<li><span class="rate">${q.errorRate}%</span><div><strong>${esc(q.prompt)}</strong><small>${esc(q.track)} · ${esc(q.lesson)} · ${q.errors} of ${q.attempts} missed on the first try</small></div></li>`)
    .join("")}</ol>`;
}

async function showDetail(username: string): Promise<void> {
  const d = await api<Detail>(`/api/management/analyst/${encodeURIComponent(username)}`);
  const s = d.summary;
  $("detail").hidden = false;
  $("detail").innerHTML =
    `<header><h2>${esc(s.name)} <small>${esc(s.username)}</small></h2><button class="ghost" id="detailClose">${icon("x", 18)}</button></header>` +
    `<p class="chips"><span>${s.pct}% of the track</span><span>Level ${s.level} · ${s.xp} XP</span><span>1st-try ${s.accuracy === null ? "-" : `${s.accuracy}%`}</span><span>First seen ${when(s.firstSeen)}</span></p>` +
    `<h3>Completed lessons</h3>` +
    (d.completions.length
      ? `<ul class="completions">${d.completions.map((c) => `<li><span>${esc(c.track)} · ${c.num ? `${esc(c.num)} ` : ""}${esc(c.lesson)}</span><time>${when(c.completedAt)}</time></li>`).join("")}</ul>`
      : `<p class="empty">No lesson completed yet.</p>`) +
    `<h3>Missed on the first try</h3>${questionsList(d.firstTryMisses, "No first-try mistakes.")}`;
  $("detailClose").onclick = () => ($("detail").hidden = true);
  $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadManagers(list?: Manager[]): Promise<void> {
  const ms = list ?? (await api<Manager[]>("/api/management/managers"));
  $("managers").innerHTML = ms
    .map(
      (m) =>
        `<li><span><strong>${esc(m.username)}</strong><small>${m.addedBy === "config" ? "fixed (server config)" : `added by ${esc(m.addedBy ?? "-")} on ${when(m.addedAt)}`}</small></span>` +
        (m.addedBy === "config" ? "" : `<button class="ghost danger" data-rm="${esc(m.username)}">Remove</button>`) +
        `</li>`,
    )
    .join("");
  document.querySelectorAll<HTMLButtonElement>("[data-rm]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm(`Remove ${b.dataset.rm} from managers?`)) return;
        try {
          await loadManagers(await api<Manager[]>(`/api/management/managers/${encodeURIComponent(b.dataset.rm!)}`, { method: "DELETE" }));
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e));
        }
      }),
  );
}

async function loadAccess(): Promise<void> {
  const rows = await api<Access[]>("/api/management/access");
  $("access").innerHTML = rows.length
    ? rows.slice(0, 15).map((a) => `<li class="ev-${esc(a.event)}"><span>${esc(a.username)}</span><small>${esc(a.event.replace("_", " "))} · ${when(a.at)}</small></li>`).join("")
    : `<li class="empty">No logins yet.</li>`;
}

async function boot(): Promise<void> {
  data = await api<Dashboard>("/api/management/dashboard");
  const active = data.analysts.filter((a) => a.lessons > 0).length;
  const avg = data.analysts.length ? Math.round(data.analysts.reduce((s, a) => s + a.pct, 0) / data.analysts.length) : 0;
  const finished = data.analysts.filter((a) => a.lessons === data.totalLessons).length;
  $("kpis").innerHTML = [
    ["Analysts", String(data.analysts.length)],
    ["Started", String(active)],
    ["Finished", String(finished)],
    ["Average progress", `${avg}%`],
  ]
    .map(([k, v]) => `<div class="kpi"><small>${k}</small><strong>${v}</strong></div>`)
    .join("");
  renderTable();
  $("questions").innerHTML = questionsList(data.questions, "Not enough answers yet (a question needs at least two first-try attempts).");
  await Promise.all([loadManagers(), loadAccess()]);
}

$<HTMLInputElement>("search").oninput = (e) => {
  filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
  renderTable();
};
$<HTMLFormElement>("addManager").onsubmit = async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("newManager");
  try {
    await loadManagers(await api<Manager[]>("/api/management/managers", { method: "POST", body: JSON.stringify({ username: input.value }) }));
    input.value = "";
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
};
$("logout").onclick = async () => {
  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
  location.href = "/login";
};
document.querySelectorAll<HTMLElement>("i[data-icon]").forEach((e) => (e.outerHTML = icon(e.dataset.icon!, 16)));

boot().catch((e: unknown) => {
  $("kpis").innerHTML = `<p class="empty">Could not load the dashboard (${esc(e instanceof Error ? e.message : e)}).</p>`;
});
