// A stand-in for a Cloudflare D1 binding over a local SQLite file, so the API's
// queries run in tests exactly as written.

import { DatabaseSync } from "node:sqlite";
import type { Db, Stmt } from "../worker/queries.ts";

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
    return this.db.prepare(this.sql).all(...(this.values as never[])) as T[];
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.run<T>() };
  }
  async first<T>(): Promise<T | null> {
    return this.run<T>()[0] ?? null;
  }
}

export function sqliteDb(path: string): Db & { close(): void } {
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    prepare: (sql) => new SqliteStmt(db, sql),
    batch: async <T>(stmts: Stmt[]) => stmts.map((s) => ({ results: (s as SqliteStmt).run<T>() })),
    close: () => db.close(),
  };
}
