import assert from "node:assert/strict";
import { test } from "node:test";
import { gndAliases, gndKey, gndLineup, gndMatchTitle, gndPart, gndTitle, gndYear, parseWork, type GndWork } from "./gnd.ts";

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
  assert.equal(gndTitle("Quartette, Vl 1 2, Va, Vc, Nr. 2"), "Quartet No. 2");
  assert.equal(gndTitle("Quintette, Fl, Ob, Klar, Hr, Fg, op. 35"), "Quintet, op. 35");
  assert.equal(gndTitle("Quartette, Sz 40"), "Quartet, Sz 40");
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

test("parts of works: the work and the part, numbers in a set told apart from movements", () => {
  const part = (name: string) => gndPart({ name } as never);
  // An aria, a number in a set: pieces of their own too; a movement isn't
  assert.deepEqual(part("Lakmé. Où va la jeune Indoue"), { parent: "Lakmé", part: "Où va la jeune Indoue", numbered: false, standalone: true });
  assert.deepEqual(part("Sonata, Violoncello. No. 1"), { parent: "Sonata, Violoncello", part: "No. 1", numbered: true, standalone: true });
  assert.deepEqual(part("Etüden, Org (2005). Etüde, No. 5"), { parent: "Etüden, Org (2005)", part: "Etüde, No. 5", numbered: true, standalone: true });
  assert.deepEqual(part("Manfred. Ouvertüre"), { parent: "Manfred", part: "Ouvertüre", numbered: false, standalone: false });
  assert.equal(part("Die kleine Passion. Teil 6")?.standalone, false);
  assert.equal(part("Sonaten, op. 11. Nr. 2 (E-Dur)")?.numbered, true);
  assert.equal(part("Sonate, S C 740 (a-Moll). Presto")?.standalone, false);
  // Its other names can say it's a movement ("1. Satz")
  assert.equal(gndPart({ name: "Trios, Violine, Violoncello, Klavier. Modéré", variants: ["Klaviertrio a-Moll. 1. Satz"] } as never)?.standalone, false);
  assert.equal(part("Konzerte, Cembalo obbligato, Violine (2), Viola, Basso continuo, HH.32 n. 3 (D-Dur)"), null);
  // Abbreviations aren't the separator
  assert.equal(part("Sinfonien, Singst. 1 2, Nr. 8"), null);
  assert.equal(part("Quartette, op. 18, Nr. 1"), null);
  assert.equal(part('Choräle aus der Sammlung "Joh. Seb. Bachs vierstimmige Choralgesänge". Der Tag')?.part, "Der Tag");
});

test("years and other names", () => {
  const w = (name: string, year: number | null, variants: string[] = []) => ({ name, year, variants }) as never;
  assert.equal(gndYear(w("Konzerte, Horn, Orchester (2003)", null)), 2003);
  assert.equal(gndYear(w("Konzerte, Tuba, Orchester", 1985)), 1985);
  assert.equal(gndYear(w("Lieder", null, ["Lieder (1910)"])), null); // a variant's year may be an edition's
  assert.deepEqual(gndAliases(w("Studien, Querflöte, Klarinette, Fagott", 1958, ["Tre studi per flauto, clarinetto e fagotto", "Studien, Fl, Klar, Fg (1958)", "Sonaten op. 11, 3"])), [
    "Tre studi per flauto, clarinetto e fagotto",
  ]);
});
