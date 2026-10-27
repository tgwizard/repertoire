# Data

What the dataset is meant to be: every work for classical instruments, listed for the exact line-ups it's written for, ranked by how established it is, and linked to where you can get the music. It's built from open sources and published under CC BY-SA 4.0. This describes the intent; the code is the source of truth (`crawler/`, schema in `crawler/db.ts`).

## Sources

| Source | Why | License |
|---|---|---|
| [IMSLP](https://imslp.org) | The backbone: its `For …` categories give each work's exact instrumentation, separately for arrangements, and it has the free sheet music. Also eras, whether a work has recordings, and from its work pages durations, movements, an orchestra's scoring (the names of its parts) and who arranged what. | CC BY-SA 4.0 |
| [Wikipedia](https://en.wikipedia.org) | Editors' `Compositions for …` lists: evidence a work is notable, and works IMSLP lacks (often still in copyright). | CC BY-SA 4.0 |
| [Wikidata](https://www.wikidata.org) | The links between the others (IMSLP pages, Wikipedia articles, MusicBrainz works), composition dates, composers' lifespans; works tagged with an ensemble. | CC0 |
| [Open Opus](https://openopus.org) | Curated main works of well-known composers, marked popular or recommended. | CC0 |
| [MusicBrainz](https://musicbrainz.org) | Recording counts (core data only). | CC0 |
| [Mutopia](https://www.mutopiaproject.org) | Free engraved editions, linked from the works they belong to (often single movements, so links, not works). | links only |
| [LIBRIS](https://libris.kb.se) | The sheet music held by Musik- och teaterbiblioteket, Stockholm (lends scores and parts in Sweden): links to borrow works we have, and works we lacked when the library states their instrumentation, in its own field or in the title ("variationer för blåskvintett"). | CC0 |
| [GND](https://www.dnb.de/gnd) | The German National Library's musical works: instrumentation as structured data, opus and catalogue numbers, keys, dates; contemporary works too. | CC0 |
| [RISM](https://rism.online) | Manuscripts and early prints and the libraries holding them: where copies of works we have are kept, and how many libraries have one; the parts of a copy give an orchestral work's scoring. | CC BY 3.0 |

Next in line: more libraries. Sources without an open license (publishers, music information centres) can still be linked to, but not copied.

## Crawl

`npm run crawl` runs one stage per source (name some to run only those: `npm run crawl -- wikidata build`):

| Stage | Fetches | Refreshed |
|---|---|---|
| `imslp` | all ~11k `For …` categories and their works, with era and recording tags | when a category's size changes, else after 30–90 days |
| `imslp-pages` | every IMSLP work page's text, 50 a request; only the fields we use are kept (Instrumentation, movements, duration, the part names of the original edition, and each arrangement's headings, arranger and license); pages read before a field was kept are read again | after 60–120 days |
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

The build reads stages with their text composed to Unicode NFC: GND and RISM write "ö" as "o" plus a combining mark, which otherwise matches nothing spelled the usual way (it once kept every GND work with a flute out). Their dumps are decoded as a stream, not chunk by chunk (a character split across two chunks once garbled titles), and any U+FFFD in the dataset fails the data tests, naming its source record.

Each stage's last run, last completed run, failed requests and stale cache use are recorded in `.cache/stages/manifest.json`. A failed stage keeps its last completed output, which the build uses, but the run fails and publishing refuses a dataset built from it, or from a source older than its limit, unless told otherwise (see [architecture.md](architecture.md)).

## Combine

The guiding rule: **a work is listed for a line-up only when a source says it's for exactly those players**, and when in doubt, keep records apart rather than merge them wrongly.

1. **IMSLP first.** Each IMSLP work page becomes a work, listed for every instrumentation category it's in. A work can have several line-ups (Handel's flute sonatas are also for violin); arrangements are listed separately from originals.
2. **Composers** are matched through Wikidata's IMSLP ids, then for Open Opus through Wikidata's and GND's names (GND's composers are known before Open Opus's, so one person isn't two), else by surname with all given names agreeing, else by full name and birth year. A shared name alone, or two unknown dates, isn't enough.
3. **Works** from other sources are matched to IMSLP works by shared ids first (Wikidata's IMSLP id), then within a composer by catalogue number (Op., K., BWV, D., Hob. and two dozen more; exact sub-numbers first), key and title once numbers and keys are set aside. Different keys or different numbers in the same catalogue mean different works, whatever else they share; ties and ambiguity mean no match. A match by title alone needs the rest to agree: line-ups that differ (unless one is vague, "voices with keyboard"), or years more than two apart, mean different works, and a title that's only a genre ("Concerto", "Studien") needs the same line-up to go on.
4. **Works IMSLP lacks** come in only when a source states a line-up: a Wikipedia ensemble category, a Wikidata ensemble tag whose instruments all fit, or an Open Opus title naming a standard ensemble ("String Quartet no. 3", but not "…, for soprano and string quartet"). A title naming a group size must agree with it, and IMSLP's own categories always win.
5. **Links only**: Mutopia editions attach to the work they're from; LIBRIS records of works we have add a link to borrow them. Composers from these match on surname and life dates (within a year).
6. **New works from libraries and authority files** come in with care. LIBRIS: when the instrumentation is fully understood, from the library's field or spelled out in the title after "för", "for", "für", "pour" or "per" (Swedish, English, Danish and Norwegian, German, French, Italian; every word must be known), and it's not an arrangement, reduction or anthology. When the field and the title name different instruments the edition is probably an arrangement, and neither counts. Titles less their line-up ("Danzas argentinas, pour piano") match works we have for that line-up, unless that leaves only a genre ("Sonat"); later editions match the uniform title, or that title and line-up. GND: when its instrumentation maps to ours and the work can't be one we have under another title: none of the composer's works for that line-up shares a telling word with it, or is of its genre in any language with one of the two titles saying no more than that ("Concerto in C major" and "Oboe Concerto in C major"), unless a number or key tells them apart. Matching uses GND's other names too ("Estampien" is also "Estampes"). Records are read in GND's id order and judged against the other sources' works as they were before any GND record: what matched records say of a work (a year, a line-up) is applied once all are read, and records that disagree on a year leave it unknown. GND records aren't matched to one another by title, only by the same numbers for the same line-up (GND has duplicates too). Records of parts of works ("Lakmé. Où va la jeune Indoue") link to the work they're part of when we have it; when we don't, a song, an aria or a number in a set comes in on its own, a movement doesn't (nor anything GND's other names call a movement, "1. Satz"). A record of a composer's works ("Werke") never comes in. GND's other names for a work ("Tre studi per flauto, clarinetto e fagotto") become aliases.
7. **RISM** adds copies, never works: a source matches a work of the same composer (via GND or Wikidata ids) by catalogue number or title. A work shows up to three copies, the composer's own hand first, then prints, and counts the libraries holding one.
8. **An orchestra's scoring** (`2.2.2.2 – 4.2.3.1 – timp – str`; `3/picc` for a flautist who doubles piccolo, `2+picc` for a piccolo player of their own) is read from each edition's part names on IMSLP ("Flute 1, 2", "Flute 3/Piccolo", "Horn 3/4"), the Instrumentation field, and RISM's library copies: each is one reading. Asides in part names count: "Flute 3 (also Piccolo)" is a doubling, "Timpani (2 players)" two players, and an aside naming an instrument we can't place ("Alto or Bass Flute") makes the reading partial. IMSLP's readings of a whole orchestra (strings and some winds, brass or timpani; a band's: three or more instruments; from parts, only when they're named one by one) decide the scoring; libraries' copies only when IMSLP has none, as copies often add parts or arrange. When the deciding readings agree, the scoring is theirs; when they differ, each instrument at the most any asks for, so it never asks for less than a version needs. Percussion and doublings are taken at the most any gives, and parts uploaded on their own ("Harp") add to it. Its status says how far to trust it: **confirmed** when two readings, copies included, give just that scoring, **single** otherwise, **partial** when a deciding reading names something we can't read ("Alto Horn", "Typewriter"; voices and scores aside) or no reading is of the whole orchestra ("Complete Parts" and a timpani sheet). Partial scorings are shown on the work's page for what they're worth but never say what an orchestra can play. Whether an orchestra can: as many players of each instrument, and only the doublings it declares (a flautist doesn't play piccolo, nor an organist piano, unless said; doublings on two auxiliaries of a section may be one player's); exactly so: the same instruments and players throughout. String orchestra works need no scoring: they need strings.
9. **Titles other sources use** are kept as aliases, so a search for "Dvořák American" finds IMSLP's "String Quartet No.12, Op.96". Search keeps every script's letters ("Скажи, зачем?"), folding Latin accents.
10. **Arrangements** come from the headings on IMSLP's work pages ("Overture" › "For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)") and their Arranger fields: the arranger, the excerpt if it isn't the whole work, and the line-up when it's one of those IMSLP lists the work as arranged for. Arrangers are searchable, so a search for one finds the works they arranged.

## Rank

Each work's score adds up evidence that it's played (`SIGNALS` and `scoreParts` in `src/shared/data.ts`): popular or recommended in Open Opus, commercial recordings or audio on IMSLP, an English Wikipedia article, a Wikipedia ensemble listing, MusicBrainz recordings (log scale), how many libraries hold copies (RISM, LIBRIS; log scale, up to 2 points), and how many Wikipedias cover the work and its composer. 6 or more is "core repertoire". Lists show originals before arrangements, each by score; with smaller groups, the largest groups come first.

## Persistent ids

Works and composers have short ids (`3k5esqdj`) used in URLs and the downloads, which must survive rebuilds even as sources rename, merge or split records. Each entity is anchored to the source records it came from (`imslp:<page id>`, `wikidata:<QID>`, `gnd:<id>`, `openopus:<id>`, `libris:<id>`; for composers also their name and dates), strongest first, and every anchor is kept in the dataset (the `anchors` table, in the SQLite download), whether or not there's a page to link to. A build reuses the previous dataset's id for any of its anchors; a new entity gets a hash of its strongest anchor. When two entities turn out to be one, the losing id redirects to the winner (the `redirects` table; the site and API answer with 301s); a record of part of a work redirects to the work. When one splits, the part with the stronger anchor keeps the id, and between equally strong ones the part with the title and year the id showed. An id no longer in the dataset, and not merged, is retired: its URL answers 410 with what it was and why it's gone, and, when its record was left out as possibly being another work, the works it may be (the `retired` table); its anchors stay, so it comes back if its records do, and ids merged into it before still lead to that page. Anchors of records no entity has any more (a source dropped one, for now) are kept with the id they had, so a record that leaves and comes back finds it again. An old id is never given to something else. `test/data/integrity.test.ts` checks that every id of the previous build is still live, redirected or retired, and how many records changed id (`id-changes.txt` beside the dataset lists them).

## The dataset

One SQLite database, the same in the downloads and in D1. Its tables (columns are commented in `crawler/db.ts` and in the downloads' README):

| Table | Holds |
|---|---|
| `works` | title, aliases, composer, year, era, score and its signals, whether there's free sheet music, main line-up, duration and movements |
| `composers` | name, sort name, lifespan, era |
| `lineups` | each line-up (`cello,viola,violin*2`), its players, counts of original and arrangement-only works, and the categories that define it |
| `scorings` | which works are for which line-ups, original or arrangement, and which sources say so |
| `orchestrations` | an orchestral work's scoring in the shorthand, its instruments and doublings (a column each, for "can our orchestra play it"), its status (confirmed, single, partial), what it's read from, and parts we couldn't read |
| `arrangements` | IMSLP's arrangements of a work: arranger, excerpt, line-up, heading and license |
| `links` | where to find works and composers: free sheet music (IMSLP, Mutopia), library copies (LIBRIS, RISM), articles, database records (Wikidata, GND, MusicBrainz), by provider and the provider's own id |
| `lineup_facets` | for line-ups of 500 works or more, the unfiltered list's facets and total, counted ahead by the API's own code, so a big line-up's first view needn't count |
| `redirects` | ids merged into others |
| `retired` | ids no longer listed: what they were, why, and the works they may be |
| `sources` | each source's fetch time, records pulled, matched and added, and license |
| `meta` | version, build time, counts, stats |
| `works_fts`, `composers_fts` | full-text search (titles, aliases, names, catalogue numbers, arrangers), Latin accents folded |
| `anchors` | (SQLite download only) every source record each id was built from, for the next build |

A line-up key lists instrument ids alphabetically, `*N` for several players. Groups that vary in size are single ids ("orchestra", "strings", "mixed chorus").

## Get it

- Downloads of every version: `https://repertoire-data.tgwizard.com/datasets/<version>/repertoire.sqlite.gz` and `repertoire-csv.zip`, with `manifest.json` (checksums; there once the version is complete); `datasets/latest.json` names the current one.
- The JSON API: `https://repertoire.tgwizard.com/api` lists the endpoints.

Credit Repertoire Finder and the sources above, and share alike (CC BY-SA 4.0).
