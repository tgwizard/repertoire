// A miniature crawl: a few real works as each source describes them, enough to
// exercise merging, line-up rules, ids, the API and search without the full dataset.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, NONE, readPrevious, type BuildInput, type BuildResult } from "../crawler/build.ts";

const T = Date.parse("2026-10-01T00:00:00Z");

const imslpWork = (pageid: number, title: string, era: string | null, recorded = false) => ({ pageid, title, era: era as never, recorded, audio: false });

/**
 * `later` is the next crawl: Wikidata now links Barber's Summer Music to its IMSLP
 * page and Barber to his IMSLP name, so two works and two composers merge.
 */
export function fixtureInput(later = false): BuildInput {
  return {
    imslp: {
      fetchedAt: T,
      categories: [],
      members: {
        "For 2 violins, viola, cello": [1, 2],
        "For 2 violins, viola, cello (arr)": [8],
        "For flute, oboe, clarinet, bassoon, horn": [5, 12],
        "For piano, flute, oboe, clarinet, bassoon, horn": [6],
        "For clarinet, 2 violins, viola, cello": [7],
        "For piano": [8],
        "For flute, piano": [9],
        "For violin, piano": [9],
        "For flute, oboe, piano": [13],
        "For 1 player": [8],
      },
      works: {
        1: imslpWork(1, "String Quartet in G minor, Op.10 (Debussy, Claude)", "Romantic", true),
        2: imslpWork(2, "String Quartet No.62, Op.76 No.3 (Haydn, Joseph)", "Classical", true),
        5: imslpWork(5, "Wind Quintet, Op.43 (Nielsen, Carl)", "Romantic", true),
        6: imslpWork(6, "Sextet, FP 100 (Poulenc, Francis)", "Early 20th century", true),
        7: imslpWork(7, "Clarinet Quintet, Op.115 (Brahms, Johannes)", "Romantic", true),
        8: imslpWork(8, "Für Elise, WoO 59 (Beethoven, Ludwig van)", "Classical", true),
        9: imslpWork(9, "Sonata in E minor, HWV 359b (Handel, George Frideric)", "Baroque"),
        12: imslpWork(12, "Summer Music, Op.31 (Barber, Samuel)", "Modern"),
        13: imslpWork(13, "Trio for Flute, Oboe and Piano (Lutosławski, Witold)", "Modern"),
      },
    },
    eras: {},
    wikipedia: {
      fetchedAt: T,
      members: {
        "Compositions for wind quintet": [
          { title: "Summer Music (Barber)", qid: "Q2" },
          { title: "Sextet (Poulenc)", qid: "Q3" },
        ],
      },
    },
    wikidata: {
      fetchedAt: T,
      composers: {
        Q10: { qid: "Q10", imslp: "Debussy, Claude", label: "Claude Debussy", born: 1862, died: 1918, wikipedia: "Claude Debussy", sitelinks: 120 },
        Q11: { qid: "Q11", imslp: "Brahms, Johannes", label: "Johannes Brahms", born: 1833, died: 1897, wikipedia: "Johannes Brahms", sitelinks: 130 },
        Q12: { qid: "Q12", imslp: later ? "Barber, Samuel" : undefined, label: "Samuel Barber", born: 1910, died: 1981, wikipedia: "Samuel Barber", sitelinks: 60 },
        Q13: { qid: "Q13", imslp: "Poulenc, Francis", label: "Francis Poulenc", born: 1899, died: 1963, sitelinks: 70 },
      },
      works: {
        Q1: { qid: "Q1", imslp: "String Quartet in G minor, Op.10 (Debussy, Claude)", label: "String Quartet", composer: "Q10", year: 1893, musicbrainz: "mb-debussy", wikipedia: "String Quartet (Debussy)", sitelinks: 20, ensembles: [], instruments: [] },
        Q2: { qid: "Q2", imslp: later ? "Summer Music, Op.31 (Barber, Samuel)" : undefined, label: "Summer Music", composer: "Q12", year: 1956, wikipedia: "Summer Music (Barber)", sitelinks: 5, ensembles: [], instruments: [] },
        Q3: { qid: "Q3", imslp: "Sextet, FP 100 (Poulenc, Francis)", label: "Sextet", composer: "Q13", year: 1932, wikipedia: "Sextet (Poulenc)", sitelinks: 8, ensembles: [], instruments: [] },
      },
    },
    openopus: {
      fetchedAt: T,
      composers: [
        {
          name: "Brahms",
          completeName: "Johannes Brahms",
          epoch: "Romantic",
          born: 1833,
          died: 1897,
          popular: true,
          works: [
            { id: "oo-brahms-115", title: "Clarinet Quintet in B minor, op. 115", genre: "Chamber", popular: true, recommended: true },
            { id: "oo-brahms-51-1", title: "String Quartet no. 1 in C minor, op. 51 no. 1", genre: "Chamber", popular: false, recommended: true },
          ],
        },
        {
          name: "Dvořák",
          completeName: "Antonín Dvořák",
          epoch: "Romantic",
          born: 1841,
          died: 1904,
          popular: true,
          works: [{ id: "oo-dvorak-96", title: "String Quartet no. 12 in F major, op. 96, B.179, \"American\"", genre: "Chamber", popular: true, recommended: false }],
        },
      ],
    },
    musicbrainz: { fetchedAt: T, recordings: { "mb-debussy": { count: 500, at: T } } },
  };
}

/** Builds the fixture into a temporary database; `later` builds the next crawl on top of the first. */
export function buildFixture(later = false): { path: string; result: BuildResult; firstPath?: string } {
  const dir = mkdtempSync(join(tmpdir(), "repertoire-test-"));
  const first = join(dir, "first.sqlite");
  const firstResult = build(fixtureInput(false), first, NONE, new Date("2026-10-02T00:00:00Z"));
  if (!later) return { path: first, result: firstResult };
  const second = join(dir, "second.sqlite");
  const result = build(fixtureInput(true), second, readPrevious(first)!, new Date("2026-10-09T00:00:00Z"));
  return { path: second, result, firstPath: first };
}
