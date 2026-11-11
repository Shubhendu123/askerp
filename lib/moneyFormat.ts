// D-049: money is formatted in code (K/M/B) BEFORE it reaches the narrator, so the model never has to scale
// a raw figure itself (one run turned $416K into "$416M"). Harborline only (see FIDELITY_TENANTS in narrator.ts).

/** 416000 -> "$416K", 211200 -> "$211.2K", 1.1e9 -> "$1.1B", 950 -> "$950", -2.5e6 -> "-$2.5M". */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n), sign = n < 0 ? "-" : "";
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  // D-050: the largest unit that keeps the number under 1,000 - and rounding must not push it back to 1000 ($999,950 -> $1M, not $1000K).
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (let i = 0; i < units.length; i++) {
    const [div, sym] = units[i];
    if (abs < div) continue;
    if (Number(trim(abs / div)) >= 1000 && i > 0) return `${sign}$${trim(abs / units[i - 1][0])}${units[i - 1][1]}`;
    return `${sign}$${trim(abs / div)}${sym}`;
  }
  if (Number(trim(abs)) >= 1000) return `${sign}$1K`; // 999.97 rounds to 1000
  return `${sign}$${trim(abs)}`;
}

/** Column names that hold money in the Harborline warehouse (…_usd, amounts, penalties, costs, revenue, exposure…). */
const MONEY_COL = /(^|_)(usd|amount|amt|value|cost|penalt\w*|revenue|fee|fees|impact|exposure|charge|credit|credits|profit\w*|notional|aum|auc|owed|cap)(_|$)/i;
const NOT_MONEY = /(pct|rate|ratio|share|count|days|_key|_id|number|num|qty|quantity)/i;

export function isMoneyColumn(name: string): boolean {
  return MONEY_COL.test(name) && !NOT_MONEY.test(name);
}

/** Replace numeric cells in money columns with formatted strings; everything else is untouched. */
export function formatMoneyRows(columns: string[], rows: unknown[][]): unknown[][] {
  const money = columns.map(isMoneyColumn);
  if (!money.some(Boolean)) return rows;
  return rows.map((r) => (r as unknown[]).map((v, i) => {
    if (!money[i]) return v;
    const num = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;
    return num === null ? v : formatMoney(num);
  }));
}

// ---- D-049b: totals are computed in code; every money figure in a narration is checked against code-computed values ----

export interface MoneyContext {
  /** Values (USD) a narration may legitimately quote: money cells, column totals, running top-N sums. */
  allowed: number[];
  /** Pre-formatted lines handed to the narrator ("use verbatim; never do arithmetic"). */
  lines: string[];
}

const toNum = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;

export function moneyContext(columns: string[], rows: unknown[][]): MoneyContext {
  const allowed: number[] = [], lines: string[] = [];
  columns.forEach((name, j) => {
    if (!isMoneyColumn(name)) return;
    const col = rows.map((r) => toNum((r as unknown[])[j])).filter((x): x is number => x !== null);
    if (!col.length) return;
    col.forEach((v) => allowed.push(Math.abs(v)));
    if (col.length < 2) return;
    let run = 0;
    const tops: string[] = [];
    col.forEach((v, i) => {
      run += v;
      allowed.push(Math.abs(run));
      if (i >= 1 && i <= 4) tops.push(`top ${i + 1} rows together = ${formatMoney(run)}`);
    });
    lines.push(`${name}: total of all ${col.length} returned rows = ${formatMoney(run)}; ${tops.join("; ")} (rows in the order returned)`);
  });
  return { allowed, lines };
}

const FIG = /\$\s?(\d[\d,]*\.?\d*)\s?(K|M|B|T|bn|thousand|million|billion|trillion)?\b|(\d[\d,]*\.?\d*)\s*(thousand|million|billion|trillion)\s+dollars/gi;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };

/** Money figures in `text` that match no allowed value (within 6% - rounding - so a x1000 mis-scale is always caught). */
export function moneyFigureProblems(text: string, allowed: number[]): string[] {
  if (!allowed.length) return [];
  const bad: string[] = [];
  for (const m of Array.from(text.matchAll(FIG))) {
    const raw = (m[1] ?? m[3]).replace(/,/g, "");
    const n = parseFloat(raw) * (SCALE[(m[2] ?? m[4] ?? "").toLowerCase()] ?? 1);
    if (!isFinite(n) || n === 0) continue;
    const ok = allowed.some((v) => (v < 1000 ? Math.abs(n - v) <= 1 : Math.abs(n - v) / v <= 0.06));
    if (!ok) bad.push(m[0].trim());
  }
  return bad;
}
