// Full-dataset downloads: a zip of CSVs and a gzipped SQLite database, written to
// .cache/export/ and published next to the index (see publish.ts). Both carry the attribution and license (CC BY-SA 4.0, since
// the data includes IMSLP content).

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { describe, parseEnsembleKey } from "../src/lib/instrumentation.ts";
import { EXPORT_FILES, SOURCES, type Composer, type MetaFile, type SourceId, type Work } from "../src/shared/data.ts";
import { zip } from "./zip.ts";

export interface ExportData {
  meta: MetaFile;
  works: { work: Work; ensembles: { key: string; arr: boolean; via: SourceId[] }[] }[];
  composers: (Composer & { key: string })[];
  ensembles: { key: string; original: number; arrangements: number; sources: Partial<Record<SourceId, string[]>> }[];
}

const wikipediaUrl = (t?: string) => (t ? `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replaceAll(" ", "_"))}` : null);
const imslpUrl = (t?: string) => (t ? `https://imslp.org/wiki/${encodeURIComponent(t.replaceAll(" ", "_"))}` : null);
const wikidataUrl = (q?: string) => (q ? `https://www.wikidata.org/wiki/${q}` : null);
const musicbrainzUrl = (id?: string) => (id ? `https://musicbrainz.org/work/${id}` : null);

type Cell = string | number | null | undefined;
interface Table {
  name: string;
  columns: [string, "TEXT" | "INTEGER" | "REAL"][];
  rows: Cell[][];
}

/** CSVs get full URLs; SQLite stores plain ids (much smaller) and has a works_with_links view. */
function tables(d: ExportData, links: boolean): Table[] {
  const ref = (url: string | null, id: string | undefined) => (links ? url : id);
  return [
    {
      name: "works",
      columns: [
        ["id", "TEXT"], ["title", "TEXT"], ["composer_key", "TEXT"], ["year", "INTEGER"], ["era", "TEXT"],
        ["score", "REAL"], ["signals", "TEXT"],
        ...((links
          ? [["imslp_url", "TEXT"], ["wikidata_url", "TEXT"], ["wikipedia_url", "TEXT"]]
          : [["imslp_page", "TEXT"], ["wikidata_id", "TEXT"], ["wikipedia_title", "TEXT"]]) as Table["columns"]),
        ["openopus_id", "TEXT"],
        links ? ["musicbrainz_url", "TEXT"] : ["musicbrainz_id", "TEXT"],
        ["musicbrainz_recordings", "INTEGER"],
      ],
      rows: d.works.map(({ work: w }) => [
        w.id, w.title, w.composer, w.year, w.era, w.score, w.signals.join(";"),
        ref(imslpUrl(w.imslp), w.imslp), ref(wikidataUrl(w.wikidata), w.wikidata), ref(wikipediaUrl(w.wikipedia), w.wikipedia),
        w.openopus, ref(musicbrainzUrl(w.musicbrainz), w.musicbrainz), w.recordings,
      ]),
    },
    {
      name: "composers",
      columns: [["key", "TEXT"], ["name", "TEXT"], ["born", "INTEGER"], ["died", "INTEGER"], ["era", "TEXT"], ["imslp_url", "TEXT"], ["wikidata_url", "TEXT"], ["wikipedia_url", "TEXT"]],
      rows: d.composers.map((c) => [
        c.key, c.name, c.born, c.died, c.era, c.imslp ? imslpUrl(`Category:${c.imslp}`) : null, wikidataUrl(c.wikidata), wikipediaUrl(c.wikipedia),
      ]),
    },
    {
      name: "ensembles",
      columns: [["key", "TEXT"], ["description", "TEXT"], ["original_works", "INTEGER"], ["arrangement_only_works", "INTEGER"], ["defined_by", "TEXT"]],
      rows: d.ensembles.map((e) => [
        e.key,
        describe(parseEnsembleKey(e.key)),
        e.original,
        e.arrangements,
        Object.entries(e.sources).map(([s, cats]) => `${SOURCES[s as SourceId].name}: ${cats.join(" | ")}`).join("; "),
      ]),
    },
    {
      name: "work_ensembles",
      columns: [["work_id", "TEXT"], ["ensemble_key", "TEXT"], ["arrangement_only", "INTEGER"], ["instrumentation_from", "TEXT"]],
      rows: d.works.flatMap(({ work, ensembles }) => ensembles.map((e) => [work.id, e.key, e.arr ? 1 : 0, e.via.join(";")])),
    },
    {
      name: "sources",
      columns: [["source", "TEXT"], ["url", "TEXT"], ["license", "TEXT"], ["fetched_at", "TEXT"], ["items", "INTEGER"], ["note", "TEXT"]],
      rows: Object.entries(d.meta.sources).map(([id, s]) => {
        const src = SOURCES[id as SourceId];
        return [src.name, src.url, src.license, s.fetchedAt, s.items, s.note];
      }),
    },
  ];
}

