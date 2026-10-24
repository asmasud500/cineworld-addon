import express from "express";
import stremioAddonSdk from "stremio-addon-sdk";
const { addonBuilder, getRouter } = stremioAddonSdk as typeof import("stremio-addon-sdk");
import { CINEMA_CATEGORIES, FEATURED_CATALOG_ID, FEATURED_CATALOG_NAME, UPCOMING_CATALOG_ID, UPCOMING_CATALOG_NAME, buildFeaturedFeed, buildUpcomingFeed, getCatalog, hasGenre, searchCatalog } from "./catalog.js";
import { createAdminRouter } from "./admin.js";
import { applyOverrides, isHidden } from "./overrides.js";
import { getReviewedSubtitles } from "./subtitles.js";
import { getReviewedSources } from "./sources.js";
import { getRememberedMovie, getUpstreamCatalog, getUpstreamMeta, getUpstreamSourceStatus, warmSeenMovies } from "./providers/upstream.js";
import { GENRE_NAMES, enrichWithTmdbDetails, getTmdbNewReleases, getWatchOptions, getTmdbUpcoming, isTmdbConfigured, searchTmdbMovies, verifyForCategory } from "./providers/tmdb.js";
import type { WatchKind } from "./providers/tmdb.js";
import type { CinemaCategoryId, Movie } from "./catalog.js";

const port = Number.parseInt(process.env.PORT ?? "7000", 10);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;

function genreExtra() { return { name: "genre", options: [...GENRE_NAMES], isRequired: false }; }

