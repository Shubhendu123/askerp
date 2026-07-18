// D-038 B4: presentation formatting — human-readable durations and
// acronym-aware title casing, as reusable passes rather than hand-fixed
// strings at each call site.

const ACRONYMS = new Set(["PO", "DPO", "DSO", "DIO", "CCC", "OTIF", "GL", "AR"]);
const LOWERCASE_WORDS = new Set(["by", "of", "vs", "to", "a", "an", "the", "and", "or", "in", "on", "at", "for"]);

/** snake_case (or already-spaced) identifier -> Title Case with acronyms
 * (PO, DPO, DSO, DIO, CCC, OTIF, GL, AR) kept uppercase and minor connector
 * words lowercased when not leading. */
export function formatTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (i > 0 && LOWERCASE_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** milliseconds -> human-readable duration: "580ms", "1.4s", "28s", "1m 5s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}
