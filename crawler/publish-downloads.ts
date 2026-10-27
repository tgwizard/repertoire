// The downloads of a dataset version in R2: datasets/<version>/<file>, then
// datasets/<version>/manifest.json, written last, which says the version is complete,
// then datasets/latest.json. A run that stops anywhere is repaired by running again:
// every file is checked against its checksum (R2's ETag is the MD5 of an object
// uploaded in one piece), missing or wrong ones are uploaded again, and nothing counts
// as published until the manifest is there. latest.json only ever moves forward.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LatestFile } from "../src/shared/data.ts";

export interface Storage {
  /** Size and ETag of an object, or null if there's none */
  head(key: string): Promise<{ bytes: number; etag: string } | null>;
  /** An object's text, or null if there's none */
  get(key: string): Promise<string | null>;
  put(key: string, file: string, contentType: string): Promise<void>;
}

export interface Download {
  name: string;
  file: string;
  contentType: string;
}

/** datasets/<version>/manifest.json: the version's files, by checksum */
export interface Manifest {
  version: string;
  builtAt: string;
  files: Record<string, { bytes: number; sha256: string; md5: string }>;
}

const checksums = async (file: string) => {
  const data = await readFile(file);
  return { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), md5: createHash("md5").update(data).digest("hex") };
};

const matches = (head: { bytes: number; etag: string } | null, f: { bytes: number; md5: string }) =>
  !!head && head.bytes === f.bytes && head.etag.replace(/^W\//, "").replace(/"/g, "") === f.md5;

/**
 * Publishes a version's downloads, or checks and completes an earlier attempt. `prepare`
 * writes the local files, and is only called when something needs uploading. Returns
 * what it did, for the log.
 */
export async function publishDownloads(
  storage: Storage,
  version: string,
  builtAt: string,
  downloads: Download[],
  prepare: () => Promise<void>,
  log: (line: string) => void = console.log,
): Promise<{ uploaded: string[]; latest: "moved" | "kept" | "newer" }> {
  const prefix = `datasets/${version}`;
  const uploaded: string[] = [];
  const existing = await storage.get(`${prefix}/manifest.json`);
  let manifest: Manifest;
  if (existing) {
    // Complete before: its files must still be what the manifest says
    manifest = JSON.parse(existing) as Manifest;
    for (const [name, f] of Object.entries(manifest.files)) {
      if (!matches(await storage.head(`${prefix}/${name}`), f)) throw new Error(`R2: ${prefix}/${name} doesn't match its manifest; a published version must not change`);
    }
    log(`R2: ${version} is published and intact`);
  } else {
    await prepare();
    manifest = { version, builtAt, files: {} };
    for (const d of downloads) {
      const f = await checksums(d.file);
      manifest.files[d.name] = f;
      const key = `${prefix}/${d.name}`;
      if (matches(await storage.head(key), f)) continue; // an earlier attempt got this far
      await storage.put(key, d.file, d.contentType);
      if (!matches(await storage.head(key), f)) throw new Error(`R2: ${key} doesn't match what was uploaded`);
      uploaded.push(d.name);
      log(`  ↑ ${key}`);
    }
    await putJson(storage, `${prefix}/manifest.json`, manifest);
    uploaded.push("manifest.json");
    log(`  ↑ ${prefix}/manifest.json`);
  }

  // latest.json, unless it already points at this version or a newer one (versions are
  // timestamps: "20261027T125035Z" sorts in time order)
  const latest: LatestFile = {
    version,
    builtAt: manifest.builtAt,
    files: Object.fromEntries(Object.entries(manifest.files).map(([name, { bytes, sha256 }]) => [name, { bytes, sha256 }])),
  };
  const current = await storage.get("datasets/latest.json");
  const currentVersion = current ? (JSON.parse(current) as LatestFile).version : "";
  if (currentVersion > version) {
    log(`R2: latest.json points at the newer ${currentVersion}; left as it is`);
    return { uploaded, latest: "newer" };
  }
  if (current && JSON.stringify(JSON.parse(current)) === JSON.stringify(latest)) return { uploaded, latest: "kept" };
  await putJson(storage, "datasets/latest.json", latest);
  log("  ↑ datasets/latest.json");
  return { uploaded, latest: "moved" };
}

/** A JSON object, written through a file (the CLI uploads files) and read back to check */
async function putJson(storage: Storage, key: string, value: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "publish-"));
  try {
    const file = join(dir, "object.json");
    await writeFile(file, JSON.stringify(value, null, 2));
    await storage.put(key, file, "application/json");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const back = await storage.get(key);
  if (!back || JSON.stringify(JSON.parse(back)) !== JSON.stringify(value)) throw new Error(`R2: ${key} doesn't read back as written`);
}
