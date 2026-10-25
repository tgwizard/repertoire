// The dataset as SQL statements for loading into D1, which takes SQL rather than a
// database file: schema, rows as multi-row INSERTs under D1's statement size limit,
// then indexes and planner statistics.

import { DatabaseSync } from "node:sqlite";
import { DATA_TABLES, INDEXES, TABLES } from "./db.ts";

const MAX_STATEMENT = 90_000; // bytes; D1 allows 100 KB
const FTS_TABLES = { works_fts: ["title", "composer", "aliases", "keys"], composers_fts: ["name"] } as const;

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  throw new Error(`Can't write ${typeof v} as SQL`);
}

const split = (sql: string) =>
  sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

/** Statements that recreate the dataset at `path` in an empty database. */
export function* sqlDump(path: string): Generator<string> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    yield* split(TABLES);
    const tables: [string, string[]][] = [
      ...DATA_TABLES.map((t): [string, string[]] => [t, []]),
      ...Object.entries(FTS_TABLES).map(([t, cols]): [string, string[]] => [t, ["rowid", ...cols]]),
    ];
    for (const [table, columns] of tables) {
      const select = columns.length ? `SELECT ${columns.join(", ")} FROM ${table}` : `SELECT * FROM ${table}`;
      const stmt = db.prepare(select);
      const cols = columns.length ? columns : stmt.columns().map((c) => c.name);
      const head = `INSERT INTO ${table} (${cols.join(", ")}) VALUES `;
      let rows: string[] = [];
      let size = head.length;
      for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
        const values = `(${cols.map((c) => literal(row[c])).join(", ")})`;
        if (rows.length && size + values.length + 1 > MAX_STATEMENT) {
          yield head + rows.join(",");
          rows = [];
          size = head.length;
        }
        rows.push(values);
        size += values.length + 1;
      }
      if (rows.length) yield head + rows.join(",");
    }
    yield* split(INDEXES);
    // Planner statistics: without them D1 can pick a full scan over an index.
    yield "ANALYZE";
  } finally {
    db.close();
  }
}
