// The Worker: the JSON API (/api/…) and server-rendered work and composer pages,
// both from the dataset in D1. Everything else is the app's static assets.
//
// Responses are cached at the edge per dataset version and deploy, so a new
// dataset or app version never serves stale data and needs no cache purge.

import { datasetVersion, handleApi } from "./api.ts";
import { renderPage } from "./pages.ts";

declare const __BUILD_ID__: string;
declare const __DEV_SERVER__: boolean;

const BROWSER_TTL = 300; // seconds
const EDGE_TTL = 7 * 24 * 3600;

async function cached(request: Request, env: Env, ctx: ExecutionContext, produce: () => Promise<Response>): Promise<Response> {
  if (request.method !== "GET") return produce();
  if (__DEV_SERVER__) {
    const res = await produce();
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "no-store");
    return out;
  }
  const key = new URL(request.url);
  key.searchParams.set("__v", `${await datasetVersion(env.DB)}-${__BUILD_ID__}`);
  const cache = caches.default;
  // The edge keeps responses for a week (the key changes with each dataset and deploy);
  // browsers for minutes.
  const forBrowser = (res: Response) => {
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", `public, max-age=${BROWSER_TTL}`);
    return out;
  };
  const hit = await cache.match(key.toString());
  if (hit) return forBrowser(hit);

  const res = await produce();
  if (![200, 301, 404, 410].includes(res.status)) return res;
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", `public, max-age=${EDGE_TTL}`);
  ctx.waitUntil(cache.put(key.toString(), new Response(res.clone().body, { status: res.status, headers })));
  return forBrowser(res);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Read-only: any read replica will do, so queries go to the nearest one.
    const db = () => env.DB.withSession("first-unconstrained");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return cached(request, env, ctx, () => handleApi(request, db()));
    }
    if (url.pathname.startsWith("/work/") || url.pathname.startsWith("/composer/")) {
      return cached(request, env, ctx, async () => {
        const page = await renderPage(request, db(), () => env.ASSETS.fetch(new Request(new URL("/", url))));
        return page ?? env.ASSETS.fetch(request);
      });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
