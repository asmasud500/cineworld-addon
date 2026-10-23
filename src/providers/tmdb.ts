import type { CinemaCategoryId, Movie } from "../catalog.js";

const TMDB_API = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const CACHE_TTL_MS = 15 * 60 * 1000;
const RESPONSE_CACHE = new Map<string, { expiresAt: number; value: unknown }>();

interface TmdbMovie {
  id: number;
  title?: string;
  original_title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  genre_ids?: number[];
  original_language?: string;
  vote_average?: number;
}

interface TmdbResponse {
  results?: TmdbMovie[];
  page?: number;
  total_pages?: number;
}

const CATEGORY_FILTERS: Partial<Record<CinemaCategoryId, { language?: string; region?: string }>> = {
  "bd-bengali": { language: "bn", region: "BD" },
  "in-bengali": { language: "bn", region: "IN" },
  bollywood: { language: "hi", region: "IN" },
  tamil: { language: "ta", region: "IN" },
  telugu: { language: "te", region: "IN" },
  malayalam: { language: "ml", region: "IN" },
  kannada: { language: "kn", region: "IN" },
  pakistani: { language: "ur", region: "PK" },
  nepali: { language: "ne", region: "NP" },
  "sri-lankan": { language: "si", region: "LK" },
  hollywood: { language: "en", region: "US" },
  korean: { language: "ko", region: "KR" },
  chinese: { language: "zh", region: "CN" },
  japanese: { language: "ja", region: "JP" }
};

const GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
  80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
  14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western"
};

export function normalizeTmdbMovie(item: TmdbMovie, categoryId: CinemaCategoryId): Movie {
  const year = item.release_date?.slice(0, 4) ?? "";
  return {
    id: `cineworld-tmdb-${item.id}`,
    type: "movie",
    name: item.title || item.original_title || "Untitled movie",
    description: item.overview || "Metadata supplied by TMDB; synopsis not available.",
    releaseInfo: year,
    genres: (item.genre_ids ?? []).map((id) => GENRES[id]).filter((name): name is string => Boolean(name)),
    ...(item.poster_path ? { poster: `${IMAGE_BASE}${item.poster_path}` } : {}),
    categoryIds: [categoryId],
    sourceIds: []
  };
}

async function tmdbRequest<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;
  const url = new URL(`${TMDB_API}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const cacheKey = url.toString();
  const cached = RESPONSE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) RESPONSE_CACHE.delete(cacheKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const value = await response.json() as T;
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

export async function discoverTmdbMovies(categoryId: CinemaCategoryId, skip = 0): Promise<Movie[]> {
  const filters = CATEGORY_FILTERS[categoryId] ?? {};
  const firstPage = Math.floor(Math.max(0, skip) / 100) * 5 + 1;
  const pages = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const params: Record<string, string> = {
      include_adult: "false",
      sort_by: "popularity.desc",
      page: String(Math.min(firstPage + index, 500))
    };
    if (filters.language) params.with_original_language = filters.language;
    if (filters.region) params.region = filters.region;
    const response = await tmdbRequest<TmdbResponse>("/discover/movie", params);
    return response?.results ?? [];
  }));
  return pages.flat().map((movie) => normalizeTmdbMovie(movie, categoryId));
}

export async function searchTmdbMovies(query: string, categoryId: CinemaCategoryId = "world"): Promise<Movie[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const response = await tmdbRequest<TmdbResponse>("/search/movie", {
    query: normalized,
    include_adult: "false",
    page: "1"
  });
  return (response?.results ?? []).map((movie) => normalizeTmdbMovie(movie, categoryId));
}

export async function getTmdbMovie(movieId: string): Promise<Movie | null> {
  const match = /^cineworld-tmdb-(\d+)$/.exec(movieId);
  if (!match) return null;
  const item = await tmdbRequest<TmdbMovie>(`/movie/${match[1]}`, {});
  if (!item || typeof item.id !== "number") return null;
  return normalizeTmdbMovie(item, "world");
}
