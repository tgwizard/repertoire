// A stand-in for a Cloudflare D1 binding over a local SQLite file, so the API's
// queries run in tests, and in the build (precomputed facets), exactly as written.

import { DatabaseSync } from "node:sqlite";
import type { Db, Stmt } from "../worker/queries.ts";

/** Bound parameters D1 allows in one query */
export const D1_MAX_PARAMETERS = 100;

class SqliteStmt implements Stmt {
  db: DatabaseSync;
  sql: string;
  values: unknown[];
  constructor(db: DatabaseSync, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]): Stmt {
    return new SqliteStmt(this.db, this.sql, values);
  }
  run<T>(): T[] {
    // D1's limit, which SQLite's own (32766) would let through unnoticed
    if (this.values.length > D1_MAX_PARAMETERS) throw new Error(`D1_ERROR: too many SQL variables (${this.values.length}; D1 allows ${D1_MAX_PARAMETERS})`);
    return this.db.prepare(this.sql).all(...(this.values as never[])) as T[];
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.run<T>() };
  }
  async first<T>(): Promise<T | null> {
    return this.run<T>()[0] ?? null;
  }
}

export function sqliteDb(path: string | DatabaseSync): Db & { close(): void } {
  const db = typeof path === "string" ? new DatabaseSync(path, { readOnly: true }) : path;
  return {
    prepare: (sql) => new SqliteStmt(db, sql),
    batch: async <T>(stmts: Stmt[]) => stmts.map((s) => ({ results: (s as SqliteStmt).run<T>() })),
    close: () => db.close(),
  };
}
