import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEnsemble, describe, encodeEnsemble, ensembleKey, parseCategory, parseEnsembleKey } from "./instrumentation.ts";

test("parses counts and plurals", () => {
  assert.deepEqual(parseCategory("For 2 violins, viola, cello"), {
    parts: { violin: 2, viola: 1, cello: 1 },
    arr: false,
  });
  assert.deepEqual(parseCategory("For 2 double basses, 2 mixed choruses (arr)"), {
    parts: { "double bass": 2, "mixed chorus": 2 },
    arr: true,
  });
  assert.deepEqual(parseCategory("For 2 pianos 8 hands")?.parts, { "piano 8 hands": 2 });
  assert.deepEqual(parseCategory("For 2 English horns, 2 chalumeaux")?.parts, { "English horn": 2, chalumeau: 2 });
});

test("legacy '(2)' counts merge with the canonical form", () => {
  const a = parseCategory("For violins (2), viola, cello")!;
  const b = parseCategory("For 2 violins, viola, cello")!;
  assert.equal(ensembleKey(a.parts), ensembleKey(b.parts));
});

test("keeps generic descriptions and bare plurals intact", () => {
  assert.deepEqual(parseCategory("For voices, mixed chorus, orchestra")?.parts, {
    voices: 1,
    "mixed chorus": 1,
    orchestra: 1,
  });
  assert.deepEqual(parseCategory("For voices and chorus with orchestra")?.parts, {
    "voices and chorus with orchestra": 1,
  });
  assert.deepEqual(parseCategory("For strings")?.parts, { strings: 1 });
});

test("splits 'and'", () => {
  assert.deepEqual(parseCategory("For violin, cello and piano")?.parts, { violin: 1, cello: 1, piano: 1 });
});

test("rejects aggregates and spam", () => {
  assert.equal(parseCategory("For 5 players"), null);
  assert.equal(parseCategory("For 1 player"), null);
  assert.equal(parseCategory("For 2 players with continuo (arr)"), null);
  assert.equal(parseCategory("For 2 violins') and 1=2 and ('1'='1"), null);
  assert.equal(parseCategory("For orchestra&transclude=Template:Catintro"), null);
  assert.equal(parseCategory("Scores featuring the horn"), null);
});

test("ensemble keys round trip", () => {
  const e = { violin: 2, viola: 1, cello: 1 };
  assert.equal(ensembleKey(e), "cello,viola,violin*2");
  assert.deepEqual(parseEnsembleKey(ensembleKey(e)), { cello: 1, viola: 1, violin: 2 });
});

test("url round trip", () => {
  const e = { cello: 1, violin: 2, viola: 1 };
  assert.equal(encodeEnsemble(e), "violin:2,viola,cello");
  assert.deepEqual(decodeEnsemble("violin:2,viola,cello"), { violin: 2, viola: 1, cello: 1 });
});

test("describe pluralizes labels", () => {
  assert.equal(describe({ violin: 2, viola: 1, cello: 1 }), "2 violins, viola, cello");
  assert.equal(describe({ "double bass": 2, bass: 2, timpani: 2 }), "2 double basses, 2 timpani, 2 basses (voice)");
});
