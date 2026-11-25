/**
 * In-process stand-in for the corporate directory, implementing `DirectoryClient`.
 *
 * It reproduces the behaviours the authenticator has to defend against, not just the happy path:
 *   - an empty password binds successfully ("unauthenticated bind", as Active Directory does);
 *   - searching requires an authenticated bind (the service account);
 *   - every wrong password counts towards the account's own lockout threshold, like AD's
 *     badPwdCount: a tool that lets anyone hammer binds can lock a colleague's network account;
 *   - it can be switched "offline" to exercise the 503 path.
 * Users live in a JSON file with scrypt hashes (scripts/directory-user.ts adds them).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { type DirectoryClient, type Entry, type Filter, InvalidCredentialsError, type SearchOptions } from "./directory.js";

export interface DirectoryEntry {
  dn: string;
  objectClass: string[];
  cn: string;
  sAMAccountName?: string;
  userPrincipalName?: string;
  displayName?: string;
  /** `scrypt$<saltB64>$<hashB64>` */
  passwordHash: string;
}

export interface DirectoryData {
  entries: DirectoryEntry[];
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(got, expected);
}

const lc = (s: string) => s.toLowerCase();

function attrValues(e: DirectoryEntry, attribute: string): string[] {
  const key = Object.keys(e).find((k) => lc(k) === lc(attribute));
  if (!key || key === "passwordHash") return [];
  const v = (e as unknown as Record<string, unknown>)[key];
  return (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
}

export function matches(e: DirectoryEntry, f: Filter): boolean {
  if (f.type === "and") return f.filters.every((x) => matches(e, x));
  if (f.type === "or") return f.filters.some((x) => matches(e, x));
  return attrValues(e, f.attribute).some((v) => lc(v) === lc(f.value));
}

export interface FakeDirectoryOptions {
  /** Wrong passwords before the account locks (AD default policies are often 5-10). */
  lockoutThreshold?: number;
}

export class FakeDirectory {
  offline = false;
  readonly badPasswordCount = new Map<string, number>();
  /** Every bind attempt, for tests and the demo log: [dn, outcome]. */
  readonly bindLog: { dn: string; outcome: "ok" | "anonymous" | "invalid" | "locked" }[] = [];
  private readonly threshold: number;

  constructor(
    private readonly data: DirectoryData,
    opts: FakeDirectoryOptions = {},
  ) {
    this.threshold = opts.lockoutThreshold ?? 10;
  }

  static fromFile(file: string, opts?: FakeDirectoryOptions): FakeDirectory {
    return new FakeDirectory(JSON.parse(readFileSync(file, "utf8")) as DirectoryData, opts);
  }

  isLocked(dn: string): boolean {
    return (this.badPasswordCount.get(lc(dn)) ?? 0) >= this.threshold;
  }

  /** A new "connection". Each one has its own bound identity, like a real LDAP session. */
  client(): DirectoryClient {
    let boundAs: DirectoryEntry | null = null;
    const ensureOnline = () => {
      if (this.offline) throw new Error("connect ECONNREFUSED (fake directory is offline)");
    };

    return {
      bind: async (dn, password) => {
        ensureOnline();
        if (password === "") {
          // The trap: a simple bind with a DN and an empty password is an *unauthenticated* bind,
          // and the directory reports success. Nothing is actually verified.
          boundAs = null;
          this.bindLog.push({ dn, outcome: "anonymous" });
          return;
        }
        const entry = this.data.entries.find((e) => lc(e.dn) === lc(dn));
        if (entry && this.isLocked(entry.dn)) {
          this.bindLog.push({ dn, outcome: "locked" });
          throw new InvalidCredentialsError("Invalid Credentials (account locked)");
        }
        if (!entry || !verifyPassword(password, entry.passwordHash)) {
          if (entry) this.badPasswordCount.set(lc(entry.dn), (this.badPasswordCount.get(lc(entry.dn)) ?? 0) + 1);
          this.bindLog.push({ dn, outcome: "invalid" });
          throw new InvalidCredentialsError();
        }
        this.badPasswordCount.delete(lc(entry.dn));
        boundAs = entry;
        this.bindLog.push({ dn, outcome: "ok" });
      },

      search: async (base, opts: SearchOptions) => {
        ensureOnline();
        if (!boundAs) throw new Error("Operations error: a successful bind must be completed before search");
        const hits = this.data.entries.filter((e) => lc(e.dn).endsWith(lc(base)) && matches(e, opts.filter));
        const searchEntries = hits.slice(0, opts.sizeLimit).map((e): Entry => {
          const out: Entry = { dn: e.dn };
          for (const a of opts.attributes) {
            const v = attrValues(e, a);
            if (v.length) out[a] = v.length === 1 ? v[0] : v;
          }
          return out;
        });
        return { searchEntries };
      },

      unbind: async () => {
        boundAs = null;
      },
    };
  }
}
