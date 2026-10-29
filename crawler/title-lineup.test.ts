import assert from "node:assert/strict";
import { test } from "node:test";
import { ensembleKey } from "../src/lib/instrumentation.ts";
import { ensembleTitle, lineupFromTitle, onlyGenre, withoutLineup } from "./title-lineup.ts";

const key = (title: string) => {
  const e = lineupFromTitle(title);
  return e && ensembleKey(e);
};

test("titles spell out line-ups in several languages", () => {
  assert.equal(key("Per spelman, variationer för blåskvintett"), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key("Fyra sånger för en röst och piano"), "piano,voice");
  assert.equal(key("Duett för två violiner, op. 3"), "violin*2");
  assert.equal(key("Svensk svit N:o 1, för violin, viola och violoncell op. 18"), "cello,viola,violin");
  assert.equal(key("Sechs Quartette, für Flöte, Klarinette, Horn und Fagott"), "bassoon,clarinet,flute,horn");
  assert.equal(key("Quintett F-Dur für Bläserquintett"), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key("Sonate für Klavier zu vier Händen"), "piano 4 hands");
  assert.equal(key("Sonate h-moll für Klavier zu 2 Händen"), "piano");
  assert.equal(key("Quatuor pour clarinette[,] violon, alto et violoncelle, oe. 4"), "cello,clarinet,viola,violin"); // alto: a viola in French
  assert.equal(key("Caprices en forme de valse, pour le piano : op. 2"), "piano");
  assert.equal(key("Janus, per violino e chitarra : op. 92"), "guitar,violin");
  assert.equal(key("Davids 84. psalm, (vers 1-5) for sopran, violin og orgel (harmonium el. klaver) : [op. 30]"), "organ,soprano,violin");
  assert.equal(key("Three Elizabethan fancies, for 2 oboes, 2 clarinets, 2 bassoons and 2 horns"), "bassoon*2,clarinet*2,horn*2,oboe*2");
  assert.equal(key("Quartet for flute, oboe, clarinet in A and bassoon"), "bassoon,clarinet,flute,oboe");
  assert.equal(key("Romans för violin och piano, op. 2 i F-dur"), "piano,violin");
  assert.equal(key("Koraler för blandad kör a cappella"), "mixed chorus");
  assert.equal(key("Sori, für Flöte solo : 1988"), "flute");
  assert.equal(key("Das Lied von der Erde : a symphony for tenor, contralto (or baritone) and orchestra"), "alto,orchestra,tenor");
  assert.equal(key("Concerto per flauto ed orchestra da camera, (1992)"), "chamber orchestra,flute");
});

test("no line-up unless every word is understood, and it's the work's own", () => {
  for (const title of [
    "Love for sale",
    "Music for a while",
    "Mitt land, för piano, orgel (harmonium), solo och manskör", // "solo"?
    "Coola ner!, arr för kör och bas", // an arrangement
    "Concerto pour violon, réduction pour violon et piano", // a reduction
    "Concerto No. 8 in A minor, Opus 47 : for flute and piano", // a concerto's piano reduction
    "Konsert för violin", // the orchestra left out
    "Symphonie pathétique No. 6, für das Pianoforte zu zwei Händen",
    "Dollarprinsessan, operett i 3 akter ; potpurri för piano",
    "Ausgewählte Werke für Gitarre", // an anthology
    "Sonata for violin or flute and piano", // alternatives
    "Sinfonia für Querflöte, zwei Klarinetten in B, Fagott, zwei Violinen, Viola und Bass", // which bass?
    "Variations for the left hand",
    "Air för violin och piano – Arie for violin and orchestra", // two line-ups: which?
  ])
    assert.equal(key(title), null, title);
});

test("titles less their line-up, to match other sources' titles; a genre alone names no work", () => {
  assert.equal(withoutLineup("Danzas argentinas, pour piano"), "Danzas argentinas");
  assert.equal(withoutLineup("Como una fantasía, für Violoncello solo (1979)"), "Como una fantasía");
  assert.equal(withoutLineup("Trio nr 1 för violin, violoncell och piano, op. 6"), "Trio nr 1, op. 6"); // the number stays
  assert.equal(withoutLineup("Love for sale"), null);
  assert.ok(onlyGenre("Sonat") && onlyGenre("Trio nr 1, op. 6") && onlyGenre("Svit nr 2"));
  assert.ok(!onlyGenre("Danzas argentinas") && !onlyGenre("Processionsmusik"));
});

test("a title that is an ensemble's name, with a number, key or year after it", () => {
  const key = (t: string) => {
    const l = ensembleTitle(t);
    return l && ensembleKey(l);
  };
  assert.equal(key("Bläserquintett B-Dur, op. 88,5"), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key("Woodwind quintet (1948)"), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key("3. Bläserquintett op. 29"), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key("Streichquartett Nr. 2"), "cello,viola,violin*2");
  assert.equal(key("Quintette à vent"), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key("Bläserquintette"), null); // a set
  assert.equal(key("Bläserquintett-Satz"), null);
  assert.equal(key("Music for wind quintet"), null); // "for …" is lineupFromTitle's
  assert.equal(key("Wind quintet, arr. for brass"), null);
  assert.equal(key("Streichquartett Nr. 8 mit Bariton"), null); // more players than the ensemble
  assert.equal(key("Streichquartett Nr. 8"), "cello,viola,violin*2");
});

test("of alternatives joined by a slash, the first; orchestral excerpts, none", () => {
  assert.equal(key("Calculated wounds, for alto/tenor/baritone saxophone & piano"), "alto saxophone,piano");
  assert.equal(key("Serenade für Flöte/Violine und Gitarre"), "flute,guitar");
  assert.equal(key("Drei Inventionen für Trompete in B/C und Cembalo"), "harpsichord,trumpet");
  assert.equal(key("Sonate für Violine und Klavier / Johannes Brahms"), "piano,violin");
  assert.equal(key("Orchesterstudien für Viola"), null);
});
