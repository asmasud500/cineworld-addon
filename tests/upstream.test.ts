import { afterEach, describe, expect, it, vi } from "vitest";
import { getUpstreamCatalog } from "../src/providers/upstream.js";

describe("upstream catalog integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes movie catalog entries when upstream omits the preview type", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return new Response(JSON.stringify({
          resources: ["catalog", "meta"],
          catalogs: [{ type: "movie", id: "hi", name: "Hindi Movies" }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/catalog/movie/hi.json")) {
        return new Response(JSON.stringify({
          metas: [{
            id: "tt1234567",
            name: "Example Hindi Film",
            releaseInfo: "2025",
            poster: "https://images.example/poster.jpg",
            genres: ["Drama"]
          }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const movies = await getUpstreamCatalog("bollywood");
      expect(movies.some((movie) => movie.name === "Example Hindi Film")).toBe(true);
      const movie = movies.find((item) => item.name === "Example Hindi Film");
      expect(movie?.type).toBe("movie");
      expect(movie?.imdbId).toBe("tt1234567");
      expect(movie?.categoryIds).toEqual(["bollywood"]);
      expect(movie?.sourceIds).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when configured catalog endpoints cannot be fetched", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error("network unavailable"); }) as unknown as typeof fetch;
    try {
      expect(await getUpstreamCatalog("korean")).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
