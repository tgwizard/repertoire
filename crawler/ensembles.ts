// How non-IMSLP sources map onto line-ups. Deliberately conservative: only names
// that pin down an exact instrumentation map to an ensemble; ambiguous ones (a
// "string quintet" may have two violas or two cellos) only count as a ranking signal.

import { decodeEnsemble, type Ensemble } from "../src/lib/instrumentation.ts";

const E = (s: string): Ensemble => decodeEnsemble(s);

const STRING_QUARTET = E("violin:2,viola,cello");
const WIND_QUINTET = E("flute,oboe,clarinet,bassoon,horn");
const PIANO_TRIO = E("violin,cello,piano");
const PIANO_QUARTET = E("violin,viola,cello,piano");
const PIANO_QUINTET = E("violin:2,viola,cello,piano");
const BRASS_QUINTET = E("trumpet:2,horn,trombone,tuba");
const CLARINET_QUINTET = E("clarinet,violin:2,viola,cello");
const STRING_TRIO = E("violin,viola,cello");
const STRING_SEXTET = E("violin:2,viola:2,cello:2");
const HORN_TRIO = E("horn,violin,piano");
const CLARINET_TRIO = E("clarinet,cello,piano");
const ORCHESTRA = E("orchestra");

/** English Wikipedia "Compositions for …" categories. null = signal only. */
export const WIKIPEDIA_CATEGORIES: Record<string, Ensemble | null> = {
  "Compositions for string quartet": STRING_QUARTET,
  "Compositions for wind quintet": WIND_QUINTET,
  "Compositions for piano trio": PIANO_TRIO,
  "Compositions for piano quartet": PIANO_QUARTET,
  "Compositions for piano quintet": PIANO_QUINTET,
  "Compositions for brass quintet": BRASS_QUINTET,
  "Compositions for clarinet quintet": CLARINET_QUINTET,
  "Compositions for clarinet trio": CLARINET_TRIO,
  "Compositions for horn trio": HORN_TRIO,
  "Compositions for string trio": STRING_TRIO,
  "Compositions for string sextet": STRING_SEXTET,
  "Compositions for clarinet, violin, cello and piano": E("clarinet,violin,cello,piano"),
  "Compositions for violin and piano": E("violin,piano"),
  "Compositions for cello and piano": E("cello,piano"),
  "Compositions for viola and piano": E("viola,piano"),
  "Compositions for flute and piano": E("flute,piano"),
  "Compositions for clarinet and piano": E("clarinet,piano"),
  "Compositions for oboe and piano": E("oboe,piano"),
  "Compositions for horn and piano": E("horn,piano"),
  "Compositions for saxophone and piano": E("saxophone,piano"),
  "Compositions for two violins": E("violin:2"),
  "Compositions for two guitars": E("guitar:2"),
  "Compositions for two pianos": E("piano:2"),
  "Compositions for piano four-hands": E("piano 4 hands"),
  "Compositions for solo piano": E("piano"),
  "Compositions for violin and orchestra": E("violin,orchestra"),
  "Compositions for viola and orchestra": E("viola,orchestra"),
  "Compositions for cello and orchestra": E("cello,orchestra"),
  "Compositions for piano and orchestra": E("piano,orchestra"),
  "Compositions for flute and orchestra": E("flute,orchestra"),
  "Compositions for clarinet and orchestra": E("clarinet,orchestra"),
  "Compositions for harp and orchestra": E("harp,orchestra"),
  "Compositions for saxophone and orchestra": E("saxophone,orchestra"),
  "Compositions for symphony orchestra": ORCHESTRA,
  "Compositions for chamber orchestra": ORCHESTRA,
  "Compositions for string orchestra": E("strings"),
  "Compositions for brass band": E("brass band"),
  "Concert band pieces": E("wind band"),
  "Compositions for string quintet": null,
  "Compositions for piano sextet": null,
  "Compositions for sextet": null,
  "Compositions for septet": null,
  "Compositions for octet": null,
  "Compositions for nonet": null,
};

/** Wikidata items used as instrumentation (P870), genre (P136) or type (P31) of a work. */
export const WIKIDATA_ENSEMBLES: Record<string, Ensemble> = {
  Q207338: STRING_QUARTET,
  Q1069564: WIND_QUINTET,
  Q1414262: PIANO_TRIO,
  Q1746025: PIANO_QUARTET,
  Q1746023: PIANO_QUINTET,
  Q432536: BRASS_QUINTET,
  Q239582: ORCHESTRA, // symphony orchestra
  Q1090674: E("strings"), // string orchestra
};

