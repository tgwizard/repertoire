// Queries behind the API. Written against Db, the subset of Cloudflare D1's binding
// we use, so the tests can run them on the built SQLite file with node:sqlite.

import { describe, fitsIn, parseEnsembleKey, playerCount } from "../src/lib/instrumentation.ts";
import { column, orchestraConditions, type Orchestration } from "../src/lib/orchestration.ts";
import {
  CORE_SCORE,
  ERAS,
  LENGTHS,
  scoreParts,
  type ComposerDetail,
  type Era,
  type Gone,
  type Facets,
  type Link,
  type LineupsIndex,
  type Meta,
  type Scoring,
  type SearchResults,
  type Signal,
  type SortOrder,
  type SourceId,
  type ArrangedBy,
  type WorkDetail,
  type WorkSort,
  type WorkSummary,
  type WorksPage,
} from "../src/shared/data.ts";
import { searchText } from "../src/shared/text.ts";

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
  const [lineups, min] = await db.batch<Row>([
    db.prepare("SELECT key, original, arrangements FROM lineups"),
    db.prepare("SELECT value FROM meta WHERE key = 'facets_min'"),
  ]);
  const facetsMin = Number(min!.results[0]?.value);
  return {
    version,
    lineups: Object.fromEntries(lineups!.results.map((r) => [r.key, [r.original, r.arrangements]])),
    ...(facetsMin > 0 && { facetsMin }),
  };
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
  /** With a composer: also the works they arranged (IMSLP names arrangers; matched by name) */
  arrangedBy?: boolean;
  eras?: (Era | "Unknown")[];
  show?: "all" | "core" | "free";
  q?: string;
  /** Only orchestral works this orchestra can play ("within"), or scored for exactly it */
  orchestra?: Orchestration;
  fit?: "within" | "exact";
  /** Minutes: from (inclusive), to (exclusive) */
  minDuration?: number;
  maxDuration?: number;
  /** Only works whose length isn't known */
  unknownDuration?: boolean;
  sort?: WorkSort;
  /** Defaults to the sort's natural direction: most established, largest, oldest first, A–Z */
  order?: SortOrder;
  offset?: number;
  limit?: number;
  facets?: boolean;
}

/** An FTS5 query from what someone typed: every word must match, words as prefixes. */
export function ftsQuery(input: string): string | null {
  const words = searchText(input).split(" ").filter(Boolean).slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => (/^\d+$/.test(w) || w.length < 2 ? `"${w}"` : `"${w}"*`)).join(" ");
}

const SUMMARY = `w.id, w.title, w.year, w.era, w.score, s.lineup, s.players, s.arrangement, w.duration, w.movements,
  CASE WHEN o.status != 'partial' THEN o.scoring END AS orchestration, o.status AS orchestration_status,
  c.id AS cid, c.name AS cname, c.born AS cborn, c.died AS cdied,
  (SELECT url FROM links WHERE entity = 'work' AND entity_id = w.id AND kind = 'score' ORDER BY provider != 'imslp' LIMIT 1) AS score_url`;
// The orchestrations join only where it's used (the listed page, an orchestra's filter):
// counting a large line-up, every joined row costs.
const CORE = "FROM scorings s JOIN works w ON w.id = s.work_id LEFT JOIN composers c ON c.id = w.composer_id";
const FROM = `${CORE} LEFT JOIN orchestrations o ON o.work_id = w.id`;

// Who arranged a row's work. On a line-up's list: the row's arrangements for that line-up,
// when it's listed for an arrangement. Searching: all with a named arranger, of which
// toSummary keeps those by an arranger searched for.
const ARRANGED_FOR_ROW = `(SELECT json_group_array(json_array(a.arranger, a.excerpt, a.lineup)) FROM arrangements a
  WHERE a.work_id = w.id AND a.lineup = s.lineup AND s.arrangement = 1) AS arranged`;
const ARRANGED_ANY = `(SELECT json_group_array(json_array(a.arranger, a.excerpt, a.lineup)) FROM arrangements a
  WHERE a.work_id = w.id AND a.arranger IS NOT NULL) AS arranged`;

/** Search weights per works_fts column: title, composer, aliases, keys, arrangers */
const BM25 = "10.0, 6.0, 4.0, 8.0, 3.0";
/** The columns with a work's own words, not its arrangers' */
const OWN_COLUMNS = "title composer aliases keys";

