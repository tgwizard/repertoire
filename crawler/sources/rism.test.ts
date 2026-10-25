import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePerson, parseSource, rismKey, rismMatchTitle, rismRank } from "./rism.ts";

const marc = (fields: string) => `<record>${fields}</record>`;
const df = (tag: string, subs: [string, string][]) =>
  `<datafield tag="${tag}" ind1=" " ind2=" ">${subs.map(([c, v]) => `<subfield code="${c}">${v}</subfield>`).join("")}</datafield>`;

test("a RISM source: composer, uniform title, catalogue numbers, holdings", () => {
  const s = parseSource(
    marc(
      `<controlfield tag="001">sources/1001</controlfield>` +
        df("100", [["a", "Haydn, Joseph"], ["0", "people/2"]]) +
        df("240", [["a", "Quartets"], ["m", "vl (2), vla, vlc"], ["r", "D"]]) +
        df("690", [["a", "Hob"], ["n", "III:75"]]) +
        df("593", [["a", "Manuscript copy"]]) +
        df("852", [["a", "A-Wn"], ["c", "Mus.Hs.1"], ["e", "Österreichische Nationalbibliothek"]]),
    ),
  )!;
  assert.equal(s.id, "1001");
  assert.equal(s.person, "2");
  assert.deepEqual(s.catalogue, [{ name: "Hob", number: "III:75" }]);
  assert.deepEqual(s.holdings, [{ siglum: "A-Wn", shelf: "Mus.Hs.1", library: "Österreichische Nationalbibliothek" }]);
  assert.equal(rismMatchTitle(s), "Quartets, Hob. III:75 in D major");
  // Not held anywhere (a lost source), or no composer: nothing to link.
  assert.equal(parseSource(marc(`<controlfield tag="001">sources/1</controlfield>` + df("240", [["a", "X"]]))), null);
});

test("keys, numbers and the order of copies", () => {
  assert.equal(rismKey("B|b"), "B-flat major");
  assert.equal(rismKey("f|x"), "F-sharp minor");
  assert.equal(rismKey("e"), "E minor");
  assert.equal(rismKey("1t"), null);
  assert.equal(rismMatchTitle({ title: "Quartets", numbers: "op. 76,3", catalogue: [], key: null }), "Quartets, Op. 76 No. 3");
  assert.equal(rismMatchTitle({ title: "Sonatas", numbers: null, catalogue: [{ name: "KV", number: "581" }], key: null }), "Sonatas, K. 581");
  assert.ok(rismRank("Autograph manuscript") < rismRank("Print") && rismRank("Print") < rismRank("Manuscript copy"));
});

test("RISM people bridge through GND and Wikidata ids", () => {
  const p = parsePerson(marc(`<controlfield tag="001">people/139</controlfield>` + df("024", [["a", "116001062"], ["2", "DNB"]]) + df("024", [["a", "Q506097"], ["2", "WKP"]])));
  assert.deepEqual(p, ["139", { gnd: "116001062", wikidata: "Q506097" }]);
});
