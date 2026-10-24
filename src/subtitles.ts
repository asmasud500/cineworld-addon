/**
 * Subtitle records follow the same rule as playback sources: nothing is listed until an editor has
 * checked the rights. Subtitle files from unverified or scraped sources are never served.
 */
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

/** Intentionally empty until an editor verifies the subtitle's rights and exact URL. */
export const SUBTITLES: SubtitleRecord[] = [];

export function validateSubtitle(record: SubtitleRecord): { valid: boolean; reason?: string } {
  let parsed: URL;
  try { parsed = new URL(record.url); } catch { return { valid: false, reason: "Subtitle URL is not a valid absolute URL." }; }
  if (parsed.protocol !== "https:") return { valid: false, reason: "Only HTTPS subtitle URLs are accepted." };
  if (parsed.username || parsed.password) return { valid: false, reason: "Credentials in subtitle URLs are forbidden." };
  if (!record.host || parsed.hostname.toLowerCase() !== record.host.toLowerCase()) return { valid: false, reason: "Declared host does not match the subtitle URL." };
  if (!ALLOWED_SUBTITLE_HOSTS.has(parsed.hostname.toLowerCase())) return { valid: false, reason: "Subtitle host is not on the reviewed host allowlist." };
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
