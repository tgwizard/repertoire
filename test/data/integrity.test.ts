// Integrity of the built dataset (.cache/build/repertoire.sqlite), checked in SQL:
// every row consistent with the others and with the rules that produced it.
// Run after each build, before publishing (npm run test:data).

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DATASET_PATH, PREVIOUS_PATH, readPrevious } from "../../crawler/build.ts";
import { SCHEMA_VERSION } from "../../crawler/db.ts";
import { ID_PATTERN } from "../../crawler/ids.ts";
import { describe, ensembleKey, parseEnsembleKey, playerCount } from "../../src/lib/instrumentation.ts";
import { column, formatOrchestration, LABELS, ORCHESTRA_KEYS } from "../../src/lib/orchestration.ts";
import { sqliteDb } from "../../crawler/d1.ts";
import { ftsQuery, listWorks, PRECOMPUTED_FACETS_MIN } from "../../worker/queries.ts";
import { ERAS, PROVIDERS, score, SIGNALS, type ProviderId, type Signal } from "../../src/shared/data.ts";
import { normalize } from "../../src/shared/text.ts";

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
    assert.equal(l.key, l.key.toLowerCase(), `instrument ids are lowercase: ${l.key}`);
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
    const expected = score({ signals, recordings: w.recordings, sitelinks: w.sitelinks, composerSitelinks: c?.sitelinks, copies: w.copies });
    if (Math.abs(expected - w.score) > 0.001) problems.push(`${w.id}: score ${w.score}, expected ${expected}`);
    const aliases = JSON.parse(w.aliases) as string[];
    if (aliases.includes(w.title)) problems.push(`${w.id}: alias repeats the title`);
    if (problems.length >= 10) break;
  }
  assert.deepEqual(problems, []);
});

test("text is composed (NFC), so it matches and searches the way it's typed", () => {
  const texts: [string, string][] = [
    ["SELECT id, title || ' ' || aliases AS t FROM works", "work"],
    ["SELECT id, name AS t FROM composers", "composer"],
    ["SELECT entity_id AS id, coalesce(label, '') AS t FROM links", "link"],
    ["SELECT key AS id, sources AS t FROM lineups", "line-up"],
  ];
  const problems: string[] = [];
  for (const [sql, what] of texts)
    for (const r of db.prepare(sql).iterate() as Iterable<Record<string, any>>)
      if (r.t !== r.t.normalize("NFC") && problems.push(`${what} ${r.id}: ${r.t.slice(0, 60)}`) >= 5) break;
  assert.deepEqual(problems, []);
});

test("no text was garbled in decoding (U+FFFD), anywhere", () => {
  // A replacement character means bytes were decoded wrongly on the way in: it fails the
  // release, naming the records it came from so the stage can be fixed and regenerated.
  const garbled = (table: string, columns: string[]) => columns.map((c) => `instr(${table}.${c}, char(65533)) > 0`).join(" OR ");
  const records = (entity: string, id: string) =>
    all(`SELECT provider || ':' || ref AS r FROM links WHERE entity = '${entity}' AND entity_id = '${id}'`).map((r) => r.r).join(" ");
  const problems = [
    ...all(`SELECT id, title AS t FROM works WHERE ${garbled("works", ["title", "aliases"])}`).map((r) => `work ${r.id} (${records("work", r.id)}): ${r.t}`),
    ...all(`SELECT id, name AS t FROM composers WHERE ${garbled("composers", ["name", "sort_name"])}`).map((r) => `composer ${r.id} (${records("composer", r.id)}): ${r.t}`),
    ...all(`SELECT entity_id AS id, provider || ':' || ref AS t FROM links WHERE ${garbled("links", ["label", "ref", "url"])}`).map((r) => `link of ${r.id}: ${r.t}`),
    ...all(`SELECT work_id AS id, heading AS t FROM arrangements WHERE ${garbled("arrangements", ["heading", "arranger", "excerpt"])}`).map((r) => `arrangement of ${r.id}: ${r.t}`),
    ...all(`SELECT key AS id, sources AS t FROM lineups WHERE ${garbled("lineups", ["description", "sources"])}`).map((r) => `line-up ${r.id}`),
  ];
  assert.deepEqual(problems, []);
});

