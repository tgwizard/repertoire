// Merges the crawled sources into the static index in public/data/.
//
// IMSLP is the backbone: its categories give exact instrumentation. Other sources
// add ranking signals to IMSLP works, and add works IMSLP doesn't have (typically
// 20th-century works still in copyright) when they state an exact line-up.

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ensembleKey, parseCategory, type Ensemble } from "../src/lib/instrumentation.ts";
import {
  CORE_SCORE,
  SIGNALS,
  type Composer,
  type EnsemblesFile,
  type Era,
  type MetaFile,
  type ShardFile,
  type Signal,
  type SourceId,
  type Work,
} from "../src/shared/data.ts";
import { openOpusEnsemble, titleFitsPlayers, WIKIDATA_ENSEMBLES, WIKIPEDIA_CATEGORIES, wikidataInstrumentsFit } from "./ensembles.ts";
import { writeExports } from "./export.ts";
import { readStage, writeJsonAtomic } from "./http.ts";
import { ComposerIndex, displayName, matchWork, normalize } from "./match.ts";
import type { ComposerErasStage, ImslpStage } from "./sources/imslp.ts";
import type { MusicBrainzStage } from "./sources/musicbrainz.ts";
import type { OpenOpusStage } from "./sources/openopus.ts";
import type { WikidataStage, WdWork } from "./sources/wikidata.ts";
import type { WikipediaStage } from "./sources/wikipedia.ts";

const OUT_DIR = join(import.meta.dirname, "..", "public", "data");
export const EXPORT_DIR = join(import.meta.dirname, "..", ".cache", "export");
const BUCKET_WORKS = 2000; // small ensembles are packed together up to this many works per file
const CHUNK_WORKS = 1000; // large ensembles are split into files of this many works

interface Membership {
  arr: boolean;
  via: Set<SourceId>;
}

interface BuildWork {
  id: string;
  title: string;
  composer?: string;
  year?: number;
  era?: Era;
  imslp?: string;
  wikidata?: string;
  wikipedia?: string;
  openopus?: number;
  musicbrainz?: string;
  recordings?: number;
  sitelinks: number;
  signals: Set<Signal>;
  ensembles: Map<string, Membership>;
}

