// Open Opus: curated works by major composers, with "popular"/"recommended" flags (CC0).

import { createHash } from "node:crypto";
import { cached, DAY, fetchJson, writeStage } from "../http.ts";

export interface OoWork {
  /** The dump has no ids: a stable hash of composer and title */
  id: string;
  title: string;
  genre: string;
  popular: boolean;
  recommended: boolean;
}

export interface OoComposer {
  name: string;
  completeName: string;
  epoch: string;
  born: number | null;
  died: number | null;
  popular: boolean;
  works: OoWork[];
}

export interface OpenOpusStage {
  fetchedAt: number;
  composers: OoComposer[];
}

const yearOf = (d: string | null | undefined) => (d ? Number(d.slice(0, 4)) || null : null);
const workId = (composer: string, title: string) => createHash("sha1").update(`${composer}|${title}`).digest("hex").slice(0, 12);

export async function crawlOpenOpus(): Promise<void> {
  console.log("Open Opus: work dump");
  const res = await cached("openopus:dump:v1", 7 * DAY, () => fetchJson<any>("https://api.openopus.org/work/dump.json"));
  const composers: OoComposer[] = (res.value.composers ?? []).map((c: any) => ({
    name: c.name,
    completeName: c.complete_name,
    epoch: c.epoch,
    born: yearOf(c.birth),
    died: yearOf(c.death),
    popular: c.popular === "1",
    works: (c.works ?? []).map((w: any) => ({
      id: workId(c.complete_name, w.subtitle ? `${w.title} ${w.subtitle}` : w.title),
      title: w.subtitle ? `${w.title} ${w.subtitle}` : w.title,
      genre: w.genre,
      popular: w.popular === "1",
      recommended: w.recommended === "1",
    })),
  }));
  console.log(`  ${composers.length} composers, ${composers.reduce((s, c) => s + c.works.length, 0)} works`);
  await writeStage("openopus", { fetchedAt: res.fetchedAt, composers } satisfies OpenOpusStage);
}
