import { MAX_COMPOSERS_PER_REQUEST, type ComposersResponse, type Era } from "../src/shared/api";
import { cachedJson, Memo } from "./cache";
import { fetchComposerEras, fetchInstrumentations, fetchWorks, isValidCategory, UpstreamError } from "./imslp";

const HOUR = 3600;
const DAY = 24 * HOUR;

const composerEras = new Memo<Era | null>(DAY * 1000, 50_000);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function route(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/instrumentations" && request.method === "GET") {
    return cachedJson(request, ctx, "instrumentations/v1", { freshFor: DAY, keepFor: 14 * DAY, browserMaxAge: HOUR }, fetchInstrumentations);
  }

  if (url.pathname === "/api/works" && request.method === "GET") {
    const cat = url.searchParams.get("cat") ?? "";
    const from = url.searchParams.get("from");
    if (!isValidCategory(cat)) return json({ error: "cat must be an instrumentation category ('For ...')" }, 400);
    if (from && from.length > 2000) return json({ error: "invalid from" }, 400);
    const key = `works/v1/${encodeURIComponent(cat)}/${encodeURIComponent(from ?? "")}`;
    return cachedJson(request, ctx, key, { freshFor: DAY, keepFor: 7 * DAY, browserMaxAge: 6 * HOUR }, () => fetchWorks(cat, from));
  }

  if (url.pathname === "/api/composers" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { names?: unknown } | null;
    const names = body?.names;
    if (
      !Array.isArray(names) ||
      names.length > MAX_COMPOSERS_PER_REQUEST ||
      !names.every((n) => typeof n === "string" && n.length > 0 && n.length <= 200)
    ) {
      return json({ error: `names must be 1-${MAX_COMPOSERS_PER_REQUEST} composer names` }, 400);
    }
    const eras: Record<string, Era | null> = {};
    const missing: string[] = [];
    for (const n of new Set<string>(names)) {
      const hit = composerEras.get(n);
      if (hit !== undefined) eras[n] = hit;
      else missing.push(n);
    }
    if (missing.length) {
      for (const [n, era] of Object.entries(await fetchComposerEras(missing))) {
        composerEras.set(n, era);
        eras[n] = era;
      }
    }
    return json({ eras } satisfies ComposersResponse);
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, _env, ctx) {
    try {
      return await route(request, ctx);
    } catch (e) {
      console.error(e);
      const upstream = e instanceof UpstreamError || (e instanceof Error && e.name === "TimeoutError");
      return json({ error: upstream ? `IMSLP is unavailable: ${(e as Error).message}` : "internal error" }, upstream ? 502 : 500);
    }
  },
} satisfies ExportedHandler<Env>;
