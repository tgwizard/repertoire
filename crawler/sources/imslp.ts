// IMSLP (MediaWiki 1.18): instrumentation categories, their works, composer eras.

import { parseCategory } from "../../src/lib/instrumentation.ts";
import { ERAS, type Era } from "../../src/shared/data.ts";
import { cached, DAY, fetchJson, jitteredMaxAge, progress, readStage, writeStage } from "../http.ts";
import type { StageReport } from "../stages.ts";

const API = "https://imslp.org/api.php";

async function mw(params: Record<string, string | undefined>): Promise<any> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: "json" })) if (v !== undefined) url.searchParams.set(k, v);
  const data: any = await fetchJson(url.toString());
  if (data.error) throw new Error(`IMSLP error: ${data.error.info ?? data.error.code}`);
  return data;
}

export interface ImslpWork {
  pageid: number;
  title: string;
  era: Era | null;
  /** In "Pages with commercial recordings" */
  recorded: boolean;
  /** In "Recordings" (audio hosted on IMSLP) */
  audio: boolean;
}

export interface ImslpStage {
  fetchedAt: number;
  /** Instrumentation categories crawled: [name, size] */
  categories: [string, number][];
  /** category name → pageids */
  members: Record<string, number[]>;
  works: Record<number, ImslpWork>;
}

export interface ComposerErasStage {
  eras: Record<string, { era: Era | null; at: number }>;
}

const RECORDED = "Pages with commercial recordings";
const AUDIO = "Recordings";
const WORK_CATEGORIES = [...ERAS, RECORDED, AUDIO].map((c) => `Category:${c}`);

async function fetchAllCategories(): Promise<[string, number][]> {
  const out: [string, number][] = [];
  let from: string | undefined;
  do {
    const data = await mw({ action: "query", list: "allcategories", acprefix: "For ", acmin: "1", aclimit: "500", acprop: "size", acfrom: from });
    for (const c of data.query.allcategories) if (c.pages > 0) out.push([c["*"], c.pages]);
    from = data["query-continue"]?.allcategories?.acfrom;
  } while (from);
  return out;
}

/** All works in one category, with the era/recording categories we care about. */
export async function fetchCategoryWorks(category: string): Promise<ImslpWork[]> {
  const works = new Map<number, ImslpWork>();
  let gcmcontinue: string | undefined;
  do {
    // MediaWiki 1.18 continues prop=categories (clcontinue) within a generator batch
    // before moving the generator on (gcmcontinue).
    let clcontinue: string | undefined;
    let next: string | undefined;
    do {
      const data = await mw({
        action: "query",
        generator: "categorymembers",
        gcmtitle: `Category:${category}`,
        gcmnamespace: "0",
        gcmlimit: "500",
        gcmcontinue,
        prop: "categories",
        cllimit: "max",
        clcategories: WORK_CATEGORIES.join("|"),
        clcontinue,
      });
      for (const p of Object.values<any>(data.query?.pages ?? {})) {
        let w = works.get(p.pageid);
        if (!w) works.set(p.pageid, (w = { pageid: p.pageid, title: p.title, era: null, recorded: false, audio: false }));
        for (const c of p.categories ?? []) {
          const name: string = c.title.slice("Category:".length);
          if (name === RECORDED) w.recorded = true;
          else if (name === AUDIO) w.audio = true;
          else if ((ERAS as readonly string[]).includes(name)) w.era = name as Era;
        }
      }
      clcontinue = data["query-continue"]?.categories?.clcontinue;
      next = data["query-continue"]?.categorymembers?.gcmcontinue ?? next;
    } while (clcontinue);
    gcmcontinue = next;
  } while (gcmcontinue);
  return [...works.values()];
}