interface BuildComposer extends Composer {
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

export async function build(): Promise<void> {
  const imslp = await readStage<ImslpStage>("imslp");
  if (!imslp) throw new Error("No IMSLP data yet: run `npm run crawl -- imslp` first");
  const eras = (await readStage<ComposerErasStage>("imslp-composer-eras"))?.eras ?? {};
  const wiki = await readStage<WikipediaStage>("wikipedia");
  const wd = await readStage<WikidataStage>("wikidata");
  const oo = await readStage<OpenOpusStage>("openopus");
  const mb = await readStage<MusicBrainzStage>("musicbrainz");

  const works = new Map<string, BuildWork>();
  const composers = new Map<string, BuildComposer>();
  const byComposer = new Map<string, BuildWork[]>();
  const imslpByTitle = new Map<string, BuildWork>();
  const ensembleSources = new Map<string, Partial<Record<SourceId, Set<string>>>>();
  const stats = { matched: { wikidata: 0, wikipedia: 0, openopus: 0 }, added: { wikipedia: 0, wikidata: 0, openopus: 0 } };

  const composer = (key: string, init: () => Partial<BuildComposer>): BuildComposer => {
    let c = composers.get(key);
    if (!c) composers.set(key, (c = { name: key, sitelinks: 0, ...init() }));
    return c;
  };

  const addWork = (w: BuildWork) => {
    works.set(w.id, w);
    if (w.composer) {
      const list = byComposer.get(w.composer) ?? [];
      list.push(w);
      byComposer.set(w.composer, list);
    }
  };

  const addMembership = (w: BuildWork, parts: Ensemble, arr: boolean, via: SourceId, sourceLabel: string) => {
    const key = ensembleKey(parts);
    const m = w.ensembles.get(key);
    if (m) {
      m.arr &&= arr;
      m.via.add(via);
    } else {
      w.ensembles.set(key, { arr, via: new Set([via]) });
    }
    const src = ensembleSources.get(key) ?? {};
    (src[via] ??= new Set()).add(sourceLabel);
    ensembleSources.set(key, src);
  };

  // A non-IMSLP source only sets the line-up of an IMSLP work that has no
  // (non-arrangement) instrumentation category; IMSLP's exact categories win.
  const hasOwnInstrumentation = (w: BuildWork) => w.id.startsWith("imslp:") && [...w.ensembles.values()].some((m) => !m.arr);

  // ---- 1. IMSLP --------------------------------------------------------------
  for (const [category, ids] of Object.entries(imslp.members)) {
    const parsed = parseCategory(category);
    if (!parsed) continue;
    for (const pageid of ids) {
      const iw = imslp.works[pageid];
      if (!iw) continue;
      const id = `imslp:${pageid}`;
      let w = works.get(id);
      if (!w) {
        const m = /^(.*) \(([^()]+)\)$/.exec(iw.title);
        const composerName = m?.[2];
        if (composerName) composer(composerName, () => ({ name: displayName(composerName), imslp: composerName }));
        w = {
          id,
          title: m ? m[1]! : iw.title,
          composer: composerName,
          era: iw.era ?? undefined,
          imslp: iw.title,
          sitelinks: 0,
          signals: new Set(),
          ensembles: new Map(),
        };
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
    w.wikidata ??= d.qid;
    w.musicbrainz ??= d.musicbrainz;
    if (d.year !== undefined && w.year === undefined) w.year = d.year;
    w.sitelinks = Math.max(w.sitelinks, d.sitelinks);
    if (d.wikipedia) {
      w.wikipedia ??= d.wikipedia;
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
    const w: BuildWork = {
      id: `wd:${d.qid}`,
      title: d.label,
      composer: composerKey,
      sitelinks: 0,
      signals: new Set(),
      ensembles: new Map(),
    };
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
      w.wikipedia ??= a.title;
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
  const composerIndex = new ComposerIndex([...composers.keys()].filter((k) => !k.startsWith("wd:")));
  const wdComposerByName = new Map<string, string>();
  for (const [key, c] of composers) if (key.startsWith("wd:")) wdComposerByName.set(normalize(c.name), key);
  for (const oc of oo?.composers ?? []) {
    const key =
      composerIndex.find(oc.name, oc.completeName) ?? wdComposerByName.get(normalize(oc.completeName)) ?? `oo:${normalize(oc.completeName)}`;
    const c = composer(key, () => ({ name: oc.completeName }));
    c.born ??= oc.born ?? undefined;
    c.died ??= oc.died ?? undefined;
    c.era ??= OPEN_OPUS_EPOCHS[oc.epoch];
    for (const ow of oc.works) {
      const candidates = byComposer.get(key) ?? [];
      let w = matchWork(ow.title, candidates);
      if (w) {
        stats.matched.openopus++;
      } else {
        const parts = openOpusEnsemble(ow.title, ow.genre, oc.born);
        if (!parts || !titleFitsPlayers(ow.title, parts)) continue;
        w = { id: `oo:${ow.id}`, title: ow.title, composer: key, sitelinks: 0, signals: new Set(), ensembles: new Map() };
        addWork(w);
        addMembership(w, parts, false, "openopus", `${ow.genre}: “${ow.title}”`);
        stats.added.openopus++;
      }
      w.openopus ??= ow.id;
      if (ow.popular) w.signals.add("openopus-popular");
      if (ow.recommended) w.signals.add("openopus-recommended");
    }
  }

  // ---- 6. MusicBrainz -------------------------------------------------------
  for (const w of works.values()) {
    const r = w.musicbrainz ? mb?.recordings[w.musicbrainz] : undefined;
    if (r) w.recordings = r.count;
  }

  // ---- Composer eras, work eras, scores --------------------------------------
  for (const c of composers.values()) {
    c.era = (c.imslp ? eras[c.imslp]?.era : undefined) ?? c.era ?? (c.born ? eraFromBirth(c.born) : undefined);
  }
  const score = (w: BuildWork) => {
    let s = 0;
    for (const sig of w.signals) s += SIGNALS[sig].points;
    if (w.recordings) s += Math.min(4, Math.log2(1 + w.recordings) / 2);
    s += Math.min(2, w.sitelinks / 10);
    const c = w.composer ? composers.get(w.composer) : undefined;
    if (c) s += Math.min(1.5, Math.log2(1 + c.sitelinks) / 5);
    return Math.round(s * 10) / 10;
  };

  // ---- Emit -------------------------------------------------------------------
  const byEnsemble = new Map<string, { w: BuildWork; m: Membership }[]>();
  const scores = new Map<string, number>();
  for (const w of works.values()) {
    scores.set(w.id, score(w));
    for (const [key, m] of w.ensembles) {
      const list = byEnsemble.get(key) ?? [];
      list.push({ w, m });
      byEnsemble.set(key, list);
    }
  }

  const toWork = (w: BuildWork, m: Membership): Work => {
    const c = w.composer ? composers.get(w.composer) : undefined;
    const out: Work = {
      id: w.id,
      title: w.title,
      score: scores.get(w.id)!,
      signals: [...w.signals],
      via: [...m.via],
    };
    if (w.composer) out.composer = w.composer;
    if (w.year !== undefined) out.year = w.year;
    const era = w.era ?? c?.era;
    if (era) out.era = era;
    if (m.arr) out.arr = true;
    if (w.imslp) out.imslp = w.imslp;
    if (w.wikidata) out.wikidata = w.wikidata;
    if (w.wikipedia) out.wikipedia = w.wikipedia;
    if (w.openopus !== undefined) out.openopus = w.openopus;
    if (w.musicbrainz) out.musicbrainz = w.musicbrainz;
    if (w.recordings !== undefined) out.recordings = w.recordings;
    return out;
  };

  await rm(OUT_DIR, { recursive: true, force: true });
  const ensemblesOut: EnsemblesFile = { builtAt: new Date().toISOString(), ensembles: {} };
  let shardNo = 0;
  let bucket: ShardFile = { composers: {}, ensembles: {} };
  let bucketWorks = 0;
  const flushBucket = async () => {
    if (!bucketWorks) return;
    const no = await writeShard(bucket);
    for (const key of Object.keys(bucket.ensembles)) ensemblesOut.ensembles[key]![2] = [no];
    bucket = { composers: {}, ensembles: {} };
    bucketWorks = 0;
  };

  const writeShard = async (shard: ShardFile) => {
    for (const e of Object.values(shard.ensembles)) {
      for (const w of e.works) {
        if (w.composer && !shard.composers[w.composer]) {
          const { sitelinks: _, ...c } = composers.get(w.composer)!;
          shard.composers[w.composer] = c;
        }
      }
    }
    await writeJsonAtomic(join(OUT_DIR, "shards", `${shardNo}.json`), shard);
    return shardNo++;
  };

  const keys = [...byEnsemble.keys()].sort();
  for (const key of keys) {
    // Originals first, then arrangements (which would otherwise rank on the fame of the original work).
    const list = byEnsemble
      .get(key)!
      .sort((a, b) => Number(a.m.arr) - Number(b.m.arr) || scores.get(b.w.id)! - scores.get(a.w.id)! || a.w.title.localeCompare(b.w.title));
    const ws = list.map(({ w, m }) => toWork(w, m));
    const n = ws.filter((w) => !w.arr).length;
    const sources = Object.fromEntries(Object.entries(ensembleSources.get(key) ?? {}).map(([s, set]) => [s, [...set].sort()]));
    const shardNos: number[] = [];
    if (ws.length > CHUNK_WORKS / 2) {
      for (let i = 0; i < ws.length; i += CHUNK_WORKS) {
        const chunk = { works: ws.slice(i, i + CHUNK_WORKS), ...(i === 0 ? { sources } : {}) };
        shardNos.push(await writeShard({ composers: {}, ensembles: { [key]: chunk } }));
      }
    } else {
      if (bucketWorks + ws.length > BUCKET_WORKS) await flushBucket();
      bucket.ensembles[key] = { sources, works: ws };
      bucketWorks += ws.length;
      // The shard number is filled in when the bucket is written.
    }
    ensemblesOut.ensembles[key] = [n, ws.length - n, shardNos];
  }
  await flushBucket();
  await writeJsonAtomic(join(OUT_DIR, "ensembles.json"), ensemblesOut);

  const iso = (t: number | undefined) => (t ? new Date(t).toISOString() : null);
  const meta: MetaFile = {
    // e.g. "20261019T220512Z": names the published dataset (see publish.ts)
    version: ensemblesOut.builtAt.replace(/[-:]/g, "").slice(0, 15) + "Z",
    builtAt: ensemblesOut.builtAt,
    works: works.size,
    ensembles: keys.length,
    sources: {
      imslp: { fetchedAt: iso(imslp.fetchedAt), items: Object.keys(imslp.works).length, note: `${Object.keys(imslp.members).length} instrumentation categories` },
      wikipedia: {
        fetchedAt: iso(wiki?.fetchedAt),
        items: Object.values(wiki?.members ?? {}).reduce((s, m) => s + m.length, 0),
        note: `${stats.added.wikipedia} works added that IMSLP lacks`,
      },
      wikidata: {
        fetchedAt: iso(wd?.fetchedAt),
        items: Object.keys(wd?.works ?? {}).length,
        note: `${stats.matched.wikidata} IMSLP works linked, ${stats.added.wikidata} works added`,
      },
      openopus: {
        fetchedAt: iso(oo?.fetchedAt),
        items: (oo?.composers ?? []).reduce((s, c) => s + c.works.length, 0),
        note: `${stats.matched.openopus} matched, ${stats.added.openopus} works added`,
      },
      musicbrainz: {
        fetchedAt: iso(mb?.fetchedAt),
        items: Object.keys(mb?.recordings ?? {}).length,
        note: "recording counts",
      },
    },
  };
  await writeJsonAtomic(join(OUT_DIR, "meta.json"), meta);

  const core = [...works.values()].filter((w) => scores.get(w.id)! >= CORE_SCORE).length;
  console.log(`Index: ${works.size} works (${core} core), ${keys.length} line-ups, ${shardNo} shard files → public/data`);
  for (const [s, v] of Object.entries(meta.sources)) console.log(`  ${s}: ${v.items} items · ${v.note}`);

  const exportWorks = [...works.values()].map((w) => ({
    work: toWork(w, { arr: false, via: new Set() }),
    ensembles: [...w.ensembles].map(([key, m]) => ({ key, arr: m.arr, via: [...m.via] })),
  }));
  const used = new Set([...works.values()].map((w) => w.composer));
  const exportComposers = [...composers].filter(([key]) => used.has(key)).map(([key, { sitelinks: _, ...c }]) => ({ key, ...c }));
  const exportEnsembles = keys.map((key) => {
    const [n, a] = ensemblesOut.ensembles[key]!;
    const src = Object.fromEntries(Object.entries(ensembleSources.get(key) ?? {}).map(([s, set]) => [s, [...set].sort()]));
    return { key, original: n, arrangements: a, sources: src };
  });
  await writeExports(EXPORT_DIR, { meta, works: exportWorks, composers: exportComposers, ensembles: exportEnsembles });
}
