// IMSLP's arrangements of a work, from the file blocks under its page's "Arrangements
// and Transcriptions": who arranged what (the whole work, or an excerpt) for whom.

import { ensembleKey, parseCategory } from "../src/lib/instrumentation.ts";
import type { ImslpArrangementBlock } from "./sources/imslp-pages.ts";
import { lineupFromTitle } from "./title-lineup.ts";

export interface Arrangement {
  /** The line-up key, when the heading's "For …" reads as one of the work's */
  lineup: string | null;
  /** "Jesper Jerkert"; null when IMSLP doesn't know */
  arranger: string | null;
  /** What's arranged when it isn't the whole work: "Overture", "Selections" */
  excerpt: string | null;
  /** IMSLP's heading: "For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)" */
  heading: string;
  /** Of the files: "Public Domain", "Creative Commons Attribution-NonCommercial 4.0" */
  license: string | null;
}

const KEYS: Record<string, string> = { b: "-flat", "#": "-sharp", s: "-sharp" };

/** Wiki markup to plain text: {{K|Bb}} → "B-flat major", [[a|b]] → "b", '''x''' → "x" */
export function plain(text: string): string {
  return text
    .replace(/\{\{K\|([A-Ga-g])([b#s]?)\}\}/g, (_, n: string, acc: string) => `${n.toUpperCase()}${KEYS[acc] ?? ""} ${n === n.toUpperCase() ? "major" : "minor"}`)
    .replace(/\{\{flat\}\}/gi, "♭")
    .replace(/\{\{sharp\}\}/gi, "♯")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The arranger when IMSLP says the composer arranged it themselves */
export const THE_COMPOSER = "the composer";

/**
 * "{{LinkArr|Jesper|Jerkert||}}", "{{LinkArr|Notenschreiber}}", "Charles Di Caro (1950-)"
 * → a name; "Composer" → THE_COMPOSER; "Unknown", "composer?" → null
 */
export function arrangerName(raw: string | undefined): string | null {
  if (!raw) return null;
  const link = /\{\{Link(?:Arr|Ed|Name)\|([^|}]*)(?:\|([^|}]*))?/.exec(raw);
  const name = link ? [link[1], link[2]].map((s) => s?.trim()).filter(Boolean).join(" ") : plain(raw);
  const clean = name
    .replace(/\s*\(?\d{4}\s*[-–]\s*(\d{4})?\)?.*$/, "")
    .replace(/^[[{(]\s*(.*?)\s*[\]})]$/, "$1")
    .replace(/[\s,;.]+$/, "")
    .trim();
  if (/^(the )?composer(?:'s (?:own )?(?:transcription|arrangement))?$/i.test(clean)) return THE_COMPOSER;
  // Unknown, however put: "Anonymous (18th century)", "composer (probably)", "not credited"
  if (/\?|probabl|likely|possibl|presumabl|^(?:unknown|anonymous|anon\.?|unnamed|unspecified|unidentified|not credited|n\/a|various|-+)\b/i.test(clean)) return null;
  return clean && clean.length <= 80 ? clean : null;
}

/** The heading naming the line-up: "*For Flute, … (Jerkert)" (a leading "*" marks it typeset) */
const FOR = /^\*?\s*For\s/i;

/**
 * One block as an arrangement. `lineups` are the work's "(arr)" line-ups from IMSLP's
 * categories: the heading read the way they are (its spelling of a line-up is theirs),
 * or as a title would be, must be one of them.
 */
export function readArrangement(block: ImslpArrangementBlock, lineups: Set<string>): Arrangement | null {
  const forAt = block.headings.findLastIndex((h) => FOR.test(h));
  if (forAt < 0) return null;
  const heading = plain(block.headings[forAt]!.replace(/^\*\s*/, ""));
  // "For Piano (Sarić)": the arranger's surname, when the block doesn't name them
  const byline = /\(([^()]+)\)\s*$/.exec(heading)?.[1] ?? null;
  // Kinds of orchestra and band IMSLP files under plain "orchestra" and "wind band"
  const scoring = heading
    .replace(/\s*\([^()]*\)\s*$/, "")
    .replace(/\b(?:theat(?:er|re)|small|salon|full|large|grand) orchestra\b/i, "Orchestra")
    .replace(/\bmilitary band\b/i, "Wind Band")
    .trim();
  const category = parseCategory(scoring.replace(/^for\s/i, "For ").replace(/\s+/g, " ").toLowerCase().replace(/^for /, "For "));
  const read = category && ensembleKey(category.parts);
  const titled = lineupFromTitle(scoring);
  const lineup = [read, titled && ensembleKey(titled)].find((k) => k && lineups.has(k)) ?? null;
  const excerpt = block.headings
    .filter((h, i) => i !== forAt && !FOR.test(h) && !/^(complete|complete score|complete work|full score|scores?|parts|scores and parts)$/i.test(plain(h)))
    .map(plain)
    .filter(Boolean)
    .join(" · ");
  return {
    lineup,
    arranger: block.arranger ? arrangerName(block.arranger) : byline && !/^\d|arr\b|\?/i.test(byline) ? arrangerName(byline) : null,
    excerpt: excerpt || null,
    heading,
    license: block.copyright ? plain(block.copyright).slice(0, 120) || null : null,
  };
}

/** A page's arrangements, one per arranger, excerpt and line-up */
export function readArrangements(blocks: ImslpArrangementBlock[], lineups: Set<string>): Arrangement[] {
  const out = new Map<string, Arrangement>();
  for (const b of blocks) {
    const a = readArrangement(b, lineups);
    const key = a && JSON.stringify([a.lineup ?? a.heading, a.arranger, a.excerpt]);
    if (a && !out.has(key!)) out.set(key!, a);
  }
  return [...out.values()];
}
