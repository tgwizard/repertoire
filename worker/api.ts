// The JSON API: /api/… Plain Request → Response, so tests can call it directly.

import { decodeEnsemble, ensembleKey } from "../src/lib/instrumentation.ts";
import { parseOrchestration, type Orchestration } from "../src/lib/orchestration.ts";
import { ERAS, WORK_SORTS, type Era, type LineupsIndex } from "../src/shared/data.ts";
import { getComposer, getLineup, getLineups, getMeta, getWork, listWorks, search, type Db, type Found } from "./queries.ts";

const ID = /^[0-9a-z]{8}$/;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });

/** "cello,viola,violin*2" or "violin:2,viola,cello" → the canonical key */
export function lineupParam(value: string | null): string | undefined {
  if (!value) return undefined;
  const key = ensembleKey(decodeEnsemble(value.replaceAll("*", ":")));
  if (!key) throw new HttpError(400, `Not a line-up: ${value}`);
  return key;
}

/** An orchestra's scoring in the shorthand: "2.2.2.2,4.2.3.1,timp,str" */
export function orchestraParam(value: string | null): Orchestration | undefined {
  if (!value) return undefined;
  const o = parseOrchestration(value);
  if (!o) throw new HttpError(400, `Not an orchestra's scoring: ${value}`);
  return o;
}

const int = (value: string | null, fallback: number) => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) throw new HttpError(400, `Not a number: ${value}`);
  return Math.trunc(n);
};

/** One of a parameter's values, or the default when it's absent; anything else is a 400. */
function oneOf<T extends string>(p: URLSearchParams, name: string, values: readonly T[]): T | undefined;
function oneOf<T extends string>(p: URLSearchParams, name: string, values: readonly T[], fallback: T): T;
function oneOf<T extends string>(p: URLSearchParams, name: string, values: readonly T[], fallback?: T): T | undefined {
  const v = p.get(name);
  if (v === null || v === "") return fallback;
  // includes(), not `in`: "constructor" and "toString" are no sort
  if (!(values as readonly string[]).includes(v)) throw new HttpError(400, `${name} must be one of ${values.join(", ")}`);
  return v as T;
}

function found<T>(r: Found<T>, url: URL, path: (id: string) => string): Response {
  if (!r) throw new HttpError(404, "Not found");
  if ("redirect" in r) return new Response(null, { status: 301, headers: { Location: path(r.redirect) + url.search, "Access-Control-Allow-Origin": "*" } });
  if ("gone" in r) return json({ error: "No longer listed", gone: r.gone }, 410);
  return json(r.found);
}

// The line-up index is the same for every request of a dataset version.
let lineupsCache: Promise<LineupsIndex> | null = null;
let lineupsVersion = "";
let versionCache: Promise<string> | null = null;

export function datasetVersion(db: Db): Promise<string> {
  versionCache ??= db
    .prepare("SELECT value FROM meta WHERE key = 'version'")
    .first<{ value: string }>()
    .then((r) => r?.value ?? "unknown");
  return versionCache;
}

async function lineups(db: Db): Promise<LineupsIndex> {
  const version = await datasetVersion(db);
  if (!lineupsCache || lineupsVersion !== version) {
    lineupsVersion = version;
    lineupsCache = getLineups(db, version);
  }
  return lineupsCache;
}

/** Forget memoized dataset state (tests switch databases). */
export function resetCaches() {
  lineupsCache = null;
  versionCache = null;
}

const ENDPOINTS = {
  "/api/meta": "Dataset version, counts and sources",
  "/api/lineups": "All line-ups: key → [original works, arrangement-only works]",
  "/api/lineups/{key}": "One line-up, e.g. /api/lineups/cello,viola,violin*2",
  "/api/works?lineup={key}": "Works for a line-up. Also: subsets=1 (smaller groups too), min_players, arrangements=1, composer (with arranged_by=1, also works they arranged), era (repeatable), show=core|free, q, orchestra (a scoring, e.g. 2.2.2.2,4.2.3.1,timp,str) with fit=within|exact, min_duration (minutes, from) and max_duration (minutes, under), or duration=unknown, sort=rank|players|chronological|composer|title|duration, order=asc|desc, offset, limit (≤200), facets=1",
  "/api/works/{id}": "One work, with its line-ups, links and ranking",
  "/api/composers/{id}": "One composer, and how many works they arranged; their works: /api/works?composer={id}",
  "/api/search?q={text}": "Works and composers matching a search; limit, offset",
};

