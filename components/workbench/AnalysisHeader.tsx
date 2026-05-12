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
  const firstRow = response.rows[0];
  if (!firstRow) return "—";
  const val = (firstRow as unknown[])[0];
  return formatNumber(val);
}

export default function AnalysisHeader({ response, loading, activeQuestion }: Props) {
  if (!activeQuestion && !loading) return null;

  const isSingleStat =
    response &&
    !response.error &&
    response.columns?.length === 1 &&
    response.row_count === 1;

  return (
    <div
      className="rounded-xl px-5 py-4 flex items-start justify-between gap-4"
      style={{ background: "var(--bg-header)" }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="text-[10px] uppercase tracking-[0.06em] mb-1"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          Analysis for
        </p>

        {loading && !response ? (
          <div className="space-y-2">
            <div
              className="h-5 w-64 rounded animate-pulse"
              style={{ background: "rgba(255,255,255,0.15)" }}
            />
            <div
              className="h-3.5 w-40 rounded animate-pulse"
              style={{ background: "rgba(255,255,255,0.1)" }}
            />
          </div>
        ) : (
          <>
            <h2
              className="text-base font-semibold text-white leading-tight truncate"
            >
              {response?.metric_used
                ? response.metric_used.replace(/_/g, " ")
                : activeQuestion}
            </h2>
            <p
              className="text-[11px] mt-0.5"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              {response?.error
                ? "Error generating analysis"
                : response
                ? `Generated just now · ${response.row_count ?? 0} row${response.row_count === 1 ? "" : "s"}`
                : activeQuestion}
            </p>
          </>
        )}
      </div>

      {/* Big number (right-aligned, single-stat only) */}
      {isSingleStat && !response.error && (
        <div className="shrink-0 text-right">
          <p
            className="text-2xl font-medium text-white leading-none"
          >
            {primaryValue(response)}
          </p>
          <p
            className="text-[10px] mt-1"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            {response.columns[0].replace(/_/g, " ")}
          </p>
        </div>
      )}

      {/* Error indicator */}
      {response?.error && (
        <div
          className="shrink-0 text-[11px] font-medium px-2 py-1 rounded"
          style={{
            background: "rgba(193,60,60,0.25)",
            color: "#F28080",
          }}
        >
          {response.error.replace(/_/g, " ")}
        </div>
      )}
    </div>
  );
}
