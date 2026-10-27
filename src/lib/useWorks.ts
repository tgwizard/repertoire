import { useCallback, useEffect, useRef, useState } from "react";
import type { Facets, WorkSummary, WorksPage } from "../shared/data";
import { api } from "./api";

export const WORKS_PAGE = 50;
const PAGE = WORKS_PAGE;

interface State {
  works: WorkSummary[];
  total: number;
  facets: Facets | null;
  /** Orchestral works left out for want of a known scoring */
  unscored: number;
  loading: boolean;
  /** Loading only more of the same list ("Load more"), not a new one */
  more: boolean;
  error: string | null;
}

/**
 * Pages of /api/works (or /api/search) for a query without offset/limit. Facets come
 * with the first page. "Load more" appends the next page; a new query starts over,
 * keeping the old list on screen until the new one arrives.
 */
export function useWorks(query: string | null, endpoint = "/api/works") {
  const [state, setState] = useState<State>({ works: [], total: 0, facets: null, unscored: 0, loading: !!query, more: false, error: null });
  const [pages, setPages] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const current = useRef(query);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    current.current = query;
    setPages(1);
  }, [query]);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, more: loaded.current === query, error: null }));
    const offsets = Array.from({ length: pages }, (_, i) => i * PAGE);
    Promise.all(offsets.map((o) => api<WorksPage>(`${endpoint}?${query}&limit=${PAGE}&offset=${o}${o === 0 ? "&facets=1" : ""}`))).then(
      (results) => {
        if (cancelled || current.current !== query) return;
        loaded.current = query;
        setState({
          works: results.flatMap((r) => r.works),
          total: results[0]!.total,
          facets: results[0]!.facets ?? null,
          unscored: results[0]!.unscored ?? 0,
          loading: false,
          more: false,
          error: null,
        });
      },
      (e: Error) => !cancelled && setState((s) => ({ ...s, loading: false, more: false, error: e.message })),
    );
    return () => {
      cancelled = true;
    };
  }, [query, pages, endpoint, attempt]);

  const loadMore = useCallback(() => setPages((p) => p + 1), []);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, hasMore: !state.error && state.works.length < state.total, loadMore, retry };
}
