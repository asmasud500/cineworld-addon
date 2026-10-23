export const CINEMA_CATEGORIES = [
  { id: "bd-bengali", name: "Bangladesh Bengali Cinema", country: "Bangladesh", language: "bn" },
  { id: "in-bengali", name: "West Bengal Bengali Cinema", country: "India", language: "bn" },
  { id: "bollywood", name: "Bollywood", country: "India", language: "hi" },
  { id: "tamil", name: "Tamil Cinema", country: "India", language: "ta" },
  { id: "telugu", name: "Telugu Cinema", country: "India", language: "te" },
  { id: "malayalam", name: "Malayalam Cinema", country: "India", language: "ml" },
  { id: "kannada", name: "Kannada Cinema", country: "India", language: "kn" },
  { id: "pakistani", name: "Pakistani Cinema", country: "Pakistan", language: "ur" },
  { id: "nepali", name: "Nepali Cinema", country: "Nepal", language: "ne" },
  { id: "sri-lankan", name: "Sri Lankan Cinema", country: "Sri Lanka", language: "si" },
  { id: "hollywood", name: "Hollywood", country: "United States", language: "en" },
  { id: "korean", name: "Korean Cinema", country: "South Korea", language: "ko" },
  { id: "chinese", name: "Chinese Cinema", country: "China", language: "zh" },
  { id: "japanese", name: "Japanese Cinema", country: "Japan", language: "ja" },
  { id: "world", name: "World Cinema", country: "International", language: "mul" }
] as const;

export type CinemaCategoryId = typeof CINEMA_CATEGORIES[number]["id"];

export interface Movie {
  id: string;
  type: "movie";
  name: string;
  description: string;
  releaseInfo: string;
  genres: string[];
  poster?: string;
  background?: string;
  releaseDate?: string;
  imdbId?: string;
  categoryIds: CinemaCategoryId[];
  sourceIds: string[];
}

export const MOVIES: Movie[] = [];

export function getCatalog(categoryId?: string): Movie[] {
  if (!categoryId) return MOVIES;
  return MOVIES.filter((movie) => movie.categoryIds.includes(categoryId as CinemaCategoryId));
}

export function searchCatalog(query: string): Movie[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return MOVIES.filter((movie) =>
    movie.name.toLocaleLowerCase().includes(normalized) ||
    movie.description.toLocaleLowerCase().includes(normalized) ||
    movie.genres.some((genre) => genre.toLocaleLowerCase().includes(normalized))
  );
}

/** Id of the automatic "newest first" catalog. Listed first in the manifest so clients use it for the home hero. */
export const FEATURED_CATALOG_ID = "new-releases";
export const FEATURED_CATALOG_NAME = "New Releases";
export const FEATURED_LIMIT = 100;

/** Exact release date when known, otherwise the first day of the release year (0 when unknown). */
function releaseTime(movie: Movie): number {
  const exact = movie.releaseDate ? Date.parse(movie.releaseDate) : Number.NaN;
  if (!Number.isNaN(exact)) return exact;
  const match = movie.releaseInfo.match(/\d{4}/);
  return match ? Date.UTC(Number.parseInt(match[0], 10), 0, 1) : 0;
}

/**
 * Merge several category lists into one newest-first feed.
 * Categories are interleaved round-robin first, then stably sorted by year,
 * so one language cannot crowd out the others within the same year.
 */
export function buildFeaturedFeed(lists: Movie[][], limit = FEATURED_LIMIT): Movie[] {
  const interleaved: Movie[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) for (const list of lists) if (list[i]) interleaved.push(list[i]);
  const unique = new Map<string, Movie>();
  for (const movie of interleaved) if (!unique.has(movie.imdbId ?? movie.id)) unique.set(movie.imdbId ?? movie.id, movie);
  return [...unique.values()].sort((a, b) => releaseTime(b) - releaseTime(a)).slice(0, limit);
}
