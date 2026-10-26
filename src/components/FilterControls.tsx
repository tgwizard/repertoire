import { useRef, type ReactNode } from "react";
import { lengthKey, type Filters, type Show } from "../lib/filters";
import { ERAS, LENGTHS, type Facets, type WorkSort } from "../shared/data";
import { SortSelect } from "./SortSelect";

const fmt = new Intl.NumberFormat("en");
const UNKNOWN = "Unknown";

interface Props {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  /** Counts for each option */
  facets: Facets | null;
  /** The sorts on offer, the list's default first */
  sorts: WorkSort[];
  /** More selects, before Composer */
  before?: ReactNode;
}

/** Show and Era chips; Composer, Length and Sort: the filters every list of works has. */
export function FilterControls({ filters, set, facets: f, sorts, before }: Props) {
  const { eras, composer, show, length } = filters;
  const toggleEra = (e: string) => set({ eras: eras.includes(e) ? eras.filter((x) => x !== e) : [...eras, e].sort() });
  // Every era the list has stays (so the chips don't move); those the other filters leave
  // empty are dimmed
  const eraOptions = [...ERAS, UNKNOWN].filter((e) => f && e in f.eras);
  // The picked composer stays in the list even when the other filters leave them none
  const composerNames = useRef(new Map<string, string>());
  for (const c of f?.composers ?? []) composerNames.current.set(c.id, c.name);
  const composerOptions = [...(f?.composers ?? [])];
  if (composer && !composerOptions.some((c) => c.id === composer))
    composerOptions.unshift({ id: composer, name: composerNames.current.get(composer) ?? "This composer", count: 0 });

  return (
    <div className="filters">
      <div className="filter-chips">
        <div className="filter-group" role="group" aria-labelledby="show-label">
          <span className="filter-label" id="show-label">
            Show
          </span>
          <div className="era-chips">
            {(
              [
                ["all", "All", null],
                ["core", "Core repertoire", f?.core],
                ["free", "Free sheet music", f?.free],
              ] as [Show, string, number | null | undefined][]
            ).map(([value, label, n]) => (
              <button key={value} className={`era-chip${show === value ? " active" : ""}`} aria-pressed={show === value} onClick={() => set({ show: value })}>
                {label} {n !== null && n !== undefined && <span className="era-count">{fmt.format(n)}</span>}
              </button>
            ))}
          </div>
        </div>
        {eraOptions.length > 0 && (
          <div className="filter-group" role="group" aria-labelledby="era-label">
            <span className="filter-label" id="era-label">
              Era
            </span>
            <div className="era-chips">
              {eraOptions.map((e) => (
                <button
                  key={e}
                  className={`era-chip${eras.includes(e) ? " active" : ""}${f?.eras[e as keyof typeof f.eras] ? "" : " empty"}`}
                  aria-pressed={eras.includes(e)}
                  onClick={() => toggleEra(e)}
                >
                  {e} <span className="era-count">{fmt.format(f?.eras[e as keyof typeof f.eras] ?? 0)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="filter-row">
        {before}
        <div className="filter-group">
          <label className="filter-label" htmlFor="filter-composer">
            Composer
          </label>
          <select id="filter-composer" value={composer} onChange={(e) => set({ composer: e.target.value })}>
            <option value="">All composers{f ? ` (${fmt.format(f.composers.length)}${f.composers.length === 300 ? "+" : ""})` : ""}</option>
            {composerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="filter-length">
            Length
          </label>
          <select id="filter-length" value={length} onChange={(e) => set({ length: e.target.value })}>
            <option value="">Any length</option>
            {LENGTHS.map((l, i) => (
              <option key={l.label} value={lengthKey(l)}>
                {l.label}
                {f ? ` (${fmt.format(f.lengths.known[i] ?? 0)})` : ""}
              </option>
            ))}
            <option value="unknown">Length unknown{f ? ` (${fmt.format(f.lengths.unknown)})` : ""}</option>
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="filter-sort">
            Sort
          </label>
          <SortSelect id="filter-sort" sorting={{ sort: filters.sort ?? sorts[0]!, order: filters.order }} onChange={(s) => set({ sort: s.sort, order: s.order })} sorts={sorts} />
        </div>
      </div>
    </div>
  );
}
