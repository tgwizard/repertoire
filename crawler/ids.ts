// Persistent ids for works and composers, so links to /work/<id> keep working
// across dataset rebuilds even as sources add, merge or split records.
//
// Each entity has anchors: the source records it was built from ("imslp:509772",
// "wikidata:Q1234"), strongest first. A rebuild reuses the id the previous dataset
// gave any of its anchors. New entities get a hash of their strongest anchor, so a
// rebuild from scratch mostly reproduces the same ids. When two entities merge, the
// losing id redirects to the winner; when one splits, the part holding the stronger
// anchor keeps the id, and between equally strong ones the part most like what the id
// showed before (its title, its year). Every anchor is kept in the dataset (the anchors
// table), also those of ids no longer in it, so that their records can claim them back.

import { createHash } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase
export const ID_LENGTH = 8;
export const ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{8}$/;

export function hashId(s: string): string {
  let n = createHash("sha256").update(s).digest().readBigUInt64BE(0);
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ALPHABET[Number(n & 31n)];
    n >>= 5n;
  }
  return out;
}

export interface PreviousIds {
  /** anchor → id, as of the previous dataset */
  anchors: Map<string, string>;
  /** old id → id it was merged into */
  redirects: Map<string, string>;
}

export const NO_PREVIOUS: PreviousIds = { anchors: new Map(), redirects: new Map() };

export interface Assigned {
  ids: string[];
  /** old id → current id */
  redirects: Map<string, string>;
}

/**
 * Ids for entities given as their anchors ("scheme:ref"), strongest first. `schemes`
 * ranks anchor schemes, strongest first, to settle which entity keeps an id after a
 * split; between equally strong claims, `likeness(entity, id)` (higher is more alike)
 * settles it. `redirectOnly` anchors (a record of part of the entity) redirect the ids
 * they had, but never give one. Deterministic for the same input.
 */
export function assignIds(
  entities: string[][],
  prev: PreviousIds,
  schemes: string[] = [],
  likeness: (entity: number, id: string) => number = () => 0,
  redirectOnly: string[][] = [],
): Assigned {
  const strength = (anchor: string) => {
    const i = schemes.indexOf(anchor.slice(0, anchor.indexOf(":")));
    return i < 0 ? schemes.length : i;
  };
  const follow = (id: string) => {
    for (let hops = 0; prev.redirects.has(id) && hops < 20; hops++) id = prev.redirects.get(id)!;
    return id;
  };

  // Every previous id an entity can claim, ranked by the strength of the anchor.
  const claims: { entity: number; id: string; rank: number; like: number }[] = [];
  entities.forEach((anchors, entity) => {
    const seen = new Set<string>();
    anchors.forEach((anchor) => {
      const old = prev.anchors.get(anchor);
      if (!old) return;
      const id = follow(old);
      if (seen.has(id)) return;
      seen.add(id);
      claims.push({ entity, id, rank: strength(anchor), like: likeness(entity, id) });
    });
  });
  claims.sort((a, b) => a.rank - b.rank || b.like - a.like || a.entity - b.entity);

  const ids: (string | undefined)[] = new Array(entities.length);
  const taken = new Set<string>();
  for (const c of claims) {
    if (ids[c.entity] !== undefined || taken.has(c.id)) continue;
    ids[c.entity] = c.id;
    taken.add(c.id);
  }

  // Never hand out an id that meant something else before.
  const reserved = new Set([...prev.anchors.values(), ...prev.redirects.keys(), ...taken]);
  entities.forEach((anchors, entity) => {
    if (ids[entity] !== undefined) return;
    if (!anchors.length) throw new Error(`Entity ${entity} has no anchors`);
    let id = hashId(anchors[0]!);
    for (let salt = 1; reserved.has(id); salt++) id = hashId(`${anchors[0]}#${salt}`);
    ids[entity] = id;
    reserved.add(id);
  });

  const redirects = new Map<string, string>();
  for (const c of claims) {
    if (ids[c.entity] !== c.id && !taken.has(c.id)) redirects.set(c.id, ids[c.entity]!);
  }
  redirectOnly.forEach((anchors, entity) => {
    for (const a of anchors) {
      const old = prev.anchors.get(a);
      const id = old && follow(old);
      if (id && !taken.has(id) && !redirects.has(id)) redirects.set(id, ids[entity]!);
    }
  });
  // Keep earlier redirects working, pointing straight at the current id.
  for (const old of prev.redirects.keys()) {
    const target = follow(old);
    const now = taken.has(target) ? target : redirects.get(target);
    if (now && now !== old && !taken.has(old)) redirects.set(old, now);
  }
  return { ids: ids as string[], redirects };
}
