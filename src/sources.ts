export interface LegalSource {
  id: string;
  movieId: string;
  title: string;
  url: string;
  host: string;
  license: "public-domain" | "cc0" | "cc-by" | "cc-by-sa" | "licensed";
  rightsEvidenceUrl: string;
  territory: string[];
  reviewed: boolean;
  reviewedAt?: string;
}

const ALLOWED_PLAYBACK_HOSTS = new Set(["archive.org", "www.archive.org", "upload.wikimedia.org", "commons.wikimedia.org"]);

const ALLOWED_LICENSES = new Set<LegalSource["license"]>([
  "public-domain", "cc0", "cc-by", "cc-by-sa", "licensed"
]);

/**
 * Intentionally empty until an editor verifies the film's rights and exact URL.
 * Do not treat age, availability on an archive, or a search result as rights evidence.
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
    return { valid: false, reason: "Playback host is not on CineWorld’s reviewed host allowlist." };
  }
  if (!ALLOWED_LICENSES.has(source.license)) return { valid: false, reason: "Unsupported license label." };
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
  return LEGAL_SOURCES.filter((source) => source.movieId === movieId && validateLegalSource(source).valid);
}
