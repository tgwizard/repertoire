// The API on the miniature dataset: endpoints, parameters, errors and redirects.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ComposerDetail, LineupsIndex, Meta, SearchResults, WorkDetail, WorksPage } from "../src/shared/data.ts";
import { sqliteDb } from "../test/d1.ts";
import { buildFixture } from "../test/fixtures.ts";
import { handleApi, resetCaches } from "./api.ts";

const { path } = buildFixture(true);
const db = sqliteDb(path);
resetCaches();
after(() => db.close());

async function get<T>(path: string, status = 200): Promise<T> {
  const res = await handleApi(new Request(`http://test${path}`), db);
  assert.equal(res.status, status, `${path} → ${res.status}: ${await res.clone().text()}`);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  return (status === 301 ? res.headers.get("Location") : await res.json()) as T;
}

const QUARTET = "cello,viola,violin*2";
const WIND_QUINTET = "bassoon,clarinet,flute,horn,oboe";

test("/api describes the endpoints; /api/meta the dataset", async () => {
  const index = await get<{ endpoints: Record<string, string>; license: string }>("/api");
  assert.ok(index.endpoints["/api/works?lineup={key}"]);
  assert.equal(index.license, "CC BY-SA 4.0");
  const meta = await get<Meta>("/api/meta");
  assert.equal(meta.version, "20261009T000000Z");
  assert.equal(meta.sources.imslp.items, 9);
  assert.equal(meta.works, 11); // 9 on IMSLP, 2 from Open Opus
});

test("/api/lineups counts originals and arrangements per line-up", async () => {
  const { lineups } = await get<LineupsIndex>("/api/lineups");
  assert.deepEqual(lineups[QUARTET], [4, 1]); // Debussy, Haydn, two Open Opus quartets; Für Elise arranged
  assert.deepEqual(lineups[WIND_QUINTET], [2, 0]);
  const one = await get<{ description: string; sources: Record<string, string[]> }>(`/api/lineups/${QUARTET}`);
  assert.equal(one.description, "2 violins, viola, cello");
  assert.deepEqual(Object.keys(one.sources).sort(), ["imslp", "openopus"]);
});

