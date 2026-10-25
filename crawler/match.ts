// Matching works and composers across sources that share no identifiers.

import { normalize } from "../src/shared/text.ts";

export { normalize };

// Catalogue systems, as [prefix used in keys, pattern]. The pattern's first group is the number.
const CATALOGUES: [string, RegExp][] = [
  ["bwv", /\bBWV\.?\s*(\d+[a-z]?)/gi],
  ["k", /\bK(?:V|\.)?\s*(\d+[a-z]?)\b/g], // Mozart (K. 466, KV 466)
  ["d", /\bD\.?\s*(\d{1,3}[a-z]?)\b(?!\s*(?:major|minor|flat|sharp|-))/g], // Schubert (D. 810), not "D major"
  ["hob", /\bHob\.?\s*([IVXL]+[a-z]?\s*:\s*[\dA-Za-z]+)/g],
  ["hwv", /\bHWV\.?\s*(\d+[a-z]?)/gi],
  ["rv", /\bRV\.?\s*(\d+[a-z]?)/g],
  ["twv", /\bTWV\.?\s*(\d+\s*:\s*[\dA-Za-z]+)/gi],
  ["woo", /\bWoO\.?\s*(\d+[a-z]?)/gi],
  ["sz", /\bSz\.?\s*(\d+[a-z]?)/g],
  ["bb", /\bBB\.?\s*(\d+[a-z]?)/g],
  ["fs", /\bFS\.?\s*(\d+[a-z]?)/g],
  ["jw", /\bJW\.?\s*([IVX]+\s*\/\s*\d+)/g],
  ["s", /\bS\.?\s*(\d{1,3}[a-z]?)\b/g], // Liszt (S. 244), Ives (S. 1)
  ["h", /\bH\.?\s*(\d{2,3}[a-z]?)\b/g], // Martinů
  ["m", /\bM\.?\s*(\d{1,3}[a-z]?)\b/g], // Ravel (M. 35)
  ["cd", /\bCD\.?\s*(\d{1,3}[a-z]?)\b/g], // Debussy (CD 5)
  ["l", /\bL\.?\s*(\d{1,3}[a-z]?)\b/g], // Debussy, older Lesure numbers
  ["fp", /\bFP\.?\s*(\d{1,3}[a-z]?)\b/g], // Poulenc
  ["b", /\bB\.?\s*(\d{1,3}[a-z]?)\b/g], // Dvořák (Burghauser), Bloch
  ["g", /\bG\.?\s*(\d{2,3}[a-z]?)\b/g], // Boccherini (Gérard)
  ["bv", /\bBV\.?\s*(\d{1,3}[a-z]?)\b/g], // Busoni
  ["wab", /\bWAB\.?\s*(\d{1,3}[a-z]?)\b/gi], // Bruckner
  ["trv", /\bTrV\.?\s*(\d{1,3}[a-z]?)\b/gi], // Richard Strauss
  ["swv", /\bSWV\.?\s*(\d{1,3}[a-z]?)\b/gi], // Schütz
  ["mwv", /\bMWV\.?\s*([A-Z]\s*\d{1,3})\b/gi], // Mendelssohn
  ["z", /\bZ\.?\s*(\d{1,3}[a-z]?)\b/g], // Purcell
  ["wq", /\bWq\.?\s*(\d{1,3}[a-z]?)\b/gi], // C. P. E. Bach
  ["mh", /\bMH\.?\s*(\d{1,3}[a-z]?)\b/g], // Michael Haydn (Perger: MH 461)
];

const OPUS = /\bOp(?:us)?\.?\s*(?:posth\.?\s*)?(\d+[a-z]?)(?:\s*,?\s*(?:No|Nr|N°|n°)\.?\s*(\d+[a-z]?))?/gi;

/**
 * Catalogue keys in a title: "String Quartet No.1, Op.18 No.1" → {"op:18", "op:18/1"};
 * "Piano Concerto No.20 in D minor, K.466" → {"k:466"}.
 */
