import { useEffect, type CSSProperties, type ReactNode } from "react";
import { finderPath, useApi } from "../lib/api";
import { Link } from "../lib/router";
import { FEEDBACK_MAILTO, REPO } from "../shared/paths";
import { CORE_SCORE, DATA_LICENSE, DATASETS_URL, ERAS, EXPORT_FILES, SIGNALS, SOURCES, type Meta, type SourceId } from "../shared/data";

const fmt = new Intl.NumberFormat("en");
const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : fmt.format(v));
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "–");
const compact = new Intl.NumberFormat("en", { notation: "compact" });

// The page's sections, for its contents
const CONTENTS = [
  ["dataset", "The dataset"],
  ["whats-in-it", "What's in it"],
  ["sources", "Sources"],
  ["how-its-combined", "How it's combined"],
  ["license", "License and reuse"],
  ["downloads", "Downloads"],
  ["api", "API"],
  ["known-gaps", "Known gaps"],
  ["by", "By"],
] as const;

/** A heading with a link to itself */
function Heading({ level: H, id, children }: { level: "h2" | "h3"; id: string; children: ReactNode }) {
  return (
    <H id={id} className="anchored">
      {children}
      <a className="anchor" href={`#${id}`} aria-label="Link to this section">
        #
      </a>
    </H>
  );
}

// Long words, soft-hyphenated for narrow columns
const SOFT: Record<string, string> = {
  Medieval: "Medi\u00adeval",
  Renaissance: "Renais\u00adsance",
  Baroque: "Bar\u00adoque",
  Classical: "Clas\u00adsical",
  Romantic: "Roman\u00adtic",
  "Early 20th century": "Early 20th cen\u00adtury",
  Modern: "Mod\u00adern",
  Unknown: "Un\u00adknown",
};

/** A column chart: one bar per item, its value above and its label below (and a note under that) */
function Columns({ items }: { items: { key: string; label: string; value: number; note?: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="columns-chart" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <li key={i.key} title={`${i.label}: ${n(i.value)} works${i.note !== undefined ? `, ${n(i.note)} line-ups` : ""}`}>
          <span className="column-track">
            <span className="column-value">{compact.format(i.value)}</span>
            <span className="bar" style={{ "--h": i.value / max } as CSSProperties} />
          </span>
          <span className="column-label">{i.label}</span>
          {i.note !== undefined && <span className="column-note muted">{compact.format(i.note)}</span>}
        </li>
      ))}
    </ul>
  );
}

const pct = (part: number, whole: number) => `${Math.round((100 * part) / Math.max(1, whole))}%`;


/** What each source is used for, in a sentence. */
const USE: Record<SourceId, string> = {
  imslp:
    "The backbone. Every IMSLP work page sits in categories named after its exact instrumentation (“For 2 violins, viola, cello”), with arrangements in separate categories. We crawl all of them, and link to IMSLP for the sheet music. Its work pages add durations, orchestral scorings, and who arranged what.",
  wikipedia:
    "Editors' lists of notable works per ensemble (“Compositions for wind quintet”). They add works IMSLP lacks, usually 20th-century works still in copyright, and count towards how established a work is.",
  wikidata:
    "The glue between sources: Wikidata items link IMSLP pages, Wikipedia articles and MusicBrainz records, and give composition dates and composers' lifespans. Items tagged with an ensemble add works too.",
  openopus: "A curated list of the main works of the best-known composers, marked popular or recommended, which feeds the ranking. Titles that name a standard ensemble add works.",
  musicbrainz: "How many recordings a work has, a strong sign of an established work. Looked up for the most notable works first, a few hundred per crawl.",
  gnd:
    "The German National Library's authority file describes hundreds of thousands of musical works with their exact instrumentation, opus and catalogue numbers, keys and dates, including contemporary works IMSLP can't have. Works we have gain a link and sometimes a line-up; works we didn't have come in when they can't be a duplicate of one we do.",
  rism:
    "The International Inventory of Musical Sources catalogues manuscripts and early prints in libraries worldwide. For works we have, it shows where copies are kept (the composer's own hand first), and how many libraries hold one, which says how widely a work was played before recordings.",
  libris:
    "The Swedish union catalogue: the sheet music of Swedish libraries, KB's legal deposit copies, universities and music colleges among them. Musik- och teaterbiblioteket in Stockholm lends scores and parts (orchestral sets too) across Sweden: works we have get a link to borrow them there, or to the record of the libraries that have a copy. Works we didn't have, often Swedish, come in when a library states their instrumentation: in its own field, in its classification (“Xkeeb”: a string quartet) or in the title (“variationer för blåskvintett”).",
  dnb:
    "The German National Library's catalogue of sheet music, which publishers in Germany must deposit: every edition since 2000, new ones within weeks. Works we have get a link to their published editions; new works come in when the record names the composer and states the instrumentation, and isn't an arrangement or an anthology.",
  k10plus:
    "The union catalogue of most German research libraries, and some Austrian ones. Beyond what's deposited with the German National Library, it has the editions those libraries bought, many from abroad (catalogued in WorldCat first): works we have get a link to the libraries' records; new works come in as for DNB, their instrumentation often stated instrument by instrument.",
  mutopia:
    "Volunteers' new engravings of public-domain music, free to download. Each piece is linked from the work it belongs to; many are single movements, so Mutopia adds links, not works.",
};

