import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEnsemble } from "../src/lib/instrumentation.ts";
import { openOpusEnsemble, titleFitsPlayers, wikidataInstrumentsFit } from "./ensembles.ts";

const QUINTET = decodeEnsemble("flute,oboe,clarinet,bassoon,horn");
const QUARTET = decodeEnsemble("violin:2,viola,cello");

test("title player counts must agree with the line-up", () => {
  assert.equal(titleFitsPlayers("Sextet", QUINTET), false); // Poulenc: piano + wind quintet
  assert.equal(titleFitsPlayers("Wind Quintet No. 4", QUINTET), true);
  assert.equal(titleFitsPlayers("Summer Music", QUINTET), true);
  assert.equal(titleFitsPlayers("Symphony No. 3 for 2 quartets", decodeEnsemble("orchestra")), true);
});

test("Wikidata instrumentation must not include extra instruments", () => {
  assert.equal(wikidataInstrumentsFit(["Q207338"], QUARTET), true);
  assert.equal(wikidataInstrumentsFit(["Q207338", "Q8355", "Q80284"], QUARTET), true);
  assert.equal(wikidataInstrumentsFit(["Q207338", "Q5994"], QUARTET), false); // + piano
  assert.equal(wikidataInstrumentsFit(["Q207338", "Q123456"], QUARTET), false); // unknown instrument
});

test("Open Opus titles", () => {
  assert.deepEqual(openOpusEnsemble("String Quartet no. 8 in C minor, op. 110", "Chamber", 1906), QUARTET);
  assert.deepEqual(openOpusEnsemble("Violin Concerto in D major, op. 77", "Orchestral", 1833), decodeEnsemble("violin,orchestra"));
  assert.equal(openOpusEnsemble("Violin Sonata in G minor", "Chamber", 1685), null); // continuo era
  assert.equal(openOpusEnsemble("Serenade", "Chamber", 1833), null);
});
