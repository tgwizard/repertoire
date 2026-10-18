# Repertoire Finder

A friendlier front end to [IMSLP](https://imslp.org) for ensembles: pick the instruments you have, see how many works exist for exactly that line-up, then narrow by era and composer.

## How it works

- **Frontend** (`src/`): React + Vite. Instrumentation is parsed from IMSLP category names (`For 2 violins, viola, cello`) into a multiset, so counts for any line-up are computed client-side.
- **Worker** (`worker/`): a Cloudflare Worker that serves the built frontend and a small allow-listed proxy to IMSLP's MediaWiki API, which doesn't allow CORS. Nothing is stored; responses are edge-cached to go easy on IMSLP.
  - `GET /api/instrumentations`: all non-empty `For …` categories with work counts (about 25 upstream requests, cached for a day and refreshed in the background).
  - `GET /api/works?cat=…&from=…`: one page (up to 500) of works in a category, with any era tag on the work.
  - `POST /api/composers {names}`: composer eras from `People from the X era`.
- **Wikidata** is queried straight from the browser (it allows CORS) for composer life dates and Wikipedia links, joined on the IMSLP ID property (P839).

IMSLP runs MediaWiki 1.18, so paging uses `query-continue`. Also, `prop=categories` silently truncates unless filtered with `clcategories`.

## Development

Node is pinned with [mise](https://mise.jdx.dev) (`mise.toml`). Cloudflare tooling is the [`cf` CLI](https://developers.cloudflare.com/cf/) (beta), configured in `cloudflare.config.ts`. There's no Wrangler config.

```sh
mise install
npm install
npm run dev        # cf dev → Vite + the Worker running in workerd (Cloudflare's runtime), http://localhost:5173
npm test           # parser unit tests
npm run typecheck  # also regenerates Worker types into .cloudflare/types
npm run preview    # production build, served locally by workerd
```

## Deploying

Live at https://repertoire.tgwizard.com. The Worker uses a custom domain, which Cloudflare provisions on deploy (DNS record and certificate). That matters because the Cache API is a no-op on `*.workers.dev`.

```sh
npx cf auth login         # once
npm run deploy:dry-run    # build and validate, no API calls
npm run deploy            # typecheck, build, upload, deploy
npm run logs              # live tail (cf o11y telemetry live-tail)
```

The free Workers plan (100k requests/day, 50 subrequests per request) is enough: each API call makes at most about 25 upstream requests.
