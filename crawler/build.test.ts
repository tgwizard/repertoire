// The build end to end on a miniature crawl: merging, line-up rules, persistent ids
// across rebuilds, and the exports and SQL dump made from the result.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { EXPORT_FILES } from "../src/shared/data.ts";
import { buildFixture } from "../test/fixtures.ts";
import { DATA_TABLES } from "./db.ts";
import { writeExports } from "./export.ts";
import { sqlDump } from "./sqldump.ts";
import { unzip } from "./zip.ts";

const { path } = buildFixture();
const db = new DatabaseSync(path, { readOnly: true });
// Rows as plain objects (node:sqlite's have no prototype, which deepEqual minds).
const rows = (d: DatabaseSync, sql: string, ...args: (string | number)[]) => d.prepare(sql).all(...args).map((r) => ({ ...r })) as Record<string, any>[];
const all = (sql: string, ...args: (string | number)[]) => rows(db, sql, ...args);
const work = (title: string) => all("SELECT * FROM works WHERE title = ?", title)[0]!;
const lineups = (id: string) => all("SELECT lineup, arrangement FROM scorings WHERE work_id = ? ORDER BY lineup", id);

test("IMSLP works get every instrumentation category as a line-up", () => {
  const handel = work("Sonata in E minor, HWV 359b");
  assert.deepEqual(lineups(handel.id), [
    { lineup: "flute,piano", arrangement: 0 },
    { lineup: "piano,violin", arrangement: 0 },
  ]);
  // Für Elise: original for piano, only arranged for string quartet; "For 1 player" isn't a line-up.
  assert.deepEqual(lineups(work("Für Elise, WoO 59").id), [
    { lineup: "cello,viola,violin*2", arrangement: 1 },
    { lineup: "piano", arrangement: 0 },
  ]);
  assert.equal(all("SELECT * FROM lineups WHERE key LIKE '%player%'").length, 0);
});

test("other sources link to IMSLP works instead of duplicating them", () => {
  const debussy = work("String Quartet in G minor, Op.10");
  const links = Object.fromEntries(all("SELECT provider, ref FROM links WHERE entity_id = ?", debussy.id).map((l) => [l.provider, l.ref]));
  assert.deepEqual(links, { imslp: "1", wikidata: "Q1", wikipedia: "String Quartet (Debussy)", musicbrainz: "mb-debussy", mutopia: "101" });
  assert.equal(debussy.year, 1893);
  assert.equal(debussy.recordings, 500);
  // Open Opus's "Clarinet Quintet in B minor, op. 115" is IMSLP's "Clarinet Quintet, Op.115".
  const brahms = work("Clarinet Quintet, Op.115");
  assert.deepEqual(JSON.parse(brahms.signals), ["imslp-recorded", "openopus-popular", "openopus-recommended"]);
  assert.deepEqual(JSON.parse(brahms.aliases), ["Clarinet Quintet in B minor, op. 115"]);
});

test("Mutopia editions link to the work they're a movement of; composers must match name and dates", () => {
  const mutopia = all("SELECT l.ref, l.label, w.title FROM links l JOIN works w ON w.id = l.entity_id WHERE l.provider = 'mutopia'");
  assert.deepEqual(mutopia, [{ ref: "101", label: "String Quartet (2nd movement) (String Quartet)", title: "String Quartet in G minor, Op.10" }]);
  const source = all("SELECT items, matched, added FROM sources WHERE id = 'mutopia'")[0];
  assert.deepEqual(source, { items: 3, matched: 1, added: null });
});

test("LIBRIS: borrow links for works we have, and works we didn't have from the library's instrumentation", () => {
  const brahms = work("Clarinet Quintet, Op.115");
  assert.deepEqual(all("SELECT ref, label, url FROM links WHERE entity_id = ? AND provider = 'libris'", brahms.id), [
    { ref: "lb115", label: "Score and parts · Svensk Musik · 2001", url: "https://libris.kb.se/lb115" },
  ]);
  const hillborg = work("Kongsgaard variations, for string quartet");
  assert.deepEqual(lineups(hillborg.id), [{ lineup: "cello,viola,violin*2", arrangement: 0 }]);
  assert.deepEqual(all("SELECT ref FROM links WHERE entity_id = ? AND provider = 'libris' ORDER BY ref", hillborg.id), [{ ref: "lbkv1" }, { ref: "lbkv2" }]);
  assert.deepEqual(all("SELECT name, born, died FROM composers WHERE id = ?", hillborg.composer_id), [{ name: "Anders Hillborg", born: 1954, died: null }]);
  assert.equal(all("SELECT * FROM works WHERE title LIKE '%arr. for brass%'").length, 0);
  assert.deepEqual(all("SELECT items, matched, added FROM sources WHERE id = 'libris'")[0], { items: 4, matched: 2, added: 1 });
});

