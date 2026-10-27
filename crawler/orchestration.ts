// Orchestral scoring from IMSLP: the names of an edition's parts ("Flute 1, 2",
// "Horn 3/4 (F)", "Violins I") and the Instrumentation field ("2 flutes, 2 oboes, …").

import { DOUBLED, ORCHESTRA_KEYS, parseOrchestration, SECTIONS, type Orchestration } from "../src/lib/orchestration.ts";

// Instrument names (English, Italian, German, French; singular and plural) → code.
// Strings all become "str": an orchestra has a string section or it doesn't.
const NAMES: [RegExp, string][] = [
  [/^(piccolos?|piccolo flutes?|flauto piccolo|ottavino|kleine flöte|petite flûte)$/, "picc"],
  [/^(alto flutes?|flauto contralto)$/, "afl"],
  [/^(bass flutes?|flauto basso|bassflöte)$/, "bfl"],
  [/^(heckelphone?s?|heckelphon)$/, "hck"],
  [/^(bass oboes?|oboe basso)$/, "bob"],
  [/^(contrabass clarinets?|kontrabassklarinette)$/, "cbcl"],
  [/^(flutes?|flauti|flauto|flöten?|flûtes?|fl)$/, "fl"],
  [/^(english horns?|cor anglais|cors anglais|corno inglese|englischhorn)$/, "eh"],
  [/^(oboes? d'amore|oboe damore)$/, "oda"],
  [/^(oboes?|oboi|oboe|hoboen?|hautbois|ob)$/, "ob"],
  [/^(e-?flat clarinets?|eb clarinets?|clarinet in eb|piccolo clarinets?)$/, "ebcl"],
  [/^(bass clarinets?|clarinetto basso|bassklarinette)$/, "bcl"],
  [/^(basset horns?|corno di bassetto|bassetthorn)$/, "bhn"],
  [/^(clarinets?|clarinetti|clarinetto|klarinetten?|clarinettes?|cl)$/, "cl"],
  [/^(contrabassoons?|contrabassons?|double bassoons?|contrafagotto|kontrafagott|contrebasson)$/, "cbn"],
  [/^(bassoons?|fagotti|fagotto|fagotte?|bassons?|fg)$/, "bn"],
  [/^(wagner tubas?|tenor tubas?)$/, "wtba"],
  [/^(horns?|french horns?|corni|corno|hörner|cors?|hn)$/, "hn"],
  [/^(cornets?|cornetti|cornets à pistons|cornet à pistons|kornett)$/, "crt"],
  [/^(flugelhorns?|flügelhorn)$/, "flhn"],
  [/^((bass |piccolo )?trumpets?|trombe|tromba|trompeten?|trompettes?|clarini|clarino|tpt)$/, "tpt"],
  [/^((alto |tenor |bass )?trombones?|tromboni|posaunen?|(alt|tenor|bass)posaune)$/, "tbn"],
  [/^(tubas?|bass tubas?|contrabass tubas?|basstuba|ophicl[eé][iï]des?|ophikleiden?|cimbasso)$/, "tba"],
  [/^(euphoniums?|baritone horns?)$/, "euph"],
  [/^(timpani|tympani|timpano|kettledrums?|pauken?|timbales)$/, "timp"],
  [
    /^(percussion|percussions|schlagzeug|batterie|drums|snare drums?|side drums?|bass drums?|cymbals?|piatti|triangles?|tambourines?|glockenspiel|xylophone|tam-?tam|gong|tubular bells|bells?|chimes|carillon|crotales|tam[- ]?tams?|percussionists?|castanets|wood ?blocks?|tom-?toms?|vibraphone|marimba|whip|rattle|tenor drum|military drum|crash cymbals?|suspended cymbals?|tamburo|gran cassa|grosse caisse|tambour|campanelli|große trommel|kleine trommel|becken|triangel|(large |small )?drums?|rute|cowbells?|sleigh bells|drum set|drum kit|drumset|claves|temple blocks?|anvil|wind machine|thunder machine|thunder sheet|ratchet)$/,
    "perc",
  ],
  [/^(harps?|arpa|arpe|harfen?|harpes?)$/, "hp"],
  [/^(celestas?|celesta|célesta)$/, "cel"],
  [/^(pianos?|pianoforte|klavier)( 4[- ]?hands| four hands| duet| zu 4 händen)?$/, "pf"],
  [/^(organ|organo|orgel|orgue)$/, "org"],
  [/^(harmonium|physharmonica)$/, "harm"],
  [/^(recorders?|blockflöten?|flauto dolce|flûte à bec)$/, "rec"],
  [/^(harpsichord|cembalo|clavecin)$/, "hpd"],
  [/^(continuo|basso continuo|b\.?c\.?)$/, "bc"],
  [/^((acoustic |classical )?guitars?|chitarra|gitarre)$/, "gtr"],
  [/^(mandolins?|mandolino)$/, "mand"],
  [/^((soprano |alto |tenor |baritone )?(saxophones?|sax))$/, "sax"],
  [
    /^(violins?|violini|violino|violinen?|violons?|violas?|viole|bratschen?|altos?|cellos?|violoncellos?|violoncelli|violoncelle|basses|double bass(es)?|double-bass(es)?|contrabass(es|i|o)?|contrabbass[io]|kontrabässe|kontrabass|contrebasses?|bass|basse|basso|bassi|string bass|violone|strings?|string parts|strings parts|string orchestra|streichorchester)$/,
    "str",
  ],
];
// "B{{flat}} Clarinet 1", "F Horn", "Horn part": the key or "part" aside, an instrument
const instrument = (name: string): string | undefined =>
  NAMES.find(([re]) => re.test(name))?.[1] ??
  (/^[a-g][b#]? \S/.test(name)
    ? instrument(name.replace(/^[a-g][b#]? /, ""))
    : / [a-g][b#]?$/.test(name)
      ? instrument(name.replace(/ [a-g][b#]?$/, "")) // "Trumpet Bb"
      : /\s+parts?$/.test(name)
        ? instrument(name.replace(/\s+parts?$/, ""))
        : undefined);

/**
 * Descriptions that aren't the orchestra's instruments, but not instruments we failed to
 * read either: voices ("Soprano", "Tenor II", "Bass 'ripieno'"), scores and reductions.
 * Anything else we can't read is a requirement we don't know ("Alto Horn", "Typewriter"),
 * and the scoring is incomplete.
 */
const VOICE_WORDS = new Set(
  ("soprano alto mezzo contralto tenor baritone bass basso treble voice voices chorus choir coro canto cantus altus tenore taille quinto quintus bassus " +
    "superius discantus soli solo solos soloist tutti ripieno concerto concertino recitative narrator speaker mixed male female children childrens " +
    "haute-contre dessus haute contre ut").split(" "),
);
const harmless = (description: string) => {
  const d = clean(description).replace(/["“”'‘’]/g, "");
  if (/\b(score|reduction|rehearsal|vocal parts|choral parts|orchestral parts|musicxml|midi|lilypond|sibelius|finale)\b/.test(d)) return true;
  const words = d.replace(/\b(\d+|[ivx]+)\b/g, " ").split(/[\s,&/]+/).filter(Boolean);
  // "SATB", "SSATB": voices too
  return words.length === 0 || words.every((w) => VOICE_WORDS.has(w.replace(/e?s$/, "")) || VOICE_WORDS.has(w.replace(/s$/, "")) || VOICE_WORDS.has(w) || /^[satb]{2,8}$/.test(w) || w.length === 1);
};
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
    .replace(/\s+(?:en|in) (?:do|ré|re|mi|fa|sol|la|si|ut)(?: ?(?:b|#|bémol|bemolle|dièse))?(?=\s|$|[,/])/gi, " ") // "Cor en Fa", "Clarinetto in Si b"
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The asides in a part's name, fragment by fragment: "Flute 3/4 (3 also Piccolo, 4 also Alto Flute)" → ["3 also piccolo", "4 also alto flute"] */
function asides(raw: string): string[] {
  const t = raw.replace(/\{\{flat\}\}/gi, "b").replace(/\{\{sharp\}\}/gi, "#").replace(/<[^>]*>/g, " ").replace(/\*/g, "");
  return [...t.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)]
    .flatMap((m) => m[1]!.replace(/\([^()]*\)/g, " ").split(/\s*[,;]\s*/))
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
}

// Asides that say nothing about what's required: keys, clefs, transpositions, editorial notes
const NOT_A_REQUIREMENT =
  /^(in\s+|en\s+)?([a-g][b#]?|do|ré|re|mi|fa|sol|la|si|ut)(\s*[-/]\s*[a-g][b#]?)*(\s+(major|minor|alto|tenor|treble|bass|basso|alto))?$|^(alto|tenor|bass|treble|soprano)$|clef|transpos|original|edition|version|optional|ad lib|divisi|\bdiv\b|\bsolo\b|tutti|score|reduction|cue|small|large|on ?stage|off ?stage|ossia|alt\.|\bor\b.*\b(part|staff)\b|^\d+(st|nd|rd|th)?$/;

/**
 * What an aside requires: players ("2 players"), a doubling ("3 also piccolo", "doubling
 * English horn") of the section an instrument here belongs to, nothing, or something about
 * instruments we can't place ("alto or bass flute"): unresolved.
 */
function readAside(aside: string, here: Set<string>): { players?: number; doubles?: string } | "unresolved" | null {
  const players = /^(\d+)\s+(players?|percussionists|timpanists|desks?)$/.exec(aside);
  if (players) return { players: Number(players[1]) };
  const also = /^(?:(?:\d+|[ivx]+)(?:st|nd|rd|th)?\s+)?(?:also|doubling|doubles|double|auch|=)\s+(.+)$/.exec(aside);
  if (also) {
    const k = instrument(also[1]!.replace(/\s+\d+$/, "").replace(/s$/, "")) ?? instrument(also[1]!.replace(/\s+\d+$/, ""));
    if (!k) return "unresolved";
    const main = sectionOf(k)!;
    // "Bass Oboe (also Oboe 3)": an oboe part we count anyway
    if ([...here].some((h) => h === k || sectionOf(h) === k)) return null;
    if (DOUBLED[k] && [...here].some((h) => h === DOUBLED[k] || sectionOf(h) === DOUBLED[k])) return { doubles: `${main}/${k}` };
    return "unresolved";
  }
  if (NOT_A_REQUIREMENT.test(aside)) return null;
  // "Flute 1/2 (Piccolo)": the section's auxiliary, doubled
  const bare = instrument(aside.replace(/s$/, "")) ?? instrument(aside);
  if (bare && DOUBLED[bare] && [...here].some((h) => h === DOUBLED[bare] || sectionOf(h) === DOUBLED[bare])) return { doubles: `${sectionOf(bare)}/${bare}` };
  // Naming an instrument, any other way ("Alto or Bass Flute", "with Tuba"): one we can't place
  const words = aside.split(/\s+/);
  // The continuo and what realises it ("Continuo (Organ)", "Organ (continuo)") are one part
  const realises = (k: string) => (here.has("bc") && ["org", "hpd", "pf", "str", "gtr"].includes(k)) || (k === "bc" && ["org", "hpd", "pf", "str"].some((h) => here.has(h)));
  for (let i = 0; i < words.length; i++)
    for (let j = i + 1; j <= Math.min(words.length, i + 3); j++) {
      const k = instrument(words.slice(i, j).join(" ").replace(/s$/, "")) ?? instrument(words.slice(i, j).join(" "));
      if (k) return here.has(k) || realises(k) ? null : "unresolved";
    }
  return null;
}

// Part numbers: "3", or roman up to XX ("viii")
const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];
const num = (t: string) => (/^\d+$/.test(t) ? Number(t) : ROMAN.indexOf(t) > 0 ? ROMAN.indexOf(t) : undefined);

export interface PartsResult {
  orchestration: Orchestration;
  /** Descriptions that look like instruments but weren't recognized */
  unknown: string[];
  /** Of those, the ones that are requirements we can't read (not voices, scores, …) */
  unresolved: string[];
  /** Instrument parts named one by one (not "Complete Parts" alone) */
  named: number;
}

const unresolvedOf = (unknown: string[]) => unknown.filter((u) => !harmless(u));

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
  const doublings = new Map<string, Set<string>>();
  let percSheets = 0;
  let named = 0;
  for (const raw of descriptions) {
    const d = clean(raw).replace(/[.:]$/, "");
    // An offstage band's parts aren't the orchestra's
    if (!d || IGNORE.test(d) || /^\d/.test(d) || OFFSTAGE.test(raw) || STAND_IN.test(raw)) continue;
    // "Flute 1, 2, 3/Piccolo" → [flute 1] [2] [3/piccolo]
    // "Trumpet 1 or Soprano Saxophone": the first is the part, the rest alternatives
    const pieces = d.replace(/\s+or\s+[^,;&+]*/g, "").split(/\s*(?:,|&|;|\+|\band\b|\bund\b|\bet\b|\be\b)\s*/).filter(Boolean);
    let last: string | undefined;
    let sheetPerc = false;
    let sheetOther = false;
    /** The instruments this description names */
    const here = new Set<string>();
    for (const piece of pieces) {
      if (IGNORE.test(piece)) continue;
      const subs = piece.split(/\s*\/\s*/).map((x) => x.replace(/\s+parts?$/, "")); // "Horn 2 part"
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
          // Not keys and clefs left over ("Clarinet 1 (A), B{{flat}} (transposed)")
          if (name && !IGNORE.test(name) && !/^([a-g][b#]?|original|transposed|treble|bass|alto|tenor) ?(clef)?$/.test(name)) unknown.push(raw);
          last = undefined;
          continue;
        }
        const prev = last;
        here.add(k);
        last = k === "perc" ? undefined : k;
        if (k === "perc") {
          sheetPerc = true;
          if (range) percSheets = Math.max(percSheets, range.at(-1)! - 1);
          continue;
        }
        sheetOther = true;
        named++;
        // "Flute 3/Piccolo", "Piano/Celesta": the same player doubling ("Trombone 3/Tuba" isn't)
        if (i > 0 && prev && DOUBLED[k] === sectionOf(prev)) {
          const key = `${sectionOf(prev)}/${k}`;
          doublings.set(key, (doublings.get(key) ?? new Set()).add(subs.slice(0, i).join("/")));
          last = prev; // "Flute 2/Piccolo, 3": the 3 is a flute
          continue;
        }
        if (i > 0 && num(subs[i - 1]!.split(" ").at(-1)!) !== undefined && sectionOf(k) === sectionOf(prev)) continue;
        if (range) numbered[k] = Math.max(numbered[k] ?? 0, range.at(-1)!);
        else if (/^(alto|tenor|bass) (trombone|posaune|trumpet)|^(alt|tenor|bass)posaune|^(soprano|alto|tenor|baritone|bass) saxophone/.test(name)) {
          if (!variants.has(k)) variants.set(k, new Set());
          variants.get(k)!.add(name.replace(/s$/, ""));
        } else plain[k] = Math.max(plain[k] ?? 0, isPlural(name) || FOUR_HANDS.test(name) ? 2 : 1);
      }
    }
    if (sheetPerc && !sheetOther) percSheets++;
    else if (sheetPerc) percSheets = Math.max(percSheets, 1); // "Timpani/Triangle"
    // What the asides require: "(3 also Piccolo)", "(2 players)"; anything else they say
    // about instruments we can't place
    asides(raw).forEach((aside, i) => {
      const read = readAside(aside, here);
      if (read === "unresolved") unknown.push(raw);
      else if (read?.players) {
        const only = [...here][0];
        if (here.size === 1 && only === "perc") percSheets = Math.max(percSheets, read.players);
        else if (here.size === 1 && only) plain[only] = Math.max(plain[only] ?? 0, read.players);
      } else if (read?.doubles) doublings.set(read.doubles, (doublings.get(read.doubles) ?? new Set()).add(`${raw}#${i}`));
    });
  }
  const o: Orchestration = {};
  for (const k of new Set([...Object.keys(numbered), ...Object.keys(plain), ...variants.keys()]))
    o[k] = Math.max(numbered[k] ?? 0, plain[k] ?? 0) + (variants.get(k)?.size ?? 0);
  if (percSheets) o.perc = percSheets;
  if (o.str) o.str = 1;
  for (const [k, sheets] of doublings) o[k] = Math.min(sheets.size, o[k.split("/")[0]!] ?? sheets.size);
  const u = [...new Set(unknown)];
  return { orchestration: o, unknown: u, unresolved: unresolvedOf(u), named };
}

/** "Piano 4-hands": two pianists */
const FOUR_HANDS = /(4[- ]?hands|four hands|duet|zu 4 händen)$/;

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
  // "(2nd also piccolo)", "(doubling English horn)": a doubling, as parts write it
  const doubled = text.replace(/\(\s*(?:(?:\d+(?:st|nd|rd|th)|one|1|i+)\s+)?(?:also|doubling|doubles|double|auch|=)\s+([^()]*(?:\([^()]*\)[^()]*)?)\)/gi, "/$1");
  // After an "Orchestra:" label, if there is one: before it come soloists and voices
  const all = clean(doubled);
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
    const m = /^(?:(\d+|one|two|three|four|five|six|seven|eight|a)\.?\s+)?(.+?)(?:\s+(?:\d+|[iv]+))?(?:\s*\/\s*(.*))?$/.exec(item.replace(/[.)]+$/, ""))!;
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
    else o[k] = (o[k] ?? 0) + (FOUR_HANDS.test(m[2]!) ? 2 * n : n);
    const also = m[3] && instrument(m[3].trim().replace(/s$/, ""));
    if (also && DOUBLED[also] === sectionOf(k)) o[`${sectionOf(k)}/${also}`] = (o[`${sectionOf(k)}/${also}`] ?? 0) + 1;
  }
  if (Object.keys(o).length < 3) return null;
  return { orchestration: o, unknown, unresolved: unresolvedOf(unknown), named: Object.keys(o).length };
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

/** One reading of a work's scoring: an edition's parts, the Instrumentation field, a library's copy */
export interface Reading {
  o: Orchestration;
  source: "parts" | "text" | "rism";
  /** IMSLP page id, RISM source id */
  ref: string;
  unresolved: string[];
  /** Parts named one by one */
  named: number;
}

export interface Scoring {
  o: Orchestration;
  /**
   * confirmed: two readings agree (editions, the Instrumentation field, library copies);
   * single: one reading, its parts named one by one; partial: requirements we can't read,
   * or no reading of the whole orchestra. Only confirmed and single scorings say what an
   * orchestra can play.
   */
  status: "confirmed" | "single" | "partial";
  /** What it's read from: "2 editions' parts and the Instrumentation field" */
  basis: string;
  unresolved: string[];
  source: "imslp" | "rism";
  ref: string;
}

/** What two readings must agree on: each instrument's players (not percussion sheets, nor doublings, which parts often leave out) */
const signature = (o: Orchestration) =>
  ORCHESTRA_KEYS.filter((k) => !k.includes("/") && k !== "perc" && o[k])
    .map((k) => `${k}${o[k]}`)
    .join(" ");
const size = (o: Orchestration) => Object.entries(o).reduce((n, [k, v]) => n + (k.includes("/") ? 0 : v), 0);

function basisOf(readings: Reading[]): string {
  const n = (source: Reading["source"]) => readings.filter((r) => r.source === source).length;
  const parts = n("parts");
  return [
    parts && (parts === 1 ? "an edition's parts" : `${parts} editions' parts`),
    n("text") && "the Instrumentation field",
    n("rism") && (n("rism") === 1 ? "a library's copy" : `${n("rism")} libraries' copies`),
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1");
}

/**
 * The scoring the readings support. IMSLP's (each edition's parts, the Instrumentation
 * field) decide it when any reads as the whole orchestra (`whole`; from parts, only when
 * they name them one by one); libraries' copies only when none does, as copies often add
 * parts or arrange. When those readings agree, the scoring is theirs; when they differ,
 * each instrument at the most any asks for (so it never asks for less than a version
 * needs; a piccolo part one edition prints apart and another as the 3rd flute's doubling
 * counts once). It's confirmed when two readings, copies included, give just that.
 * Percussion and doublings, which parts often leave out, are taken at the most any gives.
 * Parts uploaded on their own ("Harp") add to it. Anything a deciding reading names that
 * we can't read makes it partial; so does having no reading of the whole orchestra.
 */
export function chooseScoring(readings: Reading[], whole: (o: Orchestration) => boolean): Scoring | null {
  if (!readings.length) return null;
  const usable = readings.filter((r) => whole(r.o) && (r.source !== "parts" || r.named >= 3));
  const max = (group: Reading[]) => {
    const o: Orchestration = {};
    for (const r of group) for (const [k, v] of Object.entries(r.o)) o[k] = Math.max(o[k] ?? 0, v);
    return o;
  };
  const result = (o: Orchestration, deciding: Reading[], status: Scoring["status"], basis: string): Scoring => {
    const unresolved = [...new Set(deciding.flatMap((r) => r.unresolved))];
    const first = deciding.find((r) => r.source !== "rism") ?? deciding[0]!;
    return { o, status: unresolved.length ? "partial" : status, basis, unresolved, source: first.source === "rism" ? "rism" : "imslp", ref: first.ref };
  };
  if (!usable.length) {
    const largest = [...readings].sort((a, b) => size(b.o) - size(a.o))[0]!;
    return size(largest.o) ? result({ ...largest.o }, [largest], "partial", basisOf([largest])) : null;
  }
  const fromImslp = usable.filter((r) => r.source !== "rism");
  const deciding = fromImslp.length ? fromImslp : usable;
  const agree = new Set(deciding.map((r) => signature(r.o))).size === 1;
  const o = max(deciding);
  if (!agree) {
    // A part printed apart in one edition and doubled in another is one part
    for (const [aux, main] of Object.entries(DOUBLED)) if (o[aux] && o[`${main}/${aux}`]) o[aux] = Math.max(0, o[aux]! - o[`${main}/${aux}`]!);
  }
  const agreeing = usable.filter((r) => signature(r.o) === signature(o));
  const copies = fromImslp.length ? agreeing.filter((r) => r.source === "rism").length : 0;
  const basis =
    basisOf(deciding) +
    (agree ? "" : ", which differ: each instrument at the most any asks for") +
    (copies ? `; ${copies === 1 ? "a library's copy agrees" : `${copies} libraries' copies agree`}` : "");
  const scoring = result(o, deciding, agreeing.length >= 2 ? "confirmed" : "single", basis);
  // Parts uploaded on their own ("Harp"), beside a set of them, are the work's too: what
  // they add is added (and what we can't read in them makes the scoring partial)
  if (scoring.source === "imslp") {
    for (const r of readings) {
      if (r.source !== "parts" || usable.includes(r) || size(r.o) > 2) continue;
      for (const [k, v] of Object.entries(r.o)) if (!(k in scoring.o)) scoring.o[k] = v;
      if (r.unresolved.length) Object.assign(scoring, { status: "partial", unresolved: [...new Set([...scoring.unresolved, ...r.unresolved])] });
    }
  }
  return scoring;
}
