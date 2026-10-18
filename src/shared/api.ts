// Types shared between the Worker (/api/*) and the client.

export const ERAS = ["Medieval", "Renaissance", "Baroque", "Classical", "Romantic", "Early 20th century", "Modern"] as const;
export type Era = (typeof ERAS)[number];

export interface InstrumentationsResponse {
  fetchedAt: string;
  /** [category name, number of works] */
  categories: [string, number][];
}

export interface Work {
  pageid: number;
  /** Full IMSLP page title, e.g. "Wind Quintet, Op.88 No.3 (Reicha, Anton)" */
  title: string;
  /** Title without the composer suffix */
  work: string;
  composer: string | null;
  /** Era tagged on the work itself; often missing, fall back to the composer's era */
  era: Era | null;
}

export interface WorksResponse {
  works: Work[];
  /** Pass as ?from= to get the next page; null when done */
  next: string | null;
}

export interface ComposersRequest {
  names: string[];
}

export interface ComposersResponse {
  eras: Record<string, Era | null>;
}

export const MAX_COMPOSERS_PER_REQUEST = 250;