/** Works a composer arranged: IMSLP's arrangers by the composer's name */
const ARRANGED_BY_COMPOSER = "w.id IN (SELECT a.work_id FROM arrangements a WHERE a.arranger = (SELECT name FROM composers WHERE id = ?) COLLATE NOCASE)";
/** A row's arrangements by a composer (ids are checked: [0-9a-z] only) */
const arrangedByComposer = (id: string) => {
  if (!/^[0-9a-z]+$/.test(id)) throw new Error("Not a composer id");
  return `(SELECT json_group_array(json_array(a.arranger, a.excerpt, a.lineup)) FROM arrangements a
    WHERE a.work_id = w.id AND a.arranger = (SELECT name FROM composers WHERE id = '${id}') COLLATE NOCASE) AS arranged`;
};

/**
 * A row's arrangements: all of them, or (searching) those whose arranger has a word
 * starting with one searched for. A line-up other than the row's is described.
 */
function arrangedBy(json: string | null | undefined, rowLineup: string, searched?: string[]): ArrangedBy[] | undefined {
  if (!json) return undefined;
  const rows = JSON.parse(json) as [string | null, string | null, string | null][];
  const out: ArrangedBy[] = [];
  const seen = new Set<string>();
  for (const [arranger, excerpt, lineup] of rows) {
    if (searched && !(arranger && searchText(arranger).split(" ").some((t) => searched.some((w) => t.startsWith(w))))) continue;
    const a: ArrangedBy = { arranger, excerpt, ...(lineup && lineup !== rowLineup && { lineup: lineupDescription(lineup) }) };
    const key = JSON.stringify(a);
    if (!seen.has(key)) seen.add(key), out.push(a);
  }
  return out.length ? out.slice(0, 4) : undefined;
}

function toSummary(r: Row, searched?: string[]): WorkSummary {
  const arranged = arrangedBy(r.arranged, r.lineup, searched);
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
    duration: r.duration,
    movements: r.movements,
    orchestration: r.orchestration,
    ...(r.orchestration && { orchestrationStatus: r.orchestration_status }),
    ...(arranged && { arrangedBy: arranged }),
  };
}

// Each sort's natural direction, and its ORDER BY with the main key in a given direction.
// Works without a year, composer or duration stay last either way.
const ORDER: Record<WorkSort, [SortOrder, (d: string) => string]> = {
  rank: ["desc", (d) => `s.arrangement, s.score ${d}, s.work_id`],
  players: ["desc", (d) => `players ${d}, s.arrangement, s.score DESC, s.work_id`],
  chronological: ["asc", (d) => `COALESCE(w.year, c.born + 35) IS NULL, COALESCE(w.year, c.born + 35) ${d}, w.score DESC, w.n`],
  composer: ["asc", (d) => `c.sort_name IS NULL, c.sort_name COLLATE NOCASE ${d}, w.title COLLATE NOCASE, w.n`],
  title: ["asc", (d) => `w.title COLLATE NOCASE ${d}, w.n`],
  duration: ["asc", (d) => `w.duration IS NULL, w.duration ${d}, w.score DESC, w.n`],
  // Text relevance, nudged by how established the work is (needs the search's join, below)
  relevance: ["asc", (d) => `f.rank - w.score * 0.5 ${d}, w.n`],
};

/** Rows listed for a line-up with an orchestra in it ("orchestra*2", "voices with orchestra" too) */
const ORCHESTRAL = "s.lineup LIKE '%orchestra%'";
/** No scoring to go on: none, or one that can't be relied on */
const UNSCORED = "(o.work_id IS NULL OR o.status = 'partial')";

/**
 * Whether the row's work's scoring fits an orchestra (or is exactly it), as SQL on the
 * orchestrations table. The orchestra's numbers are written in, not bound: there are dozens,
 * the facets repeat the condition, and D1 allows 100 bound parameters a query.
 */
