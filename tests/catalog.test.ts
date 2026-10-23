import { describe, expect, it, vi } from "vitest";
import { CINEMA_CATEGORIES, getCatalog, searchCatalog } from "../src/catalog.js";
import { validateLegalSource, type LegalSource } from "../src/sources.js";
import { normalizeImdbMovie, searchImdbMovies } from "../src/providers/imdb.js";

describe("cinema catalog", () => {
  it("includes the requested South Asian and global categories", () => {
    const ids = CINEMA_CATEGORIES.map((category) => category.id);
    for (const id of ["bd-bengali", "in-bengali", "bollywood", "tamil", "telugu", "malayalam", "kannada", "pakistani", "nepali", "sri-lankan", "hollywood", "korean", "chinese", "japanese", "world"]) {
      expect(ids).toContain(id);
    }
  });

  it("returns an empty stream-ready catalog until reviewed titles are curated", () => {
    expect(getCatalog()).toHaveLength(0);
    expect(searchCatalog("not a title")).toHaveLength(0);
  });
});

const goodSource: LegalSource = {
  id: "source-1", movieId: "movie-1", title: "Verified public-domain source",
  url: "https://archive.org/download/example/movie.mp4",
  host: "archive.org", license: "public-domain",
  rightsEvidenceUrl: "https://archive.org/about/terms.php",
  territory: ["world"], reviewed: true, reviewedAt: "2026-01-01"
};

describe("legal source validation", () => {
  it("accepts a reviewed HTTPS source with matching host and evidence", () => {
    expect(validateLegalSource(goodSource).valid).toBe(true);
  });

  it("rejects HTTP sources", () => {
    expect(validateLegalSource({ ...goodSource, url: "http://archive.org/movie.mp4" }).valid).toBe(false);
  });

  it("rejects unreviewed sources", () => {
    expect(validateLegalSource({ ...goodSource, reviewed: false }).valid).toBe(false);
  });

  it("rejects host mismatch", () => {
    expect(validateLegalSource({ ...goodSource, host: "example.com" }).valid).toBe(false);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(validateLegalSource({ ...goodSource, url: "https://user:pass@archive.org/movie.mp4" }).valid).toBe(false);
  });

  it("rejects hosts outside the explicit allowlist", () => {
    expect(validateLegalSource({ ...goodSource, url: "https://example.com/movie.mp4", host: "example.com" }).valid).toBe(false);
  });
});

describe("IMDb metadata normalization", () => {
  it("normalizes IMDb IDs and metadata without treating metadata as playback rights", () => {
    const movie = normalizeImdbMovie({
      imdbID: "tt1234567",
      Title: "Example Film",
      Plot: "A test synopsis",
      Year: "2024",
      Poster: "https://example.com/poster.jpg",
      Genre: "Drama, Mystery",
      Type: "movie"
    }, "bd-bengali");
    expect(movie?.id).toBe("tt1234567");
    expect(movie?.imdbId).toBe("tt1234567");
    expect(movie?.releaseInfo).toBe("2024");
    expect(movie?.poster).toBe("https://example.com/poster.jpg");
    expect(movie?.genres).toEqual(["Drama", "Mystery"]);
    expect(movie?.sourceIds).toEqual([]);
  });

  it("rejects records without valid IMDb IDs and placeholder posters", () => {
    expect(normalizeImdbMovie({ Title: "No IMDb ID" }, "world")).toBeNull();
    const movie = normalizeImdbMovie({ imdbID: "tt7654321", Title: "No Poster", Poster: "N/A" }, "world");
    expect(movie?.poster).toBeUndefined();
  });
});

describe("IMDb provider resilience", () => {
  it("caches successful metadata responses for repeated searches", async () => {
    const originalKey = process.env.OMDB_API_KEY;
    process.env.OMDB_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      Response: "True",
      Search: [{
        imdbID: "tt9876543",
        Title: "Cache Test Film",
        Plot: "A fixture used to test caching.",
        Year: "2025",
        Poster: "N/A",
        Genre: "Drama",
        Type: "movie"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const uniqueQuery = `cineworld-cache-test-${Date.now()}`;
      const first = await searchImdbMovies(uniqueQuery);
      const second = await searchImdbMovies(uniqueQuery);
      expect(first).toEqual(second);
      expect(first[0]?.name).toBe("Cache Test Film");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OMDB_API_KEY;
      else process.env.OMDB_API_KEY = originalKey;
    }
  });

  it("fails closed when the OMDb API key is not configured", async () => {
    const originalKey = process.env.OMDB_API_KEY;
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    delete process.env.OMDB_API_KEY;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      expect(await searchImdbMovies("credential-free-query")).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) process.env.OMDB_API_KEY = originalKey;
    }
  });
});

describe("featured feed", () => {
  const mk = (id: string, year: string, cat: any) => ({ id, type: "movie" as const, name: id, description: "", releaseInfo: year, genres: [], categoryIds: [cat], sourceIds: [] });

  it("sorts newest first, interleaves categories and removes duplicates", async () => {
    const { buildFeaturedFeed } = await import("../src/catalog.js");
    const feed = buildFeaturedFeed([
      [mk("a1", "2026", "tamil"), mk("a2", "2024", "tamil")],
      [mk("b1", "2026", "korean"), mk("a1", "2026", "korean"), mk("b2", "2025", "korean")],
      [mk("c1", "", "world")]
    ]);
    expect(feed.map((m) => m.id)).toEqual(["a1", "b1", "b2", "a2", "c1"]);
  });
});

describe("featured feed ordering by exact date", () => {
  it("ranks a film released today above year-only entries of the same year", async () => {
    const { buildFeaturedFeed } = await import("../src/catalog.js");
    const mk = (id: string, releaseInfo: string, releaseDate?: string) => ({ id, type: "movie" as const, name: id, description: "", releaseInfo, ...(releaseDate ? { releaseDate } : {}), genres: [], categoryIds: ["world" as const], sourceIds: [] });
    const feed = buildFeaturedFeed([[mk("old", "2026"), mk("today", "2026", "2026-10-24"), mk("last-week", "2026", "2026-10-17")]]);
    expect(feed.map((m) => m.id)).toEqual(["today", "last-week", "old"]);
  });
});
