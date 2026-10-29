import assert from "node:assert/strict";
import { test } from "node:test";
import { ensembleKey } from "../../src/lib/instrumentation.ts";
import { dnbHolding, dnbLineup, dnbText, mediaLineup, parseResponse } from "./dnb.ts";
import { k10plusCollection } from "./k10plus.ts";

const field = (tag: string, subs: [string, string][]) =>
  `<datafield tag="${tag}" ind1=" " ind2=" ">${subs.map(([c, v]) => `<subfield code="${c}">${v}</subfield>`).join("")}</datafield>`;
const record = (leader: string, id: string, ...fields: string[]) =>
  `<record><recordData><record xmlns="http://www.loc.gov/MARC21/slim" type="Bibliographic"><leader>${leader}</leader><controlfield tag="001">${id}</controlfield>${fields.join("")}</record></recordData></record>`;
const response = (...records: string[]) => `<searchRetrieveResponse><numberOfRecords>3</numberOfRecords><records>${records.join("")}</records></searchRetrieveResponse>`;

test("a DNB search result reduces to the printed music in it, the fields we use", () => {
  const { total, records } = parseResponse(
    response(
      record(
        "00000ncm a2200000 c 4500",
        "1396517014",
        field("100", [["0", "(DE-588)1080149961"], ["0", "https://d-nb.info/gnd/1080149961"], ["a", "Campogrande, Nicola"], ["d", "1969-"], ["e", "Komponist"], ["4", "cmp"]]),
        field("240", [["0", "(DE-588)1397222646"], ["a", "150 decibel"]]),
        field("245", [["a", "150 Decibel"], ["b", "for viola and piano"], ["c", "Nicola Campogrande"]]),
        field("264", [["a", "Wiesbaden"], ["b", "Breitkopf &amp; Härtel"], ["c", "[2025]"]]),
        field("300", [["a", "1 Partitur (12 Seiten), 1 Stimme"]]),
      ),
      // An arrangement: the arranger's role says so
      record(
        "00000ncm a2200000 c 4500",
        "1380309409",
        field("245", [["a", "Kleine Stücke"], ["b", "für Gitarre"]]),
        field("700", [["a", "Trautwein, Dieter"], ["e", "Arrangeur"], ["4", "arr"]]),
      ),
      // A recording: not printed music
      record("00000njm a2200000 c 4500", "1", field("245", [["a", "Live"]])),
    ),
  );
  assert.equal(total, 3);
  assert.deepEqual(records[0], {
    id: "1396517014",
    title: "150 Decibel",
    remainder: "for viola and piano",
    composer: { gnd: "1080149961", name: "Nicola Campogrande", born: 1969, died: null },
    composers: 1,
    work: { gnd: "1397222646", title: "150 decibel", media: [], arranged: false, selection: false },
    arranged: false,
    collection: false,
    year: 2025,
    publisher: "Breitkopf & Härtel",
    extent: "1 Partitur (12 Seiten), 1 Stimme",
  });
  assert.equal(records[1]!.arranged, true);
  assert.equal(records.length, 2);
  assert.equal(dnbHolding(records[0]!), "Score and parts · Breitkopf & Härtel · 2025");
});

test("an edition's line-up: its work's, else its title's; differing, neither", () => {
  const lineup = (title: string, remainder: string | null, media: [string, number][] = []) => {
    const l = dnbLineup({ title, remainder, work: media.length ? { gnd: null, title, media: media.map(([name, count]) => ({ name, count })), arranged: false, selection: false } : null });
    return l && ensembleKey(l);
  };
  assert.equal(lineup("150 Decibel", "for viola and piano"), "piano,viola");
  assert.equal(lineup("10 little songs", "für hohe Stimme und Klavier = 10 little songs : for high voice and piano"), null); // "hohe Stimme": not read
  assert.equal(lineup("Balletti", null, [["Violine", 2], ["Violoncello", 1], ["Cembalo", 1]]), "cello,harpsichord,violin*2");
  assert.equal(lineup("Sonate", "für Flöte und Klavier", [["Violine", 1], ["Klavier", 1]]), null); // an edition for flute of a violin sonata
});

test("K10plus's medium of performance: a field per instrument; a copy of DNB's record says so", () => {
  const { records } = parseResponse(
    response(
      record(
        "00000ccm a2200000 c 4500",
        "1861526768",
        field("016", [["a", "1299225489"], ["2", "DE-101"]]),
        field("245", [["a", "Quintetto a fiato"]]),
        field("382", [["a", "flute"], ["n", "1"]]),
        field("382", [["a", "violin"], ["n", "2"]]),
      ),
    ),
  );
  assert.equal(parseResponse(`<zs:searchRetrieveResponse><zs:numberOfRecords>3526</zs:numberOfRecords></zs:searchRetrieveResponse>`).total, 3526);
  assert.deepEqual(records[0]!.medium, [{ name: "flute", count: 1 }, { name: "violin", count: 2 }]);
  assert.equal(records[0]!.copyOf, "1299225489");
});