function orchestraFits(ours: Orchestration, exact: boolean): string {
  const c = (k: string) => `o.${column(k)}`;
  const n = (v: number) => {
    if (!Number.isInteger(v) || v < 0 || v > 1000) throw new Error(`Not a number of players: ${v}`);
    return String(v);
  };
  const doubled = (main: string, aux: string, ours: number) =>
    `(MAX(0, ${c(`${main}/${aux}`)} - MAX(0, ${n(ours)} - ${c(aux)})) + MAX(0, ${c(aux)} - ${n(ours)}))`;
  const sql = orchestraConditions(ours, exact).map((k) => {
    switch (k.kind) {
      case "exact":
        return `${c(k.key)} = ${n(k.value)}`;
      case "players":
        return `${c(k.key)} <= ${n(k.max)}`;
      case "section":
        return `${c(k.main)}${k.auxes.map((a) => ` + MAX(0, ${c(a.aux)} - ${n(a.ours)})`).join("")} <= ${n(k.max)}`;
      case "doubling":
        return `${doubled(k.main, k.aux, k.ours)} <= ${n(k.max)}`;
      case "doublers":
        return `${k.auxes.map((a) => doubled(k.main, a.aux, a.ours)).join(" + ")} <= ${n(k.max)}`;
    }
  });
  return `NOT ${UNSCORED} AND ${sql.join(" AND ")}`;
}

/** Line-ups this big have their unfiltered facets precomputed by the build (lineup_facets;
 * the dataset's meta says which threshold it used) */
export const PRECOMPUTED_FACETS_MIN = 500;

