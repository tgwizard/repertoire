// RISM: the International Inventory of Musical Sources (CC BY 3.0). 1.6 million
// manuscripts and early prints, each with the libraries that hold it. We use it to show
// where copies of works we have are kept, and how widely a work was copied, which says
// how established it was before recordings.
//
// RISM exports everything monthly as MARC XML. Composers are RISM people, whose records
// carry GND and Wikidata ids: that's how they bridge to ours.

import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { CACHE_DIR, DAY, USER_AGENT, writeStage } from "../http.ts";

const EXPORTS = "https://rism.digital/exports";
const MAX_AGE = 45 * DAY;

export interface RismHolding {
  siglum: string;
  shelf: string | null;
}

export interface RismSource {
  /** "sources/51660" → 51660 */
  id: string;
  /** RISM person id of the composer */
  person: string;
  /** Uniform title: "Quartets", "Lascia pur ch'io vada a morte" */
  title: string;
  /** "vl (2), vla, b" */
  medium: string | null;
  /** Opus and other numbers in the uniform title */
  numbers: string | null;
  /** RISM key: "B|b" (B-flat major), "e" (E minor) */
  key: string | null;
  /** Only excerpts of the work */
  excerpt: boolean;
  /** Thematic catalogue references: "Köchel 6: 581", "Hoboken: III:75" */
  catalogue: { name: string; number: string }[];
  /** "Autograph manuscript", "Manuscript copy", "Print" */
  type: string | null;
  /** Its parts, instrument and count (MARC 594): [["vl", 2], ["ob", 2], ["cor", 2]] */
  scoring?: [string, number][];
  holdings: RismHolding[];
}

export interface RismPerson {
  gnd: string | null;
  wikidata: string | null;
}

export interface RismStage {
  fetchedAt: number;
  sources: RismSource[];
  /** Library names by RISM siglum ("US-Bp" → "Boston Public Library, Music Department") */
  libraries: Record<string, string>;
  /** Composers of those sources: RISM person id → ids elsewhere */
  people: Record<string, RismPerson>;
}

export const rismUrl = (id: string) => `https://rism.online/sources/${id}`;

/** Downloads a RISM export unless the copy on disk is recent. */
async function download(name: string): Promise<{ path: string; at: number }> {
  const path = join(CACHE_DIR, "raw", `rism-${name}.xml.gz`);
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < MAX_AGE) return { path, at: statSync(path).mtimeMs };
  console.log(`  downloading ${name}-latest.xml.gz`);
  const res = await fetch(`${EXPORTS}/${name}-latest.xml.gz`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`RISM ${name}: ${res.status} ${res.statusText}`);
  await mkdir(join(CACHE_DIR, "raw"), { recursive: true });
  await writeFile(`${path}.tmp`, Buffer.from(await res.arrayBuffer()));
  await rename(`${path}.tmp`, path);
  return { path, at: Date.now() };
}

/** MARC records from a gzipped MARC XML file, as they stream. */
async function* marcRecords(path: string): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of createReadStream(path).pipe(createGunzip())) {
    buffer += chunk.toString("utf8");
    let end: number;
    while ((end = buffer.search(/<\/(?:marc:)?record>/)) >= 0) {
      const close = buffer.indexOf(">", end) + 1;
      yield buffer.slice(0, close);
      buffer = buffer.slice(close);
    }
  }
}

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** tag → its fields, each field as subfield code → values */
export function marcFields(record: string): Map<string, Record<string, string[]>[]> {
  const fields = new Map<string, Record<string, string[]>[]>();
  for (const m of record.matchAll(/<(?:marc:)?(controlfield|datafield) tag="(\d+)"[^>]*>([\s\S]*?)<\/(?:marc:)?\1>/g)) {
    const subs: Record<string, string[]> = {};
    if (m[1] === "controlfield") subs[""] = [unescape(m[3]!.trim())];
    for (const s of m[3]!.matchAll(/<(?:marc:)?subfield code="(.)">([\s\S]*?)<\/(?:marc:)?subfield>/g)) (subs[s[1]!] ??= []).push(unescape(s[2]!.trim()));
    fields.set(m[2]!, [...(fields.get(m[2]!) ?? []), subs]);
  }
  return fields;
}

const first = (fields: Map<string, Record<string, string[]>[]>, tag: string, code: string) => fields.get(tag)?.[0]?.[code]?.[0] ?? null;

