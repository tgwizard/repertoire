import { useMemo, useState } from "react";
import { ERAS, type Era } from "../shared/api";
import { imslpUrl } from "../lib/api";
import { useWorks, type LoadedWork, type Source } from "../lib/useWorks";
import type { ComposerInfo } from "../lib/wikidata";

const fmt = new Intl.NumberFormat("en");
const PAGE = 100;
type Sort = "composer" | "title" | "chronological";
const UNKNOWN = "Unknown";

/** "Reicha, Anton" → "Anton Reicha" */
function displayName(composer: string): string {
  const m = /^([^,]+), (.+)$/.exec(composer);
  return m ? `${m[2]} ${m[1]}` : composer;
}

function lifespan(info: ComposerInfo | undefined): string | null {
  if (!info?.born && !info?.died) return null;
  return `${info.born ?? "?"}–${info.died ?? ""}`;
}

export function Results({ sources, total }: { sources: Source[]; total: number }) {
  const { works, eras, info, loading, paused, error, loadAll, retry } = useWorks(sources);
  const [eraFilter, setEraFilter] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("composer");
  const [shown, setShown] = useState(PAGE);

  const eraOf = (w: LoadedWork): Era | null => w.era ?? (w.composer ? (eras[w.composer] ?? null) : null);

  const eraCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const w of works) {
      const e = eraOf(w) ?? UNKNOWN;
      c.set(e, (c.get(e) ?? 0) + 1);
    }
    return c;
  }, [works, eras]);

  const composers = useMemo(() => {
    const c = new Map<string, number>();
    for (const w of works) if (w.composer) c.set(w.composer, (c.get(w.composer) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [works]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = works.filter(
      (w) =>
        (eraFilter.size === 0 || eraFilter.has(eraOf(w) ?? UNKNOWN)) &&
        (!composer || w.composer === composer) &&
        (!q || w.title.toLowerCase().includes(q)),
    );
    const byTitle = (a: LoadedWork, b: LoadedWork) => a.work.localeCompare(b.work, undefined, { numeric: true });
    const byComposer = (a: LoadedWork, b: LoadedWork) => (a.composer ?? "~").localeCompare(b.composer ?? "~") || byTitle(a, b);
    const born = (w: LoadedWork) => (w.composer ? info[w.composer]?.born : undefined) ?? Infinity;
    const cmp =
      sort === "title" ? byTitle : sort === "composer" ? byComposer : (a: LoadedWork, b: LoadedWork) => born(a) - born(b) || byComposer(a, b);
    return list.sort(cmp);
  }, [works, eras, info, eraFilter, composer, query, sort]);

  const toggleEra = (e: string) =>
    setEraFilter((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });

  const progress = total > 0 ? Math.min(1, works.length / total) : 1;
  const eraOptions = [...ERAS, UNKNOWN].filter((e) => eraCounts.has(e));

  return (
    <section className="results" aria-label="Works">
      <div className="results-head">
        <h2>
          {fmt.format(filtered.length)} <span className="muted">of {fmt.format(works.length)} loaded</span>
        </h2>
        {(loading || paused) && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        {loading && <span className="muted small">Loading from IMSLP… {fmt.format(works.length)} / ~{fmt.format(total)}</span>}
        {paused && (
          <span className="small">
            Showing the first {fmt.format(works.length)} of ~{fmt.format(total)}.{" "}
            <button className="link-button" onClick={loadAll}>
              Load all
            </button>{" "}
            to filter across everything.
          </span>
        )}
        {error && (
          <span className="small error-text">
            {error}{" "}
            <button className="link-button" onClick={retry}>
              Retry
            </button>
          </span>
        )}
      </div>

      <div className="filters">
        <div className="era-chips" role="group" aria-label="Era">
          {eraOptions.map((e) => (
            <button key={e} className={`era-chip${eraFilter.has(e) ? " active" : ""}`} aria-pressed={eraFilter.has(e)} onClick={() => toggleEra(e)}>
              {e} <span className="era-count">{fmt.format(eraCounts.get(e) ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="filter-row">
          <input
            type="search"
            placeholder="Search titles…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
          />
          <select value={composer} onChange={(e) => (setComposer(e.target.value), setShown(PAGE))} aria-label="Composer">
            <option value="">All composers ({fmt.format(composers.length)})</option>
            {composers.map(([c, n]) => (
              <option key={c} value={c}>
                {c} ({n})
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="composer">Sort by composer</option>
            <option value="chronological">Sort by composer's birth</option>
            <option value="title">Sort by title</option>
          </select>
        </div>
      </div>

      <ol className="works">
        {filtered.slice(0, shown).map((w) => {
          const era = eraOf(w);
          const ci = w.composer ? info[w.composer] : undefined;
          return (
            <li key={w.pageid} className="work">
              <a className="work-title" href={imslpUrl(w.title)} target="_blank" rel="noreferrer">
                {w.work}
              </a>
              <div className="work-meta">
                {w.composer && (
                  <button className="composer" onClick={() => (setComposer(w.composer!), setShown(PAGE))} title="Show only this composer">
                    {displayName(w.composer)}
                  </button>
                )}
                {lifespan(ci) && <span className="muted">{lifespan(ci)}</span>}
                {ci?.wikipedia && (
                  <a className="muted wiki" href={ci.wikipedia} target="_blank" rel="noreferrer">
                    Wikipedia
                  </a>
                )}
                {era && <span className="badge">{era}</span>}
                {w.arr && <span className="badge badge-arr">Arrangement</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {filtered.length > shown && (
        <button className="more" onClick={() => setShown((s) => s + PAGE * 2)}>
          Show more ({fmt.format(filtered.length - shown)} remaining)
        </button>
      )}
      {!loading && filtered.length === 0 && works.length > 0 && <p className="muted">No works match these filters.</p>}
    </section>
  );
}
