/**
 * Training track UI. All scoring rules live in shared/engine.ts; this file only renders and
 * wires clicks. Content comes from /api/content, screenshots from /img/, and progress is saved per
 * analyst on the server (it used to live in the browser's localStorage).
 */
import {
  type Content,
  type ContentIndex,
  type Lesson,
  type LessonRun,
  type ProgressState,
  accuracy,
  advance,
  badgeCatalog,
  finishLesson,
  indexContent,
  initialState,
  isUnlocked,
  levelProgress,
  overallCompletion,
  pick,
  resetState,
  startRun,
  trackCompletion,
} from "../shared/engine.js";
import { icon } from "./icons.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let toastTimer: number | undefined;
function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------- API

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  if (r.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("session expired");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return (await r.json()) as T;
}

// Debounced save: a burst of answers becomes a single PUT.
let S: ProgressState = initialState();
let saveTimer: number | undefined;
let pending = false;
function save(): void {
  pending = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 600);
}
async function flush(): Promise<void> {
  if (!pending) return;
  pending = false;
  try {
    await api("/api/progress", { method: "PUT", body: JSON.stringify(S) });
  } catch (e) {
    pending = true;
    console.warn(e);
    toast("Could not save your progress right now; retrying shortly");
    saveTimer = window.setTimeout(flush, 5000);
  }
}
// Tab closed with unsaved progress: sendBeacon still delivers it.
addEventListener("pagehide", () => {
  if (!pending) return;
  navigator.sendBeacon("/api/progress", new Blob([JSON.stringify(S)], { type: "application/json" }));
  pending = false;
});

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  const [content, progress, me] = await Promise.all([
    api<Content>("/api/content"),
    api<{ state: ProgressState | null }>("/api/progress"),
    api<{ username: string; name: string; manager: boolean }>("/auth/me"),
  ]);
  S = progress.state ? { ...initialState(), ...progress.state } : initialState(content.tracks[0]?.key ?? "");
  $("userName").textContent = me.name;
  $("userName").title = me.username;
  $("managementLink").hidden = !me.manager;
  mount(indexContent(content));
}

