import assert from "node:assert/strict";
import { test } from "node:test";
import { formatOrchestration, parseOrchestration } from "../src/lib/orchestration.ts";
import { chooseScoring, isFullOrchestra, orchestrationFromParts, orchestrationFromRism, orchestrationFromText, type Reading } from "./orchestration.ts";

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
  assert.equal(parts("Flute 1, 2, 3/Piccolo", "Oboe 1, 2, English Horn"), "3/picc.2+eh.0.0 – 0.0.0.0"); // the 3rd flute doubles
  assert.equal(parts("Flute 1, 2/Piccolo 2, 3/Piccolo 1", "Piano/Celesta"), "3/2picc.0.0.0 – 0.0.0.0 – pf/cel");
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
  // Keys before the name, "part" after; instruments the scoring tables didn't have
  assert.equal(parts("B{{flat}} Clarinet 1", "F Horn 1", "Horn in F 2 part", "Heckelphone", "Bass Flute", "Bass Oboe (also Oboe 3)", "Harmonium"), "0+bfl.0+bob+hck.1.0 – 2.0.0.0 – harm");
  assert.equal(parts("Organ", "Piano 4-hands", "Glockenspiel/Cowbell/Thunder Machine"), "0.0.0.0 – 0.0.0.0 – perc – 2pf – org");
  // Asides: doublings and players are requirements; instruments we can't place make it partial
  assert.equal(parts("Flute 1, 2", "Flute 3 (also Piccolo)", "Timpani (2 players)", "Percussion (3 players)"), "3/picc.0.0.0 – 0.0.0.0 – 2timp – 3perc");
  assert.deepEqual(orchestrationFromParts(["Flute 3/4 (3 also Piccolo, 4 also Piccolo, Alto* or Bass Flute)"]).unresolved, ["Flute 3/4 (3 also Piccolo, 4 also Piccolo, Alto* or Bass Flute)"]);
  assert.deepEqual(orchestrationFromParts(["Clarinet 1 (B{{flat}}/A)", "Horn 3/4 (E{{flat}})", "Violins I (div.)", "Bass Oboe (also Oboe 3)", "Oboe 1, 2"]).unresolved, []);
  // Keys left over after a comma, and alternatives, aren't parts we can't read
  assert.deepEqual(orchestrationFromParts(["Clarinet 1 (A) (original), B{{flat}} (transposed)", "Trumpet 1 or Soprano Saxophone (B{{flat}})"]).unknown, []);
  assert.equal(parts("Trumpet 1 or Soprano Saxophone (B{{flat}})", "Trumpet 2 or Soprano Saxophone"), "0.0.0.0 – 0.2.0.0");
  // What we can't read: a requirement we don't know, unless it's a voice or a score
  const read = orchestrationFromParts(["Oboe 1", "Soprano", "Vocal Score", "Typewriter", "Alto Horn 1 (E{{flat}})"]);
  assert.deepEqual(read.unknown, ["Soprano", "Vocal Score", "Typewriter", "Alto Horn 1 (E{{flat}})"]);
  assert.deepEqual(read.unresolved, ["Typewriter", "Alto Horn 1 (E{{flat}})"]);
});

