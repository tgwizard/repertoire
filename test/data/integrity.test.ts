// Integrity of the built dataset (.cache/build/repertoire.sqlite), checked in SQL:
// every row consistent with the others and with the rules that produced it.
// Run after each build, before publishing (npm run test:data).

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DATASET_PATH, PREVIOUS_PATH, readPrevious } from "../../crawler/build.ts";
import { SCHEMA_VERSION } from "../../crawler/db.ts";
import { ID_PATTERN } from "../../crawler/ids.ts";
import { describe, ensembleKey, parseEnsembleKey, playerCount } from "../../src/lib/instrumentation.ts";
import { ERAS, PROVIDERS, score, SIGNALS, type ProviderId, type Signal } from "../../src/shared/data.ts";

if (!existsSync(DATASET_PATH)) throw new Error(`No dataset at ${DATASET_PATH}: run npm run index or npm run data:pull`);
const db = new DatabaseSync(DATASET_PATH, { readOnly: true });
const all = (sql: string) => db.prepare(sql).all() as Record<string, any>[];
const one = (sql: string) => db.prepare(sql).get() as Record<string, any>;
const none = (sql: string, what: string) => {
  const rows = all(`${sql} LIMIT 5`);
  assert.equal(rows.length, 0, `${what}, e.g. ${JSON.stringify(rows)}`);
};
const meta = Object.fromEntries(all("SELECT key, value FROM meta").map((r) => [r.key, r.value]));

test("the database is sound and complete", () => {
  assert.equal(one("PRAGMA integrity_check").integrity_check, "ok");
  assert.equal(all("PRAGMA foreign_key_check").length, 0);
  assert.equal(Number(meta.schema_version), SCHEMA_VERSION);
  const n = (t: string) => one(`SELECT COUNT(*) AS n FROM ${t}`).n as number;
  assert.equal(Number(meta.works), n("works"));
  assert.equal(Number(meta.composers), n("composers"));
  assert.equal(Number(meta.lineups), n("lineups"));
  assert.ok(n("works") > 250_000, `only ${n("works")} works`);
  assert.ok(n("composers") > 25_000, `only ${n("composers")} composers`);
  assert.ok(n("lineups") > 8_000, `only ${n("lineups")} line-ups`);
  const core = one("SELECT COUNT(*) AS n FROM works WHERE score >= 6").n;
  assert.ok(core > 3_000 && core < 15_000, `${core} core works is implausible`);
  for (const s of all("SELECT * FROM sources")) assert.ok(s.items > 0 && s.fetched_at, `source ${s.id} is empty`);
});

test("every work is listed for at least one line-up, and its main one is its own", () => {
  none("SELECT w.id FROM works w WHERE NOT EXISTS (SELECT 1 FROM scorings s WHERE s.work_id = w.id)", "works without a line-up");
  none("SELECT w.id FROM works w WHERE w.lineups != (SELECT COUNT(*) FROM scorings s WHERE s.work_id = w.id)", "works.lineups wrong");
  none("SELECT w.id FROM works w LEFT JOIN scorings s ON s.work_id = w.id AND s.lineup = w.lineup WHERE s.work_id IS NULL", "main line-up not among its line-ups");
  none(
    `SELECT w.id FROM works w JOIN scorings s ON s.work_id = w.id AND s.lineup = w.lineup
     WHERE s.arrangement = 1 AND EXISTS (SELECT 1 FROM scorings o WHERE o.work_id = w.id AND o.arrangement = 0)`,
    "main line-up is an arrangement although the work has an original one",
  );
  none("SELECT s.work_id FROM scorings s JOIN works w ON w.id = s.work_id WHERE s.score != w.score", "scorings.score differs from the work's");
  none("SELECT s.work_id FROM scorings s JOIN lineups l ON l.key = s.lineup WHERE s.players != l.players", "scorings.players differs from the line-up's");
  none("SELECT work_id FROM scorings WHERE json_array_length(sources) = 0", "line-ups nobody vouches for");
});

