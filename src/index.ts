import express from "express";
import { addonBuilder, getRouter } from "stremio-addon-sdk";
import { CINEMA_CATEGORIES, getCatalog, searchCatalog } from "./catalog.js";
import { getReviewedSources } from "./sources.js";

const port = Number.parseInt(process.env.PORT ?? "7000", 10);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;

const manifest = {
  id: "org.cineworld.legal-cinema",
  version: "0.1.0",
  name: "CineWorld",
  description: "Legal-first international cinema discovery. Playback is shown only for reviewed rights-cleared sources.",
  resources: ["catalog", "meta", "stream", "subtitles"],
  types: ["movie"],
  catalogs: CINEMA_CATEGORIES.map((category) => ({
    type: "movie",
    id: category.id,
    name: category.name,
    extra: [{ name: "search", isRequired: false }]
  })),
  idPrefixes: ["tt", "cineworld-"],
  behaviorHints: { configurable: false, configurationRequired: false }
};

const builder = addonBuilder(manifest as any);

builder.defineCatalogHandler(({ id, extra }: { id: string; extra?: { search?: string } }) => {
  const results = extra?.search ? searchCatalog(extra.search) : getCatalog(id);
  const skip = Math.max(0, Number.parseInt((extra as { skip?: string } | undefined)?.skip ?? "0", 10) || 0);
  const page = results.slice(skip, skip + 100);
  return Promise.resolve({ metas: page.map((movie) => ({
    id: movie.imdbId ?? movie.id,
    type: movie.type,
    name: movie.name,
    description: movie.description,
    releaseInfo: movie.releaseInfo,
    genres: movie.genres,
    poster: movie.poster
  })) });
});

builder.defineMetaHandler(({ type, id }: { type: string; id: string }) => {
  const movie = getCatalog().find((item) => (item.imdbId ?? item.id) === id && item.type === type);
  if (!movie) return Promise.resolve({ meta: null });
  return Promise.resolve({ meta: {
    id: movie.imdbId ?? movie.id,
    type: movie.type,
    name: movie.name,
    description: movie.description,
    releaseInfo: movie.releaseInfo,
    genres: movie.genres,
    poster: movie.poster
  } });
});

builder.defineSubtitlesHandler(() => Promise.resolve({ subtitles: [] }));

builder.defineStreamHandler(({ id }: { id: string }) => {
  const sources = getReviewedSources(id);
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
app.use("/", getRouter(addonInterface));
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "cineworld-addon", version: manifest.version, playbackSources: "reviewed-only" });
});
app.get("/api/catalog", (_req, res) => {
  res.json({ categories: CINEMA_CATEGORIES, movies: getCatalog() });
});
app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });

const server = app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", event: "server_started", port, publicBaseUrl }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
