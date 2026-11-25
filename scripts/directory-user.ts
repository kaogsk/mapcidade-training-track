/**
 * Adds or updates an entry in the fake directory file.
 *
 * Usage:
 *   npm run directory:user -- <username> "<Display Name>" <password> [--file path] [--service]
 * `--service` creates a service account (objectClass "account", bound by DN) instead of a user.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type DirectoryData, type DirectoryEntry, hashPassword } from "../src/auth/fakeDirectory.js";
import { config } from "../src/config.js";

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const file = fileIdx >= 0 ? resolve(args[fileIdx + 1]!) : config.auth.directory.file;
const service = args.includes("--service");
const [username, displayName, password] = args.filter((a, i) => !a.startsWith("--") && (fileIdx < 0 || i !== fileIdx + 1));
if (!username || !displayName || !password) {
  console.error('usage: npm run directory:user -- <username> "<Display Name>" <password> [--file path] [--service]');
  process.exit(1);
}

const data: DirectoryData = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DirectoryData) : { entries: [] };
const domain = "mapcidade.example";
const entry: DirectoryEntry = service
  ? { dn: `cn=${username},ou=Services,dc=mapcidade,dc=example`, objectClass: ["account"], cn: username, passwordHash: hashPassword(password) }
  : {
      dn: `cn=${displayName},ou=People,dc=mapcidade,dc=example`,
      objectClass: ["top", "person", "user"],
      cn: displayName,
      sAMAccountName: username,
      userPrincipalName: `${username}@${domain}`,
      displayName,
      passwordHash: hashPassword(password),
    };
const i = data.entries.findIndex((e) => e.dn.toLowerCase() === entry.dn.toLowerCase() || (e.sAMAccountName && e.sAMAccountName === entry.sAMAccountName));
if (i >= 0) data.entries[i] = entry;
else data.entries.push(entry);
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${i >= 0 ? "updated" : "added"} ${entry.dn} in ${file}`);
