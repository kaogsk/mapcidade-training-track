/** Wires the session gate to the configured directory. Without a session, only the login page loads. */
import { config } from "../config.js";
import { createDirectoryAuthenticator } from "./authenticator.js";
import { FakeDirectory } from "./fakeDirectory.js";
import { type Auth, createSessionAuth } from "./session.js";

export type { Auth, Session } from "./session.js";

/** The bare minimum the login page needs; content, images and progress all require a session. */
export const EXEMPT = ["/login", "/auth/login", "/api/health", "/assets/app.css", "/assets/web/login.js", "/favicon.svg"];

/** Own cookie name: cookies are not scoped by port, and the host runs other apps. */
export const COOKIE_NAME = "training_track_session";

export function createAuth(directory: FakeDirectory): Auth {
  const d = config.auth.directory;
  // Fail closed: without a directory configured, every login would silently become a 503.
  const missing = (["baseDn", "bindDn", "bindPassword"] as const).filter((k) => !d[k]);
  if (missing.length) throw new Error(`auth: directory settings missing in .env (${missing.join(", ")})`);
  return createSessionAuth({
    cookieName: COOKIE_NAME,
    secret: config.auth.sessionSecret,
    ttlSeconds: config.auth.sessionTtlHours * 3600,
    authenticate: createDirectoryAuthenticator(d, () => directory.client()),
    exempt: EXEMPT,
  });
}
