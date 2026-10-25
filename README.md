# Repertoire Finder

Find the repertoire for the group you actually have: pick your instruments, and get the works written for exactly that line-up (or for smaller groups drawn from it), most established first, with free sheet music ([IMSLP](https://imslp.org), Mutopia) and library copies where they exist. Search works and composers, and every work and composer has its own page.

Live at https://repertoire.tgwizard.com. See [/about](https://repertoire.tgwizard.com/about) for where the data comes from, with numbers.

- [docs/architecture.md](docs/architecture.md): the parts and how they fit (crawler, dataset, Worker + D1, app), publishing and deploying, caching, tests.
- [docs/data.md](docs/data.md): the sources, how they're crawled, matched and ranked, persistent ids, and the dataset's tables.

## In short

A crawler (`crawler/`) combines nine open sources (IMSLP, Wikipedia, Wikidata, Open Opus, MusicBrainz, Mutopia, LIBRIS, the German National Library's GND and RISM) into one SQLite database. Each version is published to R2 as downloads and loaded into its own Cloudflare D1 database. A Worker (`worker/`) serves a JSON API and server-rendered work and composer pages from it, and the React app (`src/`) is static assets.

The dataset is [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (it includes IMSLP and Wikipedia material). The code is MIT (see `LICENSE`).

## Development

Node is pinned with [mise](https://mise.jdx.dev) (`mise.toml`). Cloudflare tooling is the [`cf` CLI](https://developers.cloudflare.com/cf/) (beta), configured in `cloudflare.config.ts`.

```sh
mise install
npm install
npm run data:pull     # the published dataset, loaded into local D1 (no credentials)
npm run dev           # http://localhost:5173: app, API and pages on local D1
```

Or build your own dataset: `npm run crawl` (hours the first time, minutes after; `--min-works 20` for a quick trial), which ends with `build`; then `npm run data:local` to load it into local D1. `npm run index` rebuilds from the crawl cache and loads it.

## Tests

| Command | What | Against |
|---|---|---|
| `npm test` | unit tests for the tricky parts (matching, ids, instrumentation), and integration tests of the build and the API on a miniature crawl (`test/fixtures.ts`) | fixtures |
| `npm run test:data` | data correctness: integrity of every table, canonical works ranked where they belong, known mistakes gone, search, lookups, ids stable since the last build | the built dataset |
| `npm run test:e2e` | the app in Chrome (Playwright): finding, smaller groups, pages, search, server rendering, mobile | a local dev server |
| `npm run smoke` | a deployed site: serving, freshness, downloads, plus the repertoire checks over HTTP | production, or `SMOKE_URL` |
| `npm run smoke:e2e` | the browser tests against a deployed site | production, or `SMOKE_URL` |

Known data gaps are `todo` tests: they report what they find without failing.

## Publishing and deploying

```sh
npx cf auth login        # once
npm run crawl            # or data:refresh to crawl, check and publish in one go
npm run test:data
npm run data:publish     # R2 downloads + a new D1 database; updates dataset.json
git commit dataset.json  # the deployed site serves the dataset named here
npm run deploy           # typecheck, build, deploy
npm run smoke
```