function readme(meta: MetaFile): string {
  return `Repertoire Finder dataset
=========================

Built ${meta.builtAt}: ${meta.works} works, ${meta.ensembles} line-ups.
Project: https://repertoire.tgwizard.com · Code: https://github.com/tgwizard/repertoire

License: Creative Commons Attribution-ShareAlike 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
The dataset includes material from IMSLP (CC BY-SA 4.0) and Wikipedia (CC BY-SA 4.0),
combined with CC0 data from Wikidata, Open Opus and MusicBrainz:
${Object.values(SOURCES).map((s) => `  - ${s.name} (${s.url}), ${s.license}`).join("\n")}

Tables
  works            one row per work; id is "imslp:<pageid>", "wd:<QID>" or "oo:<Open Opus id>"
  composers        composer_key in works refers to key here
  ensembles        line-ups; key lists instrument ids, "*N" for several players
  work_ensembles   which works are for which line-ups, and which sources say so
  sources          when each source was fetched, and its license

score ranks how established a work is; signals lists the evidence (see the site for the points per signal).
`;
}

function csv(t: Table): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [t.columns.map(([c]) => c).join(","), ...t.rows.map((r) => r.map(esc).join(","))].join("\r\n") + "\r\n";
}

function sqlite(path: string, ts: Table[], meta: MetaFile): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
  db.exec("CREATE TABLE about (key TEXT PRIMARY KEY, value TEXT)");
  const about = db.prepare("INSERT INTO about VALUES (?, ?)");
  about.run("readme", readme(meta));
  about.run("built_at", meta.builtAt);
  about.run("license", "CC BY-SA 4.0");
  for (const t of ts) {
    db.exec(`CREATE TABLE ${t.name} (${t.columns.map(([c, type]) => `${c} ${type}`).join(", ")})`);
    const insert = db.prepare(`INSERT INTO ${t.name} VALUES (${t.columns.map(() => "?").join(", ")})`);
    db.exec("BEGIN");
    for (const r of t.rows) insert.run(...r.map((v) => (v === undefined ? null : v)));
    db.exec("COMMIT");
  }
  db.exec(`
    CREATE VIEW works_with_links AS SELECT *,
      'https://imslp.org/wiki/' || replace(imslp_page, ' ', '_') AS imslp_url,
      'https://www.wikidata.org/wiki/' || wikidata_id AS wikidata_url,
      'https://en.wikipedia.org/wiki/' || replace(wikipedia_title, ' ', '_') AS wikipedia_url,
      'https://musicbrainz.org/work/' || musicbrainz_id AS musicbrainz_url
    FROM works;
    CREATE INDEX works_composer ON works (composer_key);
    CREATE INDEX work_ensembles_ensemble ON work_ensembles (ensemble_key);
    CREATE INDEX work_ensembles_work ON work_ensembles (work_id);
    VACUUM;`);
  db.close();
}

export async function writeExports(dir: string, d: ExportData): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const zipBuf = zip([
    { name: "README.txt", data: Buffer.from(readme(d.meta)) },
    ...tables(d, true).map((t) => ({ name: `${t.name}.csv`, data: Buffer.from(csv(t)) })),
  ]);
  await writeFile(join(dir, EXPORT_FILES.csv), zipBuf);

  const dbPath = join(dir, EXPORT_FILES.sqlite.replace(/\.gz$/, ""));
  sqlite(dbPath, tables(d, false), d.meta);
  const dbBuf = await readFile(dbPath);
  await rm(dbPath);
  const gz = gzipSync(dbBuf, { level: 9 });
  await writeFile(`${dbPath}.gz`, gz);

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
  console.log(`Export: repertoire-csv.zip ${mb(zipBuf.length)}, repertoire.sqlite.gz ${mb(gz.length)} (${mb(dbBuf.length)} unpacked)`);
}
