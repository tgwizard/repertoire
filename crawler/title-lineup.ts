// Line-ups written into titles, as library catalogues print them: "Per spelman,
// variationer för blåskvintett", "Sonate für Violine und Klavier", "Trio pour flûte,
// alto et harpe". Strict: every word after "for" must be an instrument or ensemble we
// know, in the preposition's language, or there's no line-up.

import { ensembleKey, type Ensemble } from "../src/lib/instrumentation.ts";
import { normalize } from "../src/shared/text.ts";

type Words = Record<string, string | Ensemble>;

const WIND_QUINTET: Ensemble = { flute: 1, oboe: 1, clarinet: 1, bassoon: 1, horn: 1 };
const BRASS_QUINTET: Ensemble = { trumpet: 2, horn: 1, trombone: 1, tuba: 1 };
const STRING_QUARTET: Ensemble = { violin: 2, viola: 1, cello: 1 };
const STRING_TRIO: Ensemble = { violin: 1, viola: 1, cello: 1 };
const PIANO_TRIO: Ensemble = { violin: 1, cello: 1, piano: 1 };

/** Swedish, as LIBRIS's instrumentation field and Swedish titles have it (singular and plural). */
export const SWEDISH: Words = {
  flöjt: "flute", flöjter: "flute", tvärflöjt: "flute", tvärflöjter: "flute", piccolaflöjt: "piccolo", piccola: "piccolo",
  altflöjt: "alto flute", blockflöjt: "recorder", blockflöjter: "recorder", oboe: "oboe", oboer: "oboe", "oboe d'amore": "oboe damore",
  "engelskt horn": "english horn", klarinett: "clarinet", klarinetter: "clarinet", bassetthorn: "basset horn", basklarinett: "bass clarinet",
  fagott: "bassoon", fagotter: "bassoon", kontrafagott: "contrabassoon", sopransaxofon: "soprano saxophone", altsaxofon: "alto saxophone",
  tenorsaxofon: "tenor saxophone", barytonsaxofon: "baritone saxophone", saxofon: "saxophone", saxofoner: "saxophone",
  horn: "horn", valthorn: "horn", trumpet: "trumpet", trumpeter: "trumpet", kornett: "cornet", flygelhorn: "flugelhorn",
  trombon: "trombone", tromboner: "trombone", basun: "trombone", basuner: "trombone", bastrombon: "bass trombone", basbasun: "bass trombone",
  eufonium: "euphonium", tuba: "tuba", violin: "violin", violiner: "violin", fiol: "violin", fioler: "violin", viola: "viola", violor: "viola",
  altfiol: "viola", altfioler: "viola", violoncell: "cello", violonceller: "cello", cello: "cello", cellor: "cello", kontrabas: "double bass",
  kontrabasar: "double bass", "viola da gamba": "viol", gamba: "viol", harpa: "harp", harpor: "harp", gitarr: "guitar", gitarrer: "guitar",
  luta: "lute", mandolin: "mandolin", piano: "piano", pianon: "piano", "piano 4 händer": "piano 4 hands", "piano fyrhändigt": "piano 4 hands",
  cembalo: "harpsichord", orgel: "organ", harmonium: "harmonium", dragspel: "accordion", ackordeon: "accordion", celesta: "celesta",
  continuo: "continuo", "basso continuo": "continuo", generalbas: "continuo", "b.c.": "continuo", "b.c": "continuo", bc: "continuo",
  slagverk: "percussion", pukor: "timpani", puka: "timpani", marimba: "marimba", vibrafon: "vibraphone",
  sång: "voice", röst: "voice", röster: "voice", sångröst: "voice", sopran: "soprano", sopraner: "soprano", alt: "alto", tenor: "tenor",
  baryton: "baritone", berättare: "narrator", recitation: "narrator", "blandad kör": "mixed chorus", kör: "mixed chorus",
  manskör: "male chorus", damkör: "female chorus", orkester: "orchestra", symfoniorkester: "orchestra", kammarorkester: "chamber orchestra",
  stråkorkester: "strings", blåsorkester: "wind band", brassband: "brass band",
  blåskvintett: WIND_QUINTET, träblåskvintett: WIND_QUINTET, bleckblåskvintett: BRASS_QUINTET, stråkkvartett: STRING_QUARTET,
  stråktrio: STRING_TRIO, pianotrio: PIANO_TRIO, pianoackompanjemang: "piano",
};

