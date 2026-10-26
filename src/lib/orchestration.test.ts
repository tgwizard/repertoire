import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOrchestration, EXAMPLES, fitsOrchestra, formatOrchestration, parseOrchestration, readOrchestration } from "./orchestration.ts";

const round = (s: string) => {
  const o = parseOrchestration(s);
  return o && formatOrchestration(o);
};

test("the shorthand, as people type it", () => {
  assert.equal(round("2.2.2.2 4.2.3.1 timp str"), "2.2.2.2 – 4.2.3.1 – timp – str");
  assert.equal(round("2222 4231 timp perc hp str"), "2.2.2.2 – 4.2.3.1 – timp – perc – hp – str");
  assert.equal(round("3+picc.2+eh.2.2 – 4.3.3.1 – timp – 3perc – 2hp – cel – str"), "3+picc.2+eh.2.2 – 4.3.3.1 – timp – 3perc – 2hp – cel – str");
  assert.equal(round("2.2.2.2+cbn, 4.2.3.0, timp, str"), "2.2.2.2+cbn – 4.2.3.0 – timp – str");
  assert.equal(round("2.2.2.2 2.2 timp str"), "2.2.2.2 – 2.2.0.0 – timp – str"); // trailing sections left out
  assert.equal(round("1.1.1.1 1.0.0.0 strings"), "1.1.1.1 – 1.0.0.0 – str");
  assert.equal(round("Pk Hf Str"), "0.0.0.0 – 0.0.0.0 – timp – hp – str");
  assert.equal(round("2.2.2.2 4.2.3.1 timp+perc+str"), "2.2.2.2 – 4.2.3.1 – timp – perc – str");
  assert.equal(round("2222 4231 timp 2harps strings"), "2.2.2.2 – 4.2.3.1 – timp – 2hp – str");
  assert.equal(round("2.2.2.2.2.2.2.2.2"), null);
  assert.deepEqual(readOrchestration("2.2.2.2 4.2.3.1 timp harpz str"), { orchestration: null, unreadable: "harpz" });
  for (const [, s] of EXAMPLES) assert.ok(parseOrchestration(s), s);
  assert.equal(round("a large orchestra"), null);
  assert.equal(round(""), null);
});

test("fits: enough players per section, auxiliaries included, and everything else", () => {
  const ours = parseOrchestration("3.2.2.2 4.2.3.1 timp 2perc hp str")!;
  const fits = (s: string) => fitsOrchestra(parseOrchestration(s)!, ours);
  assert.equal(fits("2+picc.2.2.2 4.2.3.1 timp perc str"), true); // our 3rd flautist plays piccolo
  assert.equal(fits("3+picc.2.2.2 4.2.3.1 timp str"), false);
  assert.equal(fits("2.2.2.2+cbn 4.2.3.0 timp str"), false); // a 3rd bassoonist
  assert.equal(fits("2.2.2.2 2.2.0.0 timp str"), true);
  assert.equal(fits("2.2.2.2 2.2.0.0 timp cel str"), false);
  assert.equal(fits("0.2.0.0 2.0.0.0 str"), true);
});

test("spelled out", () => {
  assert.equal(
    describeOrchestration(parseOrchestration("2+picc.2.2.2+cbn 4.2.3.1 timp 3perc hp str")!),
    "2 flutes, piccolo, 2 oboes, 2 clarinets, 2 bassoons, contrabassoon, 4 horns, 2 trumpets, 3 trombones, tuba, timpani, percussion (3 players), harp, strings",
  );
});
