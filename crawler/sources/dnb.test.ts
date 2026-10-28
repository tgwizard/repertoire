import assert from "node:assert/strict";
import { test } from "node:test";
import { ensembleKey } from "../../src/lib/instrumentation.ts";
import { dnbHolding, dnbLineup, dnbText, parseResponse } from "./dnb.ts";

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

test("DNB's text is composed, without the joiners and sorting marks it puts in", () => {
  assert.equal(dnbText("Trois noe\u034f\u0308ls"), "Trois noëls");
  assert.equal(dnbText("H\u034faïkus"), "Haïkus");
  assert.equal(dnbText("\u0098G.\u009c Henle"), "G. Henle");
});
