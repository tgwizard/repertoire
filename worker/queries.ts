// Queries behind the API. Written against Db, the subset of Cloudflare D1's binding
// we use, so the tests can run them on the built SQLite file with node:sqlite.

import { describe, fitsIn, parseEnsembleKey, playerCount } from "../src/lib/instrumentation.ts";
import {
  CORE_SCORE,
  ERAS,
  scoreParts,
  type ComposerDetail,
  type Era,
  type Facets,
  type Link,
  type LineupsIndex,
  type Meta,
  type Scoring,
  type SearchResults,
  type Signal,
  type SourceId,
  type WorkDetail,
  type WorkSort,
  type WorkSummary,
  type WorksPage,
} from "../src/shared/data.ts";
import { normalize } from "../src/shared/text.ts";

export interface Stmt {
  bind(...values: unknown[]): Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface Db {
  prepare(sql: string): Stmt;
  batch<T = Record<string, unknown>>(stmts: Stmt[]): Promise<{ results: T[] }[]>;
}

type Row = Record<string, any>;

// ---- Dataset-wide ----------------------------------------------------------

export async function getMeta(db: Db): Promise<Meta> {
  const [meta, sources] = await db.batch<Row>([db.prepare("SELECT key, value FROM meta"), db.prepare("SELECT * FROM sources")]);
  const m = Object.fromEntries(meta!.results.map((r) => [r.key, r.value]));
  return {
    version: m.version,
    builtAt: m.built_at,
    works: Number(m.works),
    composers: Number(m.composers),
    lineups: Number(m.lineups),
    sources: Object.fromEntries(
      sources!.results.map((s) => [s.id, { fetchedAt: s.fetched_at, items: s.items, matched: s.matched, added: s.added, note: s.note }]),
    ) as Meta["sources"],
    stats: m.stats ? JSON.parse(m.stats) : null,
  };
}

export async function getLineups(db: Db, version: string): Promise<LineupsIndex> {
  const { results } = await db.prepare("SELECT key, original, arrangements FROM lineups").all<Row>();
  return { version, lineups: Object.fromEntries(results.map((r) => [r.key, [r.original, r.arrangements]])) };
}

export async function getLineup(db: Db, key: string) {
  const r = await db.prepare("SELECT * FROM lineups WHERE key = ?").bind(key).first<Row>();
  if (!r) return null;
  return { key: r.key as string, description: r.description as string, players: r.players as number, original: r.original as number, arrangements: r.arrangements as number, sources: JSON.parse(r.sources) as Partial<Record<SourceId, string[]>> };
}

/** Line-ups that a group can play: its own and every smaller group drawn from it. */
export function subLineups(index: LineupsIndex, key: string, minPlayers: number): string[] {
  const group = parseEnsembleKey(key);
  return Object.keys(index.lineups).filter((k) => {
    const e = parseEnsembleKey(k);
    return playerCount(e) >= minPlayers && fitsIn(e, group);
  });
}

// ---- Work lists ------------------------------------------------------------

export interface WorkQuery {
  lineup?: string;
  /** Also works for smaller groups drawn from the line-up */
  subsets?: boolean;
  minPlayers?: number;
  arrangements?: boolean;
  composer?: string;
  eras?: (Era | "Unknown")[];
  show?: "all" | "core" | "free";
  q?: string;
  sort?: WorkSort;
  offset?: number;
  limit?: number;
  facets?: boolean;
}

/** An FTS5 query from what someone typed: every word must match, words as prefixes. */
export function ftsQuery(input: string): string | null {
  const words = normalize(input).split(" ").filter(Boolean).slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => (/^\d+$/.test(w) || w.length < 2 ? `"${w}"` : `"${w}"*`)).join(" ");
}

const SUMMARY = `w.id, w.title, w.year, w.era, w.score, s.lineup, s.players, s.arrangement,
  c.id AS cid, c.name AS cname, c.born AS cborn, c.died AS cdied,
  (SELECT url FROM links WHERE entity = 'work' AND entity_id = w.id AND kind = 'score' LIMIT 1) AS score_url`;
const FROM = "FROM scorings s JOIN works w ON w.id = s.work_id LEFT JOIN composers c ON c.id = w.composer_id";

function toSummary(r: Row): WorkSummary {
  return {
    id: r.id,
    title: r.title,
    composer: r.cid ? { id: r.cid, name: r.cname, born: r.cborn, died: r.cdied } : null,
    year: r.year,
    era: r.era,
    score: r.score,
    scoreUrl: r.score_url,
    lineup: r.lineup,
    players: r.players,
    arrangement: !!r.arrangement,
  };
}

const ORDER: Record<WorkSort, string> = {
  rank: "s.arrangement, w.score DESC, w.n",
  players: "players DESC, s.arrangement, w.score DESC, w.n",
  chronological: "COALESCE(w.year, c.born + 35) IS NULL, COALESCE(w.year, c.born + 35), w.score DESC, w.n",
  composer: "c.sort_name IS NULL, c.sort_name COLLATE NOCASE, w.title COLLATE NOCASE, w.n",
  title: "w.title COLLATE NOCASE, w.n",
};

