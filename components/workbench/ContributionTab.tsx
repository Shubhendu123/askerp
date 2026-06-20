"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { prepContribution } from "@/lib/chartUtils";
import type { AskResponse } from "./Workbench";

interface Props {
  response: AskResponse;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function sentimentColor(s: string | null | undefined) {
  if (s === "positive") return "var(--sentiment-positive)";
  if (s === "negative") return "var(--sentiment-negative)";
  return "var(--accent)";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-[12px] shadow-sm"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--divider)",
        color: "var(--text-primary)",
      }}
    >
      <p className="font-medium">{d.label}</p>
      <p style={{ color: "var(--text-secondary)" }}>
        {fmt(d.value)} · {d.share.toFixed(1)}%
      </p>
    </div>
  );
}

export default function ContributionTab({ response }: Props) {
  const data = prepContribution(response.columns, response.rows);
  if (!data.length) return null;

  const barColor = sentimentColor(response.sentiment);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div
      className="p-5"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="label-caps mb-1">Contribution breakdown</p>
          <p className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            {data.length} segments · total {fmt(total)}
          </p>
        </div>
      </div>

      {/* Recharts horizontal bar */}
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 60, left: 8, bottom: 0 }}
          barCategoryGap="25%"
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={160}
            tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--bg-subtle)" }} />
          <Bar dataKey="share" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={barColor}
                opacity={1 - i * (0.55 / Math.max(data.length - 1, 1))}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend table */}
      <div
        className="mt-4 pt-3 grid gap-1"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        {data.slice(0, 10).map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-[11px]">
            <span className="truncate flex-1" style={{ color: "var(--text-secondary)" }}>
              {d.label}
            </span>
            <span className="font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
              {fmt(d.value)}
            </span>
            <span className="w-12 text-right tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              {d.share.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
