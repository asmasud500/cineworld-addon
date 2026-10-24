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
  original_language?: string;
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

const GENRE_IDS = new Map(Object.entries(GENRES).map(([id, name]) => [name.toLocaleLowerCase(), id]));
export const GENRE_NAMES = Object.values(GENRES).filter((name) => name !== "TV Movie");

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
export async function getTmdbNewReleases(categoryId: CinemaCategoryId, skip = 0, genre?: string): Promise<Movie[]> {
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
    ...(genre && GENRE_IDS.has(genre.toLocaleLowerCase()) ? { with_genres: GENRE_IDS.get(genre.toLocaleLowerCase())! } : {}),
    page: String(page)
  }, DISCOVER_TTL_MS);
  const results = (response?.results ?? []).filter((item) => item.poster_path);
  const movies = await Promise.all(results.map(async (item) =>
    normalizeTmdbMovie(item, categoryId, await resolveId(item.id))));
  const clean = movies.filter((movie): movie is Movie => movie !== null);
  rememberMovies(clean);
  return clean;
}

/**
 * Strict category check for movies that come from the upstream add-ons.
 * Upstream catalogs only say "Bengali" or "trending", so a film could land in the wrong row
 * (e.g. West Bengal films under Bangladesh). With a TMDB key each film is looked up by its IMDb id
 * and kept only if its original language (and origin country, where the category has one) matches.
 * Anything that cannot be verified is dropped instead of guessed. "World Cinema" is not filtered.
 */
export async function verifyForCategory(movies: Movie[], categoryId: CinemaCategoryId, maxChecked = 30, budgetMs = 6000): Promise<Movie[]> {
  const filter = CATEGORY_FILTERS[categoryId];
  if (!filter.language && !filter.country) return movies;
  if (!isTmdbConfigured()) {
    // Without TMDB we cannot tell Bangladesh from West Bengal, so show it only in the West Bengal row.
    return categoryId === "bd-bengali" ? [] : movies;
  }
  const candidates = movies.slice(0, maxChecked);
  const verdicts = new Array<boolean>(candidates.length).fill(false);
  const deadline = Date.now() + budgetMs;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < candidates.length && Date.now() < deadline) {
      const index = next++;
      verdicts[index] = await matchesCategory(candidates[index]!, filter);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  return candidates.filter((_, index) => verdicts[index]);
}

async function matchesCategory(movie: Movie, filter: Filter): Promise<boolean> {
  const imdbId = movie.imdbId;
  if (!imdbId) return false;
  const found = await tmdbGet<{ movie_results?: Array<{ id: number; original_language?: string }> }>(
    `find/${imdbId}`, { external_source: "imdb_id" }, EXTERNAL_ID_TTL_MS);
  const match = found?.movie_results?.[0];
  if (!match) return false;
  if (filter.language && match.original_language !== filter.language) return false;
  if (!filter.country) return true;
  const details = await tmdbGet<{ origin_country?: string[]; production_countries?: Array<{ iso_3166_1?: string }> }>(
    `movie/${match.id}`, {}, EXTERNAL_ID_TTL_MS);
  const countries = details?.origin_country ?? details?.production_countries?.map((c) => c.iso_3166_1 ?? "") ?? [];
  return countries.includes(filter.country);
}

/** Films that have not been released yet (next ~120 days), soonest first. */
export async function getTmdbUpcoming(categoryId: CinemaCategoryId, genre?: string): Promise<Movie[]> {
  if (!isTmdbConfigured()) return [];
  const filter = CATEGORY_FILTERS[categoryId];
  const response = await tmdbGet<{ results?: TmdbMovie[] }>("discover/movie", {
    sort_by: "primary_release_date.asc",
    include_adult: "false",
    include_video: "false",
    "primary_release_date.gte": isoDay(1),
    "primary_release_date.lte": isoDay(120),
    ...(filter.language ? { with_original_language: filter.language } : {}),
    ...(filter.country ? { with_origin_country: filter.country } : {}),
    ...(genre && GENRE_IDS.has(genre.toLocaleLowerCase()) ? { with_genres: GENRE_IDS.get(genre.toLocaleLowerCase())! } : {}),
    page: "1"
  }, DISCOVER_TTL_MS);
  const results = (response?.results ?? []).filter((item) => item.poster_path).slice(0, 20);
  const movies = await Promise.all(results.map(async (item) =>
    normalizeTmdbMovie(item, categoryId, await resolveId(item.id))));
  const clean = movies.filter((movie): movie is Movie => movie !== null);
  rememberMovies(clean);
  return clean;
}