test("orchestral scorings: for orchestral works, whole orchestras, columns as the instruments say", () => {
  none(
    "SELECT o.work_id FROM orchestrations o WHERE NOT EXISTS (SELECT 1 FROM scorings s WHERE s.work_id = o.work_id AND s.arrangement = 0 AND s.lineup LIKE '%orchestra%')",
    "scorings for works not written for orchestra",
  );
  none(
    "SELECT work_id FROM orchestrations WHERE str = 0 AND status != 'partial' AND work_id NOT IN (SELECT work_id FROM scorings WHERE lineup LIKE '%orchestra without strings%')",
    "orchestras without strings",
  );
  none("SELECT work_id FROM orchestrations WHERE status NOT IN ('confirmed', 'single', 'partial') OR basis = ''", "scorings without a status or basis");
  // A scoring with parts we can't read is partial: it never says what an orchestra can play
  none("SELECT work_id FROM orchestrations WHERE unresolved != '[]' AND status != 'partial'", "unresolved parts in a scoring relied on");
  for (const r of all("SELECT * FROM orchestrations")) {
    const o = JSON.parse(r.instruments);
    assert.equal(r.scoring, formatOrchestration(o), r.work_id);
    for (const k of ORCHESTRA_KEYS) assert.equal(r[column(k)], o[k] ?? 0, `${r.work_id}.${k}`);
    assert.ok(Object.keys(o).every((k) => k.split("/").every((i) => i in LABELS)), `${r.work_id}: unknown instrument in ${r.instruments}`);
  }
  const n = one("SELECT COUNT(*) AS n FROM orchestrations WHERE status != 'partial'").n;
  assert.ok(n > 4_000, `only ${n} orchestral scorings to rely on`);
});

test("precomputed facets are what the API would count, for the big line-ups", async () => {
  assert.equal(Number(meta.facets_min), PRECOMPUTED_FACETS_MIN);
  const big = all(`SELECT key FROM lineups WHERE original + arrangements >= ${PRECOMPUTED_FACETS_MIN}`).map((r) => r.key);
  assert.equal(one("SELECT COUNT(*) AS n FROM lineup_facets").n, big.length * 2);
  // The biggest, and a spread of the rest
  const sample = [...all(`SELECT key FROM lineups WHERE original + arrangements >= ${PRECOMPUTED_FACETS_MIN} ORDER BY original DESC LIMIT 3`).map((r) => r.key), ...big.filter((_, i) => i % 25 === 0)];
  const api = sqliteDb(DATASET_PATH);
  for (const lineup of sample) {
    for (const arrangements of [0, 1]) {
      const stored = one(`SELECT total, facets FROM lineup_facets WHERE lineup = '${lineup.replaceAll("'", "''")}' AND arrangements = ${arrangements}`);
      const page = await listWorks(api, null, { lineup, arrangements: !!arrangements, facets: true, limit: 1 });
      assert.deepEqual([stored.total, JSON.parse(stored.facets)], [page.total, page.facets], `${lineup} ${arrangements}`);
    }
  }
  api.close();
});

test("durations and movements are plausible", () => {
  none("SELECT id, duration FROM works WHERE duration < 10 OR duration > 6 * 3600", "durations under 10 seconds or over 6 hours");
  none("SELECT id, movements FROM works WHERE movements < 1 OR movements > 200", "implausible movement counts");
  const n = one("SELECT COUNT(duration) AS d, COUNT(movements) AS m FROM works");
  assert.ok(n.d > 30_000 && n.m > 50_000, `durations ${n.d}, movements ${n.m}`);
});

test("arrangements: for line-ups their works are listed for, arrangers named, searchable", () => {
  none(
    "SELECT a.work_id, a.lineup FROM arrangements a WHERE a.lineup IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scorings s WHERE s.work_id = a.work_id AND s.lineup = a.lineup)",
    "arrangements for a line-up the work isn't listed for",
  );
  none("SELECT work_id, arranger FROM arrangements WHERE arranger = '' OR arranger GLOB '*[{}?]*' OR arranger LIKE '%[[%' OR lower(arranger) IN ('unknown', 'anonymous')", "arrangers that aren't names");
  none("SELECT work_id, excerpt FROM arrangements WHERE excerpt = '' OR excerpt GLOB '*[{}]*'", "excerpts with wiki markup");
  none("SELECT work_id FROM arrangements GROUP BY work_id HAVING MAX(position) != COUNT(*) - 1", "gaps in arrangement order");
  // Every named arranger is in the work's search row, folded as queries are
  const unsearchable = all(
    `SELECT a.work_id, a.arranger, f.arrangers FROM arrangements a JOIN works w ON w.id = a.work_id JOIN works_fts f ON f.rowid = w.n
     WHERE a.arranger IS NOT NULL AND a.arranger != 'the composer'`,
  ).filter((r) => !normalize(r.arranger).split(" ").every((word: string) => ` ${r.arrangers} `.includes(` ${word} `) || ` ${r.arrangers} `.includes(word)));
  assert.deepEqual(unsearchable.slice(0, 5), [], "arrangers missing from search");
  const n = one("SELECT COUNT(*) AS n, COUNT(arranger) AS named, COUNT(lineup) AS placed FROM arrangements");
  assert.ok(n.n > 50_000 && n.named / n.n > 0.85 && n.placed / n.n > 0.9, JSON.stringify(n));
  // Most line-ups IMSLP lists a work as arranged for say whose arrangement it is
  const covered = one(
    "SELECT AVG(EXISTS (SELECT 1 FROM arrangements a WHERE a.work_id = s.work_id AND a.lineup = s.lineup)) AS p FROM scorings s WHERE s.arrangement = 1 AND s.sources LIKE '%\"imslp\"%'",
  ).p;
  assert.ok(covered > 0.7, `only ${covered} of IMSLP's arrangement listings have their arrangement`);
});

