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
  assert.equal(round("2.2.2.2 2.2 timp harmonium str"), "2.2.2.2 – 2.2.0.0 – timp – harm – str");
  assert.equal(round("a large orchestra"), null);
  assert.equal(round(""), null);
});

test("doublings: after a slash, played by one of the section's players", () => {
  assert.equal(round("3/picc.2/eh.2.2 4.2.3.1 timp str"), "3/picc.2/eh.2.2 – 4.2.3.1 – timp – str");
  assert.deepEqual(parseOrchestration("3/picc.2.2.2"), { fl: 3, "fl/picc": 1, ob: 2, cl: 2, bn: 2 });
  assert.equal(round("2/picc+picc.2.2.2 pf/cel str"), "2/picc+picc.2.2.2 – 0.0.0.0 – pf/cel – str");
  assert.equal(round("2.2.2.2 tba/picc"), null); // a tuba player doesn't double piccolo
  assert.equal(round("2/tuba.2.2.2"), null);
});

test("fits: the players, and only the doublings we say we have", () => {
  const ours = parseOrchestration("3.2.2.2 4.2.3.1 timp 2perc hp str")!;
  const fits = (s: string, o = ours) => fitsOrchestra(parseOrchestration(s)!, o);
  assert.equal(fits("2.2.2.2 2.2.0.0 timp str"), true);
  assert.equal(fits("2.2.2.2+cbn 4.2.3.0 timp str"), false); // no contrabassoon
  assert.equal(fits("2.2.2.2 2.2.0.0 timp cel str"), false);
  assert.equal(fits("0.2.0.0 2.0.0.0 str"), true);
  // A flautist doesn't play piccolo unless we say so
  assert.equal(fits("2+picc.2.2.2 4.2.3.1 timp perc str"), false);
  const doubling = parseOrchestration("3/picc.2.2.2 4.2.3.1 timp 2perc hp str")!;
  assert.equal(fits("2+picc.2.2.2 4.2.3.1 timp perc str", doubling), true); // our third flautist plays the piccolo part
  assert.equal(fits("3/picc.2.2.2 4.2.3.1 timp str", doubling), true);
  assert.equal(fits("3+picc.2.2.2 4.2.3.1 timp str", doubling), false); // four players
  assert.equal(fits("2/2picc.2.2.2 4.2.3.1 timp str", doubling), false); // two who double
  // A piccolo player of our own can take the piccolo half of a doubled part, a flautist the rest
  const piccolo = parseOrchestration("3+picc.2.2.2 4.2.3.1 timp str")!;
  assert.equal(fits("3/picc.2.2.2 4.2.3.1 timp str", piccolo), true);
  assert.equal(fits("3/picc+picc.2.2.2 4.2.3.1 timp str", piccolo), false);
  // Doublings on two auxiliaries may be one player's: a piccolo and an alto flute part at once need two
  const both = parseOrchestration("2/picc/afl.0.0.0")!;
  assert.equal(fitsOrchestra({ fl: 1, picc: 1, afl: 1 }, both), false);
  assert.equal(fitsOrchestra({ fl: 2, "fl/picc": 1 }, both), true);
  assert.equal(fitsOrchestra({ fl: 1, picc: 1, afl: 1 }, parseOrchestration("3/2picc/2afl.0.0.0")!), true); // three players, two who double
  // Keyboards are separate instruments: an organ work needs an organ
  assert.equal(fits("2.2.2.2 2.2.0.0 timp org str", parseOrchestration("2.2.2.2 2.2.0.0 timp pf str")!), false);
  assert.equal(fits("2.2.2.2 2.2.0.0 timp sax str", parseOrchestration("2.2.2.2 2.2.0.0 timp gtr str")!), false);
});

test("exact: the same instruments and players", () => {
  const exact = (work: string, ours: string) => fitsOrchestra(parseOrchestration(work)!, parseOrchestration(ours)!, true);
  assert.equal(exact("2.2.2.2 2.2.0.0 timp str", "2.2.2.2 2.2 timp str"), true);
  // Saint-Saëns's Third: organ, English horn, bass clarinet and contrabassoon aren't "piano and ordinary winds"
  assert.equal(exact("3.2+eh.2+bcl.2+cbn 4.3.3.1 timp perc org pf str", "3.3.3.3 4.3.3.1 timp perc pf str"), false);
  assert.equal(exact("3/picc.2.2.2 2.2.0.0 timp str", "3.2.2.2 2.2.0.0 timp str"), false);
});

test("spelled out", () => {
  assert.equal(
    describeOrchestration(parseOrchestration("2+picc.2.2.2+cbn 4.2.3.1 timp 3perc hp str")!),
    "2 flutes, piccolo, 2 oboes, 2 clarinets, 2 bassoons, contrabassoon, 4 horns, 2 trumpets, 3 trombones, tuba, timpani, percussion (3 players), harp, strings",
  );
  assert.equal(describeOrchestration(parseOrchestration("3/picc.1/eh pf/cel")!), "3 flutes (one also piccolo), oboe (also English horn), piano (also celesta)");
});
