import { adjust, describe, INSTRUMENTS, scoreOrder, type Ensemble } from "../lib/instrumentation";
import type { MetaFile } from "../shared/data";

const fmt = new Intl.NumberFormat("en");

export function Intro({ meta }: { meta: MetaFile | null }) {
  return (
    <div className="empty-state">
      <h2>Who's playing?</h2>
      <p>
        Pick a preset or add the players you have, and you'll get the works written for exactly that line-up, most established
        first, with sheet music from IMSLP where it exists.
      </p>
      {meta && (
        <p className="muted small">
          {fmt.format(meta.works)} works across {fmt.format(meta.ensembles)} line-ups, combined from five open sources (see below).
        </p>
      )}
    </div>
  );
}

interface NoMatchesProps {
  ensemble: Ensemble;
  count: (e: Ensemble) => number;
  arrangements: number;
  onChange: (e: Ensemble) => void;
  onIncludeArr: () => void;
}

export function NoMatches({ ensemble, count, arrangements, onChange, onIncludeArr }: NoMatchesProps) {
  // Suggest the line-ups you get by dropping one player.
  const removals = scoreOrder(ensemble)
    .map(([id]) => ({ id, n: count(adjust(ensemble, id, -1)) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  return (
    <div className="empty-state">
      <h2>Nothing for exactly this line-up</h2>
      <p className="muted">{describe(ensemble)}</p>
      {arrangements > 0 && (
        <p>
          There {arrangements === 1 ? "is 1 arrangement" : `are ${fmt.format(arrangements)} arrangements`} for it.{" "}
          <button className="link-button" onClick={onIncludeArr}>
            Include arrangements
          </button>
        </p>
      )}
      {removals.length > 0 && (
        <>
          <p>With one player fewer:</p>
          <ul className="suggestion-list">
            {removals.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button className="link-button" onClick={() => onChange(adjust(ensemble, r.id, -1))}>
                  without {INSTRUMENTS.get(r.id)?.label ?? r.id}
                </button>{" "}
                <span className="muted">{fmt.format(r.n)} works</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
