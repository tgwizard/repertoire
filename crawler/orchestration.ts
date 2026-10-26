// Orchestral scoring from IMSLP: the names of an edition's parts ("Flute 1, 2",
// "Horn 3/4 (F)", "Violins I") and the Instrumentation field ("2 flutes, 2 oboes, …").

import { parseOrchestration, SECTIONS, type Orchestration } from "../src/lib/orchestration.ts";

// Instrument names (English, Italian, German, French; singular and plural) → code.
// Strings all become "str": an orchestra has a string section or it doesn't.
const NAMES: [RegExp, string][] = [
  [/^(piccolos?|piccolo flutes?|flauto piccolo|ottavino|kleine flöte|petite flûte)$/, "picc"],
  [/^(alto flutes?|flauto contralto)$/, "afl"],
  [/^(flutes?|flauti|flauto|flöten?|flûtes?|fl)$/, "fl"],
  [/^(english horns?|cor anglais|cors anglais|corno inglese|englischhorn)$/, "eh"],
  [/^(oboes? d'amore|oboe damore)$/, "oda"],
  [/^(oboes?|oboi|oboe|hoboen?|hautbois|ob)$/, "ob"],
  [/^(e-?flat clarinets?|eb clarinets?|clarinet in eb|piccolo clarinets?)$/, "ebcl"],
  [/^(bass clarinets?|clarinetto basso|bassklarinette)$/, "bcl"],
  [/^(basset horns?|corno di bassetto|bassetthorn)$/, "bhn"],
  [/^(clarinets?|clarinetti|clarinetto|klarinetten?|clarinettes?|cl)$/, "cl"],
  [/^(contrabassoons?|double bassoons?|contrafagotto|kontrafagott|contrebasson)$/, "cbn"],
  [/^(bassoons?|fagotti|fagotto|fagotte?|bassons?|fg)$/, "bn"],
  [/^(wagner tubas?|tenor tubas?)$/, "wtba"],
  [/^(horns?|french horns?|corni|corno|hörner|cors?|hn)$/, "hn"],
  [/^(cornets?|cornetti|cornets à pistons|cornet à pistons|kornett)$/, "crt"],
  [/^(flugelhorns?|flügelhorn)$/, "flhn"],
  [/^((bass )?trumpets?|trombe|tromba|trompeten?|trompettes?|clarini|clarino|tpt)$/, "tpt"],
  [/^((alto |tenor |bass )?trombones?|tromboni|posaunen?|(alt|tenor|bass)posaune)$/, "tbn"],
  [/^(tubas?|bass tubas?|basstuba|ophicl[eé][iï]des?|ophikleiden?|cimbasso)$/, "tba"],
  [/^(euphoniums?|baritone horns?)$/, "euph"],
  [/^(timpani|timpano|kettledrums?|pauken?|timbales)$/, "timp"],
  [
    /^(percussion|percussions|schlagzeug|batterie|drums|snare drums?|side drums?|bass drums?|cymbals?|piatti|triangles?|tambourines?|glockenspiel|xylophone|tam-?tam|gong|tubular bells|bells|chimes|castanets|wood ?block|tom-?toms?|vibraphone|marimba|whip|rattle|tenor drum|military drum|crash cymbals?|suspended cymbal|tamburo|gran cassa|grosse caisse|tambour|campanelli|große trommel|kleine trommel|becken|triangel|(large |small )?drums?|rute|cowbells?|sleigh bells)$/,
    "perc",
  ],
  [/^(harps?|arpa|arpe|harfen?|harpes?)$/, "hp"],
  [/^(celestas?|celesta|célesta)$/, "cel"],
  [/^(pianos?|pianoforte|klavier)$/, "pf"],
  [/^(organ|organo|orgel|orgue)$/, "org"],
  [/^(harpsichord|cembalo|clavecin)$/, "hpd"],
  [/^(continuo|basso continuo|b\.?c\.?)$/, "bc"],
  [/^(guitars?|chitarra|gitarre)$/, "gtr"],
  [/^(mandolins?|mandolino)$/, "mand"],
  [/^((soprano |alto |tenor |baritone )?saxophones?)$/, "sax"],
  [
    /^(violins?|violini|violino|violinen?|violons?|violas?|viole|bratschen?|altos?|cellos?|violoncellos?|violoncelli|violoncelle|basses|double bass(es)?|double-bass(es)?|contrabass(es|i|o)?|contrabbass[io]|kontrabässe|kontrabass|contrebasses?|bass|basse|basso|bassi|strings|string parts|strings parts)$/,
    "str",
  ],
];
const instrument = (name: string) => NAMES.find(([re]) => re.test(name))?.[1];
const sectionOf = (k: string | undefined) => SECTIONS.find(([s, aux]) => s === k || aux.includes(k ?? ""))?.[0] ?? k;
const OFFSTAGE = /\bbanda\b|off-?stage|on-?stage|\bstage\b|bühnenmusik|fernorchester|en coulisse/i;
// Parts that stand in for others ("Bass Clarinet (alternate for Bassoon 1)"), or may be left out
const STAND_IN = /alternat|substitut|instead|replac|\(for [^)]*\)|\bfor (bassoons?|horns?|oboes?|trumpets?|english horn|clarinets?|flutes?|trombones?)\b|ad lib|optional/i;

// Descriptions that name no instrument, or a soloist rather than the orchestra
const IGNORE =
  /^(complete|full|cover|colou?r cover|title|engraving|condensed|piano-conductor|piano conductor|conductor|score|parts?|set|all|misc|incomplete|selected|additional|alternate|wind|brass|woodwind|winds|woodwinds|keyboard|orchestra|large orchestra|small orchestra|or)\b|\b(solo|soli|obbligato|voice|voices)\b/;

function clean(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\{\{flat\}\}/gi, "b")
    .replace(/\{\{sharp\}\}/gi, "#")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/''+/g, "")
    .replace(/\([^()]*\)/g, " ") // keys, clefs, "(transposed)", "(also piccolo)"
    .replace(/\([^()]*\)/g, " ") // nested: "(3rd also bass clarinet (Bb))"
    .replace(/\([^)]*$/, " ")
    .replace(/\*/g, "")
    .replace(/\s+in [A-G](?:b|#|-flat|-sharp| flat| sharp)?(?=\s|$|[,/])/gi, " ") // "Clarinet in B-flat"
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Part numbers: "3", or roman up to XX ("viii")
const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];
const num = (t: string) => (/^\d+$/.test(t) ? Number(t) : ROMAN.indexOf(t) > 0 ? ROMAN.indexOf(t) : undefined);

export interface PartsResult {
  orchestration: Orchestration;
  /** Descriptions that look like instruments but weren't recognized */
  unknown: string[];
}

/**
 * The scoring an edition's part names imply (stand-ins, optional and offstage parts aside): each instrument's highest part number
 * ("Horn 1/2, 3/4" → 4 horns); for an unnumbered part one player, two if the name is
 * plural ("Flauti"). Alto, tenor and bass trombones (and bass trumpets) are players of
 * their own. A part shared with another instrument after a number ("Flute 3/Piccolo")
 * is a doubling, not another player. Percussion counts a player per sheet.
 */
export function orchestrationFromParts(descriptions: string[]): PartsResult {
  const numbered: Orchestration = {};
  const plain: Orchestration = {};
  const variants = new Map<string, Set<string>>();
  const unknown: string[] = [];
  let percSheets = 0;
  for (const raw of descriptions) {
    const d = clean(raw).replace(/[.:]$/, "");
    // An offstage band's parts aren't the orchestra's
    if (!d || IGNORE.test(d) || /^\d/.test(d) || OFFSTAGE.test(raw) || STAND_IN.test(raw)) continue;
    // "Flute 1, 2, 3/Piccolo" → [flute 1] [2] [3/piccolo]
    const pieces = d.split(/\s*(?:,|&|;|\+|\band\b|\bund\b|\bet\b|\be\b)\s*/).filter(Boolean);
    let last: string | undefined;
    let sheetPerc = false;
    let sheetOther = false;
    for (const piece of pieces) {
      if (IGNORE.test(piece)) continue;
      const subs = piece.split(/\s*\/\s*/);
      for (const [i, sub] of subs.entries()) {
        const n = num(sub);
        if (n !== undefined) {
          if (last) numbered[last] = Math.max(numbered[last] ?? 0, n);
          continue;
        }
        // "horn 3", "violins i", "trombone 1-3"
        const m = /^(.*?)(?:\s+((?:\d+|[ivx]+)(?:\s*[-–]\s*(?:\d+|[ivx]+))?))?$/.exec(sub)!;
        const name = m[1]!;
        const ends = m[2]?.split(/\s*[-–]\s*/).map(num);
        const range = ends?.every((n) => n !== undefined) ? (ends as number[]) : undefined;
        const k = instrument(name);
        if (!k) {
          if (name && !IGNORE.test(name)) unknown.push(raw);
          last = undefined;
          continue;
        }
        const prev = last;
        last = k === "perc" ? undefined : k;
        if (k === "perc") {
          sheetPerc = true;
          if (range) percSheets = Math.max(percSheets, range.at(-1)! - 1);
          continue;
        }
        sheetOther = true;
        // After a number, "/Piccolo" is the same player doubling ("Trombone 3/Tuba" isn't)
        if (i > 0 && num(subs[i - 1]!.split(" ").at(-1)!) !== undefined && sectionOf(k) === sectionOf(prev)) continue;
        if (range) numbered[k] = Math.max(numbered[k] ?? 0, range.at(-1)!);
        else if (/^(alto|tenor|bass) (trombone|posaune|trumpet)|^(alt|tenor|bass)posaune|^(soprano|alto|tenor|baritone|bass) saxophone/.test(name)) {
          if (!variants.has(k)) variants.set(k, new Set());
          variants.get(k)!.add(name.replace(/s$/, ""));
        } else plain[k] = Math.max(plain[k] ?? 0, isPlural(name) ? 2 : 1);
      }
    }
    if (sheetPerc && !sheetOther) percSheets++;
    else if (sheetPerc) percSheets = Math.max(percSheets, 1); // "Timpani/Triangle"
  }
  const o: Orchestration = {};
  for (const k of new Set([...Object.keys(numbered), ...Object.keys(plain), ...variants.keys()]))
    o[k] = Math.max(numbered[k] ?? 0, plain[k] ?? 0) + (variants.get(k)?.size ?? 0);
  if (percSheets) o.perc = percSheets;
  if (o.str) o.str = 1;
  return { orchestration: o, unknown: [...new Set(unknown)] };
}

// "flutes", "flauti", "corni", "trombe", "hörner"; not "bass", "timpani", "oboe"
const isPlural = (name: string) => {
  const w = name.split(" ").at(-1)!;
  return (/(?<!s)s$|i$|^trombe$|ner$|(t|n|tt)en$|^fagotte$/.test(w) && !/^(timpani|piatti|bass|cymbals|percussion)$/.test(w));
};

const WORD_NUMBERS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, double: 2 };

