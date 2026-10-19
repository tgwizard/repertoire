// English Wikipedia "Compositions for …" categories → (category, article, Wikidata QID).

import { WIKIPEDIA_CATEGORIES } from "../ensembles.ts";
import { cached, DAY, fetchJson, writeStage } from "../http.ts";

const API = "https://en.wikipedia.org/w/api.php";

export interface WikipediaStage {
  fetchedAt: number;
  /** category → articles (with QID) */
  members: Record<string, { title: string; qid: string | null }[]>;
}

async function wp(params: Record<string, string | undefined>): Promise<any> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: "json", formatversion: "2" })) if (v !== undefined) url.searchParams.set(k, v);
  return fetchJson(url.toString());
}

async function categoryArticles(category: string): Promise<{ title: string; qid: string | null }[]> {
  const out: { title: string; qid: string | null }[] = [];
  let cont: Record<string, string> = {};
  do {
    const data = await wp({
      action: "query",
      generator: "categorymembers",
      gcmtitle: `Category:${category}`,
      gcmnamespace: "0",
      gcmlimit: "500",
      prop: "pageprops",
      ppprop: "wikibase_item",
      ...cont,
    });
    for (const p of data.query?.pages ?? []) out.push({ title: p.title, qid: p.pageprops?.wikibase_item ?? null });
    cont = data.continue ?? {};
  } while (Object.keys(cont).length);
  return out;
}

async function subcategories(category: string): Promise<string[]> {
  const data = await wp({ action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmtype: "subcat", cmlimit: "500" });
  return (data.query?.categorymembers ?? []).map((m: { title: string }) => m.title.slice("Category:".length));
}

export async function crawlWikipedia(): Promise<void> {
  const cats = Object.keys(WIKIPEDIA_CATEGORIES);
  console.log(`Wikipedia: ${cats.length} categories`);
  const stage: WikipediaStage = { fetchedAt: Date.now(), members: {} };
  for (const cat of cats) {
    const res = await cached(`wikipedia:category:v1:${cat}`, 7 * DAY, async () => {
      const articles = await categoryArticles(cat);
      // Descend one level into "String quartets by Beethoven"-style subcategories, but not
      // into other "Compositions for …" categories, which mean a different line-up.
      for (const sub of await subcategories(cat)) {
        if (sub.startsWith("Compositions for") || sub.startsWith("Lists of")) continue;
        articles.push(...(await categoryArticles(sub)));
      }
      return articles;
    });
    stage.members[cat] = res.value;
    stage.fetchedAt = Math.min(stage.fetchedAt, res.fetchedAt);
  }
  const n = Object.values(stage.members).reduce((s, m) => s + m.length, 0);
  console.log(`  ${n} articles`);
  await writeStage("wikipedia", stage);
}
