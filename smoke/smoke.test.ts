// Smoke tests for a deployed site: it serves the app, its API, server-rendered pages
// and fresh data, and the published downloads exist. `npm run smoke` runs these
// together with the repertoire checks (test/data/repertoire.test.ts) against the
// same site. Plain HTTP, no credentials.
//
//   npm run smoke                                      production
//   SMOKE_URL=http://localhost:5173 npm run smoke      local dev server
//   SMOKE_MAX_AGE_DAYS=30 npm run smoke                allow an older dataset

import assert from "node:assert/strict";
import { test } from "node:test";
import { DATASETS_URL, EXPORT_FILES, type LatestFile, type Meta, type SearchResults, type SourceId } from "../src/shared/data.ts";
import type { Manifest } from "../crawler/publish-downloads.ts";
import { SOURCE_MAX_AGE_DAYS } from "../crawler/stages.ts";

const BASE = (process.env.SMOKE_URL ?? process.env.DATA_URL ?? "https://repertoire.tgwizard.com").replace(/\/$/, "");
const MAX_AGE_DAYS = Number(process.env.SMOKE_MAX_AGE_DAYS ?? 21);

async function get(path: string, init?: RequestInit, status = 200): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(30_000) });
  assert.equal(res.status, status, `${init?.method ?? "GET"} ${url} → ${res.status}`);
  return res;
}
const json = async <T>(path: string) => (await (await get(path)).json()) as T;

const meta = await json<Meta>("/api/meta");
console.log(`# ${BASE}: dataset ${meta.version}, ${meta.works} works, ${meta.lineups} line-ups`);

test("serves the app on every client-side route", async () => {
  for (const path of ["/", "/?i=violin:2,viola,cello", "/about", "/search?q=brahms", "/some/deep/link"]) {
    const html = await (await get(path)).text();
    assert.match(html, /<div id="root">/, `${path} doesn't look like the app`);
  }
});

test("dataset is fresh and complete", () => {
  const ageDays = (Date.now() - Date.parse(meta.builtAt)) / 86_400_000;
  assert.ok(ageDays <= MAX_AGE_DAYS, `dataset built ${ageDays.toFixed(1)} days ago (max ${MAX_AGE_DAYS})`);
  assert.ok(meta.works > 200_000, `only ${meta.works} works`);
  assert.ok(meta.lineups > 5_000, `only ${meta.lineups} line-ups`);
  assert.ok(meta.sources.imslp.items > 200_000, "IMSLP looks truncated");
  assert.ok(meta.sources.wikidata.items > 5_000, "Wikidata looks truncated");
  assert.ok(meta.sources.wikipedia.items > 1_000, "Wikipedia looks truncated");
  assert.ok(meta.sources.openopus.items > 10_000, "Open Opus looks truncated");
  // A rebuild of old data has a fresh builtAt: each source's own date says how old it is
  const stale = (Object.entries(SOURCE_MAX_AGE_DAYS) as [SourceId, number][])
    .map(([s, limit]) => [s, (Date.now() - Date.parse(meta.sources[s].fetchedAt ?? "1970")) / 86_400_000, limit] as const)
    .filter(([, age, limit]) => age > limit + (MAX_AGE_DAYS - 21)) // SMOKE_MAX_AGE_DAYS loosens these as much
    .map(([s, age, limit]) => `${s} ${age.toFixed(0)} days (max ${limit})`);
  assert.deepEqual(stale, [], "sources older than they should be");
});

test("work pages are rendered on the server, and old ids redirect", async () => {
  const { works } = await json<SearchResults>("/api/search?q=nielsen%20wind%20quintet&limit=1");
  const html = await (await get(`/work/${works[0]!.id}`)).text();
  assert.match(html, /<title>Wind Quintet, Op\.43 – Carl Nielsen · Repertoire Finder<\/title>/);
  assert.match(html, /"@type":"MusicComposition"/);
  await get("/work/zzzzzzzz", undefined, 404);
});

test("the API answers, with caching and CORS headers", async () => {
  const res = await get("/api/lineups");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("cache-control") ?? "", /max-age=\d+/);
  const { version } = (await res.json()) as { version: string };
  assert.equal(version, meta.version);
});

test("downloads for the deployed dataset exist, complete and as their manifest says", async () => {
  for (const file of Object.values(EXPORT_FILES)) {
    const res = await get(`${DATASETS_URL}/${meta.version}/${file}`, { method: "HEAD" });
    assert.ok(Number(res.headers.get("content-length")) > 1_000_000, `${file} is suspiciously small`);
  }
  // Versions published since manifests (crawler/publish-downloads.ts) have one, written last
  const res = await fetch(`${DATASETS_URL}/${meta.version}/manifest.json?t=${Date.now()}`);
  if (res.status === 404 && meta.builtAt < "2026-10-28") {
    console.log(`# note: ${meta.version} was published before manifests`);
  } else {
    assert.equal(res.status, 200, "no manifest: the version's upload never completed");
    const manifest = (await res.json()) as Manifest;
    for (const [name, f] of Object.entries(manifest.files)) {
      const head = await get(`${DATASETS_URL}/${meta.version}/${name}?t=${Date.now()}`, { method: "HEAD", headers: { "Accept-Encoding": "identity" } });
      assert.equal(Number(head.headers.get("content-length")), f.bytes, name);
      assert.equal(head.headers.get("etag")?.replace(/"/g, ""), f.md5, name);
    }
  }
  const latest = await json<LatestFile>(`${DATASETS_URL}/latest.json?t=${Date.now()}`);
  if (latest.version !== meta.version) console.log(`# note: deployed ${meta.version}, latest published is ${latest.version}`);
});
