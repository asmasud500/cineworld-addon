import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTmdbNewReleases, isTmdbConfigured } from "../src/providers/tmdb.js";
import { getRememberedMovie } from "../src/providers/upstream.js";

describe("TMDB new releases", () => {
  beforeEach(() => { process.env.TMDB_API_KEY = "test-key"; });
  afterEach(() => { delete process.env.TMDB_API_KEY; vi.unstubAllGlobals(); });

  it("is disabled without a key", async () => {
    delete process.env.TMDB_API_KEY;
    expect(isTmdbConfigured()).toBe(false);
    expect(await getTmdbNewReleases("tamil")).toEqual([]);
  });

  it("returns recent films with dates, backdrops and resolved ids, and remembers them", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); urls.push(url);
      if (url.includes("/discover/movie")) {
        return new Response(JSON.stringify({ results: [
          { id: 11, title: "Has Imdb", release_date: "2026-10-20", poster_path: "/a.jpg", backdrop_path: "/b.jpg", genre_ids: [18] },
          { id: 22, title: "Brand New", release_date: "2026-10-23", poster_path: "/c.jpg", genre_ids: [35] },
          { id: 33, title: "No Poster", release_date: "2026-10-22", poster_path: null }
        ] }), { status: 200 });
      }
      if (url.includes("/movie/11/external_ids")) return new Response(JSON.stringify({ imdb_id: "tt9999999" }), { status: 200 });
      if (url.includes("/movie/22/external_ids")) return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
      return new Response("no", { status: 404 });
    }));
    const movies = await getTmdbNewReleases("bd-bengali");
    expect(movies.map((m) => m.id)).toEqual(["tt9999999", "tmdb:22"]);
    expect(movies[0]).toMatchObject({ imdbId: "tt9999999", releaseDate: "2026-10-20", genres: ["Drama"] });
    expect(movies[0]?.background).toContain("/w1280/b.jpg");
    expect(getRememberedMovie("tmdb:22")?.name).toBe("Brand New");
    const discover = urls.find((u) => u.includes("/discover/movie")) ?? "";
    expect(discover).toContain("with_original_language=bn");
    expect(discover).toContain("with_origin_country=BD");
    expect(discover).toContain("sort_by=primary_release_date.desc");
  });
});
