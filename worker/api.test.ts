// The API on the miniature dataset: endpoints, parameters, errors and redirects.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import type { ComposerDetail, Gone, LineupsIndex, Meta, SearchResults, WorkDetail, WorksPage } from "../src/shared/data.ts";
import { sqliteDb } from "../crawler/d1.ts";
import { buildFixture } from "../test/fixtures.ts";
import { precomputeFacets } from "../crawler/build.ts";
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
  assert.equal(meta.sources.imslp.items, 13);
  assert.equal(meta.works, 17); // 13 on IMSLP, 2 from Open Opus, 2 from LIBRIS
});

test("/api/lineups counts originals and arrangements per line-up", async () => {
  const { lineups } = await get<LineupsIndex>("/api/lineups");
  assert.deepEqual(lineups[QUARTET], [5, 1]); // Debussy, Haydn, two from Open Opus, Hillborg from LIBRIS; Für Elise arranged
  assert.deepEqual(lineups[WIND_QUINTET], [3, 1]); // Nielsen, Barber, Sund; Tchaikovsky's waltz arranged
  const one = await get<{ description: string; sources: Record<string, string[]> }>(`/api/lineups/${QUARTET}`);
  assert.equal(one.description, "2 violins, viola, cello");
  assert.deepEqual(Object.keys(one.sources).sort(), ["imslp", "libris", "openopus"]);
});

test("works for a line-up: most established first, any spelling of the line-up", async () => {
  const page = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1`);
  assert.equal(page.total, 5);
  assert.equal(page.works[0]!.title, "String Quartet in G minor, Op.10"); // 500 recordings, Wikipedia article
  assert.deepEqual(page.works.map((w) => w.arrangement), [false, false, false, false, false]);
  for (let i = 1; i < page.works.length; i++) assert.ok(page.works[i]!.score <= page.works[i - 1]!.score);
  assert.equal(page.works[0]!.scoreUrl, "https://imslp.org/wiki/String_Quartet_in_G_minor%2C_Op.10_(Debussy%2C_Claude)");
  assert.deepEqual(page.facets!.eras, { Romantic: 3, Classical: 1, Modern: 1 });

  const same = await get<WorksPage>("/api/works?lineup=violin:2,viola,cello");
  assert.deepEqual(same.works, page.works.slice(0, same.works.length));
  const withArr = await get<WorksPage>(`/api/works?lineup=${QUARTET}&arrangements=1`);
  assert.equal(withArr.total, 6);
  assert.equal(withArr.works.at(-1)!.title, "Für Elise, WoO 59"); // arrangements after originals
});

test("filters, sorts and pages", async () => {
  const romantic = await get<WorksPage>(`/api/works?lineup=${QUARTET}&era=Romantic`);
  assert.equal(romantic.total, 3);
  const free = await get<WorksPage>(`/api/works?lineup=${QUARTET}&show=free`);
  assert.deepEqual(free.works.map((w) => w.title).sort(), ["String Quartet No.62, Op.76 No.3", "String Quartet in G minor, Op.10"]);
  const byTitle = await get<WorksPage>(`/api/works?lineup=${QUARTET}&sort=title`);
  assert.deepEqual(byTitle.works.map((w) => w.title), [...byTitle.works.map((w) => w.title)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  // Picking a composer narrows the list, but the composer facet still offers them all
  const all = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1`);
  const one = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1&composer=${all.facets!.composers[0]!.id}`);
  assert.ok(one.total < all.total);
  assert.deepEqual(one.facets!.composers, all.facets!.composers);
  // The picked composer comes first, so the facet's limit never leaves them out
  const last = all.facets!.composers.at(-1)!;
  const lastPicked = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1&composer=${last.id}`);
  assert.deepEqual(lastPicked.facets!.composers, [last, ...all.facets!.composers.slice(0, -1)]);
  // A picked composer with nothing for this line-up is still named, with no works, first
  const quintets = await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}&facets=1`);
  const other = all.facets!.composers.find((c) => !quintets.facets!.composers.some((q) => q.id === c.id))!;
  const none = await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}&facets=1&composer=${other.id}`);
  assert.equal(none.total, 0);
  assert.deepEqual(none.facets!.composers, [{ id: other.id, name: other.name, count: 0 }, ...quintets.facets!.composers]);
  // A composer's own list (no line-up) counts only them, not the whole dataset
  const own = await get<WorksPage>(`/api/works?composer=${all.facets!.composers[0]!.id}&facets=1`);
  assert.deepEqual(own.facets!.composers.map((c) => c.id), [all.facets!.composers[0]!.id]);
  const titleDesc = await get<WorksPage>(`/api/works?lineup=${QUARTET}&sort=title&order=desc`);
  assert.deepEqual(titleDesc.works.map((w) => w.title), byTitle.works.map((w) => w.title).reverse());
  const years = async (order: string) =>
    (await get<WorksPage>(`/api/works?lineup=${QUARTET}&sort=chronological${order}`)).works.map((w) => w.year).filter((y) => y !== null);
  const oldest = await years("");
  assert.deepEqual(oldest, [...oldest].sort((x, y) => x! - y!));
  assert.deepEqual(await years("&order=desc"), [...oldest].reverse()); // works without a year stay last
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
      [5, "Per spelman, variationer för blåskvintett"],
      [3, "Trio for Flute, Oboe and Piano"],
      [2, "Sonata in E minor, HWV 359b"],
      [1, "Für Elise, WoO 59"],
    ],
  );
  assert.deepEqual(
    page.facets!.lineups.map((l) => [l.key, l.count]),
    [
      ["bassoon,clarinet,flute,horn,oboe,piano", 1],
      [WIND_QUINTET, 3],
      ["flute,oboe,piano", 1],
      ["flute,piano", 1],
      ["piano", 1],
    ],
  );
  const twoPlus = await get<WorksPage>(`/api/works?lineup=flute,oboe,clarinet,bassoon,horn,piano&subsets=1&min_players=2`);
  assert.equal(twoPlus.total, 6);
});

