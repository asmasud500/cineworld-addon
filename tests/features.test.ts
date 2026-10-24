import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep test data out of the real data/ folder. Must run before the modules below are imported.
vi.hoisted(() => {
  process.env.SOURCES_FILE = "/tmp/cineworld-test/sources.json";
  process.env.SUBTITLES_FILE = "/tmp/cineworld-test/subtitles.json";
  process.env.OVERRIDES_FILE = "/tmp/cineworld-test/overrides.json";
  process.env.CURATED_FILE = "/tmp/cineworld-test/movies.json";
});
import type { AddressInfo } from "node:net";
import express from "express";
import { buildUpcomingFeed, hasGenre } from "../src/catalog.js";
import type { Movie } from "../src/catalog.js";
import { enrichWithTmdbDetails, getTmdbUpcoming, searchTmdbMovies, getTmdbNewReleases } from "../src/providers/tmdb.js";
import { applyOverrides, getOverrides, setOverrides } from "../src/overrides.js";
import { getReviewedSubtitles, validateSubtitle } from "../src/subtitles.js";
import type { SubtitleRecord } from "../src/subtitles.js";
import { createAdminRouter } from "../src/admin.js";

const mk = (id: string, extra: Partial<Movie> = {}): Movie => ({ id, type: "movie", name: id, description: "Description not provided by the catalog add-on.", releaseInfo: "2026", genres: [], categoryIds: ["world"], sourceIds: [], ...extra });

describe("TMDB search, upcoming, genre and details", () => {
  beforeEach(() => { process.env.TMDB_API_KEY = "k"; });
  afterEach(() => { delete process.env.TMDB_API_KEY; vi.unstubAllGlobals(); });

  it("search keeps only the category language and country", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/search/movie")) return new Response(JSON.stringify({ results: [
        { id: 1, title: "Dhaka Film", original_language: "bn", release_date: "2026-01-01", poster_path: "/a.jpg" },
        { id: 2, title: "Kolkata Film", original_language: "bn", release_date: "2026-01-02", poster_path: "/b.jpg" },
        { id: 3, title: "Hindi Film", original_language: "hi", release_date: "2026-01-03", poster_path: "/c.jpg" }
      ] }), { status: 200 });
      if (url.includes("/movie/1?")) return new Response(JSON.stringify({ origin_country: ["BD"] }), { status: 200 });
      if (url.includes("/movie/2?")) return new Response(JSON.stringify({ origin_country: ["IN"] }), { status: 200 });
      if (url.includes("/external_ids")) return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
      return new Response("no", { status: 404 });
    }));
    const found = await searchTmdbMovies("film", "bd-bengali");
    expect(found.map((m) => m.name)).toEqual(["Dhaka Film"]);
  });

  it("upcoming asks for future dates in ascending order; genre maps to with_genres", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.includes("/discover/movie")) return new Response(JSON.stringify({ results: [{ id: 5, title: "Soon", release_date: "2026-11-20", poster_path: "/s.jpg" }] }), { status: 200 });
      return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
    }));
    const upcoming = await getTmdbUpcoming("korean", "Horror");
    expect(upcoming[0]?.releaseDate).toBe("2026-11-20");
    const discover = urls.find((u) => u.includes("/discover/movie")) ?? "";
    expect(discover).toContain("sort_by=primary_release_date.asc");
    expect(discover).toContain("with_genres=27");
    expect(discover).toContain("with_original_language=ko");
    await getTmdbNewReleases("korean", 0, "Comedy");
    expect(urls.some((u) => u.includes("with_genres=35"))).toBe(true);
  });

  it("details add cast, director, runtime, trailer and rating", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/movie/77?")) return new Response(JSON.stringify({
        overview: "Real overview", runtime: 125, vote_average: 7.46, vote_count: 120,
        credits: { cast: [{ name: "Actor A" }, { name: "Actor B" }], crew: [{ name: "Dir X", job: "Director" }, { name: "Edit Y", job: "Editor" }] },
        videos: { results: [{ site: "YouTube", type: "Teaser", key: "teaser1" }, { site: "YouTube", type: "Trailer", key: "trail1", official: true }] }
      }), { status: 200 });
      return new Response("no", { status: 404 });
    }));
    const enriched = await enrichWithTmdbDetails(mk("tmdb:77"));
    expect(enriched).toMatchObject({ runtime: 125, director: ["Dir X"], cast: ["Actor A", "Actor B"], trailerKey: "trail1", rating: 7.5, description: "Real overview" });
  });

  it("details do nothing without a TMDB key", async () => {
    delete process.env.TMDB_API_KEY;
    const movie = mk("tmdb:77");
    expect(await enrichWithTmdbDetails(movie)).toBe(movie);
  });
});

