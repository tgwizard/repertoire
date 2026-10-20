import { useCallback, useEffect, useRef, useState } from "react";
import type { Composer, EnsembleShard, EnsemblesFile, MetaFile, ShardFile, SourceId, Work } from "../shared/data";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

export const loadEnsembles = () => getJson<EnsemblesFile>("/data/ensembles.json");
export const loadMeta = () => getJson<MetaFile>("/data/meta.json");

const shards = new Map<number, Promise<ShardFile>>();
function loadShard(n: number): Promise<ShardFile> {
  let p = shards.get(n);
  if (!p) {
    p = getJson<ShardFile>(`/data/shards/${n}.json`);
    p.catch(() => shards.delete(n));
    shards.set(n, p);
  }
  return p;
}

/** Works are loaded automatically up to this many; the rest on request. */
const AUTO_LOAD = 5000;

interface State {
  works: Work[];
  composers: Record<string, Composer>;
  sources: Partial<Record<SourceId, string[]>>;
  loading: boolean;
  /** Shards not loaded yet (only for very large line-ups) */
  remaining: number[];
  error: string | null;
}

const EMPTY: State = { works: [], composers: {}, sources: {}, loading: true, remaining: [], error: null };

/** Loads one line-up's works from its shards, which are in rank order. */
export function useEnsembleWorks(key: string, shardNos: number[]) {
  const [state, setState] = useState<State>(EMPTY);
  const [loadAll, setLoadAll] = useState(false);
  const shardKey = shardNos.join(",");
  // Works already shown, so loading the rest doesn't briefly shrink the list.
  const shown = useRef(0);

  useEffect(() => setLoadAll(false), [key]);

  useEffect(() => {
    let cancelled = false;
    if (!loadAll) shown.current = 0;
    setState((s) => (s.works.length && loadAll ? { ...s, loading: true } : EMPTY));
    (async () => {
      const works: Work[] = [];
      const composers: Record<string, Composer> = {};
      let sources: State["sources"] = {};
      for (const [i, n] of shardNos.entries()) {
        if (!loadAll && works.length >= AUTO_LOAD) {
          shown.current = works.length;
          if (!cancelled) setState({ works, composers, sources, loading: false, remaining: shardNos.slice(i), error: null });
          return;
        }
        const shard = await loadShard(n);
        const part: EnsembleShard | undefined = shard.ensembles[key];
        if (!part) continue;
        works.push(...part.works);
        Object.assign(composers, shard.composers);
        sources = part.sources ?? sources;
        if (!cancelled && works.length > shown.current) {
          shown.current = works.length;
          setState({ works: [...works], composers: { ...composers }, sources, loading: true, remaining: [], error: null });
        }
      }
      if (!cancelled) setState({ works, composers, sources, loading: false, remaining: [], error: null });
    })().catch((e: Error) => {
      if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message }));
    });
    return () => {
      cancelled = true;
    };
  }, [key, shardKey, loadAll]); // shardKey stands in for shardNos

  const requestAll = useCallback(() => setLoadAll(true), []);
  return { ...state, loadAll: requestAll };
}

// ---- Links -----------------------------------------------------------------

const wikiPath = (title: string) => encodeURIComponent(title.replaceAll(" ", "_"));
export const imslpUrl = (title: string) => `https://imslp.org/wiki/${wikiPath(title)}`;
export const imslpCategoryUrl = (name: string) => `https://imslp.org/wiki/Category:${wikiPath(name)}`;
export const wikipediaUrl = (title: string) => `https://en.wikipedia.org/wiki/${wikiPath(title)}`;
export const wikipediaCategoryUrl = (name: string) => `https://en.wikipedia.org/wiki/Category:${wikiPath(name)}`;
export const wikidataUrl = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;
export const musicbrainzUrl = (id: string) => `https://musicbrainz.org/work/${id}`;
