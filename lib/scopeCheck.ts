// D-049: narration scope check, run in the live pipeline (harborline only). Same rules as benchmark/score_harborline.py
// (fidelity_scope), with one fix: a bare year-like token ("2026") is NOT a stated time window.
//   1. window: the narration states a time window ("trailing 12 months", "last quarter", "March 2026") but the executed SQL has no date logic
//   2. scope: SLA/client-tier or counterparty-tier language when the SQL is not per client / per counterparty
// Pipeline (route.ts): narrate -> check -> if it fails, narrate again WITHOUT policy chunks -> check -> if it still fails, drop the flagged sentences.

export const SCOPE_CHECK_TENANTS = new Set(["harborline"]);

// NOTE: no bare /20\d\d/ alternative - "Q1 2026" and "March 2026" are windows, a lone "2026" is not.
const WINDOW = /\b(trailing|rolling|last\s+(?:\d+\s+)?(?:month|quarter|year|week)s?|past\s+(?:\d+\s+)?(?:month|quarter|year|week)s?|(?:previous|prior)\s+(?:\d+\s+)?(?:month|quarter|year)s?|year[- ]to[- ]date|ytd|this\s+(?:month|quarter|year)|over\s+the\s+(?:last|past)|recent(?:ly)?|\d+[- ]months?|\d+[- ]days?\s+(?:window|period)|Q[1-4]\s*20\d\d|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d\d)\b/gi;
const SQL_DATE = /date_key|full_date|year_num|month_num|quarter_num|current_date|now\(\)|interval|date_trunc|date\s+'/i;
const NEUTRAL = /sla[- ]credits?|mid-tier|service[- ]level (?:breach|agreement)s?/gi;

export interface ScopeResult {
  windowClaims: string[];
  windowBad: boolean;
  scopeViol: string[];
  ok: boolean;
}

export function checkScope(text: string, sql: string): ScopeResult {
  const windowClaims = Array.from(new Set(Array.from(text.matchAll(WINDOW)).map((m) => m[0].toLowerCase()))).sort();
  const windowBad = windowClaims.length > 0 && !SQL_DATE.test(sql);
  const t = text.replace(NEUTRAL, " ");
  const usesClient = /client_key|dim_client|sla_tier/i.test(sql);
  const usesCp = /counterparty_key|dim_counterparty|reliability_tier/i.test(sql);
  const scopeViol: string[] = [];
  if (/\bsla\b|platinum|gold|silver|bronze/i.test(t) && !usesClient) scopeViol.push("SLA/client-tier language but SQL is not per client");
  if (/counterpart\w*\s+tier|tier[- ][abcd]\b|\btier\s+[abcd]\b|\btiers?\b/i.test(t) && !(usesCp || usesClient)) scopeViol.push("tier language but SQL is not per counterparty/client");
  if (/POL-001/.test(t) && !usesClient) scopeViol.push("cites POL-001 without a per-client SQL");
  if (/POL-007/.test(t) && !usesCp) scopeViol.push("cites POL-007 without a per-counterparty SQL");
  return { windowClaims, windowBad, scopeViol, ok: !windowBad && scopeViol.length === 0 };
}

const splitSentences = (s: string): string[] => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/** Last resort: remove every sentence that fails the check on its own. Returns the cleaned text and what was removed. */
export function dropFlaggedSentences(text: string, sql: string): { text: string; dropped: string[] } {
  const keep: string[] = [], dropped: string[] = [];
  for (const sent of splitSentences(text)) (checkScope(sent, sql).ok ? keep : dropped).push(sent);
  return { text: keep.join(" "), dropped };
}