describe("catalog helpers", () => {
  it("genre match ignores case; upcoming is soonest first with unknown dates last", () => {
    expect(hasGenre(mk("a", { genres: ["Drama"] }), "drama")).toBe(true);
    expect(hasGenre(mk("a", { genres: ["Drama"] }), "horror")).toBe(false);
    const feed = buildUpcomingFeed([[mk("later", { releaseDate: "2026-12-01" }), mk("nodate")], [mk("soon", { releaseDate: "2026-11-01" }), mk("later", { releaseDate: "2026-12-01" })]]);
    expect(feed.map((m) => m.id)).toEqual(["soon", "later", "nodate"]);
  });
});

describe("pin and hide", () => {
  afterEach(() => { setOverrides({}); });
  it("hides films, pins films first, and a hidden film cannot also be pinned", () => {
    setOverrides({ pinned: ["c", "b"], hidden: ["a", "b"] });
    expect(getOverrides()).toEqual({ pinned: ["c"], hidden: ["a", "b"] });
    expect(applyOverrides([mk("a"), mk("b"), mk("x"), mk("c")]).map((m) => m.id)).toEqual(["c", "x"]);
  });
  it("ignores junk input", () => {
    setOverrides({ pinned: [1, null, "ok", "x".repeat(500)], hidden: "not-an-array-but-a-string,two" } as never);
    expect(getOverrides()).toEqual({ pinned: ["ok"], hidden: ["not-an-array-but-a-string", "two"] });
  });
});

describe("subtitle registry", () => {
  const good: SubtitleRecord = { id: "s1", movieId: "tt1", lang: "ben", url: "https://archive.org/download/x/x.bn.srt", host: "archive.org", license: "public-domain", rightsEvidenceUrl: "https://archive.org/details/x", reviewed: true, reviewedAt: "2026-10-24" };
  it("serves only reviewed records on allowlisted hosts", () => {
    expect(validateSubtitle(good).valid).toBe(true);
    expect(getReviewedSubtitles("tt1", [good]).map((r) => r.id)).toEqual(["s1"]);
    expect(validateSubtitle({ ...good, host: "evil.example", url: "https://evil.example/a.srt" }).valid).toBe(false);
    expect(validateSubtitle({ ...good, reviewed: false }).valid).toBe(false);
    expect(validateSubtitle({ ...good, url: "https://archive.org/download/x/movie.mp4" }).valid).toBe(false);
    expect(validateSubtitle({ ...good, lang: "bn" }).valid).toBe(false);
    expect(getReviewedSubtitles("tt-other", [good])).toEqual([]);
  });
});

