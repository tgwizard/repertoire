// IMSLP work pages: the fields the categories don't carry (instrumentation as written,
// movements, duration), the names of the original edition's parts, which spell out
// an orchestra's scoring, and who arranged what for whom. Raw text only: parsing happens in the build, so a better
// parser doesn't need a recrawl.

import { fetchJson, jitteredMaxAge, progress, readStage, writeStage } from "../http.ts";
import type { StageReport } from "../stages.ts";
import type { ImslpStage } from "./imslp.ts";

const API = "https://imslp.org/api.php";
const BATCH = 50; // the most pages MediaWiki returns content for, for clients without bot rights
/** Bumped when pages hold more than before; older pages are fetched again (see `stale`) */
const VERSION = 2;

export interface ImslpPage {
  /** When fetched */
  at: number;
  rev: number;
  instrumentation?: string;
  movements?: string;
  duration?: string;
  /** Part descriptions ("Flute 1, 2", "Horn 3 (F)") of each original edition that has parts */
  parts?: string[][];
  /** The file blocks under "Arrangements and Transcriptions" */
  arrangements?: ImslpArrangementBlock[];
  /** What the page holds (VERSION); 2 added arrangements */
  v?: number;
}

export interface ImslpArrangementBlock {
  /** Headings above it within the section: ["Overture", "*For Flute, Oboe, … and Horn (Jerkert)"] */
  headings: string[];
  /** As written: "{{LinkArr|Jesper|Jerkert||}}", "Charles Di Caro", "Unknown" */
  arranger?: string;
  /** "fl ob cl bn hn (arr)" */
  tags?: string;
  copyright?: string;
}

export interface ImslpPagesStage {
  pages: Record<number, ImslpPage>;
}

const FIELDS = { instrumentation: "Instrumentation", movements: "Number of Movements/Sections", duration: "Average Duration" } as const;

/** A field of the page's template: everything up to the next "|Field=" line or the template's end. */
function field(text: string, name: string): string | undefined {
  const m = new RegExp(`^\\|${name.replace(/[./]/g, "\\$&")}=(.*(?:\\n(?![|}]).*)*)`, "m").exec(text);
  const value = m?.[1]?.trim();
  return value ? value.slice(0, 1000) : undefined;
}

/**
 * Part lists from the page's original editions: file blocks under a "Parts" (or "Scores
 * and Parts") heading, but not under "Arrangements and Transcriptions".
 */
export function originalParts(text: string): string[][] {
  const out: string[][] = [];
  const headings: string[] = []; // headings[level] = title
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (h) {
      headings.length = h[1]!.length;
      headings[h[1]!.length - 1] = h[2]!;
      continue;
    }
    if (line.startsWith("{{#fte:imslpfile")) {
      const path = headings.filter(Boolean);
      const inParts = path.some((t) => /\bParts\b/i.test(t));
      const arranged = path.some((t) => /Arrangements|Transcriptions/i.test(t));
      current = inParts && !arranged ? [] : null;
      if (current) out.push(current);
      continue;
    }
    const d = current && /^\|File Description \d+=(.*)$/.exec(line);
    if (d && d[1]!.trim()) current!.push(d[1]!.trim());
  }
  return out.filter((p) => p.length);
}

/** Arrangement file blocks, each with the headings above it below the section's own. */
export function arrangementBlocks(text: string): ImslpArrangementBlock[] {
  const out: ImslpArrangementBlock[] = [];
  const headings: string[] = [];
  let section = 0; // the arrangements heading's level, while inside it
  let block: string[] | null = null;
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (block) {
      if (line.startsWith("}}")) {
        const fields = block.join("\n");
        const get = (name: string) => field(fields, name)?.slice(0, 300);
        // Some pages name the arranger as the editor ({{LinkArr}} says which it is)
        const editor = get("Editor");
        const b: ImslpArrangementBlock = { headings: headings.slice(section).filter(Boolean) };
        const arranger = get("Arranger") ?? (editor && /LinkArr/.test(editor) ? editor : undefined);
        if (arranger) b.arranger = arranger;
        const tags = get("File Tags");
        if (tags) b.tags = tags;
        const copyright = get("Copyright");
        if (copyright) b.copyright = copyright;
        const key = JSON.stringify(b);
        if (!seen.has(key)) seen.add(key), out.push(b);
        block = null;
      } else block.push(line);
      continue;
    }
    const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      if (section && level <= section) section = 0;
      headings.length = level;
      headings[level - 1] = h[2]!;
      if (/^Arrangements|^Transcriptions/i.test(h[2]!)) section = level;
      continue;
    }
    if (section && line.startsWith("{{#fte:imslpfile")) block = [];
  }
  return out;
}

export function extractPage(text: string, rev: number, at: number): ImslpPage {
  const page: ImslpPage = { at, rev, v: VERSION };
  for (const [key, name] of Object.entries(FIELDS)) {
    const v = field(text, name);
    if (v) page[key as keyof typeof FIELDS] = v;
  }
  const parts = originalParts(text);
  if (parts.length) page.parts = parts;
  const arrangements = arrangementBlocks(text);
  if (arrangements.length) page.arrangements = arrangements;
  return page;
}

