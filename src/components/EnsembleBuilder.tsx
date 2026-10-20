import { useEffect, useRef, useState } from "react";
import { adjust, describe, ensembleKey, FAMILIES, INSTRUMENTS, PALETTE, PRESETS, scoreOrder, type Ensemble } from "../lib/instrumentation";

interface Props {
  /** Works for exactly this line-up */
  count: (e: Ensemble) => number;
  ensemble: Ensemble;
  onChange: (e: Ensemble) => void;
  includeArr: boolean;
  onIncludeArrChange: (v: boolean) => void;
}

const fmt = new Intl.NumberFormat("en");

export function EnsembleBuilder({ count, ensemble, onChange, includeArr, onIncludeArrChange }: Props) {
  const parts = scoreOrder(ensemble);
  const currentKey = ensembleKey(ensemble);
  // Only matters on narrow screens, where the picker collapses so results come first.
  const [pickerOpen, setPickerOpen] = useState(parts.length === 0);
  const cardRef = useRef<HTMLElement>(null);

  // An empty ensemble has nothing to show but the picker (Clear, removing the last
  // player, or deselecting a preset).
  useEffect(() => {
    if (parts.length === 0) setPickerOpen(true);
  }, [parts.length]);
  const total = count(ensemble);

  const closePicker = () => {
    setPickerOpen(false);
    // The picker can be long; land back at the ensemble, with the results right below.
    requestAnimationFrame(() => {
      const card = cardRef.current;
      if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: "start" });
    });
  };

  return (
    <div className="builder">
      <section className={`ensemble-card${pickerOpen ? " picking" : ""}`} aria-label="Your ensemble" ref={cardRef}>
        <div className="ensemble-card-head">
          <h2 className="eyebrow">Your ensemble</h2>
          {parts.length > 0 && (
            <button className="link-button small" onClick={() => onChange({})}>
              Clear
            </button>
          )}
        </div>
        {parts.length === 0 ? (
          <p className="stage-empty">Pick a preset, or add the players you have.</p>
        ) : (
          <ul className="chips">
            {parts.map(([id, n]) => {
              const inst = INSTRUMENTS.get(id);
              return (
                <li key={id} className="chip" data-family={inst?.family ?? "other"}>
                  <span className="chip-label">{inst?.label ?? id}</span>
                  <span className="stepper">
                    <button onClick={() => onChange(adjust(ensemble, id, -1))} aria-label={`Remove one ${inst?.label ?? id}`}>
                      −
                    </button>
                    <span className="stepper-n">{n}</span>
                    <button
                      onClick={() => onChange(adjust(ensemble, id, 1))}
                      disabled={n >= (inst?.max ?? 12)}
                      aria-label={`Add one ${inst?.label ?? id}`}
                    >
                      +
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="ensemble-card-foot">
          <label className="toggle">
            <input type="checkbox" checked={includeArr} onChange={(e) => onIncludeArrChange(e.target.checked)} />
            <span>Include arrangements</span>
          </label>
          {parts.length > 0 && (
            <button className="picker-toggle" onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))} aria-expanded={pickerOpen}>
              {!pickerOpen ? "Change line-up" : total > 0 ? `Show ${fmt.format(total)} ${total === 1 ? "work" : "works"}` : "Done"}
            </button>
          )}
        </div>
      </section>

      <div className={`picker${pickerOpen ? "" : " collapsed"}`}>
        <h3 className="eyebrow">Presets</h3>
        <div className="presets">
          {PRESETS.map((p) => {
            const active = ensembleKey(p.parts) === currentKey;
            return (
              <button
                key={p.name}
                className={`preset${active ? " active" : ""}`}
                title={describe(p.parts)}
                aria-pressed={active}
                onClick={() => {
                  onChange(active ? {} : p.parts);
                  if (!active) closePicker();
                }}
              >
                {p.name} <span className="preset-count">{fmt.format(count(p.parts))}</span>
              </button>
            );
          })}
        </div>

        <h3 className="eyebrow">Add players</h3>
        <div className="palette">
          {FAMILIES.map((f) => (
            <div key={f.id} className="family" data-family={f.id}>
              <h4 className="family-name">{f.label}</h4>
              <div className="family-instruments">
                {PALETTE.filter((i) => i.family === f.id).map((inst) => {
                  const have = ensemble[inst.id] ?? 0;
                  const n = count(adjust(ensemble, inst.id, 1));
                  const full = have >= inst.max;
                  return (
                    <button
                      key={inst.id}
                      className={`instrument${have ? " selected" : ""}${n === 0 ? " empty" : ""}`}
                      onClick={() => onChange(adjust(ensemble, inst.id, 1))}
                      disabled={full}
                      title={full ? undefined : `${fmt.format(n)} works with ${have ? "another" : "a"} ${inst.label}`}
                    >
                      {have > 0 && <span className="instrument-have">{have}×</span>}
                      <span className="instrument-label">{inst.label}</span>
                      {!full && <span className="instrument-count">{fmt.format(n)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
