import AppShell from "@/components/shell/AppShell";
import { executeSQL } from "@/lib/db";

// D-043: read-only trace view. No auth (consistent with the demo; documented gap in the ADR).
export const dynamic = "force-dynamic";
export const metadata = { title: "AskERP — Traces" };

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
             avg(CASE WHEN success THEN 1.0 ELSE 0.0 END) AS success_rate,
             coalesce(sum(retry_count),0) AS retries
      FROM ops.request_traces WHERE created_at >= CAST(current_date AS TIMESTAMP)`))[0];
    recent = await q(`SELECT * FROM ops.request_traces ORDER BY created_at DESC LIMIT 50`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const tiles: [string, string][] = summary ? [
    ["Requests today", String(summary.n)],
    ["Cost today", fmtUsd(summary.cost)],
    ["p50 latency", fmtMs(summary.p50)],
    ["p95 latency", fmtMs(summary.p95)],
    ["Success rate", summary.n ? `${(Number(summary.success_rate) * 100).toFixed(0)}%` : "–"],
    ["Retries", String(summary.retries)],
  ] : [];

  const th = "text-left text-xs font-medium px-3 py-2";
  const td = "px-3 py-2 text-sm align-top";
  return (
    <AppShell>
      <div className="p-6 max-w-6xl" style={{ color: "var(--text-primary)" }}>
        <h1 className="text-xl font-semibold mb-1">Request traces</h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>Today = UTC day. Most recent 50 requests below; click a row for SQL, chunks and stage timings.</p>
        {err && <div className="text-sm p-3 rounded" style={{ background: "var(--sentiment-negative-bg)", color: "var(--sentiment-negative)" }}>Could not read ops.request_traces: {err}</div>}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          {tiles.map(([label, val]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</div>
              <div className="text-lg font-semibold">{val}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg overflow-x-auto" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <table className="w-full">
            <thead style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)" }}>
              <tr>{["Time (UTC)", "Question", "Tenant", "OK", "Error type", "Retries", "Rows", "Total", "Cost"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
            </thead>
            {recent.map((r) => {
              const ok = r.success === true;
              let chunks: string[] = [];
              try { chunks = JSON.parse(String(r.chunk_ids ?? "[]")); } catch { /* ignore */ }
              const ts = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
              const qtext = String(r.question ?? "");
              return (
                <tbody key={String(r.trace_id)} style={{ borderTop: "1px solid var(--border)" }}>
                  <tr>
                    <td colSpan={9} className="p-0">
                      <details>
                        <summary className="grid cursor-pointer list-none" style={{ gridTemplateColumns: "9rem 1fr 4rem 3rem 8rem 4rem 4rem 6rem 6rem" }}>
                          <span className={td}>{ts.replace("T", " ").slice(0, 19)}</span>
                          <span className={td}>{qtext.length > 70 ? qtext.slice(0, 70) + "…" : qtext}</span>
                          <span className={td}>{String(r.tenant)}</span>
                          <span className={td} style={{ color: ok ? "var(--sentiment-positive)" : "var(--sentiment-negative)" }}>{ok ? "yes" : "no"}</span>
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
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
          {!recent.length && !err && <div className="p-4 text-sm" style={{ color: "var(--text-secondary)" }}>No traces yet.</div>}
        </div>
      </div>
    </AppShell>
  );
}
