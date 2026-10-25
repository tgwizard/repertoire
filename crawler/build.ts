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
import { INDEXES, SCHEMA_VERSION, TABLES } from "./db.ts";
import { openOpusEnsemble, titleFitsPlayers, WIKIDATA_ENSEMBLES, WIKIPEDIA_CATEGORIES, wikidataInstrumentsFit } from "./ensembles.ts";
import { CACHE_DIR, readStage } from "./http.ts";
import { assignIds, NO_PREVIOUS, type PreviousIds } from "./ids.ts";
import { normalize } from "../src/shared/text.ts";
import { bareTitle, catalogueKeys, ComposerIndex, displayName, matchWork, musicalKey } from "./match.ts";
import type { ComposerErasStage, ImslpStage } from "./sources/imslp.ts";
import type { MusicBrainzStage } from "./sources/musicbrainz.ts";
import { mutopiaUrl, type MutopiaStage } from "./sources/mutopia.ts";
import { librisHolding, librisLineup, librisUrl, type LibrisStage } from "./sources/libris.ts";
import { gndLineup, gndMatchTitle, gndTitle, gndUrl, type GndStage } from "./sources/gnd.ts";
import type { OpenOpusStage } from "./sources/openopus.ts";
import type { WdWork, WikidataStage } from "./sources/wikidata.ts";
import type { WikipediaStage } from "./sources/wikipedia.ts";

export const BUILD_DIR = join(CACHE_DIR, "build");
/** The current dataset: the last build, or the published one (npm run data:pull) */
export const DATASET_PATH = join(BUILD_DIR, "repertoire.sqlite");
/** The dataset before the last build, kept to check that ids stayed put (test/data) */
export const PREVIOUS_PATH = join(BUILD_DIR, "repertoire.previous.sqlite");

export interface BuildInput {
  imslp: ImslpStage;
  eras: ComposerErasStage["eras"];
  wikipedia: WikipediaStage | null;
  wikidata: WikidataStage | null;
  openopus: OpenOpusStage | null;
  musicbrainz: MusicBrainzStage | null;
  mutopia: MutopiaStage | null;
  libris: LibrisStage | null;
  gnd: GndStage | null;
}

export async function loadInput(): Promise<BuildInput> {
  const imslp = await readStage<ImslpStage>("imslp");
  if (!imslp) throw new Error("No IMSLP data yet: run `npm run crawl -- imslp` first");
  return {
    imslp,
    eras: (await readStage<ComposerErasStage>("imslp-composer-eras"))?.eras ?? {},
    wikipedia: await readStage<WikipediaStage>("wikipedia"),
    wikidata: await readStage<WikidataStage>("wikidata"),
    openopus: await readStage<OpenOpusStage>("openopus"),
    musicbrainz: await readStage<MusicBrainzStage>("musicbrainz"),
    mutopia: await readStage<MutopiaStage>("mutopia"),
    libris: await readStage<LibrisStage>("libris"),
    gnd: await readStage<GndStage>("gnd"),
  };
}

/** Anchor schemes, strongest first (see ids.ts). */
const WORK_SCHEMES = ["imslp", "wikidata", "gnd", "openopus", "libris"];
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

/** Every spelling of a composer's name we know, folded for search. */
const ftsNames = (c: BuildComposer) => [...new Set([c.name, sortName(c), c.imslp ?? ""].map(normalize))].join(" ");

const players = (key: string) => Object.values(parseEnsembleKey(key)).reduce((s, n) => s + n, 0);

export interface BuildResult {
  meta: Meta;
  core: number;
  redirects: number;
}

export interface Previous {
  work: PreviousIds;
  composer: PreviousIds;
}

export const NONE: Previous = { work: NO_PREVIOUS, composer: NO_PREVIOUS };

