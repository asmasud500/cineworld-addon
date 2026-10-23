import type { CinemaCategoryId, Movie } from "../catalog.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

type UpstreamCatalog = { type?: string; id?: string; name?: string; extra?: Array<{ name?: string }> };
type UpstreamManifest = { id?: string; name?: string; resources?: Array<string | { name?: string }>; types?: string[]; catalogs?: UpstreamCatalog[] };
type UpstreamMeta = { id?: string; type?: string; name?: string; description?: string; releaseInfo?: string; genres?: string[]; poster?: string; imdb_id?: string; imdbId?: string };
type CatalogResponse = { metas?: UpstreamMeta[] };

const DEFAULT_ADDONS = [
  "https://83e20802dcf1-indian-streams.baby-beamup.club/manifest.json",
  "https://indiastreams.rdata.in/manifest.json"
];
const ADDON_URLS = (process.env.UPSTREAM_CATALOG_ADDONS ?? DEFAULT_ADDONS.join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);

function safeManifestUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" || host.endsWith(".local") || host === "[::1]" ||
      /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^\d+(\.\d+){3}$/.test(host)
    ) return null;
    return url;
  } catch { return null; }
}

async function fetchJson<T>(url: URL): Promise<T | null> {
  const key = url.toString();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const value = await response.json() as T;
    if (cache.size > 300) cache.clear();
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch { return null; }
}

function categoryTerms(categoryId: CinemaCategoryId): string[] {
  const terms: Record<CinemaCategoryId, string[]> = {
    "bd-bengali": ["bengali", "bangla", "bn"],
    "in-bengali": ["bengali", "bangla", "bn"],
    bollywood: ["bollywood", "hindi", "hi"],
    tamil: ["tamil", "ta"],
    telugu: ["telugu", "te"],
    malayalam: ["malayalam", "ml"],
    kannada: ["kannada", "kn"],
    pakistani: ["pakistan", "pakistani", "urdu"],
    nepali: ["nepali", "nepal"],
    "sri-lankan": ["sri lanka", "sri-lankan", "sinhala"],
    hollywood: ["hollywood", "english", "trending movies"],
    korean: ["korean", "k-drama"],
    chinese: ["chinese", "mandarin"],
    japanese: ["japanese", "japan"],
    world: ["world cinema", "trending movies", "popular movies", "recommended movies", "ott releases"]
  };
  return terms[categoryId];
}

function catalogMatches(catalog: UpstreamCatalog, categoryId: CinemaCategoryId): boolean {
  if (catalog.type !== "movie" || !catalog.id) return false;
  const haystack = `${catalog.id} ${catalog.name ?? ""}`.toLocaleLowerCase();
  return categoryTerms(categoryId).some((term) => term.length <= 3 ? catalog.id.toLocaleLowerCase() === term : haystack.includes(term));
}

function normalize(item: UpstreamMeta, categoryId: CinemaCategoryId): Movie | null {
  const id = item.id?.trim();
  const name = item.name?.trim();
  // Catalog endpoint is movie-scoped; some providers omit type on preview items.
  if (!id || !name || (item.type && item.type !== "movie")) return null;
  const poster = item.poster && /^https:\/\//i.test(item.poster) ? item.poster : undefined;
  const imdbId = item.imdb_id ?? item.imdbId ?? (/^tt\d+$/.test(id) ? id : undefined);
  return {
    id, type: "movie", name,
    description: item.description?.trim() || "Description not provided by the catalog add-on.",
    releaseInfo: item.releaseInfo ?? "",
    genres: Array.isArray(item.genres) ? item.genres.filter((g): g is string => typeof g === "string") : [],
    ...(poster ? { poster } : {}),
    ...(imdbId ? { imdbId } : {}),
    categoryIds: [categoryId], sourceIds: []
  };
}

export async function getUpstreamCatalog(categoryId: CinemaCategoryId, skip = 0, search?: string): Promise<Movie[]> {
  const all: Movie[] = [];
  for (const rawUrl of ADDON_URLS) {
    const manifestUrl = safeManifestUrl(rawUrl);
    if (!manifestUrl) continue;
    const manifest = await fetchJson<UpstreamManifest>(manifestUrl);
    if (!manifest || !Array.isArray(manifest.catalogs)) continue;
    const candidates = manifest.catalogs.filter((catalog) => catalogMatches(catalog, categoryId));
    for (const catalog of candidates.slice(0, 2)) {
      // catalogMatches validates these fields at runtime, but TypeScript cannot
      // infer that from a separate predicate function.
      if (!catalog.id || !catalog.type) continue;
      const endpoint = new URL(`catalog/${encodeURIComponent(catalog.type)}/${encodeURIComponent(catalog.id)}.json`, manifestUrl);
      if (search && catalog.extra?.some((extra) => extra.name === "search")) endpoint.searchParams.set("search", search.slice(0, 100));
      if (skip > 0) endpoint.searchParams.set("skip", String(Math.min(skip, 1000)));
      const response = await fetchJson<CatalogResponse>(endpoint);
      for (const item of response?.metas ?? []) {
        const movie = normalize(item, categoryId);
        if (movie && (!search || movie.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) all.push(movie);
      }
    }
  }
  const unique = new Map<string, Movie>();
  for (const movie of all) unique.set(movie.imdbId ?? movie.id, movie);
  return [...unique.values()].slice(0, 100);
}

export async function getUpstreamMeta(id: string, type: string): Promise<Movie | null> {
  if (type !== "movie" || !id.trim()) return null;
  for (const rawUrl of ADDON_URLS) {
    const manifestUrl = safeManifestUrl(rawUrl);
    if (!manifestUrl) continue;
    const manifest = await fetchJson<UpstreamManifest>(manifestUrl);
    if (!manifest || !Array.isArray(manifest.resources)) continue;
    const supportsMeta = manifest.resources.some((resource) =>
      typeof resource === "string" ? resource === "meta" : resource?.name === "meta"
    );
    if (!supportsMeta) continue;
    const endpoint = new URL(`meta/movie/${encodeURIComponent(id)}.json`, manifestUrl);
    const response = await fetchJson<{ meta?: UpstreamMeta }>(endpoint);
    if (response?.meta) {
      const movie = normalize(response.meta, "world");
      if (movie) return movie;
    }
  }
  return null;
}


/** Non-sensitive diagnostics for the health endpoint; never expose configured URLs. */
export function getUpstreamSourceStatus(): { playbackSources: string; upstreamCatalogAddonsConfigured: number; upstreamCacheEntries: number } {
  return {
    playbackSources: "reviewed-only",
    upstreamCatalogAddonsConfigured: ADDON_URLS.filter((value) => safeManifestUrl(value) !== null).length,
    upstreamCacheEntries: cache.size
  };
}
