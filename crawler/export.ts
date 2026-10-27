// Full-dataset downloads: the database itself (gzipped SQLite) and a zip of one CSV
// per table, written to .cache/export/ and published next to each version (see
// publish.ts). Both carry the attribution and license (CC BY-SA 4.0, since the data
// includes IMSLP and Wikipedia content).

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { DATA_LICENSE, EXPORT_FILES, SOURCES, type Meta } from "../src/shared/data.ts";
import { BUILD_TABLES, DATA_TABLES, TABLES } from "./db.ts";
import { CACHE_DIR } from "./http.ts";
import { zip } from "./zip.ts";

export const EXPORT_DIR = join(CACHE_DIR, "export");

function readme(meta: Meta): string {
  return `Repertoire Finder dataset ${meta.version}
==========================================

Built ${meta.builtAt}: ${meta.works} works by ${meta.composers} composers, for ${meta.lineups} line-ups.
Site: https://repertoire.tgwizard.com · API: https://repertoire.tgwizard.com/api · Code: https://github.com/tgwizard/repertoire

License: ${DATA_LICENSE.name} (${DATA_LICENSE.url}).
The dataset includes material from IMSLP and Wikipedia (CC BY-SA 4.0), combined
with CC0 data from Wikidata, Open Opus and MusicBrainz:
${Object.values(SOURCES).map((s) => `  - ${s.name} (${s.url}), ${s.license}: ${s.role}`).join("\n")}

Work and composer ids are persistent: https://repertoire.tgwizard.com/work/<id>.
Ids merged into another are listed in redirects; ids no longer listed in retired.

Schema (the CSVs have the same columns; JSON columns are JSON text):
${TABLES.trim()}

In the SQLite file only, for building the next version:
${BUILD_TABLES.trim()}
`;
}

function csv(db: DatabaseSync, table: string): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const stmt = db.prepare(`SELECT * FROM ${table}`);
  const columns = stmt.columns().map((c) => c.name);
  const lines = [columns.join(",")];
  for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) lines.push(columns.map((c) => esc(row[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export async function writeExports(dbPath: string, meta: Meta, dir = EXPORT_DIR): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const zipBuf = zip([
    { name: "README.txt", data: Buffer.from(readme(meta)) },
    ...DATA_TABLES.map((t) => ({ name: `${t}.csv`, data: Buffer.from(csv(db, t)) })),
  ]);
  db.close();
  await writeFile(join(dir, EXPORT_FILES.csv), zipBuf);

  const dbBuf = await readFile(dbPath);
  const gz = gzipSync(dbBuf, { level: 9 });
  await writeFile(join(dir, EXPORT_FILES.sqlite), gz);

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
  console.log(`Export: ${EXPORT_FILES.csv} ${mb(zipBuf.length)}, ${EXPORT_FILES.sqlite} ${mb(gz.length)} (${mb(dbBuf.length)} unpacked)`);
}