describe("admin API", () => {
  let server: ReturnType<typeof app.listen>;
  const app = express();
  let base = "";
  beforeEach(async () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    app.use(createAdminRouter({ getFeed: async () => [mk("tt1", { name: "One" })], searchMovies: async () => [mk("tt2", { name: "Two" })], placeMovie: async () => ({ placed: false, categoryIds: [] }), syncCatalog: async () => undefined, tmdbConfigured: () => true }));
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { delete process.env.ADMIN_API_TOKEN; setOverrides({}); await new Promise<void>((resolve) => { server.close(() => resolve()); }); });

  it("rejects missing or wrong tokens and accepts the right one", async () => {
    expect((await fetch(`${base}/api/admin/overrides`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/overrides`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    const ok = await fetch(`${base}/api/admin/overrides`, { headers: { authorization: "Bearer secret-token" } });
    expect(ok.status).toBe(200);
  });

  it("saves overrides and lists the feed for the editor", async () => {
    const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
    const saved = await fetch(`${base}/api/admin/overrides`, { method: "PUT", headers, body: JSON.stringify({ pinned: ["tt1"], hidden: [] }) });
    expect(await saved.json()).toEqual({ pinned: ["tt1"], hidden: [] });
    const feed = await (await fetch(`${base}/api/admin/feed`, { headers })).json() as { movies: Array<{ id: string; name: string }> };
    expect(feed.movies).toEqual([{ id: "tt1", name: "One", year: "2026" }]);
  });

  it("is switched off (404) when no token is configured", async () => {
    delete process.env.ADMIN_API_TOKEN;
    expect((await fetch(`${base}/admin`)).status).toBe(404);
    expect((await fetch(`${base}/api/admin/feed`)).status).toBe(404);
  });
});

import { getWatchOptions } from "../src/providers/tmdb.js";

describe("official watch options", () => {
  beforeEach(() => { process.env.TMDB_API_KEY = "k"; delete process.env.WATCH_REGIONS; });
  afterEach(() => { delete process.env.TMDB_API_KEY; delete process.env.WATCH_REGIONS; vi.unstubAllGlobals(); });

  const providers = {
    results: {
      BD: { link: "https://www.themoviedb.org/movie/9/watch?locale=BD", flatrate: [{ provider_name: "Chorki" }, { provider_name: "Chorki" }], rent: [{ provider_name: "Apple TV" }] },
      IN: { link: "https://www.themoviedb.org/movie/9/watch?locale=IN", flatrate: [{ provider_name: "Netflix" }], ads: [{ provider_name: "MX Player" }] },
      US: { link: "https://www.themoviedb.org/movie/9/watch?locale=US", flatrate: [{ provider_name: "Hulu" }] }
    }
  };
  const stub = () => vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/find/tt9")) return new Response(JSON.stringify({ movie_results: [{ id: 9 }] }), { status: 200 });
    if (url.includes("/movie/9/watch/providers")) return new Response(JSON.stringify(providers), { status: 200 });
    return new Response("no", { status: 404 });
  }));

  it("lists Bangladesh then India, de-duplicated, official-page links only, skipping other regions", async () => {
    stub();
    const options = await getWatchOptions("tt9");
    expect(options.map((o) => `${o.region}:${o.kind}:${o.provider}`)).toEqual([
      "BD:flatrate:Chorki", "BD:rent:Apple TV", "IN:flatrate:Netflix", "IN:ads:MX Player"
    ]);
    expect(options.every((o) => o.link.startsWith("https://www.themoviedb.org/"))).toBe(true);
  });

  it("honours WATCH_REGIONS and works with tmdb: ids", async () => {
    stub();
    process.env.WATCH_REGIONS = "us";
    expect((await getWatchOptions("tmdb:9")).map((o) => o.provider)).toEqual(["Hulu"]);
  });

  it("returns nothing without a key, for unknown id shapes, or when TMDB has no data", async () => {
    stub();
    expect(await getWatchOptions("custom:abc")).toEqual([]);
    expect(await getWatchOptions("tt0000000")).toEqual([]);
    delete process.env.TMDB_API_KEY;
    expect(await getWatchOptions("tt9")).toEqual([]);
  });
});

import { LEGAL_SOURCES, addLegalSource, getReviewedSources, removeLegalSource, replaceLegalSources } from "../src/sources.js";
import { SUBTITLES, addSubtitle, replaceSubtitles } from "../src/subtitles.js";

describe("adding sources and subtitles from the panel", () => {
  const ok = { movieId: "tt1", title: "Full movie", url: "https://archive.org/download/x/film.mp4", license: "public-domain", rightsEvidenceUrl: "https://archive.org/details/x", territory: "BD, IN", rightsConfirmed: true };
  afterEach(() => { replaceLegalSources([]); replaceSubtitles([]); });

  it("accepts a valid archive.org video and serves it for that movie", () => {
    const result = addLegalSource(ok);
    expect(result.ok).toBe(true);
    expect(getReviewedSources("tt1").map((s) => s.url)).toEqual([ok.url]);
    expect(getReviewedSources("tt1")[0]).toMatchObject({ host: "archive.org", territory: ["BD", "IN"], reviewed: true });
    expect(removeLegalSource(getReviewedSources("tt1")[0]!.id)).toBe(true);
    expect(LEGAL_SOURCES).toHaveLength(0);
  });

  it("refuses unconfirmed rights, unknown hosts, web pages instead of video files, and duplicates", () => {
    expect(addLegalSource({ ...ok, rightsConfirmed: false })).toMatchObject({ ok: false });
    const host = addLegalSource({ ...ok, url: "https://some-movie-site.example/film.mp4" });
    expect(host).toMatchObject({ ok: false });
    expect((host as { reason: string }).reason).toContain("allowlist");
    expect(addLegalSource({ ...ok, url: "https://archive.org/details/x" })).toMatchObject({ ok: false });
    expect(addLegalSource({ ...ok, rightsEvidenceUrl: "not a url" })).toMatchObject({ ok: false });
    expect(addLegalSource({ ...ok, license: "free-for-all" })).toMatchObject({ ok: false });
    expect(addLegalSource({ ...ok, movieId: "" })).toMatchObject({ ok: false });
    expect(addLegalSource(ok)).toMatchObject({ ok: true });
    expect(addLegalSource(ok)).toMatchObject({ ok: false });
  });

  it("restore keeps only records that pass validation", () => {
    const good = (addLegalSource(ok) as { source: unknown }).source;
    const bad = { ...(good as object), id: "bad", url: "https://evil.example/a.mp4", host: "evil.example" };
    expect(replaceLegalSources([good, bad, "junk", null])).toBe(1);
    expect(LEGAL_SOURCES.map((s) => s.id)).toEqual([(good as { id: string }).id]);
  });

  it("subtitles follow the same rules", () => {
    const sub = { movieId: "tt1", lang: "ben", url: "https://archive.org/download/x/film.bn.srt", license: "cc0", rightsEvidenceUrl: "https://archive.org/details/x", rightsConfirmed: true };
    expect(addSubtitle(sub)).toMatchObject({ ok: true });
    expect(SUBTITLES).toHaveLength(1);
    expect(addSubtitle({ ...sub, rightsConfirmed: false })).toMatchObject({ ok: false });
    expect(addSubtitle({ ...sub, url: "https://other.example/a.srt" })).toMatchObject({ ok: false });
  });
});

describe("admin API for sources", () => {
  let server: ReturnType<typeof app.listen>;
  const app = express();
  let base = "";
  const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
  beforeEach(async () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    app.use(createAdminRouter({ getFeed: async () => [mk("tt1", { name: "One" })], searchMovies: async (q) => [mk("tt2", { name: `Found ${q}` })], placeMovie: async () => ({ placed: false, categoryIds: [] }), syncCatalog: async () => undefined, tmdbConfigured: () => true }));
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { delete process.env.ADMIN_API_TOKEN; replaceLegalSources([]); replaceSubtitles([]); await new Promise<void>((resolve) => { server.close(() => resolve()); }); });

  it("adds, lists, backs up, deletes and searches", async () => {
    const body = { movieId: "tt2", title: "Film", url: "https://archive.org/download/y/film.mp4", license: "cc-by", rightsEvidenceUrl: "https://archive.org/details/y", territory: "BD", rightsConfirmed: true };
    const created = await fetch(`${base}/api/admin/sources`, { method: "POST", headers, body: JSON.stringify(body) });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const backup = await (await fetch(`${base}/api/admin/backup`, { headers })).json() as { sources: unknown[] };
    expect(backup.sources).toHaveLength(1);
    const search = await (await fetch(`${base}/api/admin/search?q=leo`, { headers })).json() as { movies: Array<{ name: string }> };
    expect(search.movies[0]?.name).toBe("Found leo");
    expect((await fetch(`${base}/api/admin/sources/${id}`, { method: "DELETE", headers })).status).toBe(200);
    expect((await fetch(`${base}/api/admin/sources/${id}`, { method: "DELETE", headers })).status).toBe(404);
  });

  it("explains why a link is refused and needs the token", async () => {
    const bad = await fetch(`${base}/api/admin/sources`, { method: "POST", headers, body: JSON.stringify({ movieId: "tt2", url: "https://piracy.example/x.mp4", license: "cc0", rightsEvidenceUrl: "https://archive.org/x", territory: "BD", rightsConfirmed: true }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { reason: string }).reason).toContain("allowlist");
    expect((await fetch(`${base}/api/admin/sources`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await fetch(`${base}/api/admin/sources`, { method: "POST", headers, body: "{not json" })).status).toBe(400);
  });
});

import { categoriesFor, getTmdbMovieCard } from "../src/providers/tmdb.js";
import { getCuratedMovie, getCuratedMovies, listCurated, pruneCurated, replaceCurated, sanitizeMovie, upsertCurated } from "../src/curated.js";

describe("placing a film in the right catalog rows", () => {
  it("maps language and country to catalog rows, falling back to World Cinema", () => {
    expect(categoriesFor("bn", ["BD"])).toEqual(["bd-bengali"]);
    expect(categoriesFor("bn", ["IN"])).toEqual(["in-bengali"]);
    expect(categoriesFor("hi", ["IN"])).toEqual(["bollywood"]);
    expect(categoriesFor("ta")).toEqual(["tamil"]);
    expect(categoriesFor("en", ["US"])).toEqual(["hollywood"]);
    expect(categoriesFor("en", ["GB"])).toEqual(["world"]);
    expect(categoriesFor("bn", ["NP"])).toEqual(["world"]);
    expect(categoriesFor(undefined)).toEqual(["world"]);
  });

  describe("TMDB movie card", () => {
    beforeEach(() => { process.env.TMDB_API_KEY = "k"; });
    afterEach(() => { delete process.env.TMDB_API_KEY; vi.unstubAllGlobals(); });

    it("builds a card from TMDB details with the id the editor chose", async () => {
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/movie/321?")) return new Response(JSON.stringify({
          title: "Dhakar Golpo", overview: "A story.", release_date: "2026-09-12", poster_path: "/p.jpg", backdrop_path: "/b.jpg",
          genres: [{ name: "Drama" }, { name: "Romance" }], original_language: "bn", origin_country: ["BD"], runtime: 118
        }), { status: 200 });
        return new Response("no", { status: 404 });
      }));
      const card = await getTmdbMovieCard("tmdb:321");
      expect(card).toMatchObject({ id: "tmdb:321", name: "Dhakar Golpo", releaseInfo: "2026", genres: ["Drama", "Romance"], categoryIds: ["bd-bengali"], runtime: 118 });
      expect(card?.poster).toContain("/w500/p.jpg");
      expect(card?.imdbId).toBeUndefined();
    });

    it("returns null without a key or when TMDB does not know the film", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
      expect(await getTmdbMovieCard("tmdb:999")).toBeNull();
      delete process.env.TMDB_API_KEY;
      expect(await getTmdbMovieCard("tmdb:321")).toBeNull();
    });
  });
});

describe("curated films", () => {
  afterEach(() => { replaceCurated([]); });
  const card = (id: string, cats: string[], extra: Record<string, unknown> = {}) => ({ id, type: "movie", name: `Film ${id}`, description: "d", releaseInfo: "2026", genres: ["Drama"], categoryIds: cats, sourceIds: [], ...extra });

  it("returns films per catalog row, newest added first, and searches by name", () => {
    upsertCurated(sanitizeMovie(card("tt1", ["bd-bengali"]))!);
    upsertCurated(sanitizeMovie(card("tt2", ["bollywood", "world"]))!);
    expect(getCuratedMovies("bd-bengali").map((m) => m.id)).toEqual(["tt1"]);
    expect(getCuratedMovies().map((m) => m.id)).toEqual(["tt2", "tt1"]);
    expect(getCuratedMovies("bollywood", "film tt2")).toHaveLength(1);
    expect(getCuratedMovies("bollywood", "nothing")).toHaveLength(0);
    expect(getCuratedMovie("tt1")?.imdbId).toBe("tt1");
  });

  it("prunes films that lost their source", () => {
    upsertCurated(sanitizeMovie(card("tt1", ["tamil"]))!);
    upsertCurated(sanitizeMovie(card("tt2", ["tamil"]))!);
    expect(pruneCurated((id) => id === "tt2")).toEqual(["tt1"]);
    expect(listCurated().map((m) => m.id)).toEqual(["tt2"]);
  });

  it("sanitizes untrusted records: bad rows, non-HTTPS images, unknown fields", () => {
    expect(sanitizeMovie(card("x", ["not-a-row"]))).toBeNull();
    expect(sanitizeMovie({ id: "", name: "n", categoryIds: ["tamil"] })).toBeNull();
    expect(sanitizeMovie("junk")).toBeNull();
    const clean = sanitizeMovie(card("tt9", ["tamil"], { poster: "http://evil.example/p.jpg", background: "https://image.tmdb.org/b.jpg", secret: "x" }))!;
    expect(clean.poster).toBeUndefined();
    expect(clean.background).toBe("https://image.tmdb.org/b.jpg");
    expect(clean).not.toHaveProperty("secret");
    expect(replaceCurated([card("a", ["tamil"]), { bad: true }, card("b", ["korean"])])).toBe(2);
  });
});

describe("admin: confirming a source places the film in the catalog", () => {
  let server: ReturnType<typeof app.listen>;
  const app = express();
  let base = "";
  const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
  const placed: string[] = [];
  let synced = 0;
  beforeEach(async () => {
    process.env.ADMIN_API_TOKEN = "secret-token";
    app.use(createAdminRouter({
      getFeed: async () => [], searchMovies: async () => [mk("tmdb:5", { name: "Poster Film", poster: "https://image.tmdb.org/t/p/w500/p.jpg" })],
      placeMovie: async (id) => { placed.push(id); return { placed: true, categoryIds: ["bd-bengali"], name: "Dhakar Golpo" }; },
      syncCatalog: async () => { synced++; }, tmdbConfigured: () => true
    }));
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { delete process.env.ADMIN_API_TOKEN; replaceLegalSources([]); placed.length = 0; synced = 0; await new Promise<void>((resolve) => { server.close(() => resolve()); }); });

  it("places the film, reports where it is shown, and removes it again when the source is deleted", async () => {
    const body = { movieId: "tmdb:5", title: "Film", url: "https://archive.org/download/y/film.mp4", license: "cc0", rightsEvidenceUrl: "https://archive.org/details/y", territory: "BD", rightsConfirmed: true };
    const created = await (await fetch(`${base}/api/admin/sources`, { method: "POST", headers, body: JSON.stringify(body) })).json() as { id: string; placed: boolean; shownIn: string[]; movieName: string };
    expect(placed).toEqual(["tmdb:5"]);
    expect(created).toMatchObject({ placed: true, movieName: "Dhakar Golpo", shownIn: ["New Releases", "Bangladesh Bengali Cinema"] });
    await fetch(`${base}/api/admin/sources/${created.id}`, { method: "DELETE", headers });
    expect(synced).toBe(1);
  });

  it("a refused link does not touch the catalog; search results carry posters; config reports TMDB", async () => {
    const bad = await fetch(`${base}/api/admin/sources`, { method: "POST", headers, body: JSON.stringify({ movieId: "tmdb:5", url: "https://piracy.example/x.mp4", license: "cc0", rightsEvidenceUrl: "https://archive.org/x", territory: "BD", rightsConfirmed: true }) });
    expect(bad.status).toBe(400);
    expect(placed).toEqual([]);
    const search = await (await fetch(`${base}/api/admin/search?q=poster`, { headers })).json() as { movies: Array<{ poster: string }> };
    expect(search.movies[0]?.poster).toContain("image.tmdb.org");
    expect(((await (await fetch(`${base}/api/admin/config`, { headers })).json()) as { tmdb: boolean }).tmdb).toBe(true);
  });

  it("restore re-syncs the catalog and the backup carries the placed films", async () => {
    upsertCurated(sanitizeMovie({ id: "tt1", name: "Kept", categoryIds: ["tamil"] })!);
    const backup = await (await fetch(`${base}/api/admin/backup`, { headers })).json() as { movies: Array<{ id: string }> };
    expect(backup.movies.map((m) => m.id)).toEqual(["tt1"]);
    const restored = await (await fetch(`${base}/api/admin/restore`, { method: "POST", headers, body: JSON.stringify(backup) })).json() as { movies: number };
    expect(restored.movies).toBe(1);
    expect(synced).toBe(1);
    replaceCurated([]);
  });
});

import { deriveEvidenceUrl } from "../src/evidence.js";
import { normalizeQuality, qualityRank } from "../src/sources.js";

describe("quality labels and automatic rights page", () => {
  afterEach(() => { replaceLegalSources([]); });

  it("normalizes quality labels", () => {
    expect(normalizeQuality("1080")).toBe("1080p");
    expect(normalizeQuality("720P")).toBe("720p");
    expect(normalizeQuality("UHD")).toBe("4K");
    expect(normalizeQuality("2160p")).toBe("4K");
    expect(normalizeQuality("hls")).toBe("Auto");
    expect(normalizeQuality("")).toBe("");
    expect(normalizeQuality(undefined)).toBe("");
    expect(normalizeQuality("999p")).toBeNull();
    expect(normalizeQuality("hd-ultra")).toBeNull();
    expect(qualityRank("4K")).toBeLessThan(qualityRank("720p"));
    expect(qualityRank(undefined)).toBeGreaterThan(qualityRank("Auto"));
  });

  it("works out the rights page from archive.org and Wikimedia links", () => {
    expect(deriveEvidenceUrl("https://archive.org/download/my-film_1950/my%20film.mp4")).toBe("https://archive.org/details/my-film_1950");
    expect(deriveEvidenceUrl("https://upload.wikimedia.org/wikipedia/commons/a/ab/Old_Film.ogv")).toBe("https://commons.wikimedia.org/wiki/File:Old_Film.ogv");
    expect(deriveEvidenceUrl("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Old_Film.ogv/320px-Old_Film.ogv.jpg")).toBe("https://commons.wikimedia.org/wiki/File:Old_Film.ogv");
    expect(deriveEvidenceUrl("https://archive.org/details/x")).toBeNull();
    expect(deriveEvidenceUrl("not a url")).toBeNull();
  });

  it("adds several qualities without a rights page and lists the best first", () => {
    const base = { movieId: "tt5", license: "public-domain", rightsConfirmed: true };
    for (const [quality, file] of [["480p", "a.480.mp4"], ["1080", "a.1080.mp4"], ["", "a.mp4"], ["720p", "a.720.mp4"]] as const) {
      expect(addLegalSource({ ...base, quality, url: `https://archive.org/download/item5/${file}` })).toMatchObject({ ok: true });
    }
    const listed = getReviewedSources("tt5");
    expect(listed.map((s) => s.quality)).toEqual(["1080p", "720p", "480p", undefined]);
    expect(listed[0]?.rightsEvidenceUrl).toBe("https://archive.org/details/item5");
    expect(listed[0]?.territory).toEqual(["world"]);
  });

  it("still refuses an unknown quality, other hosts, and links whose rights page cannot be worked out", () => {
    const base = { movieId: "tt5", license: "public-domain", rightsConfirmed: true };
    expect(addLegalSource({ ...base, quality: "ultra", url: "https://archive.org/download/i/a.mp4" })).toMatchObject({ ok: false });
    expect(addLegalSource({ ...base, url: "https://some-site.example/a.mp4" })).toMatchObject({ ok: false });
    expect(addLegalSource({ ...base, url: "https://archive.org/some/other/a.mp4" })).toMatchObject({ ok: false });
    expect(addLegalSource({ ...base, rightsConfirmed: false, url: "https://archive.org/download/i/a.mp4" })).toMatchObject({ ok: false });
  });
});

import { isReviewedHost } from "../src/hosts.js";

describe("all video file types and open-license hosts", () => {
  afterEach(() => { replaceLegalSources([]); });
  const base = { movieId: "tt8", license: "cc-by", rightsConfirmed: true };

  it("accepts every common video container, including mkv", () => {
    for (const ext of ["mkv", "mp4", "m4v", "webm", "ogv", "mov", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp", "mpd", "m3u8", "MKV"]) {
      expect(addLegalSource({ ...base, url: `https://archive.org/download/item8/film.${ext}` }), ext).toMatchObject({ ok: true });
    }
    expect(addLegalSource({ ...base, url: "https://archive.org/download/item8/film.mkv?download=1&x=y" })).toMatchObject({ ok: true });
  });

  it("still refuses pages, images and documents", () => {
    for (const file of ["page.html", "poster.jpg", "notes.pdf", "film", "film.mkv.txt"]) {
      expect(addLegalSource({ ...base, url: `https://archive.org/download/item8/${file}` }), file).toMatchObject({ ok: false });
    }
  });

  it("accepts archive.org download servers and Blender open movies, and finds their rights page", () => {
    const server = addLegalSource({ ...base, url: "https://ia801234.us.archive.org/12/items/item8/film.mkv" });
    expect(server).toMatchObject({ ok: true });
    expect((server as { source: { rightsEvidenceUrl: string } }).source.rightsEvidenceUrl).toBe("https://archive.org/details/item8");
    const blender = addLegalSource({ ...base, url: "https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_1080p_h264.mov" });
    expect(blender).toMatchObject({ ok: true });
    expect((blender as { source: { rightsEvidenceUrl: string } }).source.rightsEvidenceUrl).toBe("https://studio.blender.org/films/");
  });

  it("does not let look-alike or unknown hosts through", () => {
    for (const host of ["evilarchive.org", "archive.org.evil.example", "ia800.archive.org.evil.com", "archive.org.", "blender.org", "cdn.example.com", "127.0.0.1", "localhost"]) {
      expect(isReviewedHost(host), host).toBe(false);
      expect(addLegalSource({ ...base, rightsEvidenceUrl: "https://archive.org/details/x", url: `https://${host}/a.mkv` }), host).toMatchObject({ ok: false });
    }
    expect(isReviewedHost("ARCHIVE.ORG")).toBe(true);
    expect(isReviewedHost(".archive.org")).toBe(false);
  });

  it("an editor-supplied rights page is used for the record", () => {
    const result = addLegalSource({ ...base, url: "https://archive.org/some/odd/path/film.mkv", rightsEvidenceUrl: "https://archive.org/details/odd" });
    expect(result).toMatchObject({ ok: true });
  });
});