/** Title search on TMDB, restricted to the category's language (and country, when the category has one). */
export async function searchTmdbMovies(query: string, categoryId: CinemaCategoryId): Promise<Movie[]> {
  const text = query.trim().slice(0, 100);
  if (!isTmdbConfigured() || !text) return [];
  const filter = CATEGORY_FILTERS[categoryId];
  const response = await tmdbGet<{ results?: TmdbMovie[] }>("search/movie", { query: text, include_adult: "false", page: "1" }, DISCOVER_TTL_MS);
  let results = (response?.results ?? []).filter((item) => item.release_date && item.poster_path);
  if (filter.language) results = results.filter((item) => item.original_language === filter.language);
  results = results.slice(0, 12);
  if (filter.country) {
    const keep = await Promise.all(results.map(async (item) => {
      const details = await tmdbGet<{ origin_country?: string[]; production_countries?: Array<{ iso_3166_1?: string }> }>(`movie/${item.id}`, {}, EXTERNAL_ID_TTL_MS);
      const countries = details?.origin_country ?? details?.production_countries?.map((c) => c.iso_3166_1 ?? "") ?? [];
      return countries.includes(filter.country!);
    }));
    results = results.filter((_, index) => keep[index]);
  }
  const movies = await Promise.all(results.map(async (item) => normalizeTmdbMovie(item, categoryId, await resolveId(item.id))));
  const clean = movies.filter((movie): movie is Movie => movie !== null);
  rememberMovies(clean);
  return clean;
}

type TmdbDetails = {
  overview?: string; runtime?: number | null; vote_average?: number; vote_count?: number; backdrop_path?: string | null;
  credits?: { cast?: Array<{ name?: string }>; crew?: Array<{ name?: string; job?: string }> };
  videos?: { results?: Array<{ site?: string; type?: string; key?: string; official?: boolean }> };
};

/** Extra details for a movie page: cast, director, runtime, rating and a YouTube trailer. Returns the movie unchanged if TMDB has nothing. */
export async function enrichWithTmdbDetails(movie: Movie): Promise<Movie> {
  if (!isTmdbConfigured()) return movie;
  let tmdbId: number | null = null;
  if (movie.id.startsWith("tmdb:")) tmdbId = Number.parseInt(movie.id.slice(5), 10) || null;
  else if (movie.imdbId) {
    const found = await tmdbGet<{ movie_results?: Array<{ id: number }> }>(`find/${movie.imdbId}`, { external_source: "imdb_id" }, EXTERNAL_ID_TTL_MS);
    tmdbId = found?.movie_results?.[0]?.id ?? null;
  }
  if (!tmdbId) return movie;
  const details = await tmdbGet<TmdbDetails>(`movie/${tmdbId}`, { append_to_response: "credits,videos" }, EXTERNAL_ID_TTL_MS);
  if (!details) return movie;
  const trailer = details.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official && v.key)
    ?? details.videos?.results?.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.key);
  const directors = (details.credits?.crew ?? []).filter((c) => c.job === "Director" && c.name).map((c) => c.name!).slice(0, 3);
  const cast = (details.credits?.cast ?? []).filter((c) => c.name).map((c) => c.name!).slice(0, 10);
  return {
    ...movie,
    ...(details.overview?.trim() && /not (provided|available)/i.test(movie.description) ? { description: details.overview.trim() } : {}),
    ...(details.runtime ? { runtime: details.runtime } : {}),
    ...(directors.length ? { director: directors } : {}),
    ...(cast.length ? { cast } : {}),
    ...(trailer?.key ? { trailerKey: trailer.key } : {}),
    ...(details.vote_count && details.vote_count >= 5 && details.vote_average ? { rating: Math.round(details.vote_average * 10) / 10 } : {}),
    ...(!movie.background && details.backdrop_path ? { background: `${IMAGE}w1280${details.backdrop_path}` } : {})
  };
}
