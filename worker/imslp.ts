// Thin client for IMSLP's MediaWiki API (MediaWiki 1.18: old-style "query-continue" paging).

import { ERAS, type Era, type InstrumentationsResponse, type Work, type WorksResponse } from "../src/shared/api";

const API = "https://imslp.org/api.php";
const USER_AGENT = "RepertoireFinder/0.1 (+https://repertoire.tgwizard.com; https://github.com/tgwizard/repertoire)";

// MediaWiki forbids these in titles; anything else is passed through as a category name.
const ILLEGAL_TITLE_CHARS = /[#<>[\]|{}\u0000-\u001f]/;

export class UpstreamError extends Error {}

async function mw(params: Record<string, string>): Promise<any> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: "json" })) url.searchParams.set(k, v);

  // IMSLP occasionally drops connections or returns 5xx; retry those with backoff.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status >= 500) throw new UpstreamError(`IMSLP responded ${res.status}`);
      if (!res.ok) throw Object.assign(new UpstreamError(`IMSLP responded ${res.status}`), { final: true });
      const data: any = await res.json();
      if (data.error) throw Object.assign(new UpstreamError(`IMSLP error: ${data.error.info ?? data.error.code}`), { final: true });
      return data;
    } catch (e) {
      if (attempt >= 2 || (e as { final?: boolean }).final) {
        throw e instanceof UpstreamError ? e : new UpstreamError((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 400 * 3 ** attempt));
    }
  }
}

export function isValidCategory(name: string): boolean {
  return name.startsWith("For ") && name.length <= 250 && !ILLEGAL_TITLE_CHARS.test(name);
}

/** All non-empty "For ..." instrumentation categories with their sizes (~25 requests). */
export async function fetchInstrumentations(): Promise<InstrumentationsResponse> {
  const categories: [string, number][] = [];
  let from: string | undefined;
  for (let i = 0; i < 45; i++) {
    const data = await mw({
      action: "query",
      list: "allcategories",
      acprefix: "For ",
      acmin: "1",
      aclimit: "500",
      acprop: "size",
      ...(from ? { acfrom: from } : {}),
    });
    for (const c of data.query.allcategories) {
      // Skip spam/garbage category names; real instrumentations are plain text.
      if (/^For [A-Za-z0-9 ,'()-]+$/.test(c["*"]) && c.pages > 0) categories.push([c["*"], c.pages]);
    }
    from = data["query-continue"]?.allcategories?.acfrom;
    if (!from) break;
  }
  return { fetchedAt: new Date().toISOString(), categories };
}

const ERA_CATEGORIES = ERAS.map((e) => `Category:${e}`);
const PEOPLE_ERA_CATEGORIES = ERAS.map((e) => `Category:People from the ${e} era`);

function eraFrom(categories: { title: string }[] | undefined, prefix: string, suffix: string): Era | null {
  for (const c of categories ?? []) {
    const name = c.title.slice(prefix.length, c.title.length - suffix.length);
    if ((ERAS as readonly string[]).includes(name)) return name as Era;
  }
  return null;
}

/** One page (up to 500) of works in a category, with their era tag. */
export async function fetchWorks(category: string, from: string | null): Promise<WorksResponse> {
  const data = await mw({
    action: "query",
    generator: "categorymembers",
    gcmtitle: `Category:${category}`,
    gcmnamespace: "0",
    gcmlimit: "500",
    ...(from ? { gcmcontinue: from } : {}),
    prop: "categories",
    cllimit: "max",
    // Must filter: unfiltered prop=categories silently truncates at 500 in total.
    clcategories: ERA_CATEGORIES.join("|"),
  });
  const works: Work[] = Object.values<any>(data.query?.pages ?? {}).map((p) => {
    const m = /^(.*) \(([^()]+)\)$/.exec(p.title);
    return {
      pageid: p.pageid,
      title: p.title,
      work: m ? m[1]! : p.title,
      composer: m ? m[2]! : null,
      era: eraFrom(p.categories, "Category:", ""),
    };
  });
  return { works, next: data["query-continue"]?.categorymembers?.gcmcontinue ?? null };
}

/** Era for each composer, from "People from the X era" on their category page. */
export async function fetchComposerEras(names: string[]): Promise<Record<string, Era | null>> {
  const out: Record<string, Era | null> = {};
  const batches: string[][] = [];
  for (let i = 0; i < names.length; i += 50) batches.push(names.slice(i, i + 50));

  await mapLimit(batches, 4, async (batch) => {
    const data = await mw({
      action: "query",
      titles: batch.map((n) => `Category:${n}`).join("|"),
      prop: "categories",
      cllimit: "max",
      clcategories: PEOPLE_ERA_CATEGORIES.join("|"),
    });
    // MediaWiki may normalize titles (e.g. first letter); map them back.
    const denormalize = new Map<string, string>();
    for (const n of data.query?.normalized ?? []) denormalize.set(n.to, n.from);
    for (const p of Object.values<any>(data.query?.pages ?? {})) {
      const title: string = denormalize.get(p.title) ?? p.title;
      out[title.slice("Category:".length)] = eraFrom(p.categories, "Category:People from the ", " era");
    }
  });
  for (const n of names) out[n] ??= null;
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}
