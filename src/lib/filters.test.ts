import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFilters, readFilters, writeFilters, type Filters } from "./filters.ts";

const write = (f: Filters, smaller = false) => {
  const p = new URLSearchParams();
  writeFilters(p, f, smaller);
  return p.toString();
};

test("filters go to the URL and back; defaults stay out", () => {
  assert.equal(write(defaultFilters(false)), "");
  assert.equal(write(defaultFilters(true), true), "");
  const f: Filters = { eras: ["Classical", "Romantic"], composer: "w3bx8c2c", show: "core", sort: "chronological", order: "desc", length: "10-20", minPlayers: 3, within: "cello,violin" };
  const url = write(f, true);
  assert.equal(url, "era=Classical&era=Romantic&composer=w3bx8c2c&show=core&sort=chronological&order=desc&len=10-20&min=3&group=cello%2Cviolin");
  assert.deepEqual(readFilters(new URLSearchParams(url), true), f);
  // Smaller groups' own filters mean nothing without them
  assert.equal(write({ ...f, eras: [], composer: "", show: "all", sort: "rank", order: undefined, length: "" }, false), "");
});

test("odd URLs read as the defaults", () => {
  assert.deepEqual(readFilters(new URLSearchParams("era=Jazz&show=everything&sort=random&order=up&len=5-7&min=-1"), false), defaultFilters(false));
  assert.equal(readFilters(new URLSearchParams(""), true).sort, "players");
  assert.equal(readFilters(new URLSearchParams("len=unknown&len=40-"), false).length, "unknown");
});
