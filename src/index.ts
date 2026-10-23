import { createServer } from "node:http";
import { addonBuilder, serveHTTP } from "stremio-addon-sdk";
import { CINEMA_CATEGORIES, getCatalog, searchCatalog } from "./catalog.js";
import { getReviewedSources } from "./sources.js";

const port = Number.parseInt(process.env.PORT ?? "7000", 10);
const apiPort = Number.parseInt(process.env.API_PORT ?? String(port + 1), 10);
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
const apiServer = createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", service: "cineworld-addon", version: manifest.version, playbackSources: "reviewed-only" }));
    return;
  }
  if (req.url === "/api/catalog") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ categories: CINEMA_CATEGORIES, movies: getCatalog() }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "not_found" }));
});

serveHTTP(addonInterface, { port, hostname: "0.0.0.0" });
apiServer.listen(apiPort, "0.0.0.0", () => {
  console.log(JSON.stringify({ level: "info", event: "server_started", port, apiPort, publicBaseUrl }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  apiServer.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
