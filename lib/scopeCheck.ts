// D-049: narration scope check, run in the live pipeline (harborline only). Same rules as benchmark/score_harborline.py
// (fidelity_scope), with one fix: a bare year-like token ("2026") is NOT a stated time window.
//   1. window: the narration states a time window ("trailing 12 months", "last quarter", "March 2026") but the executed SQL has no date logic
//   2. scope: SLA/client-tier or counterparty-tier language when the SQL is not per client / per counterparty
// D-049b: a money figure that matches no pre-formatted value or code-computed total is a violation.
// Pipeline (route.ts): narrate -> check -> if it fails, narrate again WITHOUT policy chunks -> check -> if it still fails, drop the flagged sentences.

import { moneyFigureProblems } from "./moneyFormat";
import { countFigures } from "./valueFormat";

export const SCOPE_CHECK_TENANTS = new Set(["harborline"]);

// NOTE: no bare /20\d\d/ alternative - "Q1 2026" and "March 2026" are windows, a lone "2026" is not.
const WINDOW = /\b(trailing|rolling|last\s+(?:\d+\s+)?(?:month|quarter|year|week)s?|past\s+(?:\d+\s+)?(?:month|quarter|year|week)s?|(?:previous|prior)\s+(?:\d+\s+)?(?:month|quarter|year)s?|year[- ]to[- ]date|ytd|this\s+(?:month|quarter|year)|over\s+the\s+(?:last|past)|recent(?:ly)?|\d+[- ]months?|\d+[- ]days?\s+(?:window|period)|Q[1-4]\s*20\d\d|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d\d)\b/gi;
const SQL_DATE = /date_key|full_date|year_num|month_num|quarter_num|current_date|now\(\)|interval|date_trunc|date\s+'/i;
const NEUTRAL = /sla[- ]credits?|mid-tier|service[- ]level (?:breach|agreement)s?/gi;

// D-050 narrator-accuracy rules (checked in code, not just asked of the model):
//   - a custodian HOLDS assets in custody; "manages" would mean AUM
//   - no unsupported marketing or comparison claims
//   - "all N" only when N is the full population
//   - a percentage quoted in prose must appear in the result data or in a document supplied to the narrator (policy numbers match exactly)
//   - SLA credits are not mentioned unless the question asks about them
const MANAGES = /\bmanag(?:es|ed|ing)\b[\s\S]{0,40}?(?:\bassets\b|\bcustody\b|\$)/i;
const MARKETING = /\b(significant(?:ly)?|leading|world-class|robust|impressive|market[- ]leading|top[- ]tier|best[- ]in[- ]class|substantial(?:ly)?|strong(?:ly)? positioned|dominant)\b/i;
const COMPARISON = /\b(peers?|industry|competitors?|sector|benchmark(?:ed|s)?|market average|compared (?:to|with) (?:the )?(?:market|industry|others))\b/i;
const CREDIT = /\b(?:sla\s+)?credits?\b|\bfee waivers?\b/i;
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

// "all clients", "across all markets", "all counterparties": a population claim the data must show. Flagged unless the sentence gives a verified N ("all 8 ...").
const ALL_ENTITY = /\ball\s+(?:(?:of\s+)?(?:the|our|its)\s+)?(?:\w+\s+){0,2}?(?:clients?|accounts?|markets?|counterpart(?:y|ies)|portfolios?|custodians?|funds?|desks?|securities|instruments?|currencies|jurisdictions?|entities)\b/i;

export interface CheckContext {
  question?: string;
  /** Row count of the result; "all N" is valid when N equals this and the query itself is not a filtered subset of a bigger population. */
  rowCount?: number;
  /** Population sizes ("all N" is also valid when N is one of these, e.g. 8 PLATINUM clients). */
  populations?: number[];
  /** Percentages (as written, 0-100) found in the result cells and in the supplied documents. Undefined = percent check off. */
  allowedPct?: { data: number[]; docs: number[] };
  /** Integers a narration may quote: result cells, code-computed totals/running sums, numbers in the supplied documents. Undefined = count check off. */
  allowedCounts?: number[];
}

export interface ScopeResult {
  windowClaims: string[];
  windowBad: boolean;
  scopeViol: string[];
  moneyBad: string[];
  claimBad: string[];
  ok: boolean;
}

/** Percentages quoted in `text`, as numbers ("93.4%" -> 93.4). */
export const pctFigures = (text: string): number[] => Array.from(text.matchAll(/(\d[\d,]*\.?\d*)\s?%/g)).map((m) => parseFloat(m[1].replace(/,/g, ""))).filter((x) => isFinite(x));

function claimProblems(text: string, ctx: CheckContext): string[] {
  const out: string[] = [];
  const t = text.replace(/\*\*/g, "");
  if (MANAGES.test(t)) out.push("says 'manages' - a custodian holds assets in custody (manages = AUM)");
  const mk = MARKETING.exec(t); if (mk) out.push(`unsupported marketing claim: '${mk[0]}'`);
  const cp = COMPARISON.exec(t); if (cp) out.push(`unsupported comparison: '${cp[0]}'`);
  if (CREDIT.test(t) && !/credit|waiver|compensat|penalt|rebate/i.test(ctx.question ?? "")) out.push("mentions SLA credits although the question did not ask");
  for (const m of Array.from(t.matchAll(/\ball\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi))) {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUM[m[1].toLowerCase()];
    const okAll = ctx.rowCount !== undefined && (ctx.populations ? ctx.populations.includes(n) : n === ctx.rowCount);
    if (!okAll && (ctx.rowCount !== undefined || ctx.populations)) out.push(`'all ${m[1]}' but the data does not show the full population`);
  }
  if (ALL_ENTITY.test(t) && !/\ball\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(t)) out.push("generic 'all <entities>' claim - the data does not show the full population");
  if (ctx.allowedCounts) {
    for (const n of countFigures(t)) if (!ctx.allowedCounts.includes(n)) out.push(`figure ${n.toLocaleString("en-US")} matches no result value, code-computed total or document number`);
  }
  if (ctx.allowedPct) {
    const { data, docs } = ctx.allowedPct;
    for (const p of pctFigures(t)) {
      const inData = data.some((v) => Math.abs(v - p) <= 0.051 || Math.abs(Math.round(v) - p) < 1e-9);
      const inDocs = docs.some((v) => Math.abs(v - p) < 1e-9);
      if (!inData && !inDocs) out.push(`percentage ${p}% matches neither the result data nor any supplied document`);
    }
  }
  return out;
}

export function checkScope(text: string, sql: string, allowedMoney: number[] = [], ctx: CheckContext = {}): ScopeResult {
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
  const moneyBad = moneyFigureProblems(text, allowedMoney);
  const claimBad = claimProblems(text, ctx);
  return { windowClaims, windowBad, scopeViol, moneyBad, claimBad, ok: !windowBad && scopeViol.length === 0 && moneyBad.length === 0 && claimBad.length === 0 };
}

const splitSentences = (s: string): string[] => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/** Last resort: remove every sentence that fails the check on its own. Returns the cleaned text and what was removed. */
export function dropFlaggedSentences(text: string, sql: string, allowedMoney: number[] = [], ctx: CheckContext = {}): { text: string; dropped: string[] } {
  const keep: string[] = [], dropped: string[] = [];
  for (const sent of splitSentences(text)) (checkScope(sent, sql, allowedMoney, ctx).ok ? keep : dropped).push(sent);
  return { text: keep.join(" "), dropped };
}