export async function listWorks(db: Db, index: LineupsIndex | null, q: WorkQuery): Promise<WorksPage> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = Math.min(Math.max(q.offset ?? 0, 0), 100_000);
  const fts = q.q ? ftsQuery(q.q) : null;
  if (q.q && !fts) return { total: 0, offset, works: [], facets: null };
  // Relevance needs a search; hasOwn, as "constructor" is in every object
  const sort = q.sort && Object.hasOwn(ORDER, q.sort) && (q.sort !== "relevance" || fts) ? q.sort : "rank";
  const [natural, orderBy] = ORDER[sort];
  const dir = (q.order ?? natural) === "desc" ? "DESC" : "ASC";

  // Base: which works are in the list at all. Searching without a line-up, the search
  // belongs to it, and on a composer's own page the composer: facets then group only
  // those works, never the whole dataset.
  const base: string[] = [];
  const baseArgs: unknown[] = [];
  const MATCHES = "w.n IN (SELECT rowid FROM works_fts WHERE works_fts MATCH ?)";
  // A match on a work's own words, not its arrangers': a work found by its arranger is an
  // arrangement, listed (and counted) as one
  const ownFts = fts && `{${OWN_COLUMNS}} : (${fts})`;
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
  const searching = !q.lineup && fts;
  if (searching) {
    base.push(MATCHES);
    baseArgs.push(fts);
  }
  const ownPage = q.composer && !q.lineup && !fts;
  // A composer's works, and with arrangedBy the works they arranged
  const byComposer = q.composer && q.arrangedBy ? `(w.composer_id = ? OR ${ARRANGED_BY_COMPOSER})` : "w.composer_id = ?";
  const composerArgs = q.composer && q.arrangedBy ? [q.composer, q.composer] : [q.composer];
  if (ownPage) {
    base.push(byComposer);
    baseArgs.push(...composerArgs);
  }
  // Originals only, unless arrangements are listed too: always the last of the base
  const original = searching ? { sql: `s.arrangement = 0 AND ${MATCHES}`, args: [ownFts] } : { sql: "s.arrangement = 0", args: [] };
  if (!q.arrangements) {
    base.push(original.sql);
    baseArgs.push(...original.args);
  }

  // Filters on top. Each facet counts with all the others applied, but not its own, so
  // its numbers say what picking it would give.
  type Filter = { key: "composer" | "era" | "length" | "orchestra" | "show" | "q"; sql: string; args: unknown[] };
  const filters: Filter[] = [];
  if (q.composer && !ownPage) filters.push({ key: "composer", sql: byComposer, args: composerArgs });
  if (q.eras?.length) {
    const known = q.eras.filter((e) => (ERAS as readonly string[]).includes(e));
    const parts: string[] = [];
    const args: unknown[] = [];
    if (known.length) {
      parts.push("w.era IN (SELECT value FROM json_each(?))");
      args.push(JSON.stringify(known));
    }
    if (q.eras.includes("Unknown")) parts.push("w.era IS NULL");
    if (parts.length) filters.push({ key: "era", sql: `(${parts.join(" OR ")})`, args });
  }
  const length: string[] = [];
  const lengthArgs: unknown[] = [];
  if (q.minDuration) {
    length.push("w.duration >= ?");
    lengthArgs.push(q.minDuration * 60);
  }
  if (q.maxDuration) {
    length.push("w.duration < ?");
    lengthArgs.push(q.maxDuration * 60);
  }
  if (q.unknownDuration) length.push("w.duration IS NULL");
  if (length.length) filters.push({ key: "length", sql: `(${length.join(" AND ")})`, args: lengthArgs });
  // An orchestra to fit: rows for an orchestral line-up need a scoring that fits; string
  // orchestra works need strings; anything else (a soloist's part) is fine as it is.
  if (q.orchestra) {
    const exact = q.fit === "exact";
    filters.push({
      key: "orchestra",
      sql: `(CASE WHEN ${ORCHESTRAL} THEN ${orchestraFits(q.orchestra, exact)} WHEN s.lineup = 'strings' THEN ${q.orchestra.str && !exact ? 1 : 0} ELSE ${exact ? 0 : 1} END)`,
      args: [],
    });
  }
  if (q.show === "core") filters.push({ key: "show", sql: `w.score >= ${CORE_SCORE}`, args: [] });
  if (q.show === "free") filters.push({ key: "show", sql: "w.free = 1", args: [] });
  // Within a line-up, an arranger's name matches the rows that are arrangements
  if (fts && !searching) filters.push({ key: "q", sql: `(${MATCHES} OR (s.arrangement = 1 AND ${MATCHES}))`, args: [ownFts, fts] });

  const cond = (c: string[]) => `WHERE ${c.join(" AND ")}`;
  const orch = filters.some((f) => f.key === "orchestra");
  const where = [...base, ...filters.map((f) => f.sql)];
  const args = [...baseArgs, ...filters.flatMap((f) => f.args)];

  // The page. Ranked, a line-up's works come straight from the scorings_rank index
  // (s.score is the work's score), in order, without sorting them all.
  const relevance = sort === "relevance";
  const rowsFrom = relevance ? `${FROM} JOIN (SELECT rowid, rank FROM works_fts WHERE works_fts MATCH ? AND rank MATCH 'bm25(${BM25})') f ON f.rowid = w.n` : FROM;
  const summary = `${SUMMARY}, ${q.composer && q.arrangedBy ? arrangedByComposer(q.composer) : searching ? ARRANGED_ANY : ARRANGED_FOR_ROW}`;
  // With smaller groups a work can be listed for several of them: keep the largest.
  const select = multi
    ? `SELECT ${summary.replace("s.players", "MAX(s.players) AS players")} ${rowsFrom} ${cond(where)} GROUP BY s.work_id`
    : `SELECT ${summary} ${rowsFrom} ${cond(where)}`;
  const stmts = [db.prepare(`${select} ORDER BY ${orderBy(dir)} LIMIT ? OFFSET ?`).bind(...(relevance ? [fts] : []), ...args, limit, offset)];

  // The total and facets. A big line-up, unfiltered, has them precomputed; otherwise one
  // pass over the base list marks, per work, which filters it passes, and every count
  // comes from that (rather than a pass per facet).
  const entry = q.lineup && index?.lineups[q.lineup];
  const precomputed = !!(q.facets && q.lineup && !multi && !filters.length && entry && index?.facetsMin && entry[0] + entry[1] >= index.facetsMin);
  if (precomputed) {
    stmts.push(db.prepare("SELECT total, facets FROM lineup_facets WHERE lineup = ? AND arrangements = ?").bind(q.lineup, q.arrangements ? 1 : 0));
  } else if (q.facets) {
    // Arrangements are counted whether or not they're listed, so the facet's base has them
    // all, and "originals only" is one more condition to pass.
    const [facetBase, facetBaseArgs] = q.arrangements ? [base, baseArgs] : [base.slice(0, -1), baseArgs.slice(0, baseArgs.length - original.args.length)];
    // Some conditions are on a work's row for a line-up (an arrangement or not, an
    // orchestra's fit, an arranger's name), the rest on the work. A work passes when one
    // of its rows passes all the row conditions together: one row an original and another
    // found by its arranger isn't a match. So each flag is a conjunction, per row, of the
    // row conditions a count needs (all of them, or all but its own), before grouping.
    type Cond = { key: string; sql: string; args: unknown[] };
    const onRow = (f: Filter) => f.key === "orchestra" || f.key === "q";
    const rowConds: Cond[] = filters.filter(onRow);
    const originalCond: Cond = { key: "original", sql: original.sql, args: original.args };
    const listed = q.arrangements ? rowConds : [...rowConds, originalCond];
    const flagSql: string[] = [];
    const flagArgs: unknown[] = [];
    const flag = (name: string, conds: Cond[]) => {
      flagSql.push(`MAX(${conds.map((c) => `(${c.sql})`).join(" AND ") || "1"}) AS ${name}`);
      for (const c of conds) flagArgs.push(...c.args);
    };
    for (const f of filters.filter((f) => !onRow(f))) flag(`f_${f.key}`, [f]);
    flag("r_all", listed);
    for (const c of rowConds) flag(`r_no_${c.key}`, listed.filter((x) => x !== c));
    // An arrangement: passes as either, but not as an original
    flag("r_any", rowConds);
    flag("r_original", [...rowConds, originalCond]);
    if (q.orchestra) flag("unscored", [{ key: "unscored", sql: `${ORCHESTRAL} AND ${UNSCORED}`, args: [] }, ...listed.filter((c) => c.key !== "orchestra")]);
    const pass = (except?: Filter["key"] | "arrangements") => {
      const work = filters.filter((f) => !onRow(f) && f.key !== except).map((f) => `f_${f.key}`);
      const row = rowConds.some((c) => c.key === except) ? `r_no_${except}` : except === "arrangements" ? "r_any" : "r_all";
      return [...work, row].join(" AND ");
    };
    const none = (n: number) => Array(n).fill("NULL").join(", ");
    const lengthSums = LENGTHS.map((l, i) => `SUM(${pass("length")} AND duration >= ${l.min * 60}${l.max ? ` AND duration < ${l.max * 60}` : ""}) AS length_${i}`);
    stmts.push(
      db
        .prepare(
          `WITH m AS MATERIALIZED (
             SELECT w.id AS id, w.era AS era, c.id AS cid, c.name AS cname, c.sort_name AS csort, w.score AS score, w.free AS free, w.duration AS duration
             ${flagSql.map((f) => `, ${f}`).join("")}
             ${orch || q.orchestra ? FROM : CORE} ${cond(facetBase)} GROUP BY w.id
           )
           SELECT 'total' AS kind, NULL AS key, NULL AS name, SUM(${pass()}) AS n,
             SUM(${pass("show")} AND score >= ${CORE_SCORE}) AS core, SUM(${pass("show")} AND free) AS free,
             SUM(${pass("length")} AND duration IS NULL) AS unknown_length, ${lengthSums.join(", ")},
             ${q.orchestra ? `SUM(${pass("orchestra")} AND unscored)` : "NULL"} AS unscored,
             SUM(${pass("arrangements")} AND NOT r_original) AS arrangements
           FROM m
           UNION ALL
           SELECT 'era', era, NULL, SUM(${pass("era")}), ${none(LENGTHS.length + 5)} FROM m GROUP BY era
           UNION ALL
           SELECT * FROM (
             SELECT 'composer', cid, cname, SUM(${pass("composer")}) AS n, ${none(LENGTHS.length + 5)}
             FROM m WHERE cid IS NOT NULL GROUP BY cid HAVING n > 0 ORDER BY n DESC, MIN(csort) LIMIT 300
           )`,
        )
        .bind(...flagArgs, ...facetBaseArgs),
    );
  } else if (!multi && !filters.length && q.lineup) {
    stmts.push(db.prepare(`SELECT COUNT(*) AS n FROM scorings s ${cond(base)}`).bind(...baseArgs));
  } else {
    stmts.push(db.prepare(`SELECT COUNT(DISTINCT s.work_id) AS n ${orch ? FROM : CORE} ${cond(where)}`).bind(...args));
  }
  if (q.facets && searching) {
    // The line-ups the matches are for: every one a work is listed for, not only its main
    const lineupBase = base.filter((c) => c !== "s.lineup = w.lineup");
    stmts.push(
      db
        .prepare(
          `SELECT s.lineup AS key, l.description AS description, l.players AS players, COUNT(DISTINCT s.work_id) AS n ${orch ? FROM : CORE} JOIN lineups l ON l.key = s.lineup ${cond([...lineupBase, ...filters.map((f) => f.sql)])} GROUP BY s.lineup ORDER BY n DESC, l.players LIMIT 60`,
        )
        .bind(...baseArgs, ...filters.flatMap((f) => f.args)),
    );
  } else if (q.facets && multi) {
    stmts.push(
      db
        .prepare(
          `SELECT s.lineup AS key, l.description AS description, l.players AS players, COUNT(*) AS n ${orch ? FROM : CORE} JOIN lineups l ON l.key = s.lineup ${cond(where)} GROUP BY s.lineup ORDER BY l.players DESC, n DESC LIMIT 200`,
        )
        .bind(...args),
    );
  }

  // Without facets, the orchestral works left out for want of a scoring are counted alone
  const unscoredAlone = !!q.orchestra && !q.facets;
  if (unscoredAlone) {
    const other = filters.filter((f) => f.key !== "orchestra");
    stmts.push(
      db
        .prepare(`SELECT COUNT(DISTINCT s.work_id) AS n ${FROM} ${cond([...base, ...other.map((f) => f.sql), ORCHESTRAL, UNSCORED])}`)
        .bind(...baseArgs, ...other.flatMap((f) => f.args)),
    );
  }
  const results = await db.batch<Row>(stmts);
  const unscored = unscoredAlone ? results.pop()!.results[0]?.n : undefined;
  const [rows, counted, lineups] = results;
  // Searching, a row says which of its arrangements the search found it by
  const searched = searching ? searchText(q.q!).split(" ").filter((w) => w.length >= 2) : undefined;
  const works = rows!.results.map((r) => toSummary(r, searched));
  if (precomputed) {
    const r = counted!.results[0];
    // Not there (an older dataset): count after all
    if (!r) return listWorks(db, null, q);
    return { total: r.total, offset, works, facets: JSON.parse(r.facets) };
  }
  if (!q.facets) return { total: counted!.results[0]?.n ?? 0, offset, works, facets: null, ...(unscored !== undefined && { unscored }) };
  const out = counted!.results;
  const totals = out.find((r) => r.kind === "total")!;
  const facets: Facets = {
    eras: Object.fromEntries(out.filter((r) => r.kind === "era").map((r) => [r.key ?? "Unknown", r.n ?? 0])),
    composers: out.filter((r) => r.kind === "composer").map((r) => ({ id: r.key, name: r.name, count: r.n })),
    lineups: (lineups?.results ?? []).map((r) => ({ key: r.key, description: r.description, players: r.players, count: r.n })),
    core: totals.core ?? 0,
    free: totals.free ?? 0,
    lengths: { known: LENGTHS.map((_, i) => totals[`length_${i}`] ?? 0), unknown: totals.unknown_length ?? 0 },
    arrangements: totals.arrangements ?? 0,
  };
  return { total: totals.n ?? 0, offset, works, facets, ...(q.orchestra && { unscored: totals.unscored ?? 0 }) };
}

