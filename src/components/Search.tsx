import { useEffect, useRef, useState } from "react";
import { composerPath, lifespan, searchPath, useApi, workPath, type SearchResults } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useDebounced } from "../lib/useDebounced";
import { useWorks, WORKS_PAGE } from "../lib/useWorks";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");

/** The masthead search: suggestions as you type, Enter for all results. */
export function SearchBox({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q.trim(), 200);
  const { data } = useApi<SearchResults>(open && debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced)}&limit=6` : null);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
    window.scrollTo(0, 0);
  };
  const results = data && debounced.length >= 2 ? data : null;

  return (
    <form
      className="search-box"
      role="search"
      ref={box}
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) go(searchPath(q.trim()));
      }}
    >
      <input
        type="search"
        name="q"
        placeholder="Search works and composers"
        aria-label="Search works and composers"
        autoComplete="off"
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open && results && (results.composers.length > 0 || results.works.length > 0) && (
        <div className="suggestions">
          {results.composers.slice(0, 3).map((c) => (
            <button type="button" key={c.id} className="suggestion" onClick={() => go(composerPath(c))}>
              <span className="suggestion-title">{c.name}</span>
              <span className="muted small">
                {lifespan(c)} · {fmt.format(c.works)} works
              </span>
            </button>
          ))}
          {results.works.map((w) => (
            <button type="button" key={w.id} className="suggestion" onClick={() => go(workPath(w))}>
              <span className="suggestion-title">{w.title}</span>
              <span className="muted small">{w.composer?.name}</span>
            </button>
          ))}
          <button type="submit" className="suggestion all">
            All {fmt.format(results.total)} results for “{debounced}”
          </button>
        </div>
      )}
    </form>
  );
}

export function SearchPage({ q }: { q: string }) {
  useEffect(() => {
    document.title = `${q} · Search · Repertoire Finder`;
  }, [q]);
  const query = q ? `q=${encodeURIComponent(q)}` : null;
  // /api/search pages like /api/works; the first page (shared with useWorks' cache) has the composers.
  const { works, total, loading, hasMore, loadMore } = useWorks(query, "/api/search");
  const first = useApi<SearchResults>(query ? `/api/search?${query}&limit=${WORKS_PAGE}&offset=0&facets=1` : null);

  if (!q) return <div className="notice">Type something to search for.</div>;
  const composers = first.data?.composers ?? [];
  return (
    <article className="page-detail">
      <header className="detail-head">
        <p className="eyebrow">Search</p>
        <h1>“{q}”</h1>
        {first.data && <p className="muted">{total === 0 ? "Nothing found. Try fewer words, or a composer's surname." : `${fmt.format(total)} works`}</p>}
      </header>
      {loading && !works.length && (
        <p className="muted">
          <span className="spinner" /> Searching…
        </p>
      )}
      {composers.length > 0 && (
        <section className="detail-section">
          <h2>Composers</h2>
          <ul className="composer-cards">
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
        </section>
      )}
      {works.length > 0 && (
        <section className="detail-section">
          <h2>Works</h2>
          <WorkList works={works} showLineup />
          {hasMore && (
            <button className="more" onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : `Load more (${fmt.format(total - works.length)} left)`}
            </button>
          )}
        </section>
      )}
    </article>
  );
}
