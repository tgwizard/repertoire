import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../lib/api";
import { describe, parseEnsembleKey, playerCount } from "../lib/instrumentation";
import { useDebounced } from "../lib/useDebounced";
import { useWorks } from "../lib/useWorks";
import { ERAS, lineupSourceUrl, SOURCES, type SourceId, type WorkSort } from "../shared/data";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");
type Show = "all" | "core" | "free";
const UNKNOWN = "Unknown";

interface Props {
  lineup: string;
  /** Works for exactly this line-up */
  total: number;
  includeArr: boolean;
  smaller: boolean;
  onSmallerChange: (v: boolean) => void;
  /** Smaller groups (2+ players) drawn from this line-up that have works */
  smallerGroups: number;
}

interface LineupInfo {
  sources: Partial<Record<SourceId, string[]>>;
}

/** Where a line-up's definition comes from, as links to the source categories. */
function LineupSources({ lineup }: { lineup: string }) {
  const { data } = useApi<LineupInfo>(`/api/lineups/${encodeURIComponent(lineup)}`);
  const entries = Object.entries(data?.sources ?? {}) as [SourceId, string[]][];
  if (!entries.length) return null;
  return (
    <p className="lineup-sources">
      Line-up from{" "}
      {entries.map(([s, names], i) => (
        <span key={s}>
          {i > 0 && (i === entries.length - 1 ? " and " : ", ")}
          <strong>{SOURCES[s].name}</strong>{" "}
          <span className="muted">
            (
            {names.slice(0, 3).map((n, j) => {
              const href = lineupSourceUrl(s, n);
              return (
                <span key={n}>
                  {j > 0 && ", "}
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer">
                      {n}
                    </a>
                  ) : (
                    n
                  )}
                </span>
              );
            })}
            {names.length > 3 && `, +${names.length - 3}`})
          </span>
        </span>
      ))}
      .
    </p>
  );
}