const ENGLISH: Words = {
  flute: "flute", piccolo: "piccolo", "alto flute": "alto flute", recorder: "recorder", oboe: "oboe", "oboe d'amore": "oboe damore",
  "english horn": "english horn", "cor anglais": "english horn", clarinet: "clarinet", "basset horn": "basset horn", "bass clarinet": "bass clarinet",
  bassetthorn: "basset horn", bassoon: "bassoon", contrabassoon: "contrabassoon", saxophone: "saxophone", "soprano saxophone": "soprano saxophone",
  "alto saxophone": "alto saxophone", "tenor saxophone": "tenor saxophone", "baritone saxophone": "baritone saxophone",
  horn: "horn", "french horn": "horn", trumpet: "trumpet", cornet: "cornet", flugelhorn: "flugelhorn", trombone: "trombone",
  "bass trombone": "bass trombone", euphonium: "euphonium", tuba: "tuba", violin: "violin", viola: "viola", cello: "cello",
  violoncello: "cello", "double bass": "double bass", contrabass: "double bass", "viola da gamba": "viol", viol: "viol", harp: "harp",
  guitar: "guitar", lute: "lute", mandolin: "mandolin", piano: "piano", pianoforte: "piano", "piano 4 hands": "piano 4 hands",
  "piano accompaniment": "piano",
  harpsichord: "harpsichord", organ: "organ", harmonium: "harmonium", accordion: "accordion", celesta: "celesta",
  continuo: "continuo", "basso continuo": "continuo", "b.c.": "continuo", percussion: "percussion", timpani: "timpani",
  marimba: "marimba", vibraphone: "vibraphone", voice: "voice", "high voice": "voice", "medium voice": "voice", "low voice": "voice",
  soprano: "soprano", alto: "alto", contralto: "alto", tenor: "tenor", baritone: "baritone", bass: "bass", narrator: "narrator",
  "mixed chorus": "mixed chorus", "mixed choir": "mixed chorus", chorus: "mixed chorus", choir: "mixed chorus",
  "male chorus": "male chorus", "male choir": "male chorus", "men's chorus": "male chorus", "female chorus": "female chorus",
  "female choir": "female chorus", "women's chorus": "female chorus", orchestra: "orchestra", "symphony orchestra": "orchestra",
  "chamber orchestra": "chamber orchestra", "string orchestra": "strings", strings: "strings", "wind band": "wind band",
  "concert band": "wind band", "symphonic band": "wind band", "brass band": "brass band",
  "wind quintet": WIND_QUINTET, "woodwind quintet": WIND_QUINTET, "brass quintet": BRASS_QUINTET, "string quartet": STRING_QUARTET,
  "string trio": STRING_TRIO, "piano trio": PIANO_TRIO,
};

// Danish and Norwegian share "for" with English
const NORDIC: Words = {
  fløjte: "flute", obo: "oboe", klarinet: "clarinet", fagot: "bassoon", valdhorn: "horn", trompet: "trumpet", basun: "trombone",
  violin: "violin", violiner: "violin", bratsch: "viola", cello: "cello", kontrabas: "double bass", klaver: "piano", orgel: "organ",
  harpe: "harp", guitar: "guitar", sang: "voice", stemme: "voice", sopran: "soprano", kor: "mixed chorus", "blandet kor": "mixed chorus",
  mandskor: "male chorus", orkester: "orchestra", strygeorkester: "strings", strykeorkester: "strings",
  blæserkvintet: WIND_QUINTET, blåsekvintett: WIND_QUINTET, strygekvartet: STRING_QUARTET, strykekvartett: STRING_QUARTET,
};

