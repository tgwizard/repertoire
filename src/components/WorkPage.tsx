import { useEffect, useState } from "react";
import { composerPath, finderPath, lifespan, useApi, type ComposerDetail, type WorkDetail, type WorksPage } from "../lib/api";
import { Link } from "../lib/router";
import { describeOrchestration } from "../lib/orchestration";
import { formatDuration } from "../shared/paths";
import { CORE_SCORE, lineupSourceUrl, PROVIDERS, SOURCES, type Link as WorkLink } from "../shared/data";
import { GoneNotice } from "./GoneNotice";
import { arrangedText, WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");

function LinkItem({ l }: { l: WorkLink }) {
  const name = PROVIDERS[l.provider].name;
  const text =
    l.provider === "imslp"
      ? "Sheet music on IMSLP"
      : l.provider === "libris"
        ? `Borrow from Musik- och teaterbiblioteket, Stockholm${l.label ? `: ${l.label}` : ""}`
        : l.provider === "swedish-libraries"
          ? `In Swedish libraries${l.label ? `: ${l.label}` : ""}`
          : l.provider === "k10plus"
            ? `In German libraries${l.label ? `: ${l.label}` : ""}`
          : l.provider === "dnb"
            ? l.label ?? "Published edition"
        : l.provider === "rism"
          ? l.label ?? "A source in RISM"
        : l.provider === "mutopia"
          ? `Engraved edition on Mutopia${l.label ? `: ${l.label}` : ""}`
          : l.provider === "musicbrainz" && l.label
            ? `MusicBrainz · ${l.label.replace(/^(\d+)/, (n) => fmt.format(Number(n)))}`
            : name;
  return (
    <li>
      {l.url ? (
        <a href={l.url} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        <span>Listed in {name}</span>
      )}
    </li>
  );
}

// A score link: a short button naming where it is, the edition's own title beside it
function ScoreLink({ l }: { l: WorkLink }) {
  if (!l.url) return <LinkItem l={l} />;
  const text = l.provider === "imslp" ? "Sheet music on IMSLP" : l.provider === "mutopia" ? "Engraved edition on Mutopia" : PROVIDERS[l.provider].name;
  const caption = l.provider === "imslp" ? null : l.label;
  return (
    <li>
      <a className="button-link" href={l.url} target="_blank" rel="noreferrer">
        {text}
      </a>
      {caption && <span className="muted small">{caption}</span>}
    </li>
  );
}

const ALIASES_SHOWN = 3;

export function WorkPage({ id }: { id: string }) {
  const [allAliases, setAllAliases] = useState(false);
  const { data: w, error, loading } = useApi<WorkDetail>(`/api/works/${id}`);
  const main = w?.scorings.find((s) => !s.arrangement) ?? w?.scorings[0];
  const composer = useApi<ComposerDetail>(w?.composer && w.copies > 0 ? `/api/composers/${w.composer.id}` : null);
  const more = useApi<WorksPage>(w?.composer && main ? `/api/works?composer=${w.composer.id}&lineup=${encodeURIComponent(main.lineup)}&limit=6` : null);

  useEffect(() => {
    if (w) document.title = `${w.title}${w.composer ? ` – ${w.composer.name}` : ""} · Repertoire Finder`;
  }, [w]);

  if (error && "gone" in error && error.gone) return <GoneNotice gone={error.gone} what="work" />;
  if (error) return <div className="notice error">{"status" in error && error.status === 404 ? "No such work." : `Couldn't load this work. ${error.message}`}</div>;
  if (!w || (loading && w.id !== id)) {
    return (
      <div className="notice">
        <span className="spinner" /> Loading…
      </div>
    );
  }

  const scores = w.links.filter((l) => l.kind === "score");
  // Stockholm's first, then other Swedish libraries', RISM's sources, German libraries'
  const libraryOrder = ["libris", "swedish-libraries", "rism", "k10plus"];
  const libraries = w.links.filter((l) => l.kind === "library").sort((a, b) => libraryOrder.indexOf(a.provider) - libraryOrder.indexOf(b.provider));
  const editions = w.links.filter((l) => l.kind === "edition");
  const elsewhere = w.links.filter((l) => l.kind === "reference" || l.kind === "data");
  const others = (more.data?.works ?? []).filter((o) => o.id !== w.id).slice(0, 5);
  // IMSLP's arrangements: under the line-up they're for, the rest (a "theatre orchestra")
  // as IMSLP heads them
  const arrangedFor = (lineup: string) =>
    w.arrangements
      .filter((a) => a.lineup === lineup)
      .map((a) => arrangedText({ arranger: a.arranger, excerpt: a.excerpt }))
      .filter((t): t is string => !!t);
  const unplaced = w.arrangements.filter((a) => !a.lineup);
  const facts = [w.year && String(w.year), w.duration && `about ${formatDuration(w.duration)}`, w.movements && w.movements > 1 && `${w.movements} movements`].filter(
    (f): f is string => !!f,
  );
  // The era is the composer's; only a work that differs says so itself
  const workEra = w.era && w.era !== w.composer?.era ? w.era : null;
  // Stockholm's copies, other Swedish libraries' and German libraries', under a heading each rather than
  // repeated on every line
  const grouped = [
    { heading: "Borrow from Musik- och teaterbiblioteket, Stockholm", links: libraries.filter((l) => l.provider === "libris" && l.url) },
    { heading: "In other Swedish libraries (LIBRIS lists which)", links: libraries.filter((l) => l.provider === "swedish-libraries" && l.url) },
    { heading: "In German libraries (K10plus lists which)", links: libraries.filter((l) => l.provider === "k10plus" && l.url) },
  ].filter((g) => g.links.length > 1);
  const inGroup = new Set(grouped.flatMap((g) => g.links));
  const rismPerson = composer.data?.links.find((l) => l.provider === "rism")?.url;

  return (
    <article className="page-detail">
      <header className="detail-head">
        <p className="eyebrow">Work</p>
        <h1>{w.title}</h1>
        {w.aliases.length > 0 && (
          <p className="aliases muted">
            Also listed as {(allAliases ? w.aliases : w.aliases.slice(0, ALIASES_SHOWN)).map((a) => `“${a}”`).join(", ")}
            {w.aliases.length > ALIASES_SHOWN && (
              <>
                {" "}
                <button className="link-button" onClick={() => setAllAliases(!allAliases)}>
                  {allAliases ? "fewer" : `and ${w.aliases.length - ALIASES_SHOWN} more`}
                </button>
              </>
            )}
          </p>
        )}
        {(facts.length > 0 || workEra || w.score >= CORE_SCORE) && (
          <p className="detail-meta work-facts">
            {facts.length > 0 && <span>{facts.join(" · ")}</span>}
            {workEra && <span className="badge">{workEra}</span>}
            {w.score >= CORE_SCORE && <span className="badge badge-core">Core repertoire</span>}
          </p>
        )}
        {w.composer && (
          <Link className="composer-card" href={composerPath(w.composer)}>
            <span className="eyebrow">Composer</span>
            <span className="composer-card-name">{w.composer.name}</span>
            {(lifespan(w.composer) || w.composer.era) && (
              <span className="muted small">{[lifespan(w.composer), w.composer.era].filter(Boolean).join(" · ")}</span>
            )}
          </Link>
        )}
      </header>

      <section className="detail-section">
        <h2>Get the music</h2>
        {scores.length > 0 && (
          <>
            <h3 className="subhead">Free online</h3>
            <ul className="link-list scores">
              {scores.map((l) => (
                <ScoreLink key={l.provider + l.ref} l={l} />
              ))}
            </ul>
          </>
        )}
        {libraries.length > 0 && (
          <>
            <h3 className="subhead">In libraries</h3>
            <ul className="link-list">
              {grouped.map((g) => (
                <li key={g.heading}>
                  {g.heading}
                  <ul className="link-list nested">
                    {g.links.map((l) => (
                      <li key={l.ref}>
                        <a href={l.url!} target="_blank" rel="noreferrer">
                          {l.label ?? "Catalogue record"}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {libraries
                .filter((l) => !inGroup.has(l))
                .map((l) => (
                  <LinkItem key={l.provider + l.ref} l={l} />
                ))}
            </ul>
            {w.copies > libraries.length && (
              <p className="muted small">
                Known copies in {fmt.format(w.copies)} libraries
                {rismPerson && (
                  <>
                    {" "}
                    (see <a href={rismPerson} target="_blank" rel="noreferrer">the composer's sources in RISM</a>)
                  </>
                )}
                .
              </p>
            )}
          </>
        )}
        {editions.length > 0 && (
          <>
            <h3 className="subhead">Published editions</h3>
            <ul className="link-list">
              <li>
                In the German National Library's catalogue, newest first
                <ul className="link-list nested">
                  {editions.map((l) => (
                    <li key={l.ref}>
                      <a href={l.url!} target="_blank" rel="noreferrer">
                        {l.label ?? "Catalogue record"}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </>
        )}
        {!scores.length && !libraries.length && !editions.length && (
          <p className="muted">No free score or library copy found. It may still be in copyright; look for it at a publisher or a music library.</p>
        )}
      </section>

      <section className="detail-section">
        <h2>For</h2>
        <ul className="scorings">
          {w.scorings.map((s) => (
            <li key={s.lineup}>
              <Link href={finderPath(s.lineup, s.arrangement)}>{s.description}</Link>
              {s.arrangement && <span className="badge badge-arr">Arrangement</span>}
              <span className="muted small">
                {" "}
                according to{" "}
                {s.sources.map((src, i) => {
                  const href = lineupSourceUrl(src.source, src.ref);
                  return (
                    <span key={src.source}>
                      {i > 0 && ", "}
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" title={src.ref}>
                          {SOURCES[src.source].name}
                        </a>
                      ) : (
                        <span title={src.ref}>{SOURCES[src.source].name}</span>
                      )}
                    </span>
                  );
                })}
              </span>
              {arrangedFor(s.lineup).length > 0 && <span className="arranged-tag">{arrangedFor(s.lineup).join("; ")}</span>}
            </li>
          ))}
        </ul>
        {unplaced.length > 0 && (
          <p className="muted small">
            Also arranged on IMSLP:{" "}
            {unplaced
              .slice(0, 8)
              .map((a) => [a.heading, a.excerpt && `(${a.excerpt})`].filter(Boolean).join(" "))
              .join("; ")}
            {unplaced.length > 8 && `; and ${unplaced.length - 8} more`}
          </p>
        )}
        {w.orchestration && (
          <div className="orchestration">
            <p>
              <span className={`orchestration-tag${w.orchestration.status !== "confirmed" ? " single" : ""}`}>{w.orchestration.scoring}</span>{" "}
              <span className="muted small">
                from{" "}
                <a href={w.orchestration.url} target="_blank" rel="noreferrer">
                  {w.orchestration.basis}
                </a>
                {w.orchestration.status === "confirmed" ? ", which agree" : w.orchestration.status === "single" ? ", no other source to confirm it" : ""}
              </span>
            </p>
            <p className="small">{describeOrchestration(w.orchestration.instruments)}</p>
            {w.orchestration.status === "partial" && (
              <p className="small muted">
                Not the whole scoring, as far as we can tell
                {w.orchestration.unresolved.length > 0 ? `: the parts also include ${w.orchestration.unresolved.slice(0, 4).join(", ")}, which we can't read` : ""}. It
                isn't used to say which orchestras can play it.
              </p>
            )}
          </div>
        )}
      </section>

      {others.length > 0 && w.composer && main && (
        <section className="detail-section">
          <h2>
            More by {w.composer.name} for {main.description}
          </h2>
          <WorkList works={others} />
          {(more.data?.total ?? 0) > others.length + 1 && (
            <p>
              <Link href={`${composerPath(w.composer)}?lineup=${encodeURIComponent(main.lineup)}`}>All {fmt.format(more.data!.total)}</Link>
            </p>
          )}
        </section>
      )}

      {elsewhere.length > 0 && (
        <section className="detail-section">
          <h2>Elsewhere</h2>
          <ul className="link-list">
            {elsewhere.map((l) => (
              <LinkItem key={l.provider + l.ref} l={l} />
            ))}
          </ul>
        </section>
      )}

      <section className="detail-section">
        <h2>How established it is</h2>
        <p>
          Score <strong>{w.score.toFixed(1)}</strong>
          <span className="muted">; {CORE_SCORE}+ counts as core repertoire.</span>
        </p>
        <ul className="score-parts">
          {w.scoreParts.map((p) => (
            <li key={p.label}>
              {p.label} <span className="muted">+{p.points.toFixed(1)}</span>
            </li>
          ))}
          {w.scoreParts.length === 0 && <li className="muted">No signals yet</li>}
        </ul>
      </section>

      <p className="muted small detail-foot">
        Id <code>{w.id}</code> (permanent) · <a href={`/api/works/${w.id}`}>JSON</a>
      </p>
    </article>
  );
}
