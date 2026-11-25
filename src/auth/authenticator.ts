/**
 * Directory login, the classic three-step flow:
 *   1. bind with the service account;
 *   2. search the user's DN by cn / sAMAccountName / userPrincipalName;
 *   3. bind again as that DN with the password typed by the user.
 * Works against any `DirectoryClient` (the real LDAP client or FakeDirectory).
 */
import { type DirectoryClient, InvalidCredentialsError, and, eq, or } from "./directory.js";

export interface DirectoryUser {
  /** sAMAccountName (network login): what goes into the session. */
  username: string;
  name: string;
}

/** Credentials checked: a user, `null` (invalid), or an exception (directory down / service account refused). */
export type Authenticate = (username: string, password: string) => Promise<DirectoryUser | null>;

export interface DirectoryConfig {
  baseDn: string;
  bindDn: string;
  bindPassword: string;
}

const MAX_LEN = 256;

function attr(e: Record<string, unknown>, name: string): string {
  const v = e[name];
  const s: unknown = Array.isArray(v) ? (v as unknown[])[0] : v;
  return typeof s === "string" ? s : Buffer.isBuffer(s) ? s.toString("utf8") : "";
}

export function createDirectoryAuthenticator(cfg: DirectoryConfig, newClient: () => DirectoryClient): Authenticate {
  return async (username, password) => {
    // An empty password must never reach the bind: the directory accepts DN + empty password as an
    // "unauthenticated bind" and reports success, which would be a login without a password.
    if (!username || !password || username.length > MAX_LEN || password.length > MAX_LEN) return null;

    const service = newClient();
    let dn: string;
    let user: DirectoryUser;
    try {
      await service.bind(cfg.bindDn, cfg.bindPassword);
      // Values go through the filter model and get escaped: no filter injection via the username.
      const filter = and(
        eq("objectClass", "user"),
        or(...["cn", "sAMAccountName", "userPrincipalName"].map((a) => eq(a, username))),
      );
      const { searchEntries } = await service.search(cfg.baseDn, {
        scope: "sub",
        filter,
        sizeLimit: 2,
        attributes: ["sAMAccountName", "displayName", "cn"],
      });
      // None, or more than one (duplicated cn): never guess which account it is.
      if (searchEntries.length !== 1) return null;
      const e = searchEntries[0]!;
      dn = typeof e.dn === "string" ? e.dn : "";
      if (!dn) return null;
      const sam = attr(e, "sAMAccountName") || username;
      user = { username: sam, name: attr(e, "displayName") || attr(e, "cn") || sam };
    } finally {
      await service.unbind().catch(() => undefined);
    }

    const client = newClient();
    try {
      await client.bind(dn, password);
      return user;
    } catch (e) {
      if (e instanceof InvalidCredentialsError) return null;
      throw e;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  };
}
