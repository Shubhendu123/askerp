// D-050: value formatting by column MEANING, not by type (Harborline only; MRO keeps its own formatters).
// Pure functions, no React, so the same code runs in the browser (tables, headline number) and in unit tests.
//   money   (*_usd, amount, value, cost, fee, penalty, revenue, impact ...) -> $K / $M / $B / $T, largest unit that keeps the number under 1,000
//   percent (*_pct, *_rate*)                                                -> "93.4%"   (Harborline stores percentages on a 0-100 scale)
//   count   (instructions, count, num_*, *_count ...)                       -> "4,112"
//   year / month                                                            -> never number-formatted; year_num + month_num collapse into one "Month" column ("Sep 2026")
import { formatMoney, isMoneyColumn } from "./moneyFormat";

export type ColKind = "money" | "pct" | "count" | "year" | "month" | "bool" | "id" | "number" | "text";

const COUNT_NAMES = /^(count|n|instructions|trades|events|breaks|requests|clients|counterparties|fails|failed|claims|elections|positions|items|rows|tickets|invoices|payments|transactions)$/i;
const NOT_PCT_RATE = /(usd_rate|fx_rate|bps|fee_rate|per_share|exchange_rate|rate_per)/i;

export function columnKind(name: string, sample: unknown[] = []): ColKind {
  const n = name.toLowerCase();
  if (/^(year|year_num|yr|fiscal_year)$/.test(n)) return "year";
  if (/^(month|month_num|mon|mth)$/.test(n)) return "month";
  if (sample.some((v) => typeof v === "boolean")) return "bool";
  if (/(^|_)(id|key|code|number|no)$/.test(n)) return "id";
  if (/(_pct$|^pct_|_percent|percent_|pct$)/.test(n) || (/rate/.test(n) && !NOT_PCT_RATE.test(n))) return "pct";
  if (isMoneyColumn(name)) return "money";
  if (COUNT_NAMES.test(n) || /^num_/.test(n) || /_count$/.test(n) || /^count_/.test(n) || /^n_/.test(n)) return "count";
  const nums = sample.filter((v) => v !== null && v !== undefined);
  if (nums.length && nums.every((v) => typeof v === "number" || typeof v === "bigint")) return "number";
  return "text";
}

const toNum = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number): string => MONTHS[m - 1] ?? String(m);

/** "93.42" -> "93.4%". Value is already on a 0-100 scale. */
export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return `${n.toFixed(1)}%`;
}

/** 4112 -> "4,112" (integers only; a non-integer count keeps up to 2 decimals). */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });
}

