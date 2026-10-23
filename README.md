# CineWorld Advanced Movie Add-on

Legal-first movie discovery for **Stremio**, with a small protocol-neutral JSON API intended to help validate a future **Nuvio adapter**.

> **Important:** CineWorld only returns playback links that are explicitly reviewed and allowlisted in the source registry. A catalog entry or metadata record is not proof that a film is legally streamable. No scraping of paywalled services, DRM bypass, or unauthorized stream aggregation is implemented.

## Current MVP

- Stremio manifest and movie catalog endpoint.
- Curated international category catalog (Bangladesh/West Bengal Bengali, Bollywood, Tamil, Telugu, Malayalam, Kannada, Pakistani, Nepali, Sri Lankan, Hollywood, Korean, Chinese, Japanese, and world cinema).
- Legal-source registry with strict URL/host validation and explicit source review status.
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

Open `http://localhost:7000/manifest.json` and `http://localhost:7000/api/health`.

Run checks:

```bash
npm run check
```

## Legal playback policy

A source must be added to `src/sources.ts` only after a human has checked the source's license/rights, the exact playback URL, territory restrictions, and whether direct linking is permitted. The example catalog deliberately has **no playback streams by default**. This avoids implying that a film is public domain merely because it is old or appears on an archive.

Never add arbitrary user-provided URLs to playback responses. The validator accepts HTTPS only, rejects credentials and non-allowlisted hosts, and requires an explicit `reviewed: true` record.

## Nuvio compatibility status

The JSON catalog API is a neutral integration seam, **not a claim that CineWorld is already a native Nuvio add-on**. Nuvio's current extension/adapter contract must be confirmed against its official documentation and tested against a real Nuvio client before advertising native compatibility. Keep any Nuvio-specific adapter isolated from the Stremio manifest and handlers.

## Deployment

Deploy on any Node.js 20+ host that supports a persistent HTTP process. Set `PORT` and `PUBLIC_BASE_URL`. Use HTTPS in production. Configure a health check against `/api/health`. Do not store secrets in source control.

## Roadmap

1. Confirm Nuvio's supported extension protocol and build a dedicated adapter.
2. Add a reviewed public-domain/licensed source registry and evidence fields.
3. Add persistent metadata storage, Redis caching, scheduled refresh, and an admin control center.
4. Add integration tests against real Stremio and Nuvio clients.
5. Deploy to a chosen hosting provider and verify public endpoints.

## License

MIT. See `LICENSE`.
