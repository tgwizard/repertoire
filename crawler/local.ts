// Loads the current dataset (.cache/build/repertoire.sqlite) into the local D1
// database that `npm run dev` uses. Stop the dev server first.
//
// Local D1 is a SQLite file kept by the Cloudflare Vite plugin under
// .cloudflare/state/, named after a hash of the database id; we let `cf` create
// it, then put the dataset in its place.

import { spawnSync } from "node:child_process";
import { copyFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import dataset from "../dataset.json" with { type: "json" };
import { DATASET_PATH } from "./build.ts";

const ROOT = join(import.meta.dirname, "..");
const STATE = join(ROOT, ".cloudflare", "state");
const D1_DIR = join(STATE, "v3", "d1", "miniflare-D1DatabaseObject");
const CF = join(ROOT, "node_modules", ".bin", "cf");
const MARKER = "_seed_marker";

export async function seedLocal(): Promise<void> {
  const res = spawnSync(CF, ["d1", "raw", dataset.d1.id, "--local", "--persist-to", STATE, "--sql", `CREATE TABLE IF NOT EXISTS ${MARKER} (x)`], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`Couldn't create the local D1 database:\n${res.stderr || res.stdout}`);

  let target: string | null = null;
  for (const f of await readdir(D1_DIR)) {
    if (!f.endsWith(".sqlite") || f === "metadata.sqlite") continue;
    const db = new DatabaseSync(join(D1_DIR, f), { readOnly: true });
    const marked = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(MARKER);
    db.close();
    if (marked) target = join(D1_DIR, f);
  }
  if (!target) throw new Error(`Couldn't find the local D1 database file in ${D1_DIR}`);
  for (const suffix of ["", "-wal", "-shm"]) await rm(target + suffix, { force: true });
  await copyFile(DATASET_PATH, target);
  console.log(`Loaded ${DATASET_PATH} into local D1 (${dataset.d1.name})`);
}

if (import.meta.main) await seedLocal();