function mount(idx: ContentIndex): void {
  const { content } = idx;
  const catalog = badgeCatalog(idx);
  const figure = (id: string) => {
    const f = content.figures[id];
    if (!f) return "";
    return `<figure><img src="/img/${encodeURIComponent(f.file)}" alt="${esc(f.caption)}" loading="lazy"><figcaption>Figure ${esc(f.num)}: ${esc(f.caption)}</figcaption></figure>`;
  };

  const go = (key: string) => {
    S = { ...S, tab: key };
    save();
    render();
  };

  function render(): void {
    const track = content.tracks.find((t) => t.key === S.tab) ?? content.tracks[0]!;
    const lv = levelProgress(S.xp);
    const all = overallCompletion(idx, S);
    const here = trackCompletion(idx, S, track.key);
    const acc = accuracy(S);
    const earned = catalog.filter((b) => S.badges[b.id]);

    $("hXp").textContent = String(S.xp);
    $("hLevel").textContent = String(lv.level);
    $("hStreak").textContent = String(S.streak);
    $("hBadges").textContent = `${earned.length}/${catalog.length}`;
    $("kLessons").textContent = `${all.done}/${all.total}`;
    $("kTrack").textContent = `${here.pct}%`;
    $("kTrackBar").style.width = `${here.pct}%`;
    $("kAcc").textContent = acc === null ? "-" : `${acc}%`;
    $("kNext").textContent = `${lv.toNext} XP`;
    $("kLevelBar").style.width = `${lv.pct}%`;
    $("kStreakBest").textContent = String(S.best);

    $("tabs").innerHTML = content.tracks
      .map((t) => {
        const c = trackCompletion(idx, S, t.key);
        return `<button class="tab${t.key === track.key ? " on" : ""}${c.done === c.total ? " full" : ""}" role="tab" aria-selected="${t.key === track.key}" data-k="${esc(t.key)}">${icon(t.icon)}<span>${esc(t.name)}</span><small>${c.done}/${c.total}</small></button>`;
      })
      .join("");
    document.querySelectorAll<HTMLButtonElement>(".tab").forEach((b) => (b.onclick = () => go(b.dataset.k!)));

    $("trackTitle").innerHTML = `${icon(track.icon, 22)} ${esc(track.name)}`;
    $("trail").innerHTML = track.chapters
      .map((ch) => {
        const d = ch.lessons.filter((l) => S.done[l.id]).length;
        const nodes = ch.lessons
          .map((l) => {
            const st = S.done[l.id] ? "done" : isUnlocked(idx, S, l.id) ? "open" : "locked";
            const inner = st === "locked" ? icon("lock", 22) : st === "done" ? icon("check", 24) : l.boss ? icon("trophy", 24) : `<span class="num">${esc(l.num ?? ch.num)}</span>`;
            return `<button class="node ${st}${l.boss ? " boss" : ""}" data-id="${esc(l.id)}" aria-label="${esc(l.title)} (${st})"><span class="disc">${inner}</span><small>${esc(l.title)}<br><b>+${l.xp} XP</b></small></button>`;
          })
          .join("");
        return `<section class="unit"><header><h3>${esc(ch.num)}. ${esc(ch.title)}</h3><span>${d}/${ch.lessons.length}</span></header><div class="path">${nodes}</div></section>`;
      })
      .join("");
    document.querySelectorAll<HTMLButtonElement>(".node").forEach(
      (b) =>
        (b.onclick = () => {
          const id = b.dataset.id!;
          if (!isUnlocked(idx, S, id)) return toast("Finish the previous lesson of this track first, or unlock all lessons");
          openLesson(idx.lessons.get(id)!.lesson);
        }),
    );

    $("skills").innerHTML = content.tracks
      .map((t) => {
        const c = trackCompletion(idx, S, t.key);
        return `<button class="skill${t.key === track.key ? " on" : ""}" data-k="${esc(t.key)}">${icon(t.icon, 16)}<span>${esc(t.name)}</span><span class="bar"><i style="width:${c.pct}%"></i></span><b>${c.pct}%</b></button>`;
      })
      .join("");
    document.querySelectorAll<HTMLButtonElement>(".skill").forEach((b) => (b.onclick = () => go(b.dataset.k!)));
    $("overall").textContent = `${all.pct}% overall`;

    $("badges").innerHTML = catalog
      .map((b) => `<li class="badge${S.badges[b.id] ? " on" : ""}"><span class="ic">${icon(b.icon, 20)}</span><div><strong>${esc(b.title)}</strong><small>${esc(b.description)}</small></div></li>`)
      .join("");

    const sw = $("lockSwitch");
    sw.setAttribute("aria-checked", String(!S.lock));
    sw.classList.toggle("on", !S.lock);
    $("lockText").textContent = S.lock ? "Lessons unlock in order" : "Every lesson is open";
  }

  // ---------------------------------------------------------------- lesson overlay
  let lesson: Lesson;
  let run: LessonRun;
  const next = $<HTMLButtonElement>("lessonNext");
  const steps = () => lesson.questions.length + (lesson.boss ? 0 : 1);
  const setBar = (k: number) => {
    $("lessonBar").style.width = `${(k / steps()) * 100}%`;
    $("lessonStep").textContent = `${k}/${steps()}`;
  };

  function openLesson(l: Lesson): void {
    lesson = l;
    run = startRun(l, S);
    $("overlay").classList.add("show");
    document.body.style.overflow = "hidden";
    if (run.question === -1) showReading();
    else showQuestion();
  }
  function closeLesson(): void {
    $("overlay").classList.remove("show");
    document.body.style.overflow = "";
    render();
  }

  function showReading(): void {
    setBar(0);
    const ref = idx.lessons.get(lesson.id)!;
    $("lessonBody").innerHTML =
      `<p class="kicker">${esc(ref.track.name)}${lesson.num ? ` · section ${esc(lesson.num)}` : ""}</p><h2>${esc(lesson.title)}</h2>` +
      lesson.blocks
        .map((b, i) => `<details${i === 0 ? " open" : ""}><summary>${esc(b.title)}</summary><div class="block">${b.html}${b.figures.map(figure).join("")}</div></details>`)
        .join("");
    $("lessonInfo").textContent = lesson.questions.length ? "Read, then take the challenge" : "";
    next.disabled = false;
    next.textContent = lesson.questions.length ? "Start the challenge" : "Finish lesson";
    next.onclick = step;
    zoomable();
  }

  function step(): void {
    const r = advance(run, lesson);
    run = r.run;
    if (r.finished) finish();
    else showQuestion();
  }

  function showQuestion(): void {
    const q = lesson.questions[run.question]!;
    setBar(run.question + 1);
    $("lessonBody").innerHTML =
      (lesson.boss && run.question === 0 ? `<h2>${esc(lesson.title)}</h2><p class="lead">Chapter review: no reading, just questions.</p>` : "") +
      `<p class="kicker">Challenge ${run.question + 1} of ${lesson.questions.length}</p><p class="prompt">${esc(q.prompt)}</p>` +
      (q.cloze ? `<blockquote class="cloze">${esc(q.cloze).replace("_____", '<span class="gap">?</span>')}</blockquote>` : "") +
      (q.image ? figure(q.image) : "") +
      q.options.map((o, i) => `<button class="option" data-i="${i}">${esc(o)}</button>`).join("") +
      `<div class="feedback" id="feedback" role="status"></div>`;
    $("lessonInfo").textContent = "+10 XP for a first-try answer";
    next.disabled = true;
    next.textContent = "Continue";
    next.onclick = step;
    document.querySelectorAll<HTMLButtonElement>(".option").forEach((o) => (o.onclick = () => choose(Number(o.dataset.i), o)));
    zoomable();
  }

  function choose(option: number, el: HTMLButtonElement): void {
    const q = lesson.questions[run.question]!;
    const r = pick(run, S, lesson, option);
    if (r.run === run) return; // no-op (already answered / already tried)
    // Recorded server-side for the dashboard; the server checks correctness itself. Failure here
    // must not block the lesson.
    fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId: lesson.id, question: run.question, option, firstTry: r.wasFirstTry && !r.review }),
    }).catch(() => undefined);
    run = r.run;
    S = r.state;
    const fb = $("feedback");
    if (r.correct) {
      el.classList.add("ok");
      fb.className = "feedback ok";
      fb.innerHTML = `<strong>Right!</strong> ${esc(q.explanation)}${r.xpGained ? ` <b>+${r.xpGained} XP</b>` : ""}`;
      next.disabled = false;
      document.querySelectorAll<HTMLButtonElement>(".option").forEach((o) => (o.disabled = true));
    } else {
      el.classList.add("no");
      el.disabled = true;
      fb.className = "feedback no";
      fb.innerHTML = "<strong>Not quite.</strong> Try another option; the answer is in the lesson.";
    }
    save();
    render();
  }

  function finish(): void {
    const r = finishLesson(S, run, idx);
    S = r.state;
    setBar(steps());
    $("lessonBody").innerHTML =
      `<div class="win">${icon("star", 72)}<h2>${r.alreadyDone ? "Review complete" : "Lesson complete!"}</h2>` +
      `<p class="lead">${r.alreadyDone ? "You had already finished this one: good review." : `+${r.xpGained} XP completion bonus`}${r.perfect ? " · no mistakes!" : ""}</p></div>`;
    $("lessonInfo").textContent = "";
    next.disabled = false;
    next.textContent = "Back to the track";
    next.onclick = closeLesson;
    if (r.levelUp) setTimeout(() => toast(`Level up: you reached level ${r.levelUp!.to}!`), 300);
    r.newBadges.forEach((b, k) => setTimeout(() => toast(`Badge unlocked: ${b.title}`), 1500 + k * 2200));
    save();
    render();
  }

  function zoomable(): void {
    document.querySelectorAll<HTMLImageElement>("#lessonBody figure img").forEach(
      (im) =>
        (im.onclick = () => {
          $("lightbox").querySelector("img")!.src = im.src;
          $("lightbox").classList.add("show");
        }),
    );
  }

  // ---------------------------------------------------------------- controls
  $("lightbox").onclick = () => $("lightbox").classList.remove("show");
  $("lessonClose").onclick = closeLesson;
  $("lessonClose").innerHTML = icon("x", 20);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("lightbox").classList.contains("show")) $("lightbox").classList.remove("show");
    else if ($("overlay").classList.contains("show")) closeLesson();
  });
  $("reset").onclick = () => {
    if (!confirm("Erase all your progress on the track?")) return;
    S = resetState(S);
    save();
    render();
  };
  $("lockSwitch").onclick = () => {
    S = { ...S, lock: !S.lock };
    save();
    render();
    toast(S.lock ? "Lessons now unlock in order" : "All lessons unlocked");
  };
  render();
}

// ---------------------------------------------------------------- theme, session

const root = document.documentElement;
function syncTheme(): void {
  const dark = root.dataset.theme === "dark";
  $("theme").innerHTML = icon(dark ? "sun" : "moon", 18);
  $("theme").title = dark ? "Light mode" : "Dark mode";
}
$("theme").onclick = () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("training-theme", root.dataset.theme);
  } catch {
    /* storage unavailable */
  }
  syncTheme();
};
$("logout").onclick = async () => {
  await flush();
  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
  location.href = "/login";
};
document.querySelectorAll<HTMLElement>("i[data-icon]").forEach((e) => (e.outerHTML = icon(e.dataset.icon!, 16)));
syncTheme();

boot().catch((e: unknown) => {
  console.error(e);
  $("trail").innerHTML = `<p class="loading">Could not load the track (${esc(e instanceof Error ? e.message : e)}). Reload the page.</p>`;
});