const GERMAN: Words = {
  flöte: "flute", flöten: "flute", querflöte: "flute", pikkoloflöte: "piccolo", blockflöte: "recorder", blockflöten: "recorder",
  oboe: "oboe", oboen: "oboe", englischhorn: "english horn", klarinette: "clarinet", klarinetten: "clarinet", bassetthorn: "basset horn",
  bassklarinette: "bass clarinet", fagott: "bassoon", fagotte: "bassoon", kontrafagott: "contrabassoon", saxophon: "saxophone",
  horn: "horn", hörner: "horn", waldhorn: "horn", trompete: "trumpet", trompeten: "trumpet", kornett: "cornet", posaune: "trombone",
  posaunen: "trombone", tuba: "tuba", violine: "violin", violinen: "violin", geige: "violin", geigen: "violin", viola: "viola",
  bratsche: "viola", bratschen: "viola", violoncello: "cello", violoncelli: "cello", kontrabass: "double bass", gambe: "viol",
  harfe: "harp", gitarre: "guitar", gitarren: "guitar", laute: "lute", mandoline: "mandolin", klavier: "piano", klaviere: "piano",
  pianoforte: "piano", "klavier zu 4 händen": "piano 4 hands", klavierbegleitung: "piano", "begleitung des pianoforte": "piano", cembalo: "harpsichord", orgel: "organ", harmonium: "harmonium",
  akkordeon: "accordion", "basso continuo": "continuo", generalbass: "continuo", schlagzeug: "percussion", pauken: "timpani",
  singstimme: "voice", singstimmen: "voice", "hohe singstimme": "voice", "mittlere singstimme": "voice", "tiefe singstimme": "voice",
  gesang: "voice", stimme: "voice", sopran: "soprano", alt: "alto", tenor: "tenor", bariton: "baritone", bass: "bass",
  sprecher: "narrator", chor: "mixed chorus", "gemischten chor": "mixed chorus", "gemischter chor": "mixed chorus",
  männerchor: "male chorus", frauenchor: "female chorus", orchester: "orchestra", "großes orchester": "orchestra",
  kammerorchester: "chamber orchestra", streichorchester: "strings", streicher: "strings", blasorchester: "wind band",
  bläserquintett: WIND_QUINTET, holzbläserquintett: WIND_QUINTET, blechbläserquintett: BRASS_QUINTET, streichquartett: STRING_QUARTET,
  streichtrio: STRING_TRIO, klaviertrio: PIANO_TRIO,
};

const FRENCH: Words = {
  flûte: "flute", flûtes: "flute", flute: "flute", "petite flûte": "piccolo", hautbois: "oboe", "cor anglais": "english horn",
  clarinette: "clarinet", clarinettes: "clarinet", basson: "bassoon", bassons: "bassoon", saxophone: "saxophone", cor: "horn", cors: "horn",
  trompette: "trumpet", trompettes: "trumpet", trombone: "trombone", trombones: "trombone", tuba: "tuba", violon: "violin", violons: "violin",
  alto: "viola", altos: "viola", violoncelle: "cello", violoncelles: "cello", contrebasse: "double bass", harpe: "harp", guitare: "guitar",
  guitares: "guitar", luth: "lute", piano: "piano", pianos: "piano", "piano à 4 mains": "piano 4 hands", clavecin: "harpsichord",
  orgue: "organ", harmonium: "harmonium", accordéon: "accordion", "basse continue": "continuo", timbales: "timpani",
  voix: "voice", chant: "voice", soprano: "soprano", ténor: "tenor", baryton: "baritone", basse: "bass", récitant: "narrator",
  chœur: "mixed chorus", choeur: "mixed chorus", "chœur mixte": "mixed chorus", "choeur mixte": "mixed chorus",
  orchestre: "orchestra", "grand orchestre": "orchestra", "orchestre de chambre": "chamber orchestra",
  "orchestre à cordes": "strings", "orchestre d'harmonie": "wind band", harmonie: "wind band",
  "quintette à vent": WIND_QUINTET, "quintette à vents": WIND_QUINTET, "quintette de cuivres": BRASS_QUINTET,
  "quatuor à cordes": STRING_QUARTET, "trio à cordes": STRING_TRIO,
};