test("composers: every one has works, and counts match", () => {
  none("SELECT c.id FROM composers c WHERE c.works != (SELECT COUNT(*) FROM works w WHERE w.composer_id = c.id)", "composers.works wrong");
  none("SELECT id FROM composers WHERE works = 0", "composers without works");
  none("SELECT id FROM composers WHERE died < born + 10 OR died - born > 105", "impossible lifespans");
  none("SELECT id FROM composers WHERE trim(name) = '' OR name != trim(name)", "blank or untrimmed names");
  for (const c of all("SELECT id FROM composers")) assert.match(c.id, ID_PATTERN);
  // One person, several entries: a source's composer that didn't match ours. Known ones,
  // each with its reason; any other is a new failure to reconcile.
  const KNOWN_TWINS = [
    "Jacques Rensburg (1846)", // two Wikidata items (Q106624167, Q94860952), one per source
    "Robert Scholz (1902)", // two Wikidata items and GND records, dying 1981 and 1986: perhaps two people
  ];
  const twins = all("SELECT name, born, COUNT(*) AS entries FROM composers WHERE born IS NOT NULL GROUP BY name, born HAVING entries > 1").map((t) => `${t.name} (${t.born})`);
  assert.deepEqual(twins.filter((t) => !KNOWN_TWINS.includes(t)), [], "composers listed twice");
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
    gnd: /^https:\/\/d-nb\.info\/gnd\/[0-9X-]+$/,
    rism: /^https:\/\/rism\.online\/(sources|people)\/\d+$/,
    libris: /^https:\/\/libris\.kb\.se\/[0-9a-z]+$/,
    "swedish-libraries": /^https:\/\/libris\.kb\.se\/[0-9a-z]+$/,
    dnb: /^https:\/\/d-nb\.info\/[0-9X]+$/,
    mutopia: /^https:\/\/www\.mutopiaproject\.org\/cgibin\/piece-info\.cgi\?id=\d+$/,
  };
  for (const l of all("SELECT provider, kind, url, COUNT(*) AS n FROM links GROUP BY provider, kind, url IS NULL")) {
    assert.ok(l.provider in PROVIDERS, `unknown provider ${l.provider}`);
    assert.equal(l.kind, PROVIDERS[l.provider as ProviderId].kind, `${l.provider} links of kind ${l.kind}`);
  }
  for (const l of all("SELECT provider, url FROM links WHERE url IS NOT NULL")) assert.match(l.url, hosts[l.provider as ProviderId], l.provider);
  none("SELECT entity_id FROM links WHERE provider = 'openopus' AND url IS NOT NULL", "Open Opus links with URLs");
});

test("redirects point at live ids (or retired ones, whose page says what they were), directly", () => {
  const retired = (entity: string) => `EXISTS (SELECT 1 FROM retired t WHERE t.entity = '${entity}' AND t.id = r.new_id)`;
  none(`SELECT old_id FROM redirects r WHERE entity = 'work' AND NOT EXISTS (SELECT 1 FROM works w WHERE w.id = r.new_id) AND NOT ${retired("work")}`, "work redirects to missing works");
  none(`SELECT old_id FROM redirects r WHERE entity = 'composer' AND NOT EXISTS (SELECT 1 FROM composers c WHERE c.id = r.new_id) AND NOT ${retired("composer")}`, "composer redirects to missing composers");
  none("SELECT r.id FROM retired r WHERE EXISTS (SELECT 1 FROM works w WHERE w.id = r.id) OR EXISTS (SELECT 1 FROM composers c WHERE c.id = r.id)", "retired ids that are live");
  none("SELECT old_id FROM redirects r WHERE EXISTS (SELECT 1 FROM works w WHERE w.id = r.old_id) OR EXISTS (SELECT 1 FROM composers c WHERE c.id = r.old_id)", "redirects from live ids");
  none("SELECT a.old_id FROM redirects a JOIN redirects b ON b.entity = a.entity AND b.old_id = a.new_id", "redirect chains");
});

