# Repertoire Finder

Find the repertoire for the group you actually have: pick your instruments, get the works written for exactly that line-up, most established first, with sheet music from [IMSLP](https://imslp.org) where it exists.

Live at https://repertoire.tgwizard.com.

## How it works

A **crawler** (`crawler/`) builds a static index from five open sources, and the **app** (`src/`, React + Vite) reads it. There is no backend: the Cloudflare Worker only serves static files.

| Source | Contributes | License |
|---|---|---|
| [IMSLP](https://imslp.org) | Exact instrumentation (its `For …` categories), works, eras, whether a work has commercial recordings | CC BY-SA 4.0 |
| [Wikipedia](https://en.wikipedia.org) | Curated `Compositions for …` categories: a "this is repertoire" signal, and works IMSLP lacks | CC BY-SA 4.0 |
| [Wikidata](https://www.wikidata.org) | Links between IMSLP, Wikipedia and MusicBrainz; composer dates; years | CC0 |
| [Open Opus](https://openopus.org) | Popular and recommended works | CC0 |
| [MusicBrainz](https://musicbrainz.org) | Number of recordings per work (core data only) | CC0 |

IMSLP is the backbone because it's the only open source with exact instrumentation. The other sources add ranking signals, and add works IMSLP doesn't have (typically 20th-century works still in copyright), but only where a line-up is stated unambiguously. `crawler/ensembles.ts` lists exactly which category names and titles map to which line-ups. Every work in the app shows which sources it comes from and how its ranking was computed.

### Crawling

```sh
npm run crawl                       # all stages, then build the index into public/data/
npm run crawl -- imslp build        # specific stages: imslp, wikipedia, wikidata, openopus, composers, musicbrainz, build
npm run crawl -- --min-works 20     # skip small IMSLP categories (quicker first run)
npm run crawl -- --mb-budget 1000   # MusicBrainz lookups this run (1 per second)
npm run index                       # rebuild the index from what's already crawled
```

The crawler is polite: requests go one at a time per host, with a minimum gap, and identify the project in the `User-Agent`. It is also resilient: every response is cached under `.cache/`, so a crawl can be interrupted and resumed. Failed requests retry with backoff, and a source that fails falls back to its previous data. Re-runs are incremental. IMSLP categories are only re-fetched when their size changes, or after 30–90 days, staggered per category so they don't all expire at once. Wikipedia, Wikidata and Open Opus are refreshed weekly. MusicBrainz counts accumulate across runs, most notable works first. After a full run, cache entries that run didn't use are deleted. Keep `.cache/` between runs (in CI, with `actions/cache`); deleting it forces a full re-crawl.

The first full crawl takes a couple of hours, mostly IMSLP. Later runs take minutes.

### Index, versions and export

`npm run index` writes the app's index to `public/data/`: `ensembles.json` (line-ups and counts), `shards/*.json` (works per line-up, in rank order) and `meta.json` (build time, what each source contributed). It also writes the full dataset as a **zip of CSVs** and a **SQLite database** to `.cache/export/`.

Datasets are published as immutable versions to a public Cloudflare R2 bucket, at `https://repertoire-data.tgwizard.com/datasets/`:

```
datasets/latest.json                    # the current version, with checksums
datasets/<version>/index.zip            # the app's index
datasets/<version>/repertoire-csv.zip   # downloads, linked from the site's footer
datasets/<version>/repertoire.sqlite.gz
datasets/<version>/meta.json
```

```sh
npm run data:refresh    # crawl + publish: what the scheduled job does
npm run data:publish    # publish what's in public/data as a new version (needs `cf auth login`)
npm run data:pull       # download the latest version into public/data (no credentials)
npm run data:pull -- --version 20261019T220512Z
```

The dataset includes IMSLP and Wikipedia material, so it's published under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The code is MIT (see `LICENSE`).

## Development

Node is pinned with [mise](https://mise.jdx.dev) (`mise.toml`). Cloudflare tooling is the [`cf` CLI](https://developers.cloudflare.com/cf/) (beta), configured in `cloudflare.config.ts`.

```sh
mise install
npm install
npm run data:pull  # the published dataset (or `npm run crawl` to build your own)
npm run dev        # http://localhost:5173
npm test
npm run typecheck
```

## Deploying

```sh
npx cf auth login         # once
npm run deploy:dry-run    # build and validate, no API calls
npm run deploy            # typecheck, build, upload, deploy
```

The site deploys with whatever dataset is in `public/data/`, as static assets. Run `npm run data:pull` (or a crawl) first.