test("line-ups: canonical keys, counts and descriptions that match", () => {
  const counted = new Map(all("SELECT lineup, SUM(arrangement = 0) AS o, SUM(arrangement = 1) AS a FROM scorings GROUP BY lineup").map((r) => [r.lineup, r]));
  for (const l of all("SELECT * FROM lineups")) {
    const e = parseEnsembleKey(l.key);
    assert.equal(ensembleKey(e), l.key, `non-canonical key ${l.key}`);
    assert.ok(!("player" in e), `aggregate line-up ${l.key}`); // IMSLP's "For 4 players"
    assert.equal(l.players, playerCount(e), l.key);
    assert.equal(l.description, describe(e), l.key);
    const c = counted.get(l.key);
    assert.deepEqual([l.original, l.arrangements], [c?.o ?? 0, c?.a ?? 0], `${l.key} counts`);
    assert.ok(l.original + l.arrangements > 0, `${l.key} has no works`);
    assert.ok(Object.keys(JSON.parse(l.sources)).length > 0, `${l.key} has no source`);
  }
});

test("works: ids, titles, years, eras, signals and scores as the rules say", () => {
  const composers = new Map(all("SELECT id, born, died, sitelinks, sort_name FROM composers").map((c) => [c.id, c]));
  const eras = new Set<string>(ERAS);
  const problems: string[] = [];
  for (const w of db.prepare("SELECT * FROM works").iterate() as Iterable<Record<string, any>>) {
    const c = w.composer_id ? composers.get(w.composer_id) : undefined;
    if (!ID_PATTERN.test(w.id)) problems.push(`${w.id}: bad id`);
    if (!w.title || w.title !== w.title.trim()) problems.push(`${w.id}: title ${JSON.stringify(w.title)}`);
    // IMSLP page titles end in "(Surname, Given)"; that belongs in composer, not title.
    if (c && w.title.endsWith(`(${c.sort_name})`)) problems.push(`${w.id}: composer left in title ${w.title}`);
    if (w.era !== null && !eras.has(w.era)) problems.push(`${w.id}: era ${w.era}`);
    if (w.year !== null && (w.year < 800 || w.year > new Date().getFullYear() || (c?.born && w.year < c.born + 5) || (c?.died && w.year > c.died + 30)))
      problems.push(`${w.id}: year ${w.year} for a composer ${c?.born}–${c?.died}`);
    const signals = JSON.parse(w.signals) as Signal[];
    if (signals.some((s) => !(s in SIGNALS))) problems.push(`${w.id}: signals ${w.signals}`);
    const expected = score({ signals, recordings: w.recordings, sitelinks: w.sitelinks, composerSitelinks: c?.sitelinks });
    if (Math.abs(expected - w.score) > 0.001) problems.push(`${w.id}: score ${w.score}, expected ${expected}`);
    const aliases = JSON.parse(w.aliases) as string[];
    if (aliases.includes(w.title)) problems.push(`${w.id}: alias repeats the title`);
    if (problems.length >= 10) break;
  }
  assert.deepEqual(problems, []);
});

test("composers: every one has works, and counts match", () => {
  none("SELECT c.id FROM composers c WHERE c.works != (SELECT COUNT(*) FROM works w WHERE w.composer_id = c.id)", "composers.works wrong");
  none("SELECT id FROM composers WHERE works = 0", "composers without works");
  none("SELECT id FROM composers WHERE died < born + 10 OR died - born > 105", "impossible lifespans");
  none("SELECT id FROM composers WHERE trim(name) = '' OR name != trim(name)", "blank or untrimmed names");
  for (const c of all("SELECT id FROM composers")) assert.match(c.id, ID_PATTERN);
});

