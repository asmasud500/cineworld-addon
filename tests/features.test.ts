import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    app.use(createAdminRouter(async () => [mk("tt1", { name: "One" })]));
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
