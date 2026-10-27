import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { DAY, gzipText, jitteredMaxAge } from "./http.ts";

test("jittered cache lifetimes are stable per key, in range, and spread out", () => {
  assert.equal(jitteredMaxAge("For 2 violins, viola, cello", 30, 90), jitteredMaxAge("For 2 violins, viola, cello", 30, 90));
  const days = Array.from({ length: 1000 }, (_, i) => jitteredMaxAge(`category ${i}`, 30, 90) / DAY);
  assert.ok(days.every((d) => Number.isInteger(d) && d >= 30 && d <= 90));
  assert.ok(new Set(days).size > 50); // not all expiring on the same day
});

test("gzipped text decodes characters split across chunks", async () => {
  // Decomposed "è" (e + U+0300, two bytes) and other multibyte letters, at every offset of 64-byte chunks (the smallest zlib allows)
  const text = Array.from({ length: 200 }, (_, i) => `À la lumie\u0300re ${i} Скажи Ολόγραμμα 🎻`).join("\n");
  const dir = await mkdtemp(join(tmpdir(), "gzip-text-"));
  try {
    const path = join(dir, "t.gz");
    await writeFile(path, gzipSync(text));
    let out = "";
    for await (const chunk of gzipText(path, 64)) out += chunk;
    assert.equal(out, text);
    assert.ok(!out.includes("\uFFFD"));
  } finally {
    await rm(dir, { recursive: true });
  }
});
