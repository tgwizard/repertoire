// GND: the German National Library's authority file (CC0). Its musical works give
// instrumentation as structured data (instruments and how many of each), with opus and
// catalogue numbers, keys and dates, for classical and contemporary works alike.
//
// The work file is one dump (~85 MB, RDF/XML, updated a few times a year). Composers are
// GND person ids: Wikidata's GND ids (P227) bridge them to ours.

import { existsSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cached, CACHE_DIR, DAY, gzipText, progress, readStage, USER_AGENT, writeStage } from "../http.ts";
import type { WikidataStage } from "./wikidata.ts";

const DUMP_URL = "https://data.dnb.de/opendata/authorities-gnd-werk_lds.rdf.gz";
const DUMP_PATH = join(CACHE_DIR, "raw", "gnd-werk.rdf.gz");
const DUMP_MAX_AGE = 60 * DAY;

export interface GndMedium {
  /** As GND names it, in German: "Violine" */
  name: string;
  count: number;
}

export interface GndWork {
  id: string;
  /** "Quartette, Violine (2), Viola, Violoncello, G 198 (A-Dur)" */
  name: string;
  /** Other names, e.g. the original title */
  variants: string[];
  composer: string | null;
  media: GndMedium[];
  performers: number | null;
  opus: string[];
  /** Thematic catalogue numbers: "G 198", "KV 581" */
  catalogue: string[];
  /** "A-Dur", "fis-Moll" */
  key: string | null;
  year: number | null;
  wikidata: string | null;
}

export interface GndComposer {
  gnd: string;
  qid: string;
  label: string | null;
  imslp: string | null;
  born: number | null;
  died: number | null;
  sitelinks: number;
}

export interface GndStage {
  fetchedAt: number;
  works: GndWork[];
  /** Composers of GND works, from Wikidata, by GND id (those our Wikidata stage lacks) */
  composers: Record<string, GndComposer>;
}

export const gndUrl = (id: string) => `https://d-nb.info/gnd/${id}`;

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

const values = (record: string, prop: string) => [...record.matchAll(new RegExp(`<gndo:${prop}[^>]*>([^<]*)</gndo:${prop}>`, "g"))].map((m) => unescape(m[1]!.trim()));

/** One top-level rdf:Description of a musical work, or null for anything else. */
export function parseWork(record: string): GndWork | null {
  if (!record.includes("gnd#MusicalWork")) return null;
  const id = values(record, "gndIdentifier")[0];
  const name = values(record, "preferredNameForTheWork")[0];
  if (!id || !name) return null;

  // Instruments: a resource, then its name as a literal; counts in nested nodes.
  const counts = new Map<string, number>();
  for (const m of record.matchAll(/<rdf:value rdf:resource="([^"]+)"\/>\s*<gndo:numberOfPerformersOfTheSameMedium[^>]*>(\d+)</g)) counts.set(m[1]!, Number(m[2]));
  const media: GndMedium[] = [];
  for (const m of record.matchAll(/<gndo:mediumOfPerformance rdf:resource="([^"]+)"\/>\s*<gndo:mediumOfPerformanceAsLiteral[^>]*>([^<]+)</g)) {
    media.push({ name: unescape(m[2]!.trim()), count: counts.get(m[1]!) ?? 1 });
  }
  // The work's own composer, not one of a related work's.
  const top = record.replace(/<gndo:hasRelation>[\s\S]*?<\/gndo:hasRelation>/g, "");
  const composer = /<gndo:firstComposer rdf:resource="https:\/\/d-nb\.info\/gnd\/([^"]+)"/.exec(top)?.[1] ?? null;
  const year = /(\d{4})/.exec(values(record, "dateOfProduction")[0] ?? "")?.[1];
  return {
    id,
    name,
    variants: values(record, "variantNameForTheWork").slice(0, 8),
    composer,
    media,
    performers: Number(values(record, "totalNumberOfPerformers")[0]) || null,
    opus: values(record, "opusNumericDesignationOfMusicalWork"),
    catalogue: values(record, "thematicIndexNumericDesignationOfMusicalWork"),
    key: values(record, "keyOfTheWork")[0] ?? null,
    year: year ? Number(year) : null,
    wikidata: /<owl:sameAs rdf:resource="http:\/\/www\.wikidata\.org\/entity\/(Q\d+)"/.exec(record)?.[1] ?? null,
  };
}

