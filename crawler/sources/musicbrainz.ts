// MusicBrainz: number of recordings per work (core data, CC0). 1 request/second, so
// each run spends a limited budget, most notable works first; results are kept for
// 45–75 days (staggered per work) and accumulate across runs.

import { cached, fetchJson, jitteredMaxAge, progress, readStage, writeStage } from "../http.ts";
import type { StageReport } from "../stages.ts";
import type { WikidataStage } from "./wikidata.ts";

export interface MusicBrainzStage {
  fetchedAt: number;
  recordings: Record<string, { count: number; at: number }>;
}

export async function crawlMusicBrainz(opts: { budget: number }): Promise<StageReport> {
  const wd = await readStage<WikidataStage>("wikidata");
  const stage = (await readStage<MusicBrainzStage>("musicbrainz")) ?? { fetchedAt: Date.now(), recordings: {} };
  const works = Object.values(wd?.works ?? {})
    .filter((w) => w.musicbrainz)
    .sort((a, b) => b.sitelinks - a.sitelinks);
  const todo = works.filter((w) => {
    const r = stage.recordings[w.musicbrainz!];
    return !r || Date.now() - r.at > jitteredMaxAge(w.musicbrainz!, 45, 75);
  });
  const batch = todo.slice(0, opts.budget);
  console.log(`MusicBrainz: ${works.length} works with MusicBrainz ids, ${todo.length} need counts, fetching ${batch.length} this run`);
  const tick = progress("MusicBrainz", batch.length);
  let failed = 0;
  for (const [i, w] of batch.entries()) {
    const mbid = w.musicbrainz!;
    try {
      const res = await cached(`musicbrainz:recordings:v1:${mbid}`, jitteredMaxAge(mbid, 45, 75), () =>
        fetchJson<{ "recording-count": number }>(`https://musicbrainz.org/ws/2/recording?work=${mbid}&limit=1&fmt=json`),
      );
      stage.recordings[mbid] = { count: res.value["recording-count"], at: res.fetchedAt };
    } catch (e) {
      failed++;
      console.warn(`  ✗ ${mbid}: ${(e as Error).message}`);
      if (failed >= 10 && failed > i / 2) {
        console.warn("  MusicBrainz looks unavailable; stopping this stage (counts so far are kept)");
        break;
      }
    }
    if (i % 100 === 99) await writeStage("musicbrainz", stage); // checkpoint
    tick(i + 1, `${failed} failed`);
  }
  stage.fetchedAt = Date.now();
  await writeStage("musicbrainz", stage);
  return { failed, of: batch.length };
}
