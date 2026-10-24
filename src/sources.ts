import { randomUUID } from "node:crypto";
import { deriveEvidenceUrl } from "./evidence.js";
import { loadJson, saveJson } from "./jsonStore.js";

export interface LegalSource {
  id: string;
  movieId: string;
  title: string;
  url: string;
  host: string;
  license: "public-domain" | "cc0" | "cc-by" | "cc-by-sa" | "licensed";
  rightsEvidenceUrl: string;
  territory: string[];
  /** Optional quality label shown to viewers, best first: 4K, 1440p, 1080p, 720p, 480p, 360p, 240p, Auto. */
  quality?: string;
  reviewed: boolean;
  reviewedAt?: string;
}

const ALLOWED_PLAYBACK_HOSTS = new Set(["archive.org", "www.archive.org", "upload.wikimedia.org", "commons.wikimedia.org"]);

const ALLOWED_LICENSES = new Set<LegalSource["license"]>([
  "public-domain", "cc0", "cc-by", "cc-by-sa", "licensed"
]);

const SOURCES_FILE = process.env.SOURCES_FILE ?? "data/sources.json";
const VIDEO_FILE = /\.(mp4|m4v|webm|mkv|ogv|mov|m3u8)$/i;
const MAX_SOURCES = 2000;

export const QUALITIES = ["4K", "1440p", "1080p", "720p", "480p", "360p", "240p", "Auto"] as const;

/** "1080", "1080P", "uhd", "2160p", "hls" ... -> a standard label, "" for no quality, null when unknown. */
export function normalizeQuality(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "";
  if (["4k", "uhd", "2160", "2160p"].includes(raw)) return "4K";
  if (["auto", "hls", "m3u8", "adaptive"].includes(raw)) return "Auto";
  const match = raw.match(/^(\d{3,4})p?$/);
  const label = match ? `${match[1]}p` : "";
  return (QUALITIES as readonly string[]).includes(label) ? label : null;
}

export function qualityRank(quality?: string): number {
  const index = (QUALITIES as readonly string[]).indexOf(quality ?? "");
  return index === -1 ? QUALITIES.length : index;
}

export const PLAYBACK_HOSTS: string[] = [...ALLOWED_PLAYBACK_HOSTS];

/**
 * Empty until an editor verifies the film's rights and exact URL (admin panel or restore).
 * Do not treat age, availability on an archive, or a search result as rights evidence.
 * Every record, including ones loaded from disk, must pass validateLegalSource.
 */
export const LEGAL_SOURCES: LegalSource[] = [];

export function validateLegalSource(source: LegalSource): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(source.url);
  } catch {
    return { valid: false, reason: "Playback URL is not a valid absolute URL." };
  }

  if (parsed.protocol !== "https:") return { valid: false, reason: "Only HTTPS playback URLs are accepted." };
  if (parsed.username || parsed.password) return { valid: false, reason: "Credentials in playback URLs are forbidden." };
  if (!source.host || parsed.hostname.toLowerCase() !== source.host.toLowerCase()) {
    return { valid: false, reason: "Declared host does not match the playback URL." };
  }
  if (!ALLOWED_PLAYBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { valid: false, reason: `Playback host is not on CineWorld's reviewed host allowlist (${PLAYBACK_HOSTS.join(", ")}).` };
  }
  if (!VIDEO_FILE.test(parsed.pathname)) return { valid: false, reason: "The URL must point directly to a video file (.mp4, .webm, .mkv, .m3u8 ...), not to a web page." };
  if (!ALLOWED_LICENSES.has(source.license)) return { valid: false, reason: "Unsupported license label." };
  if (source.quality !== undefined && !(QUALITIES as readonly string[]).includes(source.quality)) return { valid: false, reason: `Quality must be one of ${QUALITIES.join(", ")}.` };
  if (!source.reviewed || !source.reviewedAt) return { valid: false, reason: "Source has not been reviewed and dated." };

  let evidence: URL;
  try {
    evidence = new URL(source.rightsEvidenceUrl);
  } catch {
    return { valid: false, reason: "Rights evidence URL is missing or invalid." };
  }
  if (evidence.protocol !== "https:") return { valid: false, reason: "Rights evidence must use HTTPS." };
  if (!source.territory.length) return { valid: false, reason: "At least one allowed territory must be specified." };

  return { valid: true };
}

