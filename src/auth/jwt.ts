/** Session token: HS256 JWT, signed and verified here (no dependency, ~40 lines). */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionClaims {
  sub: string;
  name: string;
  iat: number;
  exp: number;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest();
const HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export function signJwt(claims: SessionClaims, secret: string): string {
  const body = `${HEADER}.${b64url(JSON.stringify(claims))}`;
  return `${body}.${b64url(hmac(secret, body))}`;
}

/**
 * Claims or null. Only HS256 is accepted (a verifier that trusts the header's `alg` accepts
 * `none`), and `exp` is mandatory: a token without an expiry never gets through.
 */
export function verifyJwt(token: string, secret: string, nowMs = Date.now()): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  let payload: Partial<SessionClaims>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Partial<SessionClaims>;
  } catch {
    return null;
  }
  if ((header as { alg?: unknown } | null)?.alg !== "HS256") return null;
  const expected = hmac(secret, `${h}.${p}`);
  const got = Buffer.from(s, "base64url");
  // timingSafeEqual throws on different lengths: check first.
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) return null;
  return payload as SessionClaims;
}