// ---- Single works and composers ----------------------------------------------

export type Found<T> = { found: T } | { redirect: string } | { gone: Gone } | null;

/** An id that isn't live: merged into another (a redirect), retired (gone), or never was */
async function redirectFor(db: Db, entity: "work" | "composer", id: string): Promise<Found<never>> {
  const [redirect, retired] = await db.batch<Row>([
    db.prepare("SELECT new_id FROM redirects WHERE entity = ? AND old_id = ?").bind(entity, id),
    db.prepare("SELECT * FROM retired WHERE entity = ? AND id = ?").bind(entity, id),
  ]);
  const r = redirect!.results[0];
  if (r) return { redirect: r.new_id };
  const g = retired!.results[0];
  if (!g) return null;
  const seeAlso = (
    await db
      .prepare(
        `SELECT w.id, w.title, c.name AS cname FROM json_each(?) j JOIN works w ON w.id = j.value LEFT JOIN composers c ON c.id = w.composer_id ORDER BY w.score DESC LIMIT 10`,
      )
      .bind(g.see_also)
      .all<Row>()
  ).results;
  return {
    gone: {
      id: g.id,
      title: g.title,
      composer: g.composer,
      since: g.since,
      reason: g.reason,
      seeAlso: seeAlso.map((w) => ({ id: w.id, title: w.title, composer: w.cname ? { name: w.cname } : null })),
    },
  };
}

