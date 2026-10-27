// Identity across sources and builds, on real records that once went wrong: different
// compositions merged by a generic title (Williams's concertos, Morricone's studies),
// works dropped for sharing a line-up with an unrelated one, composers split in two,
// and ids lost when a composer had no link to persist them by.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fixtureInput } from "../test/fixtures.ts";
import { build, NONE, readPrevious, type BuildInput, type Previous } from "./build.ts";
import type { GndWork } from "./sources/gnd.ts";

const dir = mkdtempSync(join(tmpdir(), "identity-test-"));
let n = 0;
const T = new Date("2026-10-02T00:00:00Z");

function run(input: BuildInput, previous: Previous = NONE) {
  const path = join(dir, `${n++}.sqlite`);
  build(input, path, previous, T);
  const db = new DatabaseSync(path, { readOnly: true });
  const all = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args).map((r) => ({ ...r })) as Record<string, any>[];
  return { path, db, all };
}

const gndWork = (id: string, name: string, composer: string, media: [string, number][], year: number | null, variants: string[] = []): GndWork => ({
  id, name, variants, composer, media: media.map(([name, count]) => ({ name, count })), performers: null, opus: [], catalogue: [], key: null, year, wikidata: null,
});

// The GND records, as the German National Library has them
const WILLIAMS = "129198536";
const MORRICONE = "119011328";
const CONCERTOS = [
  gndWork("1065275560", "Konzerte, Horn, Orchester (2003)", WILLIAMS, [["Horn", 1], ["Orchester", 1]], null),
  gndWork("1065753683", "Konzerte, Tuba, Orchester", WILLIAMS, [["Tuba", 1], ["Orchester", 1]], 1985, ["Konzerte, Tb, Orch (1985)", "Konzerte, Tuba, Orchester (1985)"]),
  gndWork("1253954062", "Konzerte, Oboe, Orchester (2011)", WILLIAMS, [["Oboe", 1], ["Orchester", 1]], 2011, ["Concerto for oboe"]),
  gndWork("1297566378", "Konzerte, Trompete, Orchester (1996)", WILLIAMS, [["Trompete", 1], ["Orchester", 1]], 1996),
];
const STUDIES = [
  gndWork("1172570450", "Studien, Querflöte, Klarinette, Fagott", MORRICONE, [["Querflöte", 1], ["Klarinette", 1], ["Fagott", 1]], 1958, ["Tre studi per flauto, clarinetto e fagotto", "Studien, Fl, Klar, Fg (1958)"]),
  gndWork("1227227175", "Studien, Kontrabass (1989)", MORRICONE, [["Kontrabass", 1]], 1989),
];
const ORCHESTRAL = [
  gndWork("1084363356", "Olympic fanfare and theme", WILLIAMS, [["Orchester", 1]], 1984),
  gndWork("1230495053", "Happy birthday variations", WILLIAMS, [["Orchester", 1]], 1995, ["Variationen, Orchester (1995)"]),
];

/** The fixture crawl with these GND records, and Williams and Morricone as GND knows them */
function withGnd(works: GndWork[], extra: (i: BuildInput) => void = () => {}): BuildInput {
  const input = fixtureInput();
  input.gnd = {
    fetchedAt: 0,
    works,
    composers: {
      [WILLIAMS]: { gnd: WILLIAMS, qid: "Q131285", label: "John Williams", imslp: null, born: 1932, died: null, sitelinks: 90 },
      [MORRICONE]: { gnd: MORRICONE, qid: "Q23848", label: "Ennio Morricone", imslp: null, born: 1928, died: 2020, sitelinks: 94 },
    },
  };
  extra(input);
  return input;
}

const summary = (all: ReturnType<typeof run>["all"], composer: string) =>
  all(
    `SELECT w.title, w.year, group_concat(s.lineup, ' | ') AS lineups, (SELECT group_concat(ref) FROM links l WHERE l.entity = 'work' AND l.entity_id = w.id AND l.provider = 'gnd') AS gnd
     FROM works w JOIN composers c ON c.id = w.composer_id JOIN scorings s ON s.work_id = w.id WHERE c.name = ? GROUP BY w.id ORDER BY w.year`,
    composer,
  );

