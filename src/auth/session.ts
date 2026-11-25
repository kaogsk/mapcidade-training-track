/**
 * Session gate: directory login (authenticator.ts), session in an HttpOnly cookie holding an
 * HS256 JWT (jwt.ts), failed-login throttle (throttle.ts). Without a session, page navigations get
 * a 302 to the login page and fetches get a 401 JSON.
 */
import type { NextFunction, Request, Response } from "express";
import type { Authenticate } from "./authenticator.js";
import { signJwt, verifyJwt } from "./jwt.js";
import { LoginThrottle } from "./throttle.js";

export interface Session {
  username: string;
  name: string;
}

export interface LoginResult {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

export interface Auth {
  requireSession(req: Request, res: Response, next: NextFunction): void;
  sessionOf(req: Request): Session | null;
  login(cred: { username: string; password: string }, ctx: { ip: string | null }): Promise<LoginResult>;
  /** Set-Cookie that clears the session cookie. */
  logoutCookie(): string;
}

export interface SessionAuthOptions {
  cookieName: string;
  secret: string;
  ttlSeconds: number;
  authenticate: Authenticate;
  /** Paths reachable without a session (exact or as a path prefix). */
  exempt: string[];
  throttle?: LoginThrottle;
  /** Add `Secure` to the cookie (off for plain-HTTP intranet deployments). */
  secureCookie?: boolean;
  now?: () => number;
  log?: (msg: string) => void;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

/** Equality, or a prefix that respects path segments (`/login` does not match `/loginx`). */
export function isExemptPath(exempt: string[], url: string): boolean {
  const p = url.split("?")[0] ?? "";
  return exempt.some((e) => p === e || p.startsWith(e.endsWith("/") ? e : `${e}/`));
}

export function createSessionAuth(opts: SessionAuthOptions): Auth {
  const { cookieName, secret, ttlSeconds, authenticate, exempt } = opts;
  const now = opts.now ?? (() => Date.now());
  const throttle = opts.throttle ?? new LoginThrottle({ now });
  const log = opts.log ?? ((m: string) => console.log(`[training] ${m}`));

  // Fail closed: booting open (or with a guessable secret) is the one unacceptable outcome.
  if (!secret || secret.length < 32) throw new Error("auth: SESSION_SECRET missing or shorter than 32 characters");

  const cookie = (token: string, maxAge: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${opts.secureCookie ? "; Secure" : ""}`;

  function sessionOf(req: Request): Session | null {
    const token = readCookie(req.headers.cookie, cookieName);
    const c = token ? verifyJwt(token, secret, now()) : null;
    return c ? { username: c.sub, name: c.name || c.sub } : null;
  }

  function requireSession(req: Request, res: Response, next: NextFunction): void {
    if (isExemptPath(exempt, req.originalUrl || req.url)) return next();
    const s = sessionOf(req);
    if (s) {
      res.locals.user = s;
      return next();
    }
    res.setHeader("Cache-Control", "no-store");
    // Navigations ask for HTML and get a redirect; a redirected fetch would get the login page's
    // HTML where it expects JSON, so fetches get a 401 instead.
    if (String(req.headers.accept ?? "").includes("text/html")) {
      res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || "/")}`);
    } else {
      res.status(401).json({ ok: false, error: "not authenticated" });
    }
  }

  async function login({ username, password }: { username: string; password: string }, { ip }: { ip: string | null }): Promise<LoginResult> {
    const key = LoginThrottle.key(ip, username);
    const wait = throttle.blockedFor(key);
    if (wait > 0) {
      return {
        status: 429,
        body: { ok: false, error: "Too many failed attempts. Wait a few minutes and try again.", retryAfterSeconds: Math.ceil(wait / 1000) },
        setCookie: null,
      };
    }
    let user;
    try {
      user = await authenticate(username, password);
    } catch (e) {
      // Directory down / service account refused is not a wrong password: 503, not counted.
      log(`login: directory unavailable: ${e instanceof Error ? e.message : String(e)}`);
      return { status: 503, body: { ok: false, error: "Authentication service unavailable" }, setCookie: null };
    }
    if (!user) {
      throttle.fail(key);
      log(`login refused for "${username.slice(0, 64)}" (ip ${ip ?? "-"})`);
      return { status: 401, body: { ok: false, error: "Invalid username or password." }, setCookie: null };
    }
    throttle.succeed(key);
    log(`login ok: ${user.username} (ip ${ip ?? "-"})`);
    const iat = Math.floor(now() / 1000);
    const token = signJwt({ sub: user.username, name: user.name, iat, exp: iat + ttlSeconds }, secret);
    return { status: 200, body: { ok: true, username: user.username, name: user.name }, setCookie: cookie(token, ttlSeconds) };
  }

  return { requireSession, sessionOf, login, logoutCookie: () => cookie("", 0) };
}
