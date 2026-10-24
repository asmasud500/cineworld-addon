import { afterEach, describe, expect, it, vi } from "vitest";
import { getUpstreamCatalog } from "../src/providers/upstream.js";

const catalogManifest = { resources: ["catalog"], catalogs: [{ type: "movie", id: "hi", name: "Hindi Movies" }] };

describe("upstream redirects", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to follow a redirect to a private or non-HTTPS host", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(null, { status: 302, headers: { location: "https://localhost/secret.json" } });
    }));
    expect(await getUpstreamCatalog("bollywood")).toEqual([]);
    expect(calls.some((url) => url.includes("localhost"))).toBe(false);
  });

  it("follows a redirect to another public HTTPS host", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/catalog/movie/hi.json")) return new Response(JSON.stringify({ metas: [{ id: "tt7654321", name: "Moved Film", releaseInfo: "2026" }] }), { status: 200 });
      if (url.includes("moved.example") && url.endsWith("/manifest.json")) return new Response(JSON.stringify(catalogManifest), { status: 200 });
      if (url.endsWith("/manifest.json")) return new Response(null, { status: 301, headers: { location: "https://moved.example/manifest.json" } });
      return new Response("no", { status: 404 });
    }));
    const movies = await getUpstreamCatalog("bollywood", 0);
    expect(movies.map((movie) => movie.name)).toContain("Moved Film");
  });
});
