// What each crawl stage last did: when it last ran, when it last completed, and how
// (items, failures it worked around, stale cache it fell back on). A failed refresh
// keeps the last completed stage usable, but is recorded as one, so a release can't
// pass it off as fresh (checkRelease).

import { join } from "node:path";
import type { Meta, SourceId } from "../src/shared/data.ts";
import { CACHE_DIR, readJson, writeJsonAtomic } from "./http.ts";

export const MANIFEST_PATH = join(CACHE_DIR, "stages", "manifest.json");

export interface StageReport {
  /** Requests that failed, whose previous results were kept instead */
  failed?: number;
  /** Of how many */
  of?: number;
  /** Deliberately not everything (a quick test crawl) */
  partial?: boolean;
}

export interface StageStatus {
  attemptedAt: string;
  /** The last run that finished; null if none has */
  completedAt: string | null;
  /** Why the last run failed, if it did */
  error: string | null;
  failed: number;
  of: number | null;
  /** Cache entries past their lifetime used because the source didn't answer */
  stale: number;
  partial?: boolean;
}

export type StageManifest = Record<string, StageStatus>;

export const readManifest = async (): Promise<StageManifest> => (await readJson<StageManifest>(MANIFEST_PATH)) ?? {};

export async function recordStage(name: string, outcome: { report?: StageReport | void; error?: unknown; stale: number }, at: Date): Promise<StageStatus> {
  const manifest = await readManifest();
  const previous = manifest[name];
  const status: StageStatus = outcome.error
    ? { ...(previous ?? { completedAt: null, failed: 0, of: null }), attemptedAt: at.toISOString(), error: String((outcome.error as Error).message ?? outcome.error), stale: outcome.stale }
    : {
        attemptedAt: at.toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
        failed: outcome.report?.failed ?? 0,
        of: outcome.report?.of ?? null,
        stale: outcome.stale,
        ...(outcome.report?.partial && { partial: true }),
      };
  manifest[name] = status;
  await writeJsonAtomic(MANIFEST_PATH, manifest);
  return status;
}

/**
 * How old each source's data may be when released: about two refresh cycles of the way
 * it's fetched. A dump published monthly can't be as fresh as a weekly query.
 */
export const SOURCE_MAX_AGE_DAYS: Record<SourceId, number> = {
  imslp: 21, // the category list, fetched each run (the categories themselves over 30–90 days)
  wikipedia: 21, // queries cached a week; the oldest counts
  wikidata: 21,
  openopus: 30, // a dump, cached a week
  mutopia: 30,
  musicbrainz: 30, // counts trickle in, a budget per run
  libris: 60, // result pages cached 20–40 days; the oldest counts
  gnd: 90, // a dump, downloaded every 60 days
  dnb: 150, // searches by year: this year and last cached 7–14 days, older years 60–120
  k10plus: 150, // as DNB
  rism: 75, // exports, downloaded every 45 days
};

/** Crawl stages behind each source (others: their own name) */
const STAGES_OF: Partial<Record<SourceId, string[]>> = { imslp: ["imslp", "imslp-pages", "composers"] };

/**
 * Why a dataset shouldn't be published as a routine refresh: stages whose last run
 * failed or never completed, failures beyond a few, and sources older than their limit.
 * Empty when it's fine.
 */
export function releaseProblems(meta: Pick<Meta, "sources" | "builtAt">, stages: StageManifest, now = Date.now()): string[] {
  const problems: string[] = [];
  for (const [source, limit] of Object.entries(SOURCE_MAX_AGE_DAYS) as [SourceId, number][]) {
    const fetched = meta.sources[source]?.fetchedAt;
    const age = fetched ? (now - Date.parse(fetched)) / 86_400_000 : Infinity;
    if (age > limit) problems.push(`${source}: data from ${fetched ?? "never"}, older than ${limit} days`);
    for (const stage of STAGES_OF[source] ?? [source]) {
      const s = stages[stage];
      if (!s?.completedAt) problems.push(`${stage}: never completed`);
      else if (s.error) problems.push(`${stage}: last run (${s.attemptedAt}) failed: ${s.error}; using the run of ${s.completedAt}`);
      else if (s.partial) problems.push(`${stage}: a partial run (--min-works)`);
      else if (s.failed > Math.max(3, (s.of ?? 0) * 0.01)) problems.push(`${stage}: ${s.failed}${s.of ? ` of ${s.of}` : ""} requests failed (earlier results kept)`);
      // A refresh that failed and fell back on stale cache is a failed refresh too
      else if (s.stale > Math.max(3, (s.of ?? 0) * 0.01)) problems.push(`${stage}: ${s.stale} refreshes failed, stale cache used instead`);
    }
  }
  return problems;
}
