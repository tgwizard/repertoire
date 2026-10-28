// DNB: the German National Library's catalogue (CC0). Every edition of sheet music
// published in Germany is deposited there by law (Deutsches Musikarchiv), so new editions
// and new works show up within weeks, long before anyone writes a work record for them.
// We take its printed music from 2000 on, a year at a time, through its SRU search
// (MARC 21). Its records name the composer and the work by their GND ids where the
// cataloguer linked them.

import { ensembleKey, type Ensemble } from "../../src/lib/instrumentation.ts";
import { cached, fetchText, jitteredMaxAge, progress, writeStage } from "../http.ts";
import { lineupFromTitle } from "../title-lineup.ts";
import { gndLineup, type GndMedium } from "./gnd.ts";

const SRU = "https://services.dnb.de/sru/dnb.dma?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml";
const PAGE = 100; // the most SRU returns at once
/** The first year taken: older editions are mostly of works the other sources have */
export const FIRST_YEAR = 2000;

export interface DnbRecord {
  /** DNB record id: https://d-nb.info/<id> */
  id: string;
  /** As printed: "11 Capricen aus der Neuen Welt" */
  title: string;
  /** What follows the title: "für Violine solo : Opus 13" */
  remainder: string | null;
  /** The composer, with their GND id when the cataloguer linked one */
  composer: { gnd: string | null; name: string; born: number | null; died: number | null } | null;
  /** More than one composer (100 and 700 $4 cmp): an anthology or a joint work */
  composers: number;
  /** The work it's an edition of (MARC 240) */
  work: { gnd: string | null; title: string; media: GndMedium[]; arranged: boolean; selection: boolean } | null;
  /** Someone arranged it, or the edition says so */
  arranged: boolean;
  /** Part of a series or a larger publication, or one with contents of its own: not one work */
  collection: boolean;
  year: number | null;
  publisher: string | null;
  /** "1 Partitur (26 Seiten), 4 Stimmen" */
  extent: string;
}

export interface DnbStage {
  fetchedAt: number;
  firstYear: number;
  total: number;
  records: DnbRecord[];
}

export const dnbUrl = (id: string) => `https://d-nb.info/${id}`;

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/**
 * DNB's text, composed and without its markers: a grapheme joiner (U+034F) in some words
 * ("H͏aïkus", "noe͏̈ls") keeps "e" and its diaeresis from composing to "ë", and control
 * characters (U+0098 … U+009C) mark what sorting skips ("G. Henle", "Der Freischütz").
 */
export const dnbText = (s: string) =>
  s
    .replace(/[\u034f\u0080-\u009f]/g, "")
    .replace(/ {2,}/g, " ")
    .normalize("NFC");

/** A record with its text composed (stages crawled before dnbText have joiners in them). */
export function composeRecord(r: DnbRecord): DnbRecord {
  return JSON.parse(dnbText(JSON.stringify(r)));
}

type Field = { tag: string; sub: [string, string][] };

function fields(record: string): Field[] {
  const out: Field[] = [];
  for (const m of record.matchAll(/<datafield tag="(\d{3})"[^>]*>([\s\S]*?)<\/datafield>/g)) {
    const sub = [...m[2]!.matchAll(/<subfield code="(.)">([^<]*)<\/subfield>/g)].map((s) => [s[1]!, dnbText(unescape(s[2]!)).trim()] as [string, string]);
    out.push({ tag: m[1]!, sub });
  }
  return out;
}

const first = (f: Field | undefined, code: string) => f?.sub.find(([c]) => c === code)?.[1] ?? null;
const all = (f: Field | undefined, code: string) => f?.sub.filter(([c]) => c === code).map(([, v]) => v) ?? [];
/** A GND id among a field's $0s: "(DE-588)1421472252" */
const gndId = (f: Field | undefined) => all(f, "0").map((v) => /^\(DE-588\)(.+)$/.exec(v)?.[1]).find(Boolean) ?? null;
const roles = (f: Field) => [...all(f, "4"), ...all(f, "e").map((e) => e.toLowerCase())];
const trimEnd = (s: string) => s.replace(/[\s/:;,.=]+$/, "");