test("links: one record per provider id, well-formed, of the provider's kind", () => {
  none("SELECT w.id FROM works w WHERE w.free = 1 AND NOT EXISTS (SELECT 1 FROM links l WHERE l.entity = 'work' AND l.entity_id = w.id AND l.kind = 'score')", "free works without a score link");
  none("SELECT w.id FROM works w WHERE w.free = 0 AND EXISTS (SELECT 1 FROM links l WHERE l.entity = 'work' AND l.entity_id = w.id AND l.kind = 'score')", "score links on works not marked free");
  none("SELECT l.entity_id FROM links l WHERE l.entity = 'work' AND NOT EXISTS (SELECT 1 FROM works w WHERE w.id = l.entity_id)", "links to missing works");
  none("SELECT l.entity_id FROM links l WHERE l.entity = 'composer' AND NOT EXISTS (SELECT 1 FROM composers c WHERE c.id = l.entity_id)", "links to missing composers");
  const hosts: Record<ProviderId, RegExp> = {
    imslp: /^https:\/\/imslp\.org\/wiki\/\S+$/,
    wikipedia: /^https:\/\/en\.wikipedia\.org\/wiki\/\S+$/,
    wikidata: /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/,
    musicbrainz: /^https:\/\/musicbrainz\.org\/work\/[0-9a-f-]{36}$/,
    openopus: /^$/,
  };
  for (const l of all("SELECT provider, kind, url, COUNT(*) AS n FROM links GROUP BY provider, kind, url IS NULL")) {
    assert.ok(l.provider in PROVIDERS, `unknown provider ${l.provider}`);
    assert.equal(l.kind, PROVIDERS[l.provider as ProviderId].kind, `${l.provider} links of kind ${l.kind}`);
  }
  for (const l of all("SELECT provider, url FROM links WHERE url IS NOT NULL")) assert.match(l.url, hosts[l.provider as ProviderId], l.provider);
  none("SELECT entity_id FROM links WHERE provider = 'openopus' AND url IS NOT NULL", "Open Opus links with URLs");
});

test("redirects point at live ids, directly", () => {
  none("SELECT old_id FROM redirects r WHERE entity = 'work' AND NOT EXISTS (SELECT 1 FROM works w WHERE w.id = r.new_id)", "work redirects to missing works");
  none("SELECT old_id FROM redirects r WHERE entity = 'composer' AND NOT EXISTS (SELECT 1 FROM composers c WHERE c.id = r.new_id)", "composer redirects to missing composers");
  none("SELECT old_id FROM redirects r WHERE EXISTS (SELECT 1 FROM works w WHERE w.id = r.old_id) OR EXISTS (SELECT 1 FROM composers c WHERE c.id = r.old_id)", "redirects from live ids");
  none("SELECT a.old_id FROM redirects a JOIN redirects b ON b.entity = a.entity AND b.old_id = a.new_id", "redirect chains");
});

test("search index covers every work and composer", () => {
  assert.equal(one("SELECT COUNT(*) AS n FROM works_fts").n, one("SELECT COUNT(*) AS n FROM works").n);
  assert.equal(one("SELECT COUNT(*) AS n FROM composers_fts").n, one("SELECT COUNT(*) AS n FROM composers").n);
  none("SELECT f.rowid FROM works_fts f LEFT JOIN works w ON w.n = f.rowid WHERE w.n IS NULL", "search rows for missing works");
});

test("ids stayed put since the previous build", { skip: !existsSync(PREVIOUS_PATH) && "no previous build kept" }, () => {
  const previous = readPrevious(PREVIOUS_PATH);
  const current = readPrevious(DATASET_PATH)!;
  if (!previous) return;
  for (const entity of ["work", "composer"] as const) {
    const live = new Set(current[entity].anchors.values());
    let kept = 0;
    let moved = 0;
    const examples: string[] = [];
    for (const [anchor, id] of previous[entity].anchors) {
      const now = current[entity].anchors.get(anchor);
      if (!now) continue; // the record left its source
      const resolved = current[entity].redirects.get(id) ?? id;
      if (resolved === now) kept++;
      else {
        moved++;
        if (examples.length < 5) examples.push(`${anchor}: ${id} → ${now}`);
      }
    }
    // An id may move when a work splits; anything beyond a handful means ids aren't stable.
    assert.ok(moved <= Math.max(20, kept * 0.002), `${entity}: ${moved} anchors changed id (of ${kept + moved}), e.g. ${examples.join("; ")}`);
    const vanished: string[] = [...new Set(previous[entity].anchors.values())].filter((id) => !live.has(id) && !current[entity].redirects.has(id));
    assert.ok(vanished.length <= Math.max(50, live.size * 0.01), `${entity}: ${vanished.length} ids vanished without a redirect`);
  }
});
