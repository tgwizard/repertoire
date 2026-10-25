// Is the repertoire right? Known works where they belong, known mistakes gone, search
// finding what people type, through the real API code. Runs on the local dataset, or
// a live site with DATA_URL (see ../client.ts).

import assert from "node:assert/strict";
import { test } from "node:test";
import { bareTitle, musicalKey } from "../../crawler/match.ts";
import { decodeEnsemble, ensembleKey, fitsIn, parseEnsembleKey } from "../../src/lib/instrumentation.ts";
import type { ComposerDetail, LineupsIndex, Meta, SearchResults, WorkDetail, WorkSummary, WorksPage } from "../../src/shared/data.ts";
import { api, request, where } from "../client.ts";

console.log(`# repertoire checks against ${where}`);

const key = (spec: string) => ensembleKey(decodeEnsemble(spec));
const WIND_QUINTET = "flute,oboe,clarinet,bassoon,horn";
const STRING_QUARTET = "violin:2,viola,cello";

/** Works for a line-up in rank order (originals first), up to `max`. */
async function lineup(spec: string, max = 200, extra = ""): Promise<WorkSummary[]> {
  const works: WorkSummary[] = [];
  for (let offset = 0; offset < max; offset += 200) {
    const page = await api<WorksPage>(`/api/works?lineup=${key(spec)}&limit=${Math.min(200, max - offset)}&offset=${offset}${extra}`);
    works.push(...page.works);
    if (works.length >= page.total) break;
  }
  return works;
}

/** 1-based rank among a line-up's original works, 0 if absent. */
async function rank(spec: string, composer: RegExp, title: RegExp, max = 200): Promise<number> {
  const works = await lineup(spec, max);
  return works.findIndex((w) => !w.arrangement && composer.test(w.composer?.name ?? "") && title.test(w.title)) + 1;
}

const search = (q: string, limit = 10) => api<SearchResults>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);

test("common line-ups have plausible counts", async () => {
  const { lineups } = await api<LineupsIndex>("/api/lineups");
  const min: [string, number][] = [
    [STRING_QUARTET, 4_000],
    [WIND_QUINTET, 250],
    [`${WIND_QUINTET},piano`, 25],
    ["violin,cello,piano", 1_500],
    ["trumpet:2,horn,trombone,tuba", 80],
    ["orchestra", 12_000],
    ["piano", 40_000],
  ];
  for (const [spec, n] of min) {
    const entry = lineups[key(spec)];
    assert.ok(entry && entry[0] >= n, `${spec}: ${entry?.[0] ?? 0} original works, expected ≥ ${n}`);
  }
});

test("canonical works are present and rank near the top", async () => {
  const expected: [spec: string, composer: RegExp, title: RegExp, maxRank: number][] = [
    [WIND_QUINTET, /Nielsen/, /Wind Quintet, Op\.43/, 5],
    [WIND_QUINTET, /Reicha/, /Op\.88/, 50],
    [WIND_QUINTET, /Barber/, /Summer Music/, 30], // not on IMSLP: from Wikipedia
    [`${WIND_QUINTET},piano`, /Poulenc/, /Sextet/, 5],
    [STRING_QUARTET, /Debussy/, /Op\.10/, 10],
    [STRING_QUARTET, /Dvořák/, /Op\.96/, 25],
    ["violin,cello,piano", /Beethoven/, /Op\.97/, 5],
    ["clarinet,violin:2,viola,cello", /Brahms/, /Op\.115/, 5],
    ["clarinet,violin:2,viola,cello", /Mozart/, /K\.581/, 5],
    ["violin,orchestra", /Mendelssohn/, /Op\.64/, 5],
    ["orchestra", /Beethoven/, /Symphony No\.5, Op\.67/, 25],
    ["cello", /Bach/, /BWV 1007/, 10],
  ];
  const problems: string[] = [];
  for (const [spec, composer, title, maxRank] of expected) {
    const r = await rank(spec, composer, title);
    if (r === 0 || r > maxRank) problems.push(`${composer.source} ${title.source} in ${spec}: rank ${r || "missing"}, expected ≤ ${maxRank}`);
  }
  assert.deepEqual(problems, []);
});

