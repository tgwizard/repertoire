import {
  MAX_COMPOSERS_PER_REQUEST,
  type ComposersResponse,
  type Era,
  type InstrumentationsResponse,
  type WorksResponse,
} from "../shared/api";

async function getJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function getInstrumentations(): Promise<InstrumentationsResponse> {
  return getJson("/api/instrumentations");
}

export function getWorksPage(cat: string, from: string | null, signal?: AbortSignal): Promise<WorksResponse> {
  const params = new URLSearchParams({ cat });
  if (from) params.set("from", from);
  return getJson(`/api/works?${params}`, { signal });
}

const eraCache = new Map<string, Era | null>();

export async function getComposerEras(names: string[], signal?: AbortSignal): Promise<Record<string, Era | null>> {
  const out: Record<string, Era | null> = {};
  const missing: string[] = [];
  for (const n of names) {
    if (eraCache.has(n)) out[n] = eraCache.get(n)!;
    else missing.push(n);
  }
  for (let i = 0; i < missing.length; i += MAX_COMPOSERS_PER_REQUEST) {
    const res = await getJson<ComposersResponse>("/api/composers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: missing.slice(i, i + MAX_COMPOSERS_PER_REQUEST) }),
      signal,
    });
    for (const [n, era] of Object.entries(res.eras)) {
      eraCache.set(n, era);
      out[n] = era;
    }
  }
  return out;
}

export function imslpUrl(title: string): string {
  return `https://imslp.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}
