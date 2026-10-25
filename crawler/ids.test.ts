import assert from "node:assert/strict";
import { test } from "node:test";
import { assignIds, hashId, ID_PATTERN, NO_PREVIOUS, type PreviousIds } from "./ids.ts";

const previous = (entities: string[][], ids: string[], redirects: [string, string][] = []): PreviousIds => ({
  anchors: new Map(entities.flatMap((anchors, i) => anchors.map((a) => [a, ids[i]!] as const))),
  redirects: new Map(redirects),
});

test("new entities get a hash of their strongest anchor", () => {
  const { ids, redirects } = assignIds([["imslp:1", "wikidata:Q1"], ["wikidata:Q2"]], NO_PREVIOUS);
  assert.deepEqual(ids, [hashId("imslp:1"), hashId("wikidata:Q2")]);
  assert.ok(ids.every((id) => ID_PATTERN.test(id)));
  assert.equal(redirects.size, 0);
});

test("ids survive a rebuild, even when the strongest anchor changes", () => {
  // A Wikidata-only work that is later matched to an IMSLP page keeps its id.
  const first = assignIds([["wikidata:Q2"]], NO_PREVIOUS);
  const second = assignIds([["imslp:7", "wikidata:Q2"]], previous([["wikidata:Q2"]], first.ids));
  assert.deepEqual(second.ids, first.ids);
});

test("merged entities keep the stronger id and redirect the other", () => {
  const before = [["imslp:1"], ["wikidata:Q9"]];
  const prev = previous(before, ["aaaaaaaa", "bbbbbbbb"]);
  const { ids, redirects } = assignIds([["imslp:1", "wikidata:Q9"]], prev);
  assert.deepEqual(ids, ["aaaaaaaa"]);
  assert.deepEqual([...redirects], [["bbbbbbbb", "aaaaaaaa"]]);
});

test("a split keeps the id with the stronger anchor; the other part gets a new one", () => {
  const prev = previous([["imslp:1", "wikidata:Q9"]], ["aaaaaaaa"]);
  const { ids, redirects } = assignIds([["wikidata:Q9"], ["imslp:1"]], prev, ["imslp", "wikidata"]);
  assert.equal(ids[1], "aaaaaaaa");
  assert.notEqual(ids[0], "aaaaaaaa");
  assert.equal(redirects.size, 0);
});

test("never reuses an old id for something else, and keeps redirect chains short", () => {
  // aaaaaaaa was merged into bbbbbbbb; bbbbbbbb now merges into cccccccc.
  const prev = previous([["imslp:2"], ["imslp:3"]], ["bbbbbbbb", "cccccccc"], [["aaaaaaaa", "bbbbbbbb"]]);
  const { ids, redirects } = assignIds([["imslp:3", "imslp:2"]], prev);
  assert.deepEqual(ids, ["cccccccc"]);
  assert.equal(redirects.get("bbbbbbbb"), "cccccccc");
  assert.equal(redirects.get("aaaaaaaa"), "cccccccc");

  // An entity whose hash collides with a retired id gets a salted one.
  const retired = hashId("imslp:4");
  const again = assignIds([["imslp:4"]], { anchors: new Map(), redirects: new Map([[retired, "cccccccc"]]) });
  assert.notEqual(again.ids[0], retired);
});
