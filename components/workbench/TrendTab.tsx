"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { prepTrend } from "@/lib/chartUtils";
import type { AskResponse } from "./Workbench";

interface Props {
  response: AskResponse;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  if (v > 0 && v < 1) return `${(v * 100).toFixed(1)}%`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function sentimentColor(s: string | null | undefined) {
  if (s === "positive") return "var(--sentiment-positive)";
  if (s === "negative") return "var(--sentiment-negative)";
  return "var(--accent-primary)";
}

// Use bars for discrete periods (year/quarter/month), line for date series
function isDateSeries(colName: string): boolean {
  return colName.toLowerCase().includes("date");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-[12px] shadow-sm"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--divider)",
        color: "var(--text-primary)",
      }}
    >
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name.replace(/_/g, " ")}: {fmt(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function TrendTab({ response }: Props) {
  const data = prepTrend(response.columns, response.rows);
  if (!data.length) return null;

  const color = sentimentColor(response.sentiment);
  const useLine = isDateSeries(data[0]?.colName ?? "");
  const colLabel = data[0]?.colName.replace(/_/g, " ") ?? "value";

  // Determine y-axis tick format
  const maxVal = Math.max(...data.map((d) => d.value));
  const yFmt = (v: number) => {
    if (maxVal >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`;
    if (maxVal >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    if (maxVal < 1) return `${(v * 100).toFixed(0)}%`;
    return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "var(--bg-surface)", borderColor: "var(--divider)" }}
    >
      <div className="mb-4">
        <p
          className="text-[10px] uppercase tracking-widest font-medium mb-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          Trend over time
        </p>
        <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {colLabel} · {data.length} periods
        </p>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--divider)"
            vertical={false}
          />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={yFmt}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--bg-accent)" }} />
          {useLine ? (
            <Line
              type="monotone"
              dataKey="value"
              name={colLabel}
              stroke={color}
              strokeWidth={2.5}
              dot={{ fill: color, r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          ) : (
            <Bar
              dataKey="value"
              name={colLabel}
              fill={color}
              radius={[4, 4, 0, 0]}
              opacity={0.85}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Min / Max / Avg summary */}
      {data.length >= 3 && (() => {
        const vals = data.map((d) => d.value);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const minPeriod = data[vals.indexOf(min)].period;
        const maxPeriod = data[vals.indexOf(max)].period;
        return (
          <div
            className="mt-4 border-t pt-3 flex gap-6 text-[11px]"
            style={{ borderColor: "var(--divider)" }}
          >
            <div>
              <p style={{ color: "var(--text-tertiary)" }}>Peak</p>
              <p className="font-medium" style={{ color: "var(--sentiment-positive)" }}>
                {fmt(max)} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>({maxPeriod})</span>
              </p>
            </div>
            <div>
              <p style={{ color: "var(--text-tertiary)" }}>Low</p>
              <p className="font-medium" style={{ color: "var(--sentiment-negative)" }}>
                {fmt(min)} <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>({minPeriod})</span>
              </p>
            </div>
            <div>
              <p style={{ color: "var(--text-tertiary)" }}>Average</p>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                {fmt(avg)}
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