const toLink = (r: Row): Link => ({ provider: r.provider, kind: r.kind, ref: r.ref, url: r.url, label: r.label, source: r.source });

export async function getWork(db: Db, id: string): Promise<Found<WorkDetail>> {
  const [work, scorings, links, orchestration, arrangements] = await db.batch<Row>([
    db
      .prepare(
        `SELECT w.*, c.id AS cid, c.name AS cname, c.born AS cborn, c.died AS cdied, c.era AS cera, c.sitelinks AS csitelinks
         FROM works w LEFT JOIN composers c ON c.id = w.composer_id WHERE w.id = ?`,
      )
      .bind(id),
    db
      .prepare("SELECT s.lineup, s.arrangement, s.players, s.sources, l.description FROM scorings s JOIN lineups l ON l.key = s.lineup WHERE s.work_id = ? ORDER BY s.arrangement, s.players, s.lineup")
      .bind(id),
    db.prepare("SELECT * FROM links WHERE entity = 'work' AND entity_id = ? ORDER BY kind DESC, provider, position").bind(id),
    db.prepare("SELECT scoring, instruments, status, basis, unresolved, source, ref FROM orchestrations WHERE work_id = ?").bind(id),
    db.prepare("SELECT lineup, arranger, excerpt, heading, license FROM arrangements WHERE work_id = ? ORDER BY position").bind(id),
  ]);
  const w = work!.results[0];
  const o = orchestration!.results[0];
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
      scoreParts: scoreParts({ signals, recordings: w.recordings, sitelinks: w.sitelinks, composerSitelinks: w.csitelinks, copies: w.copies }).map((p) => ({
        label: p.label,
        points: Math.round(p.points * 10) / 10,
      })),
      copies: w.copies,
      duration: w.duration,
      movements: w.movements,
      orchestration: o
        ? {
            scoring: o.scoring,
            instruments: JSON.parse(o.instruments),
            status: o.status,
            basis: o.basis,
            unresolved: JSON.parse(o.unresolved),
            source: o.source,
            ref: o.ref,
            url: o.source === "rism" ? `https://rism.online/sources/${o.ref}` : (links!.results.find((l) => l.provider === "imslp")?.url ?? `https://imslp.org/index.php?curid=${o.ref}`),
          }
        : null,
      scorings: scorings!.results.map(
        (s): Scoring => ({ lineup: s.lineup, description: s.description, players: s.players, arrangement: !!s.arrangement, sources: JSON.parse(s.sources) }),
      ),
      arrangements: arrangements!.results.map((a) => ({ lineup: a.lineup, arranger: a.arranger, excerpt: a.excerpt, heading: a.heading, license: a.license })),
      links: links!.results.map(toLink),
    },
  };
}

