// A miniature crawl: a few real works as each source describes them, enough to
// exercise merging, line-up rules, ids, the API and search without the full dataset.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, NONE, readPrevious, type BuildInput, type BuildResult } from "../crawler/build.ts";

const T = Date.parse("2026-10-01T00:00:00Z");

const libris = (id: string, title: string, uniform: string | null, family: string, given: string, born: number, died: number | null, medium: string[], extent: string) => ({
  id, title, uniform, composers: [{ family, given, born, died, agent: `agent-${family.toLowerCase()}` }], arranged: false, medium,
  kssb: [], extent, year: 2001, publisher: "Svensk Musik", shelf: null, collection: false,
});

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
        "For orchestra": [20, 21, 23],
        "For strings": [22],
        "For flute, oboe, clarinet, bassoon, horn (arr)": [22],
        "For piano 4 hands (arr)": [22],
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
        20: imslpWork(20, "Symphony No.1, Op.68 (Brahms, Johannes)", "Romantic", true),
        21: imslpWork(21, "Symphony No.4, Op.98 (Brahms, Johannes)", "Romantic", true),
        22: imslpWork(22, "Serenade for Strings, Op.48 (Tchaikovsky, Pyotr)", "Romantic", true),
        23: imslpWork(23, "Symphony in G major, Op.5 (Olsen, Ole)", "Romantic"),
      },
    },
    imslpPages: {
      pages: {
        2: { at: T, rev: 1, duration: "20 minutes", movements: "4 movements:\n#Allegro\n#Poco adagio\n#Menuetto\n#Finale", parts: [["Violin 1", "Violin 2", "Viola", "Cello"]] },
        // A whole set of parts, with the trombones as alto, tenor and bass; uploaded on their
        // own, a stand-in (not another player) and a part the set lacked
        20: {
          at: T,
          rev: 1,
          instrumentation: "orchestra",
          duration: "45 minutes",
          movements: "4 movements:\n#Un poco sostenuto — Allegro\n#Andante sostenuto\n#Un poco allegretto e grazioso\n#Adagio — Allegro non troppo",
          parts: [
            ["Flute 1/2", "Oboe 1/2", "Clarinet 1/2 (B{{flat}}/A)", "Bassoon 1/2", "Contrabassoon", "Horn 1/2 (C)", "Horn 3/4 (E{{flat}})", "Trumpet 1/2 (C)", "Alto Trombone", "Tenor Trombone", "Bass Trombone", "Timpani", "Violins I", "Violins II", "Violas", "Cellos", "Basses"],
            ["Bass Clarinet (alternate for Bassoon 1)"],
            ["Harp"],
          ],
        },
        // Only the string parts are on IMSLP: not a whole orchestra's scoring
        23: { at: T, rev: 1, instrumentation: "orchestra", parts: [["Violins I", "Violins II", "Violas", "Cellos", "Basses"]] },
        // Arrangements: of the whole work, of a movement, and for a line-up the work isn't listed for
        22: {
          at: T,
          rev: 1,
          v: 2,
          arrangements: [
            // By a composer we have: on their page too
            { headings: ["Complete", "For Piano 4 hands (Brahms)"], arranger: "{{LinkArr|Johannes|Brahms}}", copyright: "Public Domain" },
            { headings: ["Waltz (No.2)", "*For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)"], arranger: "{{LinkArr|Jesper|Jerkert||}}", copyright: "Creative Commons Attribution-NonCommercial 4.0" },
            { headings: ["Complete", "For Theatre Orchestra"], arranger: "Unknown", copyright: "Public Domain" },
          ],
        },
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
        // First "Sam Barber" with no IMSLP link: too different to match "Barber, Samuel" by name.
        Q12: { qid: "Q12", imslp: later ? "Barber, Samuel" : undefined, label: later ? "Samuel Barber" : "Sam Barber", born: 1910, died: 1981, wikipedia: "Samuel Barber", sitelinks: 60 },
        Q13: { qid: "Q13", imslp: "Poulenc, Francis", label: "Francis Poulenc", born: 1899, died: 1963, sitelinks: 70 },
        // Wikidata links Haydn to the wrong IMSLP composer (as it once did Bruckner).
        Q14: { qid: "Q14", imslp: "Weiß, Johann Baptist", label: "Joseph Haydn", born: 1732, died: 1809, sitelinks: 150 },
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
    gnd: null,
    rism: {
      fetchedAt: T,
      people: { "2": { gnd: null, wikidata: "Q11" } },
      libraries: { "D-B": "Staatsbibliothek zu Berlin", "A-Wn": "Österreichische Nationalbibliothek" },
      sources: [
        // Two copies of Brahms's clarinet quintet: the autograph is shown first.
        { id: "9001", person: "2", title: "Quintets", medium: "cl, vl (2), vla, vlc", numbers: "op. 115", key: "b", excerpt: false, catalogue: [], type: "Manuscript copy", holdings: [{ siglum: "A-Wn", shelf: "Mus.Hs.9" }] },
        { id: "9002", person: "2", title: "Quintets", medium: "cl, vl (2), vla, vlc", numbers: "op. 115", key: "b", excerpt: false, catalogue: [], type: "Autograph manuscript", holdings: [{ siglum: "D-B", shelf: "Mus.ms.autogr. Brahms 1" }] },
        // A copy of the parts of a symphony IMSLP has no scoring for
        {
          id: "9004", person: "2", title: "Symphonies", medium: "orch", numbers: "op. 98", key: "e", excerpt: false, catalogue: [], type: "Print", holdings: [{ siglum: "D-B", shelf: null }],
          scoring: [["fl", 2], ["fl.picc", 1], ["ob", 2], ["cl", 2], ["fag", 2], ["contra-fag", 1], ["cor", 4], ["tr", 2], ["trb", 3], ["timp", 1], ["triangolo", 1], ["vl", 2], ["vla", 1], ["vlc", 1], ["cb", 1]],
        },
        // A work we don't have: nothing added.
        { id: "9003", person: "2", title: "Sonatas", medium: "vl, pf", numbers: "op. 999", key: null, excerpt: false, catalogue: [], type: "Print", holdings: [{ siglum: "D-B", shelf: null }] },
      ],
    },
    libris: {
      fetchedAt: T,
      total: 6,
      records: [
        // An edition of a work IMSLP has: a link to borrow it.
        libris("lb115", "Quintett für Klarinette, zwei Violinen, Viola und Violoncello, op. 115", "Kvintett, op. 115", "Brahms", "Johannes", 1833, 1897, ["klarinett, violin (2), viola, violoncell"], "1 part. + 5 st."),
        // A work IMSLP lacks, by a composer we don't have: both come in.
        libris("lbkv1", "Kongsgaard variations, for string quartet", "Kongsgaard variations", "Hillborg", "Anders", 1954, null, ["violin (2), viola, violoncell"], "1 part. (20 s.) + 4 st."),
        // Another edition of it: the same work, a second copy.
        libris("lbkv2", "Kongsgaard variations", "Kongsgaard variations", "Hillborg", "Anders", 1954, null, ["violin (2), viola, violoncell"], "4 st."),
        // An arrangement we can't place: skipped.
        { ...libris("lbarr", "Wind Quintet, arr. for brass", null, "Nobody", "A.", 1900, 1980, ["trumpet (2), horn, trombon, tuba"], "5 st."), arranged: true },
        // A line-up only the title gives: comes in.
        libris("lbps", "Per spelman, variationer för blåskvintett", null, "Sund", "Robert", 1942, null, [], "1 part. (14 s.) + 5 st."),
        // A title and an instrumentation that disagree (an edition for flute): skipped.
        libris("lbpt", "Partita d-Moll für Klarinette solo", null, "Nobody", "B.", 1920, 1990, ["flöjt"], "1 st."),
      ],
    },
    mutopia: {
      fetchedAt: T,
      pieces: [
        // A movement of an IMSLP work, by catalogue number.
        { id: 101, title: "String Quartet (2nd movement)", composer: "C. Debussy", born: 1862, died: 1918, opus: "Op. 10", instrument: "String Quartet", license: "Public Domain" },
        // A composer we don't have.
        { id: 102, title: "Minuet", composer: "J. Nobody", born: 1700, died: 1760, opus: "", instrument: "Piano", license: "Public Domain" },
        // The right surname with other life years is someone else.
        { id: 103, title: "String Quartet", composer: "X. Debussy", born: 1900, died: 1950, opus: "Op. 10", instrument: "String Quartet", license: "Public Domain" },
      ],
    },
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
