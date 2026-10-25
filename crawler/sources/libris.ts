// LIBRIS: the Swedish union catalogue (CC0). We take the sheet music held by
// Musik- och teaterbiblioteket (library code X, formerly Statens musikbibliotek),
// which lends scores and parts, orchestral sets included, throughout Sweden.

import { ensembleKey, type Ensemble } from "../../src/lib/instrumentation.ts";
import { cached, fetchJson, jitteredMaxAge, progress, writeStage } from "../http.ts";

const PAGE = 200;
const SEARCH =
  "https://libris.kb.se/find.jsonld?q=*&@reverse.itemOf.heldBy.@id=https://libris.kb.se/library/X" +
  "&and-instanceOf.category.@id=https://id.kb.se/term/rda/NotatedMusic&_stats=false";

export interface LibrisComposer {
  family: string;
  given: string | null;
  born: number | null;
  died: number | null;
  /** LIBRIS agent id */
  agent: string | null;
}

export interface LibrisRecord {
  /** Record id: https://libris.kb.se/<id> */
  id: string;
  /** As printed: "Quintett für Flöte, Violine, zwei Violen und Violoncello, op. 41 Nr. 1" */
  title: string;
  /** The library's uniform title: "Kvintett, op. 41, Nr 1" */
  uniform: string | null;
  composers: LibrisComposer[];
  /** Someone arranged it */
  arranged: boolean;
  /** Instrumentation in Swedish: ["flöjt, violin, viola (2), violoncell"] */
  medium: string[];
  /** Swedish library classification (KSSB), e.g. "Xkef.05" */
  kssb: string[];
  /** "1 part. (20 s.) + 4 st.": a score and four parts */
  extent: string;
  year: number | null;
  publisher: string | null;
  /** Shelf mark at Musik- och teaterbiblioteket */
  shelf: string | null;
  /** An anthology of several works */
  collection: boolean;
}

export interface LibrisStage {
  fetchedAt: number;
  total: number;
  records: LibrisRecord[];
}

export const librisUrl = (id: string) => `https://libris.kb.se/${id}`;

const list = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => list(v as string | string[]).join(" ").trim();
const year = (s: unknown) => {
  const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(text(s));
  return m ? Number(m[1]) : null;
};

