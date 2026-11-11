// D-049: money is formatted in code (K/M/B) BEFORE it reaches the narrator, so the model never has to scale
// a raw figure itself (one run turned $416K into "$416M"). Harborline only (see FIDELITY_TENANTS in narrator.ts).

/** 416000 -> "$416K", 211200 -> "$211.2K", 1.1e9 -> "$1.1B", 950 -> "$950", -2.5e6 -> "-$2.5M". */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n), sign = n < 0 ? "-" : "";
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`;
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