/** Wikidata instrument items, so a work tagged "string quartet" + "piano" isn't taken for a string quartet. */
export const WIKIDATA_INSTRUMENTS: Record<string, string> = {
  Q8355: "violin",
  Q80284: "viola",
  Q8371: "cello",
  Q80019: "double bass",
  Q5994: "piano",
  Q11405: "flute",
  Q209554: "flute", // Western concert flute
  Q8377: "oboe",
  Q8343: "clarinet",
  Q159998: "bassoon",
  Q163759: "horn",
  Q8338: "trumpet",
  Q8350: "trombone",
};

/** Whether all of a work's Wikidata instrumentation fits the given line-up. */
export function wikidataInstrumentsFit(instruments: string[], parts: Ensemble): boolean {
  return instruments.every((q) => WIKIDATA_ENSEMBLES[q] || (WIKIDATA_INSTRUMENTS[q] && parts[WIKIDATA_INSTRUMENTS[q]!]));
}

const PLAYERS: Record<string, number> = { duo: 2, trio: 3, quartet: 4, quintet: 5, sextet: 6, septet: 7, octet: 8, nonet: 9 };

/**
 * Sanity check for line-ups from non-IMSLP sources: a title naming a group size
 * ("Sextet") must agree with the line-up's number of players.
 */
export function titleFitsPlayers(title: string, parts: Ensemble): boolean {
  if (parts.orchestra || parts["chamber orchestra"] || parts.strings || parts["wind band"] || parts["brass band"]) return true;
  const players = Object.values(parts).reduce((s, n) => s + n, 0);
  const t = title.toLowerCase();
  for (const [word, n] of Object.entries(PLAYERS)) {
    if (new RegExp(`\\b${word}s?\\b`).test(t) && n !== players) return false;
  }
  return true;
}

const SOLOISTS = "violin|viola|cello|piano|flute|clarinet|oboe|horn|trumpet|bassoon|harp|guitar";

/**
 * Open Opus titles that name an exact line-up, and no other scoring ("Symphony no. 14,
 * for soprano, bass, strings…" isn't for orchestra alone); concertos only for composers
 * born 1720+ (earlier ones are for strings and continuo); sonatas for those born 1750+.
 */
export function openOpusEnsemble(title: string, genre: string, composerBorn: number | null): Ensemble | null {
  const t = title.toLowerCase();
  const rules: [RegExp, Ensemble][] = [
    [/^string quartet\b/, STRING_QUARTET],
    [/^wind quintet\b/, WIND_QUINTET],
    [/^piano trio\b/, PIANO_TRIO],
    [/^piano quartet\b/, PIANO_QUARTET],
    [/^piano quintet\b/, PIANO_QUINTET],
    [/^brass quintet\b/, BRASS_QUINTET],
    [/^clarinet quintet\b/, CLARINET_QUINTET],
    [/^clarinet trio\b/, CLARINET_TRIO],
    [/^horn trio\b/, HORN_TRIO],
    [/^string trio\b/, STRING_TRIO],
    [/^string sextet\b/, STRING_SEXTET],
  ];
  // A title that spells out its scoring ("String Quartet no. 3, for soprano and string
  // quartet") is for something other than the plain genre.
  const scored = /\bfor\b|soprano|alto\b|tenor|baritone|\bbass\b|voice|chorus|choir|organ/.test(t);
  for (const [re, e] of rules) if (re.test(t)) return scored ? null : e;
  if (genre === "Orchestral" && /^symphony\b/.test(t) && !scored) return ORCHESTRA;
  const concerto = new RegExp(`^(${SOLOISTS}) concerto\\b`).exec(t);
  if (concerto && genre === "Orchestral" && composerBorn !== null && composerBorn >= 1720) return E(`${concerto[1]},orchestra`);
  const sonata = new RegExp(`^(violin|viola|cello|flute|clarinet|oboe|horn) sonata\\b`).exec(t);
  if (sonata && genre === "Chamber" && composerBorn !== null && composerBorn >= 1750) return E(`${sonata[1]},piano`);
  return null;
}
