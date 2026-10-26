// Publishes the built dataset (.cache/build/repertoire.sqlite):
//
// 1. the downloads (SQLite, CSV) to R2 as a new, immutable version, then points
//    datasets/latest.json at it;
// 2. a new D1 database for the version (repertoire-<version>), loaded and checked;
// 3. dataset.json, which tells the Worker which database to serve. Commit it and
//    deploy (npm run deploy) to switch the site over.
//
// This is what the scheduled GitHub Action runs after crawling; locally it uses
// your `cf auth login` session. Each step skips what's already done.
//
//   node crawler/publish.ts [--dry-run]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { DATASETS_URL, EXPORT_FILES, type LatestFile } from "../src/shared/data.ts";
import { DATASET_PATH } from "./build.ts";
import { DATA_TABLES } from "./db.ts";
import { EXPORT_DIR, writeExports } from "./export.ts";
import { CACHE_DIR, progress } from "./http.ts";
import { sqlDump } from "./sqldump.ts";

const ROOT = join(import.meta.dirname, "..");
const BUCKET = "repertoire-data";
const CF = join(ROOT, "node_modules", ".bin", "cf");
const DATASET_JSON = join(ROOT, "dataset.json");
const BATCH_BYTES = 4_000_000; // SQL per D1 request

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"];

function cf(args: string[], opts: { json?: boolean } = {}): any {
  const res = spawnSync(CF, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`cf ${args.slice(0, 3).join(" ")} failed:\n${res.stderr || res.stdout}`);
  return opts.json ? JSON.parse(res.stdout) : res.stdout;
}

