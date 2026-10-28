// Merges the crawled sources into the dataset: one SQLite database (schema in db.ts).
//
// IMSLP is the backbone: its categories give exact instrumentation. Other sources
// add ranking signals and links to IMSLP works, and add works IMSLP doesn't have
// (typically 20th-century works still in copyright) when they state an exact line-up.

import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, ensembleKey, parseCategory, parseEnsembleKey, type Ensemble } from "../src/lib/instrumentation.ts";
import {
  CORE_SCORE,
  imslpCategoryUrl,
  imslpUrl,
  musicbrainzUrl,
  PROVIDERS,
  score,
  SOURCES,
  wikidataUrl,
  wikipediaUrl,
  type DatasetStats,
  type Era,
  type Link,
  type Meta,
  type ProviderId,
  type Signal,
  type SourceId,
} from "../src/shared/data.ts";
import { BUILD_TABLES, INDEXES, SCHEMA_VERSION, TABLES } from "./db.ts";
import { sqliteDb } from "./d1.ts";
import { listWorks, PRECOMPUTED_FACETS_MIN } from "../worker/queries.ts";
import { openOpusEnsemble, titleFitsPlayers, WIKIDATA_ENSEMBLES, WIKIPEDIA_CATEGORIES, wikidataInstrumentsFit } from "./ensembles.ts";
import { CACHE_DIR, readStage } from "./http.ts";
import { assignIds, NO_PREVIOUS, type PreviousIds } from "./ids.ts";
import { normalize, searchText } from "../src/shared/text.ts";
import { bareTitle, catalogueKeys, ComposerIndex, displayName, matchWork, memo, musicalKey } from "./match.ts";
import type { ComposerErasStage, ImslpStage } from "./sources/imslp.ts";
import type { MusicBrainzStage } from "./sources/musicbrainz.ts";
import { mutopiaUrl, type MutopiaStage } from "./sources/mutopia.ts";
import { kssbLineup, librisHolding, librisLineup, librisRecordLineup, librisUrl, MTB, type LibrisRecord, type LibrisStage } from "./sources/libris.ts";
import { composeRecord, dnbHolding, dnbLineup, dnbUrl, type DnbRecord, type DnbStage } from "./sources/dnb.ts";
import { ANTHOLOGY, genreOf, lineupFromTitle, onlyGenre, withoutLineup } from "./title-lineup.ts";
import { gndAliases, gndLineup, gndMatchTitle, gndPart, gndTitle, gndUrl, gndYear, type GndStage, type GndWork } from "./sources/gnd.ts";
import { rismMatchTitle, rismPersonUrl, rismRank, rismUrl, type RismStage } from "./sources/rism.ts";
import type { OpenOpusStage } from "./sources/openopus.ts";
import { parseDuration, parseMovements, type ImslpPagesStage } from "./sources/imslp-pages.ts";
import { readArrangements, THE_COMPOSER, type Arrangement } from "./arrangements.ts";
import { chooseScoring, isFullOrchestra, orchestrationFromParts, orchestrationFromRism, orchestrationFromText, type Reading } from "./orchestration.ts";
import { formatOrchestration, ORCHESTRA_KEYS, type Orchestration } from "../src/lib/orchestration.ts";
import type { WdWork, WikidataStage } from "./sources/wikidata.ts";
import type { WikipediaStage } from "./sources/wikipedia.ts";

export const BUILD_DIR = join(CACHE_DIR, "build");
/** The current dataset: the last build, or the published one (npm run data:pull) */
export const DATASET_PATH = join(BUILD_DIR, "repertoire.sqlite");
/** The dataset before the last build, kept to check that ids stayed put (test/data) */
export const PREVIOUS_PATH = join(BUILD_DIR, "repertoire.previous.sqlite");

export interface BuildInput {
  imslp: ImslpStage;
  imslpPages: ImslpPagesStage | null;
  eras: ComposerErasStage["eras"];
  wikipedia: WikipediaStage | null;
  wikidata: WikidataStage | null;
  openopus: OpenOpusStage | null;
  musicbrainz: MusicBrainzStage | null;
  mutopia: MutopiaStage | null;
  libris: LibrisStage | null;
  gnd: GndStage | null;
  dnb: DnbStage | null;
  rism: RismStage | null;
}

export async function loadInput(): Promise<BuildInput> {
  const imslp = await readStage<ImslpStage>("imslp");
  if (!imslp) throw new Error("No IMSLP data yet: run `npm run crawl -- imslp` first");
  return {
    imslp,
    imslpPages: await readStage<ImslpPagesStage>("imslp-pages"),
    eras: (await readStage<ComposerErasStage>("imslp-composer-eras"))?.eras ?? {},
    wikipedia: await readStage<WikipediaStage>("wikipedia"),
    wikidata: await readStage<WikidataStage>("wikidata"),
    openopus: await readStage<OpenOpusStage>("openopus"),
    musicbrainz: await readStage<MusicBrainzStage>("musicbrainz"),
    mutopia: await readStage<MutopiaStage>("mutopia"),
    libris: await readStage<LibrisStage>("libris"),
    gnd: await readStage<GndStage>("gnd"),
    dnb: await readStage<DnbStage>("dnb"),
    rism: await readStage<RismStage>("rism"),
  };
}

/** Anchor schemes, strongest first (see ids.ts). */
const WORK_SCHEMES = ["imslp", "wikidata", "gnd", "openopus", "libris", "dnb"];
const COMPOSER_SCHEMES = ["wikidata", "imslp", "gnd", "openopus", "libris"];

interface Membership {
  arr: boolean;
  /** source → the category or item that says so */
  refs: Map<SourceId, string>;
}

interface BuildWork {
  key: string;
  title: string;
  /** Titles other sources use, e.g. Open Opus's "String Quartet no. 12 …, 'American'" */
  aliases: Set<string>;
  composer?: string;
  year?: number;
  era?: Era;
  imslp?: { pageid: number; title: string };
  /** The LIBRIS record a work was created from */
  libris?: string;
  /** The DNB record a work was created from, when it names no GND work */
  dnb?: string;
  /** Its title less the line-up it spells out, for later sources to match ("Como una fantasía") */
  bareTitle?: string;
  /** German National Library work id */
  gnd?: { id: string; source: SourceId };
  wikidata?: string;
  wikipedia?: { title: string; source: SourceId };
  openopus?: string;
  musicbrainz?: string;
  recordings?: number;
  sitelinks: number;
  signals: Set<Signal>;
  ensembles: Map<string, Membership>;
  /** Libraries holding a copy (RISM sigla; LIBRIS's library codes as "libris:<code>", Musik- och teaterbiblioteket as its siglum) */
  libraries: Set<string>;
  /** An orchestra's scoring, and where it was read */
  /** Readings of an orchestra's scoring: editions' parts, the Instrumentation field, libraries' copies */
  readings: Reading[];
  /** Seconds */
  duration?: number;
  movements?: number;
  /** IMSLP's arrangements of it */
  arrangements?: Arrangement[];
  /** Links from sources that only point at the work (Mutopia editions…) */
  extraLinks: { provider: ProviderId; ref: string; url: string | null; label: string | null; source: SourceId }[];
}

interface BuildComposer {
  key: string;
  name: string;
  born?: number;
  died?: number;
  era?: Era;
  /** IMSLP category name, "Brahms, Johannes" */
  imslp?: string;
  wikidata?: string;
  wikipedia?: string;
  /** Open Opus complete name, normalized */
  openopus?: string;
  /** LIBRIS agent id, for composers only LIBRIS knows */
  libris?: string;
  /** German National Library person id */
  gnd?: string;
  /** RISM person id */
  rism?: string;
  sitelinks: number;
}

/** Rough era from a birth year, for composers with no era tag anywhere. */
function eraFromBirth(born: number): Era {
  if (born < 1400) return "Medieval";
  if (born < 1580) return "Renaissance";
  if (born < 1715) return "Baroque";
  if (born < 1785) return "Classical";
  if (born < 1860) return "Romantic";
  if (born < 1900) return "Early 20th century";
  return "Modern";
}

const OPEN_OPUS_EPOCHS: Record<string, Era> = {
  Medieval: "Medieval",
  Renaissance: "Renaissance",
  Baroque: "Baroque",
  Classical: "Classical",
  "Early Romantic": "Romantic",
  Romantic: "Romantic",
  "Late Romantic": "Romantic",
  "20th Century": "Early 20th century",
  "Post-War": "Modern",
  "21st Century": "Modern",
};