/** The fields we use from one search result (the full records are ~12 KB each). */
export function extractRecord(item: any): LibrisRecord | null {
  const id = /libris\.kb\.se\/([^#/]+)/.exec(item?.["@id"] ?? "")?.[1];
  if (!id) return null;
  const work = item.instanceOf ?? {};
  const titleOf = (t: any) =>
    t
      ? [text(t.mainTitle), text(t.titleRemainder), ...list(t.partNumber).map(text), ...list(t.partName).map(text)]
          .map((s) => s.replace(/[.,;:\s]+$/, ""))
          .filter(Boolean)
          .join(", ")
      : "";
  const composers: LibrisComposer[] = [];
  let arranged = false;
  for (const c of list(work.contribution)) {
    const roles = list(c.role).map((r: any) => r?.code ?? r?.["@id"]?.split("/").pop());
    if (roles.includes("arr") || roles.includes("arranger")) arranged = true;
    const a = c.agent ?? {};
    const isComposer = roles.includes("cmp") || roles.includes("composer") || (c["@type"] === "PrimaryContribution" && a["@type"] === "Person" && !roles.length);
    if (!isComposer || !a.familyName) continue;
    const life = /^(\d{4})?\s*-\s*(\d{4})?/.exec(text(a.lifeSpan));
    composers.push({
      family: text(a.familyName),
      given: a.givenName ? text(a.givenName) : null,
      born: life?.[1] ? Number(life[1]) : null,
      died: life?.[2] ? Number(life[2]) : null,
      agent: a["@id"] ? (/libris\.kb\.se\/([^#/]+)/.exec(a["@id"])?.[1] ?? null) : null,
    });
  }
  const atX = list(item["@reverse"]?.itemOf).find((h: any) => /\/library\/X$/.test(h?.heldBy?.["@id"] ?? ""));
  const pub = list(item.publication)[0] ?? {};
  return {
    id,
    title: titleOf(list(item.hasTitle)[0]),
    uniform: titleOf(list(work.hasTitle)[0]) || null,
    composers,
    arranged,
    medium: list(work.musicMedium).map((m: any) => text(m?.label)).filter(Boolean),
    kssb: list(work.classification).map((c: any) => text(c?.code)).filter((c) => c.startsWith("X")),
    extent: list(item.extent).map((e: any) => text(e?.label)).join("; "),
    year: year(pub.year ?? pub.date),
    publisher: pub.agent ? text(pub.agent.label) || null : null,
    shelf: atX ? text(atX.shelfMark?.label ?? atX.shelfControlNumber) || null : null,
    collection: list(work.hasPart).length > 1,
  };
}

// Instruments as LIBRIS names them (Swedish), → our instrument ids.
const SWEDISH: Record<string, string> = {
  flöjt: "flute", tvärflöjt: "flute", piccolaflöjt: "piccolo", piccola: "piccolo", altflöjt: "alto flute", blockflöjt: "recorder",
  oboe: "oboe", "oboe d'amore": "oboe damore", "engelskt horn": "english horn", klarinett: "clarinet", bassetthorn: "basset horn",
  basklarinett: "bass clarinet", fagott: "bassoon", kontrafagott: "contrabassoon", sopransaxofon: "soprano saxophone",
  altsaxofon: "alto saxophone", tenorsaxofon: "tenor saxophone", barytonsaxofon: "baritone saxophone", saxofon: "saxophone",
  horn: "horn", valthorn: "horn", trumpet: "trumpet", kornett: "cornet", flygelhorn: "flugelhorn", trombon: "trombone",
  basun: "trombone", bastrombon: "bass trombone", basbasun: "bass trombone", eufonium: "euphonium", tuba: "tuba",
  violin: "violin", fiol: "violin", viola: "viola", altfiol: "viola", violoncell: "cello", cello: "cello", kontrabas: "double bass",
  "viola da gamba": "viol", gamba: "viol", harpa: "harp", gitarr: "guitar", luta: "lute", mandolin: "mandolin",
  piano: "piano", "piano 4 händer": "piano 4 hands", "piano fyrhändigt": "piano 4 hands", cembalo: "harpsichord", orgel: "organ",
  harmonium: "harmonium", dragspel: "accordion", ackordeon: "accordion", celesta: "celesta", continuo: "continuo",
  "basso continuo": "continuo", generalbas: "continuo", "b.c.": "continuo", "b.c": "continuo", bc: "continuo", slagverk: "percussion", pukor: "timpani", puka: "timpani",
  marimba: "marimba", vibrafon: "vibraphone", sång: "voice", röst: "voice", sopran: "soprano", alt: "alto", tenor: "tenor",
  baryton: "baritone", berättare: "narrator", recitation: "narrator", "blandad kör": "mixed chorus", kör: "mixed chorus",
  manskör: "male chorus", damkör: "female chorus", orkester: "orchestra", symfoniorkester: "orchestra",
  stråkorkester: "strings", blåsorkester: "wind band", brassband: "brass band",
};

/**
 * A LIBRIS instrumentation ("flöjt, violin, viola (2), violoncell") as a line-up key,
 * or null if any part isn't an instrument we know: better no line-up than a wrong one.
 */
export function librisLineup(medium: string[]): string | null {
  if (medium.length !== 1) return null; // several media: alternatives or a collection
  const parts: Ensemble = {};
  // A trailing year dates the whole entry ("röst, piano (1882)"); counts are small.
  const label = medium[0]!.toLowerCase().replace(/\s*\(\d{4}\)\.?\s*$/, "").replace(/\.$/, "");
  for (const raw of label.split(/,\s*/)) {
    const m = /^(.+?)(?:\s*\((\d{1,2})\))?$/.exec(raw.trim());
    const id = m && SWEDISH[m[1]!.trim()];
    if (!id) return null;
    parts[id] = (parts[id] ?? 0) + Number(m![2] ?? 1);
  }
  return ensembleKey(parts) || null;
}

export async function crawlLibris(): Promise<void> {
  console.log("LIBRIS: sheet music at Musik- och teaterbiblioteket");
  const page = (offset: number) =>
    cached(`libris:x:v1:${offset}`, jitteredMaxAge(`libris:${offset}`, 20, 40), async () => {
      const res = await fetchJson<any>(`${SEARCH}&_limit=${PAGE}&_offset=${offset}`, { accept: "application/ld+json" });
      return { total: res.totalItems as number, records: (res.items ?? []).map(extractRecord).filter(Boolean) as LibrisRecord[] };
    });
  const first = await page(0);
  const total = first.value.total;
  const records = [...first.value.records];
  let oldest = first.fetchedAt;
  const report = progress("LIBRIS pages", Math.ceil(total / PAGE));
  for (let offset = PAGE, n = 1; offset < total; offset += PAGE, n++) {
    const res = await page(offset);
    records.push(...res.value.records);
    oldest = Math.min(oldest, res.fetchedAt);
    report(n + 1);
  }
  // Paging over a catalogue that changes can repeat a record at a page boundary.
  const unique = [...new Map(records.map((r) => [r.id, r])).values()];
  console.log(`  ${unique.length} records (${total} listed)`);
  await writeStage("libris", { fetchedAt: oldest, total, records: unique } satisfies LibrisStage);
}

/** "1 part. (20 s.) + 4 st." → "Score and parts" (partitur = score, stämmor = parts) */
export function librisHolding(r: Pick<LibrisRecord, "extent" | "publisher" | "year">): string {
  const parts = /\bst(?:ämmor|\.|\b)/i.test(r.extent);
  const score = /\bpart(?:itur|\.)/i.test(r.extent);
  const what = score && parts ? "Score and parts" : parts ? "Parts" : score ? "Score" : "Sheet music";
  return [what, r.publisher, r.year].filter(Boolean).join(" · ");
}