const manifest = {
  id: "org.cineworld.legal-cinema",
  version: "0.6.0",
  name: "CineWorld",
  description: "International cinema discovery powered by configurable Stremio-compatible catalog add-ons. Streams are limited to reviewed rights-cleared sources and links to official services (data from TMDB / JustWatch).",
  resources: ["catalog", "meta", "stream", "subtitles"],
  types: ["movie"],
  catalogs: [
    // First catalog = home hero / top row in Stremio and Nuvio.
    { type: "movie", id: FEATURED_CATALOG_ID, name: FEATURED_CATALOG_NAME, extra: [genreExtra(), { name: "skip", isRequired: false }] },
    { type: "movie", id: UPCOMING_CATALOG_ID, name: UPCOMING_CATALOG_NAME, extra: [genreExtra(), { name: "skip", isRequired: false }] },
    ...CINEMA_CATEGORIES.map((category) => ({
      type: "movie",
      id: category.id,
      name: category.name,
      extra: [genreExtra(), { name: "search", isRequired: false }, { name: "skip", isRequired: false }]
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
  const background = movie.background ?? movie.poster;
  const description = movie.rating ? `${movie.description}\n\nTMDB rating: ${movie.rating}/10` : movie.description;
  return {
    ...toMetaPreview(movie),
    description,
    ...(movie.imdbId ? { imdb_id: movie.imdbId } : {}),
    ...(background ? { background } : {}),
    ...(movie.releaseDate ? { released: new Date(movie.releaseDate).toISOString() } : {}),
    ...(movie.runtime ? { runtime: `${movie.runtime} min` } : {}),
    ...(movie.director?.length ? { director: movie.director } : {}),
    ...(movie.cast?.length ? { cast: movie.cast } : {}),
    ...(movie.trailerKey ? { trailers: [{ source: movie.trailerKey, type: "Trailer" }], trailerStreams: [{ title: `${movie.name} – Trailer`, ytId: movie.trailerKey }] } : {})
  };
}

const FEED_TTL_MS = 10 * 60 * 1000;
const FEED_EMPTY_TTL_MS = 60 * 1000;
const FEED_KEYS_LIMIT = 40;

/** Small cache with shared in-flight work: concurrent requests reuse one build, and a failed refresh keeps the last good result. */
function cachedFeed(build: (genre?: string) => Promise<Movie[]>) {
  const store = new Map<string, { expiresAt: number; movies: Movie[] }>();
  const inFlight = new Map<string, Promise<Movie[]>>();
  return async (genre?: string): Promise<Movie[]> => {
    const key = genre?.toLocaleLowerCase() ?? "";
    const hit = store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.movies;
    let work = inFlight.get(key);
    if (!work) {
      work = build(genre).then((movies) => {
        if (movies.length || !store.has(key)) {
          if (store.size >= FEED_KEYS_LIMIT) store.clear();
          store.set(key, { movies, expiresAt: Date.now() + (movies.length ? FEED_TTL_MS : FEED_EMPTY_TTL_MS) });
        }
        return store.get(key)?.movies ?? movies;
      }).finally(() => { inFlight.delete(key); });
      inFlight.set(key, work);
    }
    return work;
  };
}

const getFeed = cachedFeed(async (genre) => {
  const lists = await Promise.all(CINEMA_CATEGORIES.flatMap((category) => [
    getTmdbNewReleases(category.id, 0, genre).catch(() => [] as Movie[]),
    getUpstreamCatalog(category.id).then((list) => verifyForCategory(list, category.id, 12)).catch(() => [] as Movie[])
  ]));
  const feed = buildFeaturedFeed([getCatalog(), ...lists]);
  return genre ? feed.filter((movie) => hasGenre(movie, genre)) : feed;
});

const getUpcoming = cachedFeed(async (genre) => {
  const lists = await Promise.all(CINEMA_CATEGORIES.map((category) => getTmdbUpcoming(category.id, genre).catch(() => [] as Movie[])));
  return buildUpcomingFeed(lists);
});

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

function genreFrom(value?: string): string | undefined {
  const wanted = value?.trim().toLocaleLowerCase();
  return GENRE_NAMES.find((name) => name.toLocaleLowerCase() === wanted);
}

builder.defineCatalogHandler(async ({ id, extra }: { id: string; extra?: { search?: string; skip?: string; genre?: string } }) => {
  const skip = Math.max(0, Number.parseInt(extra?.skip ?? "0", 10) || 0);
  const genre = genreFrom(extra?.genre);
  if (id === FEATURED_CATALOG_ID) {
    // Automatic feed: newest movies across every category (cached for 10 minutes).
    const feed = applyOverrides(await getFeed(genre));
    return { metas: feed.slice(skip, skip + 100).map(toMetaPreview) };
  }
  if (id === UPCOMING_CATALOG_ID) {
    const upcoming = applyOverrides(await getUpcoming(genre));
    return { metas: upcoming.slice(skip, skip + 100).map(toMetaPreview) };
  }
  const categoryId = categoryIdFrom(id);
  const search = extra?.search?.trim().slice(0, 100) || undefined;
  const [fresh, upstream] = await Promise.all([
    (search ? searchTmdbMovies(search, categoryId) : getTmdbNewReleases(categoryId, skip, genre)).catch(() => [] as Movie[]),
    getUpstreamCatalog(categoryId, skip, search).then((list) => verifyForCategory(list, categoryId)).catch(() => [] as Movie[])
  ]);
  const remote = [...fresh, ...upstream]; // brand-new releases first
  const local = search ? searchCatalog(search) : getCatalog(id).slice(skip, skip + 100);
  const unique = new Map<string, Movie>();
  for (const movie of [...local, ...remote]) unique.set(movie.imdbId ?? movie.id, movie);
  const movies = [...unique.values()].filter((movie) => !genre || hasGenre(movie, genre));
  return { metas: applyOverrides(movies).slice(0, 100).map(toMetaPreview) };
});

builder.defineMetaHandler(async ({ type, id }: { type: string; id: string }) => {
  if (type !== "movie" || !id || id.length > 120 || isHidden(id)) return { meta: null };
  const answer = async (movie: Movie) => ({ meta: toMeta(await enrichWithTmdbDetails(movie).catch(() => movie)) });
  const local = getCatalog().find((item) => (item.imdbId ?? item.id) === id && item.type === type);
  if (local) return answer(local);
  // 1) Anything we already listed in a catalog is answered directly.
  const seen = getRememberedMovie(id);
  if (seen) return answer(seen);
  // 2) Ask the upstream add-ons for details.
  const remote = await getUpstreamMeta(id, type);
  if (remote) return answer(remote);
  // 3) Cold start: rebuild the remembered set from the catalogs and try again.
  await warmCatalogs();
  const warmed = getRememberedMovie(id);
  return warmed ? answer(warmed) : { meta: null };
});

builder.defineSubtitlesHandler(({ id }: { id: string }) => Promise.resolve({
  subtitles: getReviewedSubtitles(id).map((record) => ({ id: record.id, url: record.url, lang: record.lang }))
}));

const WATCH_LABELS: Record<WatchKind, string> = {
  flatrate: "Subscription", free: "Free", ads: "Free with ads", rent: "Rent", buy: "Buy"
};

builder.defineStreamHandler(async ({ id }: { id: string }) => {
  if (isHidden(id)) return { streams: [] };
  const reviewed = getReviewedSources(id).map((source) => ({
    title: `${source.title} · ${source.license}`,
    url: source.url,
    behaviorHints: { notWebReady: false }
  }));
  // Official services only: each entry opens the legal provider's page (data from TMDB / JustWatch).
  const options = await getWatchOptions(id).catch(() => []);
  const official = options.slice(0, 12).map((option) => ({
    name: "CineWorld",
    title: `${option.provider} · ${WATCH_LABELS[option.kind]} · ${option.region}\nOpens the official page (via JustWatch)`,
    externalUrl: option.link
  }));
  return { streams: [...reviewed, ...official] };
});

const addonInterface = builder.getInterface();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => { res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-methods", "GET, OPTIONS"); res.setHeader("access-control-allow-headers", "content-type"); if (req.method === "OPTIONS") { res.status(204).end(); return; } next(); });
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "cineworld-addon", version: manifest.version, tmdbNewReleases: isTmdbConfigured(), ...getUpstreamSourceStatus() });
});
app.get("/api/catalog", (_req, res) => {
  res.json({ categories: CINEMA_CATEGORIES, movies: getCatalog() });
});
app.use(createAdminRouter({
  getFeed: () => getFeed(),
  searchMovies: (query) => searchTmdbMovies(query, "world")
}));
app.use("/", getRouter(addonInterface));
app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });

const server = app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", event: "server_started", port, publicBaseUrl }));
});

// Free hosts put idle services to sleep, which makes the first request slow. Pinging our own public
// address every 10 minutes keeps the service awake. Render provides RENDER_EXTERNAL_URL automatically.
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL ?? publicBaseUrl;
if (process.env.KEEP_ALIVE !== "false" && /^https:\/\//i.test(keepAliveUrl) && !/localhost|127\.0\.0\.1/.test(keepAliveUrl)) {
  const timer = setInterval(() => {
    fetch(new URL("/api/health", keepAliveUrl), { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }, 10 * 60 * 1000);
  timer.unref();
}

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
