# Repertoire Finder

Find the repertoire for the group you actually have: pick your instruments, get the works written for exactly that line-up, most established first, with sheet music from [IMSLP](https://imslp.org) where it exists.

Live at https://repertoire.tgwizard.com.

## How it works

A **crawler** (`crawler/`) builds a static index from five open sources, and the **app** (`src/`, React + Vite) reads it. There is no backend: the Cloudflare Worker only serves static files.

| Source | Contributes | License |
|---|---|---|
| [IMSLP](https://imslp.org) | Exact instrumentation (its `For …` categories), works, eras, whether a work has commercial recordings | CC BY-SA 4.0 |
| [Wikipedia](https://en.wikipedia.org) | Curated `Compositions for …` categories: a "this is repertoire" signal, and works IMSLP lacks | CC BY-SA 4.0 |
| [Wikidata](https://www.wikidata.org) | The hub linking IMSLP, Wikipedia and MusicBrainz; composer dates; years | CC0 |
| [Open Opus](https://openopus.org) | Popular and recommended works | CC0 |
| [MusicBrainz](https://musicbrainz.org) | Number of recordings per work (core data only) | CC0 |

IMSLP is the backbone because it's the only open source with exact instrumentation. The other sources add ranking signals, and add works IMSLP doesn't have (typically 20th-century works still in copyright), but only where they state a line-up unambiguously.

### 1. Crawl

`npm run crawl` runs these stages in order (or name some: `npm run crawl -- wikidata build`):

| Stage | Fetches | Refreshed |
|---|---|---|
| `imslp` | all `For …` instrumentation categories (~11k) and their works, with era and recording tags | when a category's size changes, else after 30–90 days |
| `wikipedia` | members of the `Compositions for …` categories in `crawler/ensembles.ts` | weekly |
| `wikidata` | composers and works with IMSLP ids, works tagged with an ensemble, details for Wikipedia-listed works; follows IMSLP redirects for renamed pages | weekly |
| `openopus` | the full work dump | weekly |
| `composers` | IMSLP composer eras (`People from the X era`) | every 150–210 days |
| `musicbrainz` | recording counts, most notable works first, `--mb-budget` per run (1 request/second) | every 45–75 days |
| `build` | merges, matches, ranks; writes the index and exports | each run |

The crawler is polite: requests go one at a time per host, with a minimum gap, and identify the project in the `User-Agent`. It's resilient: every response is cached on disk, so a crawl can be interrupted and resumed, failed requests retry with backoff, and a failed source falls back to its previous data. Cache lifetimes are staggered per item so they don't all expire at once, and a full run deletes cache entries it didn't use. The first crawl takes a few hours, mostly IMSLP; later runs take minutes. Use `--min-works 20` to skip small IMSLP categories for a quick local trial.

### 2. Match

Sources share no ids except through Wikidata, so works and composers are matched in this order (`crawler/match.ts`):

- **Composers:** IMSLP's name ("Prokofiev, Sergey") via Wikidata's IMSLP id; for Open Opus, via Wikidata's English label ("Sergei Prokofiev"), else by surname with all given names agreeing.
- **Works:** Wikidata's IMSLP id first. Otherwise, within the same composer:
  1. a shared catalogue number (Op., K., BWV, D., Hob., M., CD, Sz., and others), exact sub-numbers first (Op.18 No.1 before "String Quartets, Op.18"); an equal title breaks ties, since opus numbers get reused;
  2. else an equal title once catalogue numbers, keys and punctuation are removed ("String Quartet No. 1" ≈ "String Quartet No.1, Op.50"), if only one side has catalogue numbers, or they use different systems and the title has a number.
  
  Different keys, or different numbers in the same catalogue, mean different works. Ambiguous matches are left unmatched rather than guessed.
- **Line-ups:** IMSLP's categories win. Another source only sets a work's line-up when IMSLP has none for it, using the explicit mappings in `crawler/ensembles.ts`, with sanity checks: a title's group size ("Sextet") must match, and Wikidata's instrumentation must list nothing else.

### 3. Rank

A work's score adds up evidence that it's established repertoire (`SIGNALS` in `src/shared/data.ts`): popular or recommended in Open Opus, commercial recordings or audio on IMSLP, an English Wikipedia article, a Wikipedia `Compositions for …` listing, MusicBrainz recording counts, and Wikidata notability of the work and composer. 6 or more counts as core repertoire. Each line-up lists originals first, then arrangements, each by score.

### 4. Storage and structure

```
.cache/http/                 raw responses (the crawl cache), keyed by request
.cache/stages/<stage>.json   each stage's normalized output, the input to build
.cache/export/               the downloadable dataset
public/data/                 the app's index (deployed as static assets)
  ensembles.json             line-up key → [original works, arrangement-only works, shard numbers]
  shards/<n>.json            works for one or more line-ups, in rank order, with their composers
  meta.json                  dataset version, build time, per-source counts and fetch times
```

A line-up key lists instrument ids alphabetically, with counts: `cello,viola,violin*2`. A work is identified by its origin: `imslp:<pageid>`, `wd:<Wikidata QID>` or `oo:<hash>`. Types for all files are in `src/shared/data.ts`.

The **export** (`repertoire-csv.zip`, `repertoire.sqlite.gz`) has five tables: `works`, `composers`, `ensembles`, `work_ensembles` (which works are for which line-ups, and which sources say so) and `sources` (fetch times, licenses).

**Versions** are published immutably to a public Cloudflare R2 bucket, at `https://repertoire-data.tgwizard.com/datasets/`:

```
datasets/latest.json                    the current version, with checksums
datasets/<version>/index.zip            public/data as one archive
datasets/<version>/repertoire-csv.zip   downloads, linked from the site's footer
datasets/<version>/repertoire.sqlite.gz
datasets/<version>/meta.json
```

```sh
npm run data:refresh    # crawl + publish: what the scheduled job does
npm run data:publish    # publish public/data as a new version (needs `cf auth login`)
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

## Smoke tests

`npm run smoke` checks a running site over plain HTTP:
- **Serving:** the app and deep links.
- **Dataset:** its freshness and size.
- **Line-ups:** plausible counts for common ones.
- **Canon:** well-known works present and ranked near the top (Nielsen's wind quintet, Debussy's quartet, Barber's *Summer Music*, which comes from outside IMSLP).
- **Regressions:** known misclassifications stay fixed.
- **Shards:** composers resolve, ranking order holds.
- **Sources:** every source contributes.
- **Downloads:** the export files exist.

```sh
npm run smoke                                   # production
SMOKE_URL=http://localhost:5173 npm run smoke   # local dev server
```

Known data gaps are reported as `todo` tests, which print what they found but don't fail the run.

## Deploying

```sh
npx cf auth login         # once
npm run deploy:dry-run    # build and validate, no API calls
npm run deploy            # typecheck, build, upload, deploy
```

The site deploys with whatever dataset is in `public/data/`, as static assets. Run `npm run data:pull` (or a crawl) first.