test("works for a line-up: most established first, any spelling of the line-up", async () => {
  const page = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1`);
  assert.equal(page.total, 4);
  assert.equal(page.works[0]!.title, "String Quartet in G minor, Op.10"); // 500 recordings, Wikipedia article
  assert.deepEqual(page.works.map((w) => w.arrangement), [false, false, false, false]);
  for (let i = 1; i < page.works.length; i++) assert.ok(page.works[i]!.score <= page.works[i - 1]!.score);
  assert.equal(page.works[0]!.scoreUrl, "https://imslp.org/wiki/String_Quartet_in_G_minor%2C_Op.10_(Debussy%2C_Claude)");
  assert.deepEqual(page.facets!.eras, { Romantic: 3, Classical: 1 });

  const same = await get<WorksPage>("/api/works?lineup=violin:2,viola,cello");
  assert.deepEqual(same.works, page.works.slice(0, same.works.length));
  const withArr = await get<WorksPage>(`/api/works?lineup=${QUARTET}&arrangements=1`);
  assert.equal(withArr.total, 5);
  assert.equal(withArr.works.at(-1)!.title, "Für Elise, WoO 59"); // arrangements after originals
});

test("filters, sorts and pages", async () => {
  const romantic = await get<WorksPage>(`/api/works?lineup=${QUARTET}&era=Romantic`);
  assert.equal(romantic.total, 3);
  const free = await get<WorksPage>(`/api/works?lineup=${QUARTET}&show=free`);
  assert.deepEqual(free.works.map((w) => w.title).sort(), ["String Quartet No.62, Op.76 No.3", "String Quartet in G minor, Op.10"]);
  const byTitle = await get<WorksPage>(`/api/works?lineup=${QUARTET}&sort=title`);
  assert.deepEqual(byTitle.works.map((w) => w.title), [...byTitle.works.map((w) => w.title)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  const pageTwo = await get<WorksPage>(`/api/works?lineup=${QUARTET}&limit=2&offset=2`);
  assert.equal(pageTwo.works.length, 2);
  assert.equal(pageTwo.offset, 2);
  const q = await get<WorksPage>(`/api/works?lineup=${QUARTET}&q=debussy`);
  assert.deepEqual(q.works.map((w) => w.title), ["String Quartet in G minor, Op.10"]);
});

test("smaller groups: every line-up drawn from the players, largest first", async () => {
  const page = await get<WorksPage>(`/api/works?lineup=flute,oboe,clarinet,bassoon,horn,piano&subsets=1&sort=players&facets=1`);
  assert.deepEqual(
    page.works.map((w) => [w.players, w.title]),
    [
      [6, "Sextet, FP 100"],
      [5, "Summer Music, Op.31"], // a Wikipedia article and category outrank Nielsen's bare IMSLP page here
      [5, "Wind Quintet, Op.43"],
      [3, "Trio for Flute, Oboe and Piano"],
      [2, "Sonata in E minor, HWV 359b"],
      [1, "Für Elise, WoO 59"],
    ],
  );
  assert.deepEqual(
    page.facets!.lineups.map((l) => [l.key, l.count]),
    [
      ["bassoon,clarinet,flute,horn,oboe,piano", 1],
      [WIND_QUINTET, 2],
      ["flute,oboe,piano", 1],
      ["flute,piano", 1],
      ["piano", 1],
    ],
  );
  const twoPlus = await get<WorksPage>(`/api/works?lineup=flute,oboe,clarinet,bassoon,horn,piano&subsets=1&min_players=2`);
  assert.equal(twoPlus.total, 5);
});

test("a work: its line-ups, links, aliases and ranking", async () => {
  const { works } = await get<WorksPage>("/api/works?lineup=cello,clarinet,viola,violin:2");
  const w = await get<WorkDetail>(`/api/works/${works[0]!.id}`);
  assert.equal(w.title, "Clarinet Quintet, Op.115");
  assert.equal(w.composer!.name, "Johannes Brahms");
  assert.deepEqual(w.aliases, ["Clarinet Quintet in B minor, op. 115"]);
  assert.deepEqual(w.scorings, [
    { lineup: "cello,clarinet,viola,violin*2", description: "clarinet, 2 violins, viola, cello", players: 5, arrangement: false, sources: [{ source: "imslp", ref: "For clarinet, 2 violins, viola, cello" }] },
  ]);
  assert.deepEqual(w.links.map((l) => [l.provider, l.kind]), [["imslp", "score"], ["openopus", "data"]]);
  assert.ok(Math.abs(w.scoreParts.reduce((s, p) => s + p.points, 0) - w.score) < 0.2);
});

test("a composer: line-ups with counts; their works", async () => {
  const s = await get<SearchResults>("/api/search?q=brahms");
  const c = await get<ComposerDetail>(`/api/composers/${s.composers[0]!.id}`);
  assert.equal(c.name, "Johannes Brahms");
  assert.equal(c.sortName, "Brahms, Johannes");
  assert.equal(c.works, 2);
  assert.deepEqual(c.lineups.map((l) => l.key).sort(), ["cello,clarinet,viola,violin*2", QUARTET]);
  assert.deepEqual(c.links.map((l) => l.provider).sort(), ["imslp", "wikidata", "wikipedia"]);
  const works = await get<WorksPage>(`/api/works?composer=${c.id}`);
  assert.equal(works.total, 2);
});

test("search: titles, aliases, catalogue numbers and composer names, accents folded", async () => {
  const titles = async (q: string) => (await get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`)).works.map((w) => w.title);
  assert.deepEqual(await titles("summer music"), ["Summer Music, Op.31"]);
  assert.deepEqual(await titles("brahms quintet"), ["Clarinet Quintet, Op.115"]);
  assert.deepEqual(await titles("Clarinet Quintet in B minor"), ["Clarinet Quintet, Op.115"]); // an alias
  assert.deepEqual(await titles("op 115"), ["Clarinet Quintet, Op.115"]);
  assert.deepEqual(await titles("op115"), ["Clarinet Quintet, Op.115"]);
  assert.deepEqual(await titles("HWV 359b"), ["Sonata in E minor, HWV 359b"]);
  assert.deepEqual(await titles("lutosławski"), ["Trio for Flute, Oboe and Piano"]);
  assert.deepEqual(await titles("LUTOSLAWSKI trio"), ["Trio for Flute, Oboe and Piano"]);
  assert.deepEqual(await titles("dvorak american"), ['String Quartet no. 12 in F major, op. 96, B.179, "American"']);
  assert.deepEqual(await titles("debus"), ["String Quartet in G minor, Op.10"]); // prefixes, as you type
  assert.deepEqual(await titles("zzzz"), []);
  const c = await get<SearchResults>("/api/search?q=Poulenc");
  assert.deepEqual(c.composers.map((x) => x.name), ["Francis Poulenc"]);
});

test("merged ids redirect; unknown ids 404; bad input 400", async () => {
  const meta = await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}`);
  const barber = meta.works.find((w) => w.title === "Summer Music, Op.31")!;
  const first = buildFixture(false);
  const old = sqliteDb(first.path);
  const oldId = ((await old.prepare("SELECT id FROM works WHERE title = 'Summer Music'").first()) as { id: string }).id;
  old.close();
  assert.equal(await get<string>(`/api/works/${oldId}`, 301), `/api/works/${barber.id}`);

  await get("/api/works/00000000", 404);
  await get("/api/works/not-an-id", 404);
  await get("/api/composers/00000000", 404);
  await get("/api/nope", 404);
  await get("/api/works", 400);
  await get("/api/works?lineup=,,,", 400);
  await get("/api/works?composer=../x", 400);
  await get("/api/search", 400);
  await get("/api/works?lineup=violin&limit=abc", 400);
  // Odd search input is safe: quotes and operators are words, not FTS syntax.
  assert.deepEqual((await get<SearchResults>(`/api/search?q=${encodeURIComponent('"op" OR NEAR( * -')}`)).works.length >= 0, true);
  const res = await handleApi(new Request("http://test/api/meta", { method: "POST" }), db);
  assert.equal(res.status, 405);
});
