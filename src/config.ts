import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, found by walking up to package.json (works from `src/` under tsx and from `dist/src/`). */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("package.json not found above " + dirname(fileURLToPath(import.meta.url)));
    dir = up;
  }
  return dir;
}

export const projectRoot = findRoot();

const envFile = resolve(projectRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const path = (v: string | undefined, fallback: string) => resolve(projectRoot, v || fallback);

export const config = {
  port: num("PORT", 4801),
  host: process.env.HOST || "127.0.0.1",
  contentFile: path(process.env.CONTENT_FILE, "content/content.json"),
  databaseFile: path(process.env.DATABASE_FILE, "data/training.db"),
  /** Fixed managers (comma separated). Others are added from the management screen. */
  managers: (process.env.MANAGERS || "").split(",").map((s) => s.trim()).filter(Boolean),
  auth: {
    sessionSecret: process.env.SESSION_SECRET || "",
    sessionTtlHours: num("SESSION_TTL_HOURS", 12),
    directory: {
      file: path(process.env.DIRECTORY_FILE, "fixtures/directory.demo.json"),
      baseDn: process.env.DIRECTORY_BASE_DN || "",
      bindDn: process.env.DIRECTORY_BIND_DN || "",
      bindPassword: process.env.DIRECTORY_BIND_PASSWORD || "",
    },
  },
};
