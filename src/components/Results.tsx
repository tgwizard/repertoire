import { useMemo, useState } from "react";
import {
  imslpCategoryUrl,
  imslpUrl,
  musicbrainzUrl,
  useEnsembleWorks,
  wikidataUrl,
  wikipediaCategoryUrl,
  wikipediaUrl,
} from "../lib/data";
import { describe, parseEnsembleKey } from "../lib/instrumentation";
import { CORE_SCORE, ERAS, SIGNALS, SOURCES, type Composer, type SourceId, type Work } from "../shared/data";

const fmt = new Intl.NumberFormat("en");
const PAGE = 100;
type Sort = "rank" | "composer" | "title" | "chronological";
type Show = "all" | "core" | "imslp";
const UNKNOWN = "Unknown";

interface Props {
  ensembleKey: string;
  shards: number[];
  total: number;
  includeArr: boolean;
}

function lifespan(c: Composer | undefined): string | null {
  if (!c?.born && !c?.died) return null;
  return `${c.born ?? "?"}–${c.died ?? ""}`;
}

/** Where a line-up's definition comes from, as links to the source categories. */
function LineupSources({ sources }: { sources: Partial<Record<SourceId, string[]>> }) {
  const link = (s: SourceId, name: string) => {
    if (s === "imslp") return imslpCategoryUrl(name);
    if (s === "wikipedia") return wikipediaCategoryUrl(name);
    if (s === "wikidata") return wikidataUrl(name);
    return null;
  };
  const entries = Object.entries(sources) as [SourceId, string[]][];
  if (!entries.length) return null;
  return (
    <p className="lineup-sources">
      Line-up from{" "}
      {entries.map(([s, names], i) => (
        <span key={s}>
          {i > 0 && (i === entries.length - 1 ? " and " : ", ")}
          <strong>{SOURCES[s].name}</strong>{" "}
          {s === "openopus" ? (
            <span className="muted">(work titles naming the ensemble)</span>
          ) : (
            <span className="muted">
              (
              {names.slice(0, 3).map((n, j) => {
                const href = link(s, n);
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
          )}
        </span>
      ))}
      .
    </p>
  );
}

function SourceLinks({ w }: { w: Work }) {
  return (
    <span className="source-links">
      {w.imslp ? (
        <a className="pill pill-imslp" href={imslpUrl(w.imslp)} target="_blank" rel="noreferrer" title="Sheet music and details on IMSLP">
          Score on IMSLP
        </a>
      ) : (
        <span className="pill pill-missing" title="Not on IMSLP, often because it is still in copyright">
          No IMSLP score
        </span>
      )}
      {w.wikipedia && (
        <a className="pill" href={wikipediaUrl(w.wikipedia)} target="_blank" rel="noreferrer">
          Wikipedia
        </a>
      )}
      {w.wikidata && (
        <a className="pill" href={wikidataUrl(w.wikidata)} target="_blank" rel="noreferrer">
          Wikidata
        </a>
      )}
      {w.musicbrainz && (
        <a className="pill" href={musicbrainzUrl(w.musicbrainz)} target="_blank" rel="noreferrer">
          MusicBrainz{w.recordings ? ` · ${fmt.format(w.recordings)} recordings` : ""}
        </a>
      )}
      {w.openopus !== undefined && (
        <span className="pill" title="Listed in Open Opus">
          Open Opus
        </span>
      )}
    </span>
  );
}

function WhyDetails({ w }: { w: Work }) {
  const signalPoints = w.signals.reduce((s, sig) => s + SIGNALS[sig].points, 0);
  const recordingPoints = w.recordings ? Math.min(4, Math.log2(1 + w.recordings) / 2) : 0;
  const other = Math.max(0, w.score - signalPoints - recordingPoints);
  return (
    <details className="why">
      <summary>Sources &amp; ranking</summary>
      <dl>
        <dt>Line-up</dt>
        <dd>
          {w.via.map((s) => SOURCES[s].name).join(", ")}
          {w.arr && " (arrangement)"}
        </dd>
        <dt>Ranking score</dt>
        <dd>
          <ul>
            {w.signals.map((s) => (
              <li key={s}>
                {SIGNALS[s].label} <span className="muted">+{SIGNALS[s].points}</span>
              </li>
            ))}
            {recordingPoints > 0 && (
              <li>
                {fmt.format(w.recordings!)} recordings on MusicBrainz <span className="muted">+{recordingPoints.toFixed(1)}</span>
              </li>
            )}
            {other >= 0.1 && (
              <li>
                Wikidata notability of the work and composer <span className="muted">+{other.toFixed(1)}</span>
              </li>
            )}
            {w.score === 0 && <li className="muted">No signals yet</li>}
          </ul>
          <span className="muted">Total {w.score.toFixed(1)}; {CORE_SCORE}+ counts as core repertoire.</span>
        </dd>
      </dl>
    </details>
  );
}

export function Results({ ensembleKey, shards, total, includeArr }: Props) {
  const { works: all, composers, sources, loading, remaining, error, loadAll } = useEnsembleWorks(ensembleKey, shards);
  const [eraFilter, setEraFilter] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("rank");
  const [show, setShow] = useState<Show>("all");
  const [shown, setShown] = useState(PAGE);

  const works = useMemo(() => (includeArr ? all : all.filter((w) => !w.arr)), [all, includeArr]);

  const eraCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const w of works) c.set(w.era ?? UNKNOWN, (c.get(w.era ?? UNKNOWN) ?? 0) + 1);
    return c;
  }, [works]);

  const composerOptions = useMemo(() => {
    const c = new Map<string, number>();
    for (const w of works) if (w.composer) c.set(w.composer, (c.get(w.composer) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [works]);

  const coreCount = useMemo(() => works.filter((w) => w.score >= CORE_SCORE).length, [works]);
  const imslpCount = useMemo(() => works.filter((w) => w.imslp).length, [works]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = works.filter(
      (w) =>
        (eraFilter.size === 0 || eraFilter.has(w.era ?? UNKNOWN)) &&
        (!composer || w.composer === composer) &&
        (show === "all" || (show === "core" ? w.score >= CORE_SCORE : !!w.imslp)) &&
        (!q || w.title.toLowerCase().includes(q) || (w.composer && composers[w.composer]?.name.toLowerCase().includes(q))),
    );
    const name = (w: Work) => (w.composer ? (composers[w.composer]?.imslp ?? composers[w.composer]?.name ?? w.composer) : "~");
    const byTitle = (a: Work, b: Work) => a.title.localeCompare(b.title, undefined, { numeric: true });
    const byComposer = (a: Work, b: Work) => name(a).localeCompare(name(b)) || byTitle(a, b);
    const when = (w: Work) => w.year ?? (w.composer && composers[w.composer]?.born ? composers[w.composer]!.born! + 35 : Infinity);
    const cmp =
      sort === "rank"
        ? (a: Work, b: Work) => Number(!!a.arr) - Number(!!b.arr) || b.score - a.score || byComposer(a, b)
        : sort === "title"
          ? byTitle
          : sort === "composer"
            ? byComposer
            : (a: Work, b: Work) => when(a) - when(b) || byComposer(a, b);
    return [...list].sort(cmp);
  }, [works, composers, eraFilter, composer, query, sort, show]);

  const toggleEra = (e: string) =>
    setEraFilter((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });

  const eraOptions = [...ERAS, UNKNOWN].filter((e) => eraCounts.has(e));
  const reset = () => setShown(PAGE);

  return (
    <section className="results" aria-label="Works">
      <div className="results-head">
        <h2>
          {fmt.format(filtered.length)} <span className="muted">{filtered.length === 1 ? "work" : "works"} for {describe(parseEnsembleKey(ensembleKey))}</span>
        </h2>
        {loading && <span className="muted small">Loading…</span>}
        {remaining.length > 0 && (
          <span className="small">
            Showing the top {fmt.format(works.length)} of {fmt.format(total)}.{" "}
            <button className="link-button" onClick={loadAll}>
              Load all
            </button>
          </span>
        )}
        {error && <span className="small error-text">{error}</span>}
      </div>
      <LineupSources sources={sources} />

      <div className="filters">
        <div className="era-chips" role="group" aria-label="Show">
          {(
            [
              ["all", "All", works.length],
              ["core", "Core repertoire", coreCount],
              ["imslp", "Score on IMSLP", imslpCount],
            ] as [Show, string, number][]
          ).map(([value, label, n]) => (
            <button key={value} className={`era-chip${show === value ? " active" : ""}`} aria-pressed={show === value} onClick={() => (setShow(value), reset())}>
              {label} <span className="era-count">{fmt.format(n)}</span>
            </button>
          ))}
          <span className="chip-sep" />
          {eraOptions.map((e) => (
            <button key={e} className={`era-chip${eraFilter.has(e) ? " active" : ""}`} aria-pressed={eraFilter.has(e)} onClick={() => (toggleEra(e), reset())}>
              {e} <span className="era-count">{fmt.format(eraCounts.get(e) ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="filter-row">
          <input type="search" placeholder="Search titles and composers…" value={query} onChange={(e) => (setQuery(e.target.value), reset())} />
          <select value={composer} onChange={(e) => (setComposer(e.target.value), reset())} aria-label="Composer">
            <option value="">All composers ({fmt.format(composerOptions.length)})</option>
            {composerOptions.map(([c, n]) => (
              <option key={c} value={c}>
                {composers[c]?.name ?? c} ({n})
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="rank">Most established first</option>
            <option value="chronological">Chronological</option>
            <option value="composer">By composer</option>
            <option value="title">By title</option>
          </select>
        </div>
      </div>

      <ol className="works">
        {filtered.slice(0, shown).map((w) => {
          const c = w.composer ? composers[w.composer] : undefined;
          const href = w.imslp ? imslpUrl(w.imslp) : w.wikipedia ? wikipediaUrl(w.wikipedia) : w.wikidata ? wikidataUrl(w.wikidata) : undefined;
          return (
            <li key={w.id} className="work">
              <div className="work-head">
                {href ? (
                  <a className="work-title" href={href} target="_blank" rel="noreferrer">
                    {w.title}
                  </a>
                ) : (
                  <span className="work-title">{w.title}</span>
                )}
                {w.score >= CORE_SCORE && <span className="badge badge-core">Core repertoire</span>}
                {w.arr && <span className="badge badge-arr">Arrangement</span>}
              </div>
              <div className="work-meta">
                {c && (
                  <button className="composer" onClick={() => (setComposer(w.composer!), reset())} title="Show only this composer">
                    {c.name}
                  </button>
                )}
                {lifespan(c) && <span className="muted">{lifespan(c)}</span>}
                {w.year && <span className="muted">· {w.year}</span>}
                {w.era && <span className="badge">{w.era}</span>}
              </div>
              <div className="work-sources">
                <SourceLinks w={w} />
                <WhyDetails w={w} />
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
