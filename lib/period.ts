// D-050: resolve relative dates ("last month", "this quarter", "year to date") against the DATA's latest date, not the wall clock,
// and say so in the answer. Harborline's data ends on 2026-10-22, so "last month" = September 2026 (the latest COMPLETE month).
// Pure functions (UTC), unit-tested in harborline/test_value_format.ts.

export interface ResolvedPeriod {
  phrase: string;  // what the user wrote, e.g. "last month"
  label: string;   // "September 2026"
  short: string;   // "Sep 2026"
  reason: string;  // "latest complete month in the data (data runs to 22 Oct 2026)"
}

const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = FULL.map((m) => m.slice(0, 3));

/** 20261022 (number, bigint or string) -> Date (UTC). */
export function dateFromKey(key: unknown): Date | null {
  const s = String(key ?? "").replace(/\D/g, "");
  if (s.length !== 8) return null;
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
}

const fmtDay = (d: Date) => `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const isMonthEnd = (d: Date) => d.getUTCDate() === new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** Latest complete month as [year, month0]. */
function latestCompleteMonth(latest: Date): [number, number] {
  const y = latest.getUTCFullYear(), m = latest.getUTCMonth();
  if (isMonthEnd(latest)) return [y, m];
  return m === 0 ? [y - 1, 11] : [y, m - 1];
}

export function resolvePeriod(question: string, latest: Date): ResolvedPeriod | null {
  const q = question.toLowerCase();
  const through = `data runs to ${fmtDay(latest)}`;
  const y = latest.getUTCFullYear(), m = latest.getUTCMonth();

  let mt: RegExpMatchArray | null;
  if ((mt = q.match(/\b(last|previous|prior) month\b/))) {
    const [cy, cm] = latestCompleteMonth(latest);
    return { phrase: mt[0], label: `${FULL[cm]} ${cy}`, short: `${SHORT[cm]} ${cy}`, reason: `latest complete month in the data (${through})` };
  }
  if ((mt = q.match(/\b(this|current) month\b|\bmonth[- ]to[- ]date\b|\bmtd\b/))) {
    return { phrase: mt[0], label: `${FULL[m]} ${y} (to ${fmtDay(latest)})`, short: `${SHORT[m]} ${y} MTD`, reason: `current month so far, incomplete (${through})` };
  }
  if ((mt = q.match(/\b(last|previous|prior) quarter\b/))) {
    const [cy, cm] = latestCompleteMonth(latest);
    let qi = Math.floor(cm / 3), qy = cy;
    if (cm % 3 !== 2) { qi -= 1; if (qi < 0) { qi = 3; qy -= 1; } } // the quarter containing the latest complete month is not complete yet
    return { phrase: mt[0], label: `Q${qi + 1} ${qy} (${SHORT[qi * 3]}-${SHORT[qi * 3 + 2]})`, short: `Q${qi + 1} ${qy}`, reason: `latest complete quarter in the data (${through})` };
  }
  if ((mt = q.match(/\b(this|current) quarter\b|\bquarter[- ]to[- ]date\b|\bqtd\b/))) {
    const qi = Math.floor(m / 3);
    return { phrase: mt[0], label: `Q${qi + 1} ${y} (to ${fmtDay(latest)})`, short: `Q${qi + 1} ${y} QTD`, reason: `current quarter so far, incomplete (${through})` };
  }
  if ((mt = q.match(/\b(last|previous|prior) year\b/))) {
    return { phrase: mt[0], label: String(y - 1), short: String(y - 1), reason: `previous calendar year (${through})` };
  }
  if ((mt = q.match(/\b(this|current) year\b|\bytd\b|\byear[- ]to[- ]date\b/))) {
    return { phrase: mt[0], label: `${y} year to date (to ${fmtDay(latest)})`, short: `${y} YTD`, reason: `current calendar year so far (${through})` };
  }
  if ((mt = q.match(/\btoday\b/))) {
    return { phrase: mt[0], label: fmtDay(latest), short: fmtDay(latest), reason: `latest date in the data` };
  }
  return null;
}
