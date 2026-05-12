"use client";

import { useState } from "react";
import type { AskResponse } from "./Workbench";

interface Props {
  response: AskResponse | null;
  loading: boolean;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sentimentColor(sentiment: string | null | undefined): string {
  if (sentiment === "positive") return "var(--sentiment-positive)";
  if (sentiment === "negative") return "var(--sentiment-negative)";
  return "var(--sentiment-neutral)";
}

function sentimentLabel(sentiment: string | null | undefined): string {
  if (sentiment === "positive") return "Favorable";
  if (sentiment === "negative") return "Unfavorable";
  return "Neutral";
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    if (v > 0 && v < 1) return `${(v * 100).toFixed(1)}%`;
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return String(v);
}

function primaryValue(response: AskResponse): string {
  if (!response.rows?.length || !response.columns?.length) return "—";
  const val = (response.rows[0] as unknown[])[0];
  return formatCell(val);
}

// ── Insight dot item ──────────────────────────────────────────────────────────
function InsightItem({
  dotColor,
  boldText,
  boldColor,
  rest,
}: {
  dotColor: string;
  boldText: string;
  boldColor: string;
  rest: string;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span
        className="mt-1 shrink-0 rounded-full"
        style={{ width: 6, height: 6, background: dotColor }}
      />
      <p className="text-[12px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        <span className="font-semibold" style={{ color: boldColor }}>
          {boldText}
        </span>{" "}
        {rest}
      </p>
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex gap-2 py-1">
      <div
        className="h-3 rounded animate-pulse flex-1"
        style={{ background: "var(--bg-accent)" }}
      />
      <div
        className="h-3 rounded animate-pulse w-16"
        style={{ background: "var(--bg-accent)" }}
      />
    </div>
  );
}

// ── Data table ────────────────────────────────────────────────────────────────
function DataTable({
  columns,
  rows,
  row_count,
  truncated,
}: {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}) {
  const visible = rows.slice(0, 10);
  const isNumeric = (col: number) =>
    rows.some((r) => typeof (r as unknown[])[col] === "number");

  return (
    <div className="rounded overflow-hidden border" style={{ borderColor: "var(--divider)" }}>
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr style={{ background: "var(--bg-accent)" }}>
            {columns.map((col) => (
              <th
                key={col}
                className="px-3 py-2 text-left font-semibold uppercase text-[10px] tracking-wider whitespace-nowrap"
                style={{ color: "var(--text-tertiary)" }}
              >
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => (
            <tr
              key={ri}
              style={{
                borderTop: "1px solid var(--divider)",
                background: ri % 2 === 1 ? "var(--bg-page)" : "var(--bg-surface)",
              }}
            >
              {(row as unknown[]).map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5 whitespace-nowrap"
                  style={{
                    color: "var(--text-primary)",
                    textAlign: isNumeric(ci) ? "right" : "left",
                  }}
                >
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className="px-3 py-1.5 text-[10px] border-t"
        style={{
          borderColor: "var(--divider)",
          color: "var(--text-tertiary)",
          background: "var(--bg-surface)",
        }}
      >
        Showing {visible.length} of {row_count} rows
        {truncated && " — truncated at 100"}
      </div>
    </div>
  );
}

// ── Single stat display ───────────────────────────────────────────────────────
function StatDisplay({
  value,
  label,
  sentiment,
}: {
  value: string;
  label: string;
  sentiment: string | null | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <p
        className="text-5xl font-semibold"
        style={{ color: sentimentColor(sentiment) }}
      >
        {value}
      </p>
      <p className="mt-2 text-[12px]" style={{ color: "var(--text-tertiary)" }}>
        {label.replace(/_/g, " ")}
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChangeTab({ response, loading }: Props) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [retrievalOpen, setRetrievalOpen] = useState(false);

  const isSingleStat =
    response &&
    !response.error &&
    response.columns?.length === 1 &&
    response.row_count === 1;

  const isTable =
    response &&
    !response.error &&
    response.columns?.length > 0 &&
    response.row_count > 0 &&
    !isSingleStat;

  return (
    <div className="space-y-3">
      {/* Main card */}
      <div
        className="rounded-xl border p-4"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--divider)",
        }}
      >
        {/* Two-column grid: insights (240px) + data */}
        <div className="grid gap-4" style={{ gridTemplateColumns: "240px 1fr" }}>
          {/* ── Insights column ── */}
          <div
            className="border-r pr-4 space-y-0"
            style={{ borderColor: "var(--divider)" }}
          >
            <p
              className="text-[10px] uppercase tracking-widest font-medium mb-3"
              style={{ color: "var(--text-tertiary)" }}
            >
              Insights
            </p>

            {loading && !response && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-2">
                    <div
                      className="w-2 h-2 mt-1 rounded-full shrink-0 animate-pulse"
                      style={{ background: "var(--divider)" }}
                    />
                    <div className="space-y-1 flex-1">
                      <div
                        className="h-3 rounded animate-pulse"
                        style={{ background: "var(--bg-accent)" }}
                      />
                      <div
                        className="h-3 rounded animate-pulse w-3/4"
                        style={{ background: "var(--bg-accent)" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {response?.error && (
              <InsightItem
                dotColor="var(--sentiment-negative)"
                boldText={response.error.replace(/_/g, " ")}
                boldColor="var(--sentiment-negative)"
                rest={response.detail ?? ""}
              />
            )}

            {response && !response.error && (
              <>
                <InsightItem
                  dotColor={sentimentColor(response.sentiment)}
                  boldText={primaryValue(response)}
                  boldColor={sentimentColor(response.sentiment)}
                  rest={`in ${(response.metric_used ?? response.columns?.[0] ?? "result").replace(/_/g, " ")}`}
                />
                <InsightItem
                  dotColor="var(--text-tertiary)"
                  boldText={`Metric: ${response.metric_used ?? "—"}`}
                  boldColor="var(--text-secondary)"
                  rest=""
                />
                <InsightItem
                  dotColor="var(--text-tertiary)"
                  boldText=""
                  boldColor="var(--text-secondary)"
                  rest={`${response.row_count} row${response.row_count === 1 ? "" : "s"} · ${Math.round(response.total_time_ms ?? 0)}ms`}
                />
              </>
            )}
          </div>

          {/* ── Data column ── */}
          <div>
            {/* Sentiment + badge row */}
            {response && !response.error && (
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="text-[10px] font-medium px-2.5 py-0.5 rounded-full"
                  style={{
                    background: `${sentimentColor(response.sentiment)}22`,
                    color: sentimentColor(response.sentiment),
                  }}
                >
                  {sentimentLabel(response.sentiment)}
                </span>
                <button
                  onClick={() => setSqlOpen((v) => !v)}
                  className="text-[10px] px-2.5 py-0.5 rounded-full border transition-colors"
                  style={{
                    borderColor: "var(--divider)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {sqlOpen ? "Hide SQL" : "Show SQL"}
                </button>
                <button
                  onClick={() => setRetrievalOpen((v) => !v)}
                  className="text-[10px] px-2.5 py-0.5 rounded-full border transition-colors"
                  style={{
                    borderColor: "var(--divider)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {retrievalOpen ? "Hide Retrieval" : "Retrieval"}
                </button>
              </div>
            )}

            {/* Skeleton */}
            {loading && !response && (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <SkeletonRow key={i} />
                ))}
              </div>
            )}

            {/* Single stat */}
            {isSingleStat && (
              <StatDisplay
                value={primaryValue(response!)}
                label={response!.columns[0]}
                sentiment={response!.sentiment}
              />
            )}

            {/* Table */}
            {isTable && (
              <DataTable
                columns={response!.columns}
                rows={response!.rows}
                row_count={response!.row_count}
                truncated={response!.truncated}
              />
            )}

            {/* Error SQL */}
            {response?.error && response.sql && (
              <pre
                className="text-[11px] p-3 rounded overflow-x-auto mt-2"
                style={{
                  background: "var(--bg-accent)",
                  color: "var(--text-secondary)",
                }}
              >
                {response.sql}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Expandable: SQL */}
      {sqlOpen && response?.sql && (
        <div
          className="rounded-xl border p-4"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--divider)",
          }}
        >
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            Generated SQL
          </p>
          <pre
            className="text-[12px] rounded p-3 overflow-x-auto leading-relaxed"
            style={{
              background: "var(--bg-accent)",
              color: "var(--text-primary)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {response.sql}
          </pre>
          <p
            className="mt-2 text-[10px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Retrieval {Math.round(response.retrieval_time_ms ?? 0)}ms ·
            SQL gen {Math.round(response.sql_gen_time_ms ?? 0)}ms ·
            Exec {Math.round(response.execution_time_ms ?? 0)}ms ·
            Total {Math.round(response.total_time_ms ?? 0)}ms
          </p>
        </div>
      )}

      {/* Expandable: Retrieval */}
      {retrievalOpen && Array.isArray(response?.retrieved) && (
        <div
          className="rounded-xl border p-4"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--divider)",
          }}
        >
          <p
            className="text-[10px] uppercase tracking-widest font-medium mb-3"
            style={{ color: "var(--text-tertiary)" }}
          >
            Top retrievals
          </p>
          <div className="space-y-2">
            {(response!.retrieved as Array<{
              id: string;
              type: string;
              name: string;
              score: number;
              text: string;
            }>).slice(0, 5).map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-3 rounded p-2"
                style={{ background: "var(--bg-page)" }}
              >
                <span
                  className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                  style={{
                    background:
                      r.type === "metric"
                        ? "var(--accent-primary)"
                        : "var(--sentiment-neutral)",
                    color: "#fff",
                  }}
                >
                  {r.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[11px] font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {r.name.replace(/_/g, " ")}
                    <span
                      className="ml-2 text-[10px] font-normal"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      score {r.score.toFixed(4)}
                    </span>
                  </p>
                  <p
                    className="text-[10px] truncate mt-0.5"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {r.text.slice(0, 120)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
