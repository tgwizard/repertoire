// The dataset as SQL statements for loading into D1, which takes SQL rather than a
// database file: schema, rows as multi-row INSERTs under D1's statement size limit,
// then indexes and planner statistics.

import { DatabaseSync } from "node:sqlite";
import { DATA_TABLES, INDEXES, TABLES } from "./db.ts";

const MAX_STATEMENT = 90_000; // bytes; D1 allows 100 KB
// A text longer than this goes in pieces (characters; at most 4 bytes each)
const PIECE = 15_000;
const FTS_TABLES = { works_fts: ["title", "composer", "aliases", "keys", "arrangers"], composers_fts: ["name"] } as const;

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
      // The row's key, to append to a long text after inserting the rest
      const keys = columns.length ? ["rowid"] : (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[]).filter((c) => c.pk > 0).map((c) => c.name);
      let rows: string[] = [];
      let size = head.length;
      for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
        const long = cols.filter((c) => typeof row[c] === "string" && (row[c] as string).length > PIECE);
        if (long.length) {
          // Too long for one statement: the row with those texts empty, then the texts a
          // piece at a time (the "mixed chorus" line-up's sources run past 100 KB)
          if (!keys.length) throw new Error(`A ${table} row is too long to load, and the table has no key to load it in pieces`);
          if (rows.length) yield head + rows.join(",");
          rows = [];
          size = head.length;
          yield head + `(${cols.map((c) => (long.includes(c) ? "''" : literal(row[c]))).join(", ")})`;
          const where = keys.map((k) => `${k} = ${literal(row[k])}`).join(" AND ");
          for (const c of long) {
            const text = row[c] as string;
            // Each piece replaces whatever follows the ones before it, so a batch applied
            // twice (publish retries one that may have gone through) changes nothing
            let chars = 0; // SQLite counts characters, not UTF-16 code units
            for (let i = 0; i < text.length; ) {
              // (not between the two halves of a character outside the BMP)
              let end = Math.min(i + PIECE, text.length);
              if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
              const piece = text.slice(i, end);
              yield `UPDATE ${table} SET ${c} = substr(${c}, 1, ${chars}) || ${literal(piece)} WHERE ${where}`;
              chars += [...piece].length;
              i = end;
            }
          }
          continue;
        }
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
