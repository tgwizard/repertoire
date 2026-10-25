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
import { catalogueKeys, ComposerIndex, displayName, matchWork } from "./match.ts";
import type { ComposerErasStage, ImslpStage } from "./sources/imslp.ts";
import type { MusicBrainzStage } from "./sources/musicbrainz.ts";
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
  };
}

/** Anchor schemes, strongest first (see ids.ts). */
const WORK_SCHEMES = ["imslp", "wikidata", "openopus"];
const COMPOSER_SCHEMES = ["wikidata", "imslp", "openopus"];

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
  wikidata?: string;
  wikipedia?: { title: string; source: SourceId };
  openopus?: string;
  musicbrainz?: string;
  recordings?: number;
  sitelinks: number;
  signals: Set<Signal>;
  ensembles: Map<string, Membership>;
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
  const { imslp, eras, wikipedia: wiki, wikidata: wd, openopus: oo, musicbrainz: mb } = input;
  const works = new Map<string, BuildWork>();
  const composers = new Map<string, BuildComposer>();
  const byComposer = new Map<string, BuildWork[]>();
  const imslpByTitle = new Map<string, BuildWork>();
  const lineupSources = new Map<string, Map<SourceId, Set<string>>>();
  const stats = { matched: { wikidata: 0, wikipedia: 0, openopus: 0 }, added: { wikipedia: 0, wikidata: 0, openopus: 0 } };

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
  for (const c of Object.values(wd?.composers ?? {})) {
    const key = c.imslp ?? `wd:${c.qid}`;
    composerKeyByQid.set(c.qid, key);
    if (!c.imslp && !c.label) continue;
    const bc = composer(key, () => ({ name: c.label ?? displayName(key), imslp: c.imslp }));
    if (c.label) bc.name = c.label;
    bc.wikidata = c.qid;
    bc.born ??= c.born;
    bc.died ??= c.died;
    bc.wikipedia ??= c.wikipedia;
    bc.sitelinks = Math.max(bc.sitelinks, c.sitelinks);
  }

  const attachWikidata = (w: BuildWork, d: WdWork) => {
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
    const key = c.imslp ?? `wd:${c.qid}`;
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
    [c.wikidata && `wikidata:${c.wikidata}`, c.imslp && `imslp:${c.imslp}`, c.openopus && `openopus:${c.openopus}`].filter((a): a is string => !!a);
  const composerIds = assignIds(usedComposers.map(composerAnchors), previous.composer, COMPOSER_SCHEMES);
  const composerId = new Map(usedComposers.map((c, i) => [c.key, composerIds.ids[i]!]));

  const workAnchors = (w: BuildWork) =>
    [w.imslp && `imslp:${w.imslp.pageid}`, w.wikidata && `wikidata:${w.wikidata}`, w.openopus && `openopus:${w.openopus}`].filter(
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
    const plausible = w.year !== undefined && (!c?.born || (w.year >= c.born + 5 && (!c.died || w.year <= c.died + 30)));

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
      w.imslp ? 1 : 0,
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
    if (w.musicbrainz) {
      const label = w.recordings ? `${w.recordings} recordings` : null;
      link("work", id, "musicbrainz", w.musicbrainz, musicbrainzUrl(w.musicbrainz), "wikidata", label);
    }
    // Open Opus has no page per work; the id still records the match.
    if (w.openopus) link("work", id, "openopus", w.openopus, null, "openopus");

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