/**
 * Pages are re-read after 60–120 days (staggered per page), and sooner when they were
 * read before the stage kept something they have (arrangements: pages in an "(arr)" category).
 */
export async function crawlImslpPages(): Promise<StageReport> {
  const imslp = await readStage<ImslpStage>("imslp");
  if (!imslp) throw new Error("run the imslp stage first");
  const stage = (await readStage<ImslpPagesStage>("imslp-pages")) ?? { pages: {} };
  const ids = Object.keys(imslp.works).map(Number);
  const arranged = new Set(Object.entries(imslp.members).flatMap(([c, ids]) => (c.endsWith(" (arr)") ? ids : [])));
  const stale = (id: number, p: ImslpPage) => (p.v ?? 1) < 2 && arranged.has(id);
  const todo = ids.filter((id) => {
    const p = stage.pages[id];
    return !p || stale(id, p) || Date.now() - p.at > jitteredMaxAge(String(id), 60, 120);
  });
  // Pages no longer in any instrumentation category
  const live = new Set(ids);
  for (const id of Object.keys(stage.pages).map(Number)) if (!live.has(id)) delete stage.pages[id];

  console.log(`IMSLP: work pages, ${todo.length} of ${ids.length} to fetch`);
  const tick = progress("IMSLP page batches", Math.ceil(todo.length / BATCH));
  let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      const url = new URL(API);
      url.search = new URLSearchParams({ action: "query", prop: "revisions", rvprop: "content|ids", pageids: batch.join("|"), format: "json" }).toString();
      const data: any = await fetchJson(url.toString());
      if (data.error) throw new Error(`IMSLP error: ${data.error.info ?? data.error.code}`);
      const now = Date.now();
      for (const p of Object.values<any>(data.query?.pages ?? {})) {
        const r = p.revisions?.[0];
        if (r?.["*"] !== undefined) stage.pages[p.pageid] = extractPage(r["*"], r.revid, now);
      }
    } catch (e) {
      failed++;
      console.warn(`  ✗ page batch: ${(e as Error).message}`);
    }
    const n = i / BATCH;
    if (n % 200 === 199) await writeStage("imslp-pages", stage); // checkpoint
    tick(n + 1, failed ? `${failed} failed` : "");
  }
  await writeStage("imslp-pages", stage);
  const n = Object.values(stage.pages);
  console.log(
    `  ${n.length} pages: ${n.filter((p) => p.parts).length} with parts, ${n.filter((p) => p.duration).length} with a duration, ` +
      `${n.filter((p) => p.movements).length} with movements, ${n.filter((p) => p.arrangements).length} with arrangements`,
  );
  return { failed, of: Math.ceil(todo.length / BATCH) };
}

/**
 * Seconds from IMSLP's Average Duration ("45 minutes", "11-15 minutes", "1 hour 10
 * minutes", "ca. 20'", "12:30"); a range counts as its middle.
 */
export function parseDuration(text: string): number | null {
  const t = text.toLowerCase().replace(/\{\{[^}]*\}\}|<[^>]*>|\[\[[^\]]*\]\]/g, " ").replace(/,(\d)/g, ".$1");
  let m = /^\D*?(\d+):(\d\d)(?::(\d\d))?\b/.exec(t);
  if (m) return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  const hours = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/.exec(t);
  m = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(?:minutes?|mins?\.?|m\b|')/.exec(t);
  const minutes = m ? (Number(m[1]) + Number(m[2] ?? m[1])) / 2 : 0;
  const seconds = /(\d+)\s*(?:seconds?|secs?|s\b|")/.exec(t.slice(m ? m.index + m[0].length : 0));
  const total = (hours ? Number(hours[1]) * 3600 : 0) + minutes * 60 + (seconds ? Number(seconds[1]) : 0);
  // Under 10 seconds is a typo; over 6 hours one too, or a whole cycle of operas
  return total >= 10 && total <= 6 * 3600 ? Math.round(total) : null;
}

/** "4 movements:" → 4; acts, scenes and the like aren't movements → null */
export function parseMovements(text: string): number | null {
  const t = text.replace(/\{\{[^}]*\}\}|'''?|<[^>]*>/g, "");
  const first = t.split("\n")[0]!.trim();
  if (/^\d+\s+(acts?|scenes?|tableaux?|operas?|symphonies|concertos|suites|books?|volumes?|sets?)\b/i.test(first)) return null;
  const counted =
    /^(\d+)\s+(movements?|sections?|pieces?|parts?|numbers?|songs?|variations?|dances?|waltzes|marches|preludes?|études?|etudes?|studies|nocturnes?|items?)\b/i.exec(first) ??
    /^(\d+)\s*(?:[:(]|$)/.exec(first) ?? // "4:", "6 (No.6 incomplete)", a bare "8"
    /^(1)\s+[a-z]+/i.exec(first); // "1 overture", "1 polka"
  if (counted) return Number(counted[1]) <= 200 ? Number(counted[1]) : null;
  // A list of them: "#Allegro", "1. Allegro"
  const listed = t.split("\n").filter((l) => /^\s*(#|\d+\.\s)/.test(l)).length;
  return listed >= 2 ? listed : null;
}
