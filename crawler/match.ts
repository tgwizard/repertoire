// Matching works and composers across sources that share no identifiers.

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
  ["s", /\bS\.?\s*(\d{2,3}[a-z]?)\b/g], // Liszt (S. 244)
  ["h", /\bH\.?\s*(\d{2,3}[a-z]?)\b/g], // Martinů
];

const OPUS = /\bOp(?:us)?\.?\s*(?:posth\.?\s*)?(\d+[a-z]?)(?:\s*,?\s*(?:No|Nr|N°|n°)\.?\s*(\d+[a-z]?))?/gi;

/**
 * Catalogue keys in a title: "String Quartet No.1, Op.18 No.1" → {"op:18", "op:18/1"};
 * "Piano Concerto No.20 in D minor, K.466" → {"k:466"}.
 */
export function catalogueKeys(title: string): Set<string> {
  const keys = new Set<string>();
  for (const m of title.matchAll(OPUS)) {
    const op = m[1]!.toLowerCase();
    keys.add(`op:${op}`);
    if (m[2]) keys.add(`op:${op}/${m[2].toLowerCase()}`);
  }
  for (const [prefix, re] of CATALOGUES) {
    for (const m of title.matchAll(re)) keys.add(`${prefix}:${m[1]!.toLowerCase().replace(/\s+/g, "")}`);
  }
  return keys;
}

const subKeys = (keys: Set<string>) => [...keys].filter((k) => k.includes("/"));

/** Title without catalogue numbers, keys, punctuation: for exact-title fallback matching. */
export function bareTitle(title: string): string {
  return normalize(
    title
      .replace(/\([^)]*\)/g, " ")
      .replace(OPUS, " ")
      .replace(/\b(?:in\s+)?[A-G](?:[- ](?:flat|sharp))?\s+(?:major|minor)\b/gi, " "),
  )
    .replace(/\b(no|nr)\s*(\d+)/g, "$2")
    .trim();
}

export interface Candidate {
  title: string;
}

/**
 * The best candidate (same composer) for a title, or null if none or ambiguous.
 * Exact sub-number matches (op:18/1) beat parent matches ("String Quartets, Op.18"),
 * which beat bare-title equality.
 */
export function matchWork<C extends Candidate>(title: string, candidates: C[]): C | null {
  const keys = catalogueKeys(title);
  const bare = bareTitle(title);
  let best: C[] = [];
  let bestScore = 0;
  for (const c of candidates) {
    const ck = catalogueKeys(c.title);
    let score = 0;
    const exactSub = subKeys(keys).some((k) => ck.has(k));
    if (exactSub) score = 3;
    else {
      const shared = [...keys].some((k) => !k.includes("/") && ck.has(k));
      if (shared) {
        // Same opus/catalogue number. If both specify different sub-numbers it's a different work.
        const mine = subKeys(keys);
        const theirs = subKeys(ck);
        if (mine.length && theirs.length) score = 0;
        else score = mine.length || theirs.length ? 2 : 3;
      } else if (keys.size === 0 && ck.size === 0 && bare.length > 3 && bare === bareTitle(c.title)) {
        score = 1;
      }
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
        const firstGiven = given.find((g) => g.length > 1);
        if (firstGiven && !full.includes(firstGiven)) continue;
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