/** One record of printed music, or null for anything else (recordings, manuscripts). */
export function parseRecord(xml: string): DnbRecord | null {
  const leader = /<leader>([^<]*)<\/leader>/.exec(xml)?.[1] ?? "";
  if (leader[6] !== "c") return null; // printed music
  const id = /<controlfield tag="001">([^<]+)<\/controlfield>/.exec(xml)?.[1];
  const fs = fields(xml);
  const f245 = fs.find((f) => f.tag === "245");
  if (!id || !f245) return null;
  const title = trimEnd([first(f245, "a"), ...all(f245, "n"), ...all(f245, "p")].filter(Boolean).join(". "));
  if (!title) return null;

  const people = fs.filter((f) => f.tag === "100" || f.tag === "700");
  const composing = people.filter((f) => f.tag === "100" ? !roles(f).length || roles(f).some((r) => r === "cmp" || r === "komponist") : roles(f).some((r) => r === "cmp" || r === "komponist"));
  const main = composing.find((f) => f.tag === "100") ?? null;
  const life = /^(\d{4})?\s*-\s*(\d{4})?/.exec(first(main ?? undefined, "d") ?? "");
  // "Höhlein, Detlef" → "Detlef Höhlein"
  const name = first(main ?? undefined, "a")?.replace(/^([^,]+),\s*(.+)$/, "$2 $1") ?? null;

  const f240 = fs.find((f) => f.tag === "240" || f.tag === "130");
  const media = all(f240, "m").map((m) => {
    const c = /^(.+?)\s*\((\d+)\)$/.exec(m);
    return { name: c ? c[1]! : m, count: c ? Number(c[2]) : 1 };
  });
  const work = f240
    ? {
        gnd: gndId(f240),
        title: trimEnd([first(f240, "a"), ...all(f240, "n"), ...all(f240, "p"), first(f240, "r")].filter(Boolean).join(", ")),
        media,
        arranged: all(f240, "o").some((o) => /arr|bearb/i.test(o)),
        selection: all(f240, "k").some((k) => /auswahl|selections/i.test(k)),
      }
    : null;
  const statement = [first(f245, "c"), ...fs.filter((f) => f.tag === "250").map((f) => first(f, "a"))].filter(Boolean).join(" ");
  const arranged =
    !!work?.arranged || people.some((f) => roles(f).some((r) => r === "arr" || r === "arrangeur" || r === "bearbeiter")) || /\b(?:arr\.|arrangiert|arrangement|bearb(?:\.|eitet|eitung))/i.test(statement);

  const f264 = fs.filter((f) => f.tag === "264");
  const published = f264.find((f) => first(f, "b")) ?? f264[0];
  const year = Number(/\b(1[89]\d{2}|20\d{2})\b/.exec(f264.map((f) => first(f, "c") ?? "").join(" "))?.[1]) || null;
  return {
    id,
    title,
    remainder: first(f245, "b") ? trimEnd(first(f245, "b")!) : null,
    composer: name ? { gnd: gndId(main ?? undefined), name, born: life?.[1] ? Number(life[1]) : null, died: life?.[2] ? Number(life[2]) : null } : null,
    composers: composing.length,
    work,
    arranged,
    collection: !!work?.selection || fs.some((f) => f.tag === "773" || f.tag === "505"),
    year,
    publisher: first(published, "b"),
    extent: fs.filter((f) => f.tag === "300").map((f) => first(f, "a")).filter(Boolean).join("; "),
  };
}

/** The records in one SRU response, and how many the search found. */
export function parseResponse(xml: string): { total: number; records: DnbRecord[] } {
  const total = Number(/<numberOfRecords>(\d+)<\/numberOfRecords>/.exec(xml)?.[1] ?? 0);
  const records = [...xml.matchAll(/<record xmlns="http:\/\/www\.loc\.gov\/MARC21\/slim"[^>]*>([\s\S]*?)<\/record>/g)]
    .map((m) => parseRecord(m[1]!))
    .filter((r): r is DnbRecord => !!r);
  return { total, records };
}

/**
 * The line-up an edition gives its work: the work's instrumentation (its record's,
 * in GND's German), else the one the title spells out ("für Violine solo"). When both are
 * read and differ, the edition is probably an arrangement, and neither counts.
 */
export function dnbLineup(r: Pick<DnbRecord, "title" | "remainder" | "work">): Ensemble | null {
  const fromWork = r.work?.media.length ? gndLineup(r.work.media) : null;
  // Before any parallel title in another language ("= 10 little Songs : for high voice …")
  const printed = [r.title, r.remainder?.split(/\s+=\s+/)[0]].filter(Boolean).join(" ");
  const fromTitle = lineupFromTitle(printed);
  if (fromWork && fromTitle && ensembleKey(fromWork) !== ensembleKey(fromTitle)) return null;
  return fromWork ?? fromTitle;
}

/** "Score and parts · Schott · 2025" (Partitur = score, Stimmen = parts) */
export function dnbHolding(r: Pick<DnbRecord, "extent" | "publisher" | "year">): string {
  const parts = /\bStimme/i.test(r.extent);
  const score = /\b(?:Partitur|Studienpartitur|Klavierauszug|Chorpartitur)/i.test(r.extent);
  const what = score && parts ? "Score and parts" : parts ? "Parts" : score ? "Score" : "Sheet music";
  return [what, r.publisher, r.year].filter(Boolean).join(" · ");
}

export async function crawlDnb(): Promise<void> {
  console.log(`DNB: printed music published since ${FIRST_YEAR}`);
  const thisYear = new Date().getUTCFullYear();
  const records: DnbRecord[] = [];
  let oldest = Date.now();
  let total = 0;
  const report = progress("DNB years", thisYear - FIRST_YEAR + 1);
  for (let year = FIRST_YEAR; year <= thisYear; year++) {
    // Recent years still grow as editions come in; older ones hardly change
    const [min, max] = year >= thisYear - 1 ? [7, 14] : [60, 120];
    const page = (start: number) =>
      cached(`dnb:scores:v1:${year}:${start}`, jitteredMaxAge(`dnb:${year}:${start}`, min, max), async () =>
        parseResponse(await fetchText(`${SRU}&query=${encodeURIComponent(`mat=scores and jhr=${year}`)}&maximumRecords=${PAGE}&startRecord=${start}`, { accept: "application/xml" })),
      );
    const head = await page(1);
    total += head.value.total;
    records.push(...head.value.records);
    oldest = Math.min(oldest, head.fetchedAt);
    for (let start = 1 + PAGE; start <= head.value.total; start += PAGE) {
      const res = await page(start);
      records.push(...res.value.records);
      oldest = Math.min(oldest, res.fetchedAt);
    }
    report(year - FIRST_YEAR + 1);
  }
  // A record can move between pages as the catalogue grows
  const unique = [...new Map(records.map((r) => [r.id, r])).values()];
  console.log(`  ${unique.length} records of printed music (${total} listed)`);
  await writeStage("dnb", { fetchedAt: oldest, firstYear: FIRST_YEAR, total, records: unique } satisfies DnbStage);
}