export async function crawlImslp(opts: { minWorks: number }): Promise<StageReport> {
  console.log("IMSLP: instrumentation categories");
  const all = await cached("imslp:allcategories:v1", DAY, fetchAllCategories);
  const categories = all.value
    .filter(([name, size]) => size >= opts.minWorks && parseCategory(name))
    .sort((a, b) => b[1] - a[1]);
  console.log(`  ${all.value.length} categories, ${categories.length} instrumentation categories with ≥${opts.minWorks} works`);

  const prev = await readStage<ImslpStage>("imslp");
  const stage: ImslpStage = { fetchedAt: all.fetchedAt, categories, members: {}, works: {} };
  const tick = progress("IMSLP categories", categories.length);
  let fetched = 0;
  let failed = 0;
  for (const [i, [name, size]] of categories.entries()) {
    try {
      // The size is part of the key: a category is re-crawled when it changes, or
      // after 30–90 days (staggered per category) to catch same-size edits.
      const res = await cached(`imslp:category:v1:${name}:${size}`, jitteredMaxAge(name, 30, 90), () => fetchCategoryWorks(name));
      if (!res.fromCache) fetched++;
      stage.members[name] = res.value.map((w) => w.pageid);
      for (const w of res.value) stage.works[w.pageid] = w;
    } catch (e) {
      failed++;
      console.warn(`  ✗ ${name}: ${(e as Error).message}`);
      // Keep what the previous run had for this category.
      const old = prev?.members[name];
      if (old) {
        stage.members[name] = old;
        for (const id of old) if (prev.works[id]) stage.works[id] = prev.works[id];
      }
    }
    tick(i + 1, `${fetched} fetched, ${failed} failed`);
  }
  // Written once complete, never as a checkpoint: a stage file is always a whole
  // catalogue (an interrupted run resumes from the HTTP cache instead)
  await writeStage("imslp", stage);
  console.log(`  ${Object.keys(stage.works).length} works in ${categories.length} categories (${fetched} fetched, ${failed} failed)`);
  return { failed, of: categories.length };
}

/** Era ("People from the X era") for each composer name, refreshed every 150–210 days (staggered). */
export async function crawlComposerEras(names: string[]): Promise<void> {
  const stage = (await readStage<ComposerErasStage>("imslp-composer-eras")) ?? { eras: {} };
  const todo = names.filter((n) => {
    const e = stage.eras[n];
    return !e || Date.now() - e.at > jitteredMaxAge(n, 150, 210);
  });
  console.log(`IMSLP: composer eras for ${todo.length} of ${names.length} composers`);
  const tick = progress("IMSLP composer batches", Math.ceil(todo.length / 50));
  const peopleCats = ERAS.map((e) => `Category:People from the ${e} era`);
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    try {
      const data = await mw({
        action: "query",
        titles: batch.map((n) => `Category:${n}`).join("|"),
        prop: "categories",
        cllimit: "max",
        clcategories: peopleCats.join("|"),
      });
      const denormalize = new Map<string, string>();
      for (const n of data.query?.normalized ?? []) denormalize.set(n.to, n.from);
      const now = Date.now();
      for (const n of batch) stage.eras[n] = { era: null, at: now };
      for (const p of Object.values<any>(data.query?.pages ?? {})) {
        const name = (denormalize.get(p.title) ?? p.title).slice("Category:".length);
        const cat: string | undefined = p.categories?.[0]?.title;
        const era = cat?.slice("Category:People from the ".length, -" era".length);
        stage.eras[name] = { era: (ERAS as readonly string[]).includes(era ?? "") ? (era as Era) : null, at: now };
      }
    } catch (e) {
      console.warn(`  ✗ composer batch: ${(e as Error).message}`);
    }
    if ((i / 50) % 20 === 19) await writeStage("imslp-composer-eras", stage); // checkpoint
    tick(Math.ceil(Math.min(todo.length, i + 50) / 50));
  }
  await writeStage("imslp-composer-eras", stage);
}

/**
 * Current titles for pages that may have been renamed (Wikidata often links an old
 * title). Follows normalization and redirects; titles that don't exist are left out.
 */
export async function resolveTitles(titles: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    try {
      const res = await cached(`imslp:resolve:v1:${batch.join("|")}`, 30 * DAY, () =>
        mw({ action: "query", titles: batch.join("|"), redirects: "1" }),
      );
      const data = res.value;
      const step = new Map<string, string>();
      for (const n of data.query?.normalized ?? []) step.set(n.from, n.to);
      for (const r of data.query?.redirects ?? []) step.set(r.from, r.to);
      const existing = new Set(Object.values<any>(data.query?.pages ?? {}).filter((p) => !("missing" in p)).map((p) => p.title as string));
      for (const t of batch) {
        let cur = t;
        for (let hops = 0; hops < 3 && step.has(cur); hops++) cur = step.get(cur)!;
        if (existing.has(cur)) out[t] = cur;
      }
    } catch (e) {
      console.warn(`  ✗ resolving IMSLP titles: ${(e as Error).message}`);
    }
  }
  return out;
}