/**
 * The scoring an Instrumentation field spells out ("2 flutes (2nd also piccolo), 2 oboes,
 * 4 horns, timpani, strings"), or null if it doesn't list the orchestra's instruments.
 */
export function orchestrationFromText(text: string): PartsResult | null {
  // After an "Orchestra:" label, if there is one: before it come soloists and voices
  const all = clean(text);
  const label = [...all.matchAll(/\borch(?:estra|\.)?\s*[:–-]+\s*/g)].at(-1);
  const t = label ? all.slice(label.index + label[0].length) : all;
  const o: Orchestration = {};
  const unknown: string[] = [];
  // Written in the shorthand: "3-3-3-3 4-3-3-1 percussion, 2 harps"
  let rest = t;
  const groups = [...t.matchAll(/\b\d+(?:[-.]\d+){3}\b/g)].map((m) => m[0]);
  const sections = groups.length ? parseOrchestration(groups.map((g) => g.replaceAll("-", ".")).join(" ")) : null;
  if (sections) {
    Object.assign(o, sections);
    for (const g of groups) rest = rest.replace(g, ",");
  }
  const items = rest.split(/\s*(?:,|;|:|\band\b|\+)\s*/).filter(Boolean);
  if (items.length + Object.keys(o).length < 3) return null;
  for (const item of items) {
    // "2 flutes", "two horns", "violins i", "flute/piccolo" (a doubling)
    if (IGNORE.test(item)) continue;
    const m = /^(?:(\d+|one|two|three|four|five|six|seven|eight|a)\.?\s+)?(.+?)(?:\s+(?:\d+|[iv]+))?(?:\s*\/.*)?$/.exec(item.replace(/[.)]+$/, ""))!;
    const n = m[1] ? (WORD_NUMBERS[m[1]] ?? Number(m[1])) : isPlural(m[2]!) ? 2 : 1;
    const k = instrument(m[2]!);
    if (!k) {
      unknown.push(item);
      continue;
    }
    // Named percussion instruments aren't players; "3 percussion" is
    if (k === "str") o.str = 1;
    else if (k === "perc") o.perc = Math.max(o.perc ?? 0, /^percussion/.test(m[2]!) ? n : 1);
    else if (k === "timp") o.timp = /timpanists|players/.test(item) ? n : 1; // "4 timpani" are drums
    else o[k] = (o[k] ?? 0) + n;
  }
  if (Object.keys(o).length < 3) return null;
  return { orchestration: o, unknown };
}