export async function handleApi(request: Request, db: Db): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams;
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Only GET");
    if (path === "/api") return json({ version: await datasetVersion(db), license: "CC BY-SA 4.0", endpoints: ENDPOINTS });
    if (path === "/api/meta") return json(await getMeta(db));
    if (path === "/api/lineups") return json(await lineups(db));

    let m = /^\/api\/lineups\/(.+)$/.exec(path);
    if (m) {
      const lineup = await getLineup(db, lineupParam(decodeURIComponent(m[1]!))!);
      if (!lineup) throw new HttpError(404, "No works for this line-up");
      return json(lineup);
    }

    if (path === "/api/works") {
      const lineup = lineupParam(p.get("lineup"));
      const composer = p.get("composer") ?? undefined;
      const q = p.get("q")?.trim() || undefined;
      if (!lineup && !composer && !q) throw new HttpError(400, "Give a lineup, composer or q");
      if (composer && !ID.test(composer)) throw new HttpError(400, "Not a composer id");
      const subsets = p.get("subsets") === "1";
      return json(
        // The line-ups index (kept in memory) says which line-ups have their facets precomputed
        await listWorks(db, await lineups(db), {
          lineup,
          subsets,
          minPlayers: int(p.get("min_players"), 1),
          arrangements: p.get("arrangements") === "1",
          composer,
          arrangedBy: !!composer && p.get("arranged_by") === "1",
          eras: p.getAll("era").filter((e): e is Era | "Unknown" => e === "Unknown" || (ERAS as readonly string[]).includes(e)),
          show: oneOf(p, "show", ["all", "core", "free"] as const, "all"),
          q,
          orchestra: orchestraParam(p.get("orchestra")),
          fit: oneOf(p, "fit", ["within", "exact"] as const, "within"),
          minDuration: int(p.get("min_duration"), 0) || undefined,
          maxDuration: int(p.get("max_duration"), 0) || undefined,
          unknownDuration: p.get("duration") === "unknown",
          sort: oneOf(p, "sort", WORK_SORTS, "rank"),
          order: oneOf(p, "order", ["asc", "desc"] as const),
          offset: int(p.get("offset"), 0),
          limit: int(p.get("limit"), 50),
          facets: p.get("facets") === "1",
        }),
      );
    }

    m = /^\/api\/works\/([^/]+)$/.exec(path);
    if (m) {
      if (!ID.test(m[1]!)) throw new HttpError(404, "Not found");
      return found(await getWork(db, m[1]!), url, (id) => `/api/works/${id}`);
    }

    m = /^\/api\/composers\/([^/]+)$/.exec(path);
    if (m) {
      if (!ID.test(m[1]!)) throw new HttpError(404, "Not found");
      return found(await getComposer(db, m[1]!), url, (id) => `/api/composers/${id}`);
    }

    if (path === "/api/search") {
      const q = p.get("q")?.trim();
      if (!q) throw new HttpError(400, "Give q");
      return json(await search(db, q, int(p.get("limit"), 20), int(p.get("offset"), 0)));
    }

    throw new HttpError(404, "No such endpoint; see /api");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    // A malformed full-text query is the caller's fault, anything else ours.
    const message = (e as Error).message ?? String(e);
    if (/fts5|MATCH/i.test(message)) return json({ error: "Couldn't search for that" }, 400);
    console.error(`API error for ${url.pathname}${url.search}:`, e);
    return json({ error: "Internal error" }, 500);
  }
}