test("orchestral works an orchestra can play, or scored for exactly it; how many have no known scoring", async () => {
  const titles = async (q: string) => {
    const page = await get<WorksPage>(`/api/works?lineup=orchestra&${q}`);
    return [page.works.map((w) => w.title).sort(), page.unscored];
  };
  const fit = (s: string) => `orchestra=${encodeURIComponent(s)}`;
  // Brahms 1 needs a contrabassoon: a third bassoonist isn't one, unless we say so
  assert.deepEqual(await titles(fit("2.2.2.3 4.2.3.0 timp hp str")), [[], 1]);
  assert.deepEqual(await titles(fit("2.2.2.2+cbn 4.2.3.0 timp hp str")), [["Symphony No.1, Op.68"], 1]);
  // Brahms 4 needs a piccolo and percussion: our third flautist doubling piccolo will do.
  // Olsen's scoring isn't known (only the string parts are on IMSLP)
  assert.deepEqual(await titles(fit("3.2.2.2+cbn 4.2.3.1 timp perc hp str")), [["Symphony No.1, Op.68"], 1]);
  assert.deepEqual(await titles(fit("3/picc.2.2.2+cbn 4.2.3.1 timp perc hp str")), [["Symphony No.1, Op.68", "Symphony No.4, Op.98"], 1]);
  assert.deepEqual(await titles(`${fit("2.2.2.2+cbn 4.2.3.0 timp hp str")}&fit=exact`), [["Symphony No.1, Op.68"], 1]);
  assert.deepEqual(await titles(fit("2.2.2.2 2.2.0.0 timp str")), [[], 1]);
  // Smaller groups: string orchestra works too, when the orchestra has strings
  const smaller = await get<WorksPage>(`/api/works?lineup=orchestra&subsets=1&${fit("2.2.2.2+cbn 4.2.3.0 timp hp str")}`);
  assert.deepEqual(smaller.works.map((w) => w.title).sort(), ["Serenade for Strings, Op.48", "Symphony No.1, Op.68"]);
  assert.equal(smaller.works.find((w) => w.lineup === "orchestra")!.orchestration, "2.2.2.2+cbn – 4.2.3.0 – timp – hp – str");
  await assert.rejects(get(`/api/works?lineup=orchestra&orchestra=lots`), /400/);
});

test("facets count with the other filters applied, but not their own", async () => {
  const fit = `orchestra=${encodeURIComponent("2.2.2.2+cbn 4.2.3.0 timp hp str")}`;
  const all = await get<WorksPage>("/api/works?lineup=orchestra&facets=1");
  const fitting = await get<WorksPage>(`/api/works?lineup=orchestra&facets=1&${fit}`);
  assert.equal(all.facets!.eras.Romantic, 3);
  assert.equal(fitting.facets!.eras.Romantic, 1); // only Brahms 1 fits
  // Picking an era doesn't empty the other eras' counts, nor its own
  const romantic = await get<WorksPage>(`/api/works?lineup=orchestra&facets=1&${fit}&era=Romantic`);
  assert.deepEqual(romantic.facets!.eras, fitting.facets!.eras);
  // Eras the other filters leave empty are still listed, with 0
  const free = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1&composer=${all.facets!.composers[0]!.id}`);
  assert.ok(Object.values(free.facets!.eras).includes(0));
  assert.deepEqual(Object.keys(free.facets!.eras).sort(), Object.keys((await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1`)).facets!.eras).sort());
});

