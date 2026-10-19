// Publishes the built dataset to R2 as a new, immutable version, then points
// datasets/latest.json at it. This is what the scheduled GitHub Action runs after
// crawling; locally it uses your `cf auth login` session.
//
//   node crawler/publish.ts [--dry-run]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { DATASETS_URL, EXPORT_FILES, type LatestFile, type MetaFile } from "../src/shared/data.ts";
import { EXPORT_DIR } from "./build.ts";
import { CACHE_DIR } from "./http.ts";
import { zip } from "./zip.ts";

const ROOT = join(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "public", "data");
const BUCKET = "repertoire-data";
const CF = join(ROOT, "node_modules", ".bin", "cf");

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

function put(key: string, file: string, contentType: string) {
  const args = ["r2", "objects", "put", key, "--bucket-name", BUCKET, "--file", file, "--content-type", contentType];
  if (dryRun) args.push("--dry-run");
  const res = spawnSync(CF, args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`Upload of ${key} failed:\n${res.stderr || res.stdout}`);
  console.log(`  ${dryRun ? "(dry run) " : ""}↑ ${key}`);
}

const meta = JSON.parse(await readFile(join(DATA_DIR, "meta.json"), "utf8").catch(() => "null")) as MetaFile | null;
if (!meta) throw new Error("No dataset in public/data: run `npm run crawl` first");

const existing = await fetch(`${DATASETS_URL}/${meta.version}/index.zip`, { method: "HEAD" }).catch(() => null);
if (existing?.ok) {
  console.log(`Version ${meta.version} is already published; nothing to do.`);
  process.exit(0);
}

console.log(`Publishing dataset ${meta.version} (${meta.works} works) to R2 bucket ${BUCKET}`);
const outDir = join(CACHE_DIR, "publish", meta.version);
await mkdir(outDir, { recursive: true });

// The app's index: everything in public/data, as one archive.
const files = await listFiles(DATA_DIR);
const indexZip = zip(await Promise.all(files.map(async (f) => ({ name: relative(DATA_DIR, f), data: await readFile(f) }))));
await writeFile(join(outDir, "index.zip"), indexZip);

const uploads: [name: string, path: string, type: string][] = [
  ["index.zip", join(outDir, "index.zip"), "application/zip"],
  [EXPORT_FILES.csv, join(EXPORT_DIR, EXPORT_FILES.csv), "application/zip"],
  [EXPORT_FILES.sqlite, join(EXPORT_DIR, EXPORT_FILES.sqlite), "application/gzip"],
  ["meta.json", join(DATA_DIR, "meta.json"), "application/json"],
];
const latest: LatestFile = { version: meta.version, builtAt: meta.builtAt, files: {} };
for (const [name, path, type] of uploads) {
  const data = await readFile(path);
  latest.files[name] = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  put(`datasets/${meta.version}/${name}`, path, type);
}

// Last: switching latest.json makes the new version current.
const latestPath = join(outDir, "latest.json");
await writeFile(latestPath, JSON.stringify(latest, null, 2));
put("datasets/latest.json", latestPath, "application/json");
if (!dryRun) await rm(outDir, { recursive: true, force: true });
console.log(`Published ${meta.version}: ${DATASETS_URL}/${meta.version}/`);