test("known misclassifications stay fixed", async () => {
  // Poulenc's Sextet is for piano and wind quintet (a Wikipedia category lists it under wind quintet).
  assert.equal(await rank(WIND_QUINTET, /Poulenc/, /Sextet/), 0);
  // Chausson's Concert is for violin, piano and string quartet (Wikidata tags it "string quartet").
  assert.equal(await rank(STRING_QUARTET, /Chausson/, /Concert/), 0);
  // Für Elise for string quartet only exists as an arrangement.
  assert.equal(await rank(STRING_QUARTET, /Beethoven/, /Für Elise/), 0);
  // Open Opus "String Quartet no. 3, for soprano and string quartet" isn't for string quartet alone.
  const quartets = await lineup(STRING_QUARTET, 5000);
  assert.deepEqual(quartets.filter((w) => /\bfor\b.*(soprano|voice|double bass)/i.test(w.title)).map((w) => w.title), []);
});

test("lists are ranked, consistent with their facets, and page without gaps", async () => {
  const first = await api<WorksPage>(`/api/works?lineup=${key(STRING_QUARTET)}&limit=200&facets=1`);
  const firstArr = first.works.findIndex((w) => w.arrangement);
  assert.equal(firstArr, -1, "arrangements listed without asking");
  for (let i = 1; i < first.works.length; i++) assert.ok(first.works[i]!.score <= first.works[i - 1]!.score, `rank order broken at ${i}`);
  const eraTotal = Object.values(first.facets!.eras).reduce((s, n) => s + (n ?? 0), 0);
  assert.equal(eraTotal, first.total, "era counts don't add up to the total");
  const second = await api<WorksPage>(`/api/works?lineup=${key(STRING_QUARTET)}&limit=100&offset=100`);
  assert.deepEqual(second.works.map((w) => w.id), first.works.slice(100, 200).map((w) => w.id));
  const romantic = await api<WorksPage>(`/api/works?lineup=${key(STRING_QUARTET)}&era=Romantic&limit=1`);
  assert.equal(romantic.total, first.facets!.eras.Romantic);
  const core = await api<WorksPage>(`/api/works?lineup=${key(STRING_QUARTET)}&show=core&limit=200`);
  assert.equal(core.total, first.facets!.core);
  assert.ok(core.works.every((w) => w.score >= 6));
  const free = await api<WorksPage>(`/api/works?lineup=${key(STRING_QUARTET)}&show=free&limit=50`);
  assert.equal(free.total, first.facets!.free);
  assert.ok(free.works.every((w) => w.scoreUrl?.startsWith("https://imslp.org/")));
});

test("smaller groups: only line-ups the players can form, the full group's works first", async () => {
  const group = `${WIND_QUINTET},piano`;
  const exact = await api<WorksPage>(`/api/works?lineup=${key(group)}&limit=1`);
  const page = await api<WorksPage>(`/api/works?lineup=${key(group)}&subsets=1&min_players=2&sort=players&limit=200&facets=1`);
  assert.ok(page.total > exact.total * 5, `${page.total} works with smaller groups vs ${exact.total} for the full group`);
  const players = parseEnsembleKey(key(group));
  for (const l of page.facets!.lineups) assert.ok(fitsIn(parseEnsembleKey(l.key), players), `${l.key} doesn't fit in the group`);
  assert.ok(page.facets!.lineups.every((l) => l.players >= 2));
  assert.equal(page.works[0]!.players, 6);
  for (let i = 1; i < page.works.length; i++) assert.ok(page.works[i]!.players <= page.works[i - 1]!.players, "not largest first");
  const nielsen = page.works.find((w) => /Op\.43/.test(w.title) && /Nielsen/.test(w.composer?.name ?? ""));
  assert.ok(nielsen, "Nielsen's wind quintet missing among the smaller groups");
  assert.equal(nielsen!.players, 5);
});

test("an orchestra's smaller groups include chamber and string orchestra works", async () => {
  const { lineups } = await api<LineupsIndex>("/api/lineups");
  assert.ok((lineups["chamber orchestra"]?.[0] ?? 0) > 100, "too few chamber orchestra works");
  const page = await api<WorksPage>(`/api/works?lineup=orchestra&subsets=1&limit=1&facets=1`);
  const keys = page.facets!.lineups.map((l) => l.key);
  assert.ok(keys.includes("chamber orchestra") && keys.includes("strings"), `orchestra's smaller groups: ${keys.join(" | ")}`);
});

