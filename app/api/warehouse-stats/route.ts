import { NextResponse } from "next/server";
import { executeSQL } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D-038 B3: this route previously hardcoded a direct local-file DuckDB
// connection to the "main" (Northwind) schema — broken in production
// (no bundled file there) and wrong-tenant even when it did run. Now goes
// through lib/db.ts's environment-switched executeSQL (same backend /api/ask
// uses) and branches by tenant.

const TENANT = process.env.ACTIVE_TENANT ?? "mro";

// table_count and date range are read live from the warehouse below;
// metric_count comes from data/metrics.yaml's per-tenant governed metrics
// (D-033: 26 for mro, 15 for northwind).
const TENANT_CONFIG =
  TENANT === "mro"
    ? { schema: "mro_distributor.", metricCount: 26, customerTable: "dim_customer", orderTable: "o2c_sales_order_line" }
    : { schema: "", metricCount: 15, customerTable: "dim_customer", orderTable: "fact_sales_order" };

export interface WarehouseStats {
  customer_count: number;
  order_count: number;
  table_count: number;
  metric_count: number;
  date_range: { start: string; end: string };
  last_refreshed: string;
  schema_type: string;
}

interface CacheEntry {
  data: WarehouseStats;
  expires: number;
}

// These numbers don't change between requests — cache in-memory for 60s.
let cache: CacheEntry | null = null;

function toYearMonth(v: unknown): string {
  if (typeof v === "string") return v.slice(0, 7);
  return "—";
}

async function scalar(sql: string): Promise<unknown> {
  const result = await executeSQL(sql, 1);
  return result.rows[0]?.[0] ?? null;
}

async function computeStats(): Promise<WarehouseStats> {
  const { schema, metricCount, customerTable, orderTable } = TENANT_CONFIG;
  const tableSchemaName = schema ? schema.replace(".", "") : "main";

  const customerCount = Number(await scalar(`SELECT COUNT(*) FROM ${schema}${customerTable}`));
  const orderCount = Number(await scalar(`SELECT COUNT(*) FROM ${schema}${orderTable}`));
  const tableCount = Number(
    await scalar(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${tableSchemaName}'`
    )
  );
  // Data horizon (max date actually loaded), NOT wall-clock today — showing
  // "today" would imply live data this warehouse doesn't have (D-038 B3).
  const dateRow = await executeSQL(`SELECT MIN(full_date), MAX(full_date) FROM ${schema}dim_date`, 1);
  const [minDate, maxDate] = dateRow.rows[0] ?? [null, null];

  return {
    customer_count: customerCount,
    order_count: orderCount,
    table_count: tableCount,
    metric_count: metricCount,
    date_range: { start: toYearMonth(minDate), end: toYearMonth(maxDate) },
    last_refreshed: typeof maxDate === "string" ? maxDate : "—",
    schema_type: "star schema · NetSuite-shaped",
  };
}

export async function GET() {
  try {
    if (cache && cache.expires > Date.now()) {
      return NextResponse.json(cache.data);
    }
    const data = await computeStats();
    cache = { data, expires: Date.now() + 60_000 };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: "data_source_unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503 }
    );
  }
}
