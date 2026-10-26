// Shared between the crawler (which builds the database), the Worker (which serves it)
// and the app: sources, ranking, and the shapes of API responses.

export const ERAS = ["Medieval", "Renaissance", "Baroque", "Classical", "Romantic", "Early 20th century", "Modern"] as const;
export type Era = (typeof ERAS)[number];

export type SourceId = "imslp" | "wikipedia" | "wikidata" | "openopus" | "musicbrainz" | "mutopia" | "libris" | "gnd" | "rism";

export interface SourceInfo {
  name: string;
  url: string;
  license: string;
  licenseUrl: string;
  /** What this source contributes, for the footer */
  role: string;
}

const CC_BY_SA = "https://creativecommons.org/licenses/by-sa/4.0/";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

export const SOURCES: Record<SourceId, SourceInfo> = {
  imslp: { name: "IMSLP", url: "https://imslp.org", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA, role: "Instrumentation, works and sheet music; orchestral scorings, durations" },
  wikipedia: { name: "Wikipedia", url: "https://en.wikipedia.org", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA, role: "Curated “Compositions for …” lists" },
  wikidata: { name: "Wikidata", url: "https://www.wikidata.org", license: "CC0", licenseUrl: CC0, role: "Links between sources, dates" },
  openopus: { name: "Open Opus", url: "https://openopus.org", license: "CC0", licenseUrl: CC0, role: "Popular and recommended works" },
  musicbrainz: { name: "MusicBrainz", url: "https://musicbrainz.org", license: "CC0", licenseUrl: CC0, role: "Recording counts" },
  mutopia: {
    name: "Mutopia",
    url: "https://www.mutopiaproject.org",
    license: "Links only",
    licenseUrl: "https://www.mutopiaproject.org/legal.html",
    role: "Free engraved editions",
  },
  libris: {
    name: "LIBRIS",
    url: "https://libris.kb.se",
    license: "CC0",
    licenseUrl: CC0,
    role: "Sheet music to borrow at Musik- och teaterbiblioteket, Stockholm",
  },
  gnd: {
    name: "GND",
    url: "https://www.dnb.de/EN/Professionell/Standardisierung/GND/gnd_node.html",
    license: "CC0",
    licenseUrl: CC0,
    role: "Instrumentation, numbers and dates for works, contemporary ones too",
  },
  rism: {
    name: "RISM",
    url: "https://rism.online",
    license: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    role: "Manuscripts and early prints, and the libraries that hold them; orchestral scorings",
  },
};

/** The dataset as a whole (it includes CC BY-SA content). */
export const DATA_LICENSE = { name: "CC BY-SA 4.0", url: CC_BY_SA };

// ---- Ranking ---------------------------------------------------------------

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

export interface ScoreInput {
  signals: Signal[];
  /** Recordings on MusicBrainz */
  recordings?: number | null;
  /** Wikipedia language editions with an article on the work */
  sitelinks?: number | null;
  /** The same, for the composer */
  composerSitelinks?: number | null;
  /** Libraries holding a copy (RISM, LIBRIS) */
  copies?: number | null;
}

/** The ranking score, broken down into its parts (largest first). */
export function scoreParts(w: ScoreInput): { label: string; points: number }[] {
  const parts: { label: string; points: number }[] = w.signals.map((s) => ({ label: SIGNALS[s].label, points: SIGNALS[s].points }));
  if (w.recordings) parts.push({ label: `${w.recordings} recordings on MusicBrainz`, points: Math.min(4, Math.log2(1 + w.recordings) / 2) });
  if (w.sitelinks) parts.push({ label: `Articles in ${w.sitelinks} Wikipedias`, points: Math.min(2, w.sitelinks / 10) });
  if (w.copies) parts.push({ label: `Copies in ${w.copies} ${w.copies === 1 ? "library" : "libraries"} (RISM, LIBRIS)`, points: Math.min(2, Math.log2(1 + w.copies) / 2.5) });
  if (w.composerSitelinks) parts.push({ label: "Composer's notability (Wikipedia articles)", points: Math.min(1.5, Math.log2(1 + w.composerSitelinks) / 5) });
  return parts.sort((a, b) => b.points - a.points);
}

