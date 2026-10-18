// Edge caching via the Cache API. Note: the Cache API is a no-op on *.workers.dev;
// it works locally (Miniflare) and on custom domains.

// Shares the produced body (not a Response: I/O objects can't cross requests).
const inflight = new Map<string, Promise<string>>();

interface CacheOptions {
  /** After this many seconds the entry is stale: served, but refreshed in the background. */
  freshFor: number;
  /** How long the edge keeps the entry at all. */
  keepFor: number;
  /** Cache-Control max-age sent to browsers. */
  browserMaxAge: number;
}

export async function cachedJson(
  request: Request,
  ctx: ExecutionContext,
  key: string,
  opts: CacheOptions,
  produce: () => Promise<unknown>,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(new URL(`/__cache/${key}`, request.url));

  const refresh = () => {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const body = JSON.stringify(await produce());
        const entry = new Response(body, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, max-age=${opts.keepFor}`,
            "X-Fetched-At": String(Date.now()),
          },
        });
        await cache.put(cacheKey, entry);
        return body;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${opts.browserMaxAge}`,
  };
  const hit = await cache.match(cacheKey);
  if (hit) {
    const age = (Date.now() - Number(hit.headers.get("X-Fetched-At") ?? 0)) / 1000;
    if (age > opts.freshFor) ctx.waitUntil(refresh().catch((e) => console.error("background refresh failed", e)));
    return new Response(hit.body, { headers });
  }
  return new Response(await refresh(), { headers });
}

/** Small per-isolate memo for values that are cheap to keep in memory. */
export class Memo<V> {
  private map = new Map<string, { value: V; at: number }>();
  constructor(
    private ttlMs: number,
    private maxEntries: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit || Date.now() - hit.at > this.ttlMs) return undefined;
    return hit.value;
  }

  set(key: string, value: V) {
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { value, at: Date.now() });
  }
}
