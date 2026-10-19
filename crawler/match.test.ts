import assert from "node:assert/strict";
import { test } from "node:test";
import { bareTitle, catalogueKeys, ComposerIndex, matchWork } from "./match.ts";

test("catalogue keys", () => {
  assert.deepEqual([...catalogueKeys("String Quartet No.1, Op.18 No.1")].sort(), ["op:18", "op:18/1"]);
  assert.deepEqual([...catalogueKeys("Piano Concerto No.20 in D minor, K.466")], ["k:466"]);
  assert.deepEqual([...catalogueKeys("String Quartet No.14 in D minor, D.810")], ["d:810"]);
  assert.deepEqual([...catalogueKeys("Symphony in D major")], []);
  assert.deepEqual([...catalogueKeys("String Quartet in C major, Hob.III:65")], ["hob:iii:65"]);
  assert.deepEqual([...catalogueKeys("Cello Suite No.1, BWV 1007")], ["bwv:1007"]);
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

test("bare title fallback", () => {
  assert.equal(bareTitle("Kleine Kammermusik"), "kleine kammermusik");
  assert.equal(matchWork("Summer Music", [{ title: "Summer Music" }, { title: "Winter Music" }])?.title, "Summer Music");
});

test("composer index", () => {
  const idx = new ComposerIndex(["Beethoven, Ludwig van", "Bach, Johann Sebastian", "Bach, Carl Philipp Emanuel", "Strauss Jr., Johann", "Strauss, Richard"]);
  assert.equal(idx.find("Beethoven", "Ludwig van Beethoven"), "Beethoven, Ludwig van");
  assert.equal(idx.find("Bach", "Johann Sebastian Bach"), "Bach, Johann Sebastian");
  assert.equal(idx.find("Strauss", "Richard Strauss"), "Strauss, Richard");
  assert.equal(idx.find("Nobody", "Some Nobody"), null);
});
