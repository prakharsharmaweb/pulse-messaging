/**
 * Text normalisation for profanity matching.
 *
 * Defeats the common, "straightforward" evasion techniques called out in the
 * brief: casing, padding whitespace/punctuation between letters, repeated
 * letters, and leetspeak / homoglyph character substitution.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  "$": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "+": "t",
  "(": "c",
};

const HOMOGLYPHS: Record<string, string> = {
  "а": "a", // Cyrillic а
  "е": "e", // е
  "о": "o", // о
  "р": "p", // р
  "с": "c", // с
  "х": "x", // х
  "у": "y", // у
  "і": "i", // і
  "ѕ": "s", // ѕ
};

function subst(ch: string): string {
  return HOMOGLYPHS[ch] ?? LEET_MAP[ch] ?? ch;
}

/** Collapse a token to its bare alphabetic skeleton. */
export function normalizeToken(raw: string): string {
  let s = raw.toLowerCase().normalize("NFKD").replace(COMBINING_MARKS, "");
  s = s.split("").map(subst).join("");
  s = s.replace(/[^a-z]/g, "");
  // collapse 3+ repeats to a single char ("fuuuuck" -> "fuck")
  s = s.replace(/(.)\1{2,}/g, "$1");
  return s;
}

/**
 * Fully collapsed, letters-only representation of the whole message so that
 * spaced-out profanity ("f u c k", "s-h-i-t") is still caught.
 */
export function collapseMessage(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .split("")
    .map(subst)
    .join("")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1{2,}/g, "$1");
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
