import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPage, parseDuration, parseMovements } from "./imslp-pages.ts";

// The shape of an IMSLP work page (trimmed)
const PAGE = `{{#fte:imslppage
===Full Scores===
{{#fte:imslpfile
|File Description 1=Complete Score
|Copyright=Public Domain
}}
===Parts===
{{#fte:imslpfile
|File Description 1=Oboe 1/2
|File Description 2=Horn 1/2 (D)
|File Description 3=Violins I
|Copyright=Public Domain
}}
===Arrangements and Transcriptions===
====Complete====
=====For Piano (Sarić)=====
{{#fte:imslpfile
|File Description 1=Complete Score
|Arranger={{LinkArr|Sanja|Sarić||}}
|Copyright=Public Domain
}}
=====Parts=====
{{#fte:imslpfile
|File Description 1=Flute
}}
====Overture====
=====*For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)=====
{{#fte:imslpfile
|File Tags=fl ob cl bn hn (arr)
|File Description 1=Complete Score
|Arranger={{LinkArr|Jesper|Jerkert||}}
|Editor=
|Copyright=Creative Commons Attribution-NonCommercial 4.0
}}
{{#fte:imslpfile
|File Tags=fl ob cl bn hn (arr)
|File Description 1=Flute
|Arranger={{LinkArr|Jesper|Jerkert||}}
|Editor=
|Copyright=Creative Commons Attribution-NonCommercial 4.0
}}
===General Information===
|Instrumentation=2 oboes, 2 horns, strings
|Number of Movements/Sections=3 movements:
#Allegro
#Andante
#Presto
|Average Duration=12 minutes
|Key=D major
}}`;

test("a page: its fields, the original edition's parts (not an arrangement's), its arrangements", () => {
  assert.deepEqual(extractPage(PAGE, 7, 1), {
    at: 1,
    rev: 7,
    v: 2,
    instrumentation: "2 oboes, 2 horns, strings",
    movements: "3 movements:\n#Allegro\n#Andante\n#Presto",
    duration: "12 minutes",
    parts: [["Oboe 1/2", "Horn 1/2 (D)", "Violins I"]],
    arrangements: [
      { headings: ["Complete", "For Piano (Sarić)"], arranger: "{{LinkArr|Sanja|Sarić||}}", copyright: "Public Domain" },
      { headings: ["Complete", "Parts"] },
      // Its two files, once
      {
        headings: ["Overture", "*For Flute, Oboe, Clarinet, Bassoon and Horn (Jerkert)"],
        arranger: "{{LinkArr|Jesper|Jerkert||}}",
        tags: "fl ob cl bn hn (arr)",
        copyright: "Creative Commons Attribution-NonCommercial 4.0",
      },
    ],
  });
});

test("durations", () => {
  assert.equal(parseDuration("45 minutes"), 2700);
  assert.equal(parseDuration("11-15 minutes"), 780);
  assert.equal(parseDuration("8.5 minutes"), 510);
  assert.equal(parseDuration("1 hour 10 minutes"), 4200);
  assert.equal(parseDuration("ca. 20'"), 1200);
  assert.equal(parseDuration("12:30"), 750);
  assert.equal(parseDuration("30 minutes (incidental music)<br>16 minutes (suite)"), 1800);
  assert.equal(parseDuration("{{Key|g}}"), null);
  assert.equal(parseDuration("1-2 seconds"), null);
});

test("movements: counted, or listed; acts aren't movements", () => {
  assert.equal(parseMovements("4 movements:\n#Allegro"), 4);
  assert.equal(parseMovements("6 dances"), 6);
  assert.equal(parseMovements("8"), 8);
  assert.equal(parseMovements("6 (No.6 incomplete)"), 6);
  assert.equal(parseMovements("1 polka"), 1);
  assert.equal(parseMovements("#Allegro\n#Adagio\n#Presto"), 3);
  assert.equal(parseMovements("3 acts"), null);
  assert.equal(parseMovements("Andante"), null);
});