test("a wrong IMSLP link on Wikidata doesn't split a composer: names decide", () => {
  const haydn = all("SELECT c.id, c.name, c.born, c.died FROM composers c JOIN works w ON w.composer_id = c.id WHERE w.title LIKE 'String Quartet No.62%'")[0]!;
  assert.deepEqual([haydn.name, haydn.born, haydn.died], ["Joseph Haydn", 1732, 1809]);
  const links = all("SELECT provider, ref FROM links WHERE entity = 'composer' AND entity_id = ? ORDER BY provider", haydn.id);
  assert.deepEqual(links, [{ provider: "imslp", ref: "Haydn, Joseph" }, { provider: "wikidata", ref: "Q14" }]);
});

test("RISM: copies of works we have, the composer's own hand first; libraries counted", () => {
  const brahms = work("Clarinet Quintet, Op.115");
  assert.deepEqual(all("SELECT ref, label FROM links WHERE entity_id = ? AND provider = 'rism' ORDER BY position", brahms.id), [
    { ref: "9002", label: "Autograph manuscript · Staatsbibliothek zu Berlin (D-B) · Mus.ms.autogr. Brahms 1" },
    { ref: "9001", label: "Manuscript copy · Österreichische Nationalbibliothek (A-Wn) · Mus.Hs.9" },
  ]);
  assert.equal(brahms.copies, 3); // Berlin, Vienna (RISM) and Stockholm (LIBRIS)
  assert.equal(all("SELECT * FROM works WHERE title LIKE '%999%'").length, 0);
  assert.deepEqual(all("SELECT items, matched, added FROM sources WHERE id = 'rism'")[0], { items: 3, matched: 2, added: null });
});

test("works IMSLP lacks come in when a source states an exact line-up", () => {
  // Barber's Summer Music: only in Wikipedia's wind quintet category (in this first crawl).
  const barber = all("SELECT w.*, s.lineup FROM works w JOIN scorings s ON s.work_id = w.id WHERE w.title = 'Summer Music'");
  assert.equal(barber.length, 1);
  assert.equal(barber[0]!.lineup, "bassoon,clarinet,flute,horn,oboe");
  assert.equal(barber[0]!.free, 0);
  // Open Opus string quartets by Brahms and Dvořák.
  assert.ok(work("String Quartet no. 1 in C minor, op. 51 no. 1"));
  assert.ok(work('String Quartet no. 12 in F major, op. 96, B.179, "American"'));
});

test("line-up claims that contradict the title are refused", () => {
  // Wikipedia lists Poulenc's Sextet (piano + wind quintet) under wind quintet.
  assert.deepEqual(lineups(work("Sextet, FP 100").id), [{ lineup: "bassoon,clarinet,flute,horn,oboe,piano", arrangement: 0 }]);
});

test("line-ups count their works and say where they come from", () => {
  const quintet = all("SELECT * FROM lineups WHERE key = 'bassoon,clarinet,flute,horn,oboe'")[0]!;
  assert.equal(quintet.original, 3); // Nielsen, Barber (IMSLP page and Wikipedia item, separate in this crawl)
  assert.equal(quintet.players, 5);
  assert.deepEqual(JSON.parse(quintet.sources), { imslp: ["For flute, oboe, clarinet, bassoon, horn"], wikipedia: ["Compositions for wind quintet"] });
  for (const l of all("SELECT * FROM lineups")) {
    const counted = all("SELECT SUM(arrangement = 0) AS o, SUM(arrangement = 1) AS a FROM scorings WHERE lineup = ?", l.key)[0]!;
    assert.deepEqual([l.original, l.arrangements], [counted.o, counted.a], l.key);
  }
});