test("Instrumentation field: counts, number words, the shorthand", () => {
  assert.equal(
    text("''Orchestra:'' piccolo, 2 flutes, 2 oboes, 2 clarinets (A), 2 bassoons + 4 horns (F), 2 trumpets (F), 3 trombones + timpani + strings"),
    "2+picc.2.2.2 – 4.2.3.0 – timp – str",
  );
  assert.equal(
    text("3 flutes, 3 oboes (3rd also English horn),<br>3 clarinets (B{{flat}}) (3rd also bass clarinet (B{{flat}})), 3 bassoons<br>4 horns, 3 trumpets, 3 trombones, tuba, timpani, strings"),
    "3.3/eh.3/bcl.3 – 4.3.3.1 – timp – str",
  );
  assert.equal(text("2 flutes (2nd doubling piccolo), 2 oboes, 2 horns, strings"), "2/picc.2.0.0 – 2.0.0.0 – str");
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

test("the scoring readings agree on: confirmed by two, a single itemized one, or partial", () => {
  const reading = (shorthand: string, source: Reading["source"] = "parts", over: Partial<Reading> = {}): Reading => ({
    o: parseOrchestration(shorthand)!, source, ref: "1", unresolved: [], named: 20, ...over,
  });
  const choose = (...r: Reading[]) => {
    const s = chooseScoring(r, isFullOrchestra);
    return s && [formatOrchestration(s.o), s.status, s.basis];
  };
  // An edition's parts and the Instrumentation field agree (percussion from the parts)
  assert.deepEqual(choose(reading("2.2.2.2 4.2.3.1 timp 2perc str"), reading("2.2.2.2 4.2.3.1 timp str", "text")), [
    "2.2.2.2 – 4.2.3.1 – timp – 2perc – str", "confirmed", "an edition's parts and the Instrumentation field",
  ]);
  // The continuo and what realises it are one part; keys either side, in French too; a bare auxiliary in an aside is doubled
  for (const d of ["Continuo (organ)", "Organ (continuo)", "Continuo (cellos, basses, keyboard)", "Horn 1 (B{{flat}} basso)", "Trumpet Bb", "Cor en Fa", "Crotales"])
    assert.deepEqual(orchestrationFromParts([d]).unresolved, [], d);
  assert.equal(parts("Flute 1/2 (piccolo)", "Trumpet Bb", "String parts"), "2/picc.0.0.0 – 0.1.0.0 – str");
  // Trombones as alto, tenor and bass, and clefs, aren't requirements we can't read
  assert.deepEqual(orchestrationFromParts(["Trombone 1, 2, 3 (Alto, Tenor, Bass)", "Trombone 1 (Alto, Tenor Clef)"]).unresolved, []);
  // Readings that differ: each instrument at the most any asks for, never confirmed
  assert.deepEqual(choose(reading("2.2.2.2 4.2.3.0 timp str"), reading("3.2.2.2 2.2.0.0 timp str")), [
    "3.2.2.2 – 4.2.3.0 – timp – str", "single", "2 editions' parts, which differ: each instrument at the most any asks for",
  ]);
  assert.equal(choose(reading("2.2.2.2 2.2 timp str"), reading("2.2.2.2 2.2 timp str", "rism"), reading("3.2.2.2 2.2 timp str"))![1], "single");
  // A reading outside the majority can't hide what it asks for, nor what we can't read in it
  const outvoted = choose(reading("2.2 str"), reading("2.2 str"), reading("2.2 hp str", "text", { unresolved: ["Typewriter"] }))!;
  assert.deepEqual(outvoted, ["2.2.0.0 – 0.0.0.0 – hp – str", "partial", "2 editions' parts and the Instrumentation field, which differ: each instrument at the most any asks for"]);
  // Libraries' copies don't decide when IMSLP has the scoring (a copy may add parts or arrange), but confirm it
  assert.deepEqual(choose(reading("2.2.2.2 2.2 timp str"), reading("2.2.4.2 4.2.3.1 timp pf str", "rism")), ["2.2.2.2 – 2.2.0.0 – timp – str", "single", "an edition's parts"]);
  assert.deepEqual(choose(reading("2.2.2.2 2.2 timp str"), reading("2.2.2.2 2.2 timp str", "rism")), ["2.2.2.2 – 2.2.0.0 – timp – str", "confirmed", "an edition's parts; a library's copy agrees"]);
  // A piccolo part one edition prints apart and another as the 3rd flute's doubling is one part
  assert.equal(choose(reading("3+picc.2.2.2 4.2.3.1 timp str"), reading("3/picc.2.2.2 4.2.3.1 timp str"))![0], "3/picc.2.2.2 – 4.2.3.1 – timp – str");
  // A requirement we can't read: partial, however many agree
  assert.equal(choose(reading("2.2.2.2 2.2 timp str", "parts", { unresolved: ["Alto Horn"] }), reading("2.2.2.2 2.2 timp str", "text"))![1], "partial");
  // The Thunderer: "Complete Parts" and a timpani sheet isn't a reading of the whole band
  assert.deepEqual(choose(reading("timp perc", "parts", { named: 1 })), ["0.0.0.0 – 0.0.0.0 – timp – perc", "partial", "an edition's parts"]);
  assert.equal(choose(), null);
});
