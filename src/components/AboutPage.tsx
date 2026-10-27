import { useEffect } from "react";
import { finderPath, useApi } from "../lib/api";
import { Link } from "../lib/router";
import { FEEDBACK_MAILTO, REPO } from "../shared/paths";
import { CORE_SCORE, DATA_LICENSE, DATASETS_URL, ERAS, EXPORT_FILES, SIGNALS, SOURCES, type Meta, type SourceId } from "../shared/data";

const fmt = new Intl.NumberFormat("en");
const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : fmt.format(v));
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "–");
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
    "The Swedish union catalogue. We take the sheet music held by Musik- och teaterbiblioteket in Stockholm, which lends scores and parts (orchestral sets too) across Sweden: works we have get a link to borrow them, and works we didn't have, often Swedish, come in when the library states their instrumentation, in its own field or in the title (“variationer för blåskvintett”).",
  mutopia:
    "Volunteers' new engravings of public-domain music, free to download. Each piece is linked from the work it belongs to; many are single movements, so Mutopia adds links, not works.",
};

export function AboutPage() {
  const { data: meta } = useApi<Meta>("/api/meta");
  useEffect(() => {
    document.title = "About · Repertoire Finder";
  }, []);
  const s = meta?.stats;

  return (
    <article className="page-detail about">
      <header className="detail-head">
        <p className="eyebrow">About</p>
        <h1>Where this comes from</h1>
        <p>
          Repertoire Finder answers one question: what can <em>this</em> group play? You pick the players you have, and get the works written for
          exactly that line-up, most established first, with links to free sheet music and to library copies when there are some. It combines
          nine open sources into one dataset, rebuilt regularly, and everything is open: the data, the code, and how they fit together.
        </p>
      </header>

      {meta && (
        <section className="detail-section">
          <h2>The dataset</h2>
          <p>
            Built <strong>{date(meta.builtAt)}</strong> (version <code>{meta.version}</code>):
          </p>
          <dl className="stat-grid">
            <div>
              <dt>Works</dt>
              <dd>{n(meta.works)}</dd>
            </div>
            <div>
              <dt>Composers</dt>
              <dd>{n(meta.composers)}</dd>
            </div>
            <div>
              <dt>Line-ups</dt>
              <dd>{n(meta.lineups)}</dd>
            </div>
            {s && (
              <>
                <div>
                  <dt>Core repertoire</dt>
                  <dd>{n(s.core)}</dd>
                </div>
                <div>
                  <dt>With free sheet music</dt>
                  <dd>
                    {n(s.free)} <span className="muted small">{pct(s.free, meta.works)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Only as arrangements</dt>
                  <dd>{n(s.arrangementOnly)}</dd>
                </div>
                {s.orchestrations && (
                  <div>
                    <dt>Orchestral works with a known scoring</dt>
                    <dd>
                      {n(Object.values(s.orchestrations).reduce((a, b) => a + b, 0))}{" "}
                      <span className="muted small">
                        {(Object.entries(s.orchestrations) as [SourceId, number][]).map(([src, k]) => `${n(k)} from ${SOURCES[src].name}`).join(", ")}
                        {s.orchestrationStatus?.confirmed !== undefined && `; ${n(s.orchestrationStatus.confirmed)} confirmed by two sources`}
                      </span>
                    </dd>
                  </div>
                )}
                {s.durations !== undefined && (
                  <div>
                    <dt>With a duration</dt>
                    <dd>{n(s.durations)}</dd>
                  </div>
                )}
                {s.arrangements && (
                  <div>
                    <dt>Arrangements on IMSLP</dt>
                    <dd>
                      {n(s.arrangements.n)} <span className="muted small">by {n(s.arrangements.arrangers)} arrangers</span>
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </section>
      )}

      <section className="detail-section">
        <h2>Sources</h2>
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
        <h2>How it's combined</h2>
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

      {s && meta && (
        <section className="detail-section">
          <h2>What's in it</h2>
          <div className="about-columns">
            <div>
              <h3>By era</h3>
              <ul className="bars">
                {[...ERAS, "Unknown" as const]
                  .filter((e) => s.eras[e])
                  .map((e) => (
                    <li key={e}>
                      <span className="bar-label">{e}</span>
                      <span className="bar" style={{ width: pct(s.eras[e]!, Math.max(...Object.values(s.eras).map((v) => v ?? 0))) }} />
                      <span className="muted small">{n(s.eras[e])}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <h3>By number of players</h3>
              <ul className="bars">
                {s.sizes.map((z) => (
                  <li key={z.players}>
                    <span className="bar-label">{z.players === "1" ? "Solo" : z.players}</span>
                    <span className="bar" style={{ width: pct(z.works, Math.max(...s.sizes.map((x) => x.works))) }} />
                    <span className="muted small">
                      {n(z.works)} works, {n(z.lineups)} line-ups
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <h3>Most common line-ups</h3>
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
        <h2>License and reuse</h2>
        <p>
          The dataset is licensed <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a>, because it includes material from IMSLP and Wikipedia under
          that license; RISM's is CC BY 3.0, and data from Wikidata, Open Opus, MusicBrainz, LIBRIS and the GND is CC0. Mutopia is only
          linked to. If you reuse it, credit Repertoire Finder and those sources, and share
          alike. The code is <a href={`${REPO}/blob/main/LICENSE`}>MIT</a>. Sheet music is hosted by IMSLP, under each score's own terms.
        </p>
        {meta && (
          <p>
            Take it with you: <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.sqlite}`}>SQLite</a> or{" "}
            <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.csv}`}>CSV (zip)</a> downloads of every version, or the{" "}
            <a href="/api">JSON API</a>. The <a href={`${REPO}/blob/main/docs/data.md`}>data documentation</a> describes the tables and how
            they're built.
          </p>
        )}
        <p className="muted small">
          An independent project, not affiliated with any of these sources, which do the real work of collecting this knowledge.
        </p>
      </section>

      <section className="detail-section">
        <h2>Known gaps</h2>
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
        <h2>Feedback welcome</h2>
        <p>
          Found a wrong line-up, a duplicate, or a missing work? Tell me: open an issue on <a href={`${REPO}/issues`}>GitHub</a> or email{" "}
          <a href={FEEDBACK_MAILTO}>tgwizard@gmail.com</a>. The code is at <a href={REPO}>github.com/tgwizard/repertoire</a>.
        </p>
      </section>
    </article>
  );
}
