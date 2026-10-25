// Mutopia: free, newly engraved editions of public-domain music. One catalogue
// file lists every piece; we link the pieces to the works they belong to.

import { cached, DAY, fetchText, writeStage } from "../http.ts";

const CATALOGUE = "https://www.mutopiaproject.org/datafiles/musiccache.dat";

export interface MutopiaPiece {
  id: number;
  title: string;
  /** "F. Abt" */
  composer: string;
  born: number | null;
  died: number | null;
  opus: string;
  /** Free text: "Horn Duet", "Voice and Piano" */
  instrument: string;
  license: string;
}

export interface MutopiaStage {
  fetchedAt: number;
  pieces: MutopiaPiece[];
}

export const mutopiaUrl = (id: number | string) => `https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=${id}`;

/**
 * The catalogue: an index record, then one record per piece separated by lines of
 * asterisks, a field per line: 0 id, 1 directory, 2–9 file names, 12 title,
 * 13 composer "F. Abt (1819–1885)", 14 opus, 16 instrument, 22 license.
 */
export function parseCatalogue(text: string): MutopiaPiece[] {
  const pieces: MutopiaPiece[] = [];
  for (const record of text.split(/^\*{10}\r?\n/m).slice(1)) {
    const f = record.split(/\r?\n/);
    const id = Number(f[0]);
    if (!Number.isInteger(id) || id <= 0 || !f[12]?.trim()) continue;
    const m = /^(.*?)\s*\((?:c\.\s*)?(\d{4})?\s*[–-]\s*(?:c\.\s*)?(\d{4})?\)\s*$/.exec(f[13] ?? "");
    pieces.push({
      id,
      title: f[12]!.trim(),
      composer: (m ? m[1]! : (f[13] ?? "")).trim(),
      born: m?.[2] ? Number(m[2]) : null,
      died: m?.[3] ? Number(m[3]) : null,
      opus: (f[14] ?? "").trim(),
      instrument: (f[16] ?? "").trim(),
      license: (f[22] ?? "").trim(),
    });
  }
  return pieces;
}

export async function crawlMutopia(): Promise<void> {
  console.log("Mutopia: catalogue");
  const res = await cached("mutopia:catalogue:v1", 7 * DAY, () => fetchText(CATALOGUE));
  const pieces = parseCatalogue(res.value);
  if (pieces.length < 1000) throw new Error(`Mutopia: only ${pieces.length} pieces parsed; the format may have changed`);
  console.log(`  ${pieces.length} pieces`);
  await writeStage("mutopia", { fetchedAt: res.fetchedAt, pieces } satisfies MutopiaStage);
}