test("work pages: links, line-ups and sources for well-known works", async () => {
  const [debussy] = (await search("debussy string quartet op 10")).works;
  assert.ok(debussy, "Debussy's quartet not found");
  const w = await api<WorkDetail>(`/api/works/${debussy.id}`);
  assert.ok(w.links.some((l) => l.provider === "imslp" && l.kind === "score"));
  assert.ok(w.links.some((l) => l.provider === "wikipedia"));
  assert.ok(w.scorings.some((s) => s.lineup === key(STRING_QUARTET) && !s.arrangement && s.sources.some((x) => x.source === "imslp")));
  assert.ok(w.score >= 10);
  assert.equal(w.composer?.name, "Claude Debussy");
  assert.ok(w.year === 1893 || w.year === 1894, `year ${w.year}`); // composed 1893, published 1894
});

test("free editions from Mutopia are linked from their works", async () => {
  const [duets] = (await search("mozart k 487")).works;
  assert.ok(duets, "Mozart's horn duets not found");
  const w = await api<WorkDetail>(`/api/works/${duets.id}`);
  assert.ok(w.links.some((l) => l.provider === "mutopia" && l.url?.startsWith("https://www.mutopiaproject.org/")), "no Mutopia link");
  const meta = await api<Meta>("/api/meta");
  assert.ok((meta.sources.mutopia?.matched ?? 0) > 800, `only ${meta.sources.mutopia?.matched} Mutopia pieces matched`);
});

test("LIBRIS: works we have can be borrowed in Stockholm; Swedish works come in", async () => {
  const [romberg] = (await search("romberg flute quintets op 41")).works;
  assert.ok(romberg, "Romberg's flute quintets not found");
  const w = await api<WorkDetail>(`/api/works/${romberg.id}`);
  assert.ok(w.links.some((l) => l.provider === "libris" && l.kind === "library"), "no library link");
  const meta = await api<Meta>("/api/meta");
  assert.ok((meta.sources.libris?.matched ?? 0) > 8000, `only ${meta.sources.libris?.matched} LIBRIS records matched`);
  assert.ok((meta.sources.libris?.added ?? 0) > 2000, `only ${meta.sources.libris?.added} works added from LIBRIS`);
});

test("GND: instrumentation for works IMSLP can't have, without doubling composers", async () => {
  const { composers, works } = await search("julian anderson quartet");
  assert.ok(works.some((x) => /^Quartet No\. 1/.test(x.title) && x.lineup === key(STRING_QUARTET)), "Julian Anderson's first quartet missing");
  const hillborg = (await search("hillborg")).composers.filter((c) => c.name === "Anders Hillborg");
  assert.equal(hillborg.length, 1, "Hillborg listed more than once");
  assert.ok(hillborg[0]!.works >= 10);
  const [debussy] = (await search("debussy string quartet op 10")).works;
  const d = await api<WorkDetail>(`/api/works/${debussy!.id}`);
  assert.ok(d.links.some((l) => l.provider === "gnd"), "no GND link on Debussy's quartet");
  const meta = await api<Meta>("/api/meta");
  assert.ok((meta.sources.gnd?.matched ?? 0) > 30_000, `only ${meta.sources.gnd?.matched} GND works matched`);
  assert.ok((meta.sources.gnd?.added ?? 0) > 20_000, `only ${meta.sources.gnd?.added} works added from GND`);
  void composers;
});

test("composer pages: life, links and line-ups", async () => {
  const { composers } = await search("johannes brahms");
  assert.equal(composers[0]?.name, "Johannes Brahms");
  const c = await api<ComposerDetail>(`/api/composers/${composers[0]!.id}`);
  assert.deepEqual([c.born, c.died], [1833, 1897]);
  assert.ok(c.works > 100);
  assert.ok(c.links.some((l) => l.provider === "imslp"));
  assert.ok(c.lineups.some((l) => l.key === key("clarinet,violin:2,viola,cello")));
  const nielsen = (await search("carl nielsen")).composers[0]!;
  const n = await api<ComposerDetail>(`/api/composers/${nielsen.id}`);
  assert.ok(n.lineups.some((l) => l.key === key(WIND_QUINTET)));
});