const ITALIAN: Words = {
  flauto: "flute", flauti: "flute", ottavino: "piccolo", oboe: "oboe", oboi: "oboe", "corno inglese": "english horn",
  clarinetto: "clarinet", clarinetti: "clarinet", fagotto: "bassoon", fagotti: "bassoon", corno: "horn", corni: "horn",
  tromba: "trumpet", trombe: "trumpet", trombone: "trombone", tromboni: "trombone", violino: "violin", violini: "violin",
  viola: "viola", viole: "viola", violoncello: "cello", violoncelli: "cello", contrabbasso: "double bass", arpa: "harp",
  chitarra: "guitar", chitarre: "guitar", liuto: "lute", mandolino: "mandolin", pianoforte: "piano", piano: "piano",
  "pianoforte a 4 mani": "piano 4 hands", cembalo: "harpsichord", organo: "organ", "basso continuo": "continuo", timpani: "timpani",
  voce: "voice", canto: "voice", soprano: "soprano", contralto: "alto", tenore: "tenor", baritono: "baritone",
  coro: "mixed chorus", "coro misto": "mixed chorus", orchestra: "orchestra", "orchestra da camera": "chamber orchestra",
  archi: "strings", "orchestra d'archi": "strings", "quintetto a fiati": WIND_QUINTET, "quintetto di fiati": WIND_QUINTET,
  "quartetto d'archi": STRING_QUARTET,
};

interface Language {
  words: Words;
  /** Joins the last two instruments ("violin and piano"); a comma joins the rest */
  and: RegExp;
  /** Leading articles and counts */
  numbers: Record<string, number>;
  /** Words between instruments that make it an either/or: no line-up */
  or: RegExp;
}

const N = (words: string, from = 1) => Object.fromEntries(words.split(" ").map((w, i) => [w, from + i]).filter(([w]) => w !== "-"));

const LANGUAGES: Record<string, Language> = {
  för: {
    words: { ...ENGLISH, ...SWEDISH },
    and: / och | & | samt | med /,
    numbers: { ...N("en två tre fyra fem sex sju åtta"), ett: 1 },
    or: / eller | el\. | resp\. /,
  },
  for: {
    words: { ...ENGLISH, ...NORDIC },
    and: / and | & | og | with | med /,
    numbers: { ...N("one two three four five six seven eight"), a: 1, an: 1, en: 1, et: 1, to: 2, tre: 3, fire: 4 },
    or: / or | eller | el\. /,
  },
  für: {
    words: { ...GERMAN },
    and: / und | & | mit /,
    numbers: { ...N("eine zwei drei vier fünf sechs sieben acht"), ein: 1, einen: 1, einer: 1 },
    or: / oder | bzw\. /,
  },
  pour: {
    words: { ...FRENCH },
    and: / et | & | avec /,
    numbers: { ...N("un deux trois quatre cinq six sept huit"), une: 1, le: 1, la: 1, "l'": 1 },
    or: / ou /,
  },
  per: {
    words: { ...ITALIAN },
    and: / e | ed | & | con /,
    numbers: { ...N("uno due tre quattro cinque sei sette otto"), un: 1, una: 1, il: 1, la: 1, "l'": 1 },
    or: / o | oppure /,
  },
};

// What may follow the line-up in a title: catalogue numbers, keys, years, "solo"
const TAIL =
  /\s*(?:,\s*)?(?:\b(?:op|opus|oe|œ|no|nr|k|kv|bwv|hob|woo|d|sz|jw|rv)\.?\s*\d.*|\b(?:in|i|en)\s+[A-H](?:[-\s]?(?:flat|sharp|b|is|es|ess))?(?:[-\s](?:major|minor|dur|moll|majeur|mineur|maggiore|minore)\b.*|\s*$)|\b[A-H](?:is|es)?[-\s](?:dur|moll)\b.*|\(?\b1[5-9]\d\d\b\)?.*|\s+(?:a cappella|solo|ad lib\.?)\s*)$/i;

// A concerto's title may leave out the orchestra ("Konsert för violin")
const CONCERTO = /\b(?:concert[oi]?|concertino|konsert|konzert(?:stück)?)\b/i;
// (one "for violin and piano" is a piano reduction)
const ACCOMPANIED = ["orchestra", "chamber orchestra", "strings", "wind band", "brass band", "continuo"];

