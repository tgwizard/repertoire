import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useApi } from "../lib/api";
import { describe, parseEnsembleKey, playerCount } from "../lib/instrumentation";
import { describeOrchestration, EXAMPLES, formatOrchestration, hasOrchestra, readOrchestration } from "../lib/orchestration";
import { setFilterParams, type Filters } from "../lib/filters";
import { useDebounced } from "../lib/useDebounced";
import { useWorks } from "../lib/useWorks";
import { lineupSourceUrl, SOURCES, type SourceId } from "../shared/data";
import { setSortParams, type Sorting } from "./SortSelect";
import { InfoTip } from "./InfoTip";
import { LoadError } from "./LoadError";
import { FilterControls } from "./FilterControls";
import { WorkList } from "./WorkList";

const fmt = new Intl.NumberFormat("en");

interface Props {
  lineup: string;
  /** Works for exactly this line-up */
  total: number;
  includeArr: boolean;
  smaller: boolean;
  onSmallerChange: (v: boolean) => void;
  /** Smaller groups (2+ players) drawn from this line-up that have works */
  smallerGroups: number;
  /** Search text from the finder's search box */
  q: string;
  /** Where the filters go: the box with the finder's search in it */
  slot: HTMLElement | null;
  /** Filters and sort, kept in the URL */
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  /** An orchestra's scoring as typed, for line-ups with an orchestra */
  orchestra: string;
  onOrchestraChange: (v: string) => void;
  exact: boolean;
  onExactChange: (v: boolean) => void;
  onSearchEverywhere: () => void;
}


interface LineupInfo {
  sources: Partial<Record<SourceId, string[]>>;
}

/** Where a line-up's definition comes from, as links to the source categories, behind a "?". */
function LineupSources({ lineup }: { lineup: string }) {
  const { data } = useApi<LineupInfo>(`/api/lineups/${encodeURIComponent(lineup)}`);
  const entries = Object.entries(data?.sources ?? {}) as [SourceId, string[]][];
  if (!entries.length) return null;
  return (
    <InfoTip label="Where this line-up comes from">
      <span className="lineup-sources">
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
      </span>
    </InfoTip>
  );
}

