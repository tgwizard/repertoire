import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { publishDownloads, type Download, type Storage } from "./publish-downloads.ts";

const dir = await mkdtemp(join(tmpdir(), "publish-test-"));
after(() => rm(dir, { recursive: true, force: true }));

/** R2 in memory; `failAt` makes the nth put (1-based) fail, as an interrupted run would */
function fakeR2() {
  const objects = new Map<string, Buffer>();
  let puts = 0;
  const r2 = {
    objects,
    failAt: 0,
    async head(key: string) {
      const o = objects.get(key);
      return o ? { bytes: o.length, etag: `"${createHash("md5").update(o).digest("hex")}"` } : null;
    },
    async get(key: string) {
      return objects.get(key)?.toString("utf8") ?? null;
    },
    async put(key: string, file: string) {
      if (++puts === r2.failAt) throw new Error("connection reset");
      objects.set(key, await readFile(file));
    },
  } satisfies Storage & Record<string, unknown>;
  return r2;
}

async function downloads(version: string): Promise<Download[]> {
  const out: Download[] = [];
  for (const name of ["repertoire.sqlite.gz", "repertoire-csv.zip", "meta.json"]) {
    const file = join(dir, `${version}-${name}`);
    await writeFile(file, `${name} of ${version}`);
    out.push({ name, file, contentType: "application/octet-stream" });
  }
  return out;
}

const quiet = () => {};
const publish = async (r2: Storage, version: string) => publishDownloads(r2, version, `${version} built`, await downloads(version), async () => {}, quiet);
const complete = (r2: ReturnType<typeof fakeR2>, version: string) =>
  ["repertoire.sqlite.gz", "repertoire-csv.zip", "meta.json", "manifest.json"].every((f) => r2.objects.has(`datasets/${version}/${f}`));
const latestVersion = (r2: ReturnType<typeof fakeR2>) => JSON.parse(r2.objects.get("datasets/latest.json")!.toString()).version;

test("a run interrupted after any upload is completed by the next, and latest.json moves only when complete", async () => {
  // Uploads: three files, the manifest, latest.json
  for (let failAt = 1; failAt <= 5; failAt++) {
    const r2 = fakeR2();
    r2.failAt = failAt;
    await assert.rejects(publish(r2, "20261101T000000Z"), /connection reset/);
    // Nothing points at an incomplete version
    if (!complete(r2, "20261101T000000Z")) assert.equal(r2.objects.has("datasets/latest.json"), false, `failAt ${failAt}`);
    r2.failAt = 0;
    await publish(r2, "20261101T000000Z");
    assert.ok(complete(r2, "20261101T000000Z"), `failAt ${failAt}`);
    assert.equal(latestVersion(r2), "20261101T000000Z");
    // Files that made it the first time aren't uploaded again
    const again = await publish(r2, "20261101T000000Z");
    assert.deepEqual(again, { uploaded: [], latest: "kept" });
  }
});

test("a damaged upload is replaced; a complete version that changed is an error", async () => {
  const r2 = fakeR2();
  const files = await downloads("20261101T000000Z");
  // A truncated earlier upload, without a manifest: uploaded again
  r2.objects.set("datasets/20261101T000000Z/repertoire-csv.zip", Buffer.from("trunc"));
  const first = await publishDownloads(r2, "20261101T000000Z", "built", files, async () => {}, quiet);
  assert.deepEqual(first.uploaded, ["repertoire.sqlite.gz", "repertoire-csv.zip", "meta.json", "manifest.json"]);
  // Once complete, it must stay as it is
  r2.objects.set("datasets/20261101T000000Z/meta.json", Buffer.from("changed"));
  await assert.rejects(publish(r2, "20261101T000000Z"), /doesn't match its manifest/);
});

test("publishing an older version never moves latest.json back", async () => {
  const r2 = fakeR2();
  await publish(r2, "20261102T000000Z");
  const older = await publish(r2, "20261101T000000Z");
  assert.equal(older.latest, "newer");
  assert.ok(complete(r2, "20261101T000000Z")); // its downloads are still published
  assert.equal(latestVersion(r2), "20261102T000000Z");
  // latest.json lists the files with their checksums
  const latest = JSON.parse(r2.objects.get("datasets/latest.json")!.toString());
  assert.equal(latest.files["meta.json"].bytes, "meta.json of 20261102T000000Z".length);
  assert.match(latest.files["meta.json"].sha256, /^[0-9a-f]{64}$/);
});
