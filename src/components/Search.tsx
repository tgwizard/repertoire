import { composerPath, lifespan, useApi, type SearchResults as Results } from "../lib/api";
import { Link } from "../lib/router";
import { useWorks, WORKS_PAGE } from "../lib/useWorks";
import { LoadError } from "./LoadError";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");

interface FieldProps {
  value: string;
  onChange: (q: string) => void;
  /** Searching within a line-up rather than everything */
  narrowed: boolean;
}

/** The finder's search: everything, or within the picked line-up. */
export function SearchField({ value, onChange, narrowed }: FieldProps) {
  return (
    <form className="search-box" role="search" onSubmit={(e) => e.preventDefault()}>
      <input
        type="search"
        name="q"
        placeholder={narrowed ? "Search within this line-up: title, composer, Op. or K. number…" : "Search works and composers"}
        aria-label="Search works and composers"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </form>
  );
}

/** Search across every line-up: composers first, then works by relevance. */
export function SearchResults({ q }: { q: string }) {
  const query = `q=${encodeURIComponent(q)}`;
  const { works, total, loading, error, hasMore, loadMore, retry } = useWorks(query, "/api/search");
  // The first page (shared with useWorks' cache) has the matching composers.
  const first = useApi<Results>(`/api/search?${query}&limit=${WORKS_PAGE}&offset=0&facets=1`);
  const composers = first.data?.composers ?? [];

  return (
    <section className="results" aria-label="Search results">
      <div className="results-head">
        <h2>
          {first.data ? fmt.format(total) : "…"} <span className="muted">{total === 1 ? "work matches" : "works match"} “{q}”</span>
        </h2>
        <p className="results-sub">In every line-up. Pick players to narrow it down.</p>
      </div>
      {composers.length > 0 && (
        <ul className="composer-matches">
          {composers.map((c) => (
            <li key={c.id}>
              <Link href={composerPath(c)}>{c.name}</Link>
              <span className="muted small">
                {" "}
                {lifespan(c)} · {fmt.format(c.works)} works
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={loading && works.length ? "works-wrap stale" : "works-wrap"}>
        <WorkList works={works} showLineup />
      </div>
      {loading && !works.length && (
        <p className="muted">
          <span className="spinner" /> Searching…
        </p>
      )}
      {error && <LoadError what="the search results" message={error} onRetry={retry} />}
      {!loading && !error && first.data && total === 0 && <p className="muted">Nothing found. Try fewer words, or a composer's surname.</p>}
      {hasMore && (
        <button className="more" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : `Load more (${fmt.format(total - works.length)} left)`}
        </button>
      )}
    </section>
  );
}
