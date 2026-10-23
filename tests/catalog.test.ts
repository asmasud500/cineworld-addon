import { describe, expect, it } from "vitest";
import { CINEMA_CATEGORIES, getCatalog, searchCatalog } from "../src/catalog.js";
import { validateLegalSource, type LegalSource } from "../src/sources.js";

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