test("search finds what people type", async () => {
  // [query, composer, title of the work expected in the top `within`]
  const cases: [string, RegExp, RegExp, number][] = [
    ["brahms clarinet quintet", /Brahms/, /Clarinet Quintet, Op\.115/, 1],
    ["nielsen wind quintet", /Nielsen/, /Wind Quintet, Op\.43/, 1],
    ["K 581", /Mozart/, /K\.581/, 3],
    ["k581", /Mozart/, /K\.581/, 3],
    ["mozart k.581", /Mozart/, /K\.581/, 1],
    ["BWV 1007", /Bach/, /BWV 1007/, 3],
    ["beethoven op 97", /Beethoven/, /Op\.97/, 3],
    ["dvorak american", /Dvořák/, /Op\.96/, 3], // a nickname, from other sources' titles
    ["Dvořák Op. 96", /Dvořák/, /Op\.96/, 3],
    ["schubert trout", /Schubert/, /D\.667/, 3],
    ["eine kleine nachtmusik", /Mozart/, /K\.525/, 3],
    ["beethoven symphony 5", /Beethoven/, /Symphony No\.5/, 3],
    ["barber summer music", /Barber/, /Summer Music/, 1],
    ["poulenc sextet", /Poulenc/, /Sextet/, 1],
    ["debussy quartet", /Debussy/, /Op\.10/, 3],
  ];
  const problems: string[] = [];
  for (const [q, composer, title, within] of cases) {
    const { works } = await search(q, 10);
    const r = works.findIndex((w) => composer.test(w.composer?.name ?? "") && title.test(w.title)) + 1;
    if (!r || r > within) problems.push(`“${q}”: rank ${r || "missing"}, expected ≤ ${within} (got ${works.slice(0, 3).map((w) => w.title).join(" | ")})`);
  }
  assert.deepEqual(problems, []);
});

test("composer search folds accents and letters like ł", async () => {
  for (const [q, name] of [
    ["lutoslawski", "Witold Lutosławski"],
    ["Lutosławski", "Witold Lutosławski"],
    ["dvorak", "Antonín Dvořák"],
    ["janacek", "Leoš Janáček"],
    ["saint-saens", "Camille Saint-Saëns"],
  ]) {
    const { composers } = await search(q!);
    assert.equal(composers[0]?.name, name, `“${q}” found ${composers.map((c) => c.name).join(", ") || "nobody"}`);
  }
});

test("odd input is handled, not an error", async () => {
  for (const q of ['"', "*", "OR", "NEAR(", "-", "op.", "a", "ñ", "🎻", "x".repeat(300)]) {
    const res = await request(`/api/search?q=${encodeURIComponent(q)}`);
    assert.ok(res.status === 200 || res.status === 400, `“${q}” → ${res.status}`);
  }
  assert.equal((await request("/api/works/zzzzzzzz")).status, 404);
  assert.equal((await request("/api/works?lineup=nonexistent-instrument")).status, 200);
});

test("the dataset says where it comes from", async () => {
  const meta = await api<Meta>("/api/meta");
  for (const [id, s] of Object.entries(meta.sources)) assert.ok(s.items > 0 && s.fetchedAt, `source ${id} is empty`);
  assert.ok(meta.stats, "no stats");
  assert.ok(meta.stats!.core > 3000);
});

// Known gap: works from other sources that look like an IMSLP work but weren't matched,
// usually because it was ambiguous. Reported, not failed.
test("no duplicates from unmatched sources", { todo: "ambiguous matches are left unmatched" }, async (t) => {
  const works = await lineup(STRING_QUARTET, 5000);
  const imslp = works.filter((w) => w.scoreUrl);
  const sameKey = (a: string, b: string) => !musicalKey(a) || !musicalKey(b) || musicalKey(a) === musicalKey(b);
  const dupes = works.filter(
    (w) => !w.scoreUrl && imslp.some((i) => i.composer?.id === w.composer?.id && bareTitle(i.title) === bareTitle(w.title) && sameKey(i.title, w.title)),
  );
  for (const d of dupes) t.diagnostic(`${d.composer?.name}: "${d.title}" (${d.id})`);
  assert.equal(dupes.length, 0);
});
