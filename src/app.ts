/**
 * HTTP surface. Everything sits behind the session gate except the login page and /api/health.
 *   GET  /login · POST /auth/login · POST /auth/logout · GET /auth/me
 *   GET  /api/content                   tracks, lessons, questions, figures
 *   GET  /api/progress                  the logged-in analyst's state (or null)
 *   PUT  /api/progress                  saves the state (POST too, for sendBeacon on tab close)
 *   POST /api/answer                    each challenge answer; the server decides if it was right
 *   GET  /img/<file>                    screenshots
 * Managers only:
 *   GET  /management                    dashboard page
 *   GET  /api/management/dashboard      every analyst + hardest questions
 *   GET  /api/management/export.csv     same, as CSV
 *   GET  /api/management/analyst/:u     one analyst's detail
 *   GET  /api/management/access         recent logins / refused logins
 *   GET|POST /api/management/managers · DELETE /api/management/managers/:u
 */
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { sanitizeState } from "../shared/engine.js";
import type { Auth, Session } from "./auth/index.js";
import { projectRoot } from "./config.js";
import type { LoadedContent } from "./content.js";
import { analystDetail, dashboard, dashboardCsv } from "./management.js";
import { AnswerSchema, StateSchema, USERNAME, userKey } from "./progress.js";
import type { Store } from "./store.js";

const session = (res: Response) => res.locals.user as Session;

export interface AppOptions {
  publicDir?: string;
  log?: (msg: string) => void;
}

