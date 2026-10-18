// Composer life dates and Wikipedia links from Wikidata, joined on the IMSLP ID
// property (P839, e.g. "Category:Reicha,_Anton"). The query service allows CORS,
// so this goes straight from the browser.

export interface ComposerInfo {
  born: number | null;
  died: number | null;
  wikipedia: string | null;
}

const ENDPOINT = "https://query.wikidata.org/sparql";
const BATCH = 150;
const cache = new Map<string, ComposerInfo | null>();

const imslpId = (name: string) => `Category:${name.replaceAll(" ", "_")}`;
const sparqlString = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

function year(value: string | undefined): number | null {
  const m = value ? /^(-?\d+)-/.exec(value) : null;
  return m ? Number(m[1]) : null;
}

async function queryBatch(names: string[], signal?: AbortSignal): Promise<void> {
  const byId = new Map(names.map((n) => [imslpId(n), n]));
  const query = `
    SELECT ?id ?born ?died ?article WHERE {
      VALUES ?id { ${[...byId.keys()].map(sparqlString).join(" ")} }
      ?p wdt:P839 ?id .
      OPTIONAL { ?p wdt:P569 ?born }
      OPTIONAL { ?p wdt:P570 ?died }
      OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
    }`;
  // A form-encoded POST is a CORS "simple request": no preflight.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }),
    signal,
  });
  if (!res.ok) throw new Error(`Wikidata responded ${res.status}`);
  const data = (await res.json()) as { results: { bindings: Record<string, { value: string } | undefined>[] } };

  for (const n of names) cache.set(n, null);
  for (const b of data.results.bindings) {
    const name = byId.get(b.id!.value);
    if (!name || cache.get(name)) continue; // first row wins when there are several dates
    cache.set(name, { born: year(b.born?.value), died: year(b.died?.value), wikipedia: b.article?.value ?? null });
  }
}

export async function getComposerInfo(names: string[], signal?: AbortSignal): Promise<Record<string, ComposerInfo>> {
  const missing = names.filter((n) => !cache.has(n));
  for (let i = 0; i < missing.length; i += BATCH) await queryBatch(missing.slice(i, i + BATCH), signal);
  const out: Record<string, ComposerInfo> = {};
  for (const n of names) {
    const info = cache.get(n);
    if (info) out[n] = info;
  }
  return out;
}
