/**
 * The slice of an LDAP client the authenticator uses. In production this is the `ldapts` Client
 * talking to the company's Active Directory; here it is implemented by FakeDirectory
 * (fakeDirectory.ts). Same method names, same filter model, same error class for a wrong
 * password, so the authenticator code is identical in both worlds.
 */

export type Filter =
  | { type: "and"; filters: Filter[] }
  | { type: "or"; filters: Filter[] }
  | { type: "eq"; attribute: string; value: string };

export const and = (...filters: Filter[]): Filter => ({ type: "and", filters });
export const or = (...filters: Filter[]): Filter => ({ type: "or", filters });
export const eq = (attribute: string, value: string): Filter => ({ type: "eq", attribute, value });

/** RFC 4515 escaping: `*`, `(`, `)`, `\` and NUL can never reach the filter as syntax. */
export function escapeFilterValue(v: string): string {
  return v.replace(/[*()\\\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** String form, as sent over the wire by a real client (also handy in logs and tests). */
export function filterToString(f: Filter): string {
  if (f.type === "eq") return `(${f.attribute}=${escapeFilterValue(f.value)})`;
  return `(${f.type === "and" ? "&" : "|"}${f.filters.map(filterToString).join("")})`;
}

export interface SearchOptions {
  scope: "sub";
  filter: Filter;
  sizeLimit: number;
  attributes: string[];
}

export type Entry = { dn: string } & Record<string, unknown>;

export interface DirectoryClient {
  bind(dn: string, password: string): Promise<void>;
  search(base: string, opts: SearchOptions): Promise<{ searchEntries: Entry[] }>;
  unbind(): Promise<void>;
}

/** Wrong DN/password on bind (LDAP result code 49), as distinct from "directory unreachable". */
export class InvalidCredentialsError extends Error {
  readonly code = 49;
  constructor(message = "Invalid Credentials") {
    super(message);
    this.name = "InvalidCredentialsError";
  }
}
