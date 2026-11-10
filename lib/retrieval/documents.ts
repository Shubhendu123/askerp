/**
 * D-048: enterprise document governance helpers (pure functions; no I/O except the loader).
 * Document types (authority_rank, lower wins): regulation 1 > client_agreement 2 > policy 3 > market_guide 4;
 * event_notice / incident_report are records (rank null). Entity-scoped types never enter ranked retrieval: they are
 * included only when the question (or, post-SQL, the result rows) names their entity.
 */
export const SCOPED_TYPES = new Set(["client_agreement", "incident_report", "event_notice"]);
const DATED_TYPES = new Set(["regulation", "client_agreement", "policy", "market_guide"]); // records are not effective-dated

export interface DocEntities { [kind: string]: unknown }

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v));
export const toIso = iso;

/** Today, overridable for reproducible runs (RETRIEVAL_TODAY=YYYY-MM-DD). */
export function today(): string { return process.env.RETRIEVAL_TODAY || new Date().toISOString().slice(0, 10); }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** The date the question is "as of": an explicit ISO date, "Month YYYY" (month end), "last month" (previous month end), else today. */
export function resolveAsOf(question: string, now = today()): string {
  const q = question.toLowerCase();
  const d = q.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/); if (d) return d[0];
  const my = q.match(new RegExp(`\\b(${MONTHS.join("|")})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?(20\\d\\d)\\b`));
  if (my) { const m = MONTHS.indexOf(my[1]) + 1, y = Number(my[2]); return `${y}-${String(m).padStart(2, "0")}-${lastDay(y, m)}`; }
  if (/\blast month\b/.test(q)) { let [y, m] = now.split("-").map(Number); m -= 1; if (m === 0) { m = 12; y -= 1; } return `${y}-${String(m).padStart(2, "0")}-${lastDay(y, m)}`; }
  return now;
}

export function inForce(meta: { doc_type: string; effective_from: string; effective_to: string | null }, asOf: string): boolean {
  if (!DATED_TYPES.has(meta.doc_type)) return true;
  return (!meta.effective_from || meta.effective_from <= asOf) && (!meta.effective_to || asOf <= meta.effective_to);
}

// ── entity scope ──────────────────────────────────────────────────────────────
const GENERIC = new Set(["asset", "capital", "global", "pension", "sovereign", "investment", "management", "securities", "partners", "fund", "authority"]);
const MARKET_NAMES: Record<string, string[]> = {
  GB: ["united kingdom", "uk", "u.k.", "britain", "british"], IT: ["italy", "italian"], DE: ["germany", "german"],
  CH: ["switzerland", "swiss"], US: ["united states", "u.s.", "usa", "american"],
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ScopeHit { kind: string; value: string; strong: boolean }

/** Which of this document's entities does the question name? */
export function matchEntities(question: string, entities: DocEntities): ScopeHit[] {
  const q = question.toLowerCase(), hits: ScopeHit[] = [];
  for (const [kind, raw] of Object.entries(entities ?? {})) {
    for (const val of Array.isArray(raw) ? raw : [raw]) {
      if (val == null) continue;
      const v = String(val);
      if (kind === "event_key") {
        if (new RegExp(`\\b(?:event|cae)[\\s#:-]*(?:ref\\.?\\s*)?(?:cae-)?0*${esc(v)}\\b`, "i").test(q) || new RegExp(`\\bcae-0*${esc(v)}\\b`, "i").test(q)) hits.push({ kind, value: v, strong: true });
      } else if (kind === "market" || kind === "markets") {
        const names = [v.toLowerCase().length > 2 ? v.toLowerCase() : "", ...(MARKET_NAMES[v] ?? [])].filter(Boolean);
        if (names.some((n) => new RegExp(`(?<![a-z])${esc(n)}(?![a-z])`, "i").test(q))) hits.push({ kind, value: v, strong: false });
      } else { // client / client_impacted / counterparty: full name, or its distinctive first word
        const name = v.toLowerCase(), first = name.split(/\s+/)[0];
        if (q.includes(name) || (first.length >= 5 && !GENERIC.has(first) && new RegExp(`(?<![a-z])${esc(first)}(?![a-z])`, "i").test(q))) hits.push({ kind, value: v, strong: true });
      }
    }
  }
  return hits;
}

const EVENTISH = /\b(event|dividend|rights?|tender|offer|election|corporate action|merger|notice)\b/i;
/** A scoped document is in scope when a strong entity is named, or (event notices only) a market is named alongside event vocabulary. */
export function inScope(question: string, docType: string, entities: DocEntities): boolean {
  const hits = matchEntities(question, entities);
  if (hits.some((h) => h.strong)) return true;
  return docType === "event_notice" && hits.length > 0 && EVENTISH.test(question);
}

/** Post-SQL: which scoped documents are linked to the result rows (event_key / client / counterparty names)? */
export function rowsMentionEntities(columns: string[], rows: unknown[][], entities: DocEntities): boolean {
  const idx = (re: RegExp) => columns.map((c, i) => (re.test(c) ? i : -1)).filter((i) => i >= 0);
  const evCols = idx(/event_key$/i), clCols = idx(/^(client_name|client)$/i), cpCols = idx(/^(counterparty_name|counterparty)$/i);
  const vals = (cols: number[]) => new Set(rows.flatMap((r) => cols.map((i) => String(r[i] ?? "").toLowerCase())));
  const ev = vals(evCols), cl = vals(clCols), cp = vals(cpCols);
  for (const [kind, raw] of Object.entries(entities ?? {})) for (const val of Array.isArray(raw) ? raw : [raw]) {
    const v = String(val ?? "").toLowerCase();
    if (kind === "event_key" && ev.has(v)) return true;
    if ((kind === "client" || kind === "client_impacted") && cl.has(v)) return true;
    if (kind === "counterparty" && cp.has(v)) return true;
  }
  return false;
}
