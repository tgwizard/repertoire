// LIBRIS: the Swedish union catalogue (CC0). We take its sheet music: that held by
// Musik- och teaterbiblioteket (library code X, formerly Statens musikbibliotek), which
// lends scores and parts, orchestral sets included, throughout Sweden, and that of every
// other library (KB's legal deposit copies, universities, music colleges, public libraries).

import { ensembleKey, parseEnsembleKey, playerCount, type Ensemble } from "../../src/lib/instrumentation.ts";
import { cached, fetchJson, jitteredMaxAge, progress, writeStage } from "../http.ts";
import { ANTHOLOGY, ARRANGED, instrumentsNamed, lineupFromTitle, SWEDISH } from "../title-lineup.ts";

const PAGE = 200;
// In id order: unsorted, the order of equally relevant results drifts while we page,
// and records slip between pages (5,500 of 155,000 once)
const SEARCH = "https://libris.kb.se/find.jsonld?q=*&and-instanceOf.category.@id=https://id.kb.se/term/rda/NotatedMusic&_stats=false&_sort=@id";
/** Musik- och teaterbiblioteket's library code */
export const MTB = "X";
// LIBRIS pages no further than 100,000 results into a search, and it has more sheet music
// than that: two searches, Musik- och teaterbiblioteket's and everyone else's, each fits.
const HELD_BY_X = "@reverse.itemOf.heldBy.@id=https://libris.kb.se/library/X";
const SEARCHES = { x: `${SEARCH}&${HELD_BY_X}`, other: `${SEARCH}&not-${HELD_BY_X}` };

export interface LibrisComposer {
  family: string;
  given: string | null;
  born: number | null;
  died: number | null;
  /** LIBRIS agent id */
  agent: string | null;
  /** The dates are from the authority record, not the edition's */
  datesFromAuthority?: true;
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
  /** Library codes of the libraries holding it ("X", "G", "LMu") */
  held: string[];
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
  const holdings = list(item["@reverse"]?.itemOf);
  const atX = holdings.find((h: any) => /\/library\/X$/.test(h?.heldBy?.["@id"] ?? ""));
  const held = [...new Set(holdings.map((h: any) => /\/library\/([^/]+)$/.exec(h?.heldBy?.["@id"] ?? "")?.[1]).filter((c): c is string => !!c))].sort();
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
    held,
    collection: list(work.hasPart).length > 1,
  };
}

/**
 * A LIBRIS instrumentation ("flöjt, violin, viola (2), violoncell") as a line-up key,
 * or null if any part isn't an instrument we know: better no line-up than a wrong one.
 */
export function librisLineup(medium: string[]): string | null {
  if (medium.length !== 1) return null; // several media: alternatives or a collection
  const parts: Ensemble = {};
  // A trailing year dates the whole entry ("röst, piano (1882)"); counts are small.
  const label = medium[0]!
    .toLowerCase()
    .replace(/[\s.;,]*$/, "")
    .replace(/\s*\(\d{4}\)$/, "")
    .replace(/[\s.;,]*$/, "")
    .replace(/\bpiano,? 4 h\b\.?/, "piano 4 händer");
  for (const raw of label.split(/,\s*/)) {
    const m = /^(.+?)(?:\s*\((\d{1,2})\))?$/.exec(raw.trim());
    const found = m && SWEDISH[m[1]!.trim()];
    if (!found) return null;
    for (const [id, n] of Object.entries(typeof found === "string" ? { [found]: 1 } : found)) parts[id] = (parts[id] ?? 0) + n * Number(m![2] ?? 1);
  }
  return ensembleKey(parts) || null;
}

