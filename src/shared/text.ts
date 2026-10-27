/** Lowercase, Latin letters folded to ASCII ("Dvořák" → "dvořák" → "dvorak", "ł" → "l"); other scripts as they are. */
function fold(s: string): string {
  return (
    s
      .normalize("NFD")
      // Accents on Latin and Greek letters ("é", "ό"); Cyrillic "й" is a letter of its own
      .replace(/([\p{Script=Latin}\p{Script=Greek}])\p{M}+/gu, "$1")
      .normalize("NFC")
      .toLowerCase()
      .replace(/ß/g, "ss")
      // Letters that NFD doesn't decompose
      .replace(/ł/g, "l")
      .replace(/ø/g, "o")
      .replace(/æ/g, "ae")
      .replace(/œ/g, "oe")
      .replace(/đ/g, "d")
      .replace(/ı/g, "i")
  );
}

/** Lowercase ASCII words, for matching names and titles across sources: folds accents and letters NFD keeps. */
export function normalize(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Lowercase words to search by: as normalize() for Latin text, but letters of every
 * script stay ("Скажи, зачем?" → "скажи зачем"), or such titles couldn't be found at all.
 */
export function searchText(s: string): string {
  return fold(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "Clarinet Quintet, Op.115" → "clarinet-quintet-op-115", for readable URLs (the id is what counts). */
export function slug(s: string): string {
  return normalize(s).split(" ").filter(Boolean).slice(0, 12).join("-");
}