export function getReviewedSources(movieId: string): LegalSource[] {
  return LEGAL_SOURCES
    .filter((source) => source.movieId === movieId && validateLegalSource(source).valid)
    .sort((a, b) => qualityRank(a.quality) - qualityRank(b.quality)); // best quality first
}

export interface NewSourceInput {
  movieId?: unknown; title?: unknown; url?: unknown; license?: unknown;
  rightsEvidenceUrl?: unknown; territory?: unknown; quality?: unknown; rightsConfirmed?: unknown;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function persist(): void { saveJson(SOURCES_FILE, LEGAL_SOURCES); }

/** Adds a source from the admin panel. The editor must confirm they checked the rights; the record is still fully validated. */
export function addLegalSource(input: NewSourceInput): { ok: true; source: LegalSource } | { ok: false; reason: string } {
  if (input.rightsConfirmed !== true) return { ok: false, reason: "Confirm that you have checked that you may link to this video." };
  const movieId = text(input.movieId, 120);
  if (!movieId) return { ok: false, reason: "Choose a movie first." };
  const url = text(input.url, 2000);
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { ok: false, reason: "The video URL is not valid." }; }
  const territory = (Array.isArray(input.territory) ? input.territory : text(input.territory, 200).split(","))
    .map((item) => text(item, 20)).filter(Boolean).slice(0, 20);
  const quality = normalizeQuality(input.quality);
  if (quality === null) return { ok: false, reason: `Quality must be one of ${QUALITIES.join(", ")}.` };
  // The rights page is worked out from the link itself unless the editor supplies one.
  const evidence = text(input.rightsEvidenceUrl, 2000) || deriveEvidenceUrl(url) || "";
  if (!evidence) return { ok: false, reason: "Use a direct archive.org /download/... or Wikimedia upload link." };
  const source: LegalSource = {
    id: randomUUID(), movieId, title: text(input.title, 80) || "Source", url, host,
    license: text(input.license, 20) as LegalSource["license"],
    rightsEvidenceUrl: evidence,
    territory: territory.length ? territory : ["world"],
    ...(quality ? { quality } : {}),
    reviewed: true, reviewedAt: new Date().toISOString().slice(0, 10)
  };
  const check = validateLegalSource(source);
  if (!check.valid) return { ok: false, reason: check.reason ?? "Invalid source." };
  if (LEGAL_SOURCES.some((item) => item.movieId === movieId && item.url === url)) return { ok: false, reason: "This link is already added for this movie." };
  if (LEGAL_SOURCES.length >= MAX_SOURCES) return { ok: false, reason: "Too many sources." };
  LEGAL_SOURCES.push(source);
  persist();
  return { ok: true, source };
}

export function removeLegalSource(id: string): boolean {
  const index = LEGAL_SOURCES.findIndex((item) => item.id === id);
  if (index === -1) return false;
  LEGAL_SOURCES.splice(index, 1);
  persist();
  return true;
}

/** Replaces the list (backup restore / startup). Records that fail validation are dropped. Returns how many were kept. */
export function replaceLegalSources(records: unknown): number {
  const kept = (Array.isArray(records) ? records : []).filter((record): record is LegalSource =>
    typeof record === "object" && record !== null && typeof (record as LegalSource).id === "string" &&
    validateLegalSource(record as LegalSource).valid).slice(0, MAX_SOURCES);
  LEGAL_SOURCES.splice(0, LEGAL_SOURCES.length, ...kept);
  persist();
  return kept.length;
}

LEGAL_SOURCES.push(...(loadJson<unknown[]>(SOURCES_FILE, []) as LegalSource[]).filter((record) =>
  typeof record === "object" && record !== null && typeof record.id === "string" && validateLegalSource(record).valid).slice(0, MAX_SOURCES));