export function AboutPage() {
  const { data: meta } = useApi<Meta>("/api/meta");
  useEffect(() => {
    document.title = "About · Repertoire Finder";
  }, []);
  // A link to a section: go there once the sections the numbers fill in are drawn
  const loaded = !!meta;
  useEffect(() => {
    if (loaded && location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [loaded]);
  const s = meta?.stats;

  return (
    <article className="page-detail about">
      <header className="detail-head">
        <p className="eyebrow">About</p>
        <h1>Where this comes from</h1>
        <p>
          Repertoire Finder answers one question: what can <em>this</em> group play? You pick the players you have, and get the works written for
          exactly that line-up, with links to free sheet music and to library copies when there are some. It combines
          nine open sources into one dataset, rebuilt regularly, and everything is open: the data, the code, and how they fit together.
        </p>
        <nav className="contents" aria-labelledby="contents-label">
          <p className="eyebrow" id="contents-label">
            On this page
          </p>
          <ol>
            {CONTENTS.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {meta && (
        <section className="detail-section">
          <Heading level="h2" id="dataset">The dataset</Heading>
          <p>
            Built {date(meta.builtAt)}. Version: <code>{meta.version}</code>.
          </p>
          <ul className="stats">
            <li>{n(meta.works)} works</li>
            <li>{n(meta.composers)} composers</li>
            <li>{n(meta.lineups)} line-ups</li>
            {s && (
              <>
                <li>{n(s.core)} works of core repertoire</li>
                <li>
                  {n(s.free)} with free sheet music ({pct(s.free, meta.works)})
                </li>
                <li>{n(s.arrangementOnly)} only as arrangements</li>
                {s.orchestrations && (
                  <li>
                    {n(Object.values(s.orchestrations).reduce((a, b) => a + b, 0))} orchestral works with a known scoring
                    <ul>
                      {(Object.entries(s.orchestrations) as [SourceId, number][]).map(([src, k]) => (
                        <li key={src}>
                          {n(k)} from {SOURCES[src].name}
                        </li>
                      ))}
                      {s.orchestrationStatus?.confirmed !== undefined && <li>{n(s.orchestrationStatus.confirmed)} confirmed by two sources</li>}
                    </ul>
                  </li>
                )}
                {s.durations !== undefined && <li>{n(s.durations)} with a duration</li>}
                {s.arrangements && (
                  <li>
                    {n(s.arrangements.n)} arrangements on IMSLP, by {n(s.arrangements.arrangers)} arrangers
                  </li>
                )}
              </>
            )}
          </ul>
        </section>
      )}

      {s && meta && (
        <section className="detail-section">
          <Heading level="h2" id="whats-in-it">What's in it</Heading>
          <Heading level="h3" id="by-era">By era</Heading>
          <Columns
            items={[...ERAS, "Unknown" as const].filter((e) => s.eras[e]).map((e) => ({ key: e, label: SOFT[e] ?? e, value: s.eras[e]! }))}
          />
          <Heading level="h3" id="by-players">By number of players</Heading>
          <Columns
            items={s.sizes.map((z) => ({ key: z.players, label: z.players === "1" ? "Solo" : z.players, value: z.works, note: z.lineups }))}
          />
          <p className="muted small">Works for each size of group; under each, how many different line-ups they're for.</p>
          <Heading level="h3" id="common-lineups">Most common line-ups</Heading>
          <ol className="top-lineups">
            {s.topLineups.map((l) => (
              <li key={l.key}>
                <Link href={finderPath(l.key)}>{l.description}</Link> <span className="muted small">{n(l.works)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="detail-section">
        <Heading level="h2" id="sources">Sources</Heading>
        <div className="table-wrap">
          <table className="about-table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Records pulled</th>
                <th className="num">Matched to works</th>
                <th className="num">Works it adds</th>
                <th className="num">Line-ups it states</th>
                <th>License</th>
                <th>Fetched</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(SOURCES) as SourceId[]).map((id) => {
                const src = SOURCES[id];
                const m = meta?.sources[id];
                return (
                  <tr key={id}>
                    <th scope="row">
                      <a href={src.url}>{src.name}</a>
                    </th>
                    <td className="num">{n(m?.items)}</td>
                    <td className="num">{n(m?.matched)}</td>
                    <td className="num">{n(m?.added)}</td>
                    <td className="num">{n(s?.bySource[id]?.lineups)}</td>
                    <td>
                      <a href={src.licenseUrl}>{src.license}</a>
                    </td>
                    <td className="muted">{date(m?.fetchedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="source-uses">
          {(Object.keys(SOURCES) as SourceId[]).map((id) => (
            <div key={id}>
              <dt>{SOURCES[id].name}</dt>
              <dd>
                {USE[id]} {meta?.sources[id]?.note && <span className="muted">({meta.sources[id].note}.)</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted small">
          “Matched” records add links, dates and ranking signals to a work an earlier source already had; “adds” are works no earlier source had. The order is IMSLP, Wikidata, Wikipedia,
          Open Opus, Mutopia, LIBRIS, GND, RISM. “Line-ups it states” counts work–line-up pairs the source vouches for; a pair can have several sources.
        </p>
      </section>

      <section className="detail-section">
        <Heading level="h2" id="how-its-combined">How it's combined</Heading>
        <ul className="prose-list">
          <li>
            <strong>Exact line-ups.</strong> A work is listed for a line-up only when a source says it is for exactly those players. Arrangements
            count separately and are off unless you ask for them. “Include smaller groups” lists works for any group you can form from your players.
          </li>
          <li>
            <strong>One work, many sources.</strong> Records are matched first on shared ids (Wikidata links IMSLP pages, Wikipedia articles,
            MusicBrainz works and GND records), then on composer (name and life dates), catalogue number (Op., K., BWV, D., Hob. and two dozen
            more), key and title. When a match is ambiguous we keep the records apart rather than guess, and a new work only comes in when it
            can't be one we already have.
          </li>
          <li>
            <strong>Sanity checks.</strong> A title naming a group size has to agree with the line-up (Poulenc's Sextet isn't a wind quintet), and
            a source's line-up never overrides IMSLP's exact categories.
          </li>
          <li>
            <strong>Most established first.</strong> Works are ranked by evidence that they're played:{" "}
            {Object.values(SIGNALS)
              .map((sig) => `${sig.label.charAt(0).toLowerCase()}${sig.label.slice(1)} (+${sig.points})`)
              .join(", ")}
            , plus recordings on MusicBrainz, how many libraries hold copies (RISM, LIBRIS; it shows what was played before
            recordings), and how many Wikipedias cover the work and its composer. {CORE_SCORE} points or more counts as core
            repertoire. Each work's page shows its breakdown.
          </li>
          <li>
            <strong>Permanent links.</strong> Every work and composer has an id that survives rebuilds; when two records turn out to be the same
            work, the old link redirects.
          </li>
        </ul>
      </section>

      <section className="detail-section">
        <Heading level="h2" id="license">License and reuse</Heading>
        <p>
          The dataset is licensed <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a>, because it includes material from IMSLP and Wikipedia under
          that license; RISM's is CC BY 3.0, and data from Wikidata, Open Opus, MusicBrainz, LIBRIS and the GND is CC0. Mutopia is only
          linked to. If you reuse it, credit Repertoire Finder and those sources, and share
          alike. The code is <a href={`${REPO}/blob/main/LICENSE`}>MIT</a>. Sheet music is hosted by IMSLP, under each score's own terms.
        </p>
        <p>
          To use it, <a href="#downloads">download it</a> or <a href="#api">query the API</a>.
        </p>
        <p className="muted small">
          An independent project, not affiliated with any of these sources, which do the real work of collecting this knowledge.
        </p>
      </section>

      <section className="detail-section">
        <Heading level="h2" id="downloads">Downloads</Heading>
        <p>The whole dataset, {DATA_LICENSE.name} like the rest:</p>
        {meta ? (
          <ul className="prose-list">
            <li>
              <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.sqlite}`}>SQLite database</a> (gzipped): every table, ready to query.
            </li>
            <li>
              <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.csv}`}>CSV files</a> (zip): one file per table, for spreadsheets and scripts.
            </li>
            <li>
              Every version stays downloadable at <code>{DATASETS_URL}/&lt;version&gt;/</code>, with a{" "}
              <a href={`${DATASETS_URL}/${meta.version}/manifest.json`}>manifest</a> of sizes and checksums;{" "}
              <a href={`${DATASETS_URL}/latest.json`}>latest.json</a> names the newest.
            </li>
          </ul>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </section>

      <section className="detail-section">
        <Heading level="h2" id="api">API</Heading>
        <p>
          JSON, free, no key, open to any site (CORS). Ids in it are permanent: a work or composer that's merged redirects, one that's withdrawn
          says why.
        </p>
        <ul className="prose-list">
          <li>
            <a href="/api/meta">
              <code>/api/meta</code>
            </a>
            : the dataset's version and numbers
          </li>
          <li>
            <a href="/api/lineups">
              <code>/api/lineups</code>
            </a>
            : every line-up, with how many works it has
          </li>
          <li>
            <code>/api/works?lineup=…</code>: works for a line-up, with the finder's filters and sorts
          </li>
          <li>
            <code>/api/works/&#123;id&#125;</code>, <code>/api/composers/&#123;id&#125;</code>: one work or composer
          </li>
          <li>
            <code>/api/search?q=…</code>: works and composers matching a search
          </li>
        </ul>
        <p>
          <a href="/api">/api</a> lists every endpoint and parameter. The <a href={`${REPO}/blob/main/docs/data.md`}>data documentation</a>{" "}
          describes the tables and how they're built.
        </p>
      </section>

      <section className="detail-section">
        <Heading level="h2" id="known-gaps">Known gaps</Heading>
        <ul className="prose-list">
          <li>
            Works still in copyright are only here when the GND, LIBRIS, Wikipedia, Wikidata or Open Opus know their exact line-up; many
            contemporary works are, many aren't yet.
          </li>
          <li>
            Orchestral works are “symphony orchestra” unless a source says “chamber orchestra”; most sources don't describe an orchestra's size.
          </li>
          <li>A few works appear twice when sources describe them too differently to match safely.</li>
          <li>
            Library copies come from RISM (mostly music before 1850) and one lending library, Musik- och teaterbiblioteket; publishers aren't
            linked yet.
          </li>
        </ul>
      </section>

      <section className="detail-section">
        <Heading level="h2" id="by">By</Heading>
        <p>Built by Adam Renberg Tamm, with love, using AI.</p>
        <p>
          Found a wrong line-up, a duplicate, or a missing work? Tell me: open an issue on <a href={`${REPO}/issues`}>GitHub</a> or email{" "}
          <a href={FEEDBACK_MAILTO}>tgwizard@gmail.com</a>. The code is at <a href={REPO}>github.com/tgwizard/repertoire</a>.
        </p>
      </section>
    </article>
  );
}