export function createApp(auth: Auth, content: LoadedContent, store: Store, opts: AppOptions = {}) {
  const publicDir = opts.publicDir ?? resolve(projectRoot, "public");
  const log = opts.log ?? ((m: string) => console.warn(`[training] ${m}`));
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "128kb" }));

  // The gate runs BEFORE every route, static files included; public paths are listed in EXEMPT.
  app.use((req, res, next) => auth.requireSession(req, res, next));

  const managerOnly = (req: Request, res: Response, next: NextFunction) => {
    store.isManager(session(res).username).then((ok) => {
      if (ok) return next();
      if (String(req.headers.accept ?? "").includes("text/html")) return res.redirect(302, "/");
      res.status(403).json({ ok: false, error: "Managers only" });
    }, next);
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, lessons: content.total });
  });

  app.get("/login", (req, res) => {
    if (auth.sessionOf(req)) return res.redirect(302, "/");
    res.sendFile(resolve(publicDir, "login.html"));
  });

  app.post("/auth/login", async (req, res) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const r = await auth.login({ username, password }, { ip: req.ip ?? null });
    const ok = r.status === 200 && typeof r.body.username === "string";
    // The access history must never break a login.
    try {
      if (ok) await store.touchUser(r.body.username as string, String(r.body.name ?? r.body.username));
      if (r.status === 200 || r.status === 401 || r.status === 429) {
        await store.recordAccess(ok ? (r.body.username as string) : username || "-", ok ? "login" : "login_refused", req.ip ?? null);
      }
    } catch (e) {
      log(`access history: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.setCookie) res.setHeader("Set-Cookie", r.setCookie);
    if (typeof r.body.retryAfterSeconds === "number") res.setHeader("Retry-After", String(r.body.retryAfterSeconds));
    res.status(r.status).json(r.body);
  });

  app.post("/auth/logout", async (req, res) => {
    await store.recordAccess(session(res).username, "logout", req.ip ?? null).catch(() => undefined);
    res.setHeader("Set-Cookie", auth.logoutCookie());
    res.json({ ok: true });
  });

  app.get("/auth/me", async (_req, res) => {
    const s = session(res);
    res.json({ ...s, manager: await store.isManager(s.username) });
  });

  app.get("/api/content", (_req, res) => {
    res.setHeader("Cache-Control", "private, no-cache");
    res.type("json").send(content.json);
  });

  app.get("/api/progress", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const s = session(res);
    await store.touchUser(s.username, s.name);
    const r = await store.readProgress(s.username);
    res.json({ state: r?.state ?? null, updatedAt: r?.updatedAt ?? null });
  });

  const save = async (req: Request, res: Response) => {
    const p = StateSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ ok: false, error: "invalid progress" });
    // The client is trusted for its own score (it is a training tool, not an exam), but not
    // beyond what the content can possibly award.
    if (p.data.xp > content.maxXp) return res.status(400).json({ ok: false, error: "implausible progress" });
    const s = session(res);
    const updatedAt = await store.saveProgress(s.username, s.name, sanitizeState(p.data, content));
    res.json({ ok: true, updatedAt });
  };
  app.put("/api/progress", save);
  app.post("/api/progress", save);

  app.post("/api/answer", async (req, res) => {
    const p = AnswerSchema.safeParse(req.body);
    const q = p.success ? content.lessons.get(p.data.lessonId)?.lesson.questions[p.data.question] : undefined;
    if (!p.success || !q || p.data.option >= q.options.length) return res.status(400).json({ ok: false, error: "invalid answer" });
    const correct = p.data.option === q.answer;
    await store.recordAnswer(session(res).username, { ...p.data, correct });
    res.json({ ok: true, correct });
  });

  // ---------------------------------------------------------------- management
  app.get("/management", managerOnly, (_req, res) => {
    res.sendFile(resolve(publicDir, "management.html"));
  });
  app.get("/management.html", (_req, res) => res.redirect(302, "/management"));

  app.get("/api/management/dashboard", managerOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await dashboard(store, content));
  });

  app.get("/api/management/export.csv", managerOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="training-progress-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.type("text/csv; charset=utf-8").send(dashboardCsv(await dashboard(store, content)));
  });

  app.get("/api/management/analyst/:username", managerOnly, async (req, res) => {
    const u = USERNAME.safeParse(req.params.username);
    const d = u.success ? await analystDetail(store, content, u.data) : null;
    if (!d) return res.status(404).json({ ok: false, error: "analyst not found" });
    res.setHeader("Cache-Control", "no-store");
    res.json(d);
  });

  app.get("/api/management/access", managerOnly, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await store.recentAccess(50));
  });

  app.get("/api/management/managers", managerOnly, async (_req, res) => {
    res.json(await store.managers());
  });

  app.post("/api/management/managers", managerOnly, async (req, res) => {
    const u = USERNAME.safeParse((req.body as { username?: unknown } | undefined)?.username);
    if (!u.success) return res.status(400).json({ ok: false, error: "Enter the network username (e.g. first.last)" });
    await store.addManager(u.data, session(res).username);
    res.json(await store.managers());
  });

  app.delete("/api/management/managers/:username", managerOnly, async (req, res) => {
    const u = USERNAME.safeParse(req.params.username);
    if (!u.success) return res.status(400).json({ ok: false, error: "invalid username" });
    if (userKey(u.data) === userKey(session(res).username)) return res.status(400).json({ ok: false, error: "You cannot remove yourself" });
    const target = (await store.managers()).find((m) => m.username === userKey(u.data));
    if (!target) return res.status(404).json({ ok: false, error: "not a manager" });
    if (target.addedBy === "config") return res.status(400).json({ ok: false, error: "Fixed manager (set in the server environment)" });
    await store.removeManager(u.data);
    res.json(await store.managers());
  });

  // ---------------------------------------------------------------- static
  app.use("/img", express.static(resolve(publicDir, "img"), { maxAge: "7d", fallthrough: false }));
  app.use(express.static(publicDir, { index: "index.html", maxAge: 0 }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    if (status && status >= 400 && status < 500) {
      if (!res.headersSent) res.status(status).json({ ok: false, error: status === 404 ? "not found" : "bad request" });
      return;
    }
    log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    if (!res.headersSent) res.status(500).json({ ok: false, error: "Internal error" });
  });

  return app;
}