test("search index covers every work and composer", () => {
  assert.equal(one("SELECT COUNT(*) AS n FROM works_fts").n, one("SELECT COUNT(*) AS n FROM works").n);
  assert.equal(one("SELECT COUNT(*) AS n FROM composers_fts").n, one("SELECT COUNT(*) AS n FROM composers").n);
  none("SELECT f.rowid FROM works_fts f LEFT JOIN works w ON w.n = f.rowid WHERE w.n IS NULL", "search rows for missing works");
});

test("every work can be found by its exact title, whatever the script", () => {
  // Per script in the titles (by their first letter), up to 200 works: the search for the
  // title, as typed, must match the work itself.
  const byScript = new Map<string, { n: number; title: string }[]>();
  const SCRIPTS = ["Latin", "Cyrillic", "Greek", "Han", "Hiragana", "Katakana", "Hangul", "Hebrew", "Arabic", "Armenian", "Georgian", "Devanagari", "Thai"];
  for (const r of db.prepare("SELECT n, title FROM works ORDER BY n").iterate() as Iterable<{ n: number; title: string }>) {
    const letter = /\p{L}/u.exec(r.title)?.[0];
    if (!letter) continue;
    const script = SCRIPTS.find((s) => new RegExp(`\\p{Script=${s}}`, "u").test(letter)) ?? "other";
    const list = byScript.get(script) ?? [];
    if (list.length < 200) list.push(r), byScript.set(script, list);
  }
  assert.ok(byScript.get("Cyrillic")?.length, "no Cyrillic titles to check");
  const found = db.prepare("SELECT 1 FROM works_fts WHERE works_fts MATCH ? AND rowid = ?");
  const missed: string[] = [];
  for (const [script, works] of byScript)
    for (const w of works) {
      const q = ftsQuery(w.title);
      if (!q || !found.get(q, w.n)) missed.push(`${script}: ${w.title}`);
    }
  assert.deepEqual(missed.slice(0, 10), []);
});

test("ids stayed put since the previous build: every one live, redirected or retired", { skip: !existsSync(PREVIOUS_PATH) && "no previous build kept" }, () => {
  const previous = readPrevious(PREVIOUS_PATH);
  const current = readPrevious(DATASET_PATH)!;
  if (!previous) return;
  const report: string[] = [];
  const problems: string[] = [];
  for (const entity of ["work", "composer"] as const) {
    const table = entity === "work" ? "works" : "composers";
    const live = new Set(all(`SELECT id FROM ${table}`).map((r) => r.id as string));
    const retired = new Set(all(`SELECT id FROM retired WHERE entity = '${entity}'`).map((r) => r.id as string));
    // Every id the last dataset had still means something: the entity, a redirect, or a
    // retired id's page saying what it was
    const was: Map<string, unknown> = entity === "work" ? previous.works : previous.composers;
    const lost: string[] = [...was.keys()].filter((id) => !live.has(id) && !current[entity].redirects.has(id) && !retired.has(id));
    assert.deepEqual(lost.slice(0, 10), [], `${entity}: ${lost.length} ids lost without a redirect or a retirement`);
    // A record whose entity changed id: a split or a merge
    let kept = 0;
    const moved: string[] = [];
    for (const [anchor, id] of previous[entity].anchors) {
      const now = current[entity].anchors.get(anchor);
      if (!now || !live.has(id)) continue; // the record left, or its old entity did
      if ((current[entity].redirects.get(id) ?? id) === now) kept++;
      else moved.push(`${anchor}: ${id} → ${now}`);
    }
    const gone = all(`SELECT reason, COUNT(*) AS n FROM retired WHERE entity = '${entity}' AND since = '${meta.version}' GROUP BY reason`);
    report.push(`${entity}: ${kept} records kept their ids, ${moved.length} moved; retired now: ${JSON.stringify(gone)}`, ...moved.map((m) => `  ${m}`));
    // An id may move when a work splits; anything beyond a handful means ids aren't stable,
    // unless a correction meant it to (ALLOW_ID_MOVES=n; see id-changes.txt)
    const allowed = Math.max(20, kept * 0.002, Number(process.env.ALLOW_ID_MOVES ?? 0));
    if (moved.length > allowed) problems.push(`${entity}: ${moved.length} records changed id (of ${kept + moved.length}), e.g. ${moved.slice(0, 5).join("; ")}`);
  }
  writeFileSync(join(dirname(DATASET_PATH), "id-changes.txt"), report.join("\n") + "\n");
  assert.deepEqual(problems, [], "see id-changes.txt next to the dataset");
});