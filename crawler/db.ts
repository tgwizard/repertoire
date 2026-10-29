// The dataset's schema. The build writes it with node:sqlite; the same database is
// published as the SQLite download and loaded into Cloudflare D1, which the Worker
// queries. Comments here are the documentation of the downloads too.

import { column, ORCHESTRA_KEYS } from "../src/lib/orchestration.ts";

export const SCHEMA_VERSION = 8;

export const TABLES = `
-- Dataset version, build time, counts, schema version and stats (JSON)
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- The sources the data was combined from, with their licenses
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  license TEXT NOT NULL,
  license_url TEXT NOT NULL,
  role TEXT NOT NULL,
  fetched_at TEXT,
  items INTEGER NOT NULL,             -- records pulled from the source
  matched INTEGER,                    -- of those, matched to works from earlier sources
  added INTEGER,                      -- works only this source knows
  note TEXT NOT NULL
);

CREATE TABLE composers (
  n INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,            -- persistent id, as in /composer/<id>
  name TEXT NOT NULL,
  sort_name TEXT NOT NULL,            -- "Brahms, Johannes"
  born INTEGER,
  died INTEGER,
  era TEXT,
  sitelinks INTEGER NOT NULL,         -- Wikipedia editions with an article, for ranking
  works INTEGER NOT NULL
);

CREATE TABLE works (
  n INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,            -- persistent id, as in /work/<id>
  title TEXT NOT NULL,
  aliases TEXT NOT NULL,              -- JSON array: other titles in other sources ("American")
  composer_id TEXT REFERENCES composers (id),
  year INTEGER,                       -- of composition or first publication
  era TEXT,
  score REAL NOT NULL,                -- how established the work is (see signals)
  signals TEXT NOT NULL,              -- JSON array of signal ids
  recordings INTEGER,                 -- on MusicBrainz
  sitelinks INTEGER NOT NULL,
  free INTEGER NOT NULL,              -- 1 if sheet music is free to download (IMSLP)
  lineup TEXT NOT NULL,               -- its main line-up (the first original one)
  lineups INTEGER NOT NULL,           -- number of line-ups it is listed for
  copies INTEGER NOT NULL,            -- libraries known to hold a copy (RISM, LIBRIS)
  duration INTEGER,                   -- seconds, roughly (IMSLP)
  movements INTEGER                   -- (IMSLP)
);

-- An orchestral work's scoring, in the shorthand orchestras use, and what it's read from.
-- A column per instrument, of its players (a piccolo "+picc" is a player of its own),
-- and per doubling ("fl_picc": flautists who also play piccolo), so that whether an
-- orchestra can play it is a comparison of columns (see src/lib/orchestration.ts).
CREATE TABLE orchestrations (
  work_id TEXT PRIMARY KEY REFERENCES works (id),
  scoring TEXT NOT NULL,              -- "2+picc.2.2.2+cbn – 4.2.3.1 – timp – perc – str", "3/picc…"
  instruments TEXT NOT NULL,          -- JSON: instrument → players ({"fl":3,"fl/picc":1,…})
  status TEXT NOT NULL,               -- confirmed (two readings agree), single (one, its parts named one by one), partial (not to be relied on)
  basis TEXT NOT NULL,                -- what it's read from: "an edition's parts and the Instrumentation field"
  unresolved TEXT NOT NULL,           -- JSON: parts it names we can't read ("Alto Horn 1")
  ${ORCHESTRA_KEYS.map((k) => `${column(k)} INTEGER NOT NULL`).join(", ")},
  source TEXT NOT NULL,               -- imslp (its parts or Instrumentation field), rism
  ref TEXT NOT NULL                   -- the IMSLP page id or RISM source id it's read from
) WITHOUT ROWID;

-- Line-ups: a key lists instrument ids, sorted, with "*N" for several players
-- ("cello,viola,violin*2" is a string quartet)
CREATE TABLE lineups (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  players INTEGER NOT NULL,
  original INTEGER NOT NULL,          -- works written for it
  arrangements INTEGER NOT NULL,      -- works only arranged for it
  sources TEXT NOT NULL               -- JSON: source → categories/items that define it
);

-- Which works are for which line-ups (a work can have several versions), and who says so
CREATE TABLE scorings (
  work_id TEXT NOT NULL REFERENCES works (id),
  lineup TEXT NOT NULL REFERENCES lineups (key),
  arrangement INTEGER NOT NULL,       -- 1 if only an arrangement is for this line-up
  players INTEGER NOT NULL,
  score REAL NOT NULL,                -- the work's score, for ordering
  sources TEXT NOT NULL,              -- JSON [{source, ref}]: the category or item stating it
  PRIMARY KEY (lineup, work_id)
) WITHOUT ROWID;

-- Arrangements on IMSLP: who arranged a work, or part of it, for which line-up
CREATE TABLE arrangements (
  work_id TEXT NOT NULL REFERENCES works (id),
  lineup TEXT REFERENCES lineups (key), -- when the heading reads as one of the work's line-ups
  arranger TEXT,                      -- "Jesper Jerkert", "the composer"; null when unknown
  excerpt TEXT,                       -- what's arranged when not the whole work ("Overture")
  heading TEXT NOT NULL,              -- IMSLP's: "For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)"
  license TEXT,                       -- of its files: "Public Domain", "Creative Commons Attribution 4.0"
  position INTEGER NOT NULL,          -- order on the IMSLP page
  PRIMARY KEY (work_id, position)
) WITHOUT ROWID;

-- Where to find works and composers: sheet music, library copies, editions, articles, database records
CREATE TABLE links (
  entity TEXT NOT NULL,               -- 'work' or 'composer'
  entity_id TEXT NOT NULL,
  provider TEXT NOT NULL,             -- a source (imslp, wikipedia, wikidata, musicbrainz, openopus, mutopia, libris, gnd, dnb, k10plus, rism), or swedish-libraries (LIBRIS records not at Musik- och teaterbiblioteket)
  kind TEXT NOT NULL,                 -- score, library, edition (published, to buy), reference, data
  ref TEXT NOT NULL,                  -- the provider's id (IMSLP page id, QID, …)
  url TEXT,
  label TEXT,
  source TEXT NOT NULL,               -- the source we got the link from
  position INTEGER NOT NULL,          -- order among a provider's links for one entity (best first)
  PRIMARY KEY (entity, entity_id, provider, ref)
) WITHOUT ROWID;

-- A big line-up's list, unfiltered, counted ahead (the API's facets and total, as JSON),
-- so its first view needn't count tens of thousands of works
CREATE TABLE lineup_facets (
  lineup TEXT NOT NULL REFERENCES lineups (key),
  arrangements INTEGER NOT NULL,      -- 1 with arrangements listed too
  total INTEGER NOT NULL,
  facets TEXT NOT NULL,
  PRIMARY KEY (lineup, arrangements)
) WITHOUT ROWID;

-- Ids of works and composers that were merged into another
CREATE TABLE redirects (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_id TEXT NOT NULL,
  PRIMARY KEY (entity, old_id)
) WITHOUT ROWID;

-- Ids no longer in the dataset, and not merged into another, so their URLs can say what
-- they were and why they're gone (HTTP 410) rather than nothing at all
CREATE TABLE retired (
  entity TEXT NOT NULL,               -- 'work' or 'composer'
  id TEXT NOT NULL,
  title TEXT NOT NULL,                -- the work's title or the composer's name, when last listed
  composer TEXT,                      -- a work's composer, by name
  since TEXT NOT NULL,                -- the first dataset version without it
  reason TEXT NOT NULL,               -- 'uncertain': may be a work listed (see_also) under another title; 'gone': no longer in the sources, or no longer qualifies
  see_also TEXT NOT NULL,             -- JSON array of work ids it may be
  PRIMARY KEY (entity, id)
) WITHOUT ROWID;

-- Full-text search; rowid is works.n / composers.n
CREATE VIRTUAL TABLE works_fts USING fts5 (title, composer, aliases, keys, arrangers, tokenize = 'unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE composers_fts USING fts5 (name, tokenize = 'unicode61 remove_diacritics 2');
`;

