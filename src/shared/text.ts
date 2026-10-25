/** Lowercase ASCII words: folds accents and letters NFD keeps ("Dvořák" → "dvorak", "ł" → "l"). */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    // Letters that NFD doesn't decompose
    .replace(/ł/g, "l")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/đ/g, "d")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Clarinet Quintet, Op.115" → "clarinet-quintet-op-115", for readable URLs (the id is what counts). */
export function slug(s: string): string {
  return normalize(s).split(" ").filter(Boolean).slice(0, 12).join("-");
}
