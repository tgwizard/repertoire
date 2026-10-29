# Sources we could add

Sources we don't use yet that could bring more works, especially recently written chamber music, which the current sources add late or never. Surveyed 2026-10-25 and 2026-10-28. "Open" means a stated licence that allows reuse under CC BY-SA. Everything else needs permission before we copy its data, though we can link to it. Database rights protect catalogues in the EU and EEA even without copyright in the individual records.

A measure of the gap: Repertoire had 922 original wind quintets, 34 of them dated after 2010. Of the recent wind quintets sampled from the sources below, Repertoire already had 0–25% of those in library catalogues and 7% of those from music information centres.

## Library catalogues

K10plus, the German union catalogue, was added on 2026-10-28 (its catalogue data is [CC0](https://wiki.k10plus.de/spaces/K10PLUS/pages/358711298/Open+Data)); see [data.md](data.md).

| Source | What it brings | Access | Licence |
|---|---|---|---|
| [BnF](https://catalogue.bnf.fr) (Bibliothèque nationale de France) | French legal deposit of printed music: 30–40 wind quintets 2015+, and about 1,000–3,300 scores a year. Line-ups are coded with counts in UNIMARC 145 (`01wfl 01wob 01wcl 01bho 01wba`). Mostly catalogued within a year. | SRU `catalogue.bnf.fr/api/SRU`, `bib.doctype any "c" and bib.date any "YEAR"`, unimarcxchange | Open: [Licence Ouverte (Etalab)](https://www.bnf.fr/fr/conditions-de-reutilisations-des-donnees-de-la-bnf), cite the source and date |
| [swisscovery](https://swisscovery.slsp.ch) (Swiss academic libraries) | About 27 five-player wind quintets 2015+. MARC 382 is indexed, so it can be queried by line-up. | Alma SRU `swisscovery.slsp.ch/view/sru/41SLSP_NETWORK`, `alma.medium_of_performance=…` | Not named: "metadata without specific marking may be used generally" ([SLSP](https://slsp.ch/en/?p=1277)). **Ask, or confirm the licence.** |
| [OBV](https://www.obvsg.at) and [ÖNB](https://www.onb.ac.at) (Austrian libraries, Austrian National Library) | About 82 wind quintet records 2015+ (raw, editions), mostly German and Austrian publishers. MARC 382. | Alma SRU `43ACC_NETWORK` and `43ACC_ONB`, as for swisscovery | Not checked |
| [Library of Congress](https://catalog.loc.gov) | US copyright deposits: 31 wind quintets 2015+, but sparse and slow to catalogue. Its name-title authorities (id.loc.gov) carry 382 line-ups for established works. | SRU `lx2.loc.gov:210/LCDB` (flaky paging, no date index); id.loc.gov | Open: US government work, no restrictions claimed |
| [Melinda](https://melinda.kansalliskirjasto.fi) (Finnish union catalogue) | A few recent Finnish wind quintets. MARC 382 in Finnish. The [Finna](https://finna.fi) API blocks scripts; Melinda's SRU doesn't. | SRU `sru.api.melinda.kansalliskirjasto.fi/bib` | Probably CC0 (the National Library of Finland's usual terms); not verified |
| [National Library of Norway](https://www.nb.no) | Norwegian printed music, about 260 scores a year, few recent wind quintets. Line-ups are in text only. | `api.nb.no/catalog/v1/items` | Probably open; not verified |
| [Polish National Library](https://data.bn.org.pl) | 400–550 scores a year, with genre headings such as "Kwintet na instrumenty dęte". Catalogued about a year after publication. | `data.bn.org.pl/api/institutions/bibs.json?kind=nuty&publicationYear=Y` | Not verified |
| [Danish Royal Library](https://www.kb.dk) | About 300 scores a year, no coded line-ups; also DANKAM/UKAM scans of Danish chamber music. | Alma SRU `45KBDK_KGL` | Not checked |
| [BNE](https://www.bne.es) (Spanish National Library) | A CSV dump "Música impresa 2007–presente" listed in its open data catalogue. | Blocked to scripts (403); the catalogue needs a login | CC0 for the dump, as listed |
| [Mazers notbibliotek](https://www.mazer.se) | A Stockholm chamber-music society's library, built for amateur ensembles. | Members only | Ask (we have contacts) |

Not usable: British Library (BNB linked data is gone, the catalogue needs a login), Czech National Library (refused our requests), Italy's SBN (Z39.50 only), OCLC WorldCat (needs membership and a key), KB Netherlands (no legal deposit of music).

## Music information centres

Most member countries' centres belong to [IAMIC](https://www.iamic.net), so one letter could reach many of them. None states a data licence, so every one needs permission. They have the newest music, often unpublished or self-published, which libraries never see.

| Centre | What it brings | Access | Licence |
|---|---|---|---|
| [Svensk Musik](https://www.svenskmusik.org) (Sweden) | Swedish composers' works, with instrumentation | The site was down for maintenance when we looked | None stated. Ask. |
| [Music Finland Core](https://core.musicfinland.fi) | 28k works with instrumentation codes, year, publisher and duration; 113 wind quintets, 20 from 2015 on | Sitemap of work pages (robots.txt allows them, not search); its search runs on Algolia | "© Music Finland". Ask for an export. |
| [NB noter](https://www.nb.no/noter) (Norway; the former Norwegian Music Information Centre catalogue, now at the National Library) | About 15k works in 827 categories by line-up; 134 wind quintets (category k420). Norwegian works are almost entirely missing from Repertoire, old ones too. | Open WooCommerce Store API; product pages for dates | Shop terms only. A public body: ask for an export or a reuse statement. |
| [MIC Lithuania](https://www.mic.lt) | 19.8k works with instrumentation codes, years and durations; 1,004 from the 2020s; 61 wind quintets | JSON API (`find-works/?instrumentation=…`) | None found. Ask. |
| [Donemus](https://www.donemus.nl) (Netherlands) | Dutch contemporary music: 105 wind quintets, many reed quintets | Search form with scoring codes and years | "All rights reserved". Ask. |
| [mica – music austria](https://db.musicaustria.at) | Austrian works with instrument counts; about 200 wind quintets | Search by title only | "Alle Rechte vorbehalten". Ask. |
| [Contemporary Music Centre Ireland](https://www.cmc.ie) | 51 wind quintets | Filter by instrumentation text | robots.txt: use for reference only. Ask. |
| [Australian Music Centre](https://www.australianmusiccentre.com.au) | The best-structured catalogue: 37k work versions, line-up subject pages (e.g. quintets for flute, oboe, clarinet, horn, bassoon) | Blocks scripts (CAPTCHA) | Not checked. Ask. |
| [SOUNZ](https://sounz.org.nz) (New Zealand) | Works with year and instrumentation | Work pages open, search blocked | © CNZM Trust. Ask. |
| [Canadian Music Centre](https://cmccanada.org) | Canadian works with instrumentation | Blocks scripts | robots.txt: use for reference only. Ask. |
| [musicbase.cz](https://www.musicbase.cz) (Czech) | 79 wind quintets, mostly undated | Search by instrument and count | Not stated. Ask. |
| [Edition·S](https://www.edition-s.dk) (Denmark) | Danish works; 14 wind quintets, the newest from 2012 | Text search | Not stated |
| [EMIC](https://www.emic.ee) (Estonia), [IMIC](https://www.mic.is) (Iceland), [Musinfo](https://www.musinfo.ch) (Switzerland), [Scottish Music Centre](https://www.scottishmusiccentre.com), [Matrix](https://www.matrix-new-music.be) (Flanders), [POLMIC](https://polmic.pl) (Poland) | Their countries' works | Blocked, unreachable, or no works database found | Ask |

## Composers' publishers and other catalogues

| Source | What it brings | Access | Licence |
|---|---|---|---|
| [American Composers Alliance](https://composers.com) | US composers' self-published works: 5.2k chamber products, at least 37 wind quintets, with instrumentation and year | Open Shopify `products.json` | None found. Ask. |
| [Composers Edition](https://www.composersedition.com) | Self-published works, a few wind quintets | HTML search | Not stated |
| [Institute for Composer Diversity](https://www.composerdiversity.com) | A database of chamber works by under-represented composers | An embedded Caspio database, not counted yet | Not checked |
| [Levande musikarv](https://www.levandemusikarv.se) | 6,235 Swedish works (composers dead before about 1950), 1,680 free PDFs | Work pages | None. Ask Kungl. Musikaliska Akademien. |
| [KV Online](https://kv.mozarteum.at) | The Köchel catalogue | Work pages `kv.mozarteum.at/en/work/{id}` | Links only |
| [Edition Silvertrust](https://www.editionsilvertrust.com) | Forgotten 19th-century chamber music, with editions for sale | Shop pages | Links only |
| [Sibley Music Library](https://urresearch.rochester.edu) | Scans of old editions | OAI | All rights reserved. Links only. |
| Shops: [Notlagret](https://www.notlagret.se), [Nylund](https://www.nylund.se) | Where to buy current editions in Sweden | Search URLs (`search.php?keyword=`, `?s=&post_type=product`) | Links only |

## Not worth it

- **Wikidata and MusicBrainz:** nothing recent. Only 111 works dated 2015 or later have any instrumentation in Wikidata, and MusicBrainz works carry none.
- **Score Exchange, MuseScore and Free-scores:** user uploads, mostly arrangements, without years.
- **Wind Repertory Project:** wind band only, no licence.
- **Hofmeister XIX:** CC BY-NC-SA, which can't go into CC BY-SA.
- **WIMA:** merged into IMSLP.
- **Bach Digital:** works we already have from other sources.

## Other ways

- **A "suggest a missing work" form** for composers and publishers, moderated, where the submitter states the exact line-up.
- **Scheduled crawls,** so DNB, LIBRIS and the others bring new editions in weeks rather than when someone runs a crawl, and **GND updates** between its dumps (published about every 60 days).
