/**
 * Subtitle records follow the same rule as playback sources: nothing is listed until an editor has
 * checked the rights. Subtitle files from unverified or scraped sources are never served.
 */
import { randomUUID } from "node:crypto";
import { loadJson, saveJson } from "./jsonStore.js";

export interface SubtitleRecord {
  id: string;
  movieId: string;
  /** ISO 639-2 language code used by Stremio, e.g. "ben" for Bangla, "eng" for English. */
  lang: string;
  url: string;
  host: string;
  license: "public-domain" | "cc0" | "cc-by" | "cc-by-sa" | "licensed";
  rightsEvidenceUrl: string;
  reviewed: boolean;
  reviewedAt?: string;
}

const ALLOWED_SUBTITLE_HOSTS = new Set(["archive.org", "www.archive.org", "upload.wikimedia.org", "commons.wikimedia.org"]);
const ALLOWED_LICENSES = new Set<SubtitleRecord["license"]>(["public-domain", "cc0", "cc-by", "cc-by-sa", "licensed"]);
const SUBTITLE_FILE = /\.(srt|vtt)$/i;
const SUBTITLES_FILE = process.env.SUBTITLES_FILE ?? "data/subtitles.json";
const MAX_SUBTITLES = 2000;
export const SUBTITLE_HOSTS: string[] = [...ALLOWED_SUBTITLE_HOSTS];

/** Empty until an editor verifies the subtitle's rights and exact URL (admin panel or restore). */
export const SUBTITLES: SubtitleRecord[] = [];

export function validateSubtitle(record: SubtitleRecord): { valid: boolean; reason?: string } {
  let parsed: URL;
  try { parsed = new URL(record.url); } catch { return { valid: false, reason: "Subtitle URL is not a valid absolute URL." }; }
  if (parsed.protocol !== "https:") return { valid: false, reason: "Only HTTPS subtitle URLs are accepted." };
  if (parsed.username || parsed.password) return { valid: false, reason: "Credentials in subtitle URLs are forbidden." };
  if (!record.host || parsed.hostname.toLowerCase() !== record.host.toLowerCase()) return { valid: false, reason: "Declared host does not match the subtitle URL." };
  if (!ALLOWED_SUBTITLE_HOSTS.has(parsed.hostname.toLowerCase())) return { valid: false, reason: `Subtitle host is not on the reviewed host allowlist (${SUBTITLE_HOSTS.join(", ")}).` };
  if (!SUBTITLE_FILE.test(parsed.pathname)) return { valid: false, reason: "Subtitle URL must point to an .srt or .vtt file." };
  if (!/^[a-z]{3}$/.test(record.lang)) return { valid: false, reason: "Language must be a three-letter ISO 639-2 code." };
  if (!ALLOWED_LICENSES.has(record.license)) return { valid: false, reason: "Unsupported license label." };
  if (!record.reviewed || !record.reviewedAt) return { valid: false, reason: "Subtitle has not been reviewed and dated." };
  try {
    if (new URL(record.rightsEvidenceUrl).protocol !== "https:") return { valid: false, reason: "Rights evidence must use HTTPS." };
  } catch { return { valid: false, reason: "Rights evidence URL is missing or invalid." }; }
  return { valid: true };
}

export function getReviewedSubtitles(movieId: string, records: SubtitleRecord[] = SUBTITLES): SubtitleRecord[] {
  return records.filter((record) => record.movieId === movieId && validateSubtitle(record).valid);
}

export interface NewSubtitleInput {
  movieId?: unknown; lang?: unknown; url?: unknown; license?: unknown; rightsEvidenceUrl?: unknown; rightsConfirmed?: unknown;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
function persist(): void { saveJson(SUBTITLES_FILE, SUBTITLES); }

export function addSubtitle(input: NewSubtitleInput): { ok: true; record: SubtitleRecord } | { ok: false; reason: string } {
  if (input.rightsConfirmed !== true) return { ok: false, reason: "Confirm that you have checked that you may link to this subtitle." };
  const movieId = text(input.movieId, 120);
  if (!movieId) return { ok: false, reason: "Choose a movie first." };
  const url = text(input.url, 2000);
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { ok: false, reason: "The subtitle URL is not valid." }; }
  const record: SubtitleRecord = {
    id: randomUUID(), movieId, lang: text(input.lang, 3).toLowerCase(), url, host,
    license: text(input.license, 20) as SubtitleRecord["license"],
    rightsEvidenceUrl: text(input.rightsEvidenceUrl, 2000),
    reviewed: true, reviewedAt: new Date().toISOString().slice(0, 10)
  };
  const check = validateSubtitle(record);
  if (!check.valid) return { ok: false, reason: check.reason ?? "Invalid subtitle." };
  if (SUBTITLES.some((item) => item.movieId === movieId && item.url === url)) return { ok: false, reason: "This subtitle is already added for this movie." };
  if (SUBTITLES.length >= MAX_SUBTITLES) return { ok: false, reason: "Too many subtitles." };
  SUBTITLES.push(record);
  persist();
  return { ok: true, record };
}

export function removeSubtitle(id: string): boolean {
  const index = SUBTITLES.findIndex((item) => item.id === id);
  if (index === -1) return false;
  SUBTITLES.splice(index, 1);
  persist();
  return true;
}

export function replaceSubtitles(records: unknown): number {
  const kept = (Array.isArray(records) ? records : []).filter((record): record is SubtitleRecord =>
    typeof record === "object" && record !== null && typeof (record as SubtitleRecord).id === "string" &&
    validateSubtitle(record as SubtitleRecord).valid).slice(0, MAX_SUBTITLES);
  SUBTITLES.splice(0, SUBTITLES.length, ...kept);
  persist();
  return kept.length;
}

SUBTITLES.push(...(loadJson<unknown[]>(SUBTITLES_FILE, []) as SubtitleRecord[]).filter((record) =>
  typeof record === "object" && record !== null && typeof record.id === "string" && validateSubtitle(record).valid).slice(0, MAX_SUBTITLES));