export async function listWorks(db: Db, index: LineupsIndex | null, q: WorkQuery): Promise<WorksPage> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = Math.min(Math.max(q.offset ?? 0, 0), 100_000);
  const sort = q.sort && q.sort in ORDER ? q.sort : "rank";

  // Base: which works are in the list at all (facets count over this).
  const base: string[] = [];
  const baseArgs: unknown[] = [];
  const multi = !!(q.lineup && q.subsets);
  if (q.lineup && q.subsets) {
    base.push("s.lineup IN (SELECT value FROM json_each(?))");
    baseArgs.push(JSON.stringify(index ? subLineups(index, q.lineup, q.minPlayers ?? 1) : [q.lineup]));
  } else if (q.lineup) {
    base.push("s.lineup = ?");
    baseArgs.push(q.lineup);
  } else {
    base.push("s.lineup = w.lineup"); // one row per work: its main line-up
  }
  if (!q.arrangements) base.push("s.arrangement = 0");
  if (q.composer) {
    base.push("w.composer_id = ?");
    baseArgs.push(q.composer);
  }

  // Filters on top.
  const where = [...base];
  const args = [...baseArgs];
  if (q.eras?.length) {
    const known = q.eras.filter((e) => (ERAS as readonly string[]).includes(e));
    const parts = [];
    if (known.length) {
      parts.push("w.era IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(known));
    }
    if (q.eras.includes("Unknown")) parts.push("w.era IS NULL");
    if (parts.length) where.push(`(${parts.join(" OR ")})`);
  }
  if (q.show === "core") where.push(`w.score >= ${CORE_SCORE}`);
  if (q.show === "free") where.push("w.free = 1");
  const fts = q.q ? ftsQuery(q.q) : null;
  if (q.q && !fts) return { total: 0, offset, works: [], facets: null };
  if (fts) {
    where.push("w.n IN (SELECT rowid FROM works_fts WHERE works_fts MATCH ?)");
    args.push(fts);
  }

  const cond = (c: string[]) => `WHERE ${c.join(" AND ")}`;
  // With smaller groups a work can be listed for several of them: keep the largest.
  const select = multi
    ? `SELECT ${SUMMARY.replace("s.players", "MAX(s.players) AS players")} ${FROM} ${cond(where)} GROUP BY s.work_id`
    : `SELECT ${SUMMARY} ${FROM} ${cond(where)}`;
  const stmts = [
    db.prepare(`${select} ORDER BY ${ORDER[sort]} LIMIT ? OFFSET ?`).bind(...args, limit, offset),
    db.prepare(`SELECT COUNT(DISTINCT s.work_id) AS n ${FROM} ${cond(where)}`).bind(...args),
  ];
  if (q.facets) {
    stmts.push(
      db.prepare(`SELECT w.era AS era, COUNT(DISTINCT w.id) AS n ${FROM} ${cond(base)} GROUP BY w.era`).bind(...baseArgs),
      db
        .prepare(`SELECT c.id AS id, c.name AS name, COUNT(DISTINCT w.id) AS n ${FROM} ${cond([...base, "c.id IS NOT NULL"])} GROUP BY c.id ORDER BY n DESC, c.sort_name LIMIT 300`)
        .bind(...baseArgs),
      db
        .prepare(`SELECT SUM(score >= ${CORE_SCORE}) AS core, SUM(free) AS free FROM (SELECT DISTINCT w.id, w.score, w.free ${FROM} ${cond(base)})`)
        .bind(...baseArgs),
    );
    if (multi) {
      stmts.push(
        db
          .prepare(`SELECT s.lineup AS key, l.description AS description, l.players AS players, COUNT(*) AS n FROM scorings s JOIN lineups l ON l.key = s.lineup JOIN works w ON w.id = s.work_id ${cond(base)} GROUP BY s.lineup ORDER BY l.players DESC, n DESC LIMIT 200`)
          .bind(...baseArgs),
      );
    }
  }
  const [rows, count, eras, composers, totals, lineups] = await db.batch<Row>(stmts);
  let facets: Facets | null = null;
  if (q.facets) {
    facets = {
      eras: Object.fromEntries(eras!.results.map((r) => [r.era ?? "Unknown", r.n])),
      composers: composers!.results.map((r) => ({ id: r.id, name: r.name, count: r.n })),
      lineups: (lineups?.results ?? []).map((r) => ({ key: r.key, description: r.description, players: r.players, count: r.n })),
      core: totals!.results[0]?.core ?? 0,
      free: totals!.results[0]?.free ?? 0,
    };
  }
  return { total: count!.results[0]?.n ?? 0, offset, works: rows!.results.map(toSummary), facets };
}

// ---- Single works and composers ----------------------------------------------

export type Found<T> = { found: T } | { redirect: string } | null;

async function redirectFor(db: Db, entity: "work" | "composer", id: string): Promise<Found<never>> {
  const r = await db.prepare("SELECT new_id FROM redirects WHERE entity = ? AND old_id = ?").bind(entity, id).first<Row>();
  return r ? { redirect: r.new_id } : null;
}