/** Splits the dump into top-level records as it streams (nested ones are indented). */
async function* records(path: string): AsyncGenerator<string> {
  const BOUNDARY = '\n<rdf:Description rdf:about="https://d-nb.info/gnd/';
  let buffer = "";
  for await (const chunk of gzipText(path)) {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf(BOUNDARY, 1)) >= 0) {
      yield buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
    }
  }
  if (buffer) yield buffer;
}

async function download(): Promise<number> {
  if (existsSync(DUMP_PATH) && Date.now() - statSync(DUMP_PATH).mtimeMs < DUMP_MAX_AGE) return statSync(DUMP_PATH).mtimeMs;
  console.log(`  downloading ${DUMP_URL}`);
  const res = await fetch(DUMP_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${DUMP_URL}`);
  await mkdir(join(CACHE_DIR, "raw"), { recursive: true });
  await writeFile(`${DUMP_PATH}.tmp`, Buffer.from(await res.arrayBuffer()));
  await rename(`${DUMP_PATH}.tmp`, DUMP_PATH);
  return Date.now();
}

async function sparql(query: string): Promise<Record<string, string>[]> {
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    body: new URLSearchParams({ query, format: "json" }),
    headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const data = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
  return data.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

export async function crawlGnd(): Promise<void> {
  console.log("GND: musical works");
  const fetchedAt = await download();
  const works: GndWork[] = [];
  let seen = 0;
  for await (const r of records(DUMP_PATH)) {
    seen++;
    const w = parseWork(r);
    // Works with neither instrumentation nor a Wikidata item can't be placed or matched.
    if (w && (w.media.length || w.wikidata)) works.push(w);
    if (seen % 100_000 === 0) console.log(`  ${seen} records, ${works.length} musical works kept`);
  }
  console.log(`  ${seen} records; ${works.length} musical works with instrumentation or a Wikidata link`);

  // Composers our Wikidata stage doesn't know, looked up by GND id.
  const wd = await readStage<WikidataStage>("wikidata");
  const known = new Set(Object.values(wd?.composers ?? {}).map((c) => c.gnd).filter(Boolean));
  const wanted = [...new Set(works.filter((w) => w.media.length).map((w) => w.composer).filter((g): g is string => !!g && !known.has(g)))].sort();
  console.log(`  ${wanted.length} composers to look up on Wikidata`);
  const composers: Record<string, GndComposer> = {};
  const report = progress("Wikidata composers by GND id", Math.ceil(wanted.length / 300));
  for (let i = 0; i < wanted.length; i += 300) {
    const batch = wanted.slice(i, i + 300);
    const res = await cached(`gnd:composers:v1:${batch.join(",")}`, 60 * DAY, () =>
      sparql(`SELECT ?p ?gnd ?label ?born ?died ?sl ?imslp WHERE {
        VALUES ?gnd { ${batch.map((g) => JSON.stringify(g)).join(" ")} } ?p wdt:P227 ?gnd .
        OPTIONAL { ?p rdfs:label ?label FILTER(lang(?label) = "en") }
        OPTIONAL { ?p wdt:P569 ?born } OPTIONAL { ?p wdt:P570 ?died } OPTIONAL { ?p wikibase:sitelinks ?sl }
        OPTIONAL { ?p wdt:P839 ?imslp } }`),
    );
    for (const r of res.value) {
      const y = (v?: string) => (v ? Number(/^-?\d+/.exec(v)?.[0]) || null : null);
      composers[r.gnd!] ??= {
        gnd: r.gnd!,
        qid: r.p!.split("/").pop()!,
        label: r.label ?? null,
        imslp: r.imslp?.startsWith("Category:") ? r.imslp.slice(9).replaceAll("_", " ") : null,
        born: y(r.born),
        died: y(r.died),
        sitelinks: Number(r.sl ?? 0),
      };
    }
    report(i / 300 + 1);
  }
  console.log(`  ${Object.keys(composers).length} of them found`);
  await writeStage("gnd", { fetchedAt, works, composers } satisfies GndStage);
}

// ---- From GND's German to ours ------------------------------------------------

type Parts = Record<string, number>;
const STRING_QUARTET: Parts = { violin: 2, viola: 1, cello: 1 };

// GND instrument names → our instrument ids, or a group of them. Voice types are all
// "voice", as on IMSLP. Generic names ("Ensemble", "Melodieinstrument") are left out:
// works with them get no line-up.
const GERMAN: Record<string, string | Parts> = {
  Klavier: "piano", "Vierhändige Klaviermusik": "piano 4 hands", Orgel: "organ", Cembalo: "harpsichord", Clavichord: "clavichord",
  Harmonium: "harmonium", Akkordeon: "accordion", Celesta: "celesta", Tasteninstrument: "keyboard", "Basso continuo": "continuo",
  Synthesizer: "synthesizer",
  Violine: "violin", Viola: "viola", Violoncello: "cello", Kontrabass: "double bass", Violone: "violone", "Viola da Gamba": "viol",
  "Viola d'Amore": "viola damore", Baryton: "baryton", Harfe: "harp", Gitarre: "guitar", Elektrogitarre: "electric guitar",
  Laute: "lute", Mandoline: "mandolin", Mandola: "mandola", Zither: "zither",
  Querflöte: "flute", Flöte: "flute", Pikkoloflöte: "piccolo", Altquerflöte: "alto flute", Bassquerflöte: "bass flute",
  Blockflöte: "recorder", Sopranblockflöte: "recorder", Altblockflöte: "recorder", Tenorblockflöte: "recorder", Bassblockflöte: "recorder",
  Oboe: "oboe", "Oboe d'Amore": "oboe damore", Englischhorn: "english horn", Klarinette: "clarinet", Bassklarinette: "bass clarinet",
  Bassetthorn: "basset horn", Fagott: "bassoon", Kontrafagott: "contrabassoon", Saxofon: "saxophone", Sopransaxofon: "soprano saxophone",
  Altsaxofon: "alto saxophone", Tenorsaxofon: "tenor saxophone", Baritonsaxofon: "baritone saxophone",
  Horn: "horn", Trompete: "trumpet", Kornett: "cornet", Flügelhorn: "flugelhorn", Posaune: "trombone", Bassposaune: "bass trombone",
  Tuba: "tuba", Euphonium: "euphonium",
  Saxophon: "saxophone", Altsaxophon: "alto saxophone", Vibraphon: "vibraphone", Marimbaphon: "marimba",
  Schlagzeug: "percussion", Schlagwerk: "percussion", Pauke: "timpani", Marimba: "marimba", Vibrafon: "vibraphone",
  Glockenspiel: "glockenspiel", Xylofon: "xylophone",
  Singstimme: "voice", Stimme: "voice", Gesang: "voice", Sopran: "voice", Mezzosopran: "voice", Alt: "voice", Countertenor: "voice",
  Tenor: "voice", Bariton: "voice", Bassbariton: "voice", Bass: "voice", Männersingstimme: "voice", Frauensingstimme: "voice",
  Sprechstimme: "narrator",
  Chor: "mixed chorus", "Gemischter Chor": "mixed chorus", Männerchor: "male chorus", Frauenchor: "female chorus",
  Kinderchor: "childrens chorus", Knabenchor: "childrens chorus",
  Orchester: "orchestra", Kammerorchester: "chamber orchestra", Streichorchester: "strings", Blasorchester: "wind band",
  Streichquartett: STRING_QUARTET,
  Tonband: "tape", Zuspielaufnahme: "tape", Elektronik: "electronic sounds", "Live-Elektronik": "electronic sounds",
};

/** A GND work's instrumentation as our line-up, or null if any part is unknown or vague. */
export function gndLineup(media: GndMedium[]): Parts | null {
  if (!media.length) return null;
  const parts: Parts = {};
  for (const m of media) {
    const id = GERMAN[m.name];
    if (!id || m.count < 1 || m.count > 40) return null;
    for (const [inst, n] of Object.entries(typeof id === "string" ? { [id]: 1 } : id)) parts[inst] = (parts[inst] ?? 0) + n * m.count;
  }
  return parts;
}

const NOTES: Record<string, string> = {
  c: "C", d: "D", e: "E", f: "F", g: "G", a: "A", h: "B", b: "B-flat",
  ces: "C-flat", des: "D-flat", es: "E-flat", fes: "F-flat", ges: "G-flat", as: "A-flat",
  cis: "C-sharp", dis: "D-sharp", eis: "E-sharp", fis: "F-sharp", gis: "G-sharp", ais: "A-sharp", his: "B-sharp",
};

/** "fis-Moll" → "F-sharp minor"; German "B" is B-flat and "H" is B. */
export function gndKey(key: string | null): string | null {
  const m = key ? /^([A-Ha-h](?:is|es|s)?)-(Dur|Moll)$/.exec(key.trim()) : null;
  const note = m && NOTES[m[1]!.toLowerCase()];
  return note ? `${note} ${m![2] === "Dur" ? "major" : "minor"}` : null;
}

const GENRES: Record<string, string> = {
  Quartette: "Quartet", Quintette: "Quintet", Trios: "Trio", Duos: "Duo", Sextette: "Sextet", Septette: "Septet", Oktette: "Octet",
  Nonette: "Nonet", Sonaten: "Sonata", Sonatinen: "Sonatina", Sinfonien: "Symphony", Konzerte: "Concerto", Suiten: "Suite",
  Serenaden: "Serenade", Divertimenti: "Divertimento", Variationen: "Variations", Stücke: "Pieces", Lieder: "Songs", Messen: "Mass",
  Tänze: "Dances", Fantasien: "Fantasia", Präludien: "Prelude", Fugen: "Fugue", Rhapsodien: "Rhapsody", Notturni: "Notturno",
};

// The abbreviations older uniform titles use for instruments ("Quartette, Vl 1 2, Va, Vc").
// Single letters, and "Sz" (Bartók's catalogue), are left out: they are as often other things.
const ABBREVIATIONS = new Set(
  ("Kl Vl Va Vc Kb Orch Streichorch Blasorch Org Cemb Akk Bc Fl Blfl Ob Ehr Klar Fg Sax Hr Trp Pos Tb Git Lt Md Hf Schz Pk " +
    "Vagb Sopr").split(" "),
);

const isMedium = (segment: string) => {
  // "Violine (2)", "Vl 1 2"
  const name = segment.replace(/\s*\(\d+\)$/, "").replace(/(?: \d+)+$/, "").trim();
  return name in GERMAN || ABBREVIATIONS.has(name) || /^(Ensemble|Instrument|Melodieinstrument|Bassinstrument|Instrumentalensemble)$/.test(name);
};

/**
 * A readable title from GND's uniform one: drops the instruments (the line-up says
 * them), translates the genre and key. "Quartette, Violine (2), Viola, Violoncello,
 * G 198 (A-Dur)" → "Quartet in A major, G 198"; "Kongsgaard variations" stays.
 */
export function gndTitle(name: string): string {
  const keyMatch = / \(([A-Ha-h](?:is|es|s)?-(?:Dur|Moll))\)$/.exec(name);
  const english = keyMatch ? gndKey(keyMatch[1]!) : null;
  const segments = (keyMatch ? name.slice(0, keyMatch.index) : name).split(", ");
  const genre = GENRES[segments[0]!] ?? segments[0]!;
  const rest = segments.slice(1).filter((s) => !isMedium(s));
  let title = genre;
  if (rest[0] && /^Nr\.\s*\S+$/.test(rest[0])) title += ` ${rest.shift()!.replace(/^Nr\.\s*/, "No. ")}`;
  if (english) title += ` in ${english}`;
  return [title, ...rest].join(", ").replace(/\bNr\.\s*/g, "No. ");
}

/**
 * The work a record is part of, by name, if it's a part: "Lakmé. Où va la jeune Indoue" →
 * "Lakmé", "Lieder (1846). Lockung" → "Lieder (1846)". Abbreviations ("op.", "St.") and
 * initials ("Joh. Seb. Bach") aren't the separator.
 */
export function gndParent(w: GndWork): string | null {
  return gndPart(w)?.parent ?? null;
}

const ABBREVIATED = new RegExp(`\\b(?:op|Op|Nr|No|St|Hl|hl|Bd|Vol|vol|ca|Hob|KV|BWV|Mr|Mrs|Dr|Fr|Th|Ph|Joh|Sr|Jr|Br|N|n|Singst|${[...ABBREVIATIONS].join("|")})\\.|\\b\\p{Lu}\\p{Ll}{0,2}\\.(?=\\s*\\p{Lu})|\\.\\.\\.`, "gu");

/**
 * A record of part of a work: the work's name and the part's ("Lakmé" and "Où va la jeune
 * Indoue"). A movement or section ("Manfred. Ouvertüre", "Sonate. Andante", "Teil 6") is
 * only ever part of its work; a number in a set ("Sonata, Violoncello. No. 1"), a song or
 * an aria with a title of its own is a piece people play on its own too (`standalone`).
 */
export function gndPart(w: GndWork): { parent: string; part: string; numbered: boolean; standalone: boolean } | null {
  const masked = w.name.replace(ABBREVIATED, (m) => "#".repeat(m.length));
  const i = masked.search(/\.\s+[\p{L}#]/u); // "#": a masked "Nr." starting the part
  if (i <= 0) return null;
  const part = w.name.slice(i + 1).trim();
  const numbered = /^(?:[\p{L}-]+,?\s+)?(?:No|Nr|N)\.?\s*\d+[a-z]?(?:\s*\([^)]*\))?$/u.test(part); // "Nr. 2 (E-Dur)"
  // GND's other names may say what kind of part it is: "Klaviertrio. 1. Satz"
  const movement = MOVEMENT.test(part) || (w.variants ?? []).some((v) => /\b\d+\.\s*Satz\b|\bSatz\s+\d+\b|\bmovements?\b|\bmouvement\b/i.test(v));
  return { parent: w.name.slice(0, i), part, numbered, standalone: numbered || !movement };
}

// Movements, sections and numbers of a stage work: parts that aren't pieces of their own
const MOVEMENT =
  /^(?:(?:satz|teil|akt|act|atto|szene|scene|sc[eè]ne|bild|fassung|version|nr|no|n)\b|\d|(?:vorspiel|ouvert[uü]re|overture|ouverture|sinfonia|prelude|prélude|präludium|preludio|finale|introduction|introduktion|introduzione|intermezzo|entr'?acte|zwischenspiel|nachspiel|postlude|coda|ballett?|tanz|danse|marsch|march|marche|allegro|allegretto|andante|andantino|adagio|adagietto|largo|larghetto|lento|presto|vivace|moderato|grave|menuett|minuet|menuet|minuetto|scherzo|trio|rondo|gavotte|sarabande|courante|allemande|gigue|bourr[ée]e|air|aria|variation|variationen|variations|thema|theme|fuge|fugue|fuga|kadenz|cadenza)\b)/iu;

/** When it was written: GND's date, else the year its name gives ("Konzerte, Horn, Orchester (2003)") */
export function gndYear(w: GndWork): number | null {
  return w.year ?? (Number(/\((\d{4})\)$/.exec(w.name)?.[1]) || null);
}

/**
 * Its other names worth searching by: original titles ("Tre studi per flauto, clarinetto e
 * fagotto"), not GND's own catalogue forms ("Studien, Fl, Klar, Fg (1958)", "Sonaten op. 11, 3").
 */
export function gndAliases(w: GndWork): string[] {
  return w.variants
    .filter((v) => {
      const segments = v.replace(/\s*\(\d{4}\)$/, "").split(/,\s*|\s+(?=op\.)/i);
      return (
        !(segments[0]!.split(" ")[0]! in GENRES) &&
        !segments.some(isMedium) &&
        !segments.some((s) => /^(op\.|Nr\.)/i.test(s)) &&
        // "Romanzen, Vc Orch AV 75", "Occasional oratorio <Marsch>", "Satz 4"
        !v.split(/[\s,.]+/).some((t) => ABBREVIATIONS.has(t)) &&
        !/[<>]|\bSatz\b/.test(v)
      );
    })
    .slice(0, 3);
}

/** A title for matching against other sources: name, numbers and key, in their forms. */
export function gndMatchTitle(w: GndWork): string {
  const key = gndKey(w.key);
  const numbers = [...w.opus.map((o) => o.replace(/^op\./i, "Op.").replace(/,?\s*Nr\.\s*/g, " No. ")), ...w.catalogue];
  return [gndTitle(w.name.replace(/ \([A-Ha-h](?:is|es|s)?-(?:Dur|Moll)\)$/, "")), ...numbers].join(", ") + (key ? ` in ${key}` : "");
}
