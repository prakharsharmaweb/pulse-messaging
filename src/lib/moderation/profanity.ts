/**
 * Server-side profanity moderation.
 *
 * Pipeline:
 *   1. tokenise the message and normalise each token (casing, leet, repeats).
 *   2. exact-match each normalised token against the blocklist.
 *   3. build a whole-message collapsed skeleton and scan it for any blocked
 *      term as a substring — this catches spaced-out ("f u c k") and glued
 *      ("gofuckyourself") evasion.
 *
 * Allowlisted terms (e.g. "class", "assignment", "scunthorpe") are protected
 * from the substring pass so we do not over-block.
 */
import { collapseMessage, normalizeToken, tokenize } from "./normalize";

// Core English profanity roots. Kept deliberately small and readable; extend as
// policy requires. Matching is done on the *normalised* form so only the
// skeleton needs to be listed.
const BLOCKLIST = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "piss",
  "cunt",
  "slut",
  "whore",
  "nigger",
  "faggot",
  "retard",
  "motherfucker",
  "cocksucker",
  "wanker",
  "bollocks",
  "twat",
  "prick",
];

// Words that legitimately contain a blocked substring.
const ALLOWLIST = new Set([
  "class",
  "classic",
  "assignment",
  "assess",
  "assassin",
  "assist",
  "assumption",
  "pass",
  "passage",
  "mass",
  "grass",
  "brass",
  "glass",
  "compass",
  "embassy",
  "scunthorpe",
  "dickens",
  "shitake", // rare but harmless
  "cockpit",
  "cocktail",
  "shuttlecock",
  "analysis",
  "analyst",
  "canal",
]);

export type ProfanityResult =
  | { clean: true }
  | { clean: false; matched: string[] };

export function checkProfanity(text: string): ProfanityResult {
  const matched = new Set<string>();

  // Pass 1 — per-token exact match on the normalised skeleton.
  for (const token of tokenize(text)) {
    const norm = normalizeToken(token);
    if (!norm || ALLOWLIST.has(norm)) continue;
    for (const bad of BLOCKLIST) {
      if (norm === bad) matched.add(bad);
    }
  }

  // Pass 2 — whole-message collapsed skeleton, substring scan.
  const collapsed = collapseMessage(text);
  if (collapsed.length <= 200) {
    for (const bad of BLOCKLIST) {
      if (!collapsed.includes(bad)) continue;
      // guard against allowlisted words producing the substring
      const fromAllowed = [...ALLOWLIST].some(
        (w) => w.includes(bad) && collapsed.includes(w)
      );
      if (!fromAllowed) matched.add(bad);
    }
  }

  if (matched.size === 0) return { clean: true };
  return { clean: false, matched: [...matched] };
}
