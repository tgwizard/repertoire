import { useCallback, useEffect, useRef, useState } from "react";
import type { Era, Work } from "../shared/api";
import { getComposerEras, getWorksPage } from "./api";
import { getComposerInfo, type ComposerInfo } from "./wikidata";

export interface Source {
  name: string;
  count: number;
  arr: boolean;
}

export interface LoadedWork extends Work {
  arr: boolean;
}

interface State {
  works: LoadedWork[];
  eras: Record<string, Era | null>;
  info: Record<string, ComposerInfo>;
  loading: boolean;
  /** More pages exist but we stopped at the auto-load limit. */
  paused: boolean;
  error: string | null;
}

const EMPTY: State = { works: [], eras: {}, info: {}, loading: false, paused: false, error: null };

/** Works loaded automatically before asking the user to load the rest. */
export const AUTO_LOAD_LIMIT = 2000;

interface Run {
  sources: Source[];
  signal: AbortSignal;
  sourceIdx: number;
  from: string | null;
  fetched: number;
  seen: Set<number>;
  askedComposers: Set<string>;
  lookups: Promise<void>;
}

/**
 * Loads works for the given categories page by page (originals before
 * arrangements), then looks up composer eras (IMSLP) and dates (Wikidata).
 */
export function useWorks(sources: Source[]) {
  const [state, setState] = useState<State>(EMPTY);
  const run = useRef<Run | null>(null);
  const sourcesKey = sources.map((s) => s.name).join("\n");
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  const lookupComposers = useCallback((r: Run, works: Work[]) => {
    const names = [...new Set(works.map((w) => w.composer).filter((c): c is string => !!c && !r.askedComposers.has(c)))];
    if (!names.length) return;
    names.forEach((n) => r.askedComposers.add(n));
    // Chained, so we never have more than one lookup in flight per service.
    r.lookups = r.lookups
      .then(async () => {
        const [eras, info] = await Promise.all([
          getComposerEras(names, r.signal),
          getComposerInfo(names, r.signal).catch((e) => {
            if (!r.signal.aborted) console.warn("Wikidata lookup failed", e);
            return {};
          }),
        ]);
        if (!r.signal.aborted) setState((s) => ({ ...s, eras: { ...s.eras, ...eras }, info: { ...s.info, ...info } }));
      })
      .catch((e) => {
        if (!r.signal.aborted) console.warn("Composer lookup failed", e);
      });
  }, []);

  const pump = useCallback(
    async (r: Run, limit: number) => {
      setState((s) => ({ ...s, loading: true, paused: false, error: null }));
      try {
        while (r.sourceIdx < r.sources.length) {
          if (r.fetched >= limit) {
            setState((s) => ({ ...s, loading: false, paused: true }));
            return;
          }
          const src = r.sources[r.sourceIdx]!;
          const page = await getWorksPage(src.name, r.from, r.signal);
          if (r.signal.aborted) return;
          const fresh = page.works.filter((w) => !r.seen.has(w.pageid)).map((w) => ({ ...w, arr: src.arr }));
          fresh.forEach((w) => r.seen.add(w.pageid));
          r.fetched += page.works.length;
          r.from = page.next;
          if (!r.from) r.sourceIdx++;
          setState((s) => ({ ...s, works: s.works.concat(fresh) }));
          lookupComposers(r, fresh);
        }
        setState((s) => ({ ...s, loading: false }));
      } catch (e) {
        if (!r.signal.aborted) setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    },
    [lookupComposers],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const r: Run = {
      sources: sourcesRef.current,
      signal: ctrl.signal,
      sourceIdx: 0,
      from: null,
      fetched: 0,
      seen: new Set(),
      askedComposers: new Set(),
      lookups: Promise.resolve(),
    };
    run.current = r;
    setState(EMPTY);
    if (r.sources.length) void pump(r, AUTO_LOAD_LIMIT);
    return () => ctrl.abort();
  }, [sourcesKey, pump]);

  const loadAll = useCallback(() => {
    if (run.current) void pump(run.current, Infinity);
  }, [pump]);

  const retry = useCallback(() => {
    if (run.current) void pump(run.current, AUTO_LOAD_LIMIT + run.current.fetched);
  }, [pump]);

  return { ...state, loadAll, retry };
}
