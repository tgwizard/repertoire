// Crawler CLI. Every HTTP response is cached under .cache/, so a run can be
// interrupted and resumed, and re-runs only fetch what changed or expired.
//
//   node crawler/main.ts                     all stages, then build the dataset
//   node crawler/main.ts imslp build         just these stages
//   node crawler/main.ts --min-works 20      skip tiny IMSLP categories (quicker first run)
//   node crawler/main.ts --mb-budget 300     MusicBrainz lookups this run (1/second)

import { parseArgs } from "node:util";
import { buildDataset, DATASET_PATH } from "./build.ts";
import { writeExports } from "./export.ts";
import { collectGarbage, readStage } from "./http.ts";
import { crawlComposerEras, crawlImslp, type ImslpStage } from "./sources/imslp.ts";
import { crawlMusicBrainz } from "./sources/musicbrainz.ts";
import { crawlGnd } from "./sources/gnd.ts";
import { crawlLibris } from "./sources/libris.ts";
import { crawlRism } from "./sources/rism.ts";
import { crawlMutopia } from "./sources/mutopia.ts";
import { crawlOpenOpus } from "./sources/openopus.ts";
import { crawlWikidata, type WikidataStage } from "./sources/wikidata.ts";
import { crawlWikipedia } from "./sources/wikipedia.ts";

const STAGES = ["imslp", "wikipedia", "wikidata", "openopus", "composers", "musicbrainz", "mutopia", "libris", "gnd", "rism", "build"] as const;
type Stage = (typeof STAGES)[number];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "min-works": { type: "string", default: "1" },
    "mb-budget": { type: "string", default: "600" },
  },
});

const unknown = positionals.filter((p) => !(STAGES as readonly string[]).includes(p));
if (unknown.length) {
  console.error(`Unknown stage(s): ${unknown.join(", ")}. Stages: ${STAGES.join(", ")}`);
  process.exit(2);
}
const stages: Stage[] = positionals.length ? (positionals as Stage[]) : [...STAGES];

async function composerNames(): Promise<string[]> {
  const imslp = await readStage<ImslpStage>("imslp");
  const wd = await readStage<WikidataStage>("wikidata");
  const names = new Set<string>();
  for (const w of Object.values(imslp?.works ?? {})) {
    const m = /\(([^()]+)\)$/.exec(w.title);
    if (m) names.add(m[1]!);
  }
  // Only composers that appear on works we index; not all 18k people on Wikidata.
  const used = new Set(Object.values(wd?.works ?? {}).map((w) => w.composer));
  for (const c of Object.values(wd?.composers ?? {})) if (c.imslp && used.has(c.qid)) names.add(c.imslp);
  return [...names].sort();
}

// Cache namespaces that can be cleaned up after their stage completes. Not MusicBrainz
// (its counts live in the stage file) and not a partial IMSLP run (--min-works).
const gcNamespaces: Partial<Record<Stage, string>> = {
  imslp: Number(values["min-works"]) <= 1 ? "imslp" : undefined,
  wikipedia: "wikipedia",
  wikidata: "wikidata",
  openopus: "openopus",
  mutopia: "mutopia",
  libris: "libris",
  gnd: "gnd",
};
const completed: string[] = [];

const started = Date.now();
for (const stage of STAGES) {
  if (!stages.includes(stage)) continue;
  const t = Date.now();
  try {
    if (stage === "imslp") await crawlImslp({ minWorks: Number(values["min-works"]) });
    if (stage === "wikipedia") await crawlWikipedia();
    if (stage === "wikidata") await crawlWikidata();
    if (stage === "openopus") await crawlOpenOpus();
    if (stage === "composers") await crawlComposerEras(await composerNames());
    if (stage === "musicbrainz") await crawlMusicBrainz({ budget: Number(values["mb-budget"]) });
    if (stage === "mutopia") await crawlMutopia();
    if (stage === "libris") await crawlLibris();
    if (stage === "gnd") await crawlGnd();
    if (stage === "rism") await crawlRism();
    if (stage === "build") {
      const { meta } = await buildDataset();
      await writeExports(DATASET_PATH, meta);
    }
    const ns = gcNamespaces[stage];
    if (ns) completed.push(ns);
  } catch (e) {
    // A failed source stage keeps its previous output; the build uses whatever is there.
    console.error(`✗ stage ${stage} failed: ${(e as Error).stack ?? e}`);
    if (stage === "build") process.exitCode = 1;
  }
  console.log(`✓ ${stage} (${Math.round((Date.now() - t) / 1000)}s)\n`);
}
if (completed.length) {
  const gc = await collectGarbage(completed);
  if (gc.files) console.log(`Cache cleanup (${completed.join(", ")}): removed ${gc.files} unused entries, ${(gc.bytes / 1024 / 1024).toFixed(1)} MiB`);
}
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
