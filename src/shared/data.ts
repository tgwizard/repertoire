// Shape of the static index in public/data/, written by the crawler (crawler/build.ts)
// and read by the app.

export const ERAS = ["Medieval", "Renaissance", "Baroque", "Classical", "Romantic", "Early 20th century", "Modern"] as const;
export type Era = (typeof ERAS)[number];

export type SourceId = "imslp" | "wikipedia" | "wikidata" | "openopus" | "musicbrainz";

export const SOURCES: Record<SourceId, { name: string; url: string; license: string; licenseUrl: string }> = {
  imslp: {
    name: "IMSLP",
    url: "https://imslp.org",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  wikipedia: {
    name: "Wikipedia",
    url: "https://en.wikipedia.org",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  wikidata: {
    name: "Wikidata",
    url: "https://www.wikidata.org",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  openopus: {
    name: "Open Opus",
    url: "https://openopus.org",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  musicbrainz: {
    name: "MusicBrainz",
    url: "https://musicbrainz.org",
    license: "CC0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
};

/** Evidence that a work is established repertoire, with the points it adds to the ranking score. */
export const SIGNALS = {
  "openopus-popular": { points: 4, label: "Marked popular in Open Opus" },
  "openopus-recommended": { points: 2, label: "Marked recommended in Open Opus" },
  "imslp-recorded": { points: 3, label: "Has commercial recordings listed on IMSLP" },
  "wikipedia-article": { points: 3, label: "Has an English Wikipedia article" },
  "wikipedia-category": { points: 2, label: "Listed in a Wikipedia “Compositions for …” category" },
  "imslp-audio": { points: 1, label: "Has recordings on IMSLP" },
} as const satisfies Record<string, { points: number; label: string }>;
export type Signal = keyof typeof SIGNALS;

/** Score at or above which a work is labelled core repertoire. */
export const CORE_SCORE = 6;

export interface Composer {
  name: string;
  born?: number;
  died?: number;
  era?: Era;
  /** IMSLP composer category, e.g. "Reicha, Anton" */
  imslp?: string;
  wikidata?: string;
  /** English Wikipedia article title */
  wikipedia?: string;
}

export interface Work {
  /** "imslp:<pageid>", "wd:<QID>" or "oo:<id>" */
  id: string;
  title: string;
  /** Key into the shard's composers map */
  composer?: string;
  /** Year of composition (or first publication), from Wikidata */
  year?: number;
  era?: Era;
  /** Only known through an arrangement for this line-up */
  arr?: true;
  score: number;
  signals: Signal[];
  /** Sources stating this work is for this line-up */
  via: SourceId[];
  imslp?: string;
  wikidata?: string;
  wikipedia?: string;
  /** Open Opus work (a hash of composer and title: the dump has no ids) */
  openopus?: string;
  musicbrainz?: string;
  /** Recording count on MusicBrainz */
  recordings?: number;
}

export interface EnsembleShard {
  /** Category names that define this line-up, per source (first shard of an ensemble only) */
  sources?: Partial<Record<SourceId, string[]>>;
  works: Work[];
}

/** data/shards/<n>.json */
export interface ShardFile {
  composers: Record<string, Composer>;
  ensembles: Record<string, EnsembleShard>;
}

/** data/ensembles.json */
export interface EnsemblesFile {
  builtAt: string;
  /** ensemble key → [original works, arrangement-only works, shard numbers in rank order] */
  ensembles: Record<string, [number, number, number[]]>;
}

/** Public, versioned datasets (Cloudflare R2): datasets/latest.json, datasets/<version>/… */
export const DATASETS_URL = "https://repertoire-data.tgwizard.com/datasets";

export const EXPORT_FILES = { csv: "repertoire-csv.zip", sqlite: "repertoire.sqlite.gz" } as const;

/** datasets/latest.json */
export interface LatestFile {
  version: string;
  builtAt: string;
  files: Record<string, { bytes: number; sha256: string }>;
}

/** data/meta.json */
export interface MetaFile {
  version: string;
  builtAt: string;
  works: number;
  ensembles: number;
  sources: Record<SourceId, { fetchedAt: string | null; items: number; note: string }>;
}