export function parseSource(record: string): (RismSource & { holdings: (RismHolding & { library: string | null })[] }) | null {
  const f = marcFields(record);
  const id = /^sources\/(\d+)$/.exec(first(f, "001", "") ?? "")?.[1];
  const person = /people\/(\d+)/.exec(first(f, "100", "0") ?? "")?.[1];
  const title = first(f, "240", "a");
  const holdings = (f.get("852") ?? [])
    .map((h) => ({ siglum: h.a?.[0] ?? "", shelf: h.c?.[0] ?? null, library: h.e?.[0] ?? null }))
    .filter((h) => h.siglum && h.siglum !== "XX");
  if (!id || !person || !title || !holdings.length) return null;
  const source = {
    id,
    person,
    title,
    medium: first(f, "240", "m"),
    numbers: first(f, "240", "n"),
    key: first(f, "240", "r"),
    excerpt: !!first(f, "240", "k"),
    catalogue: (f.get("690") ?? []).filter((c) => c.a && c.n).map((c) => ({ name: c.a![0]!, number: c.n![0]! })),
    type: first(f, "593", "a"),
    holdings,
  };
  const scoring = (f.get("594") ?? []).filter((x) => x.b?.[0]).map((x): [string, number] => [x.b![0]!, Number(x.c?.[0]) || 1]);
  return scoring.length ? { ...source, scoring } : source;
}

export function parsePerson(record: string): [string, RismPerson] | null {
  const f = marcFields(record);
  const id = /^people\/(\d+)$/.exec(first(f, "001", "") ?? "")?.[1];
  if (!id) return null;
  const ids = (f.get("024") ?? []).map((x) => [x["2"]?.[0], x.a?.[0]] as const);
  const gnd = ids.find(([s]) => s === "DNB")?.[1] ?? null;
  const wikidata = ids.find(([s]) => s === "WKP")?.[1] ?? null;
  return gnd || wikidata ? [id, { gnd, wikidata }] : null;
}

export async function crawlRism(): Promise<void> {
  console.log("RISM: musical sources and their holdings");
  const people: Record<string, RismPerson> = {};
  const persons = await download("person");
  for await (const r of marcRecords(persons.path)) {
    const p = parsePerson(r);
    if (p) people[p[0]] = p[1];
  }
  console.log(`  ${Object.keys(people).length} people with GND or Wikidata ids`);

  const src = await download("source");
  const sources: RismSource[] = [];
  const libraries: Record<string, string> = {};
  let seen = 0;
  for await (const r of marcRecords(src.path)) {
    if (++seen % 200_000 === 0) console.log(`  ${seen} sources read, ${sources.length} kept`);
    const s = parseSource(r);
    // Only composers we can bridge to ours.
    if (!s || !people[s.person]) continue;
    for (const h of s.holdings) if (h.library) libraries[h.siglum] ??= h.library;
    // A copy, so the kept strings don't pin the streamed text in memory.
    sources.push(JSON.parse(JSON.stringify({ ...s, holdings: s.holdings.map(({ siglum, shelf }) => ({ siglum, shelf })) })));
  }
  const used = new Set(sources.map((s) => s.person));
  for (const id of Object.keys(people)) if (!used.has(id)) delete people[id];
  console.log(`  ${seen} sources; ${sources.length} held by a library and by a composer with GND or Wikidata ids`);
  await writeStage("rism", { fetchedAt: Math.min(persons.at, src.at), sources, libraries, people } satisfies RismStage);
}

// ---- Matching ------------------------------------------------------------------

// RISM's catalogue abbreviations → how titles elsewhere write them (only ones that
// don't collide with another catalogue's letters).
const CATALOGUE_PREFIX: Record<string, string> = {
  Hob: "Hob.", KV: "K.", BWV: "BWV", HWV: "HWV", MH: "MH", Wq: "Wq.", TVWV: "TWV", MWV: "MWV", "D-2": "D.",
  BenP: "B.", GerB: "G.", RV: "RV", WoO: "WoO",
};

/** RISM key notation: "B|b" → "B-flat major", "f|x" → "F-sharp minor"; modes ("1t") → null. */
export function rismKey(key: string | null): string | null {
  const m = key ? /^([A-Ga-g])(?:\|([bx]))?$/.exec(key) : null;
  if (!m) return null;
  const accidental = m[2] === "b" ? "-flat" : m[2] === "x" ? "-sharp" : "";
  return `${m[1]!.toUpperCase()}${accidental} ${m[1] === m[1]!.toUpperCase() ? "major" : "minor"}`;
}

/** A title for matching: the uniform title, catalogue numbers and opus as other sources write them, and the key. */
export function rismMatchTitle(s: Pick<RismSource, "title" | "numbers" | "catalogue" | "key">): string {
  const parts = [s.title];
  for (const c of s.catalogue) {
    const prefix = CATALOGUE_PREFIX[c.name];
    if (prefix) parts.push(`${prefix} ${c.number}`);
  }
  // "op. 76,3" → "Op. 76 No. 3"
  if (s.numbers) parts.push(s.numbers.replace(/\bop\.\s*(\d+[a-z]?)\s*,\s*(\d+)/i, "Op. $1 No. $2"));
  const key = rismKey(s.key);
  return parts.join(", ") + (key ? ` in ${key}` : "");
}

/** Authority over a copy's interest: the composer's own hand first, then prints. */
export function rismRank(type: string | null): number {
  if (!type) return 9;
  if (/^Autograph/.test(type)) return 0;
  if (/autograph/i.test(type)) return 1;
  if (/^Print/.test(type)) return 2;
  return 3;
}

export const rismPersonUrl = (id: string) => `https://rism.online/people/${id}`;
