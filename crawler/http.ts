// Polite, resilient HTTP for the crawler:
// - one request at a time per host, with a minimum gap between requests
// - retries with exponential backoff (honouring Retry-After) on 429, 5xx and network errors
// - an on-disk cache, so an interrupted crawl resumes where it stopped

import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const CACHE_DIR = join(import.meta.dirname, "..", ".cache");
export const USER_AGENT =
  "RepertoireCrawler/0.1 (+https://github.com/tgwizard/repertoire; builds the index for https://repertoire.tgwizard.com)";

const MIN_GAP_MS: Record<string, number> = {
  "imslp.org": 250,
  "query.wikidata.org": 1000,
  "en.wikipedia.org": 100,
  "musicbrainz.org": 1100, // their documented limit is 1 request/second
  "api.openopus.org": 1000,
  "www.mutopiaproject.org": 1000,
  "libris.kb.se": 1000,
  "data.dnb.de": 1000,
};
const MAX_ATTEMPTS = 6;

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const queues = new Map<string, { tail: Promise<unknown>; last: number }>();

/** Runs fn after all earlier calls for the same host, spaced by the host's minimum gap. */
function onHostQueue<T>(host: string, fn: () => Promise<T>): Promise<T> {
  let q = queues.get(host);
  if (!q) queues.set(host, (q = { tail: Promise.resolve(), last: 0 }));
  const gap = MIN_GAP_MS[host] ?? 500;
  const queue = q;
  const run = queue.tail.then(async () => {
    const wait = queue.last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      queue.last = Date.now();
    }
  });
  queue.tail = run.catch(() => {});
  return run;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchOptions {
  form?: Record<string, string>;
  accept?: string;
}

export const fetchJson = <T>(url: string, opts: FetchOptions = {}) => fetchWith(url, opts, (res) => res.json() as Promise<T>);
export const fetchText = (url: string, opts: FetchOptions = {}) => fetchWith(url, { accept: "*/*", ...opts }, (res) => res.text());

async function fetchWith<T>(url: string, opts: FetchOptions, read: (res: Response) => Promise<T>): Promise<T> {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    let retryAfterMs: number | null = null;
    try {
      return await onHostQueue(host, async () => {
        const res = await fetch(url, {
          method: opts.form ? "POST" : "GET",
          body: opts.form ? new URLSearchParams(opts.form) : undefined,
          headers: { "User-Agent": USER_AGENT, Accept: opts.accept ?? "application/json" },
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const ra = Number(res.headers.get("retry-after"));
          if (ra > 0) retryAfterMs = Math.min(ra * 1000, 10 * 60_000);
          throw new HttpError(`${res.status} ${res.statusText} for ${url.slice(0, 160)}`, res.status);
        }
        return await read(res);
      });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw e;
      const backoff = retryAfterMs ?? Math.min(2 ** attempt * 1000, 120_000) * (0.75 + Math.random() / 2);
      console.warn(`  ↻ ${host}: ${(e as Error).message.slice(0, 120)}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
    }
  }
}

// ---- Disk cache -------------------------------------------------------------

interface Entry<T> {
  key: string;
  fetchedAt: number;
  value: T;
}

const cachePath = (key: string) => {
  const h = createHash("sha1").update(key).digest("hex");
  return join(CACHE_DIR, "http", h.slice(0, 2), `${h}.json`);
};

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export interface CachedResult<T> {
  value: T;
  fetchedAt: number;
  fromCache: boolean;
}

/**
 * A cache lifetime between minDays and maxDays, fixed per key. Spreads expiry out,
 * so entries fetched on the same day don't all expire on the same later day.
 */
export function jitteredMaxAge(key: string, minDays: number, maxDays: number): number {
  const n = createHash("sha1").update(key).digest().readUInt32BE(0);
  return (minDays + (n % (maxDays - minDays + 1))) * DAY;
}

/** Cache files used by this run, for collectGarbage. */
const touched = new Set<string>();

/**
 * Returns the cached value for key if younger than maxAgeMs, otherwise produces
 * and stores a fresh one. If producing fails and a stale value exists, the stale
 * value is used, so one flaky upstream doesn't sink a whole build.
 */
export async function cached<T>(key: string, maxAgeMs: number, produce: () => Promise<T>): Promise<CachedResult<T>> {
  const path = cachePath(key);
  touched.add(path);
  const hit = await readJson<Entry<T>>(path);
  if (hit && hit.key === key && Date.now() - hit.fetchedAt < maxAgeMs) {
    return { value: hit.value, fetchedAt: hit.fetchedAt, fromCache: true };
  }
  try {
    const value = await produce();
    const entry: Entry<T> = { key, fetchedAt: Date.now(), value };
    await writeJsonAtomic(path, entry);
    return { value, fetchedAt: entry.fetchedAt, fromCache: false };
  } catch (e) {
    if (hit && hit.key === key) {
      console.warn(`  ⚠ using stale cache for ${key.slice(0, 100)}: ${(e as Error).message}`);
      return { value: hit.value, fetchedAt: hit.fetchedAt, fromCache: true };
    }
    throw e;
  }
}

/**
 * Deletes cache entries this run didn't use, for the given key namespaces (the part
 * before the first ":", e.g. "imslp"). Only pass namespaces whose stage ran in full,
 * or entries that are still valid would be removed.
 */
export async function collectGarbage(namespaces: string[]): Promise<{ files: number; bytes: number }> {
  const removed = { files: 0, bytes: 0 };
  const dir = join(CACHE_DIR, "http");
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const path = join(e.parentPath, e.name);
    if (touched.has(path)) continue;
    // Entries start with {"key":"<namespace>:…; read just enough to find the namespace.
    const fh = await open(path, "r");
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(64), 0, 64, 0);
    const { size } = await fh.stat();
    await fh.close();
    const ns = /^\{"key":"([a-z]+):/.exec(buffer.toString("utf8", 0, bytesRead))?.[1];
    if (ns && namespaces.includes(ns)) {
      await unlink(path);
      removed.files++;
      removed.bytes += size;
    }
  }
  return removed;
}

// ---- Stage outputs ---------------------------------------------------------

export const stagePath = (name: string) => join(CACHE_DIR, "stages", `${name}.json`);
export const readStage = <T>(name: string) => readJson<T>(stagePath(name));
export const writeStage = (name: string, value: unknown) => writeJsonAtomic(stagePath(name), value);

export const DAY = 24 * 3600 * 1000;

/** Prints progress at most every few seconds, with an ETA from the last couple of minutes' rate. */
export function progress(label: string, total: number) {
  let lastPrint = 0;
  const samples: [time: number, done: number][] = [[Date.now(), 0]];
  return (done: number, extra = "") => {
    const now = Date.now();
    if (done < total && now - lastPrint < 5000) return;
    lastPrint = now;
    samples.push([now, done]);
    while (samples.length > 2 && now - samples[1]![0] > 120_000) samples.shift();
    const [t0, d0] = samples[0]!;
    const rate = (done - d0) / Math.max(1, (now - t0) / 1000);
    const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
    const etaStr = done < total ? ` · ETA ${eta > 90 ? `${Math.round(eta / 60)}m` : `${eta}s`}` : "";
    console.log(`  ${label}: ${done}/${total}${etaStr}${extra ? ` · ${extra}` : ""}`);
  };
}
