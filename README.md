# CineWorld Advanced Movie Add-on

Legal-first movie discovery for **Stremio and Nuvio**. Nuvio documents support for the Stremio add-on protocol, so the same manifest and resource endpoints are intended to work in both clients.

> **Important:** CineWorld only returns playback links that are explicitly reviewed and allowlisted in the source registry. A catalog entry or metadata record is not proof that a film is legally streamable. No scraping of paywalled services, DRM bypass, or unauthorized stream aggregation is implemented.

## Current MVP

- Stremio-compatible manifest and movie catalog endpoint (also intended for Nuvio's Stremio-protocol add-on support).
- Curated international category catalog (Bangladesh/West Bengal Bengali, Bollywood, Tamil, Telugu, Malayalam, Kannada, Pakistani, Nepali, Sri Lankan, Hollywood, Korean, Chinese, Japanese, and world cinema).
- Legal-source registry with strict URL/host validation and explicit source review status.
- Subtitle resource endpoint (empty until licensed/authorized subtitle records are curated).
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

Open `http://localhost:7000/manifest.json` for Stremio and `http://localhost:7001/api/health` / `http://localhost:7001/api/catalog` for the protocol-neutral API. The API listens on `API_PORT` (default `PORT + 1`) because the SDK owns its own HTTP listener.

Run checks:

```bash
npm run check
```

## Legal playback policy

A source must be added to `src/sources.ts` only after a human has checked the source's license/rights, the exact playback URL, territory restrictions, and whether direct linking is permitted. The example catalog deliberately has **no playback streams by default**. This avoids implying that a film is public domain merely because it is old or appears on an archive.

Never add arbitrary user-provided URLs to playback responses. The validator accepts HTTPS only, rejects credentials and non-allowlisted hosts, and requires an explicit `reviewed: true` record.

## Nuvio compatibility status

Nuvio documentation describes add-ons as HTTP services that publish a manifest and respond to catalog, metadata, stream, and subtitle requests using the Stremio add-on protocol. CineWorld therefore uses the shared protocol rather than inventing a separate adapter. Real-client compatibility still needs an install/playback smoke test once a public HTTPS deployment exists.

## Deployment

Deploy on any Node.js 20+ host that supports a persistent HTTP process. Set `PORT`, `API_PORT`, and `PUBLIC_BASE_URL`. Expose both listeners or configure a reverse proxy that routes the Stremio manifest paths to the add-on listener and `/api/*` to the neutral API listener. Use HTTPS in production. Configure a health check against `/api/health` on the API listener. Do not store secrets in source control.

## Roadmap

1. Deploy over public HTTPS and smoke-test installation in both Stremio and Nuvio.
2. Add a reviewed public-domain/licensed source registry and evidence fields.
3. Add persistent metadata storage, Redis caching, scheduled refresh, and an admin control center.
4. Add integration tests against real Stremio and Nuvio clients.
5. Deploy to a chosen hosting provider and verify public endpoints.

## License

MIT. See `LICENSE`.
