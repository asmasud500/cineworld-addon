import type { CinemaCategoryId, Movie } from "../catalog.js";
import { rememberMovies } from "./upstream.js";

/**
 * Live "new release" discovery from TMDB (metadata only: titles, posters, dates).
 * It never creates playback links. Enabled when TMDB_API_KEY (v3 key) or
 * TMDB_READ_ACCESS_TOKEN (v4 bearer token) is set; otherwise every function returns [].
 */
const API = "https://api.themoviedb.org/3/";
const IMAGE = "https://image.tmdb.org/t/p/";
const DISCOVER_TTL_MS = 10 * 60 * 1000;
const EXTERNAL_ID_TTL_MS = 12 * 60 * 60 * 1000;
const RECENT_WINDOW_DAYS = 180;
const PAGE_SIZE = 20;

const cache = new Map<string, { expiresAt: number; value: unknown }>();

type Filter = { language?: string; country?: string };
const CATEGORY_FILTERS: Record<CinemaCategoryId, Filter> = {
  "bd-bengali": { language: "bn", country: "BD" },
  "in-bengali": { language: "bn", country: "IN" },
  bollywood: { language: "hi" },
  tamil: { language: "ta" },
  telugu: { language: "te" },
  malayalam: { language: "ml" },
  kannada: { language: "kn" },
  pakistani: { language: "ur" },
  nepali: { language: "ne" },
  "sri-lankan": { language: "si" },
  hollywood: { language: "en", country: "US" },
  korean: { language: "ko" },
  chinese: { language: "zh" },
  japanese: { language: "ja" },
  world: {}
};

interface TmdbMovie {
  id: number;
  title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
}

const GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama",
  10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western"
};

export function isTmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY?.trim() || process.env.TMDB_READ_ACCESS_TOKEN?.trim());
}

async function tmdbGet<T>(path: string, params: Record<string, string>, ttl: number): Promise<T | null> {
  const key = process.env.TMDB_API_KEY?.trim();
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (!key && !token) return null;
  const url = new URL(path, API);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const cacheKey = url.toString(); // key is added after, so it is never part of the cache key
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  if (key && !token) url.searchParams.set("api_key", key);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }
    });
    if (!response.ok) return null;
    const value = await response.json() as T;
    if (cache.size > 800) cache.clear();
    cache.set(cacheKey, { expiresAt: Date.now() + ttl, value });
    return value;
  } catch { return null; }
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Stremio/Nuvio stream add-ons need IMDb ids. Brand-new films may not have one yet, so fall back to tmdb:<id>. */
async function resolveId(tmdbId: number): Promise<{ id: string; imdbId?: string }> {
  const ext = await tmdbGet<{ imdb_id?: string | null }>(`movie/${tmdbId}/external_ids`, {}, EXTERNAL_ID_TTL_MS);
  const imdb = ext?.imdb_id;
  return imdb && /^tt\d+$/.test(imdb) ? { id: imdb, imdbId: imdb } : { id: `tmdb:${tmdbId}` };
}

export function normalizeTmdbMovie(item: TmdbMovie, categoryId: CinemaCategoryId, ids: { id: string; imdbId?: string }): Movie | null {
  const name = item.title?.trim();
  if (!name || !item.release_date) return null;
  return {
    id: ids.id,
    type: "movie",
    name,
    description: item.overview?.trim() || "Description not available yet.",
    releaseInfo: item.release_date.slice(0, 4),
    releaseDate: item.release_date,
    genres: (item.genre_ids ?? []).map((g) => GENRES[g]).filter((g): g is string => Boolean(g)),
    ...(item.poster_path ? { poster: `${IMAGE}w500${item.poster_path}` } : {}),
    ...(item.backdrop_path ? { background: `${IMAGE}w1280${item.backdrop_path}` } : {}),
    ...(ids.imdbId ? { imdbId: ids.imdbId } : {}),
    categoryIds: [categoryId],
    sourceIds: []
  };
}

/** Films already released (up to today) in the last ~6 months, newest first. */
export async function getTmdbNewReleases(categoryId: CinemaCategoryId, skip = 0): Promise<Movie[]> {
  if (!isTmdbConfigured()) return [];
  const filter = CATEGORY_FILTERS[categoryId];
  const page = Math.min(Math.floor(Math.max(0, skip) / PAGE_SIZE) + 1, 50);
  const response = await tmdbGet<{ results?: TmdbMovie[] }>("discover/movie", {
    sort_by: "primary_release_date.desc",
    include_adult: "false",
    include_video: "false",
    "primary_release_date.lte": isoDay(0),
    "primary_release_date.gte": isoDay(-RECENT_WINDOW_DAYS),
    ...(filter.language ? { with_original_language: filter.language } : {}),
    ...(filter.country ? { with_origin_country: filter.country } : {}),
    page: String(page)
  }, DISCOVER_TTL_MS);
  const results = (response?.results ?? []).filter((item) => item.poster_path);
  const movies = await Promise.all(results.map(async (item) =>
    normalizeTmdbMovie(item, categoryId, await resolveId(item.id))));
  const clean = movies.filter((movie): movie is Movie => movie !== null);
  rememberMovies(clean);
  return clean;
}
