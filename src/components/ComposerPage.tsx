import { useEffect, useMemo, useState } from "react";
import { lifespan, useApi, type ComposerDetail } from "../lib/api";
import { useWorks } from "../lib/useWorks";
import { PROVIDERS, type WorkSort } from "../shared/data";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");
const LINEUPS_SHOWN = 12;

export function ComposerPage({ id }: { id: string }) {
  const { data: c, error } = useApi<ComposerDetail>(`/api/composers/${id}`);
  const [lineup, setLineup] = useState(() => new URLSearchParams(location.search).get("lineup") ?? "");
  const [sort, setSort] = useState<WorkSort>("rank");
  const [allLineups, setAllLineups] = useState(false);

  useEffect(() => {
    if (c) document.title = `${c.name} · Repertoire Finder`;
  }, [c]);
  useEffect(() => {
    const url = new URL(location.href);
    if (lineup) url.searchParams.set("lineup", lineup);
    else url.searchParams.delete("lineup");
    history.replaceState(null, "", url.pathname + url.search.replaceAll("%2C", ","));
  }, [lineup]);

  const query = useMemo(() => {
    // Arrangements too: some works survive on IMSLP only in arrangements.
    const p = new URLSearchParams({ composer: id, arrangements: "1" });
    if (lineup) p.set("lineup", lineup);
    if (sort !== "rank") p.set("sort", sort);
    return p.toString().replaceAll("%2C", ",");
  }, [id, lineup, sort]);
  const { works, total, loading, hasMore, loadMore } = useWorks(c ? query : null);

  if (error) return <div className="notice error">{"status" in error && error.status === 404 ? "No such composer." : `Couldn't load this composer: ${error.message}`}</div>;
  if (!c || c.id !== id) {
    return (
      <div className="notice">
        <span className="spinner" /> Loading…
      </div>
    );
  }
  const lineups = allLineups ? c.lineups : c.lineups.slice(0, LINEUPS_SHOWN);

  return (
    <article className="page-detail">
      <header className="detail-head">
        <p className="eyebrow">Composer</p>
        <h1>{c.name}</h1>
        <p className="detail-meta">
          {lifespan(c) && <span>{lifespan(c)}</span>}
          {c.era && <span className="badge">{c.era}</span>}
          <span className="muted"> · {fmt.format(c.works)} works</span>
        </p>
        {c.links.length > 0 && (
          <ul className="link-list inline">
            {c.links
              .filter((l) => l.url)
              .map((l) => (
                <li key={l.provider}>
                  <a href={l.url!} target="_blank" rel="noreferrer">
                    {l.provider === "imslp" ? "Works on IMSLP" : PROVIDERS[l.provider].name}
                  </a>
                </li>
              ))}
          </ul>
        )}
      </header>

      <section className="detail-section">
        <h2>By line-up</h2>
        <div className="era-chips" role="group" aria-label="Line-up">
          <button className={`era-chip${lineup === "" ? " active" : ""}`} aria-pressed={lineup === ""} onClick={() => setLineup("")}>
            All <span className="era-count">{fmt.format(c.works)}</span>
          </button>
          {lineups.map((l) => (
            <button key={l.key} className={`era-chip${lineup === l.key ? " active" : ""}`} aria-pressed={lineup === l.key} onClick={() => setLineup(lineup === l.key ? "" : l.key)}>
              {l.description} <span className="era-count">{fmt.format(l.count)}</span>
            </button>
          ))}
          {c.lineups.length > LINEUPS_SHOWN && (
            <button className="link-button small" onClick={() => setAllLineups(!allLineups)}>
              {allLineups ? "Fewer" : `${c.lineups.length - LINEUPS_SHOWN} more`}
            </button>
          )}
        </div>
      </section>

      <section className="detail-section">
        <div className="results-head row">
          <h2>
            {fmt.format(total)} <span className="muted">{total === 1 ? "work" : "works"}</span>
          </h2>
          <select value={sort} onChange={(e) => setSort(e.target.value as WorkSort)} aria-label="Sort">
            <option value="rank">Most established first</option>
            <option value="chronological">Chronological</option>
            <option value="title">By title</option>
          </select>
        </div>
        <WorkList works={works} lineup={lineup || undefined} showLineup={!lineup} />
        {hasMore && (
          <button className="more" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : `Load more (${fmt.format(total - works.length)} left)`}
          </button>
        )}
      </section>
    </article>
  );
}
