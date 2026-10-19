import assert from "node:assert/strict";
import { test } from "node:test";
import { unzip, zip } from "./zip.ts";

test("zip round trip", () => {
  const files = [
    { name: "ensembles.json", data: Buffer.from('{"a":1}') },
    { name: "shards/0.json", data: Buffer.from("x".repeat(10_000)) },
    { name: "empty.txt", data: Buffer.alloc(0) },
  ];
  assert.deepEqual(unzip(zip(files)), files);
});
