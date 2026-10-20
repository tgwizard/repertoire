import assert from "node:assert/strict";
import { test } from "node:test";
import { bareTitle, catalogueKeys, ComposerIndex, matchWork, normalize } from "./match.ts";

test("catalogue keys", () => {
  assert.deepEqual([...catalogueKeys("String Quartet No.1, Op.18 No.1")].sort(), ["op:18", "op:18/1"]);
  assert.deepEqual([...catalogueKeys("Piano Concerto No.20 in D minor, K.466")], ["k:466"]);
  assert.deepEqual([...catalogueKeys("String Quartet No.14 in D minor, D.810")], ["d:810"]);
  assert.deepEqual([...catalogueKeys("Symphony in D major")], []);
  assert.deepEqual([...catalogueKeys("String Quartet in C major, Hob.III:65")], ["hob:iii:65"]);
  assert.deepEqual([...catalogueKeys("Cello Suite No.1, BWV 1007")], ["bwv:1007"]);
  assert.deepEqual([...catalogueKeys("String Quartet in F major, M.35")], ["m:35"]);
  assert.deepEqual([...catalogueKeys("Piano Trio in G major, CD 5")], ["cd:5"]);
  assert.deepEqual([...catalogueKeys("Sextet, FP 100")], ["fp:100"]);
  assert.deepEqual([...catalogueKeys("Piano Sonata in B minor")], []);
});

const iq = [
  { title: "String Quartets, Op.18" },
  { title: "String Quartet No.14, Op.131" },
  { title: "String Quartet No.7, Op.59 No.1" },
  { title: "String Quartet No.8, Op.59 No.2" },
  { title: "Grosse Fuge, Op.133" },
];

test("matches exact sub-numbers before parent collections", () => {
  assert.equal(matchWork("String Quartet no. 7 in F major, op. 59 no. 1, 'Razumovsky'", iq)?.title, "String Quartet No.7, Op.59 No.1");
  assert.equal(matchWork("String Quartet no. 3 in D major, op. 18 no. 3", iq)?.title, "String Quartets, Op.18");
  assert.equal(matchWork("String Quartet no. 14 in C sharp minor, op. 131", iq)?.title, "String Quartet No.14, Op.131");
});

test("refuses different sub-numbers and ambiguity", () => {
  assert.equal(matchWork("String Quartet no. 9 in C major, op. 59 no. 3", iq), null);
  assert.equal(matchWork("Three quartets, op. 59", iq), null); // matches both op.59 pages
});

test("bare titles match when only one side has a catalogue number", () => {
  const ravel = [{ title: "String Quartet in F major, M.35" }, { title: "Tzigane, M.76" }];
  assert.equal(matchWork("String Quartet", ravel)?.title, "String Quartet in F major, M.35");
  const prokofiev = [{ title: "String Quartet No.1, Op.50" }, { title: "String Quartet No.2, Op.92" }];
  assert.equal(matchWork("String Quartet No. 2", prokofiev)?.title, "String Quartet No.2, Op.92");
  assert.equal(matchWork("Piano Trio in G Minor", [{ title: "Piano Trio, Op.15" }])?.title, "Piano Trio, Op.15");
  assert.equal(matchWork("Piano Trio", [{ title: "Piano Trio in G major, CD 5" }])?.title, "Piano Trio in G major, CD 5");
  // Different catalogue numbers on both sides: different works.
  assert.equal(matchWork("String Quartet, Op. 3", [{ title: "String Quartet, Op.7" }]), null);
  // Several candidates: don't guess.
  const ruralia = [{ title: "Ruralia hungarica, Op.32a" }, { title: "Ruralia hungarica, Op.32c" }];
  assert.equal(matchWork("Ruralia Hungarica", ruralia), null);
  // Different keys: different works.
  assert.equal(matchWork("Prelude in C-sharp minor", [{ title: "Prelude in F major" }]), null);
  assert.equal(matchWork("Divertimento in G major", [{ title: "Divertimento in C major, Hob.XVI:1" }]), null);
  assert.equal(matchWork("Prelude in C-sharp minor, Op. 3 No. 2", [{ title: "Morceaux de fantaisie, Op.3" }])?.title, "Morceaux de fantaisie, Op.3");
  // ...unless a number identifies one work: the key is just wrong in one source.
  assert.equal(matchWork("String Quartet no. 12 in B major, K.172", [{ title: "String Quartet No.12 in B-flat major, K.172" }])?.title, "String Quartet No.12 in B-flat major, K.172");
  // "Piano Trio" isn't "Piano Trio No.1".
  assert.equal(matchWork("Piano Trio", [{ title: "Piano Trio No.1, Op.8" }]), null);
});

