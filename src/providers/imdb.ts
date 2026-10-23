import type { CinemaCategoryId, Movie } from "../catalog.js";

const OMDB_API = "https://www.omdbapi.com/";
const CACHE_TTL_MS = 15 * 60 * 1000;
const RESPONSE_CACHE = new Map<string, { expiresAt: number; value: unknown }>();

interface OmdbMovie {
  imdbID?: string;
  Title?: string;
  Year?: string;
  Plot?: string;
  Poster?: string;
  Genre?: string;
  Language?: string;
  Country?: string;
  Type?: string;
  Response?: "True" | "False";
  Search?: OmdbMovie[];
  Error?: string;
}

interface OmdbSearchResponse extends OmdbMovie {
  Search?: OmdbMovie[];
  totalResults?: string;
}

const CATEGORY_SEARCH_TERMS: Record<CinemaCategoryId, string> = {
  "bd-bengali": "Bengali",
  "in-bengali": "Bengali",
  bollywood: "Bollywood",
  tamil: "Tamil",
  telugu: "Telugu",
  malayalam: "Malayalam",
  kannada: "Kannada",
  pakistani: "Pakistani",
  nepali: "Nepali",
  "sri-lankan": "Sri Lankan",
  hollywood: "Hollywood",
  korean: "Korean",
  chinese: "Chinese",
  japanese: "Japanese",
  world: "movie"
};

function splitList(value?: string): string[] {
  return value?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
}

export function normalizeImdbMovie(item: OmdbMovie, categoryId: CinemaCategoryId): Movie | null {
  const imdbId = item.imdbID?.trim();
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
  const poster = item.Poster && item.Poster !== "N/A" && /^https:\/\//i.test(item.Poster)
    ? item.Poster
    : undefined;
  return {
    id: imdbId,
    imdbId,
    type: "movie",
    name: item.Title?.trim() || "Untitled movie",
    description: item.Plot && item.Plot !== "N/A"
      ? item.Plot
      : "Synopsis not available from IMDb metadata provider.",
    releaseInfo: item.Year?.match(/\b\d{4}\b/)?.[0] ?? "",
    genres: splitList(item.Genre),
    ...(poster ? { poster } : {}),
    categoryIds: [categoryId],
    sourceIds: []
  };
}

async function omdbRequest<T extends OmdbMovie>(params: Record<string, string>): Promise<T | null> {
  const apiKey = process.env.OMDB_API_KEY?.trim();
  if (!apiKey) return null;
  const url = new URL(OMDB_API);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const cacheKey = url.toString();
  const cached = RESPONSE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) RESPONSE_CACHE.delete(cacheKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const value = await response.json() as T;
    if (value.Response === "False") return null;
    if (RESPONSE_CACHE.size >= 500) {
      const oldestKey = RESPONSE_CACHE.keys().next().value;
      if (oldestKey) RESPONSE_CACHE.delete(oldestKey);
    }
    RESPONSE_CACHE.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch {
    return null;
  }
}

/**
 * OMDb/IMDb does not provide a public genre/language discovery endpoint.
 * These category pages use best-effort title searches, not verified language classification.
 * Use explicit title search or IMDb IDs for precise lookup.
 */
export async function discoverImdbMovies(categoryId: CinemaCategoryId, skip = 0): Promise<Movie[]> {
  const page = Math.floor(Math.max(0, skip) / 10) + 1;
  const response = await omdbRequest<OmdbSearchResponse>({
    s: CATEGORY_SEARCH_TERMS[categoryId],
    type: "movie",
    page: String(Math.min(page, 100))
  });
  return (response?.Search ?? [])
    .map((item) => normalizeImdbMovie(item, categoryId))
    .filter((movie): movie is Movie => movie !== null);
}

export async function searchImdbMovies(query: string, categoryId: CinemaCategoryId = "world"): Promise<Movie[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const response = await omdbRequest<OmdbSearchResponse>({
    s: normalized,
    type: "movie",
    page: "1"
  });
  return (response?.Search ?? [])
    .map((item) => normalizeImdbMovie(item, categoryId))
    .filter((movie): movie is Movie => movie !== null);
}

export async function getImdbMovie(movieId: string): Promise<Movie | null> {
  if (!/^tt\d+$/.test(movieId)) return null;
  const item = await omdbRequest<OmdbMovie>({ i: movieId, plot: "full" });
  if (!item || item.imdbID !== movieId || item.Type !== "movie") return null;
  return normalizeImdbMovie(item, "world");
}
