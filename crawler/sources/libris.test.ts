import assert from "node:assert/strict";
import { test } from "node:test";
import { ensembleKey, parseEnsembleKey } from "../../src/lib/instrumentation.ts";
import { agentLife, extractRecord, KSSB, kssbLineup, librisLineup, librisRecordLineup } from "./libris.ts";

test("LIBRIS instrumentation in Swedish becomes a line-up, or nothing", () => {
  assert.equal(librisLineup(["flöjt, violin, viola (2), violoncell"]), "cello,flute,viola*2,violin");
  assert.equal(librisLineup(["violin (2), viola, violoncell"]), "cello,viola,violin*2");
  assert.equal(librisLineup(["sång, piano"]), "piano,voice");
  assert.equal(librisLineup(["blandad kör, orkester"]), "mixed chorus,orchestra");
  assert.equal(librisLineup(["röst, piano (1882)"]), "piano,voice"); // a year, not 1882 pianos
  assert.equal(librisLineup(["violin, b.c. (1715)"]), "continuo,violin");
  assert.equal(librisLineup(["stråkar"]), null); // strings: a quartet? an orchestra?
  assert.equal(librisLineup(["violin, okänt instrument"]), null);
  assert.equal(librisLineup(["piano", "orgel"]), null); // alternatives
  assert.equal(librisLineup([]), null);
  // Ensembles by name; catalogue punctuation
  assert.equal(librisLineup(["blåskvintett"]), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(librisLineup(["stråkkvartett, piano"]), "cello,piano,viola,violin*2");
  assert.equal(librisLineup(["fagott, orkester;"]), "bassoon,orchestra");
  assert.equal(librisLineup(["piano, 4 h"]), "piano 4 hands");
});

test("a LIBRIS record's line-up: its field, else its title; disagreeing, neither; with neither, its classification", () => {
  const r = (title: string, medium: string[], kssb: string[] = []) => librisRecordLineup({ title, medium, kssb });
  assert.equal(r("Per spelman, variationer för blåskvintett", []), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(r("Drei Hymnen, für Bariton und Klavier", ["röst, piano"]), "piano,voice"); // the same instruments: the field's
  assert.equal(r("Duet no. II for 2 horns", ["horn"]), "horn*2"); // the title counts more players
  assert.equal(r("Konzert für Querflöte, Streicher und Basso continuo", ["flöjt, stråkorkester"]), "continuo,flute,strings"); // the title names more
  assert.equal(r("Partita d-Moll für Klarinette solo", ["flöjt"]), null); // an edition for another instrument
  assert.equal(r("Kvartett", ["violin (2), viola, violoncell"]), "cello,viola,violin*2");
  assert.equal(r("Quartet no. 32 C major, op. 20, no. 2", [], ["Xkeeb(st)"]), "cello,viola,violin*2");
  assert.equal(r("Sonate", [], ["Xeai"]), null); // a violin with a keyboard: piano? continuo? a reduction?
  assert.equal(r("Klavierstücke", [], ["Xda(s)"]), null); // a collection
  assert.equal(r("Quintett, op. 24, Nr. 2", [], ["Xkffb"]), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(r("Quintett für Bläser", [], ["Xkffb"]), null); // the title names a line-up, one we can't read
  assert.equal(r("Duo for flute and guitar", [], ["Xkeeb"]), "flute,guitar"); // the title first
  assert.equal(r("Estrellita, mexikansk sång arrangerad för sång och piano", [], ["Xoaba"]), null); // an arrangement
  assert.equal(r("Fantasie pour la Harpe avec Accompagnement d'Orchestre", [], ["Xle"]), null); // a line-up we can't read
  assert.equal(r("Valkyrian", [], ["Xoaba", "Xra"]), null); // a vocal score
});

test("classification codes: one line-up, or none", () => {
  for (const key of Object.values(KSSB)) assert.equal(ensembleKey(parseEnsembleKey(key)), key);
  assert.deepEqual(kssbLineup(["Xle(st)", "Xme(st)"]), { lineup: "orchestra", code: "Xle(st)" });
  assert.equal(kssbLineup(["Xda", "Xdb"]), null); // piano or organ
  assert.deepEqual(kssbLineup(["Xda", "Xda(up)"]), { lineup: "piano", code: "Xda" });
  assert.equal(kssbLineup(["Xeb(ö)"]), null);
});

test("a LIBRIS search result reduces to the fields we use", () => {
  const item = {
    "@id": "https://libris.kb.se/j1th055v4q7w6c0#it",
    hasTitle: [{ mainTitle: "Quintett für Flöte, Violine, zwei Violen und Violoncello, op. 41 Nr. 1" }],
    extent: [{ label: ["5 st."] }],
    publication: [{ year: "1997", agent: { label: "Doblinger" } }],
    instanceOf: {
      hasTitle: [{ mainTitle: "Kvintett", partNumber: ["op. 41."], partName: ["Nr 1"] }],
      contribution: [
        { "@type": "PrimaryContribution", agent: { "@type": "Person", familyName: "Romberg", givenName: "Bernhard", lifeSpan: "1767-1821", "@id": "https://libris.kb.se/abc#it" }, role: [{ code: "cmp" }] },
        { agent: { "@type": "Person", familyName: "Sawodny" }, role: [{ code: "oth" }] },
      ],
      musicMedium: [{ label: "flöjt, violin, viola (2), violoncell" }],
      classification: [{ code: "Xkef.05" }, { code: "780" }],
    },
    "@reverse": { itemOf: [{ heldBy: { "@id": "https://libris.kb.se/library/X" }, shelfMark: { label: "Xkef.05" } }, { heldBy: { "@id": "https://libris.kb.se/library/LMu" } }] },
  };
  assert.deepEqual(extractRecord(item), {
    id: "j1th055v4q7w6c0",
    title: "Quintett für Flöte, Violine, zwei Violen und Violoncello, op. 41 Nr. 1",
    uniform: "Kvintett, op. 41, Nr 1",
    composers: [{ family: "Romberg", given: "Bernhard", born: 1767, died: 1821, agent: "abc" }],
    arranged: false,
    medium: ["flöjt, violin, viola (2), violoncell"],
    kssb: ["Xkef.05"],
    extent: "5 st.",
    year: 1997,
    publisher: "Doblinger",
    shelf: "Xkef.05",
    held: ["LMu", "X"],
    collection: false,
  });
});

test("a composer's dates from their authority record: its life span, else its description", () => {
  const person = (p: object) => ({ "@graph": [{ "@type": "Record" }, { "@type": "Person", familyName: "Berkeley", ...p }] });
  assert.deepEqual(agentLife(person({ description: ["Engelsk tonsättare, 1903-1989"] })), { born: 1903, died: 1989 });
  assert.deepEqual(agentLife(person({ lifeSpan: "1938-" })), { born: 1938, died: null });
  assert.deepEqual(agentLife(person({ description: ["Svensk tonsättare, född 1971"] })), { born: 1971, died: null });
  assert.deepEqual(agentLife(person({ description: ["Organist i Uppsala"] })), { born: null, died: null });
  assert.deepEqual(agentLife(null), { born: null, died: null });
});