export const score = (w: ScoreInput) => Math.round(scoreParts(w).reduce((s, p) => s + p.points, 0) * 10) / 10;

// ---- Links -----------------------------------------------------------------

/**
 * Where to find a work or composer elsewhere. "score": sheet music to download;
 * "library": a copy to borrow; "reference": an article; "data": a database record.
 */
export type LinkKind = "score" | "library" | "reference" | "data";

export type ProviderId = SourceId;

export const PROVIDERS: Record<ProviderId, { name: string; kind: LinkKind }> = {
  imslp: { name: "IMSLP", kind: "score" },
  wikipedia: { name: "Wikipedia", kind: "reference" },
  wikidata: { name: "Wikidata", kind: "data" },
  musicbrainz: { name: "MusicBrainz", kind: "data" },
  openopus: { name: "Open Opus", kind: "data" },
  mutopia: { name: "Mutopia", kind: "score" },
  libris: { name: "Musik- och teaterbiblioteket", kind: "library" },
  gnd: { name: "German National Library (GND)", kind: "data" },
  rism: { name: "RISM", kind: "library" },
};

export interface Link {
  provider: ProviderId;
  kind: LinkKind;
  /** The provider's own id: IMSLP page id, Wikidata QID, Wikipedia title… */
  ref: string;
  /** null when the provider has no page for it (Open Opus works) */
  url: string | null;
  label: string | null;
  /** The source that gave us this link */
  source: SourceId;
}

const wikiPath = (title: string) => encodeURIComponent(title.replaceAll(" ", "_"));
export const imslpUrl = (title: string) => `https://imslp.org/wiki/${wikiPath(title)}`;
export const imslpCategoryUrl = (name: string) => `https://imslp.org/wiki/Category:${wikiPath(name)}`;
export const wikipediaUrl = (title: string) => `https://en.wikipedia.org/wiki/${wikiPath(title)}`;
export const wikipediaCategoryUrl = (name: string) => `https://en.wikipedia.org/wiki/Category:${wikiPath(name)}`;
export const wikidataUrl = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;
export const musicbrainzUrl = (id: string) => `https://musicbrainz.org/work/${id}`;

/** URL of the category or item that defines a line-up in a source, if any. */
export function lineupSourceUrl(source: SourceId, ref: string): string | null {
  if (source === "imslp") return imslpCategoryUrl(ref);
  if (source === "wikipedia") return wikipediaCategoryUrl(ref);
  if (source === "wikidata") return wikidataUrl(ref);
  return null;
}

// ---- API -------------------------------------------------------------------

export interface ComposerRef {
  id: string;
  name: string;
  born: number | null;
  died: number | null;
}

/** A work in a list. `lineup`/`arrangement` describe the version that put it in the list. */
export interface WorkSummary {
  id: string;
  title: string;
  composer: ComposerRef | null;
  year: number | null;
  era: Era | null;
  score: number;
  /** Free sheet music, if any (IMSLP preferred) */
  scoreUrl: string | null;
  lineup: string;
  players: number;
  arrangement: boolean;
  /** Seconds, roughly */
  duration: number | null;
  movements: number | null;
  /** An orchestral work's scoring: "2.2.2.2 – 4.2.3.1 – timp – str" */
  orchestration: string | null;
}

/** Where an orchestral work's scoring was read */
export interface OrchestrationDetail {
  scoring: string;
  /** Instrument → players: { fl: 2, picc: 1, … } */
  instruments: Record<string, number>;
  source: SourceId;
  ref: string;
  url: string;
}

export interface Scoring {
  lineup: string;
  description: string;
  players: number;
  arrangement: boolean;
  /** Which sources say the work is for this line-up, and where */
  sources: { source: SourceId; ref: string }[];
}