const toLink = (r: Row): Link => ({ provider: r.provider, kind: r.kind, ref: r.ref, url: r.url, label: r.label, source: r.source });

export async function getWork(db: Db, id: string): Promise<Found<WorkDetail>> {
  const [work, scorings, links] = await db.batch<Row>([
    db
      .prepare(
        `SELECT w.*, c.id AS cid, c.name AS cname, c.born AS cborn, c.died AS cdied, c.era AS cera, c.sitelinks AS csitelinks
         FROM works w LEFT JOIN composers c ON c.id = w.composer_id WHERE w.id = ?`,
      )
      .bind(id),
    db
      .prepare("SELECT s.lineup, s.arrangement, s.players, s.sources, l.description FROM scorings s JOIN lineups l ON l.key = s.lineup WHERE s.work_id = ? ORDER BY s.arrangement, s.players, s.lineup")
      .bind(id),
    db.prepare("SELECT * FROM links WHERE entity = 'work' AND entity_id = ? ORDER BY kind DESC, provider").bind(id),
  ]);
  const w = work!.results[0];
  if (!w) return redirectFor(db, "work", id);
  const signals = JSON.parse(w.signals) as Signal[];
  return {
    found: {
      id: w.id,
      title: w.title,
      aliases: JSON.parse(w.aliases),
      composer: w.cid ? { id: w.cid, name: w.cname, born: w.cborn, died: w.cdied, era: w.cera } : null,
      year: w.year,
      era: w.era,
      score: w.score,
      scoreParts: scoreParts({ signals, recordings: w.recordings, sitelinks: w.sitelinks, composerSitelinks: w.csitelinks }).map((p) => ({
        label: p.label,
        points: Math.round(p.points * 10) / 10,
      })),
      scorings: scorings!.results.map(
        (s): Scoring => ({ lineup: s.lineup, description: s.description, players: s.players, arrangement: !!s.arrangement, sources: JSON.parse(s.sources) }),
      ),
      links: links!.results.map(toLink),
    },
  };
}

export async function getComposer(db: Db, id: string): Promise<Found<ComposerDetail>> {
  const [composer, links, lineups] = await db.batch<Row>([
    db.prepare("SELECT * FROM composers WHERE id = ?").bind(id),
    db.prepare("SELECT * FROM links WHERE entity = 'composer' AND entity_id = ? ORDER BY kind DESC, provider").bind(id),
    db
      .prepare(
        `SELECT s.lineup AS key, l.description AS description, COUNT(*) AS n FROM works w JOIN scorings s ON s.work_id = w.id JOIN lineups l ON l.key = s.lineup
         WHERE w.composer_id = ? AND s.arrangement = 0 GROUP BY s.lineup ORDER BY n DESC, l.players LIMIT 100`,
      )
      .bind(id),
  ]);
  const c = composer!.results[0];
  if (!c) return redirectFor(db, "composer", id);
  return {
    found: {
      id: c.id,
      name: c.name,
      sortName: c.sort_name,
      born: c.born,
      died: c.died,
      era: c.era,
      works: c.works,
      links: links!.results.map(toLink),
      lineups: lineups!.results.map((r) => ({ key: r.key, description: r.description, count: r.n })),
    },
  };
}

// ---- Search ----------------------------------------------------------------

export async function search(db: Db, input: string, limit = 20, offset = 0): Promise<SearchResults> {
  const fts = ftsQuery(input);
  if (!fts) return { composers: [], works: [], total: 0 };
  limit = Math.min(Math.max(limit, 1), 100);
  offset = Math.min(Math.max(offset, 0), 10_000);
  const [composers, works, count] = await db.batch<Row>([
    // Best name matches, then the more prolific among them.
    db
      .prepare(
        `SELECT c.id, c.name, c.born, c.died, c.works FROM composers_fts f JOIN composers c ON c.n = f.rowid
         WHERE composers_fts MATCH ? ORDER BY bm25(composers_fts) - c.sitelinks / 20.0 LIMIT 8`,
      )
      .bind(fts),
    // Text relevance, nudged by how established the work is.
    db
      .prepare(
        `SELECT ${SUMMARY} FROM works_fts f JOIN works w ON w.n = f.rowid
         JOIN scorings s ON s.work_id = w.id AND s.lineup = w.lineup LEFT JOIN composers c ON c.id = w.composer_id
         WHERE works_fts MATCH ? ORDER BY bm25(works_fts, 10.0, 6.0, 4.0, 8.0) - w.score * 0.5, w.n LIMIT ? OFFSET ?`,
      )
      .bind(fts, limit, offset),
    db.prepare("SELECT COUNT(*) AS n FROM works_fts WHERE works_fts MATCH ?").bind(fts),
  ]);
  return {
    composers: composers!.results.map((r) => ({ id: r.id, name: r.name, born: r.born, died: r.died, works: r.works })),
    works: works!.results.map(toSummary),
    total: count!.results[0]?.n ?? 0,
  };
}

export const lineupDescription = (key: string) => describe(parseEnsembleKey(key));