export function Results({ lineup, total, includeArr, smaller, onSmallerChange, smallerGroups, q, slot, filters, onFiltersChange, orchestra, onOrchestraChange, exact, onExactChange, onSearchEverywhere }: Props) {
  const players = playerCount(parseEnsembleKey(lineup));
  const { eras, composer, show, minPlayers, within, length } = filters;
  // Largest groups first reads best when listing smaller groups too; group sizes only
  // vary then
  const sortDefault = smaller && !within ? "players" : "rank";
  const sorting: Sorting = { sort: filters.sort === "players" && !(smaller && !within) ? "rank" : (filters.sort ?? sortDefault), order: filters.order };
  const set = (patch: Partial<Filters>) => onFiltersChange({ ...filters, ...patch });
  const withOrchestra = hasOrchestra(lineup);
  const typed = useDebounced(orchestra.trim(), 300);
  const { orchestration: ours, unreadable } = useMemo(
    () => (withOrchestra && typed ? readOrchestration(typed) : { orchestration: null, unreadable: null }),
    [withOrchestra, typed],
  );
  // While what's typed can't be read, the list keeps the last scoring that could
  const lastOurs = useRef(ours);
  if (!unreadable) lastOurs.current = ours;
  const applied = unreadable ? lastOurs.current : ours;

  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("lineup", within || lineup);
    if (smaller && !within) {
      p.set("subsets", "1");
      p.set("min_players", String(minPlayers));
    }
    if (includeArr) p.set("arrangements", "1");
    setFilterParams(p, filters);
    if (q) p.set("q", q);
    if (applied) p.set("orchestra", formatOrchestration(applied));
    if (applied && exact) p.set("fit", "exact");
    setSortParams(p, sorting);
    return p.toString().replaceAll("%2C", ",");
  }, [lineup, within, smaller, minPlayers, includeArr, filters, q, applied, exact, sorting.sort, sorting.order]);

  const { works, total: matching, facets, unscored, loading, error, hasMore, loadMore, retry } = useWorks(params);
  const filtering = q !== "" || eras.length > 0 || composer !== "" || show !== "all" || !!applied || length !== "";
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

  const description = describe(parseEnsembleKey(lineup));
  const listTotal = filtering ? matching : smaller && !within ? matching : total;

  return (
    <section className="results" aria-label="Works" ref={sectionRef}>
      {/* Everything that narrows the list, together */}
      {/* Into the box the search is in (FinderPage), so the search never moves */}
      {slot &&
        createPortal(
          <>
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
                    <select value={minPlayers} onChange={(e) => set({ minPlayers: Number(e.target.value), within: "" })} aria-label="Smallest group">
                      {Array.from({ length: Math.max(1, players - 1) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n === 1 ? "Solos and up" : `${n}+ players`}
                        </option>
                      ))}
                    </select>
                    <select value={within} onChange={(e) => set({ within: e.target.value })} aria-label="Group">
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

            {withOrchestra && (
              <div className="orchestra-row">
                <div className="orchestra-field">
                  <span className="orchestra-label">
                    <label className="filter-label" htmlFor="orchestra">
                    Your orchestra
                  </label>
                    <InfoTip label="How to write an orchestra">
                      {(close) => (
                        <>
                          Winds and brass as players per section: <strong>flutes.oboes.clarinets.bassoons</strong>, then{" "}
                          <strong>horns.trumpets.trombones.tuba</strong>. Then the rest: timp, perc, hp, cel, pf, org, hpd, str (strings), with a
                          number for more than one (2hp, 3perc). A piccolo, English horn and the like go after their section with +: 3+picc.
                          <span className="orchestra-examples">
                            {EXAMPLES.map(([label, scoring]) => (
                              <button
                                key={label}
                                type="button"
                                className="orchestra-example"
                                onClick={() => {
                                  onOrchestraChange(scoring);
                                  close();
                                }}
                              >
                                <span>{label}</span> <code>{scoring}</code>
                              </button>
                            ))}
                          </span>
                        </>
                      )}
                    </InfoTip>
                  </span>
                  <input
                    id="orchestra"
                    aria-invalid={!!unreadable}
                    aria-describedby="orchestra-hint"
                    value={orchestra}
                    onChange={(e) => onOrchestraChange(e.target.value)}
                    placeholder="e.g. 2.2.2.2 4.2.3.1 timp str"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                  />
                </div>
                <select value={exact ? "exact" : "within"} onChange={(e) => onExactChange(e.target.value === "exact")} aria-label="Match">
                  <option value="within">What it can play</option>
                  <option value="exact">Scored exactly so</option>
                </select>
                {/* Always there, two lines tall, so typing doesn't move the page */}
                <p id="orchestra-hint" className={`orchestra-hint${unreadable ? " invalid" : ""}`} aria-live="polite">
                  {unreadable ? (
                    <>
                      <strong>Couldn't read “{unreadable}”.</strong> Write it like{" "}
                      <button type="button" className="link-button" onClick={() => onOrchestraChange(EXAMPLES[1]![1])}>
                        <code>{EXAMPLES[1]![1]}</code>
                      </button>
                      ; the ? above explains how.
                    </>
                  ) : ours ? (
                    <>
                      {describeOrchestration(ours)}.
                      {unscored > 0 && (
                        <span className="muted">
                          {" "}
                          Leaves out {fmt.format(unscored)} orchestral {unscored === 1 ? "work" : "works"} whose scoring we don't know.
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      Write it like{" "}
                      <button type="button" className="link-button" onClick={() => onOrchestraChange(EXAMPLES[1]![1])}>
                        <code>{EXAMPLES[1]![1]}</code>
                      </button>{" "}
                      to see what it can play; the ? explains how.
                    </>
                  )}
                </p>
              </div>
            )}

            <FilterControls
              filters={{ ...filters, sort: sorting.sort }}
              set={set}
              facets={f}
              sorts={smaller && !within ? ["players", "rank", "chronological", "duration", "composer", "title"] : ["rank", "chronological", "duration", "composer", "title"]}
            />
          </>,
          slot,
        )}

      <div className="results-head">
        {/* One line however it's filtered, so filtering doesn't move the list */}
        <h2>
          {fmt.format(filtering ? matching : listTotal)}{" "}
          <span className="muted">
            {q ? `${matching === 1 ? "work" : "works"} matching “${q}”` : filtering ? `matching ${matching === 1 ? "work" : "works"}` : listTotal === 1 ? "work" : "works"} for{" "}
            {within ? describe(parseEnsembleKey(within)) : smaller ? `${description} and smaller groups` : description}
          </span>
          {!smaller && <LineupSources lineup={lineup} />}
        </h2>
        {q && (
          <p className="results-sub">
            <button className="link-button" onClick={onSearchEverywhere}>
              Search all line-ups instead
            </button>
          </p>
        )}
      </div>

      <div className={loading && works.length ? "works-wrap stale" : "works-wrap"}>
        <WorkList works={works} lineup={lineup} onComposer={(id) => set({ composer: id })} groupByPlayers={smaller && !within && sorting.sort === "players" ? players : undefined} />
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
      {error && <LoadError what="the works" message={error} onRetry={retry} />}
      {!loading && !error && works.length === 0 && <p className="muted">No works match these filters.</p>}
    </section>
  );
}
