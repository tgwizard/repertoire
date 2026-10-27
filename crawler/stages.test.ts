import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceId } from "../src/shared/data.ts";
import { releaseProblems, SOURCE_MAX_AGE_DAYS, type StageManifest, type StageStatus } from "./stages.ts";

const NOW = Date.parse("2026-11-01T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const ok = (over: Partial<StageStatus> = {}): StageStatus => ({ attemptedAt: daysAgo(1), completedAt: daysAgo(1), error: null, failed: 0, of: 100, stale: 0, ...over });
const SOURCES = Object.keys(SOURCE_MAX_AGE_DAYS) as SourceId[];
const fresh = () => ({ builtAt: daysAgo(0), sources: Object.fromEntries(SOURCES.map((s) => [s, { fetchedAt: daysAgo(1) }])) as never });
const allOk = (): StageManifest => Object.fromEntries([...SOURCES.filter((s) => s !== "imslp"), "imslp", "imslp-pages", "composers"].map((s) => [s, ok()]));

test("a clean, fresh refresh has no problems", () => {
  assert.deepEqual(releaseProblems(fresh(), allOk(), NOW), []);
});

test("a failed stage is reported, though its last completed results are still there", () => {
  const stages = allOk();
  stages.libris = ok({ attemptedAt: daysAgo(0), completedAt: daysAgo(20), error: "503 Service Unavailable" });
  assert.deepEqual(releaseProblems(fresh(), stages, NOW), [`libris: last run (${daysAgo(0)}) failed: 503 Service Unavailable; using the run of ${daysAgo(20)}`]);
  delete stages.libris;
  assert.deepEqual(releaseProblems(fresh(), stages, NOW), ["libris: never completed"]);
});

test("a few failed requests are fine; many, or a partial run, aren't", () => {
  const stages = allOk();
  stages.imslp = ok({ failed: 3, of: 11000 });
  assert.deepEqual(releaseProblems(fresh(), stages, NOW), []);
  stages.imslp = ok({ failed: 200, of: 11000 });
  assert.match(releaseProblems(fresh(), stages, NOW)[0]!, /imslp: 200 of 11000 requests failed/);
  stages.imslp = ok({ partial: true });
  assert.deepEqual(releaseProblems(fresh(), stages, NOW), ["imslp: a partial run (--min-works)"]);
});

test("refreshes that failed onto stale cache count as failures", () => {
  const stages = allOk();
  stages.imslp = ok({ stale: 5000, of: 11000 });
  assert.deepEqual(releaseProblems(fresh(), stages, NOW), ["imslp: 5000 refreshes failed, stale cache used instead"]);
});

test("each source has its own freshness limit: a monthly dump may be older than a weekly query", () => {
  const meta = fresh();
  (meta.sources as any).gnd.fetchedAt = daysAgo(80); // a 60-day dump, within 90
  (meta.sources as any).wikidata.fetchedAt = daysAgo(25); // over 21
  assert.deepEqual(releaseProblems(meta, allOk(), NOW), [`wikidata: data from ${daysAgo(25)}, older than 21 days`]);
});