function formatPlain(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Format one cell according to its column's meaning. */
export function formatCellByKind(kind: ColKind, v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (kind === "bool" || typeof v === "boolean") return v ? "Yes" : "No";
  if (kind === "year" || kind === "id") return String(v); // never "2,026"
  if (kind === "month") { const m = toNum(v); return m !== null && m >= 1 && m <= 12 ? monthName(m) : String(v); }
  if (kind === "text") return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  const n = toNum(v);
  if (n === null) return String(v);
  switch (kind) {
    case "money": return formatMoney(n);
    case "pct": return formatPct(n);
    case "count": return formatCount(n);
    default: return formatPlain(n);
  }
}

/** Convenience for a single named value (the big KPI number). */
export function formatValue(columnName: string, v: unknown): string {
  return formatCellByKind(columnKind(columnName, [v]), v);
}

// ── headers ─────────────────────────────────────────────────────────────────

const ACRONYMS = new Set(["SLA", "AUC", "AUM", "USD", "CSDR", "FX", "ID", "PNL", "DVP", "RVP", "ISIN", "KYC", "OTC", "NAV", "CA", "SSI", "BPS", "POL", "ETF", "EUR", "GBP", "JPY", "CHF"]);
const HEADER_OVERRIDES: Record<string, string> = {
  client_name: "Client", counterparty_name: "Counterparty", sla_tier: "Tier", reliability_tier: "Tier", tier: "Tier",
  settlement_rate_pct: "Settlement rate", target_pct: "Target", fail_rate_pct: "Fail rate", met_target: "Met target",
  instructions: "Instructions", year_month: "Month", pnl_usd: "P&L", desk_name: "Desk",
};

/** snake_case column -> human header: "settlement_rate_pct" -> "Settlement rate", "assets_under_custody_usd" -> "Assets under custody". Acronyms stay upper-case. */
export function humanizeHeader(col: string): string {
  const o = HEADER_OVERRIDES[col.toLowerCase()];
  if (o) return o;
  const words = col.toLowerCase().replace(/(_pct|_usd|_name|_num|_percent)$/, "").split(/[_\s]+/).filter(Boolean);
  if (!words.length) return col;
  return words.map((w, i) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Sentence-case a free-text title but keep acronyms upper-case: "platinum clients below sla target" -> "Platinum clients below SLA target". */
export function fixAcronyms(text: string): string {
  return text.replace(/\b[A-Za-z]{2,5}\b/g, (w) => (ACRONYMS.has(w.toUpperCase()) && w !== w.toUpperCase() ? w.toUpperCase() : w));
}

/** The period is appended by code ("— Sep 2026"); remove any month / year / "last month" the narrator put in the title itself. */
export function stripPeriodWords(title: string): string {
  return title
    .replace(/\b(?:(?:last|this|previous|prior|current) (?:month|quarter|year)|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi, " ")
    .replace(/\b(?:19|20)\d\d\b/g, " ")
    .replace(/\s+(?:in|for|during|of|from|as of)\s*$/i, "")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

/** Fallback card title when the narrator gave none: the question, tidied. */
export function titleFromQuestion(q: string): string {
  const t = q.trim().replace(/[?.!]+$/, "").replace(/^(what|which|who|how|show me|show|list|give me)\s+(is|are|was|were|do|does|did)?\s*/i, "").replace(/\s+/g, " ");
  const s = fixAcronyms(t || q);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── table preparation ───────────────────────────────────────────────────────

export interface PreparedTable {
  headers: string[];
  align: ("left" | "right")[];
  rows: string[][];
}

/**
 * Turn raw columns/rows into display-ready strings:
 *  - year_num + month_num -> one "Month" column ("Sep 2026"), placed where the year column was
 *  - a rate column and a target column both present -> "Gap (pts)" column after the target (rate - target, 1 decimal)
 *  - every other cell formatted by column meaning
 */
export function prepareTable(columns: string[], rows: unknown[][]): PreparedTable {
  const cols = columns.map((name, i) => ({ name, i, kind: columnKind(name, rows.map((r) => r[i])) }));
  const yearC = cols.find((c) => c.kind === "year");
  const monthC = cols.find((c) => c.kind === "month");
  const combine = !!(yearC && monthC);

  const rateC = cols.find((c) => c.kind === "pct" && /rate/i.test(c.name) && !/target/i.test(c.name));
  const targetC = cols.find((c) => /^target/i.test(c.name) || /_target(_pct)?$/i.test(c.name) ? c.kind === "pct" || c.kind === "number" : false);
  const withGap = !!(rateC && targetC);

  type Out = { header: string; align: "left" | "right"; cell: (r: unknown[]) => string };
  const out: Out[] = [];
  for (const c of cols) {
    if (combine && c === monthC) continue;
    if (combine && c === yearC) {
      out.push({ header: "Month", align: "left", cell: (r) => { const y = toNum(r[yearC!.i]), m = toNum(r[monthC!.i]); return y !== null && m !== null ? `${monthName(m)} ${y}` : `${r[monthC!.i]} ${r[yearC!.i]}`; } });
      continue;
    }
    const numeric = ["money", "pct", "count", "number"].includes(c.kind);
    out.push({ header: c.kind === "month" ? "Month" : humanizeHeader(c.name), align: numeric ? "right" : "left", cell: (r) => formatCellByKind(c.kind, r[c.i]) });
    if (withGap && c === targetC) {
      out.push({
        header: "Gap (pts)", align: "right",
        cell: (r) => { const a = toNum(r[rateC!.i]), b = toNum(r[targetC!.i]); if (a === null || b === null) return "—"; const g = Math.round((a - b) * 10) / 10; return `${g > 0 ? "+" : ""}${g.toFixed(1)}`; },
      });
    }
  }
  return { headers: out.map((o) => o.header), align: out.map((o) => o.align), rows: rows.map((r) => out.map((o) => o.cell(r as unknown[]))) };
}

// ── count figures: code-computed totals + a check for integers quoted in prose (D-050: a narrator once wrote "9,211 instructions" for a true total of 11,211) ──

/** Integers of 4+ digits (or with thousands separators) quoted in `text`; plain 4-digit years (1900-2100) and money/percent figures are ignored. */
export function countFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of Array.from(text.matchAll(/(?<![\d.,$])(\d{1,3}(?:,\d{3})+|\d{4,})(?![\d,]|\.\d|\s?(?:%|[KMBT]\b|thousand|million|billion))/g))) {
    const raw = m[1];
    const n = parseInt(raw.replace(/,/g, ""), 10);
    if (!raw.includes(",") && raw.length === 4 && n >= 1900 && n <= 2100) continue;
    out.push(n);
  }
  return out;
}

/** Totals and running top-N sums for count columns, pre-computed in code so the narrator never adds numbers itself. */
export function countContext(columns: string[], rows: unknown[][]): { allowed: number[]; lines: string[] } {
  const allowed: number[] = [], lines: string[] = [];
  columns.forEach((name, j) => {
    if (columnKind(name, rows.map((r) => r[j])) !== "count") return;
    const col = rows.map((r) => toNum((r as unknown[])[j])).filter((x): x is number => x !== null);
    if (!col.length) return;
    col.forEach((v) => allowed.push(Math.abs(v)));
    if (col.length < 2) return;
    let run = 0;
    const tops: string[] = [];
    col.forEach((v, i) => { run += v; allowed.push(Math.abs(run)); if (i >= 1 && i <= 4) tops.push(`top ${i + 1} rows together = ${formatCount(run)}`); });
    lines.push(`${humanizeHeader(name).toLowerCase()}: total of all ${col.length} returned rows = ${formatCount(run)}; ${tops.join("; ")} (rows in the order returned)`);
  });
  return { allowed, lines };
}