// RISM's instrument abbreviations (MARC 594 $b). Strings are counted in part copies,
// not players, so they only say there is a string section.
const RISM: [RegExp, string][] = [
  [/^fl\.?picc|^ottavino/, "picc"],
  [/^fl(\b|\.|$)|^fl traverso|^trav/, "fl"],
  [/^cor ingl|^ob da caccia/, "eh"],
  [/^ob d'amore/, "oda"],
  [/^ob\b/, "ob"],
  [/^b-cl/, "bcl"],
  [/^cor di bassetto|^bassetthorn/, "bhn"],
  [/^cl\b/, "cl"],
  [/^contra-?fag/, "cbn"],
  [/^fag\b/, "bn"],
  [/^cor\b|^cor$/, "hn"],
  [/^(tr|clno|tromba)\b/, "tpt"],
  [/^(piston|cornetto a pistoni|cnt a pist)/, "crt"],
  [/^flügelhorn/, "flhn"],
  [/^[atb]?-?trb\b|^trb$/, "tbn"],
  [/^(tb|tuba|bombardone|ophicleide|serpentone|cimbasso)\b/, "tba"],
  [/^euphonium/, "euph"],
  [/^timp/, "timp"],
  [/^(gran cassa|triangolo|piatti|tamb|tamburino|tamburo|cassa|cymbal|glockenspiel|campanelli|tam-tam|perc|batteria|xilofono)/, "perc"],
  [/^arp/, "hp"],
  [/^(cemb|hpcd)\b/, "hpd"],
  [/^org\b/, "org"],
  [/^pf\b/, "pf"],
  [/^bc\b/, "bc"],
  [/^(vl|vla|vlc|b|cb|vlne|strings|violetta|"bassi")\b/, "str"],
];
// Voices, soloists and unspecified parts aren't the orchestra.
const RISM_SKIP = /^(S|A|T|B|V|Bariton|Mezzo-S|Contra-[AT]|Coro|.* coro|.*\bsolo\b|iSol|principale|.*\bprinc\b|no indication|no further indication|i|\d+|treble|dessus|taille|orch)\b/;

/** A RISM source's parts as an orchestration, or null if it has parts we can't name. */
export function orchestrationFromRism(scoring: [string, number][]): Orchestration | null {
  const o: Orchestration = {};
  for (const [name, n] of scoring) {
    if (RISM_SKIP.test(name)) continue;
    const k = RISM.find(([re]) => re.test(name))?.[1];
    if (!k) return null;
    if (k === "str") o.str = 1;
    else if (k === "perc") o.perc = 1;
    else o[k] = (o[k] ?? 0) + n;
  }
  return o;
}

const WINDS_AND_BRASS = ["fl", "picc", "afl", "ob", "eh", "oda", "cl", "ebcl", "bcl", "bhn", "bn", "cbn", "hn", "wtba", "tpt", "crt", "flhn", "tbn", "tba", "euph"];

/**
 * Whether a scoring is plausibly a whole orchestra's: strings and at least one wind,
 * brass or timpani part. A string section alone usually means only the string parts
 * were uploaded.
 */
export const isFullOrchestra = (o: Orchestration) => !!o.str && (WINDS_AND_BRASS.some((k) => o[k]) || !!o.timp);

/** Each instrument's largest count across several readings of the same scoring. */
export function mergeOrchestrations(list: Orchestration[]): Orchestration {
  const out: Orchestration = {};
  for (const o of list) for (const [k, n] of Object.entries(o)) out[k] = Math.max(out[k] ?? 0, n);
  return out;
}
