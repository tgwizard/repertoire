import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOrchestration } from "../src/lib/orchestration.ts";
import { isFullOrchestra, orchestrationFromParts, orchestrationFromRism, orchestrationFromText } from "./orchestration.ts";

const parts = (...d: string[]) => formatOrchestration(orchestrationFromParts(d).orchestration);
const text = (t: string) => {
  const r = orchestrationFromText(t);
  return r && formatOrchestration(r.orchestration);
};

test("part names: highest number per instrument, plurals, doublings, percussion sheets", () => {
  // Real IMSLP part lists
  assert.equal(
    parts("Flute 1", "Flute 2", "Oboe 1", "Oboe 2", "Clarinet 1 (B{{flat}}/A)", "Clarinet 2 (B{{flat}}/A)", "Bassoon 1", "Bassoon 2", "Contrabassoon",
      "Horn 1 (C/E/E{{flat}})", "Horn 2 (C/E/E{{flat}})", "Horn 3 (E{{flat}}/B/E/F)", "Horn 4 (E{{flat}}/B/E/F)", "Trumpet 1 (C/E/B{{flat}})", "Trumpet 2 (C/E/B{{flat}})",
      "Alto Trombone", "Tenor Trombone", "Bass Trombone", "Timpani", "Violins I", "Violins II", "Violas", "Cellos", "Basses"),
    "2.2.2.2+cbn – 4.2.3.0 – timp – str",
  );
  assert.equal(parts("Horn 1/2, 3/4 (F)", "Trombone 1, 2, 3, Tuba", "Cellos/Basses"), "0.0.0.0 – 4.0.3.1 – str");
  assert.equal(parts("Flute 1, 2, 3/Piccolo", "Oboe 1, 2, English Horn"), "3.2+eh.0.0 – 0.0.0.0"); // the 3rd flute doubles
  assert.equal(parts("Piccolo, Flute 1, 2"), "2+picc.0.0.0 – 0.0.0.0");
  assert.equal(parts("Flauti", "Corni in F", "Violino I"), "2.0.0.0 – 2.0.0.0 – str");
  assert.equal(parts("Horn I (F)", "Horn VIII (F)", "Trumpet I-III"), "0.0.0.0 – 8.3.0.0");
  assert.equal(parts("Clarinet in B-flat 1/2", "Trumpet in B-flat 1/2"), "0.0.2.0 – 0.2.0.0");
  assert.equal(parts("Timpani", "Snare Drum", "Bass Drum/Cymbals", "Triangle"), "0.0.0.0 – 0.0.0.0 – timp – 3perc");
  // Stand-ins and optional parts aren't more players
  assert.equal(parts("Bass Clarinet (alternate for Bassoon 1)", "Alto Saxophone (E{{Flat}}, substitute for Horn 1)", "Harmonium (ad lib.)", "Euphonium (for Horn 2)"), "0.0.0.0 – 0.0.0.0");
  // Across sections a shared sheet is two players; an offstage band isn't the orchestra
  assert.equal(parts("Trombone 1, 2, 3/Tuba", "Horn 1 (F, Banda)", "Horn 5 (offstage)"), "0.0.0.0 – 0.0.3.1");
  assert.equal(parts("Alto Saxophone (E{{flat}})", "Tenor Saxophone (B{{flat}})", "Baritone Saxophone"), "0.0.0.0 – 0.0.0.0 – 3sax");
  assert.equal(parts("Percussion<br><small>Timpani/Bass Drum/Cymbals</small>"), "0.0.0.0 – 0.0.0.0 – timp – perc");
  // Not instruments, or the soloist rather than the orchestra
  assert.equal(parts("Complete Score", "Complete Parts", "Violin Solo", "Cover", "Engraving files (Finale)"), "0.0.0.0 – 0.0.0.0");
  assert.deepEqual(orchestrationFromParts(["Heckelphone", "Oboe 1"]).unknown, ["Heckelphone"]);
});

test("Instrumentation field: counts, number words, the shorthand", () => {
  assert.equal(
    text("''Orchestra:'' piccolo, 2 flutes, 2 oboes, 2 clarinets (A), 2 bassoons + 4 horns (F), 2 trumpets (F), 3 trombones + timpani + strings"),
    "2+picc.2.2.2 – 4.2.3.0 – timp – str",
  );
  assert.equal(
    text("3 flutes, 3 oboes (3rd also English horn),<br>3 clarinets (B{{flat}}) (3rd also bass clarinet (B{{flat}})), 3 bassoons<br>4 horns, 3 trumpets, 3 trombones, tuba, timpani, strings"),
    "3.3.3.3 – 4.3.3.1 – timp – str",
  );
  assert.equal(text("3-3-3-3 4-3-3-1 Percussion, 2 Harps, Piano, Strings"), "3.3.3.3 – 4.3.3.1 – perc – 2hp – pf – str");
  assert.equal(text("timpani, side drum, bass drum, cymbals, two horns, strings"), "0.0.0.0 – 2.0.0.0 – timp – perc – str"); // named percussion: one player
  assert.equal(text("2 oboes, bassoon, strings, continuo"), "0.2.0.1 – 0.0.0.0 – bc – str");
  assert.equal(text("''Solo'': piano<br>''Orchestra'': 2 flutes, 2 oboes, 2 clarinets (B{{flat}}), 2 bassoons + 2 horns + strings"), "2.2.2.2 – 2.0.0.0 – str");
  assert.equal(text("2 flutes, 2 horns, 2 trumpets, 4 timpani, strings, basso continuo"), "2.0.0.0 – 2.2.0.0 – timp – bc – str");
  assert.equal(text("orchestra"), null);
  assert.equal(text("violin, orchestra"), null);
});

test("RISM parts: abbreviations; voices and soloists aren't the orchestra; unknown parts reject the copy", () => {
  const rism = (s: [string, number][]) => {
    const o = orchestrationFromRism(s);
    return o && formatOrchestration(o);
  };
  assert.equal(
    rism([["vl", 2], ["vla", 1], ["vlc", 1], ["cb", 1], ["fl", 2], ["ob", 2], ["cl", 2], ["fag", 2], ["cor", 4], ["tr", 2], ["trb", 3], ["timp", 1]]),
    "2.2.2.2 – 4.2.3.0 – timp – str",
  );
  assert.equal(rism([["S", 1], ["vl 1", 1], ["vl 2", 1], ["vla", 1], ["b", 1], ["ob", 2], ["cor in F", 2], ["clno", 2]]), "0.2.0.0 – 2.2.0.0 – str");
  assert.equal(rism([["vl", 2], ["mystery horn", 1]]), null);
});

test("a whole orchestra: strings and a wind, brass or timpani part", () => {
  assert.equal(isFullOrchestra({ str: 1 }), false);
  assert.equal(isFullOrchestra({ ob: 2, hn: 2 }), false);
  assert.equal(isFullOrchestra({ ob: 2, str: 1 }), true);
});
