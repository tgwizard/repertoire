import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, searchText, slug } from "./text.ts";

test("normalize folds Latin letters to ASCII, for matching across sources", () => {
  assert.equal(normalize("Dvořák"), "dvorak");
  assert.equal(normalize("Lutosławski, Witold"), "lutoslawski witold");
  assert.equal(normalize("Søren Ægidius Strauß"), "soren aegidius strauss");
  assert.equal(normalize("Œuvres complètes"), "oeuvres completes");
  assert.equal(normalize("Скажи, зачем?"), ""); // matching stays ASCII
});

test("searchText keeps every script, and folds Latin as normalize does", () => {
  // Latin text: the same words as before, so the index and queries agree
  for (const s of ["Dvořák", "Lutosławski", "Søren Strauß", "Œuvres complètes", "Clarinet Quintet, Op.115", "Đurić Kırşehir"]) assert.equal(searchText(s), normalize(s), s);
  assert.equal(searchText("Скажи, зачем?"), "скажи зачем");
  assert.equal(searchText("Стояла я і слухала весну"), "стояла я і слухала весну");
  assert.equal(searchText("Ολόγραμμα"), "ολογραμμα"); // Greek accents fold, as they're often left out
  assert.equal(searchText("Чайковский"), "чайковский"); // "й" isn't "и" with an accent
  assert.equal(searchText("春の海"), "春の海");
  assert.equal(searchText(" — ! "), "");
});

test("slugs stay ASCII, empty when a title has no Latin letters", () => {
  assert.equal(slug("Clarinet Quintet, Op.115"), "clarinet-quintet-op-115");
  assert.equal(slug("Скажи, зачем?"), "");
});