test("ids stay put across rebuilds, and merged records redirect", () => {
  const next = buildFixture(true);
  const before = new DatabaseSync(next.firstPath!, { readOnly: true });
  const after = new DatabaseSync(next.path, { readOnly: true });
  const ids = (d: DatabaseSync) => new Map((d.prepare("SELECT title, id FROM works").all() as { title: string; id: string }[]).map((r) => [r.title, r.id]));
  const [a, b] = [ids(before), ids(after)];
  for (const title of ["String Quartet in G minor, Op.10", "Clarinet Quintet, Op.115", "Für Elise, WoO 59"]) assert.equal(b.get(title), a.get(title), title);

  // Wikidata now links Summer Music to its IMSLP page: the Wikipedia-only work merges into it.
  const imslpId = a.get("Summer Music, Op.31")!;
  const wikiId = a.get("Summer Music")!;
  assert.equal(b.get("Summer Music, Op.31"), imslpId);
  assert.equal(b.has("Summer Music"), false);
  const redirects = rows(after, "SELECT entity, old_id, new_id FROM redirects ORDER BY entity");
  assert.deepEqual(
    redirects.filter((r) => r.entity === "work").map((r) => [r.old_id, r.new_id]),
    [[wikiId, imslpId]],
  );
  // Barber the IMSLP composer and Barber the Wikidata composer merge the same way.
  assert.equal(redirects.filter((r) => r.entity === "composer").length, 1);
  before.close();
  after.close();
});

test("the SQL dump recreates the dataset exactly (it is what D1 loads)", () => {
  const copy = new DatabaseSync(":memory:");
  for (const sql of sqlDump(path)) copy.exec(sql);
  for (const t of DATA_TABLES) assert.deepEqual(rows(copy, `SELECT * FROM ${t} ORDER BY 1, 2`), all(`SELECT * FROM ${t} ORDER BY 1, 2`), t);
  for (const t of ["works_fts", "composers_fts"]) assert.deepEqual(rows(copy, `SELECT rowid, * FROM ${t} ORDER BY rowid`), all(`SELECT rowid, * FROM ${t} ORDER BY rowid`), t);
  const hit = rows(copy, "SELECT w.title FROM works_fts f JOIN works w ON w.n = f.rowid WHERE works_fts MATCH 'lutoslawski'");
  assert.deepEqual(hit, [{ title: "Trio for Flute, Oboe and Piano" }]);
});

test("downloads: a CSV per table with a README, and the database itself", async () => {
  const dir = mkdtempSync(join(tmpdir(), "repertoire-export-"));
  const meta = { version: "v", builtAt: "2026-10-02T00:00:00Z", works: 1, composers: 1, lineups: 1, sources: {} as never, stats: null };
  await writeExports(path, meta, dir);
  const files = new Map(unzip(await readFile(join(dir, EXPORT_FILES.csv))).map((e) => [e.name, e.data.toString()]));
  assert.deepEqual([...files.keys()].sort(), ["README.txt", ...DATA_TABLES.map((t) => `${t}.csv`)].sort());
  assert.match(files.get("README.txt")!, /CC BY-SA 4\.0/);
  const worksCsv = files.get("works.csv")!.split("\r\n");
  assert.equal(worksCsv[0], "n,id,title,aliases,composer_id,year,era,score,signals,recordings,sitelinks,free,lineup,lineups,copies");
  assert.equal(worksCsv.filter(Boolean).length - 1, all("SELECT COUNT(*) AS n FROM works")[0]!.n);
  const sqlite = gunzipSync(await readFile(join(dir, EXPORT_FILES.sqlite)));
  assert.deepEqual(sqlite, await readFile(path));
});

test("the API's lookups use indexes even without planner statistics (as in a fresh D1)", () => {
  // D1 once timed out scanning every link for each listed work: plans must not depend on ANALYZE.
  const fresh = new DatabaseSync(":memory:");
  for (const sql of sqlDump(path)) if (sql !== "ANALYZE") fresh.exec(sql);
  const plan = (sql: string) => rows(fresh, `EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail as string);
  // [query, what its plan must search by]
  const lookups: [string, RegExp][] = [
    ["SELECT url FROM links WHERE entity = 'work' AND entity_id = 'x' AND kind = 'score' LIMIT 1", /entity_id=\?/],
    ["SELECT * FROM links WHERE entity = 'composer' AND entity_id = 'x'", /entity_id=\?/],
    ["SELECT s.work_id FROM scorings s JOIN works w ON w.id = s.work_id WHERE s.lineup = 'piano' AND s.arrangement = 0 ORDER BY w.score DESC LIMIT 50", /lineup=\? AND arrangement=\?/],
    ["SELECT * FROM scorings WHERE work_id = 'x'", /work_id=\?/],
    ["SELECT * FROM works WHERE composer_id = 'x'", /composer_id=\?/],
  ];
  for (const [sql, by] of lookups) {
    const p = plan(sql);
    assert.deepEqual(p.filter((d) => /^SCAN (?!CONSTANT)/.test(d)), [], `full scan in: ${sql}`);
    assert.ok(p.some((d) => by.test(d)), `${sql}\n  doesn't search by ${by}: ${p.join("; ")}`);
  }
});
