import { composerPath, lifespan, workPath } from "../lib/api";
import { describe, parseEnsembleKey } from "../lib/instrumentation";
import { Link } from "../lib/router";
import { CORE_SCORE, type WorkSummary } from "../shared/data";

interface Props {
  works: WorkSummary[];
  /** The line-up being listed: works for another (smaller) line-up say which */
  lineup?: string;
  /** Show each work's line-up (lists that mix line-ups: composers, search) */
  showLineup?: boolean;
  onComposer?: (id: string) => void;
  /** Group headings when the number of players changes (smaller groups, by size) */
  groupByPlayers?: number;
}

export function WorkList({ works, lineup, showLineup, onComposer, groupByPlayers }: Props) {
  let lastPlayers = -1;
  return (
    <ol className="works">
      {works.map((w) => {
        const heading = groupByPlayers && w.players !== lastPlayers ? w.players : null;
        lastPlayers = w.players;
        const other = showLineup || (lineup && w.lineup !== lineup);
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
              {w.composer &&
                (onComposer ? (
                  <button className="composer" onClick={() => onComposer(w.composer!.id)} title="Show only this composer">
                    {w.composer.name}
                  </button>
                ) : (
                  <Link className="composer" href={composerPath(w.composer)}>
                    {w.composer.name}
                  </Link>
                ))}
              {lifespan(w.composer) && <span className="muted">{lifespan(w.composer)}</span>}
              {w.year && <span className="muted">· {w.year}</span>}
              {w.era && <span className="badge">{w.era}</span>}
            </div>
            <div className="work-sources">
              {other && <span className="lineup-tag">for {describe(parseEnsembleKey(w.lineup))}</span>}
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
          </li>
        );
      })}
    </ol>
  );
}
