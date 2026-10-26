// The filters and sort on a list of works, as they appear in the page's URL, so links,
// reloads and going back show the same list:
//   era=Romantic&era=Classical  composer=<id>  show=core|free  sort=…&order=asc|desc
//   len=0-10|10-20|20-40|40-|unknown  min=<players>  group=<line-up>
// Defaults are left out.

import { ERAS, LENGTHS, type SortOrder, type WorkSort } from "../shared/data.ts";

export type Show = "all" | "core" | "free";

export interface Filters {
  /** Eras, and "Unknown" */
  eras: string[];
  composer: string;
  show: Show;
  /** Unset: the list's own default (best match searching everything, largest groups
   * first with smaller groups, else most established first) */
  sort?: WorkSort;
  /** Only when it isn't the sort's natural direction */
  order?: SortOrder;
  /** "", a LENGTHS key ("10-20"), or "unknown" */
  length: string;
  /** With smaller groups: the smallest to list, and one group to list alone */
  minPlayers: number;
  within: string;
}

export const defaultFilters = (): Filters => ({
  eras: [],
  composer: "",
  show: "all",
  length: "",
  minPlayers: 2,
  within: "",
});

export const lengthKey = (l: { min: number; max: number }) => `${l.min}-${l.max || ""}`;

const SORTS: WorkSort[] = ["relevance", "rank", "players", "chronological", "composer", "title", "duration"];

export function readFilters(p: URLSearchParams): Filters {
  const d = defaultFilters();
  const sort = p.get("sort") as WorkSort | null;
  const order = p.get("order");
  const len = p.get("len") ?? "";
  const min = Number(p.get("min"));
  return {
    eras: p.getAll("era").filter((e) => e === "Unknown" || (ERAS as readonly string[]).includes(e)),
    composer: p.get("composer") ?? "",
    show: (["core", "free"] as const).find((s) => s === p.get("show")) ?? "all",
    ...(sort && SORTS.includes(sort) ? { sort } : {}),
    ...(order === "asc" || order === "desc" ? { order } : {}),
    length: len === "unknown" || LENGTHS.some((l) => lengthKey(l) === len) ? len : "",
    minPlayers: Number.isInteger(min) && min >= 1 ? min : d.minPlayers,
    within: p.get("group") ?? "",
  };
}

export function writeFilters(p: URLSearchParams, f: Filters, smaller: boolean): void {
  const d = defaultFilters();
  for (const e of f.eras) p.append("era", e);
  if (f.composer) p.set("composer", f.composer);
  if (f.show !== "all") p.set("show", f.show);
  if (f.sort) p.set("sort", f.sort);
  if (f.order) p.set("order", f.order);
  if (f.length) p.set("len", f.length);
  if (smaller && f.minPlayers !== d.minPlayers) p.set("min", String(f.minPlayers));
  if (smaller && f.within) p.set("group", f.within);
}

/** The filters as /api/works parameters (sorting aside: the list knows its default). */
export function setFilterParams(p: URLSearchParams, f: Filters): void {
  if (f.composer) p.set("composer", f.composer);
  for (const e of [...f.eras].sort()) p.append("era", e);
  if (f.show !== "all") p.set("show", f.show);
  if (f.length === "unknown") p.set("duration", "unknown");
  else if (f.length) {
    const l = LENGTHS.find((l) => lengthKey(l) === f.length);
    if (l?.min) p.set("min_duration", String(l.min));
    if (l?.max) p.set("max_duration", String(l.max));
  }
}
