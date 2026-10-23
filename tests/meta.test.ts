import { afterEach, describe, expect, it, vi } from "vitest";
import { getRememberedMovie, getUpstreamCatalog } from "../src/providers/upstream.js";

describe("meta fallback for catalog items", () => {
  afterEach(() => vi.restoreAllMocks());

  it("remembers catalog movies (including non-IMDb ids) so details can be served without upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return new Response(JSON.stringify({ resources: ["catalog"], catalogs: [{ type: "movie", id: "bn", name: "Bengali Movies" }] }), { status: 200 });
      }
      if (url.includes("/catalog/movie/bn.json")) {
        return new Response(JSON.stringify({ metas: [{ id: "custom:abc123", name: "Custom Id Film", releaseInfo: "2026", poster: "https://images.example/p.jpg" }] }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }));
    await getUpstreamCatalog("in-bengali");
    const remembered = getRememberedMovie("custom:abc123");
    expect(remembered?.name).toBe("Custom Id Film");
    expect(getRememberedMovie("does-not-exist")).toBeNull();
  });
});