/** "Witold Lutosławski" → "Lutosławski, Witold" (IMSLP names already have this form) */
function sortName(c: BuildComposer): string {
  if (c.imslp) return c.imslp;
  const parts = c.name.split(" ");
  return parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}` : c.name;
}

/** "Quatuor Brillant (Kreutzer, Joseph)" → "Quatuor Brillant": some labels name the composer IMSLP-style. */
function withoutComposer(title: string, c: BuildComposer): string {
  const m = / \(([^()]+)\)$/.exec(title);
  const surname = normalize(c.imslp?.split(",")[0] ?? c.name.split(" ").at(-1) ?? "");
  return m && surname && normalize(m[1]!).includes(surname) ? title.slice(0, m.index) : title;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Whether two titles by one composer name the same work: equal once numbers, keys and
 * parentheses are set aside, with no key or catalogue number of the same system that differs.
 */
function sameWorkByTitle(a: string, b: string, bNumbers: Set<string>): boolean {
  const bare = bareTitle(a);
  if (bare.length < 4 || bare !== bareTitle(b)) return false;
  const [ka, kb] = [musicalKey(a), musicalKey(b)];
  if (ka && kb && ka !== kb) return false;
  const aNumbers = catalogueKeys(a);
  const system = (k: string) => k.slice(0, k.indexOf(":"));
  for (const k of aNumbers) if (!bNumbers.has(k) && [...bNumbers].some((n) => system(n) === system(k))) return false;
  return true;
}

/** A record of a composer's works, or some of them, rather than of one */
const COLLECTION = /^(werke|ausgewählte werke|sämtliche werke|gesammelte werke|kompositionen|works|selected works|complete works|collected works)\b/i;

/** Line-up ids that don't say which instruments: "voices with keyboard", "keyboard", "instrument" */
const vague = memo((lineup: string) =>
  Object.keys(parseEnsembleKey(lineup)).some((id) => / with(out)? |^unaccompanied|^unspecified|instrument|ensemble$|^(voices|keyboard|chorus|choir)$/.test(id)),
);

/** Words in a title that say which work it is, not what kind ("Olympic", "fanfare"; not "concerto", "and"), singular */
const telling = memo((title: string) => {
  const words = normalize(title.replace(/\([^)]*\)/g, " ")).split(" ");
  return new Set(words.filter((t) => t.length >= 4 && !/^\d/.test(t) && !onlyGenre(t) && !genreOf(t) && !STOPWORDS.has(t)).map((t) => t.replace(/(?<=\w{4})(?:es|s)$/, "")));
});
const genre = memo(genreOf);
const STOPWORDS = new Set(
  (
    "with from uber pour avec dans sous zwei drei vier funf three four five major minor flat sharp nach after upon theme thema werk " +
    // Instruments say what for, not which work
    "flute oboe clarinet bassoon horn trumpet trombone tuba violin viola cello piano organ harp guitar harpsichord orchestra strings voice chorus choir " +
    "klavier violine orgel orchester stimme chor flote klarinette fagott trompete posaune"
  ).split(" "),
);
/** Whether two titles share a telling word, allowing a spelling variant ("Bojarenes inntogsmarsj", "Bojarernes intogsmarsch") */
const sharesWord = (a: string, b: string) => {
  const wb = [...telling(b)];
  const close = (t: string, u: string) => t.length >= 6 && u.length >= 6 && t[0] === u[0] && Math.abs(t.length - u.length) <= 2 && editDistance(t, u) <= 2;
  return [...telling(a)].some((t) => wb.some((u) => u === t || close(t, u)));
};
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}
/**
 * Of one genre, in any language, one of them saying nothing more: "Concerto in C major"
 * and "Oboe Concerto in C major"; not "Olympic Fanfare" and "Liberty Fanfare"
 */
const sameGenre = (a: string, b: string) => {
  const g = genre(a);
  return !!g && genre(b) === g && (!telling(a).size || !telling(b).size);
};
// Instruments a title names, in the languages titles come in (folded to ASCII)
const NAMED_INSTRUMENTS: [string, RegExp][] = [
  ["violin", /\b(violin|violine|violon|violino|geige)\b/],
  ["viola", /\b(viola|bratsche|alto)\b/],
  ["cello", /\b(cello|violoncello|violoncelle|violoncell)\b/],
  ["double bass", /\b(double bass|kontrabass|contrebasse|contrabbasso)\b/],
  ["flute", /\b(flute|flote|querflote|flauto|traversflote)\b/],
  ["oboe", /\b(oboe|hautbois)\b/],
  ["clarinet", /\b(clarinet|klarinette|clarinette|clarinetto)\b/],
  ["bassoon", /\b(bassoon|fagott|basson|fagotto)\b/],
  ["horn", /\b(horn|corno)\b/],
  ["trumpet", /\b(trumpet|trompete|trompette|tromba)\b/],
  ["trombone", /\b(trombone|posaune)\b/],
  ["tuba", /\btuba\b/],
  ["piano", /\b(piano|klavier|pianoforte)\b/],
  ["harpsichord", /\b(harpsichord|cembalo|clavecin)\b/],
  ["organ", /\b(organ|orgel|orgue|organo)\b/],
  ["harp", /\b(harp|harfe|harpe|arpa)\b/],
  ["guitar", /\b(guitar|gitarre|guitare|chitarra)\b/],
  ["mandolin", /\b(mandolin|mandoline|mandolino)\b/],
  ["recorder", /\b(recorder|blockflote|flauto dolce)\b/],
  ["saxophone", /\b(saxophone|saxophon)\b/],
];
const instrumentsIn = memo((title: string) => {
  const t = normalize(title);
  return new Set(NAMED_INSTRUMENTS.filter(([, re]) => re.test(t)).map(([i]) => i));
});

/**
 * Told apart by a number in a catalogue or series, a key, or the instruments they name:
 * "No. 2" and "No. 3", "in D major" and "in F major", "Cello Concerto" and "Concerto,
 * Cembalo obbligato"
 */
function distinct(title: string, numbers: Set<string>, other: string): boolean {
  // Different numbers in a catalogue both use (numbers in different catalogues say nothing)
  const theirs = catalogueKeys(other);
  const system = (k: string) => k.slice(0, k.indexOf(":"));
  for (const s of new Set([...numbers].map(system))) {
    const mine = [...numbers].filter((k) => system(k) === s);
    if ([...theirs].some((k) => system(k) === s) && !mine.some((k) => theirs.has(k))) return true;
  }
  const no = (t: string) => /\b(?:No|Nr)\.?\s*(\d+)\b/i.exec(t)?.[1] ?? null;
  const [n1, n2] = [no(title), no(other)];
  if (n1 !== null && n2 !== null && n1 !== n2) return true;
  const [k1, k2] = [musicalKey(title), musicalKey(other)];
  if (k1 && k2 && k1 !== k2) return true;
  const [i1, i2] = [instrumentsIn(title), instrumentsIn(other)];
  return i1.size > 0 && i2.size > 0 && ![...i1].some((i) => i2.has(i));
}

/**
 * Whether a work matched by title alone (no catalogue number in common) can be the work
 * a record describes, given what the record says of its line-up and year: line-ups that
 * differ (unless one is vague), or years more than two apart, say they're different
 * works; and a title that's only a genre ("Concerto", "Studien"), with no number in a
 * series either, needs the same line-up to go on.
 */
function titleOnlyFits(x: BuildWork, title: string, lineup: string | null, year: number | null): boolean {
  if (year && x.year !== undefined && Math.abs(year - x.year) > 2) return false;
  const own = [...x.ensembles].filter(([, m]) => !m.arr).map(([k]) => k);
  const same = !!lineup && own.includes(lineup);
  if (onlyGenre(title) && !/\b(?:no|nr)\.?\s*\d/i.test(title) && !same) return false;
  if (lineup && own.length && !same && !vague(lineup) && !own.some(vague)) return false;
  return true;
}

/** Every spelling of a composer's name we know, folded for search. */
const ftsNames = (c: BuildComposer) => [...new Set([c.name, sortName(c), c.imslp ?? ""].map(searchText))].join(" ");

const players = (key: string) => Object.values(parseEnsembleKey(key)).reduce((s, n) => s + n, 0);

export interface BuildResult {
  meta: Meta;
  core: number;
  redirects: number;
}

export interface Previous {
  work: PreviousIds;
  composer: PreviousIds;
  /** What each id showed, to tell which part of a split keeps it */
  works: Map<string, { title: string; year: number | null; composer?: string | null }>;
  composers: Map<string, { name: string }>;
  /** Ids retired before, by "entity|id" */
  retired?: Map<string, RetiredRow>;
}

interface RetiredRow {
  entity: "work" | "composer";
  id: string;
  title: string;
  composer: string | null;
  since: string;
  reason: "uncertain" | "gone";
  see_also: string;
}

export const NONE: Previous = { work: NO_PREVIOUS, composer: NO_PREVIOUS, works: new Map(), composers: new Map() };

/**
 * A composer's name and birth year, as an anchor: the weakest, but all some composers have
 * (one only Open Opus or LIBRIS knows), and all that datasets from before the anchors
 * table kept of them. Not the death year: sources disagree on it (Besozzi: 1775 or 1793),
 * and reconciling composers tolerates that, so their URLs must too.
 */
const nameAnchor = (name: string, born: number | null | undefined) => (born ? `name:${normalize(name)}|${born}` : null);

/** Merges the sources into a new database at `out`, keeping ids from `previous`. */
export function build(input: BuildInput, out: string, previous: Previous, builtAt = new Date()): BuildResult {
  const { imslp, imslpPages, eras, wikipedia: wiki, wikidata: wd, openopus: oo, musicbrainz: mb, mutopia, libris, gnd, dnb, rism } = input;
  const works = new Map<string, BuildWork>();
  const composers = new Map<string, BuildComposer>();
  const byComposer = new Map<string, BuildWork[]>();
  const imslpByTitle = new Map<string, BuildWork>();
  const lineupSources = new Map<string, Map<SourceId, Set<string>>>();
  /** Anchors of records that are parts of these works, whose ids redirect to them */
  const absorbed = new Map<BuildWork, string[]>();
  /** Anchors of records left out as possibly being one of these works */
  const uncertain = new Map<string, BuildWork[]>();
  const stats = {
    matched: { wikidata: 0, wikipedia: 0, openopus: 0, mutopia: 0, libris: 0, gnd: 0, dnb: 0, rism: 0 },
    added: { wikipedia: 0, wikidata: 0, openopus: 0, libris: 0, gnd: 0, dnb: 0 },
    leftOut: { gnd: 0, libris: 0, dnb: 0 },
  };

  const composer = (key: string, init: () => Omit<BuildComposer, "key" | "sitelinks">): BuildComposer => {
    let c = composers.get(key);
    if (!c) composers.set(key, (c = { key, sitelinks: 0, ...init() }));
    return c;
  };

  const addWork = (w: BuildWork) => {
    // Keys must be unique: a collision would silently replace a work.
    if (works.has(w.key)) throw new Error(`Duplicate work key ${w.key}`);
    works.set(w.key, w);
    if (w.composer) {
      const list = byComposer.get(w.composer) ?? [];
      list.push(w);
      byComposer.set(w.composer, list);
    }
  };

  const newWork = (key: string, title: string, composerKey?: string): BuildWork => ({
    key,
    // Some sources pad titles ("Symphony no. 4 ", "op.  posth.4").
    title: tidy(title),
    aliases: new Set(),
    composer: composerKey,
    sitelinks: 0,
    signals: new Set(),
    ensembles: new Map(),
    libraries: new Set(),
    readings: [],
    extraLinks: [],
  });

  const addMembership = (w: BuildWork, parts: Ensemble, arr: boolean, via: SourceId, ref: string) => {
    const key = ensembleKey(parts);
    const m = w.ensembles.get(key);
    if (m) {
      m.arr &&= arr;
      if (!m.refs.has(via)) m.refs.set(via, ref);
    } else {
      w.ensembles.set(key, { arr, refs: new Map([[via, ref]]) });
    }
    // Open Opus line-ups come from each work's title; the line-up lists the rule, not every title.
    const src = lineupSources.get(key) ?? new Map<SourceId, Set<string>>();
    src.set(via, (src.get(via) ?? new Set()).add(via === "openopus" ? "Work titles naming the ensemble" : ref));
    lineupSources.set(key, src);
  };

  // A non-IMSLP source only sets the line-up of an IMSLP work that has no
  // (non-arrangement) instrumentation category; IMSLP's exact categories win.
  const hasOwnInstrumentation = (w: BuildWork) => !!w.imslp && [...w.ensembles.values()].some((m) => !m.arr);

  // ---- 1. IMSLP --------------------------------------------------------------
  for (const [category, ids] of Object.entries(imslp.members)) {
    const parsed = parseCategory(category);
    if (!parsed) continue;
    for (const pageid of ids) {
      const iw = imslp.works[pageid];
      if (!iw) continue;
      const key = `imslp:${pageid}`;
      let w = works.get(key);
      if (!w) {
        const m = /^(.*) \(([^()]+)\)$/.exec(iw.title);
        const composerName = m?.[2];
        if (composerName) composer(composerName, () => ({ name: displayName(composerName), imslp: composerName }));
        w = newWork(key, m ? m[1]! : iw.title, composerName);
        w.era = iw.era ?? undefined;
        w.imslp = { pageid, title: iw.title };
        if (iw.recorded) w.signals.add("imslp-recorded");
        if (iw.audio) w.signals.add("imslp-audio");
        addWork(w);
        imslpByTitle.set(iw.title, w);
      }
      addMembership(w, parsed.parts, parsed.arr, "imslp", category);
    }
  }

  // ---- 1b. IMSLP work pages: duration, movements, an orchestra's scoring, arrangements ----
  // The scoring comes from the part names of the original editions (parts uploaded on
  // their own add what a whole set lacks, unless they're stand-ins: a bass clarinet for
  // the bassoons), and from the Instrumentation field, each instrument at its largest
  // count: the field often leaves out percussion. Whether the work is for orchestra at
  // all is checked when it's written.
  for (const w of works.values()) {
    const page = w.imslp && imslpPages?.pages[w.imslp.pageid];
    if (!page) continue;
    const duration = page.duration && parseDuration(page.duration);
    if (duration) w.duration = duration;
    const movements = page.movements && parseMovements(page.movements);
    if (movements) w.movements = movements;
    const ref = String(w.imslp!.pageid);
    for (const p of page.parts ?? []) {
      const r = orchestrationFromParts(p);
      w.readings.push({ o: r.orchestration, source: "parts", ref, unresolved: r.unresolved, named: r.named });
    }
    const text = page.instrumentation && orchestrationFromText(page.instrumentation);
    if (text) w.readings.push({ o: text.orchestration, source: "text", ref, unresolved: text.unresolved, named: text.named });
    // Matched against the line-ups IMSLP lists the work as arranged for
    const arranged = new Set([...w.ensembles].filter(([, m]) => m.arr).map(([k]) => k));
    if (page.arrangements) w.arrangements = readArrangements(page.arrangements, arranged);
  }

  // ---- 2. Wikidata: composers, and links for IMSLP works -------------------
  const composerKeyByQid = new Map<string, string>();
  // Wikidata's IMSLP link for a person is sometimes wrong (Bruckner's points at another
  // composer): it must share the surname. Without a usable link, an IMSLP composer whose
  // surname and given names agree with the label is the same person.
  const imslpComposers = new ComposerIndex([...composers.keys()]);
  const linkedImslp = new Set<string>();
  const wdKey = new Map<string, string>();
  for (const c of Object.values(wd?.composers ?? {})) {
    // Letters only: "Afanas'yev" is "Afanasyev", "François d'Agincourt" has "Agincour".
    const letters = (name: string) => normalize(name).replaceAll(" ", "");
    const valid = c.imslp && (!c.label || letters(c.label).includes(letters(c.imslp.split(",")[0]!)));
    let key = valid ? c.imslp! : null;
    if (!key && c.label) {
      const found = imslpComposers.find(c.label.split(" ").at(-1)!, c.label);
      if (found && !linkedImslp.has(found)) key = found;
    }
    key ??= `wd:${c.qid}`;
    if (composers.has(key)) linkedImslp.add(key);
    wdKey.set(c.qid, key);
  }
  for (const c of Object.values(wd?.composers ?? {})) {
    const key = wdKey.get(c.qid)!;
    composerKeyByQid.set(c.qid, key);
    if (key.startsWith("wd:") && !c.label) continue;
    const bc = composer(key, () => ({ name: c.label ?? displayName(key), imslp: key.startsWith("wd:") ? undefined : key }));
    if (c.label) bc.name = c.label;
    bc.wikidata = c.qid;
    bc.gnd ??= c.gnd;
    bc.born ??= c.born;
    bc.died ??= c.died;
    bc.wikipedia ??= c.wikipedia;
    bc.sitelinks = Math.max(bc.sitelinks, c.sitelinks);
  }

  const attachWikidata = (w: BuildWork, d: WdWork) => {
    if (d.gnd) w.gnd ??= { id: d.gnd, source: "wikidata" };
    if (d.label) w.aliases.add(tidy(d.label));
    if (d.wikipedia) w.aliases.add(d.wikipedia.replace(/ \([^()]*\)$/, ""));
    w.wikidata ??= d.qid;
    w.musicbrainz ??= d.musicbrainz;
    if (d.year !== undefined && w.year === undefined) w.year = d.year;
    w.sitelinks = Math.max(w.sitelinks, d.sitelinks);
    if (d.wikipedia) {
      w.wikipedia ??= { title: d.wikipedia, source: "wikidata" };
      w.signals.add("wikipedia-article");
    }
  };

  for (const d of Object.values(wd?.works ?? {})) {
    const w = d.imslp ? imslpByTitle.get(d.imslp) : undefined;
    if (w) {
      attachWikidata(w, d);
      stats.matched.wikidata++;
    }
  }

  /** The work a Wikidata item refers to: linked or matched IMSLP work, else a new work. */
  const resolveWikidata = (d: WdWork, via: "wikipedia" | "wikidata", create: boolean): BuildWork | null => {
    const linked = d.imslp ? imslpByTitle.get(d.imslp) : undefined;
    if (linked) return linked;
    const existing = works.get(`wd:${d.qid}`);
    if (existing) return existing;
    const composerKey = d.composer ? composerKeyByQid.get(d.composer) : undefined;
    if (!composerKey || !composers.has(composerKey) || !d.label) return null; // too little to show
    const matched = matchWork(d.label, byComposer.get(composerKey) ?? [], (x, byNumber) => byNumber || d.year === undefined || x.year === undefined || Math.abs(d.year - x.year) <= 2);
    if (matched) {
      attachWikidata(matched, d);
      stats.matched[via]++;
      return matched;
    }
    if (!create) return null;
    const w = newWork(`wd:${d.qid}`, withoutComposer(d.label, composers.get(composerKey)!), composerKey);
    attachWikidata(w, d);
    addWork(w);
    stats.added[via]++;
    return w;
  };

  // ---- 3. Wikipedia categories ---------------------------------------------
  for (const [category, articles] of Object.entries(wiki?.members ?? {})) {
    const parts = WIKIPEDIA_CATEGORIES[category];
    for (const a of articles) {
      const d = a.qid ? wd?.works[a.qid] : undefined;
      if (!d) continue;
      // Signal-only categories never create works: we wouldn't know their line-up.
      const w = resolveWikidata(d, "wikipedia", parts !== null);
      if (!w) continue;
      w.signals.add("wikipedia-category");
      w.signals.add("wikipedia-article");
      w.wikipedia ??= { title: a.title, source: "wikipedia" };
      if (parts && !hasOwnInstrumentation(w) && titleFitsPlayers(w.title, parts)) addMembership(w, parts, false, "wikipedia", category);
    }
  }

  // ---- 4. Wikidata ensemble tags -------------------------------------------
  for (const d of Object.values(wd?.works ?? {})) {
    for (const item of d.ensembles) {
      const parts = WIKIDATA_ENSEMBLES[item]!;
      if (!wikidataInstrumentsFit(d.instruments ?? [], parts) || (d.label && !titleFitsPlayers(d.label, parts))) continue;
      const w = resolveWikidata(d, "wikidata", true);
      if (w && !hasOwnInstrumentation(w)) addMembership(w, parts, false, "wikidata", item);
    }
  }

  // ---- Composers of GND works (from Wikidata, by GND id) ---------------------------
  // Registered before the sources that match composers by name and dates (Open Opus,
  // Mutopia, LIBRIS), so those find them instead of creating them again.
  const composerByGnd = new Map<string, string>();
  for (const c of composers.values()) if (c.gnd) composerByGnd.set(c.gnd, c.key);
  for (const g of Object.values(gnd?.composers ?? {})) {
    if (composerByGnd.has(g.gnd) || (!g.label && !g.imslp)) continue;
    const imslpName = g.imslp?.replaceAll("_", " ") ?? null;
    const key = composerKeyByQid.get(g.qid) ?? imslpName ?? `wd:${g.qid}`;
    const c = composer(key, () => ({ name: g.label ?? displayName(key), imslp: imslpName ?? undefined }));
    c.wikidata ??= g.qid;
    c.gnd ??= g.gnd;
    c.born ??= g.born ?? undefined;
    c.died ??= g.died ?? undefined;
    c.sitelinks = Math.max(c.sitelinks, g.sitelinks);
    composerByGnd.set(g.gnd, key);
  }

  // ---- 5. Open Opus ---------------------------------------------------------
  // Open Opus names composers like Wikidata's English labels ("Sergei Prokofiev"), so
  // labels bridge to IMSLP names ("Prokofiev, Sergey"); unambiguous labels only.
  const composerIndex = new ComposerIndex([...composers.keys()].filter((k) => !k.startsWith("wd:")));
  const byLabel = new Map<string, string | null>();
  const labelled = (label: string, key: string) => {
    const l = normalize(label);
    byLabel.set(l, byLabel.has(l) && byLabel.get(l) !== key ? null : key);
  };
  for (const c of Object.values(wd?.composers ?? {})) if (c.label) labelled(c.label, wdKey.get(c.qid)!);
  for (const g of Object.values(gnd?.composers ?? {})) if (g.label && composerByGnd.has(g.gnd)) labelled(g.label, composerByGnd.get(g.gnd)!);
  // Else a composer of the same full name born the same year (and, if both sources know
  // it, dying the same year): a shared name alone isn't enough, nor two unknown dates.
  const sameNameAndDates = (name: string, born: number | null, died: number | null) => {
    if (!born) return undefined;
    const found = [...composers.values()].filter(
      (c) => normalize(c.name) === name && c.born !== undefined && Math.abs(c.born - born) <= 1 && (c.died === undefined) === (died === null) && (!died || Math.abs(c.died! - died) <= 1),
    );
    return found.length === 1 ? found[0]!.key : undefined;
  };
  for (const oc of oo?.composers ?? []) {
    const ooName = normalize(oc.completeName);
    const key = byLabel.get(ooName) ?? composerIndex.find(oc.name, oc.completeName) ?? sameNameAndDates(ooName, oc.born, oc.died) ?? `oo:${ooName}`;
    const c = composer(key, () => ({ name: oc.completeName }));
    c.openopus ??= ooName;
    c.born ??= oc.born ?? undefined;
    c.died ??= oc.died ?? undefined;
    c.era ??= OPEN_OPUS_EPOCHS[oc.epoch];
    for (const ow of oc.works) {
      let w = matchWork(ow.title, byComposer.get(key) ?? []);
      if (w) {
        stats.matched.openopus++;
      } else {
        const parts = openOpusEnsemble(ow.title, ow.genre, oc.born);
        if (!parts || !titleFitsPlayers(ow.title, parts)) continue;
        w = works.get(`oo:${ow.id}`) ?? null; // the same title listed twice
        if (!w) {
          w = newWork(`oo:${ow.id}`, ow.title, key);
          addWork(w);
        }
        addMembership(w, parts, false, "openopus", `${ow.genre}: “${ow.title}”`);
        stats.added.openopus++;
      }
      w.openopus ??= ow.id;
      w.aliases.add(tidy(ow.title));
      if (ow.popular) w.signals.add("openopus-popular");
      if (ow.recommended) w.signals.add("openopus-recommended");
    }
  }

  // ---- 6. MusicBrainz -------------------------------------------------------
  for (const w of works.values()) {
    const r = w.musicbrainz ? mb?.recordings[w.musicbrainz] : undefined;
    if (r) w.recordings = r.count;
  }

  // ---- 7. Mutopia ------------------------------------------------------------
  // Free engravings, often of a single movement: linked to the work they belong to,
  // never new works. Composers are named "W. A. Mozart (1756–1791)", so they match on
  // surname and both life years.
  // Sources disagree on dates by a year now and then (Albinoni died 1750 or 1751).
  const near = (a: number | undefined | null, b: number | undefined | null) => !!a && !!b && Math.abs(a - b) <= 1;
  // Keyed by the last word of the surname, folded: "Saint-Saëns" and "Saint Saëns" → "saens".
  const surnameKey = (s: string) => normalize(s).split(" ").at(-1) ?? "";
  const bySurname = new Map<string, BuildComposer[]>();
  for (const c of composers.values()) {
    const surname = surnameKey(c.imslp ? c.imslp.split(",")[0]! : c.name);
    bySurname.set(surname, [...(bySurname.get(surname) ?? []), c]);
  }
  for (const piece of mutopia?.pieces ?? []) {
    if (!piece.born || !piece.died) continue;
    const found = (bySurname.get(surnameKey(piece.composer)) ?? []).filter((c) => near(c.born, piece.born) && near(c.died, piece.died));
    if (found.length !== 1) continue;
    const w = matchWork(piece.opus ? `${piece.title}, ${piece.opus}` : piece.title, byComposer.get(found[0]!.key) ?? []);
    if (!w) continue;
    const label = piece.instrument ? `${piece.title} (${piece.instrument})` : piece.title;
    w.extraLinks.push({ provider: "mutopia", ref: String(piece.id), url: mutopiaUrl(piece.id), label, source: "mutopia" });
    stats.matched.mutopia++;
  }

  // ---- 8. LIBRIS ----------------------------------------------------------------
  // Sheet music in Swedish libraries. A record of a work we have adds a link: to borrow it
  // from Musik- och teaterbiblioteket, or to the record of the libraries holding it. A
  // record of a work we don't have adds the work when its instrumentation (in its field,
  // spelled out in its title, or in its classification) is fully understood, agrees with
  // any group size the title names, and it isn't an arrangement or an anthology; further
  // editions of it then match it. Composers match on surname and birth year.
  // Musik- och teaterbiblioteket's records with a line-up of their own come first, as
  // they always have; the rest (other libraries' records, line-ups from the
  // classification) after GND and DNB (step 9c), so that the works those give us are
  // matched rather than taken for new ones, and a work only comes in when it can't be one
  // we have under another title.
  // Works made from LIBRIS records, by composer and the library's uniform title (else the
  // title less its line-up, and the line-up), so later editions find them whatever their
  // printed titles say.
  /**
   * Works of the composer a new work by this title could be under another title, as GND
   * judges them (step 9): for the line-up (or a vague one), of the same genre or sharing a
   * telling word, with no number or key telling them apart
   */
  const couldBe = (composerKey: string, title: string, lineup: string) => {
    const numbers = catalogueKeys(title);
    return (byComposer.get(composerKey) ?? []).filter((x) => {
      const own = [...x.ensembles].filter(([, m]) => !m.arr).map(([k]) => k);
      if (!own.includes(lineup) && !own.some(vague)) return false;
      return (sameGenre(title, x.title) || sharesWord(title, x.title) || (!!x.bareTitle && sharesWord(title, x.bareTitle))) && !distinct(title, numbers, x.title);
    });
  };
  const fromLibris = new Map<string, BuildWork>();
  const takeLibris = (r: LibrisRecord, late: boolean) => {
    if (r.collection || r.composers.length !== 1) return;
    const lc = r.composers[0]!;
    if (!lc.born) return;
    const sameSurname = bySurname.get(surnameKey(lc.family)) ?? [];
    let found = sameSurname.filter((c) => near(c.born, lc.born) && (!lc.died || !c.died || near(c.died, lc.died)));
    // Death years disagree now and then (Besozzi: 1775 or 1793): the same full name and
    // birth year is still the same person
    if (!found.length) found = sameSurname.filter((c) => near(c.born, lc.born) && normalize(c.name) === normalize(`${lc.given ?? ""} ${lc.family}`));
    let c: BuildComposer | null = found.length === 1 ? found[0]! : null;
    const lineup = r.arranged || ANTHOLOGY.test(r.title) ? null : librisRecordLineup(r);
    // The title less its line-up ("Danzas argentinas, pour piano"), when that still names a
    // work rather than a genre ("Sonat"), is matched too, against works for the line-up
    const less = lineup && withoutLineup(r.title);
    const bare = less && !onlyGenre(less) ? less : null;
    const editionKey = (ck: string) => (r.uniform ? `${ck}|${normalize(r.uniform)}` : bare ? `${ck}|${lineup}|${normalize(bare)}` : null);
    let w: BuildWork | null = null;
    if (c) w = fromLibris.get(editionKey(c.key) ?? "") ?? null;
    if (c && !w)
      for (const t of [r.uniform, r.title]) if (t && (w = matchWork(t, byComposer.get(c.key) ?? [], (x, byNumber) => byNumber || titleOnlyFits(x, t, lineup, null)))) break;
    if (c && !w && bare) w = matchWork(bare, (byComposer.get(c.key) ?? []).filter((x) => x.ensembles.has(lineup!)));
    // Late, one number of a set we have ("Kvintett, op. 56, Nr 2" of "3 Wind Quintets,
    // Op.56"): an edition of part of it
    if (late && c && !w && lineup) {
      const sets = [...catalogueKeys(`${r.uniform ?? ""} ${r.title}`)].filter((k) => k.includes("/")).map((k) => k.slice(0, k.indexOf("/")));
      const whole = (byComposer.get(c.key) ?? []).filter((x) => {
        const keys = catalogueKeys(x.title);
        return x.ensembles.has(lineup) && sets.some((k) => keys.has(k)) && ![...keys].some((k) => k.includes("/"));
      });
      if (whole.length === 1) w = whole[0]!;
    }
    if (w) {
      stats.matched.libris++;
    } else {
      // A record with no title (some have only a classification) names no work
      if (!lineup || found.length > 1 || !(r.title || r.uniform) || !titleFitsPlayers(r.title, parseEnsembleKey(lineup))) return;
      const title = r.title || r.uniform!;
      // Late, as GND does: not one of the composer's works for the line-up of the same
      // genre, or sharing a telling word, that no number or key tells apart
      if (late && c && couldBe(c.key, title, lineup).length) return void stats.leftOut.libris++;
      if (!c) {
        const key = `libris:${lc.agent ?? normalize(`${lc.family} ${lc.given ?? ""} ${lc.born}`)}`;
        c = composer(key, () => ({ name: [lc.given, lc.family].filter(Boolean).join(" "), born: lc.born ?? undefined, died: lc.died ?? undefined }));
        if (lc.agent) c.libris = lc.agent;
        bySurname.set(surnameKey(lc.family), [...(bySurname.get(surnameKey(lc.family)) ?? []).filter((x) => x !== c), c]);
      }
      w = newWork(`libris:${r.id}`, title, c.key);
      w.libris = r.id;
      if (bare) w.bareTitle = bare;
      if (r.uniform) w.aliases.add(r.uniform);
      addWork(w);
      // Where it says so: the instrumentation field, the title, or the classification
      const kssb = kssbLineup(r.kssb ?? []);
      const basis = librisLineup(r.medium) === lineup ? r.medium[0]! : !lineupFromTitle(r.title) && kssb?.lineup === lineup ? `${r.title} (classified ${kssb.code})` : r.title;
      addMembership(w, parseEnsembleKey(lineup), false, "libris", basis);
      const k = editionKey(c.key);
      if (k) fromLibris.set(k, w);
      stats.added.libris++;
    }
    const held = r.held ?? [MTB]; // stages from before every library was crawled
    const atMtb = held.includes(MTB);
    w.extraLinks.push({ provider: atMtb ? "libris" : "swedish-libraries", ref: r.id, url: librisUrl(r.id), label: librisHolding({ ...r, held }), source: "libris" });
    for (const code of held) w.libraries.add(code === MTB ? "S-Skma" : `libris:${code}`); // S-Skma: Musik- och teaterbiblioteket's RISM siglum
  };
  const lateLibris: LibrisRecord[] = [];
  for (const r of libris?.records ?? []) {
    const own = r.arranged || ANTHOLOGY.test(r.title) ? null : librisRecordLineup({ ...r, kssb: [] });
    const early = (r.held ?? [MTB]).includes(MTB) && (own || !librisRecordLineup(r));
    if (early) takeLibris(r, false);
    else lateLibris.push(r);
  }

  // ---- 9. GND -------------------------------------------------------------------
  // The German National Library's musical works. Composers are GND person ids, bridged
  // through Wikidata. A GND work is one we have when Wikidata says so, when a catalogue
  // number matches, or when its title does and nothing says otherwise: a line-up or a
  // year that differ, or a title that's only a genre ("Konzerte", "Studien") without the
  // same line-up to go on. Otherwise it comes in with its instrumentation, unless it
  // could be a work we have under another title: one of the composer's works for the
  // line-up of the same genre, or sharing a telling word, that no number or key tells
  // apart. Records of parts of works ("Lakmé. Où va la jeune Indoue") link to a work we
  // have, but never come in on their own. GND says its records are distinct works, so
  // they're compared with the works from other sources only, not with each other: the
  // outcome doesn't depend on the order they come in.
  const byWikidataWork = new Map<string, BuildWork>();
  const byGndWork = new Map<string, BuildWork>();
  for (const w of works.values()) {
    if (w.wikidata) byWikidataWork.set(w.wikidata, w);
    if (w.gnd) byGndWork.set(w.gnd.id, w);
  }
  const beforeGnd = new Map([...byComposer].map(([k, list]) => [k, [...list]]));
  // A work's GND record. A second one is kept as a link, so an id it had as a work of its
  // own redirects here.
  const addGnd = (w: BuildWork, g: GndWork) => {
    if (!w.gnd || (w.gnd.source !== "gnd" && w.gnd.id === g.id)) w.gnd = { id: g.id, source: "gnd" };
    else if (w.gnd.id !== g.id && !w.extraLinks.some((l) => l.provider === "gnd" && l.ref === g.id))
      w.extraLinks.push({ provider: "gnd", ref: g.id, url: gndUrl(g.id), label: null, source: "gnd" });
    for (const a of gndAliases(g)) w.aliases.add(tidy(a));
  };
  // A record left out that had a page before: its id is retired, and its URL says which
  // works it may be (being uncertain, it can't redirect to one of them)
  const leftOut = (g: GndWork, candidates: BuildWork[]) => {
    stats.leftOut.gnd++;
    if (previous.work.anchors.has(`gnd:${g.id}`)) uncertain.set(`gnd:${g.id}`, candidates);
  };
  // Not arrangements; in GND's id order, so that nothing depends on the order of the dump
  const gndWorks = (gnd?.works ?? []).filter((g) => !/\b(?:bearb|arr)\./i.test(g.name)).sort((a, b) => a.id.localeCompare(b.id));
  // What records matched to works from other sources say of them (a year, a line-up),
  // applied once all are read: every record is judged against those works as they were
  const claims = new Map<BuildWork, { year: number | null; players: Ensemble | null; medium: string }[]>();
  // Works GND alone gives us, by composer: its own duplicates are recognised by number
  const fromGnd = new Map<string, BuildWork[]>();
  const parts = new Set(gndWorks.filter((g) => gndPart(g)));
  for (const g of [...gndWorks.filter((g) => !parts.has(g)), ...parts]) {
    const players = gndLineup(g.media);
    const lineup = players && ensembleKey(players);
    const year = gndYear(g);
    const medium = g.media.map((m) => (m.count > 1 ? `${m.name} (${m.count})` : m.name)).join(", ");
    const composerKey = g.composer ? composerByGnd.get(g.composer) : undefined;
    const theirs = composerKey ? (beforeGnd.get(composerKey) ?? []) : [];
    const part = gndPart(g);
    // A number in a set: "Sonata, op. 11, No. 2 in E major", not "Sonaten, op. 11. Nr. 2 (E-Dur)"; a song: "Jägerlied"
    const title = part?.numbered ? `${gndTitle(part.parent)}, ${gndTitle(part.part).replace(/\b(?:Nr|N)\.\s*/, "No. ")}` : part?.standalone ? part.part : gndTitle(g.name);
    const fits = (x: BuildWork) => titleOnlyFits(x, title, lineup, year);
    let w = byGndWork.get(g.id) ?? (g.wikidata ? byWikidataWork.get(g.wikidata) : undefined) ?? null;
    // A part's work, if we have it: matching the part by its numbers can land there too
    // ("…, op. 1. Lovely song" and "…, Op.1"), and then it's part of it, not it
    const parentTitle = part && gndTitle(part.parent);
    const whole =
      !w && parentTitle && composerKey ? matchWork(parentTitle, byComposer.get(composerKey) ?? [], (x, byNumber) => byNumber || titleOnlyFits(x, parentTitle, lineup, null)) : null;
    if (!w && composerKey) w = matchWork(gndMatchTitle(g), theirs, (x, byNumber) => byNumber || fits(x));
    if (whole && (!w || w === whole)) {
      if (previous.work.anchors.has(`gnd:${g.id}`)) (absorbed.get(whole) ?? absorbed.set(whole, []).get(whole)!).push(`gnd:${g.id}`);
      continue;
    }
    // The same title as one of the composer's works, with no key or number saying
    // otherwise, is that work (IMSLP often files choral works under a generic line-up).
    const numbers = catalogueKeys(gndMatchTitle(g));
    // GND's other names count too ("Estampien" is also "Estampes")
    const titles = [title, ...gndAliases(g)];
    const sameTitle = w
      ? []
      : theirs.filter(
          (x) => titles.some((t) => sameWorkByTitle(x.title, t, numbers) || (x.bareTitle && lineup && x.ensembles.has(lineup) && sameWorkByTitle(x.bareTitle, t, numbers))) && fits(x),
        );
    if (sameTitle.length === 1) w = sameTitle[0]!;
    if (w) {
      stats.matched.gnd++;
      addGnd(w, g);
      claims.set(w, [...(claims.get(w) ?? []), { year, players, medium }]);
      continue;
    }
    if (!composerKey) continue;
    // A duplicate in GND itself: the same numbers, for the same line-up, as a work it gave us
    const twin = lineup && matchWork(gndMatchTitle(g), fromGnd.get(composerKey) ?? [], (x, byNumber) => byNumber && x.ensembles.has(lineup));
    if (twin) {
      stats.matched.gnd++;
      addGnd(twin, g);
      continue;
    }
    // A part: its URL, if it had one, goes to the work it's part of. One we don't have the
    // work of comes in on its own if people play it so (a song, a number in a set), not
    // if it's a movement.
    if (part) {
      if (!part.standalone) {
        leftOut(g, []);
        continue;
      }
    }
    if (!players || !lineup) continue;
    if (sameTitle.length > 1) {
      leftOut(g, sameTitle);
      continue;
    }
    const rivals = theirs.filter((x) => {
      const own = [...x.ensembles].filter(([, m]) => !m.arr).map(([k]) => k);
      if (!own.includes(lineup) && !own.some(vague)) return false;
      return (sameGenre(title, x.title) || sharesWord(title, x.title) || (!!x.bareTitle && sharesWord(title, x.bareTitle))) && !distinct(title, numbers, x.title);
    });
    if (rivals.length) {
      leftOut(g, rivals);
      continue;
    }
    if (!titleFitsPlayers(title, players)) continue;
    if (COLLECTION.test(title)) continue; // "Werke": a composer's works, not one of them
    w = newWork(`gnd:${g.id}`, title, composerKey);
    w.gnd = { id: g.id, source: "gnd" };
    if (year) w.year = year;
    for (const a of gndAliases(g)) w.aliases.add(tidy(a));
    if (part) w.aliases.add(tidy(gndTitle(g.name))); // "Chöre, op. 27. Jägerlied": findable by the set too
    addWork(w);
    byGndWork.set(g.id, w);
    fromGnd.set(composerKey, [...(fromGnd.get(composerKey) ?? []), w]);
    addMembership(w, players, false, "gnd", medium);
    stats.added.gnd++;
  }
  // What the matched records say: a year when they agree on one (records that disagree
  // leave it unknown), and their line-ups where the work has no instrumentation of its own
  for (const [w, list] of claims) {
    const years = list.map((c) => c.year).filter((y): y is number => !!y);
    if (w.year === undefined && years.length && Math.max(...years) - Math.min(...years) <= 2) w.year = Math.min(...years);
    if (hasOwnInstrumentation(w)) continue;
    for (const c of list) if (c.players && titleFitsPlayers(w.title, c.players)) addMembership(w, c.players, false, "gnd", c.medium);
  }

  // ---- 9b. DNB ------------------------------------------------------------------
  // Editions of sheet music deposited with the German National Library since 2000. An
  // edition of a work we have (by the GND work it names, else its composer and title) adds
  // a link to it, newest first. One of a work we don't have adds the work when the record
  // names its composer by GND id, its instrumentation is understood (the work's, or the
  // title's: "für Violine und Klavier"), and it isn't an arrangement or an anthology; and,
  // when it names a GND work GND itself gave us nothing for, that GND left out was its call.
  // Further editions of the work (another line-up of it: "for viola and piano", "for
  // violoncello and piano") add to it.
  const byGndAny = new Map<string, BuildWork>();
  for (const w of works.values()) {
    if (w.gnd) byGndAny.set(w.gnd.id, w);
    for (const l of w.extraLinks) if (l.provider === "gnd") byGndAny.set(l.ref, w);
  }
  const gndRecords = new Set((gnd?.works ?? []).map((g) => g.id));
  const fromDnb = new Map<string, BuildWork>();
  const fromDnbWorks = new Set<BuildWork>();
  const editions = new Map<BuildWork, DnbRecord[]>();
  for (const raw of dnb?.records ?? []) {
    if (raw.arranged || raw.collection || raw.composers > 1 || ANTHOLOGY.test(raw.title)) continue;
    const r = composeRecord(raw);
    const players = dnbLineup(r);
    const lineup = players && ensembleKey(players);
    const title = r.title;
    let ck = r.composer?.gnd ? composerByGnd.get(r.composer.gnd) : undefined;
    if (!ck && r.composer?.born) {
      const surname = surnameKey(r.composer.name.split(" ").at(-1)!);
      const found = (bySurname.get(surname) ?? []).filter((c) => near(c.born, r.composer!.born) && normalize(c.name) === normalize(r.composer!.name));
      if (found.length === 1) ck = found[0]!.key;
    }
    // The title with the numbers that follow it ("Capriccio italien", "für Orchester ; op. 45")
    const numbered = [title, r.remainder?.split(/\s+=\s+/)[0]].filter(Boolean).join(", ");
    const numbers = [...catalogueKeys(numbered)].sort().join(" ");
    const keys = [
      r.work?.gnd && `gnd:${r.work.gnd}`,
      ck && lineup && `${ck}|${lineup}|${normalize(title)}`,
      ck && lineup && numbers && `${ck}|${lineup}|#${numbers}`,
    ].filter((k): k is string => !!k);
    let w = (r.work?.gnd ? byGndAny.get(r.work.gnd) : undefined) ?? keys.map((k) => fromDnb.get(k)).find(Boolean) ?? null;
    if (!w && ck)
      for (const t of [r.work?.title, numbered, title]) if (t && (w = matchWork(t, byComposer.get(ck) ?? [], (x, byNumber) => byNumber || titleOnlyFits(x, t, lineup, null)))) break;
    if (w) {
      stats.matched.dnb++;
      // Another line-up of a work DNB gave us
      if (fromDnbWorks.has(w) && players && lineup && !w.ensembles.has(lineup) && titleFitsPlayers(title, players)) addMembership(w, players, false, "dnb", r.remainder ?? title);
    } else {
      if (!players || !lineup || !r.composer?.gnd) continue;
      if (r.work?.gnd && gndRecords.has(r.work.gnd)) continue; // GND's own record of it didn't come in
      if (!titleFitsPlayers(title, players) || COLLECTION.test(title)) continue;
      if (ck && couldBe(ck, numbered, lineup).length) {
        stats.leftOut.dnb++;
        continue;
      }
      if (!ck) {
        const g = r.composer;
        ck = `gnd:${g.gnd}`;
        const c = composer(ck, () => ({ name: g.name, born: g.born ?? undefined, died: g.died ?? undefined }));
        c.gnd ??= g.gnd!;
        composerByGnd.set(g.gnd!, ck);
        const surname = surnameKey(g.name.split(" ").at(-1)!);
        bySurname.set(surname, [...(bySurname.get(surname) ?? []), c]);
      }
      w = newWork(r.work?.gnd ? `gnd:${r.work.gnd}` : `dnb:${r.id}`, title, ck);
      if (r.work?.gnd) w.gnd = { id: r.work.gnd, source: "dnb" };
      else w.dnb = r.id;
      if (r.work?.title && normalize(r.work.title) !== normalize(title)) w.aliases.add(tidy(r.work.title));
      addWork(w);
      addMembership(w, players, false, "dnb", r.work?.media.length ? r.work.media.map((m) => (m.count > 1 ? `${m.name} (${m.count})` : m.name)).join(", ") : (r.remainder ?? title));
      fromDnbWorks.add(w);
      stats.added.dnb++;
    }
    for (const k of keys) if (!fromDnb.has(k)) fromDnb.set(k, w);
    editions.set(w, [...(editions.get(w) ?? []), r]);
  }
  // The newest editions of each work
  for (const [w, list] of editions) {
    for (const r of list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.id.localeCompare(a.id)).slice(0, 6))
      w.extraLinks.push({ provider: "dnb", ref: r.id, url: dnbUrl(r.id), label: dnbHolding(r), source: "dnb" });
  }

  // ---- 9c. LIBRIS, the rest (see step 8) -------------------------------------------
  for (const r of lateLibris) takeLibris(r, true);

  // ---- 10. RISM ------------------------------------------------------------------
  // Manuscripts and early prints of works we have, and the libraries holding them. No
  // new works: most sources are copies, parts or fragments, and the works RISM alone
  // knows are mostly anonymous or obscure. Matching goes through catalogue numbers, so
  // only works sharing a number (or a title) with the source are compared.
  const candidates = new Map<string, BuildWork[]>();
  const index = (key: string, w: BuildWork) => candidates.set(key, [...(candidates.get(key) ?? []), w]);
  for (const w of works.values()) {
    if (!w.composer) continue;
    for (const k of catalogueKeys(w.title)) index(`${w.composer}|${k}`, w);
    index(`${w.composer}|=${bareTitle(w.title)}`, w);
  }
  const best = new Map<BuildWork, { id: string; rank: number; label: string }[]>();
  for (const src of rism?.sources ?? []) {
    const person = rism!.people[src.person];
    const composerKey = (person?.wikidata && composerKeyByQid.get(person.wikidata)) || (person?.gnd && composerByGnd.get(person.gnd)) || undefined;
    if (!composerKey || !composers.has(composerKey)) continue;
    const title = rismMatchTitle(src);
    const pool = new Set<BuildWork>();
    for (const k of catalogueKeys(title)) for (const w of candidates.get(`${composerKey}|${k}`) ?? []) pool.add(w);
    for (const w of candidates.get(`${composerKey}|=${bareTitle(title)}`) ?? []) pool.add(w);
    if (!pool.size) continue;
    const w = matchWork(title, [...pool]);
    if (!w) continue;
    stats.matched.rism++;
    composers.get(composerKey)!.rism ??= src.person;
    for (const h of src.holdings) w.libraries.add(h.siglum);
    const o = src.scoring && !src.excerpt ? orchestrationFromRism(src.scoring) : null;
    if (o) w.readings.push({ o, source: "rism", ref: src.id, unresolved: [], named: Object.keys(o).length });
    const h = src.holdings[0]!;
    const library = rism!.libraries[h.siglum];
    const shelf = h.shelf && !/^\[.*\]$/.test(h.shelf) ? h.shelf : null; // not "[no indication]"
    const label = [src.type, library ? `${library} (${h.siglum})` : h.siglum, shelf].filter(Boolean).join(" · ");
    const list = best.get(w) ?? [];
    list.push({ id: src.id, rank: rismRank(src.type) + (src.excerpt ? 0.5 : 0), label });
    best.set(w, list);
  }
  // A few copies per work: the composer's own hand first, then prints.
  for (const [w, list] of best) {
    for (const s of list.sort((a, b) => a.rank - b.rank || Number(a.id) - Number(b.id)).slice(0, 3)) {
      w.extraLinks.push({ provider: "rism", ref: s.id, url: rismUrl(s.id), label: s.label, source: "rism" });
    }
  }

  // ---- Composer eras ----------------------------------------------------------
  for (const c of composers.values()) {
    // Contradictory dates (a death before birth, a 120-year life) are wrong somewhere: keep neither.
    if (c.born && c.died && (c.died < c.born + 10 || c.died - c.born > 105)) c.born = c.died = undefined;
    c.era = (c.imslp ? eras[c.imslp]?.era : undefined) ?? c.era ?? (c.born ? eraFromBirth(c.born) : undefined);
  }

  // ---- Ids --------------------------------------------------------------------
  // Works whose stated line-up didn't hold up (e.g. a Wikipedia category, but the title
  // names more players) have nowhere to be listed.
  const workList = [...works.values()].filter((w) => w.ensembles.size > 0).sort((a, b) => a.key.localeCompare(b.key));
  const usedComposers = [...new Set(workList.map((w) => w.composer).filter((k): k is string => !!k))]
    .map((k) => composers.get(k)!)
    .sort((a, b) => a.key.localeCompare(b.key));
  // A name and dates two composers share identify neither
  const names = new Map<string, number>();
  for (const c of usedComposers) {
    const a = nameAnchor(c.name, c.born);
    if (a) names.set(a, (names.get(a) ?? 0) + 1);
  }
  const composerAnchors = (c: BuildComposer) => {
    const byName = nameAnchor(c.name, c.born);
    return [
      c.wikidata && `wikidata:${c.wikidata}`,
      c.imslp && `imslp:${c.imslp}`,
      c.gnd && `gnd:${c.gnd}`,
      c.openopus && `openopus:${c.openopus}`,
      c.libris && `libris:${c.libris}`,
      `key:${c.key}`,
      byName && names.get(byName) === 1 && byName,
    ].filter((a): a is string => !!a);
  };
  const composerAnchorLists = usedComposers.map(composerAnchors);
  const composerIds = assignIds(composerAnchorLists, previous.composer, COMPOSER_SCHEMES, (i, id) =>
    normalize(usedComposers[i]!.name) === normalize(previous.composers.get(id)?.name ?? "") ? 1 : 0,
  );
  const composerId = new Map(usedComposers.map((c, i) => [c.key, composerIds.ids[i]!]));

  const workAnchors = (w: BuildWork) =>
    [
      w.imslp && `imslp:${w.imslp.pageid}`,
      w.wikidata && `wikidata:${w.wikidata}`,
      w.gnd && `gnd:${w.gnd.id}`,
      ...w.extraLinks.filter((l) => l.provider === "gnd").map((l) => `gnd:${l.ref}`),
      w.openopus && `openopus:${w.openopus}`,
      w.libris && `libris:${w.libris}`,
      // A record that made a work of its own before may now be an edition of another
      ...w.extraLinks.filter((l) => l.provider === "libris" || l.provider === "swedish-libraries").map((l) => `libris:${l.ref}`),
      w.dnb && `dnb:${w.dnb}`,
    ].filter((a): a is string => !!a);
  const workAnchorLists = workList.map(workAnchors);
  const partAnchorLists = workList.map((w) => absorbed.get(w) ?? []);
  // Of the parts of a split, the one with the title and year the id showed keeps it
  const workIds = assignIds(
    workAnchorLists,
    previous.work,
    WORK_SCHEMES,
    (i, id) => {
      const was = previous.works.get(id);
      if (!was) return 0;
      const w = workList[i]!;
      return (normalize(w.title) === normalize(was.title) ? 2 : 0) + (was.year !== null && w.year === was.year ? 1 : 0);
    },
    partAnchorLists,
  );

  // ---- Write ------------------------------------------------------------------
  const db = new DatabaseSync(out);
  // Rows go in whatever order is convenient; references are checked once at the end.
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;");
  db.exec(TABLES);
  db.exec(BUILD_TABLES);
  db.exec("BEGIN");

  const insertComposer = db.prepare("INSERT INTO composers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertWork = db.prepare("INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertScoring = db.prepare("INSERT INTO scorings VALUES (?, ?, ?, ?, ?, ?)");
  const insertLink = db.prepare("INSERT INTO links VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertLineup = db.prepare("INSERT INTO lineups VALUES (?, ?, ?, ?, ?, ?)");
  const insertRedirect = db.prepare("INSERT INTO redirects VALUES (?, ?, ?)");
  const insertWorkFts = db.prepare("INSERT INTO works_fts (rowid, title, composer, aliases, keys, arrangers) VALUES (?, ?, ?, ?, ?, ?)");
  const insertArrangement = db.prepare("INSERT INTO arrangements VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertComposerFts = db.prepare("INSERT INTO composers_fts (rowid, name) VALUES (?, ?)");
  const insertOrchestration = db.prepare(`INSERT INTO orchestrations VALUES (${Array(8 + ORCHESTRA_KEYS.length).fill("?").join(", ")})`);

  // A provider's record belongs to one work (or composer). Rarely two sources link the
  // same record to different works (two Wikidata items with one MusicBrainz id): the
  // first, in id order, keeps it.
  const linked = new Set<string>();
  let sharedLinks = 0;
  const link = (entity: "work" | "composer", id: string, provider: ProviderId, ref: string, url: string | null, source: SourceId, label: string | null = null, position = 0) => {
    const k = `${entity}|${provider}|${ref}`;
    if (linked.has(k)) return void sharedLinks++;
    linked.add(k);
    const l: Link = { provider, kind: PROVIDERS[provider].kind, ref, url, label, source };
    insertLink.run(entity, id, l.provider, l.kind, l.ref, l.url, l.label, l.source, position);
  };

  const worksPerComposer = new Map<string, number>();
  for (const w of workList) if (w.composer) worksPerComposer.set(w.composer, (worksPerComposer.get(w.composer) ?? 0) + 1);

  usedComposers.forEach((c, i) => {
    const id = composerId.get(c.key)!;
    const n = i + 1;
    insertComposer.run(n, id, c.name, sortName(c), c.born ?? null, c.died ?? null, c.era ?? null, c.sitelinks, worksPerComposer.get(c.key) ?? 0);
    insertComposerFts.run(n, ftsNames(c));
    if (c.imslp) link("composer", id, "imslp", c.imslp, imslpCategoryUrl(c.imslp), "imslp");
    if (c.wikidata) link("composer", id, "wikidata", c.wikidata, wikidataUrl(c.wikidata), "wikidata");
    if (c.wikipedia) link("composer", id, "wikipedia", c.wikipedia, wikipediaUrl(c.wikipedia), "wikidata");
    if (c.libris) link("composer", id, "libris", c.libris, librisUrl(c.libris), "libris");
    if (c.gnd) link("composer", id, "gnd", c.gnd, gndUrl(c.gnd), "wikidata");
    if (c.rism) link("composer", id, "rism", c.rism, rismPersonUrl(c.rism), "rism");
  });

  // A scoring is kept for works written for orchestra (not only arranged for one: any
  // line-up with an orchestra in it, "orchestra*2" and "voices with orchestra" too), from
  // the readings of a whole orchestra (one without strings for "orchestra without strings",
  // three or more wind, brass or percussion instruments); see chooseScoring for how far
  // it's to be trusted.
  const band = (o: Orchestration) => !o.str && isFullOrchestra({ ...o, str: 1 }) && Object.keys(o).filter((k) => !k.includes("/") && o[k]).length >= 3;
  const orchestral = (w: BuildWork) => {
    if (!w.readings.length) return null;
    const ids = [...w.ensembles].filter(([, m]) => !m.arr).flatMap(([k]) => Object.keys(parseEnsembleKey(k)));
    if (ids.some((id) => id.includes("orchestra") && id !== "orchestra without strings")) return chooseScoring(w.readings, isFullOrchestra);
    if (ids.includes("orchestra without strings")) return chooseScoring(w.readings, band);
    return null;
  };
  let orchestrations = 0;
  const lineupCounts = new Map<string, { original: number; arrangements: number }>();
  let core = 0;
  workList.forEach((w, i) => {
    const id = workIds.ids[i]!;
    const n = i + 1;
    const c = w.composer ? composers.get(w.composer) : undefined;
    const s = score({ signals: [...w.signals], recordings: w.recordings, sitelinks: w.sitelinks, composerSitelinks: c?.sitelinks, copies: w.libraries.size });
    if (s >= CORE_SCORE) core++;
    // Wikidata publication dates are often a modern edition's: keep years within the composer's life (roughly).
    const plausible =
      w.year !== undefined && w.year <= builtAt.getUTCFullYear() && (!c?.born || w.year >= c.born + 5) && (!c?.died || w.year <= c.died + 30);

    // Main line-up: an original one, the best attested, then the smallest.
    const memberships = [...w.ensembles].sort(
      ([ka, a], [kb, b]) => Number(a.arr) - Number(b.arr) || b.refs.size - a.refs.size || players(ka) - players(kb) || ka.localeCompare(kb),
    );
    // Other titles worth showing and searching: those that differ from ours in more than punctuation.
    const own = normalize(w.title);
    const aliases = [...new Set([...w.aliases].filter((a) => normalize(a) !== own))].sort();
    insertWork.run(
      n,
      id,
      w.title,
      JSON.stringify(aliases),
      c ? composerId.get(c.key)! : null,
      plausible ? w.year! : null,
      w.era ?? c?.era ?? null,
      s,
      JSON.stringify([...w.signals].sort()),
      w.recordings ?? null,
      w.sitelinks,
      w.imslp || w.extraLinks.some((l) => PROVIDERS[l.provider].kind === "score") ? 1 : 0,
      memberships[0]![0],
      memberships.length,
      w.libraries.size,
      w.duration ?? null,
      w.movements ?? null,
    );
    const orch = orchestral(w);
    if (orch) {
      insertOrchestration.run(
        id,
        formatOrchestration(orch.o),
        JSON.stringify(orch.o),
        orch.status,
        orch.basis,
        JSON.stringify(orch.unresolved),
        ...ORCHESTRA_KEYS.map((k) => orch.o[k] ?? 0),
        orch.source,
        orch.ref,
      );
      orchestrations++;
    }
    for (const [key, m] of memberships) {
      insertScoring.run(id, key, m.arr ? 1 : 0, players(key), s, JSON.stringify([...m.refs].map(([source, ref]) => ({ source, ref }))));
      const counts = lineupCounts.get(key) ?? { original: 0, arrangements: 0 };
      if (m.arr) counts.arrangements++;
      else counts.original++;
      lineupCounts.set(key, counts);
    }

    (w.arrangements ?? []).forEach((a, i) => insertArrangement.run(id, a.lineup, a.arranger, a.excerpt, a.heading, a.license, i));

    if (w.imslp) link("work", id, "imslp", String(w.imslp.pageid), imslpUrl(w.imslp.title), "imslp");
    if (w.wikipedia) link("work", id, "wikipedia", w.wikipedia.title, wikipediaUrl(w.wikipedia.title), w.wikipedia.source);
    if (w.wikidata) link("work", id, "wikidata", w.wikidata, wikidataUrl(w.wikidata), "wikidata");
    if (w.gnd) link("work", id, "gnd", w.gnd.id, gndUrl(w.gnd.id), w.gnd.source);
    if (w.musicbrainz) {
      const label = w.recordings ? `${w.recordings} recordings` : null;
      link("work", id, "musicbrainz", w.musicbrainz, musicbrainzUrl(w.musicbrainz), "wikidata", label);
    }
    // Open Opus has no page per work; the id still records the match.
    if (w.openopus) link("work", id, "openopus", w.openopus, null, "openopus");
    w.extraLinks.forEach((l, i) => link("work", id, l.provider, l.ref, l.url, l.source, l.label, i));

    // Folded like search queries (searchText; see worker/queries.ts); keys add the
    // compact catalogue forms people type ("k581", "bwv1007", "op18").
    const keys = [...catalogueKeys(w.title)].map((k) => k.split("/")[0]!.replaceAll(":", ""));
    const arrangers = new Set((w.arrangements ?? []).map((a) => a.arranger).filter((a): a is string => !!a && a !== THE_COMPOSER).map(searchText));
    insertWorkFts.run(n, searchText(w.title), c ? ftsNames(c) : "", aliases.map(searchText).join(" "), [...new Set(keys)].join(" "), [...arrangers].join(" "));
  });

  for (const key of [...lineupCounts.keys()].sort()) {
    const counts = lineupCounts.get(key)!;
    const sources = Object.fromEntries([...(lineupSources.get(key) ?? [])].map(([s, refs]) => [s, [...refs].sort()]));
    insertLineup.run(key, describe(parseEnsembleKey(key)), players(key), counts.original, counts.arrangements, JSON.stringify(sources));
  }

  for (const [old, now] of composerIds.redirects) insertRedirect.run("composer", old, now);
  for (const [old, now] of workIds.redirects) insertRedirect.run("work", old, now);

  // Every anchor, for the next build; also those the previous dataset had that no entity has
  // now (a record that left its source, for now), with the id they had or that id's
  // redirect: should the record come back, it finds its id.
  const insertAnchor = db.prepare("INSERT INTO anchors VALUES (?, ?, ?, ?)");
  const writeAnchors = (entity: "work" | "composer", lists: string[][], { ids, redirects }: { ids: string[]; redirects: Map<string, string> }, prev: PreviousIds) => {
    const seen = new Set<string>();
    lists.forEach((anchors, i) =>
      anchors.forEach((a, position) => {
        if (!seen.has(a)) seen.add(a), insertAnchor.run(entity, a, ids[i]!, position);
      }),
    );
    for (const [a, id] of prev.anchors) {
      if (!seen.has(a)) seen.add(a), insertAnchor.run(entity, a, redirects.get(id) ?? id, -1);
    }
  };
  writeAnchors("composer", composerAnchorLists, composerIds, previous.composer);
  writeAnchors("work", workAnchorLists.map((list, i) => [...list, ...partAnchorLists[i]!]), workIds, previous.work);

  // Ids that were here before and aren't now, nor redirect: retired, saying what they were
  // and why they're gone. Those retired before stay so, unless they're back.
  const insertRetired = db.prepare("INSERT INTO retired VALUES (?, ?, ?, ?, ?, ?, ?)");
  const version = builtAt.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const workIdOf = new Map(workList.map((w, i) => [w, workIds.ids[i]!]));
  const retire = (entity: "work" | "composer", { ids, redirects }: { ids: string[]; redirects: Map<string, string> }, prev: PreviousIds, was: Map<string, { title: string; composer: string | null }>) => {
    const live = new Set(ids);
    const anchorsOf = new Map<string, string[]>();
    for (const [a, id] of prev.anchors) anchorsOf.set(id, [...(anchorsOf.get(id) ?? []), a]);
    const rows = new Map<string, RetiredRow>();
    for (const r of previous.retired?.values() ?? []) if (r.entity === entity) rows.set(r.id, r);
    for (const [id, w] of was) {
      const candidates = [...new Set((anchorsOf.get(id) ?? []).flatMap((a) => uncertain.get(a) ?? []))];
      const seeAlso = candidates.map((c) => workIdOf.get(c)).filter((x): x is string => !!x).sort();
      rows.set(id, { entity, id, title: w.title, composer: w.composer, since: version, reason: candidates.length ? "uncertain" : "gone", see_also: JSON.stringify(seeAlso) });
    }
    const retired = new Set<string>();
    for (const [id, r] of [...rows].sort(([a], [b]) => a.localeCompare(b))) {
      if (live.has(id) || redirects.has(id)) continue;
      insertRetired.run(r.entity, r.id, r.title, r.composer, r.since, r.reason, r.see_also);
      retired.add(id);
    }
    // Ids merged into one now retired keep redirecting to it, whose page says what it was
    for (const old of [...prev.redirects.keys()].sort()) {
      let target = old;
      for (let hops = 0; prev.redirects.has(target) && hops < 20; hops++) target = prev.redirects.get(target)!;
      if (target !== old && retired.has(target) && !live.has(old) && !redirects.has(old)) insertRedirect.run(entity, old, target);
    }
  };
  const gone = <T,>(was: Map<string, T>, ids: string[], redirects: Map<string, string>) => {
    const live = new Set(ids);
    return new Map([...was].filter(([id]) => !live.has(id) && !redirects.has(id)));
  };
  retire("work", workIds, previous.work, new Map([...gone(previous.works, workIds.ids, workIds.redirects)].map(([id, w]) => [id, { title: w.title, composer: w.composer ?? null }])));
  retire("composer", composerIds, previous.composer, new Map([...gone(previous.composers, composerIds.ids, composerIds.redirects)].map(([id, c]) => [id, { title: c.name, composer: null }])));

  const iso = (t: number | undefined) => (t ? new Date(t).toISOString() : null);
  const meta: Meta = {
    // e.g. "20261019T220512Z": names the published dataset (see publish.ts)
    version: builtAt.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
    builtAt: builtAt.toISOString(),
    works: workList.length,
    composers: usedComposers.length,
    lineups: lineupCounts.size,
    sources: {
      imslp: {
        fetchedAt: iso(imslp.fetchedAt),
        items: Object.keys(imslp.works).length,
        matched: null,
        added: workList.filter((w) => w.imslp).length,
        note: `${Object.keys(imslp.members).length} instrumentation categories; ${Object.keys(imslpPages?.pages ?? {}).length} work pages read for durations, movements, orchestral parts and arrangers`,
      },
      wikipedia: {
        fetchedAt: iso(wiki?.fetchedAt),
        items: Object.values(wiki?.members ?? {}).reduce((s, m) => s + m.length, 0),
        matched: stats.matched.wikipedia,
        added: stats.added.wikipedia,
        note: `articles in ${Object.keys(wiki?.members ?? {}).length} “Compositions for …” categories`,
      },
      wikidata: {
        fetchedAt: iso(wd?.fetchedAt),
        items: Object.keys(wd?.works ?? {}).length,
        matched: stats.matched.wikidata,
        added: stats.added.wikidata,
        note: `works with IMSLP ids or ensemble tags, and ${Object.keys(wd?.composers ?? {}).length} composers`,
      },
      openopus: {
        fetchedAt: iso(oo?.fetchedAt),
        items: (oo?.composers ?? []).reduce((s, c) => s + c.works.length, 0),
        matched: stats.matched.openopus,
        added: stats.added.openopus,
        note: `works by ${(oo?.composers ?? []).length} composers`,
      },
      mutopia: {
        fetchedAt: iso(mutopia?.fetchedAt),
        items: mutopia?.pieces.length ?? 0,
        matched: stats.matched.mutopia,
        added: null,
        note: "engraved pieces, often single movements, linked to their works",
      },
      libris: {
        fetchedAt: iso(libris?.fetchedAt),
        items: libris?.records.length ?? 0,
        matched: stats.matched.libris,
        added: stats.added.libris,
        note: `sheet music in Swedish libraries; ${stats.leftOut.libris} left out as possibly works we have under other titles`,
      },
      gnd: {
        fetchedAt: iso(gnd?.fetchedAt),
        items: gnd?.works.length ?? 0,
        matched: stats.matched.gnd,
        added: stats.added.gnd,
        note: `musical works with instrumentation or a Wikidata link; ${stats.leftOut.gnd} left out as possibly works we have under other titles`,
      },
      dnb: {
        fetchedAt: iso(dnb?.fetchedAt),
        items: dnb?.records.length ?? 0,
        matched: stats.matched.dnb,
        added: stats.added.dnb,
        note: `printed music published since ${dnb?.firstYear ?? "2000"}, deposited with the German National Library; ${stats.leftOut.dnb} left out as possibly works we have under other titles`,
      },
      rism: {
        fetchedAt: iso(rism?.fetchedAt),
        items: rism?.sources.length ?? 0,
        matched: stats.matched.rism,
        added: null,
        note: "manuscripts and prints held by libraries, by composers we can identify",
      },
      musicbrainz: {
        fetchedAt: iso(mb?.fetchedAt),
        items: Object.keys(mb?.recordings ?? {}).length,
        matched: workList.filter((w) => w.recordings !== undefined).length,
        added: null,
        note: "recording counts, most notable works first",
      },
    },
    stats: null,
  };

  const insertSource = db.prepare("INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [id, s] of Object.entries(meta.sources) as [SourceId, Meta["sources"][SourceId]][]) {
    const info = SOURCES[id];
    insertSource.run(id, info.name, info.url, info.license, info.licenseUrl, info.role, s.fetchedAt, s.items, s.matched, s.added, s.note);
  }
  const insertMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  insertMeta.run("version", meta.version);
  insertMeta.run("built_at", meta.builtAt);
  insertMeta.run("schema_version", String(SCHEMA_VERSION));
  insertMeta.run("works", String(meta.works));
  insertMeta.run("composers", String(meta.composers));
  insertMeta.run("lineups", String(meta.lineups));
  insertMeta.run("license", "CC BY-SA 4.0");

  db.exec("COMMIT");
  const broken = db.prepare("PRAGMA foreign_key_check").all();
  if (broken.length) throw new Error(`${broken.length} broken references, e.g. ${JSON.stringify(broken[0])}`);
  db.exec(INDEXES);
  // Stats need the indexes.
  meta.stats = datasetStats(db);
  insertMeta.run("stats", JSON.stringify(meta.stats));
  db.exec("INSERT INTO works_fts (works_fts) VALUES ('optimize'); INSERT INTO composers_fts (composers_fts) VALUES ('optimize'); ANALYZE; VACUUM;");
  db.close();
  if (sharedLinks) console.log(`  ${sharedLinks} links shared by several works were kept on the first only`);
  return { meta, core, redirects: composerIds.redirects.size + workIds.redirects.size };
}

/** Totals for the about page, from the finished tables. */
function datasetStats(db: DatabaseSync): DatasetStats {
  const all = (sql: string) => db.prepare(sql).all() as Record<string, any>[];
  const one = (sql: string) => db.prepare(sql).get() as Record<string, any>;
  const bySource = Object.fromEntries((Object.keys(SOURCES) as SourceId[]).map((s) => [s, { lineups: 0, links: 0 }])) as DatasetStats["bySource"];
  for (const r of all("SELECT j.value ->> 'source' AS source, COUNT(*) AS n FROM scorings, json_each(scorings.sources) AS j GROUP BY 1")) bySource[r.source as SourceId].lineups = r.n;
  for (const r of all("SELECT source, COUNT(*) AS n FROM links GROUP BY source")) bySource[r.source as SourceId].links = r.n;
  const sizes = new Map<string, { players: string; lineups: number; works: number }>();
  for (const r of all("SELECT l.players, COUNT(*) AS lineups, SUM(l.original) AS works FROM lineups l GROUP BY l.players ORDER BY l.players")) {
    const players = r.players >= 10 ? "10+" : String(r.players);
    const s = sizes.get(players) ?? { players, lineups: 0, works: 0 };
    s.lineups += r.lineups;
    s.works += r.works;
    sizes.set(players, s);
  }
  return {
    core: one(`SELECT COUNT(*) AS n FROM works WHERE score >= ${CORE_SCORE}`).n,
    free: one("SELECT COUNT(*) AS n FROM works WHERE free = 1").n,
    arrangementOnly: one("SELECT COUNT(*) AS n FROM works w WHERE NOT EXISTS (SELECT 1 FROM scorings s WHERE s.work_id = w.id AND s.arrangement = 0)").n,
    orchestrations: Object.fromEntries(all("SELECT source, COUNT(*) AS n FROM orchestrations WHERE status != 'partial' GROUP BY source").map((r) => [r.source, r.n])),
    orchestrationStatus: Object.fromEntries(all("SELECT status, COUNT(*) AS n FROM orchestrations GROUP BY status").map((r) => [r.status, r.n])),
    durations: one("SELECT COUNT(duration) AS n FROM works").n,
    movements: one("SELECT COUNT(movements) AS n FROM works").n,
    arrangements: (({ n, arrangers }) => ({ n, arrangers }))(one("SELECT COUNT(*) AS n, COUNT(DISTINCT arranger) AS arrangers FROM arrangements")),
    bySource,
    links: Object.fromEntries(all("SELECT provider, COUNT(*) AS n FROM links WHERE entity = 'work' GROUP BY provider").map((r) => [r.provider, r.n])) as DatasetStats["links"],
    eras: Object.fromEntries(all("SELECT era, COUNT(*) AS n FROM works GROUP BY era ORDER BY n DESC").map((r) => [r.era ?? "Unknown", r.n])),
    sizes: [...sizes.values()],
    topLineups: all("SELECT key, description, original AS works FROM lineups ORDER BY original DESC LIMIT 12").map((r) => ({ key: r.key, description: r.description, works: r.works })),
    redirects: one("SELECT COUNT(*) AS n FROM redirects").n,
  };
}

/**
 * Counts ahead the facets of every big line-up's unfiltered list, with and without
 * arrangements, by the API's own code (worker/queries.ts), so they're what it would count.
 */
export async function precomputeFacets(path: string, min = PRECOMPUTED_FACETS_MIN): Promise<number> {
  const db = new DatabaseSync(path);
  const api = sqliteDb(db);
  const insert = db.prepare("INSERT INTO lineup_facets VALUES (?, ?, ?, ?)");
  const big = (db.prepare("SELECT key FROM lineups WHERE original + arrangements >= ? ORDER BY key").all(min) as { key: string }[]).map((r) => r.key);
  for (const lineup of big) {
    for (const arrangements of [false, true]) {
      const page = await listWorks(api, null, { lineup, arrangements, facets: true, limit: 1 });
      insert.run(lineup, arrangements ? 1 : 0, page.total, JSON.stringify(page.facets));
    }
  }
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('facets_min', ?)").run(String(min));
  db.close();
  return big.length;
}

/** Anchors and redirects of works and composers in a previous dataset, and what their ids showed. */
export function readPrevious(path: string): Previous | null {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const has = (table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table);
    if (!has("links")) return null; // a dataset from before persistent ids
    const out: Previous = { work: { anchors: new Map(), redirects: new Map() }, composer: { anchors: new Map(), redirects: new Map() }, works: new Map(), composers: new Map() };
    if (has("anchors")) {
      for (const r of db.prepare("SELECT entity, anchor, entity_id FROM anchors").all() as Record<string, string>[]) {
        out[r.entity as "work" | "composer"].anchors.set(r.anchor!, r.entity_id!);
      }
    } else {
      // Before the anchors table: records with a link, and composers without one by name and dates
      for (const r of db.prepare("SELECT entity, provider, ref, entity_id FROM links").all() as Record<string, string>[]) {
        out[r.entity as "work" | "composer"].anchors.set(`${r.provider}:${r.ref}`, r.entity_id!);
      }
      const unlinked = "SELECT id, name, born FROM composers c WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.entity = 'composer' AND l.entity_id = c.id)";
      for (const r of db.prepare(unlinked).all() as Record<string, any>[]) {
        const a = nameAnchor(r.name, r.born);
        if (a) out.composer.anchors.set(a, r.id);
      }
    }
    for (const r of db.prepare("SELECT w.id, w.title, w.year, c.name AS composer FROM works w LEFT JOIN composers c ON c.id = w.composer_id").all() as Record<string, any>[])
      out.works.set(r.id, { title: r.title, year: r.year, composer: r.composer });
    if (has("retired")) out.retired = new Map((db.prepare("SELECT * FROM retired").all() as any[]).map((r) => [`${r.entity}|${r.id}`, { ...r } as RetiredRow]));
    for (const r of db.prepare("SELECT id, name FROM composers").all() as Record<string, any>[]) out.composers.set(r.id, { name: r.name });
    for (const r of db.prepare("SELECT entity, old_id, new_id FROM redirects").all() as Record<string, string>[]) {
      out[r.entity as "work" | "composer"].redirects.set(r.old_id!, r.new_id!);
    }
    return out;
  } finally {
    db.close();
  }
}

/** Builds from the crawled stages into .cache/build/, keeping ids from the current dataset. */
export async function buildDataset(): Promise<BuildResult> {
  const input = await loadInput();
  await mkdir(BUILD_DIR, { recursive: true });
  const previous = readPrevious(DATASET_PATH);
  if (!previous) console.log("No previous dataset with ids: minting all ids (run `npm run data:pull` first to keep published ids)");
  const next = join(BUILD_DIR, "repertoire.next.sqlite");
  await rm(next, { force: true });
  const result = build(input, next, previous ?? NONE);
  const precomputed = await precomputeFacets(next);
  console.log(`Facets precomputed for ${precomputed} big line-ups`);
  if (previous) await rename(DATASET_PATH, PREVIOUS_PATH);
  await rename(next, DATASET_PATH);
  const { meta } = result;
  console.log(`Dataset ${meta.version}: ${meta.works} works (${result.core} core), ${meta.composers} composers, ${meta.lineups} line-ups, ${result.redirects} redirects → ${DATASET_PATH}`);
  for (const [s, v] of Object.entries(meta.sources)) console.log(`  ${s}: ${v.items} items · ${v.note}`);
  return result;
}
