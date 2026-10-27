import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangerName, plain, readArrangements, THE_COMPOSER } from "./arrangements.ts";

const WIND_QUINTET = "bassoon,clarinet,flute,horn,oboe";

test("arrangers' names, as IMSLP writes them", () => {
  assert.equal(arrangerName("{{LinkArr|Jesper|Jerkert||}}"), "Jesper Jerkert");
  assert.equal(arrangerName("{{LinkArr|Maximilian Joseph|Leidesdorf}} (1787-1840)"), "Maximilian Joseph Leidesdorf");
  assert.equal(arrangerName("{{LinkArr|Notenschreiber}}"), "Notenschreiber");
  assert.equal(arrangerName("Charles Di Caro"), "Charles Di Caro");
  assert.equal(arrangerName("Composer"), THE_COMPOSER);
  assert.equal(arrangerName("[Composer's transcription]"), THE_COMPOSER);
  for (const unknown of ["Unknown", "composer?", "Anonymous", "{Anonymous}", "Anonymous (18th century)", "composer (probably)", "not credited; possibly Michel de Sicard", "", undefined])
    assert.equal(arrangerName(unknown), null, String(unknown));
});

test("wiki markup becomes text: keys, flats, links", () => {
  assert.equal(plain("Sonata in {{K|Bb}} (No.4)"), "Sonata in B-flat major (No.4)");
  assert.equal(plain("Aria: ''Cruda Sorte'' (Act I)"), "Aria: Cruda Sorte (Act I)");
  assert.equal(plain("Clarinet (B{{flat}})"), "Clarinet (B♭)");
});

test("arrangements: line-up from the heading, matched to the work's; excerpt; arranger", () => {
  const blocks = [
    { headings: ["Complete", "For 2 Violins, Viola and Cello"], arranger: "Unknown", copyright: "Public Domain" },
    { headings: ["Overture", "*For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)"], arranger: "{{LinkArr|Jesper|Jerkert||}}", tags: "fl ob cl bn hn (arr)", copyright: "Creative Commons Attribution-NonCommercial 4.0" },
    // A second file of the same arrangement
    { headings: ["Overture", "*For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)"], arranger: "{{LinkArr|Jesper|Jerkert||}}", copyright: "Public Domain" },
    // No arranger field: the heading's byline
    { headings: ["Selections", "For Piano 4 hands (Kleinmichel)"] },
    // A kind of orchestra IMSLP files as "orchestra"
    { headings: ["Overture", "For Theatre Orchestra (Weninger)"], arranger: "{{LinkArr|Leopold|Weninger|1879|1940}}" },
    // Not a line-up we can read
    { headings: ["For Keyboard or Harp"] },
  ];
  const lineups = new Set(["cello,viola,violin*2", WIND_QUINTET, "piano 4 hands", "orchestra"]);
  assert.deepEqual(
    readArrangements(blocks, lineups).map((a) => [a.lineup, a.arranger, a.excerpt]),
    [
      ["cello,viola,violin*2", null, null],
      [WIND_QUINTET, "Jesper Jerkert", "Overture"],
      ["piano 4 hands", "Kleinmichel", "Selections"],
      ["orchestra", "Leopold Weninger", "Overture"],
      [null, null, null],
    ],
  );
});