export async function getComposer(db: Db, id: string): Promise<Found<ComposerDetail>> {
  const [composer, links, lineups, arranged] = await db.batch<Row>([
    db.prepare("SELECT * FROM composers WHERE id = ?").bind(id),
    db.prepare("SELECT * FROM links WHERE entity = 'composer' AND entity_id = ? ORDER BY kind DESC, provider, position").bind(id),
    db
      .prepare(
        `SELECT s.lineup AS key, l.description AS description, COUNT(*) AS n FROM works w JOIN scorings s ON s.work_id = w.id JOIN lineups l ON l.key = s.lineup
         WHERE w.composer_id = ? AND s.arrangement = 0 GROUP BY s.lineup ORDER BY n DESC, l.players LIMIT 100`,
      )
      .bind(id),
    // Other composers' works they arranged
    db
      .prepare(
        `SELECT COUNT(DISTINCT a.work_id) AS n FROM arrangements a JOIN works w ON w.id = a.work_id
         WHERE a.arranger = (SELECT name FROM composers WHERE id = ?) COLLATE NOCASE AND w.composer_id IS NOT ?`,
      )
      .bind(id, id),
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
      arranged: arranged!.results[0]?.n ?? 0,
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
         JOIN scorings s ON s.work_id = w.id AND s.lineup = w.lineup LEFT JOIN composers c ON c.id = w.composer_id LEFT JOIN orchestrations o ON o.work_id = w.id
         WHERE works_fts MATCH ? ORDER BY bm25(works_fts, ${BM25}) - w.score * 0.5, w.n LIMIT ? OFFSET ?`,
      )
      .bind(fts, limit, offset),
    db.prepare("SELECT COUNT(*) AS n FROM works_fts WHERE works_fts MATCH ?").bind(fts),
  ]);
  return {
    composers: composers!.results.map((r) => ({ id: r.id, name: r.name, born: r.born, died: r.died, works: r.works })),
    works: works!.results.map((r) => toSummary(r)),
    total: count!.results[0]?.n ?? 0,
  };
}

export const lineupDescription = (key: string) => describe(parseEnsembleKey(key));
