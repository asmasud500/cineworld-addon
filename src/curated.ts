import { CINEMA_CATEGORIES } from "./catalog.js";
import type { CinemaCategoryId, Movie } from "./catalog.js";
import { loadJson, saveJson } from "./jsonStore.js";

/**
 * Films the editor has attached a source to. They are shown in the catalog rows that match their
 * language/country (and in New Releases) the moment the source is confirmed.
 */
const FILE = process.env.CURATED_FILE ?? "data/movies.json";
const MAX = 2000;
const VALID_CATEGORIES = new Set<string>(CINEMA_CATEGORIES.map((category) => category.id));
const https = (value: unknown): string | undefined => (typeof value === "string" && /^https:\/\//i.test(value) ? value.slice(0, 500) : undefined);
const str = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

/** Rebuilds a safe Movie from untrusted JSON (file or restore). Unknown fields are dropped. */
export function sanitizeMovie(value: unknown): Movie | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = str(raw.id, 120).trim();
  const name = str(raw.name, 200).trim();
  const categories = (Array.isArray(raw.categoryIds) ? raw.categoryIds : []).filter((c): c is CinemaCategoryId => typeof c === "string" && VALID_CATEGORIES.has(c));
  if (!id || !name || !categories.length) return null;
  const poster = https(raw.poster);
  const background = https(raw.background);
  return {
    id, type: "movie", name,
    description: str(raw.description, 2000) || "Description not available yet.",
    releaseInfo: str(raw.releaseInfo, 20),
    ...(typeof raw.releaseDate === "string" && !Number.isNaN(Date.parse(raw.releaseDate)) ? { releaseDate: raw.releaseDate.slice(0, 10) } : {}),
    genres: (Array.isArray(raw.genres) ? raw.genres : []).filter((g): g is string => typeof g === "string").map((g) => g.slice(0, 40)).slice(0, 10),
    ...(poster ? { poster } : {}),
    ...(background ? { background } : {}),
    ...(typeof raw.runtime === "number" && raw.runtime > 0 && raw.runtime < 1000 ? { runtime: Math.round(raw.runtime) } : {}),
    ...(/^tt\d+$/.test(id) ? { imdbId: id } : {}),
    categoryIds: [...new Set(categories)],
    sourceIds: []
  };
}

const curated: Movie[] = [];
curated.push(...(loadJson<unknown[]>(FILE, []).map(sanitizeMovie).filter((movie): movie is Movie => movie !== null).slice(0, MAX)));

function persist(): void { saveJson(FILE, curated); }

export function listCurated(): Movie[] { return [...curated]; }
export function getCuratedMovie(id: string): Movie | undefined { return curated.find((movie) => movie.id === id); }

/** Curated films of one catalog row (all when no row is given), most recently added first. */
export function getCuratedMovies(categoryId?: CinemaCategoryId, search?: string): Movie[] {
  const query = search?.trim().toLocaleLowerCase();
  return curated.filter((movie) =>
    (!categoryId || movie.categoryIds.includes(categoryId)) && (!query || movie.name.toLocaleLowerCase().includes(query)));
}

export function upsertCurated(movie: Movie): void {
  const clean = sanitizeMovie(movie);
  if (!clean) return;
  const index = curated.findIndex((item) => item.id === clean.id);
  if (index !== -1) curated.splice(index, 1);
  curated.unshift(clean);
  if (curated.length > MAX) curated.length = MAX;
  persist();
}

/** Drops films that no longer have any source. Returns the ids that were removed. */
export function pruneCurated(hasSource: (id: string) => boolean): string[] {
  const removed = curated.filter((movie) => !hasSource(movie.id)).map((movie) => movie.id);
  if (removed.length) {
    for (const id of removed) curated.splice(curated.findIndex((movie) => movie.id === id), 1);
    persist();
  }
  return removed;
}

export function replaceCurated(records: unknown): number {
  const clean = (Array.isArray(records) ? records : []).map(sanitizeMovie).filter((movie): movie is Movie => movie !== null).slice(0, MAX);
  curated.splice(0, curated.length, ...clean);
  persist();
  return clean.length;
}
