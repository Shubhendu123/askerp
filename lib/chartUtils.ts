// Detect which tabs make sense for a given result shape

const TIME_KEYWORDS = ["year", "quarter", "month", "date", "period", "week", "day"];

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && !isNaN(v);
}

function isTimeCol(name: string): boolean {
  const lower = name.toLowerCase();
  return TIME_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Contribution ──────────────────────────────────────────────────────────────
// Activates when: 2+ rows, at least one string column + one numeric column,
// and the numeric column values are all positive (additive totals).
export function canContribute(columns: string[], rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0] as unknown[];
  const hasLabel = first.some((v) => typeof v === "string");
  const hasPositiveNumber = first.some((v) => isNumeric(v) && v >= 0);
  return hasLabel && hasPositiveNumber;
}

export interface ContributionRow {
  label: string;
  value: number;
  share: number; // 0-100
}

export function prepContribution(columns: string[], rows: unknown[][]): ContributionRow[] {
  // Find first string col (label) and first numeric col (value)
  const firstRow = rows[0] as unknown[];
  const labelIdx = firstRow.findIndex((v) => typeof v === "string");
  const valueIdx = firstRow.findIndex((v) => isNumeric(v));
  if (labelIdx === -1 || valueIdx === -1) return [];

  const items = rows.map((r) => {
    const row = r as unknown[];
    return {
      label: String(row[labelIdx]),
      value: Number(row[valueIdx]),
    };
  });

  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  return items.map((i) => ({
    ...i,
    share: total > 0 ? (i.value / total) * 100 : 0,
  }));
}

// ── Trend ─────────────────────────────────────────────────────────────────────
// Activates when: 2+ rows, one column name contains a time keyword, one is numeric.
export function canTrend(columns: string[], rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const hasTimeCol = columns.some(isTimeCol);
  const firstRow = rows[0] as unknown[];
  const hasNumber = firstRow.some(isNumeric);
  return hasTimeCol && hasNumber;
}

export interface TrendRow {
  period: string;
  value: number;
  colName: string;
}

export function prepTrend(columns: string[], rows: unknown[][]): TrendRow[] {
  const lower = columns.map((c) => c.toLowerCase());

  // Detect composite time dimensions
  const yearIdx = lower.findIndex((c) => c === "year");
  const quarterIdx = lower.findIndex((c) => c === "quarter");
  const monthIdx = lower.findIndex((c) => c === "month");

  // Prefer composite label: year+quarter > year+month > first time col alone
  let buildPeriod: (row: unknown[]) => string;
  let timeIndices: number[] = [];

  if (yearIdx !== -1 && quarterIdx !== -1) {
    buildPeriod = (row) => `Q${row[quarterIdx]} ${row[yearIdx]}`;
    timeIndices = [yearIdx, quarterIdx];
  } else if (yearIdx !== -1 && monthIdx !== -1) {
    buildPeriod = (row) => {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const m = Number(row[monthIdx]);
      return `${months[m - 1] ?? m} ${row[yearIdx]}`;
    };
    timeIndices = [yearIdx, monthIdx];
  } else {
    const timeIdx = columns.findIndex(isTimeCol);
    if (timeIdx === -1) return [];
    buildPeriod = (row) => String(row[timeIdx]);
    timeIndices = [timeIdx];
  }

  // First numeric column that isn't a time index
  const valueIdx = columns.findIndex((_, i) => {
    if (timeIndices.includes(i)) return false;
    return rows.some((r) => isNumeric((r as unknown[])[i]));
  });
  if (valueIdx === -1) return [];

  return rows.map((r) => {
    const row = r as unknown[];
    return {
      period: buildPeriod(row),
      value: Number(row[valueIdx]),
      colName: columns[valueIdx],
    };
  });
}