export function Results({ lineup, total, includeArr, smaller, onSmallerChange, smallerGroups }: Props) {
  const players = playerCount(parseEnsembleKey(lineup));
  const [eras, setEras] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WorkSort>("rank");
  const [show, setShow] = useState<Show>("all");
  const [minPlayers, setMinPlayers] = useState(2);
  const [within, setWithin] = useState("");
  const q = useDebounced(query.trim(), 250);

  // Switching to smaller groups: largest groups first reads best.
  useEffect(() => setSort(smaller ? "players" : "rank"), [smaller]);
  useEffect(() => setWithin(""), [smaller, minPlayers]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("lineup", within || lineup);
    if (smaller && !within) {
      p.set("subsets", "1");
      p.set("min_players", String(minPlayers));
    }
    if (includeArr) p.set("arrangements", "1");
    if (composer) p.set("composer", composer);
    for (const e of [...eras].sort()) p.append("era", e);
    if (show !== "all") p.set("show", show);
    if (q) p.set("q", q);
    if (sort !== "rank") p.set("sort", sort === "players" && (!smaller || within) ? "rank" : sort);
    return p.toString().replaceAll("%2C", ",");
  }, [lineup, within, smaller, minPlayers, includeArr, composer, eras, show, q, sort]);

  const { works, total: matching, facets, loading, error, hasMore, loadMore } = useWorks(params);
  const filtering = q !== "" || eras.size > 0 || composer !== "" || show !== "all";
  // Facets describe the unfiltered list; keep the last ones while a new query loads.
  const lastFacets = useRef(facets);
  if (facets) lastFacets.current = facets;
  const f = facets ?? lastFacets.current;

  // A new line-up: bring the top of the results into view if we've scrolled past it.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = sectionRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  const toggleEra = (e: string) =>
    setEras((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });

  const eraOptions = [...ERAS, UNKNOWN].filter((e) => f?.eras[e as keyof typeof f.eras]);
  const description = describe(parseEnsembleKey(lineup));
  const listTotal = filtering ? matching : smaller && !within ? matching : total;

  return (
    <section className="results" aria-label="Works" ref={sectionRef}>
      <div className="results-head">
        <h2>
          {filtering ? (
            <>
              {fmt.format(matching)} <span className="muted">works match</span>
            </>
          ) : (
            <>
              {fmt.format(listTotal)}{" "}
              <span className="muted">
                {listTotal === 1 ? "work" : "works"} for {within ? describe(parseEnsembleKey(within)) : smaller ? `${description} and smaller groups` : description}
              </span>
            </>
          )}
        </h2>
        <p className="results-sub">
          {filtering ? `For ${description}${smaller ? " and smaller groups" : ""}. ` : smaller ? "Largest groups first. " : "Most established first. "}
          {error && <span className="error-text"> {error}</span>}
        </p>
      </div>
      {!smaller && <LineupSources lineup={lineup} />}

      {players > 1 && (
        <div className="smaller-row">
          <label className="toggle">
            <input type="checkbox" checked={smaller} onChange={(e) => onSmallerChange(e.target.checked)} />
            <span>
              Include smaller groups from these players
              {smallerGroups > 0 && !smaller && (
                <span className="muted">
                  {" "}
                  · {fmt.format(smallerGroups)} {smallerGroups === 1 ? "group has" : "groups have"} works
                </span>
              )}
            </span>
          </label>
          {smaller && (
            <>
              <select value={minPlayers} onChange={(e) => setMinPlayers(Number(e.target.value))} aria-label="Smallest group">
                {Array.from({ length: Math.max(1, players - 1) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "Solos and up" : `${n}+ players`}
                  </option>
                ))}
              </select>
              <select value={within} onChange={(e) => setWithin(e.target.value)} aria-label="Group">
                <option value="">All groups{f?.lineups.length ? ` (${f.lineups.length})` : ""}</option>
                {(f?.lineups ?? []).map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.description} ({fmt.format(l.count)})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <div className="filters">
        <div className="era-chips" role="group" aria-label="Show">
          {(
            [
              ["all", "All", null],
              ["core", "Core repertoire", f?.core],
              ["free", "Free sheet music", f?.free],
            ] as [Show, string, number | null | undefined][]
          ).map(([value, label, n]) => (
            <button key={value} className={`era-chip${show === value ? " active" : ""}`} aria-pressed={show === value} onClick={() => setShow(value)}>
              {label} {n !== null && n !== undefined && <span className="era-count">{fmt.format(n)}</span>}
            </button>
          ))}
          <span className="chip-sep" />
          {eraOptions.map((e) => (
            <button key={e} className={`era-chip${eras.has(e) ? " active" : ""}`} aria-pressed={eras.has(e)} onClick={() => toggleEra(e)}>
              {e} <span className="era-count">{fmt.format(f?.eras[e as keyof typeof f.eras] ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="filter-row">
          <input type="search" placeholder="Search titles and composers…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={composer} onChange={(e) => setComposer(e.target.value)} aria-label="Composer">
            <option value="">All composers{f ? ` (${fmt.format(f.composers.length)}${f.composers.length === 300 ? "+" : ""})` : ""}</option>
            {(f?.composers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as WorkSort)} aria-label="Sort">
            {smaller && !within && <option value="players">Largest groups first</option>}
            <option value="rank">Most established first</option>
            <option value="chronological">Chronological</option>
            <option value="composer">By composer</option>
            <option value="title">By title</option>
          </select>
        </div>
      </div>

      <div className={loading && works.length ? "works-wrap stale" : "works-wrap"}>
        <WorkList works={works} lineup={lineup} onComposer={setComposer} groupByPlayers={smaller && !within && sort === "players" ? players : undefined} />
      </div>
      {loading && !works.length && (
        <p className="muted">
          <span className="spinner" /> Loading…
        </p>
      )}
      {hasMore && (
        <button className="more" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : `Load more (${fmt.format(matching - works.length)} left)`}
        </button>
      )}
      {!loading && works.length === 0 && <p className="muted">No works match these filters.</p>}
    </section>
  );
}