// The library classification (KSSB, music: "X…") of editions for one line-up. Codes are
// built up: Xe strings, Xea violin, Xeaa violin alone, Xeaa.02 two violins; Xk chamber
// music, Xke strings, Xkeeb string quartet. KB publishes no list of them, so these are
// the codes whose records agree with the line-ups their own fields or titles state, at
// least 85% of 20 or more (all libraries' records, 2026-10; piano four hands, harpsichord
// and viola alone fall short, at 74–84%). Codes for a keyboard and something else ("Xeai":
// violin with piano, or with continuo, or a concerto in reduction) say less than a
// line-up, as do those of most concertos (with an orchestra, or with strings).
export const KSSB: Record<string, string> = {
  Xda: "piano", Xdb: "organ",
  Xeaa: "violin", "Xeaa.02": "violin*2", Xeca: "cello",
  Xfaa: "flute", "Xfaa.02": "flute*2", "Xfaa.04": "flute*4", Xfda: "clarinet", "Xfda.02": "clarinet*2", Xfha: "horn",
  Xga: "harp", Xgb: "guitar", Xgba: "guitar", "Xgb.02": "guitar*2", Xgd: "lute",
  Xkeea: "cello,viola,violin", Xkeeb: "cello,viola,violin*2", Xkffb: "bassoon,clarinet,flute,horn,oboe", Xkfga: "horn,trombone,trumpet*2,tuba",
  Xle: "orchestra", Xlbda: "orchestra,piano",
  Xoaba: "piano,voice", Xpcc: "mixed chorus",
};

/**
 * The line-up a record's classification gives, and the code that gives it: null when
 * none of its codes is one of a line-up, or they name different ones. Codes for a
 * collection ("Xda(s)") or exercises ("Xeb(ö)") don't count, and a record also classed
 * as a stage work (Xr: a vocal score, a number from an opera), a composer's collected
 * edition (Xb), popular or folk music (Xx, Xö), teaching material (Xu) or music of other
 * traditions (Xv) has none.
 */
export function kssbLineup(codes: string[]): { lineup: string; code: string } | null {
  if (codes.some((c) => /^X(?:r|b|x|ö|u|v)/.test(c.trim()))) return null;
  const found = new Map<string, string>();
  for (const c of codes) {
    const m = /^(X[\w.]+?)\s*(?:\(([^)]*)\))?$/.exec(c.trim());
    if (!m || /^(?:s|ö)$/.test(m[2] ?? "")) continue;
    const lineup = KSSB[m[1]!];
    if (lineup && !found.has(lineup)) found.set(lineup, c.trim());
  }
  if (found.size !== 1) return null;
  const [lineup, code] = [...found][0]!;
  return { lineup, code };
}

/**
 * A record's line-up, from its instrumentation field or the one its title spells out
 * ("variationer för blåskvintett"); most records only have the title. When both are
 * read: the same instruments → the field's (or the title's, if it counts more players);
 * the title adds some (a continuo) → the title's; otherwise the edition is likely an
 * arrangement of the work, and neither is the work's. With neither, the library's
 * classification, unless the title says it's an arrangement or an anthology, or names a
 * line-up we can't read ("pour la Harpe avec Accompagnement d'Orchestre": not "orchestra").
 */
