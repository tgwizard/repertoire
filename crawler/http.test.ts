import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY, jitteredMaxAge } from "./http.ts";

test("jittered cache lifetimes are stable per key, in range, and spread out", () => {
  assert.equal(jitteredMaxAge("For 2 violins, viola, cello", 30, 90), jitteredMaxAge("For 2 violins, viola, cello", 30, 90));
  const days = Array.from({ length: 1000 }, (_, i) => jitteredMaxAge(`category ${i}`, 30, 90) / DAY);
  assert.ok(days.every((d) => Number.isInteger(d) && d >= 30 && d <= 90));
  assert.ok(new Set(days).size > 50); // not all expiring on the same day
});