// Not the work's own line-up: arrangements, reductions, excerpts
const ARRANGED =
  /\barr\b|potp?ou?rri|\bselections? from\b|\barr\.|arrang|bearb|transcri|eingerichtet|r[ée]duction|riduzione|klavierauszug|klavierutdrag|vocal score|piano score|ausgaben?\b|edition for|utgåva|opera completa|\bur\b|\bfrom\b|\baus\b|\btirée? de\b/i;

/** Titles of anthologies and songbooks, not of a work */
export const ANTHOLOGY =
  /\b(?:ausgewählte|selected|valda|samlade|sämtliche|gesammelte|complete works|œuvres choisies|best of|bästa|hits|medley|album|songbook|collection|samling|anthology|kompositionen|compositions|\w*werke|works|spielstücke)\b/i;

// An orchestral or stage genre "for piano" (or organ) is a reduction of it
const ORCHESTRAL_GENRE = /\b(?:symphon\w*|sinfoni\w*|ouvert\w*|overture|uvertyr|opera|oper|operett\w*)\b/i;
const KEYBOARDS = new Set(["piano", "piano 4 hands", "organ", "harmonium", "harpsichord"]);

function readPart(raw: string, lang: Language): Ensemble | null {
  let part = raw
    .trim()
    .replace(/^(?:solo|the|der|die|das|den|dem)\s+/i, "")
    .replace(/\s+(?:solo|obligato|obbligato)$/i, "")
    // A transposing instrument's key ("clarinet in A", "Klarinetten in B")
    .replace(/\s+(?:in|i|en)\s+[a-h](?:[-\s]?(?:flat|sharp|b|is|es))?$/i, "");
  let count = 1;
  // "2 violins", "två violiner", "violin (2)"
  const lead = /^(\d{1,2}|\S+)\s+(.+)$/.exec(part);
  if (lead && (/^\d+$/.test(lead[1]!) || lang.numbers[lead[1]!] !== undefined)) {
    count = /^\d+$/.test(lead[1]!) ? Number(lead[1]) : lang.numbers[lead[1]!]!;
    part = lead[2]!;
  }
  const trail = /^(.+?)\s*\((\d{1,2})\)$/.exec(part);
  if (trail) [part, count] = [trail[1]!, Number(trail[2])];
  if (count < 1 || count > 20) return null;
  // English plurals ("2 violins", "voices", "basses")
  const found = lang.words[part] ?? (lang.words === LANGUAGES.for!.words ? (lang.words[part.replace(/e?s$/, "")] ?? lang.words[part.replace(/s$/, "")]) : undefined);
  if (!found) return null;
  const parts = typeof found === "string" ? { [found]: 1 } : found;
  return Object.fromEntries(Object.entries(parts).map(([id, n]) => [id, n * count]));
}

function readLineup(phrase: string, lang: Language): Ensemble | null {
  if (lang.or.test(` ${phrase} `)) return null;
  const parts: Ensemble = {};
  const pieces = phrase.split(",").flatMap((p) => ` ${p} `.split(lang.and));
  let any = false;
  for (const piece of pieces) {
    if (!piece.trim()) continue;
    const read = readPart(piece, lang);
    if (!read) return null;
    for (const [id, n] of Object.entries(read)) parts[id] = (parts[id] ?? 0) + n;
    any = true;
  }
  // "Bass" among instruments, with no other voices, is a bass instrument of some kind
  const voices = Object.keys(parts).filter((id) => /^(?:voice|soprano|alto|tenor|baritone)$|chorus/.test(id));
  if (parts.bass && !voices.length) return null;
  return any ? parts : null;
}

/**
 * The line-up a title spells out after "för", "for", "für", "pour" or "per", or null if
 * there's none, it's partly unknown, or it gives alternatives. Arrangements ("arr. för
 * kör") and excerpts ("ur …", "from …") give none either: the line-up isn't the work's.
 */
/**
 * The instruments named, without counts, voice types or kinds of orchestra: details
 * two readings of one record (its instrumentation field, its title) may well differ on.
 */
export const instrumentsNamed = (e: Ensemble) =>
  new Set(Object.keys(e).map((id) => (/^(?:voice|soprano|alto|tenor|baritone|bass)$/.test(id) ? "voice" : /orchestra|^strings$/.test(id) ? "orchestra" : id.replace(/ 4 hands$/, ""))));

