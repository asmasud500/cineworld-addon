import { createServer } from "node:http";
import { addonBuilder, serveHTTP } from "stremio-addon-sdk";
import { CINEMA_CATEGORIES, getCatalog, searchCatalog } from "./catalog.js";
import { getReviewedSources } from "./sources.js";

const port = Number.parseInt(process.env.PORT ?? "7000", 10);
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;

const manifest = {
  id: "org.cineworld.legal-cinema",
  version: "0.1.0",
  name: "CineWorld",
  description: "Legal-first international cinema discovery. Playback is shown only for reviewed rights-cleared sources.",
  resources: ["catalog", "meta", "stream"],
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

const builder = new addonBuilder(manifest as any);

builder.defineCatalogHandler(({ id, extra }: { id: string; extra?: { search?: string } }) => {
  const results = extra?.search ? searchCatalog(extra.search) : getCatalog(id);
  return Promise.resolve({ metas: results.map((movie) => ({
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

builder.defineStreamHandler(({ id }: { id: string }) => {
  const sources = getReviewedSources(id);
  return Promise.resolve({ streams: sources.map((source) => ({
    title: `CineWorld · ${source.license}`,
    url: source.url,
    behaviorHints: { notWebReady: false }
  })) });
});

const addonInterface = builder.getInterface();
const server = createServer((req, res) => {
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
  serveHTTP(addonInterface, { port, hostname: "127.0.0.1" });
  // The SDK server owns its own listener; this outer server is only used for neutral JSON endpoints.
  res.writeHead(302, { location: `${publicBaseUrl}/manifest.json` });
  res.end();
});

server.listen(port, () => {
  console.log(JSON.stringify({ level: "info", event: "server_started", port, publicBaseUrl }));
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  server.close(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
