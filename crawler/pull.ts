// Downloads a published dataset to .cache/build/repertoire.sqlite and loads it into
// local D1, for development and as the previous dataset when building (so ids stay
// the same). No credentials needed: datasets are public.
//
//   node crawler/pull.ts                   latest version
//   node crawler/pull.ts --version <v>     a specific version

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { DATASETS_URL, EXPORT_FILES, type LatestFile } from "../src/shared/data.ts";
import { BUILD_DIR, DATASET_PATH } from "./build.ts";
import { USER_AGENT } from "./http.ts";
import { seedLocal } from "./local.ts";

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

const gz = Buffer.from(await (await get(`${DATASETS_URL}/${version}/${EXPORT_FILES.sqlite}`)).arrayBuffer());
const expected = version === latest.version ? latest.files[EXPORT_FILES.sqlite]?.sha256 : undefined;
if (expected && createHash("sha256").update(gz).digest("hex") !== expected) throw new Error(`Checksum mismatch for ${EXPORT_FILES.sqlite}`);

await mkdir(BUILD_DIR, { recursive: true });
const tmp = `${DATASET_PATH}.download`;
await writeFile(tmp, gunzipSync(gz));
await rename(tmp, DATASET_PATH);
console.log(`  ${(gz.length / 1024 / 1024).toFixed(1)} MiB → ${DATASET_PATH}`);
await seedLocal();
