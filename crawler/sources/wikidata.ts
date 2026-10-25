// Wikidata (SPARQL): the hub that links IMSLP, Wikipedia and MusicBrainz, plus dates.

import { WIKIDATA_ENSEMBLES } from "../ensembles.ts";
import { cached, DAY, fetchJson, readStage, writeStage } from "../http.ts";
import { resolveTitles, type ImslpStage } from "./imslp.ts";
import type { WikipediaStage } from "./wikipedia.ts";

const ENDPOINT = "https://query.wikidata.org/sparql";

type Row = Record<string, string | undefined>;

async function sparql(query: string): Promise<Row[]> {
  const data = await fetchJson<{ results: { bindings: Record<string, { value: string }>[] } }>(ENDPOINT, {
    form: { query },
    accept: "application/sparql-results+json",
  });
  return data.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

const qid = (uri: string | undefined) => uri?.slice(uri.lastIndexOf("/") + 1);
const year = (v: string | undefined) => {
  const m = v ? /^(-?\d{1,4})-/.exec(v) : null;
  return m ? Number(m[1]) : undefined;
};
const wpTitle = (url: string | undefined) => (url ? decodeURIComponent(url.slice("https://en.wikipedia.org/wiki/".length)) : undefined);
const imslpName = (id: string) => id.replace(/^Category:/, "").replaceAll("_", " ");

export interface WdComposer {
  qid: string;
  imslp?: string;
  label?: string;
  born?: number;
  died?: number;
  wikipedia?: string;
  sitelinks: number;
}

export interface WdWork {
  qid: string;
  /** IMSLP page title */
  imslp?: string;
  label?: string;
  composer?: string; // composer QID
  year?: number;
  musicbrainz?: string;
  wikipedia?: string;
  sitelinks: number;
  /** Ensemble items (WIKIDATA_ENSEMBLES keys) this work is tagged with */
  ensembles: string[];
  /** All instrumentation (P870) items, for works tagged with an ensemble */
  instruments: string[];
}

export interface WikidataStage {
  fetchedAt: number;
  composers: Record<string, WdComposer>; // by QID
  works: Record<string, WdWork>; // by QID
}

function mergeWork(map: Record<string, WdWork>, r: Row) {
  const id = qid(r.w)!;
  const w = (map[id] ??= { qid: id, sitelinks: 0, ensembles: [], instruments: [] });
  if (r.imslp) w.imslp ??= imslpName(r.imslp);
  if (r.label) w.label ??= r.label;
  if (r.composer) w.composer ??= qid(r.composer);
  const y = year(r.inception) ?? year(r.published);
  if (y !== undefined && (w.year === undefined || y < w.year)) w.year = y;
  if (r.mb) w.musicbrainz ??= r.mb;
  if (r.wp) w.wikipedia ??= wpTitle(r.wp);
  if (r.sl) w.sitelinks = Math.max(w.sitelinks, Number(r.sl));
  const g = qid(r.g);
  if (g && WIKIDATA_ENSEMBLES[g] && !w.ensembles.includes(g)) w.ensembles.push(g);
  const inst = qid(r.inst);
  if (inst && !w.instruments.includes(inst)) w.instruments.push(inst);
}

/** A date property, only if precise to the year at least and not deprecated ("16th century" isn't 1501). */
const date = (subject: string, prop: string, v: string) =>
  `OPTIONAL { ${subject} p:${prop} [ psv:${prop} [ wikibase:timeValue ?${v} ; wikibase:timePrecision ?${v}P ] ; wikibase:rank ?${v}R ]
    FILTER(?${v}P >= 9 && ?${v}R != wikibase:DeprecatedRank) }`;

const WORK_FIELDS = `
  OPTIONAL { ?w wdt:P839 ?imslp }
  OPTIONAL { ?w rdfs:label ?label FILTER(lang(?label) = "en") }
  OPTIONAL { ?w wdt:P86 ?composer }
  ${date("?w", "P571", "inception")}
  ${date("?w", "P577", "published")}
  OPTIONAL { ?w wdt:P435 ?mb }
  OPTIONAL { ?w wikibase:sitelinks ?sl }
  OPTIONAL { ?wp schema:about ?w ; schema:isPartOf <https://en.wikipedia.org/> }`;

export async function crawlWikidata(): Promise<void> {
  console.log("Wikidata: composers with IMSLP ids");
  const composers = await cached("wikidata:composers:v2", 7 * DAY, () =>
    sparql(`SELECT ?p ?imslp ?label ?born ?died ?sl ?wp WHERE {
      ?p wdt:P839 ?imslp FILTER(STRSTARTS(?imslp, "Category:")) . ?p wdt:P31 wd:Q5 .
      OPTIONAL { ?p rdfs:label ?label FILTER(lang(?label) = "en") }
      ${date("?p", "P569", "born")} ${date("?p", "P570", "died")}
      OPTIONAL { ?p wikibase:sitelinks ?sl }
      OPTIONAL { ?wp schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> } }`),
  );

  console.log("Wikidata: works with IMSLP ids");
  const imslpWorks = await cached("wikidata:imslp-works:v2", 7 * DAY, () =>
    sparql(`SELECT ?w ?imslp ?label ?composer ?inception ?published ?mb ?sl ?wp WHERE {
      ?w wdt:P839 ?imslp FILTER(!STRSTARTS(?imslp, "Category:")) . ${WORK_FIELDS} }`),
  );

  console.log("Wikidata: works tagged with an ensemble");
  const values = Object.keys(WIKIDATA_ENSEMBLES).map((q) => `wd:${q}`).join(" ");
  const ensembleWorks = await cached("wikidata:ensemble-works:v3", 7 * DAY, () =>
    sparql(`SELECT ?w ?g ?inst ?imslp ?label ?composer ?inception ?published ?mb ?sl ?wp WHERE {
      VALUES ?g { ${values} } ?w wdt:P870|wdt:P136|wdt:P31 ?g . ?w wdt:P86 [] .
      OPTIONAL { ?w wdt:P870 ?inst } ${WORK_FIELDS} }`),
  );

  const works: Record<string, WdWork> = {};
  for (const r of [...imslpWorks.value, ...ensembleWorks.value]) mergeWork(works, r);

  // Details for Wikipedia-category articles we don't have yet.
  const wiki = await readStage<WikipediaStage>("wikipedia");
  const missing = [...new Set(Object.values(wiki?.members ?? {}).flat().map((a) => a.qid))].filter(
    (q): q is string => !!q && !works[q],
  );
  console.log(`Wikidata: details for ${missing.length} Wikipedia-listed works`);
  let oldest = Math.min(composers.fetchedAt, imslpWorks.fetchedAt, ensembleWorks.fetchedAt);
  for (let i = 0; i < missing.length; i += 200) {
    const batch = missing.slice(i, i + 200).sort();
    const res = await cached(`wikidata:works-by-qid:v2:${batch.join(",")}`, 7 * DAY, () =>
      sparql(`SELECT ?w ?imslp ?label ?composer ?inception ?published ?mb ?sl ?wp WHERE {
        VALUES ?w { ${batch.map((q) => `wd:${q}`).join(" ")} } ${WORK_FIELDS} }`),
    );
    oldest = Math.min(oldest, res.fetchedAt);
    for (const r of res.value) mergeWork(works, r);
  }

  // Composers of works found above that lack an IMSLP id.
  const composerMap: Record<string, WdComposer> = {};
  const addComposer = (r: Row) => {
    const id = qid(r.p)!;
    const c = (composerMap[id] ??= { qid: id, sitelinks: 0 });
    if (r.imslp) c.imslp ??= imslpName(r.imslp);
    if (r.label) c.label ??= r.label;
    const born = year(r.born);
    const died = year(r.died);
    if (born !== undefined && (c.born === undefined || born < c.born)) c.born = born;
    if (died !== undefined && (c.died === undefined || died > c.died)) c.died = died;
    if (r.wp) c.wikipedia ??= wpTitle(r.wp);
    if (r.sl) c.sitelinks = Math.max(c.sitelinks, Number(r.sl));
  };
  for (const r of composers.value) addComposer(r);
  const otherComposers = [...new Set(Object.values(works).map((w) => w.composer))].filter((q): q is string => !!q && !composerMap[q]);
  console.log(`Wikidata: details for ${otherComposers.length} more composers`);
  for (let i = 0; i < otherComposers.length; i += 200) {
    const batch = otherComposers.slice(i, i + 200).sort();
    const res = await cached(`wikidata:composers-by-qid:v2:${batch.join(",")}`, 7 * DAY, () =>
      sparql(`SELECT ?p ?imslp ?label ?born ?died ?sl ?wp WHERE {
        VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
        OPTIONAL { ?p wdt:P839 ?imslp } OPTIONAL { ?p rdfs:label ?label FILTER(lang(?label) = "en") }
        ${date("?p", "P569", "born")} ${date("?p", "P570", "died")} OPTIONAL { ?p wikibase:sitelinks ?sl }
        OPTIONAL { ?wp schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> } }`),
    );
    for (const r of res.value) addComposer(r);
  }

  // Wikidata often links an old IMSLP page title: follow IMSLP's redirects.
  const imslp = await readStage<ImslpStage>("imslp");
  if (imslp) {
    const current = new Set(Object.values(imslp.works).map((w) => w.title));
    const stale = [...new Set(Object.values(works).map((w) => w.imslp))].filter((t): t is string => !!t && !current.has(t));
    console.log(`Wikidata: resolving ${stale.length} IMSLP links to pages not crawled under that title`);
    const resolved = await resolveTitles(stale);
    for (const w of Object.values(works)) if (w.imslp && resolved[w.imslp]) w.imslp = resolved[w.imslp];
    const fixed = Object.values(works).filter((w) => w.imslp && current.has(w.imslp)).length;
    console.log(`  ${Object.keys(resolved).length} renamed pages resolved; ${fixed} works now link to a crawled IMSLP page`);
  }

  const stage: WikidataStage = { fetchedAt: oldest, composers: composerMap, works };
  console.log(`  ${Object.keys(composerMap).length} composers, ${Object.keys(works).length} works`);
  await writeStage("wikidata", stage);
}
