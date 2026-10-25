import { useEffect } from "react";
import { composerPath, finderPath, lifespan, useApi, type WorkDetail, type WorksPage } from "../lib/api";
import { Link } from "../lib/router";
import { CORE_SCORE, lineupSourceUrl, PROVIDERS, SOURCES, type Link as WorkLink } from "../shared/data";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");

function LinkItem({ l }: { l: WorkLink }) {
  const name = PROVIDERS[l.provider].name;
  const text =
    l.provider === "imslp" ? "Sheet music on IMSLP" : l.provider === "musicbrainz" && l.label ? `MusicBrainz · ${l.label.replace(/^(\d+)/, (n) => fmt.format(Number(n)))}` : name;
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

export function WorkPage({ id }: { id: string }) {
  const { data: w, error, loading } = useApi<WorkDetail>(`/api/works/${id}`);
  const main = w?.scorings.find((s) => !s.arrangement) ?? w?.scorings[0];
  const more = useApi<WorksPage>(w?.composer && main ? `/api/works?composer=${w.composer.id}&lineup=${encodeURIComponent(main.lineup)}&limit=6` : null);

  useEffect(() => {
    if (w) document.title = `${w.title}${w.composer ? ` – ${w.composer.name}` : ""} · Repertoire Finder`;
  }, [w]);

  if (error) return <div className="notice error">{"status" in error && error.status === 404 ? "No such work." : `Couldn't load this work: ${error.message}`}</div>;
  if (!w || (loading && w.id !== id)) {
    return (
      <div className="notice">
        <span className="spinner" /> Loading…
      </div>
    );
  }

  const scores = w.links.filter((l) => l.kind === "score");
  const libraries = w.links.filter((l) => l.kind === "library");
  const elsewhere = w.links.filter((l) => l.kind === "reference" || l.kind === "data");
  const others = (more.data?.works ?? []).filter((o) => o.id !== w.id).slice(0, 5);

  return (
    <article className="page-detail">
      <header className="detail-head">
        <p className="eyebrow">Work</p>
        <h1>{w.title}</h1>
        {w.aliases.length > 0 && <p className="aliases muted">Also listed as {w.aliases.map((a) => `“${a}”`).join(", ")}</p>}
        <p className="detail-meta">
          {w.composer && (
            <>
              <Link href={composerPath(w.composer)}>{w.composer.name}</Link>
              {lifespan(w.composer) && <span className="muted"> {lifespan(w.composer)}</span>}
            </>
          )}
          {w.year && <span className="muted"> · {w.year}</span>}
          {w.era && <span className="badge">{w.era}</span>}
          {w.score >= CORE_SCORE && <span className="badge badge-core">Core repertoire</span>}
        </p>
      </header>

      <section className="detail-section">
        <h2>Get the music</h2>
        {scores.length || libraries.length ? (
          <ul className="link-list big">
            {scores.map((l) => (
              <LinkItem key={l.provider + l.ref} l={l} />
            ))}
            {libraries.map((l) => (
              <LinkItem key={l.provider + l.ref} l={l} />
            ))}
          </ul>
        ) : (
          <p className="muted">No free score found. It may still be in copyright; look for it at a publisher or a music library.</p>
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
            </li>
          ))}
        </ul>
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
