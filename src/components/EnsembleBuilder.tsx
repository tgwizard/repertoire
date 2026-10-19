import { describe, ensembleKey, FAMILIES, INSTRUMENTS, PALETTE, PRESETS, scoreOrder, type Ensemble } from "../lib/instrumentation";

interface Props {
  /** Works for exactly this line-up */
  count: (e: Ensemble) => number;
  ensemble: Ensemble;
  onChange: (e: Ensemble) => void;
  includeArr: boolean;
  onIncludeArrChange: (v: boolean) => void;
}

const fmt = new Intl.NumberFormat("en");

function withCount(e: Ensemble, id: string, delta: number): Ensemble {
  const next = { ...e, [id]: (e[id] ?? 0) + delta };
  if (next[id]! <= 0) delete next[id];
  return next;
}

export function EnsembleBuilder({ count, ensemble, onChange, includeArr, onIncludeArrChange }: Props) {
  const parts = scoreOrder(ensemble);
  const total = count(ensemble);
  const currentKey = ensembleKey(ensemble);

  // When nothing matches, suggest the ensembles you get by dropping one player.
  const removals =
    parts.length > 1 && total === 0
      ? parts
          .map(([id]) => ({ id, n: count(withCount(ensemble, id, -1)) }))
          .filter((r) => r.n > 0)
          .sort((a, b) => b.n - a.n)
      : [];

  return (
    <section className="builder" aria-label="Choose your ensemble">
      <div className="presets" role="list">
        {PRESETS.map((p) => {
          const active = ensembleKey(p.parts) === currentKey;
          return (
            <button
              key={p.name}
              role="listitem"
              className={`preset${active ? " active" : ""}`}
              onClick={() => onChange(active ? {} : p.parts)}
              aria-pressed={active}
            >
              <span className="preset-name">{p.name}</span>
              <span className="preset-desc">{describe(p.parts)}</span>
              <span className="preset-count">{fmt.format(count(p.parts))} works</span>
            </button>
          );
        })}
      </div>

      <div className="stage">
        <div className="stage-ensemble">
          <h2 className="eyebrow">Your ensemble</h2>
          {parts.length === 0 ? (
            <p className="stage-empty">Pick a preset above, or add players from the instruments below.</p>
          ) : (
            <ul className="chips">
              {parts.map(([id, n]) => {
                const inst = INSTRUMENTS.get(id);
                return (
                  <li key={id} className="chip" data-family={inst?.family ?? "other"}>
                    <span className="chip-label">{inst?.label ?? id}</span>
                    <span className="stepper">
                      <button onClick={() => onChange(withCount(ensemble, id, -1))} aria-label={`Remove one ${inst?.label ?? id}`}>
                        −
                      </button>
                      <span className="stepper-n">{n}</span>
                      <button
                        onClick={() => onChange(withCount(ensemble, id, 1))}
                        disabled={n >= (inst?.max ?? 12)}
                        aria-label={`Add one ${inst?.label ?? id}`}
                      >
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
              <li>
                <button className="link-button" onClick={() => onChange({})}>
                  Clear
                </button>
              </li>
            </ul>
          )}
        </div>

        <div className="stage-total" aria-live="polite">
          <span className="total-n">{parts.length ? fmt.format(total) : "—"}</span>
          <span className="total-label">{total === 1 ? "work" : "works"} for exactly this line-up</span>
          <label className="toggle">
            <input type="checkbox" checked={includeArr} onChange={(e) => onIncludeArrChange(e.target.checked)} />
            <span>Include arrangements</span>
          </label>
        </div>

        {removals.length > 0 && (
          <div className="suggestions">
            Nothing written for exactly this group. Without{" "}
            {removals.slice(0, 4).map((r, i) => (
              <span key={r.id}>
                {i > 0 && ", "}
                <button className="link-button" onClick={() => onChange(withCount(ensemble, r.id, -1))}>
                  one {INSTRUMENTS.get(r.id)?.label ?? r.id}
                </button>{" "}
                ({fmt.format(r.n)})
              </span>
            ))}
            .
          </div>
        )}
      </div>

      <div className="palette">
        {FAMILIES.map((f) => (
          <div key={f.id} className="family" data-family={f.id}>
            <h3 className="family-name">{f.label}</h3>
            <div className="family-instruments">
              {PALETTE.filter((i) => i.family === f.id).map((inst) => {
                const have = ensemble[inst.id] ?? 0;
                const n = count(withCount(ensemble, inst.id, 1));
                const full = have >= inst.max;
                return (
                  <button
                    key={inst.id}
                    className={`instrument${have ? " selected" : ""}${n === 0 ? " empty" : ""}`}
                    onClick={() => onChange(withCount(ensemble, inst.id, 1))}
                    disabled={full}
                    title={full ? undefined : `${fmt.format(n)} works with ${have ? "another" : "a"} ${inst.label}`}
                  >
                    {have > 0 && <span className="instrument-have">{have}×</span>}
                    <span className="instrument-label">{inst.label}</span>
                    {!full && <span className="instrument-count">{n > 0 ? fmt.format(n) : "0"}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