/** Merges the sources into a new database at `out`, keeping ids from `previous`. */
export function build(input: BuildInput, out: string, previous: Previous, builtAt = new Date()): BuildResult {
  const { imslp, eras, wikipedia: wiki, wikidata: wd, openopus: oo, musicbrainz: mb, mutopia, libris, gnd } = input;
  const works = new Map<string, BuildWork>();
  const composers = new Map<string, BuildComposer>();
  const byComposer = new Map<string, BuildWork[]>();
  const imslpByTitle = new Map<string, BuildWork>();
  const lineupSources = new Map<string, Map<SourceId, Set<string>>>();
  const stats = {
    matched: { wikidata: 0, wikipedia: 0, openopus: 0, mutopia: 0, libris: 0, gnd: 0 },
    added: { wikipedia: 0, wikidata: 0, openopus: 0, libris: 0, gnd: 0 },
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
    const matched = matchWork(d.label, byComposer.get(composerKey) ?? []);
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

  // ---- 5. Open Opus ---------------------------------------------------------
  // Open Opus names composers like Wikidata's English labels ("Sergei Prokofiev"), so
  // labels bridge to IMSLP names ("Prokofiev, Sergey"); unambiguous labels only.
  const composerIndex = new ComposerIndex([...composers.keys()].filter((k) => !k.startsWith("wd:")));
  const byLabel = new Map<string, string | null>();
  for (const c of Object.values(wd?.composers ?? {})) {
    if (!c.label) continue;
    const label = normalize(c.label);
    const key = wdKey.get(c.qid)!;
    byLabel.set(label, byLabel.has(label) && byLabel.get(label) !== key ? null : key);
  }
  for (const oc of oo?.composers ?? []) {
    const ooName = normalize(oc.completeName);
    const key = byLabel.get(ooName) ?? composerIndex.find(oc.name, oc.completeName) ?? `oo:${ooName}`;
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

  // ---- Composers of GND works (from Wikidata, by GND id) ---------------------------
  // Registered before the sources that match composers by name and dates (Mutopia,
  // LIBRIS), so those find them instead of creating them again.
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
  // Musik- och teaterbiblioteket's sheet music. A record of a work we have adds a link
  // to borrow it. A record of a work we don't have adds the work when its instrumentation
  // is explicit and fully understood, and it isn't an arrangement or an anthology;
  // further editions of it then match it. Composers match on surname and birth year.
  // Works made from LIBRIS records, by composer and the library's uniform title, so later
  // editions find them whatever their printed titles say.
  const fromLibris = new Map<string, BuildWork>();
  const uniformKey = (composerKey: string, uniform: string | null) => (uniform ? `${composerKey}|${normalize(uniform)}` : null);
  for (const r of libris?.records ?? []) {
    if (r.collection || r.composers.length !== 1) continue;
    const lc = r.composers[0]!;
    if (!lc.born) continue;
    const found = (bySurname.get(surnameKey(lc.family)) ?? []).filter((c) => near(c.born, lc.born) && (!lc.died || !c.died || near(c.died, lc.died)));
    let c: BuildComposer | null = found.length === 1 ? found[0]! : null;
    const titles = [r.uniform, r.title].filter((t): t is string => !!t);
    let w: BuildWork | null = null;
    if (c) w = fromLibris.get(uniformKey(c.key, r.uniform) ?? "") ?? null;
    if (c && !w) for (const t of titles) if ((w = matchWork(t, byComposer.get(c.key) ?? []))) break;
    if (w) {
      stats.matched.libris++;
    } else {
      const lineup = r.arranged ? null : librisLineup(r.medium);
      if (!lineup || found.length > 1) continue;
      if (!c) {
        const key = `libris:${lc.agent ?? normalize(`${lc.family} ${lc.given ?? ""} ${lc.born}`)}`;
        c = composer(key, () => ({ name: [lc.given, lc.family].filter(Boolean).join(" "), born: lc.born ?? undefined, died: lc.died ?? undefined }));
        if (lc.agent) c.libris = lc.agent;
        bySurname.set(surnameKey(lc.family), [...(bySurname.get(surnameKey(lc.family)) ?? []).filter((x) => x !== c), c]);
      }
      w = newWork(`libris:${r.id}`, r.title || r.uniform!, c.key);
      w.libris = r.id;
      if (r.uniform) w.aliases.add(r.uniform);
      addWork(w);
      addMembership(w, parseEnsembleKey(lineup), false, "libris", r.medium[0]!);
      const k = uniformKey(c.key, r.uniform);
      if (k) fromLibris.set(k, w);
      stats.added.libris++;
    }
    w.extraLinks.push({ provider: "libris", ref: r.id, url: librisUrl(r.id), label: librisHolding(r), source: "libris" });
  }

  // ---- 9. GND -------------------------------------------------------------------
  // The German National Library's musical works. Composers are GND person ids, bridged
  // through Wikidata. A GND work is one we have when Wikidata says so, or when a
  // catalogue number matches. Otherwise it comes in with its instrumentation, but only
  // where that can't duplicate a work we have: the composer has nothing for that line-up
  // yet, or everything they have for it is numbered and none of the numbers match.
  const byWikidataWork = new Map<string, BuildWork>();
  const byGndWork = new Map<string, BuildWork>();
  for (const w of works.values()) {
    if (w.wikidata) byWikidataWork.set(w.wikidata, w);
    if (w.gnd) byGndWork.set(w.gnd.id, w);
  }
  for (const g of gnd?.works ?? []) {
    if (/\b(?:bearb|arr)\./i.test(g.name)) continue; // arrangements
    const parts = gndLineup(g.media);
    const medium = g.media.map((m) => (m.count > 1 ? `${m.name} (${m.count})` : m.name)).join(", ");
    const composerKey = g.composer ? composerByGnd.get(g.composer) : undefined;
    let w = byGndWork.get(g.id) ?? (g.wikidata ? byWikidataWork.get(g.wikidata) : undefined) ?? null;
    if (!w && composerKey) w = matchWork(gndMatchTitle(g), byComposer.get(composerKey) ?? []);
    if (w) {
      stats.matched.gnd++;
      if (!w.gnd || w.gnd.source !== "gnd") w.gnd = { id: g.id, source: "gnd" };
      if (w.year === undefined && g.year) w.year = g.year;
      if (parts && !hasOwnInstrumentation(w) && titleFitsPlayers(w.title, parts)) addMembership(w, parts, false, "gnd", medium);
      continue;
    }
    if (!parts || !composerKey) continue;
    const title = gndTitle(g.name);
    // The same title as one of the composer's works, with no key or number saying
    // otherwise, is that work (IMSLP often files choral works under a generic line-up).
    const numbers = catalogueKeys(gndMatchTitle(g));
    const sameTitle = (byComposer.get(composerKey) ?? []).filter((x) => sameWorkByTitle(x.title, title, numbers));
    if (sameTitle.length === 1) {
      const same = sameTitle[0]!;
      stats.matched.gnd++;
      same.gnd ??= { id: g.id, source: "gnd" };
      continue;
    }
    if (sameTitle.length > 1) continue; // can't tell which
    const key = ensembleKey(parts);
    const rivals = (byComposer.get(composerKey) ?? []).filter((x) => x.ensembles.has(key));
    // Different catalogue numbers, or different numbers in a series ("No. 2", "No. 3").
    const no = (t: string) => /\bNo\.?\s*(\d+)\b/i.exec(t)?.[1] ?? null;
    const ours = no(title);
    const distinct = (x: BuildWork) => {
      const theirs = catalogueKeys(x.title);
      if (numbers.size && theirs.size && ![...theirs].some((k) => numbers.has(k))) return true;
      const n = no(x.title);
      return ours !== null && n !== null && n !== ours;
    };
    if (rivals.length && !rivals.every(distinct)) continue;
    if (!titleFitsPlayers(title, parts)) continue;
    w = newWork(`gnd:${g.id}`, title, composerKey);
    w.gnd = { id: g.id, source: "gnd" };
    if (g.year) w.year = g.year;
    addWork(w);
    byGndWork.set(g.id, w);
    addMembership(w, parts, false, "gnd", medium);
    stats.added.gnd++;
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
  const composerAnchors = (c: BuildComposer) =>
    [c.wikidata && `wikidata:${c.wikidata}`, c.imslp && `imslp:${c.imslp}`, c.gnd && `gnd:${c.gnd}`, c.openopus && `openopus:${c.openopus}`, c.libris && `libris:${c.libris}`, `key:${c.key}`].filter(
      (a): a is string => !!a,
    );
  const composerIds = assignIds(usedComposers.map(composerAnchors), previous.composer, COMPOSER_SCHEMES);
  const composerId = new Map(usedComposers.map((c, i) => [c.key, composerIds.ids[i]!]));

  const workAnchors = (w: BuildWork) =>
    [w.imslp && `imslp:${w.imslp.pageid}`, w.wikidata && `wikidata:${w.wikidata}`, w.gnd && `gnd:${w.gnd.id}`, w.openopus && `openopus:${w.openopus}`, w.libris && `libris:${w.libris}`].filter(
      (a): a is string => !!a,
    );
  const workIds = assignIds(workList.map(workAnchors), previous.work, WORK_SCHEMES);

  // ---- Write ------------------------------------------------------------------
  const db = new DatabaseSync(out);
  // Rows go in whatever order is convenient; references are checked once at the end.
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;");
  db.exec(TABLES);
  db.exec("BEGIN");

  const insertComposer = db.prepare("INSERT INTO composers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertWork = db.prepare("INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertScoring = db.prepare("INSERT INTO scorings VALUES (?, ?, ?, ?, ?, ?)");
  const insertLink = db.prepare("INSERT INTO links VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertLineup = db.prepare("INSERT INTO lineups VALUES (?, ?, ?, ?, ?, ?)");
  const insertRedirect = db.prepare("INSERT INTO redirects VALUES (?, ?, ?)");
  const insertWorkFts = db.prepare("INSERT INTO works_fts (rowid, title, composer, aliases, keys) VALUES (?, ?, ?, ?, ?)");
  const insertComposerFts = db.prepare("INSERT INTO composers_fts (rowid, name) VALUES (?, ?)");

  // A provider's record belongs to one work (or composer). Rarely two sources link the
  // same record to different works (two Wikidata items with one MusicBrainz id): the
  // first, in id order, keeps it.
  const linked = new Set<string>();
  let sharedLinks = 0;
  const link = (entity: "work" | "composer", id: string, provider: ProviderId, ref: string, url: string | null, source: SourceId, label: string | null = null) => {
    const k = `${entity}|${provider}|${ref}`;
    if (linked.has(k)) return void sharedLinks++;
    linked.add(k);
    const l: Link = { provider, kind: PROVIDERS[provider].kind, ref, url, label, source };
    insertLink.run(entity, id, l.provider, l.kind, l.ref, l.url, l.label, l.source);
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
  });

  const lineupCounts = new Map<string, { original: number; arrangements: number }>();
  let core = 0;
  workList.forEach((w, i) => {
    const id = workIds.ids[i]!;
    const n = i + 1;
    const c = w.composer ? composers.get(w.composer) : undefined;
    const s = score({ signals: [...w.signals], recordings: w.recordings, sitelinks: w.sitelinks, composerSitelinks: c?.sitelinks });
    if (s >= CORE_SCORE) core++;
    // Wikidata publication dates are often a modern edition's: keep years within the composer's life (roughly).
    const plausible =
      w.year !== undefined && w.year <= builtAt.getUTCFullYear() && (!c?.born || (w.year >= c.born + 5 && (!c.died || w.year <= c.died + 30)));

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
    );
    for (const [key, m] of memberships) {
      insertScoring.run(id, key, m.arr ? 1 : 0, players(key), s, JSON.stringify([...m.refs].map(([source, ref]) => ({ source, ref }))));
      const counts = lineupCounts.get(key) ?? { original: 0, arrangements: 0 };
      if (m.arr) counts.arrangements++;
      else counts.original++;
      lineupCounts.set(key, counts);
    }

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
    for (const l of w.extraLinks) link("work", id, l.provider, l.ref, l.url, l.source, l.label);

    // Folded to ASCII words, like search queries (see worker/queries.ts); keys add the
    // compact catalogue forms people type ("k581", "bwv1007", "op18").
    const keys = [...catalogueKeys(w.title)].map((k) => k.split("/")[0]!.replaceAll(":", ""));
    insertWorkFts.run(n, own, c ? ftsNames(c) : "", aliases.map(normalize).join(" "), [...new Set(keys)].join(" "));
  });

  for (const key of [...lineupCounts.keys()].sort()) {
    const counts = lineupCounts.get(key)!;
    const sources = Object.fromEntries([...(lineupSources.get(key) ?? [])].map(([s, refs]) => [s, [...refs].sort()]));
    insertLineup.run(key, describe(parseEnsembleKey(key)), players(key), counts.original, counts.arrangements, JSON.stringify(sources));
  }

  for (const [old, now] of composerIds.redirects) insertRedirect.run("composer", old, now);
  for (const [old, now] of workIds.redirects) insertRedirect.run("work", old, now);

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
        note: `${Object.keys(imslp.members).length} instrumentation categories`,
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
        note: "sheet music held by Musik- och teaterbiblioteket",
      },
      gnd: {
        fetchedAt: iso(gnd?.fetchedAt),
        items: gnd?.works.length ?? 0,
        matched: stats.matched.gnd,
        added: stats.added.gnd,
        note: "musical works with instrumentation or a Wikidata link",
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
    bySource,
    links: Object.fromEntries(all("SELECT provider, COUNT(*) AS n FROM links WHERE entity = 'work' GROUP BY provider").map((r) => [r.provider, r.n])) as DatasetStats["links"],
    eras: Object.fromEntries(all("SELECT era, COUNT(*) AS n FROM works GROUP BY era ORDER BY n DESC").map((r) => [r.era ?? "Unknown", r.n])),
    sizes: [...sizes.values()],
    topLineups: all("SELECT key, description, original AS works FROM lineups ORDER BY original DESC LIMIT 12").map((r) => ({ key: r.key, description: r.description, works: r.works })),
    redirects: one("SELECT COUNT(*) AS n FROM redirects").n,
  };
}

/** Anchors and redirects of works and composers in a previous dataset. */
export function readPrevious(path: string): Previous | null {
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const hasLinks = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'links'").get();
    if (!hasLinks) return null; // a dataset from before persistent ids
    const out: Previous = { work: { anchors: new Map(), redirects: new Map() }, composer: { anchors: new Map(), redirects: new Map() } };
    for (const r of db.prepare("SELECT entity, provider, ref, entity_id FROM links").all() as Record<string, string>[]) {
      out[r.entity as "work" | "composer"].anchors.set(`${r.provider}:${r.ref}`, r.entity_id!);
    }
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
  if (previous) await rename(DATASET_PATH, PREVIOUS_PATH);
  await rename(next, DATASET_PATH);
  const { meta } = result;
  console.log(`Dataset ${meta.version}: ${meta.works} works (${result.core} core), ${meta.composers} composers, ${meta.lineups} line-ups, ${result.redirects} redirects → ${DATASET_PATH}`);
  for (const [s, v] of Object.entries(meta.sources)) console.log(`  ${s}: ${v.items} items · ${v.note}`);
  return result;
}
