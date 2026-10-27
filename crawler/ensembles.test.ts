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
  // Other languages; singers' accompaniment doesn't count
  assert.equal(titleFitsPlayers("Kvartett nr 2", QUARTET), true);
  assert.equal(titleFitsPlayers("Sechs Quartette", QUINTET), false);
  assert.equal(titleFitsPlayers("Duette für zwei Singstimmen mit Pianoforte-Begleitung", decodeEnsemble("voice:2,piano")), true);
  assert.equal(titleFitsPlayers("Quintet for clarinet and string quartet", decodeEnsemble("clarinet,violin:2,viola,cello")), true); // the first counts
  assert.equal(titleFitsPlayers("Zwei Trios für Orgel", decodeEnsemble("organ")), true); // trio sonatas
  assert.equal(titleFitsPlayers("Quartett für vier Schlagzeuger", decodeEnsemble("percussion")), true);
  assert.equal(titleFitsPlayers("Trio", decodeEnsemble("violin,cello")), false);
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
  assert.equal(openOpusEnsemble("Symphony no. 14, for soprano, bass, strings and percussion", "Orchestral", 1906), null);
  assert.equal(openOpusEnsemble("Violin Concerto in B flat major, op. 7/i, no. 2", "Orchestral", 1678), null);
  assert.equal(openOpusEnsemble("String Quartet no. 3, for soprano and string quartet, op. 40", "Chamber", 1914), null);
  assert.equal(openOpusEnsemble("String Quartet no. 2, for violin, viola, cello and double bass", "Chamber", 1941), null);
});
