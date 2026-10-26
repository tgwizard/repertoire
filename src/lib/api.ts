// Fetching from the Worker's API (/api/…), with an in-memory cache, plus helpers
// for links between the app's pages.

import { useEffect, useState } from "react";
import type { ComposerDetail, LineupsIndex, Meta, SearchResults, WorkDetail, WorksPage } from "../shared/data";

const cache = new Map<string, Promise<unknown>>();

declare const __BUILD_ID__: string;

/**
 * The app's build id goes with each request: browsers keep API responses for minutes,
 * and a response cached for the last deploy's code may lack what this code expects.
 */
const versioned = (path: string) => `${path}${path.includes("?") ? "&" : "?"}v=${__BUILD_ID__}`;

export function api<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(versioned(path)).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
      }
      return res.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(path, p);
  }
  return p;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Data the server rendered into the page (work and composer pages), used once. */
function takeInitial(path: string) {
  const el = document.getElementById("initial-data");
  if (!el) return;
  el.remove();
  try {
    const initial = JSON.parse(el.textContent ?? "null") as { type: string; id: string; data: unknown } | null;
    if (initial?.type === "work" && path === `/api/works/${initial.id}`) cache.set(path, Promise.resolve(initial.data));
    if (initial?.type === "composer" && path === `/api/composers/${initial.id}`) cache.set(path, Promise.resolve(initial.data));
  } catch {
    // Not worth failing over: the page fetches the data instead.
  }
}

export interface Loaded<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
}

/** The response for `path` (null skips loading). Keeps showing the last data while the next loads. */
export function useApi<T>(path: string | null): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { path: string | null }>({ data: null, error: null, loading: !!path, path: null });
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    takeInitial(path);
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path).then(
      (data) => !cancelled && setState({ data, error: null, loading: false, path }),
      (error: Error) => !cancelled && setState({ data: null, error, loading: false, path }),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  return { data: state.data, error: state.error, loading: state.loading };
}

export const metaPath = "/api/meta";
export const lineupsPath = "/api/lineups";
export const loadMeta = () => api<Meta>(metaPath);
export const loadLineups = () => api<LineupsIndex>(lineupsPath);
export type { ComposerDetail, SearchResults, WorkDetail, WorksPage };

export { composerPath, finderPath, lifespan, workPath } from "../shared/paths";