test("searching without a line-up: best matches first, with filters and the line-ups they're for", async () => {
  const page = await get<WorksPage>("/api/works?q=brahms&sort=relevance&facets=1&arrangements=1");
  const search = await get<SearchResults>("/api/search?q=brahms&limit=50");
  assert.deepEqual(page.works.map((w) => w.id), search.works.map((w) => w.id)); // the search's own order
  assert.equal(page.total, search.total);
  assert.ok(page.facets!.lineups.some((l) => l.key === "orchestra" && l.count === 2), JSON.stringify(page.facets!.lineups));
  assert.deepEqual(page.facets!.composers.map((c) => c.name), ["Johannes Brahms", "Pyotr Tchaikovsky"]); // a work Brahms arranged
  assert.equal(page.works.at(-1)!.title, "Serenade for Strings, Op.48"); // after his own
  const romantic = await get<WorksPage>("/api/works?q=brahms&sort=relevance&facets=1&arrangements=1&lineup=&era=Romantic");
  assert.ok(romantic.total > 0 && romantic.works.every((w) => w.era === "Romantic"));
  // Without a search, best match means nothing: established first
  assert.deepEqual(
    (await get<WorksPage>(`/api/works?lineup=${QUARTET}&sort=relevance`)).works.map((w) => w.id),
    (await get<WorksPage>(`/api/works?lineup=${QUARTET}`)).works.map((w) => w.id),
  );
});

test("a big line-up's unfiltered facets come precomputed, the same as counted", async () => {
  const { path: copy } = buildFixture(true);
  await precomputeFacets(copy, 1);
  const pre = sqliteDb(copy);
  const ask = async (d: typeof db, q: string) => (await (await handleApi(new Request(`http://test/api/works?${q}`), d)).json()) as WorksPage;
  for (const q of [`lineup=${QUARTET}&facets=1`, `lineup=${QUARTET}&facets=1&arrangements=1`, "lineup=orchestra&facets=1"]) {
    resetCaches();
    const counted = await ask(db, q);
    resetCaches();
    assert.deepEqual(await ask(pre, q), counted, q);
  }
  // And they are what's read (not counted again)
  const w = new DatabaseSync(copy);
  w.prepare("UPDATE lineup_facets SET total = 999 WHERE lineup = ? AND arrangements = 0").run(QUARTET);
  w.close();
  resetCaches();
  assert.equal((await ask(pre, `lineup=${QUARTET}&facets=1`)).total, 999);
  resetCaches();
  pre.close();
});

test("duration: filters and sort", async () => {
  const page = await get<WorksPage>(`/api/works?composer=${(await get<SearchResults>("/api/search?q=brahms")).composers[0]!.id}&sort=duration&order=desc`);
  assert.deepEqual(page.works.map((w) => [w.title, w.duration, w.movements]).slice(0, 1), [["Symphony No.1, Op.68", 2700, 4]]);
  const short = await get<WorksPage>(`/api/works?lineup=${QUARTET}&max_duration=30&facets=1`);
  assert.deepEqual(short.works.map((w) => [w.title, w.duration]), [["String Quartet No.62, Op.76 No.3", 1200]]);
  // Counts per length, and the works whose length we don't know
  const all = await get<WorksPage>(`/api/works?lineup=${QUARTET}&facets=1`);
  assert.deepEqual(all.facets!.lengths, { known: [0, 0, 1, 0], unknown: all.total - 1 });
  assert.equal((await get<WorksPage>(`/api/works?lineup=${QUARTET}&min_duration=10&max_duration=20`)).total, 0); // 20 minutes is in 20–40
  assert.equal((await get<WorksPage>(`/api/works?lineup=${QUARTET}&duration=unknown`)).total, all.total - 1);
});