/**
 * In the built database (and the SQLite download), not in D1 or the CSVs: what the
 * next build needs to keep ids where they are (see crawler/ids.ts).
 */
export const BUILD_TABLES = `
-- The source records each work and composer was built from ("imslp:509772",
-- "wikidata:Q1234", "openopus:antonin dvorak"), whether or not they have a page to link
-- to, and those of ids no longer in the dataset, should their records come back
CREATE TABLE anchors (
  entity TEXT NOT NULL,               -- 'work' or 'composer'
  anchor TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  position INTEGER NOT NULL,          -- among the entity's anchors, strongest first; -1 for a record it no longer has (kept, should it come back)
  PRIMARY KEY (entity, anchor)
) WITHOUT ROWID;
`;

export const INDEXES = `
CREATE INDEX works_composer ON works (composer_id, score DESC);
CREATE INDEX scorings_rank ON scorings (lineup, arrangement, score DESC);
CREATE INDEX scorings_work ON scorings (work_id);
CREATE INDEX arrangements_lineup ON arrangements (work_id, lineup);
CREATE INDEX arrangements_arranger ON arrangements (arranger COLLATE NOCASE);
-- A provider's record belongs to one work or composer (it anchors its id).
CREATE UNIQUE INDEX links_ref ON links (entity, provider, ref);
`;

/** Tables in the downloads and in D1, in dependency order (FTS tables are rebuilt from these). */
export const DATA_TABLES = ["meta", "sources", "composers", "works", "lineups", "scorings", "orchestrations", "arrangements", "lineup_facets", "links", "redirects", "retired"] as const;