test("equal bare titles break ties between candidates sharing a catalogue number", () => {
  const saintSaens = [{ title: "Piano Concerto No.3, Op.29" }, { title: "Allegro d'après le 3e Concerto, Op.29" }];
  assert.equal(matchWork("Piano Concerto no. 3 in E flat major, op. 29", saintSaens)?.title, "Piano Concerto No.3, Op.29");
  const boccherini = [{ title: "2 String Quartets, G.214-215 (Op.41)" }, { title: "Symphony in C minor, G.519" }];
  assert.equal(matchWork("Symphony in C minor, G.519, op. 41", boccherini)?.title, "Symphony in C minor, G.519");
  const haydn = [{ title: "String Quartets, Op.9" }, { title: "String Quartet in D minor, Hob.III:22" }];
  assert.equal(matchWork("String Quartet in D minor, Hob.III:22, op. 9 no. 4", haydn)?.title, "String Quartet in D minor, Hob.III:22");
});

test("catalogue ranges and unique numbers beat shared opus numbers", () => {
  assert.deepEqual([...catalogueKeys("2 String Quartets, G.214-215 (Op.41)")].sort(), ["g:214", "g:215", "op:41"]);
  assert.ok(catalogueKeys("6 String Quartets, Op.9 (Hob.III:19-24)").has("hob:iii:22"));
  const boccherini = [{ title: "2 String Quartets, G.214-215 (Op.41)" }, { title: "2 String Quintets, G.346-347 (Op.41)" }];
  assert.equal(matchWork("String Quartet in C major, G.215, op. 41, no. 2", boccherini)?.title, "2 String Quartets, G.214-215 (Op.41)");
});

test("different catalogue systems match on a numbered bare title only", () => {
  assert.equal(matchWork("String Quartet no. 4 in C major, BB95", [{ title: "String Quartet No.4, Sz.91" }])?.title, "String Quartet No.4, Sz.91");
  // Without a number in the title it's too risky: Schumann's early C minor quartet
  // (WoO 32) is not Op.47, and titles alone can't tell that apart from Debussy L.3 = CD 5.
  assert.equal(matchWork("Piano quartet in C minor, WoO 32", [{ title: "Piano Quartet, Op.47" }]), null);
  assert.equal(matchWork("Piano Trio, L.3", [{ title: "Piano Trio in G major, CD 5" }]), null);
});

test("bare title fallback", () => {
  assert.equal(bareTitle("Kleine Kammermusik"), "kleine kammermusik");
  assert.equal(matchWork("Summer Music", [{ title: "Summer Music" }, { title: "Winter Music" }])?.title, "Summer Music");
});

test("normalize folds letters that NFD keeps", () => {
  assert.equal(normalize("Witold Lutosławski"), normalize("Witold Lutoslawski"));
  assert.equal(normalize("Dvořák, Antonín"), "dvorak antonin");
});

test("composer index", () => {
  const idx = new ComposerIndex(["Beethoven, Ludwig van", "Bach, Johann Sebastian", "Bach, Carl Philipp Emanuel", "Strauss Jr., Johann", "Strauss, Richard"]);
  assert.equal(idx.find("Beethoven", "Ludwig van Beethoven"), "Beethoven, Ludwig van");
  assert.equal(idx.find("Bach", "Johann Sebastian Bach"), "Bach, Johann Sebastian");
  assert.equal(idx.find("Strauss", "Richard Strauss"), "Strauss, Richard");
  assert.equal(idx.find("Nobody", "Some Nobody"), null);
  const schuberts = new ComposerIndex(["Schubert, Franz", "Schubert, Franz Anton", "Bach, Johann Christian", "Bach, Johann Sebastian"]);
  assert.equal(schuberts.find("Schubert", "Franz Schubert"), "Schubert, Franz");
  assert.equal(schuberts.find("Bach", "Johann Sebastian Bach"), "Bach, Johann Sebastian");
});
