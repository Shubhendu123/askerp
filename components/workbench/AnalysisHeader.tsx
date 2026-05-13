"use client";

import type { AskResponse } from "./Workbench";

interface Props {
  response: AskResponse | null;
  loading: boolean;
  activeQuestion: string | null;
}

function formatNumber(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (isNaN(n)) return String(v);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n < 1 && n > 0) return `${(n * 100).toFixed(1)}%`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function primaryValue(response: AskResponse): string {
  if (!response.rows?.length || !response.columns?.length) return "—";
  return formatNumber((response.rows[0] as unknown[])[0]);
}

function sentimentColor(s: string | null | undefined) {
  if (s === "positive") return "var(--sentiment-positive)";
  if (s === "negative") return "var(--sentiment-negative)";
  return "var(--accent-primary)";
}

export default function AnalysisHeader({ response, loading, activeQuestion }: Props) {
  if (!activeQuestion && !loading) return null;

  const isSingleStat =
    response && !response.error &&
    response.columns?.length === 1 && response.row_count === 1;

  return (
    <div
      className="rounded-2xl px-6 py-5 flex items-center justify-between gap-6 relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #0E1420 0%, #131927 100%)",
        border: "1px solid var(--divider2)",
        boxShadow: "0 0 40px rgba(99,102,241,0.08)",
      }}
    >
      {/* Subtle gradient glow in corner */}
      <div
        className="absolute top-0 right-0 w-64 h-full opacity-30 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at top right, rgba(99,102,241,0.25) 0%, transparent 70%)" }}
      />

      <div className="flex-1 min-w-0 relative">
        <p className="text-[10px] uppercase tracking-widest font-medium mb-1.5" style={{ color: "var(--text-tertiary)" }}>
          Analysis · Northwind Furniture
        </p>

        {loading && !response ? (
          <div className="space-y-2">
            <div className="skeleton h-5 w-72" />
            <div className="skeleton h-3 w-44 mt-1" style={{ opacity: 0.6 }} />
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white leading-tight truncate capitalize">
              {response?.metric_used
                ? response.metric_used.replace(/_/g, " ")
                : activeQuestion}
            </h2>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
              {response?.error
                ? "Error generating analysis"
                : response
                ? `${response.row_count ?? 0} row${response.row_count === 1 ? "" : "s"} · ${Math.round(response.total_time_ms ?? 0)}ms · just now`
                : activeQuestion}
            </p>
          </>
        )}
      </div>

      {/* Big KPI number */}
      {isSingleStat && !response!.error && (
        <div className="shrink-0 text-right relative">
          <p
            className="text-3xl font-bold leading-none"
            style={{ color: sentimentColor(response!.sentiment) }}
          >
            {primaryValue(response!)}
          </p>
          <p className="text-[10px] mt-1.5 uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
            {response!.columns[0].replace(/_/g, " ")}
          </p>
        </div>
      )}

      {/* Error badge */}
      {response?.error && (
        <div
          className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(248,113,113,0.12)", color: "#F87171", border: "1px solid rgba(248,113,113,0.25)" }}
        >
          {response.error.replace(/_/g, " ")}
        </div>
      )}
    </div>
  );
}
