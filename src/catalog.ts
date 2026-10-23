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
  imdbId?: string;
  categoryIds: CinemaCategoryId[];
  sourceIds: string[];
}

export const MOVIES: Movie[] = [
  {
    id: "cineworld-catalog-placeholder",
    type: "movie",
    name: "CineWorld Legal Catalog",
    description: "A catalog placeholder. Reviewed legal titles will appear as verified metadata and playback sources are added.",
    releaseInfo: "2026",
    genres: ["World Cinema"],
    categoryIds: ["world"],
    sourceIds: []
  }
];

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
