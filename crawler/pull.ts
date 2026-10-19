// Downloads a published dataset into public/data/, for local development and
// before deploying. No credentials needed: datasets are public.
//
//   node crawler/pull.ts                   latest version
//   node crawler/pull.ts --version <v>     a specific version

import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { parseArgs } from "node:util";
import { DATASETS_URL, type LatestFile } from "../src/shared/data.ts";
import { USER_AGENT } from "./http.ts";
import { unzip } from "./zip.ts";

const DATA_DIR = join(import.meta.dirname, "..", "public", "data");

const { values } = parseArgs({ options: { version: { type: "string" } } });

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

// Cache-bust latest.json, which changes in place; versioned files never do.
const latest = (await (await get(`${DATASETS_URL}/latest.json?t=${Date.now()}`)).json()) as LatestFile;
const version = values.version ?? latest.version;
console.log(`Pulling dataset ${version}${version === latest.version ? " (latest)" : ""}`);

const buf = Buffer.from(await (await get(`${DATASETS_URL}/${version}/index.zip`)).arrayBuffer());
const expected = version === latest.version ? latest.files["index.zip"]?.sha256 : undefined;
if (expected && createHash("sha256").update(buf).digest("hex") !== expected) throw new Error("Checksum mismatch for index.zip");

const entries = unzip(buf);
await rm(DATA_DIR, { recursive: true, force: true });
for (const e of entries) {
  const path = normalize(join(DATA_DIR, e.name));
  if (!path.startsWith(DATA_DIR + sep)) throw new Error(`Refusing to write outside public/data: ${e.name}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, e.data);
}
console.log(`  ${entries.length} files, ${(buf.length / 1024 / 1024).toFixed(1)} MiB → public/data`);