test("a generic title doesn't make one work of compositions for different instruments, in either order", () => {
  const expected = [
    { title: "Concerto", year: 1985, lineups: "orchestra,tuba", gnd: "1065753683" },
    { title: "Concerto", year: 1996, lineups: "orchestra,trumpet", gnd: "1297566378" },
    { title: "Concerto", year: 2003, lineups: "horn,orchestra", gnd: "1065275560" }, // the year only its name gives
    { title: "Concerto", year: 2011, lineups: "oboe,orchestra", gnd: "1253954062" },
  ];
  assert.deepEqual(summary(run(withGnd(CONCERTOS)).all, "John Williams"), expected);
  assert.deepEqual(summary(run(withGnd([...CONCERTOS].reverse())).all, "John Williams"), expected);

  const studies = [
    { title: "Studien", year: 1958, lineups: "bassoon,clarinet,flute", gnd: "1172570450" },
    { title: "Studien", year: 1989, lineups: "double bass", gnd: "1227227175" },
  ];
  for (const order of [STUDIES, [...STUDIES].reverse()]) assert.deepEqual(summary(run(withGnd(order)).all, "Ennio Morricone"), studies);
});

test("a work that might be one we have under another name stays out; unrelated ones for the same line-up come in", () => {
  // Williams already has an orchestral work on IMSLP, with an unrelated title
  const seeded = (works: GndWork[]) =>
    withGnd(works, (i) => {
      i.gnd!.composers[WILLIAMS]!.imslp = "Williams,_John";
      i.imslp.members["For orchestra"]!.push(30);
      i.imslp.works[30] = { pageid: 30, title: "Summon the Heroes (Williams, John)", era: "Modern" as never, recorded: false, audio: false };
      // Another fanfare: of one genre, but each title says which
      i.imslp.members["For orchestra"]!.push(32);
      i.imslp.works[32] = { pageid: 32, title: "Liberty Fanfare (Williams, John)", era: "Modern" as never, recorded: false, audio: false };
    });
  const titles = (works: GndWork[]) => summary(run(seeded(works)).all, "John Williams").map((w) => w.title).sort();
  // The old rule let only the first of these in: any unnumbered work for the line-up blocked the rest
  for (const order of [ORCHESTRAL, [...ORCHESTRAL].reverse()]) assert.deepEqual(titles(order), ["Happy birthday variations", "Liberty Fanfare", "Olympic fanfare and theme", "Summon the Heroes"]);
  // One whose title leaves room to be the IMSLP work stays out: a word in common, or the
  // same genre with one title saying no more than that. Another genre comes in.
  const heroes = gndWork("9000000003", "Heroes", WILLIAMS, [["Orchester", 1]], null);
  const symphony = gndWork("9000000001", "Sinfonien, Orchester", WILLIAMS, [["Orchester", 1]], null);
  assert.deepEqual(titles([heroes, symphony]), ["Liberty Fanfare", "Summon the Heroes", "Symphony"]);
  const concerto = gndWork("9000000004", "Konzerte, Orchester", WILLIAMS, [["Orchester", 1]], null);
  const withConcerto = withGnd([concerto], (i) => {
    i.gnd!.composers[WILLIAMS]!.imslp = "Williams,_John";
    i.imslp.members["For orchestra"]!.push(31);
    i.imslp.works[31] = { pageid: 31, title: "Concerto for Orchestra (Williams, John)", era: "Modern" as never, recorded: false, audio: false };
  });
  assert.deepEqual(summary(run(withConcerto).all, "John Williams").map((w) => w.title), ["Concerto for Orchestra"]);
  // Concertos naming different soloists aren't one, whatever the line-up says
  const forHarpsichord = gndWork("9000000005", "Konzerte, Cembalo obbligato, Orchester", WILLIAMS, [["Cembalo", 1], ["Orchester", 1]], null);
  const cello = withGnd([forHarpsichord], (i) => {
    i.gnd!.composers[WILLIAMS]!.imslp = "Williams,_John";
    i.imslp.members["For orchestra with soloists"] = [33];
    i.imslp.works[33] = { pageid: 33, title: "Cello Concerto (Williams, John)", era: "Modern" as never, recorded: false, audio: false };
  });
  assert.deepEqual(summary(run(cello).all, "John Williams").map((w) => w.title).sort(), ["Cello Concerto", "Concerto, Cembalo obbligato"]);
});

