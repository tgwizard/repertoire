// Parses IMSLP instrumentation category names ("For 2 violins, viola, cello",
// "For flute, piano (arr)") into ensembles: a multiset of instrument ids.

export type Ensemble = Record<string, number>;

// Words that end in "s" but are not plurals.
const NOT_PLURAL = new Set(["bass", "brass", "timpani", "hands", "childrens", "strings", "percussion"]);

function singularWord(word: string): string {
  if (NOT_PLURAL.has(word)) return word;
  if (word.endsWith("eaux")) return word.slice(0, -1); // chalumeaux
  if (/(ss|ch|sh)es$/.test(word) || word.endsWith("uses")) return word.slice(0, -2); // basses, choruses
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// Generic descriptions ("voices with keyboard", "orchestra without strings")
// are kept verbatim; they never correspond to a picked instrument anyway.
function isGeneric(part: string): boolean {
  return / with(out)? /.test(part) || part.startsWith("unaccompanied") || part.startsWith("unspecified");
}

function normalizeName(name: string, plural: boolean): string {
  let n = name.trim().replace(/^english /, "English ");
  if (plural && !isGeneric(n)) n = n.split(" ").map(singularWord).join(" ");
  return n;
}

function parsePart(raw: string): [string, number] | null {
  const part = raw.trim();
  if (!part) return null;
  // "2 violins"
  let m = /^(\d+) (.+)$/.exec(part);
  if (m) return [normalizeName(m[2]!, true), Number(m[1])];
  // Legacy "violins (2)"
  m = /^(.+) \((\d+)\)$/.exec(part);
  if (m) return [normalizeName(m[1]!, true), Number(m[2])];
  // A bare plural ("voices", "strings") means an unspecified number; keep it as its own id.
  return [normalizeName(part, false), 1];
}

export interface ParsedCategory {
  parts: Ensemble;
  arr: boolean;
}

export function parseCategory(name: string): ParsedCategory | null {
  const m = /^For (.+?)( \(arr\))?$/.exec(name);
  if (!m) return null;
  const body = m[1]!;
  if (/^\d+ players?\b/.test(body)) return null; // aggregate categories ("For 1 player", "For 4 players")
  if (!/^[A-Za-z0-9 ,'()-]+$/.test(body)) return null; // spam / malformed names

  const parts: Ensemble = {};
  const pieces = body.split(",").flatMap((p) => (isGeneric(p) ? [p] : p.split(" and ")));
  for (const piece of pieces) {
    const parsed = parsePart(piece);
    if (!parsed) return null;
    const [id, n] = parsed;
    parts[id] = (parts[id] ?? 0) + n;
  }
  return { parts, arr: Boolean(m[2]) };
}

export function ensembleKey(e: Ensemble): string {
  return Object.keys(e)
    .filter((k) => (e[k] ?? 0) > 0)
    .sort()
    .map((k) => (e[k] === 1 ? k : `${k}*${e[k]}`))
    .join(",");
}

/** Inverse of ensembleKey: "cello,viola,violin*2" → { cello: 1, viola: 1, violin: 2 } */
export function parseEnsembleKey(key: string): Ensemble {
  const e: Ensemble = {};
  for (const part of key.split(",")) {
    const m = /^(.+?)(?:\*(\d+))?$/.exec(part);
    if (m?.[1]) e[m[1]] = Number(m[2] ?? 1);
  }
  return e;
}

// ---- Palette ---------------------------------------------------------------

export type Family = "woodwinds" | "brass" | "strings" | "keyboards" | "percussion" | "voices" | "ensembles";

export interface Instrument {
  id: string;
  label: string;
  family: Family;
  max: number;
}

export const FAMILIES: { id: Family; label: string }[] = [
  { id: "woodwinds", label: "Woodwinds" },
  { id: "brass", label: "Brass" },
  { id: "strings", label: "Strings" },
  { id: "keyboards", label: "Keyboards" },
  { id: "percussion", label: "Percussion" },
  { id: "voices", label: "Voices" },
  { id: "ensembles", label: "Large ensembles" },
];

const P: [Family, string, string?][] = [
  ["woodwinds", "piccolo"],
  ["woodwinds", "flute"],
  ["woodwinds", "alto flute"],
  ["woodwinds", "recorder"],
  ["woodwinds", "oboe"],
  ["woodwinds", "oboe damore", "oboe d'amore"],
  ["woodwinds", "English horn"],
  ["woodwinds", "clarinet"],
  ["woodwinds", "basset horn"],
  ["woodwinds", "bass clarinet"],
  ["woodwinds", "bassoon"],
  ["woodwinds", "contrabassoon"],
  ["woodwinds", "soprano saxophone"],
  ["woodwinds", "alto saxophone"],
  ["woodwinds", "tenor saxophone"],
  ["woodwinds", "baritone saxophone"],
  ["woodwinds", "saxophone", "saxophone (any)"],
  ["brass", "horn"],
  ["brass", "trumpet"],
  ["brass", "cornet"],
  ["brass", "flugelhorn"],
  ["brass", "trombone"],
  ["brass", "bass trombone"],
  ["brass", "euphonium"],
  ["brass", "tuba"],
  ["strings", "violin"],
  ["strings", "viola"],
  ["strings", "cello"],
  ["strings", "double bass"],
  ["strings", "viol", "viola da gamba"],
  ["strings", "harp"],
  ["strings", "guitar"],
  ["strings", "lute"],
  ["strings", "mandolin"],
  ["keyboards", "piano"],
  ["keyboards", "piano 4 hands", "piano four hands"],
  ["keyboards", "harpsichord"],
  ["keyboards", "organ"],
  ["keyboards", "harmonium"],
  ["keyboards", "accordion"],
  ["keyboards", "celesta"],
  ["keyboards", "continuo", "basso continuo"],
  ["percussion", "percussion"],
  ["percussion", "timpani"],
  ["percussion", "marimba"],
  ["percussion", "vibraphone"],
  ["voices", "voice", "solo voice"],
  ["voices", "soprano"],
  ["voices", "alto"],
  ["voices", "tenor"],
  ["voices", "baritone"],
  ["voices", "bass", "bass (voice)"],
  ["voices", "voices", "vocal soloists"],
  ["voices", "narrator"],
  ["voices", "mixed chorus"],
  ["voices", "male chorus"],
  ["voices", "female chorus"],
  ["ensembles", "orchestra", "symphony orchestra"],
  ["ensembles", "strings", "string orchestra"],
  ["ensembles", "wind band"],
  ["ensembles", "brass band"],
];

const SINGLE = new Set(["continuo", "voices", "mixed chorus", "male chorus", "female chorus"]);

export const PALETTE: Instrument[] = P.map(([family, id, label]) => ({
  id,
  label: label ?? id,
  family,
  max: family === "ensembles" || SINGLE.has(id) ? 1 : 12,
}));

export const INSTRUMENTS = new Map(PALETTE.map((i) => [i.id, i]));

const ORDER = new Map(PALETTE.map((i, n) => [i.id, n]));

/** Ensemble parts in score order, unknown ids last. */
export function scoreOrder(e: Ensemble): [string, number][] {
  return Object.entries(e)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999) || a.localeCompare(b));
}

/** "violin" → "violins", "double bass" → "double basses", "bass (voice)" → "basses (voice)" */
export function plural(label: string): string {
  const m = /^(.*?)( \(.*\))?$/.exec(label)!;
  const word = m[1]!;
  if (/(hands|timpani|percussion|continuo)$/.test(word)) return label;
  return (/(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`) + (m[2] ?? "");
}

export function describe(e: Ensemble): string {
  return scoreOrder(e)
    .map(([id, n]) => {
      const label = INSTRUMENTS.get(id)?.label ?? id;
      return n > 1 ? `${n} ${plural(label)}` : label;
    })
    .join(", ");
}

// ---- Presets ---------------------------------------------------------------

export interface Preset {
  name: string;
  parts: Ensemble;
}

export const PRESETS: Preset[] = [
  { name: "String quartet", parts: { violin: 2, viola: 1, cello: 1 } },
  { name: "Wind quintet", parts: { flute: 1, oboe: 1, clarinet: 1, bassoon: 1, horn: 1 } },
  { name: "Wind quintet + piano", parts: { flute: 1, oboe: 1, clarinet: 1, bassoon: 1, horn: 1, piano: 1 } },
  { name: "Brass quintet", parts: { trumpet: 2, horn: 1, trombone: 1, tuba: 1 } },
  { name: "Piano trio", parts: { violin: 1, cello: 1, piano: 1 } },
  { name: "Piano quartet", parts: { violin: 1, viola: 1, cello: 1, piano: 1 } },
  { name: "Piano quintet", parts: { violin: 2, viola: 1, cello: 1, piano: 1 } },
  { name: "String quintet", parts: { violin: 2, viola: 2, cello: 1 } },
  { name: "Clarinet quintet", parts: { clarinet: 1, violin: 2, viola: 1, cello: 1 } },
  { name: "Trio sonata", parts: { violin: 2, continuo: 1 } },
  { name: "Wind octet", parts: { oboe: 2, clarinet: 2, bassoon: 2, horn: 2 } },
  { name: "String orchestra", parts: { strings: 1 } },
  { name: "Wind band", parts: { "wind band": 1 } },
  { name: "Symphony orchestra", parts: { orchestra: 1 } },
  { name: "Choir & orchestra", parts: { voices: 1, "mixed chorus": 1, orchestra: 1 } },
];

// ---- URL encoding ----------------------------------------------------------

export function encodeEnsemble(e: Ensemble): string {
  return scoreOrder(e)
    .map(([id, n]) => (n > 1 ? `${id}:${n}` : id))
    .join(",");
}

export function decodeEnsemble(s: string | null): Ensemble {
  const e: Ensemble = {};
  for (const tok of (s ?? "").split(",")) {
    const m = /^(.+?)(?::(\d+))?$/.exec(tok.trim());
    if (!m || !m[1]) continue;
    e[m[1]] = Math.max(1, Math.min(99, Number(m[2] ?? 1)));
  }
  return e;
}