test("instruments as a line-up: GND's German terms, else English ones; unknown or qualified, none", () => {
  const key = (media: [string, number][]) => {
    const l = mediaLineup(media.map(([name, count]) => ({ name, count })));
    return l && ensembleKey(l);
  };
  assert.equal(key([["Querflöte", 1], ["Oboe", 1], ["Klarinette", 1], ["Horn", 1], ["Fagott", 1]]), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key([["flute", 1], ["oboe", 1], ["clarinet", 1], ["horn", 1], ["bassoon", 1]]), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key([["violin", 2], ["viola", 1], ["cello", 1]]), "cello,viola,violin*2");
  assert.equal(key([["violins (2), viola, cello", 1]]), "cello,viola,violin*2"); // a 240 $m from WorldCat
  assert.equal(key([["piano (prepared)", 1]]), null);
  assert.equal(key([["real-time electronics", 1], ["alto saxophone", 1]]), null);
  assert.equal(key([["winds", 1]]), null);
  // The medium and the title disagree: neither
  assert.equal(dnbLineup({ title: "Sonate für Flöte und Klavier", remainder: null, work: null, medium: [{ name: "violin", count: 1 }, { name: "piano", count: 1 }] }), null);
});

test("an older record's composer is its author; a composer may be named only as a contributor", () => {
  const { records } = parseResponse(
    response(
      record("00000ncm a2200000 c 4500", "1", field("100", [["a", "Reicha, Anton"], ["d", "1770-1836"], ["0", "(DE-588)118931482"], ["4", "aut"]]), field("245", [["a", "Bläserquintett B-Dur, op. 88,5"]])),
      record("00000ncm a2200000 c 4500", "2", field("245", [["a", "Joindre"]]), field("505", [["a", "Flute/piccolo part -- Oboe part"]]), field("700", [["a", "MacRae, Stuart"], ["d", "1976-"], ["4", "cmp"]])),
      record("00000ncm a2200000 c 4500", "3", field("100", [["a", "Seydel, Hans-Jakob"], ["4", "edt"]]), field("245", [["a", "Bläserquintett"]])),
    ),
  );
  assert.equal(records[0]!.composer?.name, "Anton Reicha");
  assert.deepEqual(records[1]!.composer, { gnd: null, name: "Stuart MacRae", born: 1976, died: null });
  assert.equal(records[1]!.contents, "Flute/piccolo part -- Oboe part");
  assert.equal(records[2]!.composer, null);
  // Line-ups: an ensemble's name as the title; instruments listed after it
  const key = (r: Parameters<typeof dnbLineup>[0]) => {
    const l = dnbLineup(r);
    return l && ensembleKey(l);
  };
  assert.equal(key({ title: "Bläserquintett B-Dur, op. 88,5", remainder: null, work: null }), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key({ title: "Quintet", remainder: "flute, oboe, clarinet, horn and bassoon op. 43", work: null }), "bassoon,clarinet,flute,horn,oboe");
  assert.equal(key({ title: "Quintet", remainder: "Variationen", work: null }), null);
  assert.equal(key({ title: "Streichquartett Nr. 8", remainder: "mit Bariton", work: null }), null); // more players than the title's ensemble
});

test("K10plus: a contents note makes a collection, unless it lists parts, or the record names its one work", () => {
  const work = { gnd: "300996772", title: "Variationen mit Fuge", media: [], arranged: false, selection: false };
  assert.equal(k10plusCollection({ contents: "Flute/piccolo part -- Oboe part -- Clarinet part" }), false);
  assert.equal(k10plusCollection({ contents: "Introduktion. Thema. 12 Variationen", work }), false);
  assert.equal(k10plusCollection({ contents: "Sonate A-Dur -- Sonate e-Moll -- Partita" }), true);
  assert.equal(k10plusCollection({ partOf: true, work }), true);
  // A uniform title for a composer's works doesn't make the contents one work
  assert.equal(k10plusCollection({ contents: "Pygmalion, Ariette -- Castor et Pollux, Air", work: { ...work, gnd: null, title: "Werke" } }), true);
  assert.equal(k10plusCollection({ contents: "Prélude -- Air -- Gigue", work: { ...work, gnd: null, title: "James Ensor suite" } }), false);
});

test("DNB's text is composed, without the joiners and sorting marks it puts in", () => {
  assert.equal(dnbText("Trois noe\u034f\u0308ls"), "Trois noëls");
  assert.equal(dnbText("H\u034faïkus"), "Haïkus");
  assert.equal(dnbText("\u0098G.\u009c Henle"), "G. Henle");
});
