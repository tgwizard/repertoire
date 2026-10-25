// The API as tests see it: the real handler and queries on the local dataset
// (.cache/build/repertoire.sqlite), or a running site when DATA_URL is set.
//
//   npm run test:data                                         local dataset
//   DATA_URL=https://repertoire.tgwizard.com npm run test:data   the live site

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DATASET_PATH } from "../crawler/build.ts";
import { handleApi } from "../worker/api.ts";
import { sqliteDb } from "./d1.ts";

export const REMOTE = process.env.DATA_URL?.replace(/\/$/, "");

let local: ReturnType<typeof sqliteDb> | null = null;

export async function request(path: string): Promise<Response> {
  if (REMOTE) return fetch(`${REMOTE}${path}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  if (!existsSync(DATASET_PATH)) throw new Error(`No dataset at ${DATASET_PATH}: run npm run index or npm run data:pull`);
  local ??= sqliteDb(DATASET_PATH);
  return handleApi(new Request(`http://local${path}`), local);
}

export async function api<T>(path: string): Promise<T> {
  const res = await request(path);
  assert.equal(res.status, 200, `${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const where = REMOTE ?? DATASET_PATH;
