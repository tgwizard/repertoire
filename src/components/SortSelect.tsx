import type { SortOrder, WorkSort } from "../shared/data";

export interface Sorting {
  sort: WorkSort;
  /** Only when it isn't the sort's natural direction */
  order?: SortOrder;
}

const OPTIONS: [WorkSort, SortOrder | undefined, string][] = [
  ["players", undefined, "Largest groups first"],
  ["players", "asc", "Smallest groups first"],
  ["rank", undefined, "Most established first"],
  ["chronological", undefined, "Oldest first"],
  ["chronological", "desc", "Newest first"],
  ["duration", undefined, "Shortest first"],
  ["duration", "desc", "Longest first"],
  ["composer", undefined, "Composer A–Z"],
  ["composer", "desc", "Composer Z–A"],
  ["title", undefined, "Title A–Z"],
  ["title", "desc", "Title Z–A"],
];

const value = (s: WorkSort, o?: SortOrder) => (o ? `${s}:${o}` : s);

/** A sort select offering the given sorts, each in both directions where that reads naturally. */
export function SortSelect({ sorting, onChange, sorts, id }: { sorting: Sorting; onChange: (s: Sorting) => void; sorts: WorkSort[]; id?: string }) {
  return (
    <select
      id={id}
      value={value(sorting.sort, sorting.order)}
      onChange={(e) => {
        const [sort, order] = e.target.value.split(":") as [WorkSort, SortOrder | undefined];
        onChange({ sort, order });
      }}
      aria-label="Sort"
    >
      {OPTIONS.filter(([s]) => sorts.includes(s)).map(([s, o, label]) => (
        <option key={value(s, o)} value={value(s, o)}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** Adds a sorting to API query parameters, leaving out the defaults. */
export function setSortParams(p: URLSearchParams, { sort, order }: Sorting) {
  if (sort !== "rank") p.set("sort", sort);
  if (order) p.set("order", order);
}
