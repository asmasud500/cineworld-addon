import { loadJson, saveJson } from "./jsonStore.js";
import type { Movie } from "./catalog.js";

/**
 * Editor controls: pinned films are shown first, hidden films are removed everywhere.
 * Initial values come from HIDDEN_MOVIE_IDS / PINNED_MOVIE_IDS (comma-separated; permanent) and,
 * if present, a small JSON file. Changes made through the admin API are written to that file on a
 * best-effort basis: on hosts with a temporary disk they last until the next redeploy.
 */
export interface Overrides { pinned: string[]; hidden: string[] }

const FILE = process.env.OVERRIDES_FILE ?? "data/overrides.json";
const MAX_IDS = 500;
const MAX_ID_LENGTH = 120;

function parseList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const clean = items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item && item.length <= MAX_ID_LENGTH);
  return [...new Set(clean)].slice(0, MAX_IDS);
}

function load(): Overrides {
  const fromFile = loadJson<Partial<Overrides>>(FILE, {});
  return {
    pinned: parseList([...parseList(process.env.PINNED_MOVIE_IDS), ...parseList(fromFile.pinned)]),
    hidden: parseList([...parseList(process.env.HIDDEN_MOVIE_IDS), ...parseList(fromFile.hidden)])
  };
}

let state: Overrides = load();

export function getOverrides(): Overrides { return { pinned: [...state.pinned], hidden: [...state.hidden] }; }

export function setOverrides(input: unknown): Overrides {
  const value = (input ?? {}) as Partial<Overrides>;
  const hidden = parseList(value.hidden);
  state = { hidden, pinned: parseList(value.pinned).filter((id) => !hidden.includes(id)) };
  saveJson(FILE, state); // read-only disk: the change stays in memory only
  return getOverrides();
}

export function movieKey(movie: Movie): string { return movie.imdbId ?? movie.id; }

export function isHidden(id: string): boolean { return state.hidden.includes(id); }

/** Removes hidden films and moves pinned films to the front (in pin order). */
export function applyOverrides(movies: Movie[]): Movie[] {
  const visible = movies.filter((movie) => !state.hidden.includes(movieKey(movie)) && !state.hidden.includes(movie.id));
  const rank = (movie: Movie) => {
    const index = state.pinned.findIndex((id) => id === movieKey(movie) || id === movie.id);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return visible
    .map((movie, order) => ({ movie, order, rank: rank(movie) }))
    .sort((a, b) => (a.rank - b.rank) || (a.order - b.order))
    .map((entry) => entry.movie);
}
