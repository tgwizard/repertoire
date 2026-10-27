# Data

What the dataset is meant to be: every work for classical instruments, listed for the exact line-ups it's written for, ranked by how established it is, and linked to where you can get the music. It's built from open sources and published under CC BY-SA 4.0. This describes the intent; the code is the source of truth (`crawler/`, schema in `crawler/db.ts`).

## Sources

| Source | Why | License |
|---|---|---|
| [IMSLP](https://imslp.org) | The backbone: its `For …` categories give each work's exact instrumentation, separately for arrangements, and it has the free sheet music. Also eras, whether a work has recordings, and from its work pages durations, movements and an orchestra's scoring (the names of its parts). | CC BY-SA 4.0 |
| [Wikipedia](https://en.wikipedia.org) | Editors' `Compositions for …` lists: evidence a work is notable, and works IMSLP lacks (often still in copyright). | CC BY-SA 4.0 |
| [Wikidata](https://www.wikidata.org) | The links between the others (IMSLP pages, Wikipedia articles, MusicBrainz works), composition dates, composers' lifespans; works tagged with an ensemble. | CC0 |
| [Open Opus](https://openopus.org) | Curated main works of well-known composers, marked popular or recommended. | CC0 |
| [MusicBrainz](https://musicbrainz.org) | Recording counts (core data only). | CC0 |
| [Mutopia](https://www.mutopiaproject.org) | Free engraved editions, linked from the works they belong to (often single movements, so links, not works). | links only |
| [LIBRIS](https://libris.kb.se) | The sheet music held by Musik- och teaterbiblioteket, Stockholm (lends scores and parts in Sweden): links to borrow works we have, and works we lacked when the library states their instrumentation. | CC0 |
| [GND](https://www.dnb.de/gnd) | The German National Library's musical works: instrumentation as structured data, opus and catalogue numbers, keys, dates; contemporary works too. | CC0 |
| [RISM](https://rism.online) | Manuscripts and early prints and the libraries holding them: where copies of works we have are kept, and how many libraries have one; the parts of a copy give an orchestral work's scoring. | CC BY 3.0 |

Next in line: more libraries. Sources without an open license (publishers, music information centres) can still be linked to, but not copied.

## Crawl

`npm run crawl` runs one stage per source (name some to run only those: `npm run crawl -- wikidata build`):

| Stage | Fetches | Refreshed |
|---|---|---|
| `imslp` | all ~11k `For …` categories and their works, with era and recording tags | when a category's size changes, else after 30–90 days |
| `imslp-pages` | every IMSLP work page's text, 50 a request; only the fields we use are kept (Instrumentation, movements, duration, and the part names of the original edition, not arrangements) | after 60–120 days |
| `wikipedia` | the `Compositions for …` categories mapped in `crawler/ensembles.ts` | weekly |
| `wikidata` | composers and works with IMSLP ids, works tagged with an ensemble, details for Wikipedia-listed works; follows IMSLP redirects for renamed pages. Dates only when precise to the year. | weekly |
| `openopus` | the full work dump | weekly |
| `composers` | IMSLP composer eras | every 150–210 days |
| `musicbrainz` | recording counts, most notable works first, a budget per run (1 request a second) | every 45–75 days |
| `mutopia` | the catalogue file | weekly |
| `libris` | Musik- och teaterbiblioteket's sheet music (~75k records), the fields we use | pages after 20–40 days |
| `gnd` | the GND work dump (~85 MB), musical works kept; their composers looked up on Wikidata by GND id | dump after 60 days |
| `rism` | RISM's monthly exports (~540 MB of sources, people for GND/Wikidata ids): sources held by a library, by composers we can identify | after 45 days |
| `build` | the dataset | each run |

Cache lifetimes are staggered per item so a refresh doesn't refetch everything at once, and entries a full run didn't use are deleted.

The build reads stages with their text composed to Unicode NFC: GND and RISM write "ö" as "o" plus a combining mark, which otherwise matches nothing spelled the usual way (it once kept every GND work with a flute out).

## Combine

The guiding rule: **a work is listed for a line-up only when a source says it's for exactly those players**, and when in doubt, keep records apart rather than merge them wrongly.

1. **IMSLP first.** Each IMSLP work page becomes a work, listed for every instrumentation category it's in. A work can have several line-ups (Handel's flute sonatas are also for violin); arrangements are listed separately from originals.
2. **Composers** are matched through Wikidata's IMSLP ids, then for Open Opus through Wikidata's English names, else by surname with all given names agreeing.
3. **Works** from other sources are matched to IMSLP works by shared ids first (Wikidata's IMSLP id), then within a composer by catalogue number (Op., K., BWV, D., Hob. and two dozen more; exact sub-numbers first), key and title once numbers and keys are set aside. Different keys or different numbers in the same catalogue mean different works; ties and ambiguity mean no match.
4. **Works IMSLP lacks** come in only when a source states a line-up: a Wikipedia ensemble category, a Wikidata ensemble tag whose instruments all fit, or an Open Opus title naming a standard ensemble ("String Quartet no. 3", but not "…, for soprano and string quartet"). A title naming a group size must agree with it, and IMSLP's own categories always win.
5. **Links only**: Mutopia editions attach to the work they're from; LIBRIS records of works we have add a link to borrow them. Composers from these match on surname and life dates (within a year).
6. **New works from libraries and authority files** come in with care. LIBRIS: when the library's instrumentation is explicit and fully understood, and it's not an arrangement or an anthology; later editions match the uniform title. GND: when its instrumentation maps to ours and the work can't duplicate one we have (no work of the same title, and none for that line-up, unless all of those carry different numbers).
7. **RISM** adds copies, never works: a source matches a work of the same composer (via GND or Wikidata ids) by catalogue number or title. A work shows up to three copies, the composer's own hand first, then prints, and counts the libraries holding one.
8. **An orchestra's scoring** (`2.2.2.2 – 4.2.3.1 – timp – str`) is read from IMSLP's part names ("Flute 1, 2", "Horn 3/4", "Alto Trombone"), and its Instrumentation field where it lists instruments, each instrument at the larger of the two counts, since uploads often lack parts and descriptions often leave out percussion. Works IMSLP has none for take the scoring most of their RISM copies agree on. It's kept only for works written for orchestra, and only when it reads as a whole orchestra (strings and some winds, brass or timpani): a string section alone usually means only the string parts were uploaded. String orchestra works need no scoring: they need strings.
9. **Titles other sources use** are kept as aliases, so a search for "Dvořák American" finds IMSLP's "String Quartet No.12, Op.96".

## Rank

Each work's score adds up evidence that it's played (`SIGNALS` and `scoreParts` in `src/shared/data.ts`): popular or recommended in Open Opus, commercial recordings or audio on IMSLP, an English Wikipedia article, a Wikipedia ensemble listing, MusicBrainz recordings (log scale), how many libraries hold copies (RISM, LIBRIS; log scale, up to 2 points), and how many Wikipedias cover the work and its composer. 6 or more is "core repertoire". Lists show originals before arrangements, each by score; with smaller groups, the largest groups come first.

## Persistent ids

Works and composers have short ids (`3k5esqdj`) used in URLs and the downloads, which must survive rebuilds even as sources rename, merge or split records. Each entity is anchored to the source records it came from (`imslp:<page id>`, `wikidata:<QID>`, `gnd:<id>`, `openopus:<id>`, `libris:<id>`), strongest first. A build reuses the previous dataset's id for any of its anchors; a new entity gets a hash of its strongest anchor. When two entities turn out to be one, the losing id redirects to the winner, and the merged record's anchor is kept as a link so that holds in later builds too (the `redirects` table; the site and API answer with 301s). When one splits, the part with the stronger anchor keeps the id. An old id is never given to something else. `test/data/integrity.test.ts` checks ids stayed put since the previous build.

## The dataset

One SQLite database, the same in the downloads and in D1. Its tables (columns are commented in `crawler/db.ts` and in the downloads' README):

| Table | Holds |
|---|---|
| `works` | title, aliases, composer, year, era, score and its signals, whether there's free sheet music, main line-up, duration and movements |
| `composers` | name, sort name, lifespan, era |
| `lineups` | each line-up (`cello,viola,violin*2`), its players, counts of original and arrangement-only works, and the categories that define it |
| `scorings` | which works are for which line-ups, original or arrangement, and which sources say so |
| `orchestrations` | an orchestral work's scoring in the shorthand, its instruments, players per section (auxiliaries counted in their section) for "can our orchestra play it", and where it was read |
| `links` | where to find works and composers: free sheet music (IMSLP, Mutopia), library copies (LIBRIS, RISM), articles, database records (Wikidata, GND, MusicBrainz), by provider and the provider's own id |
| `lineup_facets` | for line-ups of 500 works or more, the unfiltered list's facets and total, counted ahead by the API's own code, so a big line-up's first view needn't count |
| `redirects` | ids merged into others |
| `sources` | each source's fetch time, records pulled, matched and added, and license |
| `meta` | version, build time, counts, stats |
| `works_fts`, `composers_fts` | full-text search (titles, aliases, names, catalogue numbers), folded to plain ASCII |

A line-up key lists instrument ids alphabetically, `*N` for several players. Groups that vary in size are single ids ("orchestra", "strings", "mixed chorus").

## Get it

- Downloads of every version: `https://repertoire-data.tgwizard.com/datasets/<version>/repertoire.sqlite.gz` and `repertoire-csv.zip`; `datasets/latest.json` names the current one, with checksums.
- The JSON API: `https://repertoire.tgwizard.com/api` lists the endpoints.

Credit Repertoire Finder and the sources above, and share alike (CC BY-SA 4.0).