// Matching compares each record against all of a composer's works, so the parsing of
// titles is memoized (results are never mutated).
function memo<T>(fn: (title: string) => T): (title: string) => T {
  const cache = new Map<string, T>();
  return (title) => {
    let v = cache.get(title);
    if (v === undefined && !cache.has(title)) {
      v = fn(title);
      if (cache.size > 2_000_000) cache.clear();
      cache.set(title, v);
    }
    return v as T;
  };
}

export const catalogueKeys = memo(catalogueKeysOf);
export const bareTitle = memo(bareTitleOf);
export const musicalKey = memo(musicalKeyOf);

function catalogueKeysOf(title: string): Set<string> {
  const keys = new Set<string>();
  for (const m of title.matchAll(OPUS)) {
    const op = m[1]!.toLowerCase();
    keys.add(`op:${op}`);
    if (m[2]) keys.add(`op:${op}/${m[2].toLowerCase()}`);
  }
  for (const [prefix, re] of CATALOGUES) {
    for (const m of title.matchAll(re)) {
      const value = m[1]!.toLowerCase().replace(/\s+/g, "");
      keys.add(`${prefix}:${value}`);
      // Ranges on collection pages: "G.214-215", "Hob.III:19-24".
      const range = /^\s*[-–]\s*(\d+)\b/.exec(title.slice(m.index! + m[0].length));
      const start = /(\d+)$/.exec(value);
      if (range && start) {
        const [from, to] = [Number(start[1]), Number(range[1])];
        const base = value.slice(0, value.length - start[1]!.length);
        if (to > from && to - from <= 12) for (let n = from + 1; n <= to; n++) keys.add(`${prefix}:${base}${n}`);
      }
    }
  }
  return keys;
}

const subKeys = (keys: Set<string>) => [...keys].filter((k) => k.includes("/"));

/** Title without catalogue numbers, keys, punctuation: for exact-title fallback matching. */
function bareTitleOf(title: string): string {
  let t = title.replace(/\([^)]*\)/g, " ").replace(OPUS, " ");
  for (const [, re] of CATALOGUES) t = t.replace(re, " ");
  return normalize(t.replace(/\b(?:in\s+)?[A-G](?:[- ](?:flat|sharp))?\s+(?:major|minor)\b/gi, " "))
    .replace(/\b(no|nr)\s*(\d+)/g, "$2")
    .trim();
}

const KEY = /\b([A-G])(?:[- ](flat|sharp))?\s+(major|minor)\b/i;

/** "Prelude in C-sharp minor" → "c sharp minor"; null if no key is named. */
function musicalKeyOf(title: string): string | null {
  const m = KEY.exec(title);
  return m ? [m[1], m[2], m[3]].filter(Boolean).join(" ").toLowerCase() : null;
}

export interface Candidate {
  title: string;
}

const systems = (keys: Set<string>) => new Set([...keys].map((k) => k.slice(0, k.indexOf(":"))));

/**
 * The best candidate (same composer) for a title, or null if none or ambiguous.
 *
 * - Exact sub-number matches (op:18/1) beat parent matches ("String Quartets, Op.18").
 * - Catalogue numbers aren't unique (reused opus numbers, arrangement pages), so among
 *   candidates sharing one, an equal bare title breaks the tie.
 * - Without a shared number, equal bare titles match if only one side has catalogue
 *   numbers ("String Quartet No. 1" ≈ "String Quartet No.1, Op.50"), or if the two use
 *   different catalogue systems (Bartók BB vs Sz) and the title includes a number.
 * - Titles naming different keys are different works, unless they share a number that
 *   identifies one work (a source with the wrong key).
 */
