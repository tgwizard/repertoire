import { composerPath, lifespan, useApi, type SearchResults as Results } from "../lib/api";
import { Link } from "../lib/router";
import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { setFilterParams, type Filters } from "../lib/filters";
import { useWorks } from "../lib/useWorks";
import { FilterControls } from "./FilterControls";
import { LoadError } from "./LoadError";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");

interface FieldProps {
  value: string;
  onChange: (q: string) => void;
  /** Searching within a line-up rather than everything */
  narrowed: boolean;
  id?: string;
}

/** The finder's search: everything, or within the picked line-up. */
export function SearchField({ value, onChange, narrowed, id }: FieldProps) {
  return (
    <form className="search-box" role="search" onSubmit={(e) => e.preventDefault()}>
      <input
        type="search"
        id={id}
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

interface ResultsProps {
  q: string;
  /** Where the filters go: the box with the finder's search in it */
  slot: HTMLElement | null;
  /** Filters and sort, kept in the URL */
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  includeArr: boolean;
  /** Narrow the search to one line-up */
  onPickLineup: (key: string) => void;
}

/** Search across every line-up: matching composers, then works, best matches first. */
export function SearchResults({ q, slot, filters, onFiltersChange, includeArr, onPickLineup }: ResultsProps) {
  const set = (patch: Partial<Filters>) => onFiltersChange({ ...filters, ...patch });
  const sorting = { sort: filters.sort ?? ("relevance" as const), order: filters.order };
  const params = useMemo(() => {
    const p = new URLSearchParams({ q });
    if (includeArr) p.set("arrangements", "1");
    setFilterParams(p, filters);
    p.set("sort", sorting.sort);
    if (sorting.order) p.set("order", sorting.order);
    return p.toString();
  }, [q, includeArr, filters, sorting.sort, sorting.order]);
  const { works, total, facets, loading, error, hasMore, loadMore, retry } = useWorks(params);
  // Facets describe the list as filtered; keep the last ones while a new query loads.
  const lastFacets = useRef(facets);
  if (facets) lastFacets.current = facets;
  const f = facets ?? lastFacets.current;
  const composers = useApi<Results>(`/api/search?q=${encodeURIComponent(q)}&limit=1`).data?.composers ?? [];

  return (
    <section className="results" aria-label="Search results">
      {/* Into the box the search is in (FinderPage), so the search never moves */}
      {slot &&
        createPortal(
          <FilterControls
            filters={{ ...filters, sort: sorting.sort }}
            set={set}
            facets={f}
            sorts={["relevance", "rank", "chronological", "duration", "composer", "title"]}
            before={
              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-lineup">
                  Line-up
                </label>
                <select id="filter-lineup" value="" onChange={(e) => e.target.value && onPickLineup(e.target.value)}>
                  <option value="">Any ({fmt.format(f?.lineups.length ?? 0)}{f?.lineups.length === 60 ? "+" : ""})</option>
                  {(f?.lineups ?? []).map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.description} ({fmt.format(l.count)})
                    </option>
                  ))}
                </select>
              </div>
            }
          />,
          slot,
        )}
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
      <div className="results-head">
        <h2>
          {fmt.format(total)} <span className="muted">{total === 1 ? "work" : "works"} matching “{q}” in every line-up</span>
        </h2>
      </div>
      <div className={loading && works.length ? "works-wrap stale" : "works-wrap"}>
        <WorkList works={works} showLineup />
      </div>
      {loading && !works.length && (
        <p className="muted">
          <span className="spinner" /> Searching…
        </p>
      )}
      {error && <LoadError what="the search results" message={error} onRetry={retry} />}
      {!loading && !error && total === 0 && <p className="muted">Nothing found. Try fewer words, other filters, or a composer's surname.</p>}
      {hasMore && (
        <button className="more" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : `Load more (${fmt.format(total - works.length)} left)`}
        </button>
      )}
    </section>
  );
}
