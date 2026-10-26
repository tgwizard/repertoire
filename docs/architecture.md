# Architecture

The aim: answer "what can this group play?" quickly, from data anyone can download, on infrastructure that costs next to nothing and has no servers to look after. The code is the source of truth; this describes the intent.

```
crawl (local or CI)                 Cloudflare
  sources ─► .cache/stages ─► build ─► repertoire.sqlite ─┬─► R2: datasets/<version>/ (downloads)
                                                            └─► D1: repertoire-<version>
                                                                    ▲
  browser ─► Worker ── /api/*, /work/*, /composer/* ───────────────┘
              └─────── everything else: static app (React)
```

## Parts

**Crawler** (`crawler/`). One stage per source (`crawler/sources/`), each writing a normalized JSON file to `.cache/stages/`. Every HTTP response is cached on disk, so a crawl can stop and resume, and re-runs fetch only what's changed or expired. It's polite (one request at a time per host, with a gap, an identifying User-Agent) and resilient (retries with backoff, a failed source keeps its previous data). See [data.md](data.md).

**Build** (`crawler/build.ts`). Merges the stages into one SQLite database, `.cache/build/repertoire.sqlite` (schema in `crawler/db.ts`). This file *is* the dataset: the downloads, D1 and the tests all use it. Building keeps ids from the previous dataset (see [Persistent ids](data.md#persistent-ids)).

**Publish** (`crawler/publish.ts`). Each dataset version is immutable:
1. the SQLite file (gzipped) and a zip of CSVs go to the public R2 bucket under `datasets/<version>/`, then `datasets/latest.json` points at them;
2. a new D1 database, `repertoire-<version>`, is created and loaded. D1 takes SQL, not files, so `crawler/sqldump.ts` turns the database into batched `INSERT`s, sent with `cf d1 raw`. The table counts are checked against the file afterwards;
3. `dataset.json` records the version and its D1 database. It's committed, and the next deploy binds the Worker to that database.

A new database per version, rather than updating one in place, means the site switches datasets atomically at deploy, rolling back is redeploying an older `dataset.json`, and a half-finished load is never served. Old versions' databases can be deleted once no deploy uses them.

**Worker** (`worker/`). `api.ts` routes the JSON API, `queries.ts` holds all SQL, and `pages.ts` renders work and composer pages: the app's `index.html` with title, description, Open Graph tags, schema.org JSON-LD and the page's content filled in, so links preview well and search engines see content. The app then takes over in the browser, reusing the embedded data. Queries use D1's read replicas (`withSession`), since the data is read-only.

**App** (`src/`). React and Vite, static assets. A small router (`src/lib/router.tsx`) handles the finder (`/`), work, composer, search and about pages. The finder stays mounted under other pages, so going back keeps your line-up, filters and scroll position; the line-up, search, filters and sort are also in the URL (`src/lib/filters.ts`), so links and reloads show the same list. A crash shows a way out (reload, start over, report it) rather than a blank page. Line-up counts for the instrument picker come from one cached request (`/api/lineups`); lists page through `/api/works`.

## Caching

API responses and rendered pages are cached at Cloudflare's edge for a week and in browsers for five minutes. The edge cache key includes the dataset version and a build id, and the app sends its build id with every API request, so neither the edge nor a browser hands new code a response made for the last deploy's (that once crashed the finder), and nothing needs purging. Most requests never reach D1. The dev server caches nothing.

## Local development

`npm run dev` runs everything locally through the Cloudflare Vite plugin: the app, the Worker and a local D1. Local D1 is a SQLite file under `.cloudflare/state/`; `crawler/local.ts` (`npm run data:local`, also run by `data:pull`) puts the current dataset there. Nothing in development touches production.

## Tests

The tests are weighted towards checking the whole system and the data, rather than units:

- **Unit** (`*.test.ts` next to the code): only where logic is intricate: work matching, id assignment, instrumentation parsing, the line-up rules for each source.
- **Integration**: the build end to end on a miniature crawl (`test/fixtures.ts`), including ids across two crawls and the SQL dump D1 loads; and the API on its output, through the real handler and queries (`test/d1.ts` stands in for D1 with `node:sqlite`).
- **Data** (`test/data/`): on the full dataset. `integrity.test.ts` checks every table against the rules in SQL. `repertoire.test.ts` checks the music is right: canonical works where they belong, known mistakes gone, search finding what people type, lookups. The latter runs against a live site too (`DATA_URL`).
- **End to end** (`e2e/`): Playwright in Chrome against a local dev server or a deployed site.
- **Smoke** (`smoke/`): a deployed site's serving, freshness and downloads.

## Costs

Static assets are free. D1 and the Worker run on the Workers Paid plan ($5/month): loading a dataset writes a few million rows (50M a month are included), and with edge caching, reads stay far below the included 25 billion. R2 holds the downloads, a few hundred MB per version.
