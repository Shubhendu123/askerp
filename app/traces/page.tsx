import AppShell from "@/components/shell/AppShell";
import { executeSQL } from "@/lib/db";
import { getActiveTenantConfig } from "@/lib/tenants";

// D-043: read-only trace view. No auth (consistent with the demo; documented gap in the ADR).
export const dynamic = "force-dynamic";
export function generateMetadata() { return { title: `${getActiveTenantConfig().productName} — Traces` }; }

type Row = Record<string, unknown>;

async function q(sql: string): Promise<Row[]> {
  const r = await executeSQL(sql, 1000);
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
}

const fmtMs = (v: unknown) => (v == null ? "–" : `${Math.round(Number(v)).toLocaleString()} ms`);
const fmtUsd = (v: unknown) => (v == null ? "–" : `$${Number(v).toFixed(4)}`);

export default async function TracesPage() {
  let summary: Row | null = null;
  let recent: Row[] = [];
  let err: string | null = null;
  try {
    summary = (await q(`
      SELECT count(*) AS n, coalesce(sum(estimated_cost_usd),0) AS cost,
             median(total_ms) AS p50, quantile_cont(total_ms, 0.95) AS p95,
             count(*) FILTER (WHERE success) AS answered,
             count(*) FILTER (WHERE NOT success AND error_type IN ('refusal','out_of_scope')) AS declined,
             count(*) FILTER (WHERE NOT success AND coalesce(error_type,'other') NOT IN ('refusal','out_of_scope')) AS failed,
             coalesce(sum(retry_count),0) AS retries
      FROM ops.request_traces WHERE created_at >= CAST(current_date AS TIMESTAMP)`))[0];
    recent = await q(`SELECT * FROM ops.request_traces ORDER BY created_at DESC LIMIT 50`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  // Outcome taxonomy (D-043): a correct refusal is NOT a failure.
  const n = Number(summary?.n ?? 0);
  const failedN = Number(summary?.failed ?? 0);
  const tiles: [string, string][] = summary ? [
    ["Requests today", String(summary.n)],
    ["Cost today", fmtUsd(summary.cost)],
    ["p50 latency", fmtMs(summary.p50)],
    ["p95 latency", fmtMs(summary.p95)],
    ["Retries", String(summary.retries)],
  ] : [];
  const outcomeTiles: [string, string, string?][] = summary ? [
    ["Answered", String(summary.answered)],
    ["Correctly declined", String(summary.declined), "refusal / out_of_scope"],
  ] : [];

  const th = "text-left text-xs font-medium px-3 py-2";
  // D-050: the 4rem Tenant column overlapped "harborline" and the Outcome column. Harborline gets a wider, truncating Tenant column; other tenants keep the original grid.
  const harbor = getActiveTenantConfig().id === "harborline";
  const GRID = harbor ? "11rem minmax(12rem,1fr) 7rem 7rem 8rem 4rem 4rem 6rem 6rem" : "9rem minmax(12rem,1fr) 4rem 9rem 8rem 4rem 4rem 6rem 6rem"; // shared by header and rows so columns align
  const COLS = ["Time (UTC)", "Question", "Tenant", "Outcome", "Error type", "Retries", "Rows", "Total", "Cost"];
  const td = "px-3 py-2 text-sm align-top";
  return (
    <AppShell>
      <div className="p-6 max-w-6xl" style={{ color: "var(--text-primary)" }}>
        <h1 className="text-xl font-semibold mb-1">Request traces</h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>Today = UTC day. Most recent 50 requests below; click a row for SQL, chunks and stage timings.</p>
        {harbor && <p className="text-xs mb-4 -mt-2 font-medium" style={{ color: "var(--accent)" }}>Live: every request is logged.</p>}
        {err && <div className="text-sm p-3 rounded" style={{ background: "var(--sentiment-negative-bg)", color: "var(--sentiment-negative)" }}>Could not read ops.request_traces: {err}</div>}
        {summary && (
          <div className="rounded-lg p-4 mb-3 flex items-baseline gap-4" style={{ background: failedN ? "var(--sentiment-negative-bg)" : "var(--sentiment-positive-bg)", border: "1px solid var(--border)" }}>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Failure rate today<br />(binder / parser / timeout / other)</div>
            <div className="text-3xl font-semibold" style={{ color: failedN ? "var(--sentiment-negative)" : "var(--sentiment-positive)" }}>{n ? `${((100 * failedN) / n).toFixed(0)}%` : "–"}</div>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>{failedN} failed of {n}</div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
          {outcomeTiles.map(([label, val, sub]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</div>
              <div className="text-lg font-semibold">{val}</div>
              {sub && <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{sub}</div>}
            </div>
          ))}
          {tiles.map(([label, val]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</div>
              <div className="text-lg font-semibold">{val}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg overflow-x-auto" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div style={{ minWidth: "58rem" }}>
            <div className="grid" style={{ gridTemplateColumns: GRID, background: "var(--bg-subtle)", color: "var(--text-secondary)" }}>
              {COLS.map((h) => <span key={h} className={th}>{h}</span>)}
            </div>
            {recent.map((r) => {
              const ok = r.success === true;
              const declined = !ok && (r.error_type === "refusal" || r.error_type === "out_of_scope");
              const outcome = ok ? "answered" : declined ? "declined" : "failed";
              const outcomeColor = ok ? "var(--sentiment-positive)" : declined ? "var(--text-secondary)" : "var(--sentiment-negative)";
              let chunks: string[] = [];
              try { chunks = JSON.parse(String(r.chunk_ids ?? "[]")); } catch { /* ignore */ }
              const ca = r.created_at as unknown; // local DuckDB returns a timestamp object ({micros}); MotherDuck returns a Date
              const ts = ca instanceof Date ? ca.toISOString() : ca && typeof ca === "object" && "micros" in ca ? new Date(Number((ca as { micros: bigint }).micros) / 1000).toISOString() : String(ca);
              const qtext = String(r.question ?? "");
              return (
                <div key={String(r.trace_id)} style={{ borderTop: "1px solid var(--border)" }}>
                      <details>
                        <summary className="grid cursor-pointer list-none" style={{ gridTemplateColumns: GRID }}>
                          <span className={td}>{ts.replace("T", " ").slice(0, 19)}</span>
                          <span className={td}>{qtext.length > 70 ? qtext.slice(0, 70) + "…" : qtext}</span>
                          <span className={`${td} ${harbor ? "truncate" : ""}`}>{String(r.tenant)}</span>
                          <span className={td} style={{ color: outcomeColor }}>{outcome}</span>
                          <span className={td}>{r.error_type ? String(r.error_type) : "–"}</span>
                          <span className={td}>{String(r.retry_count)}</span>
                          <span className={td}>{r.rows_returned == null ? "–" : String(r.rows_returned)}</span>
                          <span className={td}>{fmtMs(r.total_ms)}</span>
                          <span className={td}>{fmtUsd(r.estimated_cost_usd)}</span>
                        </summary>
                        <div className="px-3 pb-3 text-sm" style={{ background: "var(--bg-page)" }}>
                          <div className="font-medium mt-2 mb-1">Question</div>
                          <div>{qtext}</div>
                          {r.error_message ? <><div className="font-medium mt-2 mb-1">Error</div><div style={{ color: "var(--sentiment-negative)" }}>{String(r.error_message)}</div></> : null}
                          <div className="font-medium mt-2 mb-1">Generated SQL</div>
                          <pre className="text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap" style={{ background: "var(--bg-subtle)" }}>{String(r.sql_generated ?? "–")}</pre>
                          <div className="font-medium mt-2 mb-1">Retrieved chunks ({chunks.length}) · {String(r.retrieval_mode)} · k={String(r.retrieval_k)} · expand={String(r.expand_tables)}</div>
                          <div className="text-xs">{chunks.join(", ") || "–"}</div>
                          <div className="font-medium mt-2 mb-1">Stage timings</div>
                          <div className="text-xs">retrieval {fmtMs(r.retrieval_ms)} · sql-gen {fmtMs(r.sqlgen_ms)} · execution {fmtMs(r.exec_ms)} · narration {fmtMs(r.narrate_ms)} · total {fmtMs(r.total_ms)}</div>
                          <div className="text-xs mt-1">tokens: sql {String(r.tokens_in)}/{String(r.tokens_out)} · narration {String(r.narration_tokens_in)}/{String(r.narration_tokens_out)} · limit_added={String(r.limit_added)} · model {String(r.model)}</div>
                        </div>
                      </details>
                </div>
              );
            })}
          </div>
          {!recent.length && !err && <div className="p-4 text-sm" style={{ color: "var(--text-secondary)" }}>No traces yet.</div>}
        </div>
      </div>
    </AppShell>
  );
}