// ---- The built dataset --------------------------------------------------------
const local = new DatabaseSync(DATASET_PATH, { readOnly: true });
const meta = Object.fromEntries((local.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
const counts = Object.fromEntries(DATA_TABLES.map((t) => [t, (local.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
local.close();
const version = meta.version!;
console.log(`Publishing dataset ${version}: ${meta.works} works${dryRun ? " (dry run)" : ""}`);

// ---- 1. Downloads to R2 ---------------------------------------------------------
const published = await fetch(`${DATASETS_URL}/${version}/${EXPORT_FILES.sqlite}`, { method: "HEAD" }).catch(() => null);
if (published?.ok) {
  console.log(`R2: ${version} is already published`);
} else {
  await writeExports(DATASET_PATH, {
    version,
    builtAt: meta.built_at!,
    works: Number(meta.works),
    composers: Number(meta.composers),
    lineups: Number(meta.lineups),
    sources: {} as never,
    stats: null,
  });
  const outDir = join(CACHE_DIR, "publish", version);
  await mkdir(outDir, { recursive: true });
  const metaPath = join(outDir, "meta.json");
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  const put = (key: string, file: string, contentType: string) => {
    const args = ["r2", "objects", "put", key, "--bucket-name", BUCKET, "--file", file, "--content-type", contentType];
    if (dryRun) args.push("--dry-run");
    cf(args);
    console.log(`  ↑ ${key}`);
  };
  const latest: LatestFile = { version, builtAt: meta.built_at!, files: {} };
  for (const [name, path, type] of [
    [EXPORT_FILES.sqlite, join(EXPORT_DIR, EXPORT_FILES.sqlite), "application/gzip"],
    [EXPORT_FILES.csv, join(EXPORT_DIR, EXPORT_FILES.csv), "application/zip"],
    ["meta.json", metaPath, "application/json"],
  ] as const) {
    const data = await readFile(path);
    latest.files[name] = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    put(`datasets/${version}/${name}`, path, type);
  }
  // Last: switching latest.json makes the new version current.
  const latestPath = join(outDir, "latest.json");
  await writeFile(latestPath, JSON.stringify(latest, null, 2));
  put("datasets/latest.json", latestPath, "application/json");
  if (!dryRun) await rm(outDir, { recursive: true, force: true });
}

// ---- 2. D1 ------------------------------------------------------------------------
const name = `repertoire-${version.toLowerCase()}`;
const listed = cf(["d1", "list", "--name", name], { json: true });
let db = (Array.isArray(listed) ? listed : (listed.result ?? [])).find((d: { name: string }) => d.name === name) as { uuid: string } | undefined;
const query = (sql: string) => cf(["d1", "raw", db!.uuid, "--sql", sql], { json: true });
const rows = (r: any): unknown[][] => (Array.isArray(r) ? r : r.result)?.at(-1)?.results?.rows ?? [];

const loaded = () => {
  try {
    return rows(query("SELECT value FROM meta WHERE key = 'version'"))[0]?.[0] === version;
  } catch (e) {
    if (/no such table: meta/.test((e as Error).message)) return false; // meta goes in last
    throw e;
  }
};

if (dryRun) {
  console.log(`D1: would ${db ? "check" : "create and load"} ${name}`);
} else {
  if (db && !loaded()) {
    // An earlier load stopped halfway. Emptying the database means dropping 200 MB of
    // tables, more than D1's CPU limit allows; a new one is quicker. Never the one the
    // site is deployed with.
    const deployed = JSON.parse(await readFile(DATASET_JSON, "utf8").catch(() => "{}")).d1?.id;
    if (db.uuid === deployed) throw new Error(`D1: ${name} is half loaded but dataset.json serves it; not deleting it`);
    cf(["d1", "delete", db.uuid, "--force"]);
    console.log(`D1: deleted ${name}, left half loaded`);
    db = undefined;
  }
  if (!db) {
    db = cf(["d1", "create", "--name", name, "--primary-location-hint", "weur", "--read-replication-mode", "auto"], { json: true });
    db = (db as any).result ?? db;
    console.log(`D1: created ${name} (${db!.uuid})`);
  }
  if (loaded()) {
    console.log(`D1: ${name} is already loaded`);
  } else {
    const tmp = join(CACHE_DIR, "publish", "batch.json");
    await mkdir(join(CACHE_DIR, "publish"), { recursive: true });
    const total = (await readFile(DATASET_PATH)).length;
    // The SQL is roughly the size of the database file: good enough for an ETA.
    const report = progress("D1 load (MB of SQL)", Math.ceil(total / 1e6));
    let sent = 0;
    let batch: { sql: string }[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      await writeFile(tmp, JSON.stringify(batch));
      for (let attempt = 1; ; attempt++) {
        try {
          cf(["d1", "raw", db!.uuid, "--batch", `@${tmp}`]);
          break;
        } catch (e) {
          // A batch is one transaction: retrying a failed one is safe. A request can fail
          // after D1 committed it, though; then the retry trips over its own rows. The
          // row counts below catch anything this lets through.
          if (attempt > 1 && /SQLITE_CONSTRAINT/.test((e as Error).message)) {
            console.log("  a batch reported as failed had been applied");
            break;
          }
          if (attempt >= 4) throw e;
          console.log(`  retrying a batch (${(e as Error).message.split("\n")[1] ?? ""})`);
          await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
      }
      sent += size;
      report(Math.min(Math.ceil(total / 1e6), Math.round(sent / 1e6)));
      batch = [];
      size = 0;
    };
    // meta goes last, so "loaded" means complete.
    let metaInserts: string[] = [];
    for (const sql of sqlDump(DATASET_PATH)) {
      if (sql.startsWith("INSERT INTO meta ")) {
        metaInserts.push(sql);
        continue;
      }
      if (size + sql.length > BATCH_BYTES) await flush();
      batch.push({ sql });
      size += sql.length;
    }
    await flush();
    batch = metaInserts.map((sql) => ({ sql }));
    metaInserts = [];
    await flush();
    await rm(tmp, { force: true });
  }

  // Check every table arrived whole.
  for (const t of DATA_TABLES) {
    const n = Number(rows(query(`SELECT COUNT(*) FROM ${t}`))[0]?.[0]);
    if (n !== counts[t]) throw new Error(`D1 ${name}: ${t} has ${n} rows, expected ${counts[t]}`);
  }
  // The search indexes have a row per work and composer.
  for (const [fts, t] of [["works_fts", "works"], ["composers_fts", "composers"]] as const) {
    const n = Number(rows(query(`SELECT COUNT(*) FROM ${fts}`))[0]?.[0]);
    if (n !== counts[t]) throw new Error(`D1 ${name}: ${fts} has ${n} rows, expected ${counts[t]}`);
  }
  console.log(`D1: ${name} checked (${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", ")})`);

  // ---- 3. dataset.json ------------------------------------------------------------
  await writeFile(DATASET_JSON, JSON.stringify({ version, d1: { name, id: db!.uuid } }, null, 2) + "\n");
  console.log(`dataset.json now serves ${version}. Commit it, then npm run deploy.`);
}
