// Smoke tests against a running site: the deployed app, its dataset and the
// published downloads. Plain HTTP, no credentials.
//
//   npm run smoke                                   production
//   SMOKE_URL=http://localhost:5173 npm run smoke   local dev server
//   SMOKE_MAX_AGE_DAYS=30 npm run smoke             allow an older dataset

import assert from "node:assert/strict";
import { test } from "node:test";
import { bareTitle, musicalKey } from "../crawler/match.ts";
import { decodeEnsemble, ensembleKey } from "../src/lib/instrumentation.ts";
import {
  DATASETS_URL,
  EXPORT_FILES,
  type Composer,
  type EnsemblesFile,
  type MetaFile,
  type ShardFile,
  type Work,
} from "../src/shared/data.ts";

const BASE = (process.env.SMOKE_URL ?? "https://repertoire.tgwizard.com").replace(/\/$/, "");
const MAX_AGE_DAYS = Number(process.env.SMOKE_MAX_AGE_DAYS ?? 21);

async function get(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  assert.equal(res.status, 200, `${init?.method ?? "GET"} ${url} → ${res.status}`);
  return res;
}
const json = async <T>(path: string) => (await (await get(path)).json()) as T;

const meta = await json<MetaFile>("/data/meta.json");
const { ensembles } = await json<EnsemblesFile>("/data/ensembles.json");
console.log(`# ${BASE}: dataset ${meta.version}, ${meta.works} works, ${meta.ensembles} line-ups`);

const shardCache = new Map<number, Promise<ShardFile>>();
const shard = (n: number) => {
  if (!shardCache.has(n)) shardCache.set(n, json<ShardFile>(`/data/shards/${n}.json`));
  return shardCache.get(n)!;
};

/** All works for a line-up (as in the app: originals first, in rank order). */
async function lineup(spec: string): Promise<{ works: Work[]; composers: Record<string, Composer> }> {
  const key = ensembleKey(decodeEnsemble(spec));
  const entry = ensembles[key];
  assert.ok(entry, `line-up ${spec} (${key}) missing from ensembles.json`);
  const works: Work[] = [];
  const composers: Record<string, Composer> = {};
  for (const n of entry[2]) {
    const s = await shard(n);
    const part = s.ensembles[key];
    assert.ok(part, `shard ${n} lacks line-up ${key}`);
    works.push(...part.works);
    Object.assign(composers, s.composers);
  }
  return { works, composers };
}

/** 1-based rank among original works, or 0 if absent. */
async function rank(spec: string, composer: RegExp, title: RegExp): Promise<number> {
  const { works, composers } = await lineup(spec);
  const originals = works.filter((w) => !w.arr);
  return originals.findIndex((w) => composer.test(composers[w.composer ?? ""]?.name ?? "") && title.test(w.title)) + 1;
}

const WIND_QUINTET = "flute,oboe,clarinet,bassoon,horn";
const STRING_QUARTET = "violin:2,viola,cello";

test("serves the app, including deep links", async () => {
  for (const path of ["/", "/?i=violin:2,viola,cello", "/some/deep/link"]) {
    const html = await (await get(path)).text();
    assert.match(html, /<div id="root">/, `${path} doesn't look like the app`);
  }
});

test("dataset is fresh and complete", () => {
  const ageDays = (Date.now() - Date.parse(meta.builtAt)) / 86_400_000;
  assert.ok(ageDays <= MAX_AGE_DAYS, `dataset built ${ageDays.toFixed(1)} days ago (max ${MAX_AGE_DAYS})`);
  assert.ok(meta.works > 200_000, `only ${meta.works} works`);
  assert.ok(Object.keys(ensembles).length > 5_000, `only ${Object.keys(ensembles).length} line-ups`);
  assert.ok(meta.sources.imslp.items > 200_000, "IMSLP looks truncated");
  assert.ok(meta.sources.wikidata.items > 5_000, "Wikidata looks truncated");
  assert.ok(meta.sources.wikipedia.items > 1_000, "Wikipedia looks truncated");
  assert.ok(meta.sources.openopus.items > 10_000, "Open Opus looks truncated");
});

test("common line-ups have plausible counts", () => {
  const min: [string, number][] = [
    [STRING_QUARTET, 4_000],
    [WIND_QUINTET, 250],
    [`${WIND_QUINTET},piano`, 25],
    ["violin,cello,piano", 1_500],
    ["trumpet:2,horn,trombone,tuba", 80],
    ["orchestra", 12_000],
    ["piano", 40_000],
  ];
  for (const [spec, n] of min) {
    const entry = ensembles[ensembleKey(decodeEnsemble(spec))];
    assert.ok(entry && entry[0] >= n, `${spec}: ${entry?.[0] ?? 0} original works, expected ≥ ${n}`);
  }
});