export function lineupFromTitle(title: string): Ensemble | null {
  const t = title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\[,\]/g, ",")
    // Asides are alternatives or details ("contralto (or baritone)", "piano (left hand)"); counts stay
    .replace(/\s*\((?!\d{1,2}\))[^()]*\)/g, "")
    .replace(/\b(?:zu |à |a |för )?(?:2|zwei|two|två|deux|due) (?:händen|hands|händer|mains|mani)\b/g, "");
  if (ARRANGED.test(t) || ANTHOLOGY.test(t)) return null;
  const found = new Map<string, Ensemble>();
  for (const m of t.matchAll(/(?:^|[\s,(])(för|for|für|pour|per)\s+/g)) {
    const lang = LANGUAGES[m[1]!]!;
    // Up to the first mark that ends a list of instruments
    let phrase = t.slice(m.index! + m[0].length).replace(TAIL, "").split(/\s*(?:[:;/[\]=(]|\s[-–—]\s|\.\s)/)[0]!;
    phrase = phrase
      .replace(/\b(?:4|four|fyra|vier|quatre|quattro)[\s-]?(?:hands|händer|händen|händig|mains|mani)\b/g, "4 hands")
      .replace(/\b(piano|klavier|pianoforte)\s+(?:zu\s+|à\s+|a\s+)?4 hands\b/, "$1 4 hands")
      .replace(/\bfyrhändigt piano\b/, "piano fyrhändigt")
      .replace(TAIL, "")
      .replace(/[.,\s]+$/, "");
    const words = lang.words;
    // Normalised four-hands names in each language
    phrase = phrase.replace(/\b(?:piano|klavier|pianoforte) 4 hands\b/, Object.keys(words).find((k) => words[k] === "piano 4 hands") ?? "piano 4 hands");
    const lineup = phrase && readLineup(phrase, lang);
    if (lineup) found.set(ensembleKey(lineup), lineup);
  }
  // Two different line-ups in one title (a work and its arrangement): neither
  const lineup = found.size === 1 ? [...found.values()][0]! : null;
  if (lineup && CONCERTO.test(t) && !ACCOMPANIED.some((id) => lineup[id])) return null;
  if (lineup && ORCHESTRAL_GENRE.test(t) && Object.keys(lineup).every((id) => KEYBOARDS.has(id))) return null;
  return lineup;
}

/**
 * The title without the line-up it spells out, for matching other sources' titles:
 * "Danzas argentinas, pour piano" → "Danzas argentinas"; "Trio nr 1 för violin,
 * violoncell och piano, op. 6" → "Trio nr 1, op. 6". Null if it names no line-up.
 */
export function withoutLineup(title: string): string | null {
  for (const m of title.matchAll(/[\s,:;]+(?:för|for|für|pour|per)\s+/gi)) {
    const rest = title.slice(m.index! + 1).trimStart();
    if (!lineupFromTitle(rest)) continue;
    const head = title.slice(0, m.index!).replace(/[\s,:;]+$/, "");
    // A catalogue number after the line-up stays: it's what tells works apart
    const tail = /\b(?:op|opus|oe|no|nr|k|kv|bwv|hob|woo|d|sz|jw|rv)\.?\s*\d[^,:;(]*/i.exec(rest)?.[0].trim();
    return head.length >= 3 ? [head, tail].filter(Boolean).join(", ") : null;
  }
  return null;
}

// Genre words that alone don't name one work ("Sonat", "Trio nr 1" names one only with its number)
const GENERIC =
  /^(?:sonat[ae]?|sonatin[ae]?|trio|duo|duett?o?|kvartett|quartett?e?|quatuor|quartetto|kvintett|quintett?e?|svit|suite|konsert|concerto|konzert|fantasi[ae]?|fantasy|romans|romance|romanze|variationer|variationen|variations|preludium|prelude|präludium|etyd|etude|étude|etüde|etüden|studie|studien|studi|study|studies|konzerte|marsch|march|marche|vals|waltz|walzer|valse|menuett|minuet|scherzo|rondo|serenad[ae]?|divertimento|partita|nocturne|impromptu|sånger|lieder|songs|psalm|stycken|stücke|pieces|morceaux|toccata|fuga|fuge|fugue|sinfonia|symphony|symfoni|sinfonie|capriccio|ballad[ae]?|elegi[ae]?|air|aria|adagio|andante|allegro|intermezzo|pastoral[e]?|polska|dans|danse|tanz|musik|music|musique)s?$/i;

// Genre words in the languages titles come in, folded to ASCII, by the genre they name
const GENRES: [string, string[]][] = [
  ["sonata", ["sonat", "sonata", "sonate", "sonaten", "sonatas", "sonates"]],
  ["sonatina", ["sonatin", "sonatina", "sonatine", "sonatinen", "sonatinas"]],
  ["duo", ["duo", "duos", "duet", "duets", "duett", "duette", "duetto", "duetti"]],
  ["trio", ["trio", "trios"]],
  ["quartet", ["quartet", "quartets", "kvartett", "quartett", "quartette", "quatuor", "quatuors", "quartetto", "quartetti"]],
  ["quintet", ["quintet", "quintets", "kvintett", "quintett", "quintette", "quintetto"]],
  ["sextet", ["sextet", "sextett", "sextette", "sestetto"]],
  ["octet", ["octet", "oktett", "oktette", "ottetto"]],
  ["suite", ["suite", "suites", "svit", "suiten"]],
  ["concerto", ["concerto", "concertos", "concerti", "konsert", "konzert", "konzerte", "concierto"]],
  ["concertino", ["concertino", "concertinos", "konzertstuck"]],
  ["fantasia", ["fantasi", "fantasia", "fantasie", "fantasien", "fantasy", "fantaisie", "fantasias"]],
  ["romance", ["romans", "romance", "romances", "romanze", "romanzen", "romanza"]],
  ["variations", ["variationer", "variationen", "variations", "variazioni", "variaciones"]],
  ["prelude", ["preludium", "prelude", "preludes", "praludium", "praludien", "preludio"]],
  ["study", ["etyd", "etude", "etudes", "etuden", "etude", "studie", "studien", "studi", "study", "studies"]],
  ["march", ["marsch", "march", "marches", "marche", "marcia"]],
  ["waltz", ["vals", "waltz", "waltzes", "walzer", "valse", "valses"]],
  ["minuet", ["menuett", "minuet", "minuets", "menuet", "minuetto"]],
  ["serenade", ["serenad", "serenade", "serenades", "serenaden", "serenata"]],
  ["divertimento", ["divertimento", "divertimenti"]],
  ["nocturne", ["nocturne", "nocturnes", "notturno", "notturni"]],
  ["songs", ["sanger", "lieder", "lied", "songs", "song", "chansons", "canzoni"]],
  ["pieces", ["stycken", "stucke", "stuck", "pieces", "piece", "morceaux", "morceau"]],
  ["fugue", ["fuga", "fuge", "fugen", "fugue", "fugues"]],
  ["symphony", ["sinfonia", "sinfonie", "sinfonien", "symphony", "symphonies", "symfoni", "symphonie"]],
  ["mass", ["mass", "messe", "messen", "missa"]],
  ["dances", ["dans", "danse", "danses", "tanz", "tanze", "dances", "dance"]],
  ["ballade", ["ballad", "ballade", "ballades", "ballata"]],
  ["music", ["musik", "music", "musique"]],
  ["fanfare", ["fanfare", "fanfares", "fanfaren"]],
];
const GENRE_OF = new Map(GENRES.flatMap(([genre, words]) => words.map((w) => [w, genre] as const)));

/** The genre a title names, in any of its languages: "Konzerte" and "Horn Concerto No.1" → "concerto" */
export function genreOf(title: string): string | null {
  for (const word of normalize(title).split(" ")) {
    const g = GENRE_OF.get(word);
    if (g) return g;
  }
  return null;
}

/** Whether a title, numbers aside, is only a genre: "Sonat", "Trio, op. 6" */
export const onlyGenre = (title: string) =>
  GENERIC.test(
    title
      .toLowerCase()
      .replace(/\b(?:op|opus|nr|no|n:o)\.?\s*\d+\w*/g, "")
      .replace(/[\d\s.,:;()[\]-]+/g, " ")
      .trim(),
  );
