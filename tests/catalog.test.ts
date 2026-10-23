import { describe, expect, it, vi } from "vitest";
import { CINEMA_CATEGORIES, getCatalog, searchCatalog } from "../src/catalog.js";
import { validateLegalSource, type LegalSource } from "../src/sources.js";
import { normalizeTmdbMovie, searchTmdbMovies } from "../src/providers/tmdb.js";

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

describe("TMDB metadata normalization", () => {
  it("normalizes provider data without treating metadata as playback rights", () => {
    const movie = normalizeTmdbMovie({
      id: 123,
      title: "Example Film",
      overview: "A test synopsis",
      release_date: "2024-04-05",
      poster_path: "/poster.jpg",
      genre_ids: [18, 9999]
    }, "bd-bengali");
    expect(movie.id).toBe("cineworld-tmdb-123");
    expect(movie.releaseInfo).toBe("2024");
    expect(movie.poster).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(movie.genres).toEqual(["Drama"]);
    expect(movie.sourceIds).toEqual([]);
  });
});


describe("TMDB provider resilience", () => {
  it("caches successful metadata responses for repeated searches", async () => {
    const originalKey = process.env.TMDB_API_KEY;
    process.env.TMDB_API_KEY = "test-key";
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        id: 987654321,
        title: "Cache Test Film",
        overview: "A fixture used to test caching.",
        release_date: "2025-01-02",
        poster_path: null,
        genre_ids: [18]
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const uniqueQuery = `cineworld-cache-test-${Date.now()}`;
      const first = await searchTmdbMovies(uniqueQuery);
      const second = await searchTmdbMovies(uniqueQuery);
      expect(first).toEqual(second);
      expect(first[0]?.name).toBe("Cache Test Film");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.TMDB_API_KEY;
      else process.env.TMDB_API_KEY = originalKey;
    }
  });

  it("fails closed when TMDB credentials are not configured", async () => {
    const originalKey = process.env.TMDB_API_KEY;
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    delete process.env.TMDB_API_KEY;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      expect(await searchTmdbMovies("credential-free-query")).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey !== undefined) process.env.TMDB_API_KEY = originalKey;
    }
  });
});
