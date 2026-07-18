"use client";

import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import type { WarehouseStats } from "@/app/api/warehouse-stats/route";
import { getTenantConfig, type TenantConfig } from "@/lib/tenants";

type State =
  | { status: "loading" }
  | { status: "ready"; data: WarehouseStats }
  | { status: "error" };

function fmt(n: number): string {
  return n.toLocaleString();
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p
        className="leading-none truncate"
        style={{ fontSize: 19, fontWeight: 500, color: "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate" style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
        {label}
      </p>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div>
      <div className="skeleton" style={{ height: 19, width: "70%" }} />
      <div className="skeleton mt-2" style={{ height: 9, width: "55%", opacity: 0.6 }} />
    </div>
  );
}

interface Props {
  tenant?: TenantConfig;
}

export default function DataOverviewCard({ tenant = getTenantConfig("mro") }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    fetch("/api/warehouse-stats")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: WarehouseStats) => {
        if (alive) setState({ status: "ready", data });
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const data = state.status === "ready" ? state.data : null;
  const startYear = data?.date_range.start.slice(0, 4);
  const endYear = data?.date_range.end.slice(0, 4);

  return (
    <div
      className="rounded-xl"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
      }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-4">
        <Database size={16} strokeWidth={2} style={{ color: "var(--accent)" }} />
        <p
          className="font-medium leading-none flex-1"
          style={{ fontSize: 13, color: "var(--text-primary)" }}
        >
          {tenant.warehouseLabel}
        </p>
        {state.status === "error" ? (
          <span
            className="leading-none rounded-full"
            style={{
              fontSize: 10,
              padding: "3px 8px",
              background: "var(--sentiment-negative-bg)",
              color: "var(--sentiment-negative)",
            }}
          >
            Unavailable
          </span>
        ) : (
          <span
            className="flex items-center gap-1 leading-none rounded-full"
            style={{
              fontSize: 10,
              padding: "3px 8px",
              background: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            <span
              className="rounded-full"
              style={{ width: 5, height: 5, background: "var(--accent)" }}
            />
            Connected
          </span>
        )}
      </div>

      {state.status === "error" ? (
        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Data source unavailable. The warehouse overview will appear once the connection is
          restored.
        </p>
      ) : (
        <>
          {/* 4-column stat grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {state.status === "loading" || !data ? (
              <>
                <StatSkeleton />
                <StatSkeleton />
                <StatSkeleton />
                <StatSkeleton />
              </>
            ) : (
              <>
                <Stat value={fmt(data.customer_count)} label="Customers" />
                <Stat value={fmt(data.order_count)} label="Orders" />
                <Stat value={`${data.table_count} · ${data.metric_count}`} label="Tables · metrics" />
                <Stat value={`${startYear}–${endYear}`} label="Years covered" />
              </>
            )}
          </div>

          {/* Footer line */}
          <div
            className="mt-4 pt-3"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              {data
                ? `Data as of ${data.last_refreshed} · ${data.schema_type}`
                : "Loading warehouse metadata…"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