test("GND's original titles become searchable aliases; its catalogue forms don't", () => {
  const { all } = run(withGnd(STUDIES));
  const aliases = all("SELECT w.aliases FROM works w JOIN links l ON l.entity_id = w.id WHERE l.ref = '1172570450'")[0]!.aliases;
  assert.deepEqual(JSON.parse(aliases), ["Tre studi per flauto, clarinetto e fagotto"]);
  const found = all("SELECT w.title FROM works_fts f JOIN works w ON w.n = f.rowid WHERE works_fts MATCH ?", '"tre"* "studi"*');
  assert.deepEqual(found, [{ title: "Studien" }]);
});

test("a work split apart keeps its id on the part it showed; the URL of a record left out keeps working", () => {
  // The dataset before: the four concertos as one work, id aaaaaaaa, showing 1985
  const previous: Previous = {
    ...NONE,
    work: { anchors: new Map(CONCERTOS.map((g) => [`gnd:${g.id}`, "aaaaaaaa"])), redirects: new Map() },
    works: new Map([["aaaaaaaa", { title: "Concerto", year: 1985 }]]),
    composers: new Map(),
  };
  const { all } = run(withGnd(CONCERTOS), previous);
  const ids = all("SELECT w.id, w.year FROM works w JOIN composers c ON c.id = w.composer_id WHERE c.name = 'John Williams' ORDER BY w.year");
  assert.equal(ids.find((w) => w.year === 1985)!.id, "aaaaaaaa");
  assert.equal(new Set(ids.map((w) => w.id)).size, 4);
  assert.deepEqual(all("SELECT * FROM redirects"), []);
});

test("composer ids survive a new source naming them, also from datasets without the anchors table", () => {
  const first = run(fixtureInput());
  const dvorak = () => first.all("SELECT id FROM composers WHERE name = 'Antonín Dvořák'")[0]!.id;
  const before = dvorak();
  assert.deepEqual(first.all("SELECT * FROM links WHERE entity = 'composer' AND entity_id = ?", before), []); // nothing to link to…
  assert.ok(first.all("SELECT * FROM anchors WHERE entity = 'composer' AND entity_id = ?", before).length > 0); // …but anchored

  // Wikidata now has Dvořák
  const later = fixtureInput();
  later.wikidata!.composers.Q7298 = { qid: "Q7298", label: "Antonín Dvořák", born: 1841, died: 1904, sitelinks: 140 } as never;
  const second = run(later, readPrevious(first.path)!);
  assert.equal(second.all("SELECT id FROM composers WHERE name = 'Antonín Dvořák'")[0]!.id, before);

  // A dataset from before the anchors table: its name and dates still find it
  const legacy = join(dir, "legacy.sqlite");
  first.db.close();
  const copy = new DatabaseSync(first.path);
  copy.exec(`VACUUM INTO '${legacy}'`);
  copy.close();
  const old = new DatabaseSync(legacy);
  old.exec("DROP TABLE anchors");
  old.close();
  const third = run(later, readPrevious(legacy)!);
  assert.equal(third.all("SELECT id FROM composers WHERE name = 'Antonín Dvořák'")[0]!.id, before);
});

test("an id whose records leave the sources is kept, and claimed again when they come back", () => {
  const first = run(fixtureInput());
  const hillborg = (r: ReturnType<typeof run>) => r.all("SELECT id FROM works WHERE title = 'Kongsgaard variations, for string quartet'")[0]?.id;
  const id = hillborg(first);
  const gone = fixtureInput();
  gone.libris!.records = gone.libris!.records.filter((r) => !r.id.startsWith("lbkv"));
  const second = run(gone, readPrevious(first.path)!);
  assert.equal(hillborg(second), undefined);
  assert.deepEqual(second.all("SELECT entity_id, position FROM anchors WHERE anchor = 'libris:lbkv1'"), [{ entity_id: id, position: -1 }]);
  const third = run(fixtureInput(), readPrevious(second.path)!);
  assert.equal(hillborg(third), id);
});

