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
import { collectGarbage, readStage, takeStaleUses } from "./http.ts";
import { recordStage, type StageReport } from "./stages.ts";
import { crawlComposerEras, crawlImslp, type ImslpStage } from "./sources/imslp.ts";
import { crawlImslpPages } from "./sources/imslp-pages.ts";
import { crawlMusicBrainz } from "./sources/musicbrainz.ts";
import { crawlGnd } from "./sources/gnd.ts";
import { crawlLibris } from "./sources/libris.ts";
import { crawlRism } from "./sources/rism.ts";
import { crawlMutopia } from "./sources/mutopia.ts";
import { crawlOpenOpus } from "./sources/openopus.ts";
import { crawlWikidata, type WikidataStage } from "./sources/wikidata.ts";
import { crawlWikipedia } from "./sources/wikipedia.ts";

const STAGES = ["imslp", "imslp-pages", "wikipedia", "wikidata", "openopus", "composers", "musicbrainz", "mutopia", "libris", "gnd", "rism", "build"] as const;
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
const failures: string[] = [];
for (const stage of STAGES) {
  if (!stages.includes(stage)) continue;
  const t = Date.now();
  const at = new Date();
  takeStaleUses();
  try {
    let report: StageReport | void = undefined;
    if (stage === "imslp") report = await crawlImslp({ minWorks: Number(values["min-works"]) });
    if (stage === "imslp-pages") report = await crawlImslpPages();
    if (stage === "wikipedia") await crawlWikipedia();
    if (stage === "wikidata") await crawlWikidata();
    if (stage === "openopus") await crawlOpenOpus();
    if (stage === "composers") await crawlComposerEras(await composerNames());
    if (stage === "musicbrainz") report = await crawlMusicBrainz({ budget: Number(values["mb-budget"]) });
    if (stage === "mutopia") await crawlMutopia();
    if (stage === "libris") await crawlLibris();
    if (stage === "gnd") await crawlGnd();
    if (stage === "rism") await crawlRism();
    if (stage === "build") {
      const { meta } = await buildDataset();
      await writeExports(DATASET_PATH, meta);
    }
    if (stage !== "build") {
      // A partial IMSLP run (--min-works) isn't a whole catalogue
      if (stage === "imslp" && Number(values["min-works"]) > 1) report = { ...report, partial: true };
      const status = await recordStage(stage, { report, stale: takeStaleUses() }, at);
      const notes = [status.failed && `${status.failed}${status.of ? ` of ${status.of}` : ""} failed, earlier results kept`, status.stale && `${status.stale} stale cache entries used`].filter(Boolean);
      if (notes.length) console.log(`  ⚠ ${notes.join("; ")}`);
    }
    const ns = gcNamespaces[stage];
    if (ns) completed.push(ns);
    console.log(`✓ ${stage} (${Math.round((Date.now() - t) / 1000)}s)\n`);
  } catch (e) {
    // A failed source stage keeps its last completed output, which the build uses; the
    // manifest says it's out of date, and the run fails, so nothing publishes it as fresh.
    console.error(`✗ stage ${stage} failed: ${(e as Error).stack ?? e}`);
    if (stage !== "build") await recordStage(stage, { error: e, stale: takeStaleUses() }, at);
    failures.push(stage);
    console.log(`✗ ${stage} (${Math.round((Date.now() - t) / 1000)}s)\n`);
  }
}
if (completed.length) {
  const gc = await collectGarbage(completed);
  if (gc.files) console.log(`Cache cleanup (${completed.join(", ")}): removed ${gc.files} unused entries, ${(gc.bytes / 1024 / 1024).toFixed(1)} MiB`);
}
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
if (failures.length) {
  console.error(`Failed: ${failures.join(", ")}. Their last completed results were used; see .cache/stages/manifest.json`);
  process.exitCode = 1;
}