test("facets never change the total, and paging through yields exactly that many works", async () => {
  // Tchaikovsky's Serenade is an original for strings and an arrangement (by Jerkert) for
  // wind quintet: with both line-ups in reach, searching for Jerkert among originals finds
  // nothing, as the row that's an original isn't the row that's his.
  const queries = [
    `lineup=bassoon,clarinet,flute,horn,oboe,strings&subsets=1&q=jerkert`,
    `lineup=bassoon,clarinet,flute,horn,oboe,strings&subsets=1&q=jerkert&arrangements=1`,
    `lineup=bassoon,clarinet,flute,horn,oboe,strings&subsets=1`,
    `lineup=bassoon,clarinet,flute,horn,oboe,strings&subsets=1&q=serenade`,
    `lineup=${WIND_QUINTET}&q=jerkert`,
    `lineup=${WIND_QUINTET}&q=jerkert&arrangements=1&era=Romantic`,
    `lineup=${QUARTET}&arrangements=1&show=free`,
    `lineup=orchestra&orchestra=2.2.2.2,4.2.3.1,timp,str`,
    `lineup=orchestra&orchestra=2.2.2.2,4.2.3.1,timp,str&fit=exact&arrangements=1`,
    `q=jerkert`,
    `q=tchaikovsky&arrangements=1`,
    `q=brahms`,
  ];
  for (const query of queries) {
    const faceted = await get<WorksPage>(`/api/works?${query}&facets=1`);
    const plain = await get<WorksPage>(`/api/works?${query}`);
    assert.equal(faceted.total, plain.total, query);
    const ids = new Set<string>();
    for (let offset = 0; offset <= plain.total + 1; offset += 2) {
      const page = await get<WorksPage>(`/api/works?${query}&limit=2&offset=${offset}`);
      for (const w of page.works) ids.add(w.id);
      if (!page.works.length) break;
    }
    assert.equal(ids.size, plain.total, query);
  }
  // The case the review found: an original row and an arranger's row of one work
  const mixed = await get<WorksPage>(`/api/works?${queries[0]}&facets=1`);
  assert.equal(mixed.total, 0);
  assert.deepEqual(mixed.facets!.composers, []);
  assert.equal(mixed.facets!.arrangements, 1);
});