export interface WorkDetail {
  id: string;
  title: string;
  /** Titles other sources use */
  aliases: string[];
  composer: (ComposerRef & { era: Era | null }) | null;
  year: number | null;
  era: Era | null;
  score: number;
  scoreParts: { label: string; points: number }[];
  /** Libraries known to hold a copy (RISM, LIBRIS) */
  copies: number;
  /** Seconds, roughly */
  duration: number | null;
  movements: number | null;
  orchestration: OrchestrationDetail | null;
  scorings: Scoring[];
  links: Link[];
}

export interface ComposerDetail extends ComposerRef {
  era: Era | null;
  sortName: string;
  works: number;
  links: Link[];
  /** Line-ups with the composer's works, most first */
  lineups: { key: string; description: string; count: number }[];
}

/** Length filters, in minutes: from (inclusive) to (exclusive), 0 for open-ended */
export const LENGTHS: { label: string; min: number; max: number }[] = [
  { label: "Under 10 min", min: 0, max: 10 },
  { label: "10–20 min", min: 10, max: 20 },
  { label: "20–40 min", min: 20, max: 40 },
  { label: "Over 40 min", min: 40, max: 0 },
];

/** Counts for each filter's options, with the other filters applied (but not its own) */
export interface Facets {
  /** Every era the line-up has, 0 where the other filters leave none */
  eras: Partial<Record<Era | "Unknown", number>>;
  /** Works per LENGTHS entry, and how many have no known length */
  lengths: { known: number[]; unknown: number };
  composers: { id: string; name: string; count: number }[];
  /** Sub-line-ups, when listing a group's smaller groups too */
  lineups: { key: string; description: string; players: number; count: number }[];
  core: number;
  free: number;
}

export interface WorksPage {
  total: number;
  offset: number;
  works: WorkSummary[];
  facets: Facets | null;
  /** With an orchestra to fit: works for orchestra whose scoring isn't known, left out */
  unscored?: number;
}

export interface SearchResults {
  composers: (ComposerRef & { works: number })[];
  works: WorkSummary[];
  total: number;
}

/** Works per line-up: key → [original works, arrangement-only works] */
export interface LineupsIndex {
  version: string;
  lineups: Record<string, [number, number]>;
}

export interface SourceStats {
  fetchedAt: string | null;
  /** Records pulled from the source */
  items: number;
  /** Records matched to a work we already had (from an earlier source) */
  matched: number | null;
  /** Works only this source knows */
  added: number | null;
  note: string;
}

export interface DatasetStats {
  core: number;
  /** Works with free sheet music */
  free: number;
  /** Works known only through arrangements */
  arrangementOnly: number;
  /** Orchestral works with a known scoring, by where it was read */
  orchestrations?: Partial<Record<SourceId, number>>;
  /** Works with a duration, and with a number of movements */
  durations?: number;
  movements?: number;
  /** Per source: line-up assignments it vouches for, and links it gave */
  bySource: Record<SourceId, { lineups: number; links: number }>;
  links: Record<ProviderId, number>;
  eras: Partial<Record<Era | "Unknown", number>>;
  /** Line-ups and their works (originals) by number of players: "1" … "9", "10+" */
  sizes: { players: string; lineups: number; works: number }[];
  topLineups: { key: string; description: string; works: number }[];
  redirects: number;
}

export interface Meta {
  version: string;
  builtAt: string;
  works: number;
  composers: number;
  lineups: number;
  sources: Record<SourceId, SourceStats>;
  stats: DatasetStats | null;
}

export type WorkSort = "rank" | "players" | "chronological" | "composer" | "title" | "duration";
export type SortOrder = "asc" | "desc";

// ---- Published datasets ----------------------------------------------------

/** Public, versioned datasets (Cloudflare R2): datasets/latest.json, datasets/<version>/… */
export const DATASETS_URL = "https://repertoire-data.tgwizard.com/datasets";

export const EXPORT_FILES = { csv: "repertoire-csv.zip", sqlite: "repertoire.sqlite.gz" } as const;

/** datasets/latest.json */
export interface LatestFile {
  version: string;
  builtAt: string;
  files: Record<string, { bytes: number; sha256: string }>;
}
