import assert from "node:assert/strict";
import { test } from "node:test";
import { gndKey, gndLineup, gndMatchTitle, gndTitle, parseWork, type GndWork } from "./gnd.ts";

test("GND instrumentation becomes a line-up; voice types are 'voice'; vague names give none", () => {
  assert.deepEqual(gndLineup([{ name: "Violine", count: 2 }, { name: "Viola", count: 1 }, { name: "Violoncello", count: 1 }]), { violin: 2, viola: 1, cello: 1 });
  assert.deepEqual(gndLineup([{ name: "Sopran", count: 1 }, { name: "Klavier", count: 1 }]), { voice: 1, piano: 1 });
  assert.deepEqual(gndLineup([{ name: "Klarinette", count: 1 }, { name: "Streichquartett", count: 1 }]), { clarinet: 1, violin: 2, viola: 1, cello: 1 });
  assert.equal(gndLineup([{ name: "Melodieinstrument", count: 1 }, { name: "Klavier", count: 1 }]), null);
  assert.equal(gndLineup([]), null);
});

test("German keys and titles", () => {
  assert.equal(gndKey("A-Dur"), "A major");
  assert.equal(gndKey("fis-Moll"), "F-sharp minor");
  assert.equal(gndKey("B-Dur"), "B-flat major");
  assert.equal(gndKey("h-Moll"), "B minor");
  assert.equal(gndKey("Es-Dur"), "E-flat major");
  assert.equal(gndKey("As-Dur"), "A-flat major");
  assert.equal(gndTitle("Quartette, Violine (2), Viola, Violoncello, G 198 (A-Dur)"), "Quartet in A major, G 198");
  assert.equal(gndTitle("Quartette, Violine (2), Viola, Violoncello, Nr. 3"), "Quartet No. 3");
  assert.equal(gndTitle("Kongsgaard variations"), "Kongsgaard variations");
  const w = { name: "Quartette, Violine (2), Viola, Violoncello, G 198 (A-Dur)", opus: ["op. 26, Nr. 4"], catalogue: ["G 198"], key: "A-Dur" } as GndWork;
  assert.equal(gndMatchTitle(w), "Quartet, G 198, Op. 26 No. 4, G 198 in A major");
});

test("a GND record: its composer, not a related work's", () => {
  const record = `<rdf:Description rdf:about="https://d-nb.info/gnd/1">
    <rdf:type rdf:resource="https://d-nb.info/standards/elementset/gnd#MusicalWork"/>
    <gndo:gndIdentifier>1</gndo:gndIdentifier>
    <gndo:preferredNameForTheWork>Sonaten, Violine, Klavier, op. 9</gndo:preferredNameForTheWork>
    <gndo:hasRelation><rdf:Description><gndo:firstComposer rdf:resource="https://d-nb.info/gnd/999"/></rdf:Description></gndo:hasRelation>
    <gndo:firstComposer rdf:resource="https://d-nb.info/gnd/42"/>
    <gndo:mediumOfPerformance rdf:resource="https://d-nb.info/gnd/v"/>
    <gndo:mediumOfPerformanceAsLiteral>Violine</gndo:mediumOfPerformanceAsLiteral>
    <gndo:mediumOfPerformance rdf:resource="https://d-nb.info/gnd/k"/>
    <gndo:mediumOfPerformanceAsLiteral>Klavier</gndo:mediumOfPerformanceAsLiteral>
    <gndo:opusNumericDesignationOfMusicalWork>op. 9</gndo:opusNumericDesignationOfMusicalWork>
    <owl:sameAs rdf:resource="http://www.wikidata.org/entity/Q123"/>`;
  const w = parseWork(record)!;
  assert.equal(w.composer, "42");
  assert.deepEqual(w.media, [{ name: "Violine", count: 1 }, { name: "Klavier", count: 1 }]);
  assert.equal(w.wikidata, "Q123");
});