test("arrangements say who arranged them; searching finds them by arranger", async () => {
  // On the line-up's list, an arrangement row says whose it is, and of what
  const arranged = await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}&arrangements=1`);
  const serenade = arranged.works.find((w) => w.title === "Serenade for Strings, Op.48")!;
  assert.deepEqual(serenade.arrangedBy, [{ arranger: "Jesper Jerkert", excerpt: "Waltz (No.2)" }]);
  assert.ok(arranged.works.filter((w) => !w.arrangement).every((w) => !w.arrangedBy)); // originals don't
  // Searching for the arranger: the work, and which arrangement it's found by
  // A work found by its arranger is an arrangement: listed with them, counted without
  const originals = await get<WorksPage>("/api/works?q=jerkert&sort=relevance&facets=1");
  assert.equal(originals.total, 0);
  assert.equal(originals.facets!.arrangements, 1);
  const found = await get<WorksPage>("/api/works?q=jerkert&sort=relevance&facets=1&arrangements=1");
  assert.equal(found.facets!.arrangements, 1);
  assert.deepEqual(
    found.works.map((w) => [w.title, w.arrangedBy]),
    [["Serenade for Strings, Op.48", [{ arranger: "Jesper Jerkert", excerpt: "Waltz (No.2)", lineup: "flute, oboe, clarinet, bassoon, horn" }]]],
  );
  // The work page lists them all, in IMSLP's order
  const w = await get<WorkDetail>(`/api/works/${serenade.id}`);
  assert.deepEqual(w.arrangements.map((a) => [a.lineup, a.arranger, a.excerpt]), [
    ["piano 4 hands", "Johannes Brahms", null],
    [WIND_QUINTET, "Jesper Jerkert", "Waltz (No.2)"],
    [null, null, null],
  ]);
  // Within the line-up: the arranger's name finds the arrangement rows, not originals
  assert.deepEqual((await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}&arrangements=1&q=jerkert`)).works.map((w) => w.title), ["Serenade for Strings, Op.48"]);
  assert.equal((await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}&q=jerkert&facets=1`)).facets!.arrangements, 1);
  // Facets count the works only arranged for the line-up, listed or not
  for (const arr of ["0", "1"]) {
    const page = await get<WorksPage>(`/api/works?lineup=${WIND_QUINTET}&arrangements=${arr}&facets=1&era=Romantic`);
    assert.equal(page.facets!.arrangements, 1, `arrangements=${arr}`); // Tchaikovsky's waltz
    assert.equal(page.total, arr === "1" ? 2 : 1); // and Nielsen
  }
  // A composer's page: the works they arranged, if asked
  const brahms = (await get<SearchResults>("/api/search?q=brahms")).composers[0]!;
  assert.equal((await get<ComposerDetail>(`/api/composers/${brahms.id}`)).arranged, 1);
  const own = await get<WorksPage>(`/api/works?composer=${brahms.id}&arrangements=1`);
  const withArranged = await get<WorksPage>(`/api/works?composer=${brahms.id}&arrangements=1&arranged_by=1`);
  assert.equal(withArranged.total, own.total + 1);
  const theirs = withArranged.works.find((w) => w.composer?.name !== "Johannes Brahms")!;
  assert.equal(theirs.title, "Serenade for Strings, Op.48");
  assert.deepEqual(theirs.arrangedBy, [{ arranger: "Johannes Brahms", excerpt: null, lineup: "piano four hands" }]);
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
  assert.deepEqual(w.links.map((l) => [l.provider, l.kind]), [["imslp", "score"], ["libris", "library"], ["rism", "library"], ["rism", "library"], ["openopus", "data"]]);
  assert.match(w.links[2]!.label!, /^Autograph manuscript/); // the composer's own hand first
  assert.equal(w.orchestration, null);
  const symphony = await get<WorkDetail>(`/api/works/${(await get<SearchResults>("/api/search?q=brahms op 98")).works[0]!.id}`);
  assert.deepEqual(symphony.orchestration, {
    scoring: "2+picc.2.2.2+cbn – 4.2.3.0 – timp – perc – str",
    instruments: { fl: 2, picc: 1, ob: 2, cl: 2, bn: 2, cbn: 1, hn: 4, tpt: 2, tbn: 3, timp: 1, perc: 1, str: 1 },
    status: "single",
    basis: "a library's copy",
    unresolved: [],
    source: "rism",
    ref: "9004",
    url: "https://rism.online/sources/9004",
  });
  assert.ok(Math.abs(w.scoreParts.reduce((s, p) => s + p.points, 0) - w.score) < 0.2);
});

test("a composer: line-ups with counts; their works", async () => {
  const s = await get<SearchResults>("/api/search?q=brahms");
  const c = await get<ComposerDetail>(`/api/composers/${s.composers[0]!.id}`);
  assert.equal(c.name, "Johannes Brahms");
  assert.equal(c.sortName, "Brahms, Johannes");
  assert.equal(c.works, 4);
  assert.deepEqual(c.lineups.map((l) => l.key).sort(), ["cello,clarinet,viola,violin*2", QUARTET, "orchestra"]);
  assert.deepEqual(c.links.map((l) => l.provider).sort(), ["imslp", "rism", "wikidata", "wikipedia"]);
  const works = await get<WorksPage>(`/api/works?composer=${c.id}`);
  assert.equal(works.total, 4);
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

test("retired ids answer 410, saying what they were and what they may be", async () => {
  const quartet = (await get<WorksPage>(`/api/works?lineup=${QUARTET}`)).works[0]!;
  const rw = new DatabaseSync(path);
  rw.prepare("INSERT INTO retired VALUES ('work', 'zzzzzzz1', 'Quartet', 'Nobody', '20261101T000000Z', 'uncertain', ?)").run(JSON.stringify([quartet.id]));
  rw.close();
  const gone = await get<{ gone: Gone }>("/api/works/zzzzzzz1", 410);
  assert.deepEqual(gone.gone.seeAlso.map((w) => w.id), [quartet.id]);
  assert.equal(gone.gone.reason, "uncertain");
  await get("/api/works/zzzzzzz2", 404);
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
  // Inherited object properties aren't sorts (they used to be a 500)
  for (const sort of ["constructor", "toString", "__proto__", "nonsense"]) await get(`/api/works?lineup=violin&sort=${sort}`, 400);
  await get("/api/works?lineup=violin&order=sideways", 400);
  await get("/api/works?lineup=violin&fit=loose", 400);
  await get("/api/works?lineup=violin&show=some", 400);
  // Odd search input is safe: quotes and operators are words, not FTS syntax.
  assert.deepEqual((await get<SearchResults>(`/api/search?q=${encodeURIComponent('"op" OR NEAR( * -')}`)).works.length >= 0, true);
  const res = await handleApi(new Request("http://test/api/meta", { method: "POST" }), db);
  assert.equal(res.status, 405);
});
