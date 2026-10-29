// K10plus: the union catalogue of most German (and some Austrian) research libraries,
// GBV's and SWB's (CC0). Beyond what's deposited with the German National Library, it has
// the editions those libraries bought, among them many from abroad, catalogued in WorldCat
// first (Donemus, American publishers). Its records are MARC 21 like DNB's, with a field
// for each instrument and its count (382). We take its printed music from 2000 on, a year
// at a time, through its SRU search, leaving out its copies of DNB's records.

import { cached, fetchText, jitteredMaxAge, progress, writeStage } from "../http.ts";
import { ANTHOLOGY } from "../title-lineup.ts";
import { FIRST_YEAR, parseResponse, type DnbRecord } from "./dnb.ts";

const SRU = "https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml";
const PAGE = 500;

export interface K10plusStage {
  fetchedAt: number;
  firstYear: number;
  total: number;
  /** Not DNB's records (those are in the dnb stage) */
  records: DnbRecord[];
}

/**
 * Not one work: part of a larger publication, a selection, a uniform title for a
 * composer's works ("Werke"), or a contents note listing works. K10plus's notes also list
 * an edition's parts ("Flute part -- Oboe part") or a work's movements, which don't count
 * when the record names the one work it's of.
 */
export function k10plusCollection(r: Partial<Pick<DnbRecord, "partOf" | "contents" | "work">>): boolean {
  if (r.partOf || r.work?.selection || (r.work && ANTHOLOGY.test(r.work.title))) return true;
  if (!r.contents || /\bparts?\b|\bstimmen?\b|\bpartitur\b/i.test(r.contents)) return false;
  return !r.work;
}

/** A record in the K10plus catalogue, by its PPN */
export const k10plusUrl = (id: string) => `https://opac.k10plus.de/DB=2.1/PPNSET?PPN=${id}`;

export async function crawlK10plus(): Promise<void> {
  console.log(`K10plus: printed music published since ${FIRST_YEAR}`);
  const thisYear = new Date().getUTCFullYear();
  const records: DnbRecord[] = [];
  let oldest = Date.now();
  let total = 0;
  let copies = 0;
  const report = progress("K10plus years", thisYear - FIRST_YEAR + 1);
  for (let year = FIRST_YEAR; year <= thisYear; year++) {
    const [min, max] = year >= thisYear - 1 ? [7, 14] : [60, 120];
    const page = (start: number) =>
      cached(`k10plus:ntm:v3:${year}:${start}`, jitteredMaxAge(`k10plus:${year}:${start}`, min, max), async () =>
        parseResponse(await fetchText(`${SRU}&query=${encodeURIComponent(`pica.imd=ntm and pica.jhr=${year}`)}&maximumRecords=${PAGE}&startRecord=${start}`, { accept: "application/xml" })),
      );
    const take = (rs: DnbRecord[]) => {
      for (const r of rs) {
        if (r.copyOf) copies++;
        else records.push({ ...r, collection: k10plusCollection(r) });
      }
    };
    const head = await page(1);
    total += head.value.total;
    take(head.value.records);
    oldest = Math.min(oldest, head.fetchedAt);
    for (let start = 1 + PAGE; start <= head.value.total; start += PAGE) {
      const res = await page(start);
      take(res.value.records);
      oldest = Math.min(oldest, res.fetchedAt);
    }
    report(year - FIRST_YEAR + 1);
  }
  const unique = [...new Map(records.map((r) => [r.id, r])).values()];
  console.log(`  ${unique.length} records of printed music (${total} listed, ${copies} of them DNB's)`);
  await writeStage("k10plus", { fetchedAt: oldest, firstYear: FIRST_YEAR, total, records: unique } satisfies K10plusStage);
}
