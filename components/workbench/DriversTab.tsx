"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { AskResponse } from "./Workbench";
import type { DriverDimension } from "@/lib/driversAgent";

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
  return "var(--accent-primary)";
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

function SkeletonCard() {
  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-3 animate-pulse"
      style={{ background: "var(--bg-surface)", borderColor: "var(--divider)" }}
    >
      <div className="h-3 w-32 rounded" style={{ background: "var(--divider)" }} />
      <div className="h-4 w-48 rounded" style={{ background: "var(--divider)" }} />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-2 items-center">
          <div className="h-3 w-20 rounded" style={{ background: "var(--divider)" }} />
          <div
            className="h-3 rounded flex-1"
            style={{ background: "var(--divider)", opacity: 1 - i * 0.15 }}
          />
        </div>
      ))}
    </div>
  );
}

function DimensionCard({
  dim,
  sentiment,
}: {
  dim: DriverDimension;
  sentiment: string | null | undefined;
}) {
  const barColor = sentimentColor(sentiment);
  const total = dim.data.reduce((s, d) => s + d.value, 0);

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "var(--bg-surface)", borderColor: "var(--divider)" }}
    >
      <p
        className="text-[10px] uppercase tracking-widest font-medium mb-1"
        style={{ color: "var(--text-tertiary)" }}
      >
        By {dim.dimension}
      </p>
      <p className="text-[13px] font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
        {dim.data.length} segments · total {fmt(total)}
      </p>

      <ResponsiveContainer width="100%" height={Math.max(160, dim.data.length * 32)}>
        <BarChart
          data={dim.data}
          layout="vertical"
          margin={{ top: 0, right: 48, left: 8, bottom: 0 }}
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
            width={130}
            tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--bg-accent)" }} />
          <Bar dataKey="share" radius={[0, 4, 4, 0]}>
            {dim.data.map((_, i) => (
              <Cell
                key={i}
                fill={barColor}
                opacity={1 - i * (0.55 / Math.max(dim.data.length - 1, 1))}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div
        className="mt-3 border-t pt-3 grid gap-1"
        style={{ borderColor: "var(--divider)" }}
      >
        {dim.data.slice(0, 8).map((d) => (
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

export default function DriversTab({ response }: Props) {
  const [drivers, setDrivers] = useState<DriverDimension[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrivers(null);
    setError(null);

    fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_sql: response.sql,
        metric_used: response.metric_used,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setDrivers(data.drivers ?? []);
      })
      .catch((err) => setError(err.message));
  }, [response.sql, response.metric_used]);

  if (error) {
    return (
      <div
        className="rounded-xl border p-5 text-[13px]"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--divider)",
          color: "var(--text-secondary)",
        }}
      >
        Could not load driver breakdowns: {error}
      </div>
    );
  }

  if (!drivers) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (drivers.length === 0) {
    return (
      <div
        className="rounded-xl border p-5 text-[13px]"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--divider)",
          color: "var(--text-secondary)",
        }}
      >
        No breakdown data available for this query.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {drivers.map((dim) => (
        <DimensionCard key={dim.dimension} dim={dim} sentiment={response.sentiment} />
      ))}
    </div>
  );
}
