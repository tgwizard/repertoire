// The dataset's schema. The build writes it with node:sqlite; the same database is
// published as the SQLite download and loaded into Cloudflare D1, which the Worker
// queries. Comments here are the documentation of the downloads too.

export const SCHEMA_VERSION = 5;

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

-- An orchestral work's scoring, in the shorthand orchestras use. The counts are players
-- per section, auxiliaries included (a piccolo needs a flautist), so that "can our
-- orchestra play it" is a comparison per column.
CREATE TABLE orchestrations (
  work_id TEXT PRIMARY KEY REFERENCES works (id),
  scoring TEXT NOT NULL,              -- "2+picc.2.2.2+cbn – 4.2.3.1 – timp – perc – str"
  instruments TEXT NOT NULL,          -- JSON: instrument → players ({"fl":2,"picc":1,…})
  fl INTEGER NOT NULL, ob INTEGER NOT NULL, cl INTEGER NOT NULL, bn INTEGER NOT NULL,
  hn INTEGER NOT NULL, tpt INTEGER NOT NULL, tbn INTEGER NOT NULL, tba INTEGER NOT NULL,
  timp INTEGER NOT NULL, perc INTEGER NOT NULL, hp INTEGER NOT NULL,
  kbd INTEGER NOT NULL,               -- piano, celesta, organ, harpsichord, continuo
  other INTEGER NOT NULL,             -- saxophones, guitars, mandolins
  str INTEGER NOT NULL,               -- 1 with a string section
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

-- Where to find works and composers: sheet music, articles, database records
CREATE TABLE links (
  entity TEXT NOT NULL,               -- 'work' or 'composer'
  entity_id TEXT NOT NULL,
  provider TEXT NOT NULL,             -- imslp, wikipedia, wikidata, musicbrainz, openopus
  kind TEXT NOT NULL,                 -- score, library, reference, data
  ref TEXT NOT NULL,                  -- the provider's id (IMSLP page id, QID, …)
  url TEXT,
  label TEXT,
  source TEXT NOT NULL,               -- the source we got the link from
  position INTEGER NOT NULL,          -- order among a provider's links for one entity (best first)
  PRIMARY KEY (entity, entity_id, provider, ref)
) WITHOUT ROWID;

-- Ids of works and composers that were merged into another
CREATE TABLE redirects (
  entity TEXT NOT NULL,
  old_id TEXT NOT NULL,
  new_id TEXT NOT NULL,
  PRIMARY KEY (entity, old_id)
) WITHOUT ROWID;

-- Full-text search; rowid is works.n / composers.n
CREATE VIRTUAL TABLE works_fts USING fts5 (title, composer, aliases, keys, tokenize = 'unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE composers_fts USING fts5 (name, tokenize = 'unicode61 remove_diacritics 2');
`;

export const INDEXES = `
CREATE INDEX works_composer ON works (composer_id, score DESC);
CREATE INDEX scorings_rank ON scorings (lineup, arrangement, score DESC);
CREATE INDEX scorings_work ON scorings (work_id);
-- A provider's record belongs to one work or composer (it anchors its id).
CREATE UNIQUE INDEX links_ref ON links (entity, provider, ref);
`;

/** Tables in the downloads and in D1, in dependency order (FTS tables are rebuilt from these). */
export const DATA_TABLES = ["meta", "sources", "composers", "works", "lineups", "scorings", "orchestrations", "links", "redirects"] as const;
