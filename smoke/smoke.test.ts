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
import { DATASETS_URL, EXPORT_FILES, type LatestFile, type Meta, type SearchResults } from "../src/shared/data.ts";

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

test("downloads for the deployed dataset exist", async () => {
  for (const file of Object.values(EXPORT_FILES)) {
    const res = await get(`${DATASETS_URL}/${meta.version}/${file}`, { method: "HEAD" });
    assert.ok(Number(res.headers.get("content-length")) > 1_000_000, `${file} is suspiciously small`);
  }
  const latest = await json<LatestFile>(`${DATASETS_URL}/latest.json?t=${Date.now()}`);
  if (latest.version !== meta.version) console.log(`# note: deployed ${meta.version}, latest published is ${latest.version}`);
});