const classifiedOnly = (title: string) => !ARRANGED.test(title) && !ANTHOLOGY.test(title) && !/(?:^|[\s,(])(?:för|for|für|pour|per)\s/i.test(title);

export function librisRecordLineup(r: Pick<LibrisRecord, "medium" | "title" | "kssb">): string | null {
  const field = librisLineup(r.medium);
  const title = lineupFromTitle(r.title);
  if (!title) return field ?? (classifiedOnly(r.title) ? (kssbLineup(r.kssb ?? [])?.lineup ?? null) : null);
  if (!field) return ensembleKey(title) || null;
  const f = parseEnsembleKey(field);
  const [named, titled] = [instrumentsNamed(f), instrumentsNamed(title)];
  if ([...named].every((i) => titled.has(i))) return named.size === titled.size && playerCount(title) <= playerCount(f) ? field : ensembleKey(title);
  return null;
}

export async function crawlLibris(): Promise<void> {
  console.log("LIBRIS: sheet music in Swedish libraries");
  const records: LibrisRecord[] = [];
  let oldest = Date.now();
  let total = 0;
  for (const [name, search] of Object.entries(SEARCHES)) {
    const page = (offset: number) =>
      cached(`libris:${name}:v3:${offset}`, jitteredMaxAge(`libris:${name}:${offset}`, 20, 40), async () => {
        const res = await fetchJson<any>(`${search}&_limit=${PAGE}&_offset=${offset}`, { accept: "application/ld+json" });
        return { total: res.totalItems as number, records: (res.items ?? []).map(extractRecord).filter(Boolean) as LibrisRecord[] };
      });
    const first = await page(0);
    const listed = first.value.total;
    total += listed;
    records.push(...first.value.records);
    oldest = Math.min(oldest, first.fetchedAt);
    const report = progress(`LIBRIS pages (${name === "x" ? "Musik- och teaterbiblioteket" : "other libraries"})`, Math.ceil(listed / PAGE));
    for (let offset = PAGE, n = 1; offset < listed; offset += PAGE, n++) {
      const res = await page(offset);
      records.push(...res.value.records);
      oldest = Math.min(oldest, res.fetchedAt);
      report(n + 1);
    }
  }
  // Paging over a catalogue that changes can repeat a record at a page boundary, or move it
  // from one search to the other.
  const unique = [...new Map(records.map((r) => [r.id, r])).values()];
  console.log(`  ${unique.length} records (${total} listed)`);
  // A composer linked to LIBRIS's authority record has their dates there, not in the
  // record of the edition ("Engelsk tonsättare, 1903-1989")
  const dateless = [...new Set(unique.flatMap((r) => r.composers.filter((c) => c.agent && !c.born).map((c) => c.agent!)))];
  const lives = new Map<string, { born: number | null; died: number | null }>();
  const report = progress("LIBRIS composers without dates", dateless.length);
  // (A request that fails isn't cached as "no dates", and keeps an older answer if there's
  // one; authority records change seldom, so their age isn't the source's)
  for (const [i, agent] of dateless.entries()) {
    try {
      const res = await cached(`libris:agent:v1:${agent}`, jitteredMaxAge(`libris:agent:${agent}`, 120, 240), async () =>
        agentLife(await fetchJson<any>(`https://libris.kb.se/${agent}/data.jsonld`, { accept: "application/ld+json" })),
      );
      if (res.value.born) lives.set(agent, res.value);
    } catch (e) {
      console.warn(`  ${agent}: ${(e as Error).message}`);
    }
    report(i + 1);
  }
  for (const r of unique) for (const c of r.composers) if (c.agent && !c.born && lives.has(c.agent)) Object.assign(c, lives.get(c.agent), { datesFromAuthority: true });
  console.log(`  ${lives.size} of ${dateless.length} composers without dates have them in their authority record`);
  await writeStage("libris", { fetchedAt: oldest, total, records: unique } satisfies LibrisStage);
}

/** A person's life years from their authority record: its life span, else its description. */
export function agentLife(doc: any): { born: number | null; died: number | null } {
  const person = list(doc?.["@graph"]).find((n: any) => n?.["@type"] === "Person");
  const text = [person?.lifeSpan, ...list(person?.description)].filter((t) => typeof t === "string").join(" ");
  const span = /\b(1[2-9]\d\d|20[0-2]\d)\s*[-–]\s*(1[2-9]\d\d|20[0-2]\d)?/.exec(text) ?? /\bf(?:ödd|\.)\s*(1[2-9]\d\d|20[0-2]\d)/.exec(text);
  return { born: span?.[1] ? Number(span[1]) : null, died: span?.[2] ? Number(span[2]) : null };
}

/**
 * "1 part. (20 s.) + 4 st." → "Score and parts" (partitur = score, stämmor = parts); held
 * elsewhere than Musik- och teaterbiblioteket, how many libraries have it
 */
export function librisHolding(r: Pick<LibrisRecord, "extent" | "publisher" | "year"> & { held?: string[] }): string {
  const parts = /\bst(?:ämmor|\.|\b)/i.test(r.extent);
  const score = /\bpart(?:itur|\.)/i.test(r.extent);
  const what = score && parts ? "Score and parts" : parts ? "Parts" : score ? "Score" : "Sheet music";
  const elsewhere = r.held && !r.held.includes(MTB) && r.held.length ? `${r.held.length} ${r.held.length === 1 ? "library" : "libraries"}` : null;
  return [what, r.publisher, r.year, elsewhere].filter(Boolean).join(" · ");
}