test("one composer, though Open Opus and GND come to them separately", () => {
  const input = withGnd([gndWork("9000000002", "Symphony, Nr. 3", "119322455", [["Orchester", 1]], 1939)], (i) => {
    i.gnd!.composers["119322455"] = { gnd: "119322455", qid: "Q959136", label: "Roy Harris", imslp: null, born: 1898, died: 1979, sitelinks: 19 };
    i.openopus!.composers.push({
      name: "Harris", completeName: "Roy Harris", epoch: "20th Century", born: 1898, died: 1979, popular: false,
      works: [{ id: "oo-harris-1", title: "String Quartet no. 3", genre: "Chamber", popular: false, recommended: false }],
    } as never);
  });
  const { all } = run(input);
  assert.deepEqual(all("SELECT name, born, died, works FROM composers WHERE name = 'Roy Harris'"), [{ name: "Roy Harris", born: 1898, died: 1979, works: 2 }]);
});

test("a record left out after having a page: its URL says what it was and what it may be", () => {
  const input = withGnd([gndWork("9000000003", "Heroes", WILLIAMS, [["Orchester", 1]], null)], (i) => {
    i.gnd!.composers[WILLIAMS]!.imslp = "Williams,_John";
    i.imslp.members["For orchestra"]!.push(30);
    i.imslp.works[30] = { pageid: 30, title: "Summon the Heroes (Williams, John)", era: "Modern" as never, recorded: false, audio: false };
  });
  // Before, "Heroes" was a work of its own
  const previous: Previous = {
    ...NONE,
    work: { anchors: new Map([["gnd:9000000003", "bbbbbbbb"]]), redirects: new Map() },
    works: new Map([["bbbbbbbb", { title: "Heroes", year: null, composer: "John Williams" }]]),
    composers: new Map(),
  };
  const { all } = run(input, previous);
  const heroes = all("SELECT id FROM works WHERE title = 'Summon the Heroes'")[0]!.id;
  assert.deepEqual(all("SELECT entity, id, title, composer, reason, see_also FROM retired"), [
    { entity: "work", id: "bbbbbbbb", title: "Heroes", composer: "John Williams", reason: "uncertain", see_also: JSON.stringify([heroes]) },
  ]);
  assert.deepEqual(all("SELECT * FROM redirects WHERE old_id = 'bbbbbbbb'"), []); // not a redirect: it may not be that work
  // Still retired in the next build; live again if it comes back
  const again = run(input, readPrevious(run(input, previous).path)!);
  assert.equal(again.all("SELECT reason FROM retired WHERE id = 'bbbbbbbb'")[0]!.reason, "uncertain");
});

test("parts of works: a URL goes to the work; a number in a set we don't have is a work of its own", () => {
  const input = withGnd([
    ...STUDIES,
    gndWork("9000000010", "Studien, Querflöte, Klarinette, Fagott. Nr. 2", MORRICONE, [["Querflöte", 1], ["Klarinette", 1], ["Fagott", 1]], null),
    gndWork("9000000011", "Sonaten, Violoncello. Nr. 1", MORRICONE, [["Violoncello", 1]], null),
    gndWork("9000000012", "Lieder. Abendlied", MORRICONE, [["Singstimme", 1], ["Klavier", 1]], null),
  ]);
  const previous: Previous = {
    ...NONE,
    work: { anchors: new Map([["gnd:9000000010", "cccccccc"], ["gnd:9000000012", "dddddddd"]]), redirects: new Map() },
    works: new Map([["cccccccc", { title: "Studien, Nr. 2", year: null }], ["dddddddd", { title: "Lieder. Abendlied", year: null }]]),
    composers: new Map(),
  };
  const { all } = run(input, previous);
  const studies = all("SELECT w.id FROM works w JOIN links l ON l.entity_id = w.id WHERE l.ref = '1172570450'")[0]!.id;
  assert.deepEqual(all("SELECT old_id, new_id FROM redirects WHERE entity = 'work'"), [{ old_id: "cccccccc", new_id: studies }]);
  // A song of a set we don't have, and a number in one, come in on their own
  assert.deepEqual(all("SELECT id, reason FROM retired"), []);
  assert.equal(all("SELECT title FROM works WHERE id = 'dddddddd'")[0]?.title, "Abendlied");
  assert.deepEqual(summary(all, "Ennio Morricone").map((w) => w.title).sort(), ["Abendlied", "Sonata, No. 1", "Studien", "Studien"]);
  // A movement of one we don't have doesn't
  const movement = withGnd([gndWork("9000000013", "Suiten, Orchester. Ouvertüre", MORRICONE, [["Orchester", 1]], null)]);
  assert.deepEqual(summary(run(movement).all, "Ennio Morricone"), []);
});

