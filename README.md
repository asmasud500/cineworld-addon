# CineWorld Advanced Movie Add-on

Legal-first movie discovery for **Stremio and Nuvio**. Nuvio documents support for the Stremio add-on protocol, so the same manifest and resource endpoints are intended to work in both clients.

> **Important:** CineWorld only returns playback links that are explicitly reviewed and allowlisted in the source registry. A catalog entry or metadata record is not proof that a film is legally streamable. No scraping of paywalled services, DRM bypass, or unauthorized stream aggregation is implemented.

## Current MVP

- Stremio-compatible manifest and movie catalog endpoint (also intended for Nuvio's Stremio-protocol add-on support).
- International category catalog (Bangladesh/West Bengal Bengali, Bollywood, Tamil, Telugu, Malayalam, Kannada, Pakistani, Nepali, Sri Lankan, Hollywood, Korean, Chinese, Japanese, and world cinema).
- Catalog discovery from configurable Stremio-compatible add-ons (defaults: Indian Regional Catalog and IndiaStreams); normalized movie cards and posters are sourced from upstream catalog responses.
- Legal-source registry with strict URL/host validation and explicit source review status.
- Subtitle resource endpoint (empty until licensed/authorized subtitle records are curated).
- Automatic "New Releases" feed (first catalog, used for the home hero): newest movies from all categories, refreshed from upstream every 10 minutes.
- Catalog pagination for Stremio-style `skip` requests.
- Protocol-neutral JSON endpoints for health and catalog discovery.
- Automated unit tests and GitHub Actions CI.
- No database or cache is required for the initial local run.

## Requirements

- Node.js 20+
- npm

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:7000/manifest.json` for Stremio/Nuvio and `http://localhost:7000/api/health` / `http://localhost:7000/api/catalog` for health and catalog information. All routes share one HTTP listener for simpler deployment.

Run checks:

```bash
npm run check
```

## Upstream catalog add-ons

CineWorld reads public Stremio-compatible catalog add-on manifests and catalog responses. Defaults include Indian Regional Catalog (`https://83e20802dcf1-indian-streams.baby-beamup.club/manifest.json`) and IndiaStreams (`https://indiastreams.rdata.in/manifest.json`). Configure manifest URLs as a comma-separated `UPSTREAM_CATALOG_ADDONS` environment variable. CineWorld selects upstream movie catalogs by matching category names/IDs, then normalizes returned metadata for its own catalog response. Some categories (such as Bangladesh-specific Bengali, Pakistani, Nepali, Sri Lankan, Korean, Chinese, and Japanese cinema) may remain empty unless an upstream add-on actually provides those catalogs.

**Important limitation:** a server-side add-on cannot inspect the private list of add-ons installed inside a user's Nuvio app. The configured URLs are therefore explicit server configuration, not automatic discovery of the user's Nuvio account. Install the desired catalog add-ons in Nuvio separately if you want to browse them directly there. Upstream catalog support is not the same as stream support; CineWorld does not proxy arbitrary playback links.

## Automatic new releases (TMDB)

Set `TMDB_API_KEY` (free v3 key from themoviedb.org) or `TMDB_READ_ACCESS_TOKEN`. CineWorld then asks TMDB for films released in the last 180 days, per category (language/country filters), newest first, and puts them at the front of every category and of the **New Releases** hero catalog. New films appear as soon as TMDB lists them (10 minute cache, no redeploy needed). IMDb ids are resolved so other Stremio/Nuvio stream add-ons can match the film; brand-new films without an IMDb id yet use a `tmdb:<id>` id. This is metadata only: no playback links are created. Without a key the feature is simply off.

### Strict categories

Each category row shows only films that really belong to it. Films from the upstream add-ons are checked against TMDB by IMDb id (original language, plus origin country for Bangladesh / West Bengal / Hollywood) and dropped if they do not match or cannot be verified. Without a TMDB key, ambiguous Bengali films are hidden from the Bangladesh row. "World Cinema" is intentionally unfiltered.

## More features (v0.4)

- **Search with TMDB:** category search also queries TMDB, limited to that category's language/country.
- **Movie details:** cast, director, runtime, TMDB rating and a YouTube trailer (needs the TMDB key).
- **Coming Soon:** second catalog with films releasing in the next 120 days, soonest first.
- **Genre filter:** every catalog has a `genre` filter (Action, Comedy, Drama, ...).
- **Subtitles:** `src/subtitles.ts` is a reviewed-only registry, like playback sources. It is empty until an editor adds records with rights evidence; only `.srt`/`.vtt` files on allowlisted hosts are served.
- **Stay awake:** on free hosts the add-on pings its own public URL every 10 minutes (uses `RENDER_EXTERNAL_URL` on Render; turn off with `KEEP_ALIVE=false`).
- **Admin (pin/hide):** set `ADMIN_API_TOKEN`, then open `/admin`, enter the token and pin or hide films. Without a token the admin is off (404). Changes are saved to `data/overrides.json`, which lasts until the next redeploy on hosts with a temporary disk; for permanent choices put film ids in `PINNED_MOVIE_IDS` / `HIDDEN_MOVIE_IDS` (comma-separated).

## Where to watch (official services)

When you open a movie, the **stream** list shows where it can be watched legally in Bangladesh and India (default `WATCH_REGIONS=BD,IN`; change with a comma-separated list of two-letter country codes): subscription, free with ads, rent or buy, for example Netflix, Chorki or Hoichoi. Each entry opens the official TMDB/JustWatch page for that region. CineWorld does not fetch, proxy or resolve any video itself. Needs the TMDB key. Watch-provider data is powered by JustWatch, and attribution is required: *Streaming availability data provided by JustWatch via TMDB.* This product uses the TMDB API but is not endorsed or certified by TMDB.

## Admin panel (v0.6)

Set `ADMIN_API_TOKEN`, then open `https://<your-host>/admin` and enter the token. Search for a movie, choose it, then:

- **Movies:** pin a film to the front or hide it everywhere.
- **Sources:** add a direct video link for the chosen movie. The panel checks the link before saving: HTTPS only, host on the reviewed allowlist (archive.org, Wikimedia), a direct video file (`.mp4`, `.webm`, `.mkv`, `.m3u8` ...), a license label, a page that proves the rights, and your confirmation that you checked them. Links that fail are refused with the reason.
- **Subtitles:** same checks for `.srt` / `.vtt` files.
- **Backup:** download or restore pins, hidden films, sources and subtitles. Restore re-checks every record.

Added sources show up in the movie's stream list, ahead of the official-service links. The allowlist is fixed in code on purpose; adding a host needs a code change and review.

Saved data lives in `data/` (`SOURCES_FILE`, `SUBTITLES_FILE`, `OVERRIDES_FILE` change the paths). On hosts with a temporary disk it is lost at the next deploy, so download a backup now and then, or mount a persistent disk.

## Legal playback policy

A source must be added (admin panel or `src/sources.ts`) only after a human has checked the source's license/rights, the exact playback URL, territory restrictions, and whether direct linking is permitted. Metadata-provider results are for discovery only and never create playback links. The catalog deliberately has **no titles or playback streams by default** until verified metadata and source rights are curated. This avoids implying that a film is public domain merely because it is old or appears on an archive.

Never add arbitrary user-provided URLs to playback responses. The validator accepts HTTPS only, rejects credentials and non-allowlisted hosts, and requires an explicit `reviewed: true` record.

## Nuvio compatibility status

Nuvio documentation describes add-ons as HTTP services that publish a manifest and respond to catalog, metadata, stream, and subtitle requests using the Stremio add-on protocol. CineWorld therefore uses the shared protocol rather than inventing a separate adapter. Real-client compatibility still needs an install/playback smoke test once a public HTTPS deployment exists.

## Deployment

Deploy on any Node.js 20+ host that supports a persistent HTTP process. Set `PORT` and `PUBLIC_BASE_URL`. Set `UPSTREAM_CATALOG_ADDONS` in your host environment to choose the upstream catalog manifests (comma-separated HTTPS URLs). Use HTTPS in production and configure the host health check against `/api/health`. Do not store secrets in source control.

## Roadmap

1. Deploy over public HTTPS and smoke-test installation in both Stremio and Nuvio.
2. Add a reviewed public-domain/licensed source registry and evidence fields.
3. Add persistent metadata storage, Redis caching, scheduled refresh, and an admin control center.
4. Add integration tests against real Stremio and Nuvio clients.
5. Deploy to a chosen hosting provider and verify public endpoints.

## License

MIT. See `LICENSE`.
