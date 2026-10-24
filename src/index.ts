import express from "express";
import stremioAddonSdk from "stremio-addon-sdk";
const { addonBuilder, getRouter } = stremioAddonSdk as typeof import("stremio-addon-sdk");
import { CINEMA_CATEGORIES, FEATURED_CATALOG_ID, FEATURED_CATALOG_NAME, buildFeaturedFeed, getCatalog, searchCatalog } from "./catalog.js";
import { getReviewedSources } from "./sources.js";
import { getRememberedMovie, getUpstreamCatalog, getUpstreamMeta, getUpstreamSourceStatus, warmSeenMovies } from "./providers/upstream.js";
import { getTmdbNewReleases, isTmdbConfigured, verifyForCategory } from "./providers/tmdb.js";
import type { CinemaCategoryId, Movie } from "./catalog.js";

const port = Number.parseInt(process.env.PORT ?? "7000", 10);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;

const manifest = {
  id: "org.cineworld.legal-cinema",
  version: "0.3.2",
  name: "CineWorld",
  description: "International cinema discovery powered by configurable Stremio-compatible catalog add-ons. Playback is shown only for reviewed rights-cleared sources.",
  resources: ["catalog", "meta", "stream", "subtitles"],
  types: ["movie"],
  catalogs: [
    // First catalog = home hero / top row in Stremio and Nuvio.
    { type: "movie", id: FEATURED_CATALOG_ID, name: FEATURED_CATALOG_NAME, extra: [{ name: "skip", isRequired: false }] },
    ...CINEMA_CATEGORIES.map((category) => ({
      type: "movie",
      id: category.id,
      name: category.name,
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }))
  ],
  behaviorHints: { configurable: false, configurationRequired: false }
};

const builder = addonBuilder(manifest as any);

function toMetaPreview(movie: Movie) {
  return {
    id: movie.imdbId ?? movie.id,
    type: movie.type,
    name: movie.name,
    description: movie.description,
    releaseInfo: movie.releaseInfo,
    genres: movie.genres,
    poster: movie.poster,
    ...(movie.poster ? { background: movie.background ?? movie.poster } : {})
  };
}

function toMeta(movie: Movie) {
  return { ...toMetaPreview(movie), ...(movie.imdbId ? { imdb_id: movie.imdbId } : {}), ...((movie.background ?? movie.poster) ? { background: movie.background ?? movie.poster } : {}) };
}

const FEED_TTL_MS = 10 * 60 * 1000;
const FEED_EMPTY_TTL_MS = 60 * 1000;
let feedCache: { expiresAt: number; movies: Movie[] } | null = null;
let feedInFlight: Promise<Movie[]> | null = null;

async function buildFeed(): Promise<Movie[]> {
  const lists = await Promise.all(CINEMA_CATEGORIES.flatMap((category) => [
    getTmdbNewReleases(category.id).catch(() => [] as Movie[]),
    getUpstreamCatalog(category.id).then((list) => verifyForCategory(list, category.id, 12)).catch(() => [] as Movie[])
  ]));
  return buildFeaturedFeed([getCatalog(), ...lists]);
}

/** One shared, cached feed: concurrent requests reuse the same work, and a failed refresh keeps the last good feed. */
async function getFeed(): Promise<Movie[]> {
  if (feedCache && feedCache.expiresAt > Date.now()) return feedCache.movies;
  feedInFlight ??= buildFeed().then((movies) => {
    if (movies.length || !feedCache) feedCache = { movies, expiresAt: Date.now() + (movies.length ? FEED_TTL_MS : FEED_EMPTY_TTL_MS) };
    return feedCache?.movies ?? movies;
  }).finally(() => { feedInFlight = null; });
  return feedInFlight;
}

const WARM_INTERVAL_MS = 5 * 60 * 1000;
let warmInFlight: Promise<void> | null = null;
let lastWarmAt = 0;