// ---- Found in review: each a reproduction that once went wrong ---------------------------

/** The fixture with Williams on IMSLP too, and more works of his there */
const withImslp = (works: GndWork[], imslp: Record<number, string>, category = "For orchestra") =>
  withGnd(works, (i) => {
    i.gnd!.composers[WILLIAMS]!.imslp = "Williams,_John";
    for (const [id, title] of Object.entries(imslp)) {
      (i.imslp.members[category] ??= []).push(Number(id));
      i.imslp.works[Number(id)] = { pageid: Number(id), title: `${title} (Williams, John)`, era: "Modern" as never, recorded: false, audio: false };
    }
  });

test("GND records claiming one work are judged together, whatever their order", () => {
  const records = [
    gndWork("9000000020", "Elegy, Orchester (1950)", WILLIAMS, [["Orchester", 1]], 1950),
    gndWork("9000000021", "Elegy, Orchester (1960)", WILLIAMS, [["Orchester", 1]], 1960),
  ];
  const result = (order: GndWork[]) => {
    const { all } = run(withImslp(order, { 40: "Elegy" }));
    return all("SELECT w.title, w.year, (SELECT group_concat(ref) FROM (SELECT ref FROM links WHERE entity_id = w.id AND provider = 'gnd' ORDER BY ref)) AS gnd FROM works w WHERE title = 'Elegy'");
  };
  assert.deepEqual(result(records), result([...records].reverse()));
  // Each judged against the work as it was, undated: both are linked, and their years,
  // which disagree, leave it undated
  assert.deepEqual(result(records), [{ title: "Elegy", year: null, gnd: "9000000020,9000000021" }]);
});

test("GND's own duplicates, by number and line-up, are one work", () => {
  const haydn = [
    gndWork("300359381", "Divertimenti, Querflöte (2), Horn (2), Hob 2 D 5", WILLIAMS, [["Querflöte", 2], ["Horn", 2]], null),
    gndWork("1214383688", "Divertimenti, Querflöte (2), Horn (2), Hob 2 D 5 (D-Dur)", WILLIAMS, [["Querflöte", 2], ["Horn", 2]], null),
  ].map((g) => ({ ...g, catalogue: ["Hob II:D5"] }));
  const { all } = run(withGnd(haydn));
  assert.equal(all("SELECT COUNT(*) AS n FROM works w JOIN composers c ON c.id = w.composer_id WHERE c.name = 'John Williams'")[0]!.n, 1);
});

test("a part's record never gives its id to the work it's part of, even matched by number", () => {
  const song = gndWork("9000000030", "Moonlight test, op. 1. Lovely song", WILLIAMS, [["Singstimme", 1], ["Klavier", 1]], null);
  const first = run(withGnd([{ ...song, opus: ["op. 1"] }]));
  const songId = first.all("SELECT id FROM works WHERE title = 'Lovely song'")[0]!.id;
  // The collection appears on IMSLP: the song's URL goes there, the collection keeps an id of its own
  const second = run(withImslp([{ ...song, opus: ["op. 1"] }], { 41: "Moonlight test, Op.1" }, "For voice, piano"), readPrevious(first.path)!);
  const parent = second.all("SELECT id FROM works WHERE title = 'Moonlight test, Op.1'")[0]!.id;
  assert.notEqual(parent, songId);
  assert.deepEqual(second.all("SELECT new_id FROM redirects WHERE old_id = ?", songId), [{ new_id: parent }]);
});

