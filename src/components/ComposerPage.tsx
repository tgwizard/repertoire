import { useEffect, useMemo, useState } from "react";
import { lifespan, useApi, type ComposerDetail } from "../lib/api";
import { readFilters } from "../lib/filters";
import { useWorks } from "../lib/useWorks";
import { PROVIDERS } from "../shared/data";
import { setSortParams, SortSelect, type Sorting } from "./SortSelect";
import { GoneNotice } from "./GoneNotice";
import { LoadError } from "./LoadError";
import { LoadingStatus } from "./LoadingStatus";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");
const LINEUPS_SHOWN = 12;

export function ComposerPage({ id }: { id: string }) {
  const { data: c, error } = useApi<ComposerDetail>(`/api/composers/${id}`);
  const [lineup, setLineup] = useState(() => new URLSearchParams(location.search).get("lineup") ?? "");
  const [sorting, setSorting] = useState<Sorting>(() => {
    const { sort, order } = readFilters(new URLSearchParams(location.search));
    return { sort: sort ?? "rank", order };
  });
  const [allLineups, setAllLineups] = useState(false);
  // Also the works they arranged (other composers')
  const [arranged, setArranged] = useState(() => new URLSearchParams(location.search).get("arr") === "1");

  useEffect(() => {
    if (c) document.title = `${c.name} · Repertoire Finder`;
  }, [c]);
  useEffect(() => {
    const url = new URL(location.href);
    if (lineup) url.searchParams.set("lineup", lineup);
    else url.searchParams.delete("lineup");
    if (arranged) url.searchParams.set("arr", "1");
    else url.searchParams.delete("arr");
    url.searchParams.delete("sort");
    url.searchParams.delete("order");
    setSortParams(url.searchParams, sorting);
    history.replaceState(null, "", url.pathname + url.search.replaceAll("%2C", ","));
  }, [lineup, sorting, arranged]);

  const query = useMemo(() => {
    // Arrangements too: some works survive on IMSLP only in arrangements.
    const p = new URLSearchParams({ composer: id, arrangements: "1" });
    if (lineup) p.set("lineup", lineup);
    if (arranged) p.set("arranged_by", "1");
    setSortParams(p, sorting);
    return p.toString().replaceAll("%2C", ",");
  }, [id, lineup, sorting, arranged]);
  const { works, total, loading, more, error: worksError, hasMore, loadMore, retry } = useWorks(c ? query : null);
  const busy = loading && !more;

  if (error && "gone" in error && error.gone) return <GoneNotice gone={error.gone} what="composer" />;
  if (error) return <div className="notice error">{"status" in error && error.status === 404 ? "No such composer." : `Couldn't load this composer. ${error.message}`}</div>;
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
          <span className="muted"> · {fmt.format(c.works)} {c.works === 1 ? "work" : "works"}</span>
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
          {c.arranged > 0 && (
            <button
              className={`era-chip toggle-chip${arranged ? " active" : ""}`}
              aria-pressed={arranged}
              title={`Other composers' works ${c.name} arranged, according to IMSLP`}
              onClick={() => setArranged(!arranged)}
            >
              Their arrangements <span className="era-count">{fmt.format(c.arranged)}</span>
            </button>
          )}
        </div>
      </section>

      <section className="detail-section">
        <div className={busy ? "results-head row stale" : "results-head row"}>
          <h2>
            {fmt.format(total)} <span className="muted">{total === 1 ? "work" : "works"}</span>
          </h2>
          <SortSelect sorting={sorting} onChange={setSorting} sorts={["rank", "chronological", "duration", "title"]} />
        </div>
        <div className={busy && works.length ? "works-wrap stale" : "works-wrap"}>
          {works.length > 0 && <LoadingStatus busy={busy} over />}
          <WorkList works={works} lineup={lineup || undefined} showLineup={!lineup} />
        </div>
        {!works.length && <LoadingStatus busy={busy} over={false} label="Loading…" />}
        {worksError && <LoadError what="the works" message={worksError} onRetry={retry} />}
        {hasMore && (
          <button className="more" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : `Load more (${fmt.format(total - works.length)} left)`}
          </button>
        )}
      </section>
    </article>
  );
}