export function matchWork<C extends Candidate>(title: string, candidates: C[]): C | null {
  const keys = catalogueKeys(title);
  const bare = bareTitle(title);
  const key = musicalKey(title);
  let best: C[] = [];
  let bestScore = 0;
  for (const c of candidates) {
    const ck = catalogueKeys(c.title);
    // Different keys mean different works, unless they share a number that identifies
    // one work (K. 172, or Op.18 No.1, not a bare opus): then a source got the key wrong.
    const ckey = key && musicalKey(c.title);
    const unique = [...keys].some((k) => ck.has(k) && (!k.startsWith("op:") || k.includes("/")));
    if (key && ckey && key !== ckey && !unique) continue;
    const sameBare = bare.length > 3 && bare === bareTitle(c.title);
    // 4: a number that identifies one work (K. 172, G.215, Op.18 No.1); opus numbers are
    // reused, so a shared bare opus is weaker: 3, or 2 if only one side names a No.
    let catalogue = 0;
    if (unique) catalogue = 4;
    else if ([...keys].some((k) => k.startsWith("op:") && !k.includes("/") && ck.has(k))) {
      // Same opus; if both name different sub-numbers it's a different work.
      const mine = subKeys(keys);
      const theirs = subKeys(ck);
      catalogue = mine.length && theirs.length ? 0 : mine.length || theirs.length ? 2 : 3;
    }
    let score = 0;
    if (catalogue) score = catalogue * 2 + (sameBare ? 1 : 0);
    else if (sameBare) {
      const oneSided = !(keys.size && ck.size);
      const otherSystem = ![...systems(keys)].some((s) => systems(ck).has(s)) && /\d/.test(bare);
      if (oneSided || otherSystem) score = 1;
    }
    if (score > bestScore) [best, bestScore] = [[c], score];
    else if (score === bestScore && score > 0) best.push(c);
  }
  return best.length === 1 ? best[0]! : null;
}

// ---- Composers -------------------------------------------------------------

/** "Beethoven, Ludwig van" → { surname: "beethoven", given: ["ludwig","van"] } */
export function splitImslpName(name: string): { surname: string; given: string[] } {
  const i = name.indexOf(", ");
  if (i < 0) return { surname: normalize(name), given: [] };
  return { surname: normalize(name.slice(0, i)), given: normalize(name.slice(i + 2)).split(" ").filter(Boolean) };
}

/** Index of IMSLP composer names by normalized surname (also by the surname's last word). */
export class ComposerIndex {
  private bySurname = new Map<string, string[]>();

  constructor(names: Iterable<string>) {
    for (const n of names) {
      const { surname } = splitImslpName(n);
      for (const key of new Set([surname, surname.split(" ").at(-1)!])) {
        const list = this.bySurname.get(key) ?? [];
        list.push(n);
        this.bySurname.set(key, list);
      }
    }
  }

  /**
   * Finds the IMSLP name for a composer known as e.g. name "Beethoven", complete
   * name "Ludwig van Beethoven". Requires the given names to agree, and a unique hit.
   */
  find(shortName: string, completeName: string): string | null {
    const full = normalize(completeName).split(" ");
    const keys = new Set([normalize(shortName), full.at(-1)!]);
    const hits = new Set<string>();
    for (const k of keys) {
      for (const cand of this.bySurname.get(k) ?? []) {
        const { surname, given } = splitImslpName(cand);
        const fullStr = ` ${full.join(" ")} `;
        if (!fullStr.includes(` ${surname} `) && !surname.endsWith(` ${full.at(-1)}`)) continue;
        // All given names must agree ("Bach, Johann Christian" is not Johann Sebastian).
        if (given.some((g) => g.length > 1 && !full.includes(g))) continue;
        hits.add(cand);
      }
    }
    return hits.size === 1 ? [...hits][0]! : null;
  }
}

/** "Reicha, Anton" → "Anton Reicha" */
export function displayName(imslpName: string): string {
  const m = /^([^,]+), (.+)$/.exec(imslpName);
  return m ? `${m[2]} ${m[1]}` : imslpName;
}
