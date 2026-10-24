import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Tiny JSON file store. On hosts with a temporary disk the data lasts until the next redeploy, so the admin offers backup/restore. */
export function loadJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

export function saveJson(file: string, data: unknown): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
}
