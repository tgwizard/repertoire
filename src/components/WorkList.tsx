import { composerPath, lifespan, workPath } from "../lib/api";
import { formatDuration } from "../shared/paths";
import { describe, parseEnsembleKey } from "../lib/instrumentation";
import { Link } from "../lib/router";
import { CORE_SCORE, type ArrangedBy, type WorkSummary } from "../shared/data";

/** "arr. Jesper Jerkert for flute, oboe, … · Overture"; nothing when there's nothing to say */
export function arrangedText(a: ArrangedBy): string | null {
  if (!a.arranger && !a.excerpt && !a.lineup) return null;
  const who = [`arr. ${a.arranger ?? "unknown"}`, a.lineup && `for ${a.lineup}`].filter(Boolean).join(" ");
  return a.excerpt ? `${who} · ${a.excerpt}` : who;
}

interface Props {
  works: WorkSummary[];
  /** The line-up being listed: works for another (smaller) line-up say which */
  lineup?: string;
  /** Show each work's line-up (lists that mix line-ups: composers, search) */
  showLineup?: boolean;
  /** Offer to filter the list to a work's composer (the name itself goes to their page) */
  onComposer?: (id: string) => void;
  /** The composer the list is filtered to already */
  composer?: string;
  /** Group headings when the number of players changes (smaller groups, by size) */
  groupByPlayers?: number;
}

export function WorkList({ works, lineup, showLineup, onComposer, composer, groupByPlayers }: Props) {
  let lastPlayers = -1;
  return (
    <ol className="works">
      {works.map((w) => {
        const heading = groupByPlayers && w.players !== lastPlayers ? w.players : null;
        lastPlayers = w.players;
        const other = showLineup || (lineup && w.lineup !== lineup);
        const arranged = (w.arrangedBy ?? []).map(arrangedText).filter((t): t is string => !!t);
        return (
          <li key={`${w.id}:${w.lineup}`} className="work">
            {heading !== null && (
              <h3 className="players-heading">
                {heading === groupByPlayers ? `All ${heading} players` : `${heading} of your ${groupByPlayers} players`}
              </h3>
            )}
            <div className="work-head">
              <Link className="work-title" href={workPath(w)}>
                {w.title}
              </Link>
              {w.score >= CORE_SCORE && <span className="badge badge-core">Core repertoire</span>}
              {w.arrangement && <span className="badge badge-arr">Arrangement</span>}
            </div>
            <div className="work-meta">
              {w.composer && (
                <Link className="composer" href={composerPath(w.composer)}>
                  {w.composer.name}
                </Link>
              )}
              {w.composer && onComposer && w.composer.id !== composer && (
                <button className="composer-filter" onClick={() => onComposer(w.composer!.id)} title={`Show only ${w.composer.name}`} aria-label={`Show only ${w.composer.name}`}>
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {lifespan(w.composer) && <span className="muted">{lifespan(w.composer)}</span>}
              {w.year && <span className="muted">· {w.year}</span>}
              {w.era && <span className="badge">{w.era}</span>}
              {(w.duration || w.movements) && (
                <span className="muted">
                  {[w.duration && formatDuration(w.duration), w.movements && w.movements > 1 && `${w.movements} movements`].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <div className="work-sources">
              {other && <span className="lineup-tag">for {describe(parseEnsembleKey(w.lineup))}</span>}
              {w.orchestration && (
                <span
                  className={`orchestration-tag${w.orchestrationStatus === "single" ? " single" : ""}`}
                  title={`Scoring: flutes.oboes.clarinets.bassoons – horns.trumpets.trombones.tuba. ${
                    w.orchestrationStatus === "confirmed" ? "Two sources agree on it." : "From one source: no other confirms it."
                  }`}
                >
                  {w.orchestration}
                </span>
              )}
              {w.scoreUrl ? (
                <a className="pill pill-imslp" href={w.scoreUrl} target="_blank" rel="noreferrer" title="Free sheet music">
                  Score on {w.scoreUrl.includes("mutopiaproject.org") ? "Mutopia" : "IMSLP"}
                </a>
              ) : (
                <span className="pill pill-missing" title="No free score found, often because it is still in copyright">
                  No free score
                </span>
              )}
            </div>
            {arranged.length > 0 && (
              <div className="arranged-line" title="Who arranged it, according to IMSLP">
                {arranged.map((t) => (
                  <span key={t} className="arranged-tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