test("a record that leaves its source for a while finds its id again, though another source held it meanwhile", () => {
  const fanfare = gndWork("9000000040", "Liberty fanfare", WILLIAMS, [["Orchester", 1]], 1986);
  const gndOnly = run(withGnd([fanfare]));
  const id = gndOnly.all("SELECT id FROM works WHERE title = 'Liberty fanfare'")[0]!.id;
  // IMSLP has it too: one work, the same id
  const both = run(withImslp([fanfare], { 42: "Liberty fanfare" }), readPrevious(gndOnly.path)!);
  assert.equal(both.all("SELECT id FROM works WHERE title = 'Liberty fanfare'")[0]!.id, id);
  // GND drops it for a build; then IMSLP does, and GND has it again
  const imslpOnly = run(withImslp([], { 42: "Liberty fanfare" }), readPrevious(both.path)!);
  const back = run(withGnd([fanfare]), readPrevious(imslpOnly.path)!);
  assert.equal(back.all("SELECT id FROM works WHERE title = 'Liberty fanfare'")[0]!.id, id);
});

test("ids merged into one that's now retired still lead to its page", () => {
  const heroes = gndWork("9000000003", "Heroes", WILLIAMS, [["Orchester", 1]], null);
  const previous: Previous = {
    ...NONE,
    work: { anchors: new Map([["gnd:9000000003", "bbbbbbbb"]]), redirects: new Map([["aaaaaaaa", "bbbbbbbb"]]) },
    works: new Map([["bbbbbbbb", { title: "Heroes", year: null, composer: "John Williams" }]]),
    composers: new Map(),
  };
  const { all } = run(withImslp([heroes], { 30: "Summon the Heroes" }), previous);
  assert.deepEqual(all("SELECT id, reason FROM retired"), [{ id: "bbbbbbbb", reason: "uncertain" }]);
  assert.deepEqual(all("SELECT old_id, new_id FROM redirects WHERE entity = 'work'"), [{ old_id: "aaaaaaaa", new_id: "bbbbbbbb" }]);
});

test("a composer known before only by name and dates keeps the URL, whatever the death year said", () => {
  // Before: a page for Brahms from a source with no link to keep, and a wrong death year
  // (as LIBRIS's Besozzi, 1775 for 1793): the anchor is the name and birth year alone
  const previous: Previous = {
    ...NONE,
    composer: { anchors: new Map([["name:johannes brahms|1833", "eeeeeeee"]]), redirects: new Map() },
    composers: new Map([["eeeeeeee", { name: "Johannes Brahms" }]]),
  };
  const { all } = run(fixtureInput(), previous);
  const brahms = all("SELECT id FROM composers WHERE name = 'Johannes Brahms'")[0]!.id;
  assert.ok(brahms === "eeeeeeee" || all("SELECT new_id FROM redirects WHERE old_id = 'eeeeeeee'")[0]?.new_id === brahms);
  assert.deepEqual(all("SELECT id FROM retired WHERE entity = 'composer'"), []);
});

test("GND's other names are titles too: Debussy's Estampien is his Estampes", () => {
  const debussy = "118524186";
  const input = withGnd([{ ...gndWork("30004190X", "Estampien, Klavier, L 100", debussy, [["Klavier", 1]], 1903, ["Les estampes", "Estampes"]), catalogue: ["L 100"] }], (i) => {
    i.gnd!.composers[debussy] = { gnd: debussy, qid: "Q10", label: "Claude Debussy", imslp: "Debussy,_Claude", born: 1862, died: 1918, sitelinks: 120 };
    i.imslp.members["For piano"]!.push(50);
    i.imslp.works[50] = { pageid: 50, title: "Estampes, CD 108 (Debussy, Claude)", era: "Early 20th century" as never, recorded: true, audio: false };
  });
  const { all } = run(input);
  assert.deepEqual(all("SELECT w.title FROM works w JOIN links l ON l.entity = 'work' AND l.entity_id = w.id WHERE l.provider = 'gnd' AND l.ref = '30004190X'"), [{ title: "Estampes, CD 108" }]);
});