/** Rebuilds the remembered-movie set after a restart; throttled so unknown ids cannot trigger it repeatedly. */
async function warmCatalogs(): Promise<void> {
  if (warmInFlight) return warmInFlight;
  if (Date.now() - lastWarmAt < WARM_INTERVAL_MS) return;
  const categoryIds = CINEMA_CATEGORIES.map((category) => category.id);
  warmInFlight = Promise.allSettled([warmSeenMovies(categoryIds), ...categoryIds.map((categoryId) => getTmdbNewReleases(categoryId))])
    .then(() => undefined)
    .finally(() => { lastWarmAt = Date.now(); warmInFlight = null; });
  return warmInFlight;
}

function categoryIdFrom(value: string): CinemaCategoryId {
  return CINEMA_CATEGORIES.some((category) => category.id === value) ? value as CinemaCategoryId : "world";
}

builder.defineCatalogHandler(async ({ id, extra }: { id: string; extra?: { search?: string; skip?: string } }) => {
  const skip = Math.max(0, Number.parseInt(extra?.skip ?? "0", 10) || 0);
  if (id === FEATURED_CATALOG_ID) {
    // Automatic feed: newest movies across every category (cached for 10 minutes).
    const feed = await getFeed();
    return { metas: feed.slice(skip, skip + 100).map(toMetaPreview) };
  }
  const categoryId = categoryIdFrom(id);
  const [fresh, upstream] = await Promise.all([
    extra?.search ? Promise.resolve([] as Movie[]) : getTmdbNewReleases(categoryId, skip).catch(() => [] as Movie[]),
    getUpstreamCatalog(categoryId, skip, extra?.search).then((list) => verifyForCategory(list, categoryId)).catch(() => [] as Movie[])
  ]);
  const remote = [...fresh, ...upstream]; // brand-new releases first
  const local = extra?.search ? searchCatalog(extra.search) : getCatalog(id).slice(skip, skip + 100);
  const unique = new Map<string, Movie>();
  for (const movie of [...local, ...remote]) unique.set(movie.imdbId ?? movie.id, movie);
  return { metas: [...unique.values()].slice(0, 100).map(toMetaPreview) };
});

builder.defineMetaHandler(async ({ type, id }: { type: string; id: string }) => {
  if (type !== "movie" || !id || id.length > 120) return { meta: null };
  const local = getCatalog().find((item) => (item.imdbId ?? item.id) === id && item.type === type);
  if (local) return { meta: toMeta(local) };
  // 1) Anything we already listed in a catalog is answered directly.
  const seen = getRememberedMovie(id);
  if (seen) return { meta: toMeta(seen) };
  // 2) Ask the upstream add-ons for details.
  const remote = await getUpstreamMeta(id, type);
  if (remote) return { meta: toMeta(remote) };
  // 3) Cold start: rebuild the remembered set from the catalogs and try again.
  await warmCatalogs();
  const warmed = getRememberedMovie(id);
  return { meta: warmed ? toMeta(warmed) : null };
});

builder.defineSubtitlesHandler(() => Promise.resolve({ subtitles: [] }));

builder.defineStreamHandler(({ id }: { id: string }) => {
  const movie = getCatalog().find((item) => (item.imdbId ?? item.id) === id);
  const sources = movie ? getReviewedSources(movie.id) : [];
  return Promise.resolve({ streams: sources.map((source) => ({
    title: `CineWorld · ${source.license}`,
    url: source.url,
    behaviorHints: { notWebReady: false }
  })) });
});

const addonInterface = builder.getInterface();
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => { res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-methods", "GET, OPTIONS"); res.setHeader("access-control-allow-headers", "content-type"); if (req.method === "OPTIONS") { res.status(204).end(); return; } next(); });
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "cineworld-addon", version: manifest.version, tmdbNewReleases: isTmdbConfigured(), ...getUpstreamSourceStatus() });
});
app.get("/api/catalog", (_req, res) => {
  res.json({ categories: CINEMA_CATEGORIES, movies: getCatalog() });
});
app.use("/", getRouter(addonInterface));
app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });

const server = app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", event: "server_started", port, publicBaseUrl }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  server.close(() => process.exit(0));
}
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ level: "error", event: "unhandled_rejection", reason: String(reason) }));
});
process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ level: "error", event: "uncaught_exception", message: error.message }));
  shutdown("uncaughtException");
});
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