test("canonical works are present and rank near the top", async () => {
  const expected: [spec: string, composer: RegExp, title: RegExp, maxRank: number][] = [
    [WIND_QUINTET, /Nielsen/, /Wind Quintet, Op\.43/, 5],
    [WIND_QUINTET, /Reicha/, /Op\.88/, 50],
    [WIND_QUINTET, /Barber/, /Summer Music/, 30], // not on IMSLP: comes from Wikipedia
    [`${WIND_QUINTET},piano`, /Poulenc/, /Sextet/, 5],
    [STRING_QUARTET, /Debussy/, /Op\.10/, 10],
    ["violin,cello,piano", /Beethoven/, /Op\.97/, 5],
    ["clarinet,violin:2,viola,cello", /Brahms/, /Op\.115/, 5],
    ["clarinet,violin:2,viola,cello", /Mozart/, /K\.581/, 5],
    ["violin,orchestra", /Mendelssohn/, /Op\.64/, 5],
    ["orchestra", /Beethoven/, /Symphony No\.5, Op\.67/, 25],
  ];
  for (const [spec, composer, title, maxRank] of expected) {
    const r = await rank(spec, composer, title);
    assert.ok(r > 0, `${composer} ${title} missing from ${spec}`);
    assert.ok(r <= maxRank, `${composer} ${title} ranks ${r} in ${spec}, expected ≤ ${maxRank}`);
  }
});

test("known misclassifications stay fixed", async () => {
  // Poulenc's Sextet is for piano and wind quintet (a Wikipedia category lists it under wind quintet).
  assert.equal(await rank(WIND_QUINTET, /Poulenc/, /Sextet/), 0);
  // Chausson's Concert is for violin, piano and string quartet (Wikidata tags it "string quartet").
  assert.equal(await rank(STRING_QUARTET, /Chausson/, /Concert/), 0);
  // Für Elise for string quartet only exists as an arrangement.
  assert.equal(await rank(STRING_QUARTET, /Beethoven/, /Für Elise/), 0);
  // IMSLP's catch-all "For 1 player" isn't a line-up.
  assert.ok(!("player" in ensembles));
});

test("shards are well-formed: composers resolve, originals before arrangements, ranked", async () => {
  for (const spec of [WIND_QUINTET, STRING_QUARTET, "orchestra"]) {
    const { works, composers } = await lineup(spec);
    const firstArr = works.findIndex((w) => w.arr);
    if (firstArr >= 0) assert.ok(works.slice(firstArr).every((w) => w.arr), `${spec}: an original after an arrangement`);
    const originals = works.filter((w) => !w.arr);
    for (let i = 1; i < originals.length; i++) {
      assert.ok(originals[i]!.score <= originals[i - 1]!.score, `${spec}: rank order broken at ${i}`);
    }
    for (const w of works) {
      if (w.composer) assert.ok(composers[w.composer], `${spec}: unknown composer ${w.composer}`);
      assert.ok(w.via.length > 0, `${spec}: ${w.id} has no instrumentation source`);
    }
  }
});

test("every source contributes to the big line-ups", async () => {
  const { works } = await lineup(STRING_QUARTET);
  const has = (f: (w: Work) => boolean, what: string) => assert.ok(works.some(f), `no string quartet ${what}`);
  has((w) => !!w.imslp, "linked to IMSLP");
  has((w) => !!w.wikipedia, "with a Wikipedia article");
  has((w) => !!w.wikidata, "linked to Wikidata");
  has((w) => w.openopus !== undefined, "matched in Open Opus");
  has((w) => (w.recordings ?? 0) > 0, "with MusicBrainz recording counts");
  has((w) => !w.imslp, "from outside IMSLP");
});

test("downloads for the deployed dataset exist", async () => {
  for (const file of Object.values(EXPORT_FILES)) {
    const res = await get(`${DATASETS_URL}/${meta.version}/${file}`, { method: "HEAD" });
    assert.ok(Number(res.headers.get("content-length")) > 1_000_000, `${file} is suspiciously small`);
  }
  const latest = await json<{ version: string }>(`${DATASETS_URL}/latest.json?t=${Date.now()}`);
  if (latest.version !== meta.version) console.log(`# note: deployed ${meta.version}, latest published is ${latest.version}`);
});

// Known gap: non-IMSLP works that look like an IMSLP work but weren't matched, usually
// because it was ambiguous. Reported, not failed.
test("no duplicates from unmatched sources", { todo: "ambiguous matches are left unmatched" }, async (t) => {
  const { works, composers } = await lineup(STRING_QUARTET);
  const imslp = works.filter((w) => w.imslp);
  const sameKey = (a: string, b: string) => !musicalKey(a) || !musicalKey(b) || musicalKey(a) === musicalKey(b);
  const dupes = works.filter(
    (w) => !w.imslp && imslp.some((i) => i.composer === w.composer && bareTitle(i.title) === bareTitle(w.title) && sameKey(i.title, w.title)),
  );
  for (const d of dupes) t.diagnostic(`${composers[d.composer ?? ""]?.name}: "${d.title}" (${d.id})`);
  assert.equal(dupes.length, 0);
});
