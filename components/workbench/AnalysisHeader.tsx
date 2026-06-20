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

export default function AnalysisHeader({ response, loading, activeQuestion }: Props) {
  if (!activeQuestion && !loading) return null;

  const isSingleStat =
    response && !response.error &&
    response.columns?.length === 1 && response.row_count === 1;

  return (
    <div
      className="flex items-center justify-between gap-6"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 24px",
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="label-caps mb-1.5">Analysis · Northwind Furniture</p>

        {loading && !response ? (
          <div className="space-y-2">
            <div className="skeleton h-5 w-72" />
            <div className="skeleton h-3 w-44 mt-1" style={{ opacity: 0.6 }} />
          </div>
        ) : (
          <>
            <h2
              className="leading-tight truncate capitalize"
              style={{ fontSize: 18, fontWeight: 500, color: "var(--text-primary)" }}
            >
              {response?.metric_used
                ? response.metric_used.replace(/_/g, " ")
                : activeQuestion}
            </h2>
            <p className="mt-1" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              {response?.error
                ? "Error generating analysis"
                : response
                ? `${response.row_count ?? 0} row${response.row_count === 1 ? "" : "s"} · ${Math.round(response.total_time_ms ?? 0)}ms · just now`
                : activeQuestion}
            </p>
          </>
        )}
      </div>

      {/* Big KPI number (single-stat results) */}
      {isSingleStat && !response!.error && (
        <div className="shrink-0 text-right">
          <p
            className="leading-none"
            style={{ fontSize: 30, fontWeight: 500, color: "var(--text-primary)" }}
          >
            {primaryValue(response!)}
          </p>
          <p className="mt-1.5 label-caps">{response!.columns[0].replace(/_/g, " ")}</p>
        </div>
      )}

      {/* Error badge */}
      {response?.error && (
        <div
          className="shrink-0 font-medium"
          style={{
            fontSize: 11,
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--sentiment-negative-bg)",
            color: "var(--sentiment-negative)",
            border: "1px solid var(--sentiment-negative)",
          }}
        >
          {response.error.replace(/_/g, " ")}
        </div>
      )}
    </div>
  );
}
