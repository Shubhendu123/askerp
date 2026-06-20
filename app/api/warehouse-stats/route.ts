import path from "path";
import fs from "fs";
import * as duckdb from "@duckdb/node-api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_PATH = path.join(process.cwd(), "data", "northwind.db");

// metric_count comes from data/metrics.yaml (15 governed metrics).
// table_count is read live from the warehouse below.
const METRIC_COUNT = 15;

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

/** DuckDB returns DATE columns as { days } from the epoch — format as YYYY-MM. */
function dateToYearMonth(v: unknown): string {
  if (v && typeof v === "object" && "days" in (v as Record<string, unknown>)) {
    const days = (v as { days: number }).days;
    return new Date(days * 86400 * 1000).toISOString().slice(0, 7);
  }
  if (typeof v === "string") return v.slice(0, 7);
  return "—";
}

async function scalar(connection: duckdb.DuckDBConnection, sql: string): Promise<unknown> {
  const result = await connection.run(sql);
  const chunks = await result.fetchAllChunks();
  return chunks[0]?.getColumnValues(0)?.[0] ?? null;
}

async function row(connection: duckdb.DuckDBConnection, sql: string): Promise<unknown[]> {
  const result = await connection.run(sql);
  const chunks = await result.fetchAllChunks();
  const cols = result.columnNames();
  return cols.map((_, i) => chunks[0]?.getColumnValues(i)?.[0] ?? null);
}

async function computeStats(): Promise<WarehouseStats> {
  const instance = await duckdb.DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();
  try {
    const customerCount = Number(await scalar(connection, "SELECT COUNT(*) FROM dim_customer"));
    const orderCount = Number(await scalar(connection, "SELECT COUNT(*) FROM fact_sales_order"));
    const tableCount = Number(
      await scalar(
        connection,
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'main'"
      )
    );
    const [minDate, maxDate] = await row(
      connection,
      "SELECT MIN(date), MAX(date) FROM dim_date"
    );

    let lastRefreshed: string;
    try {
      lastRefreshed = fs.statSync(DB_PATH).mtime.toISOString().slice(0, 10);
    } catch {
      lastRefreshed = new Date().toISOString().slice(0, 10);
    }

    return {
      customer_count: customerCount,
      order_count: orderCount,
      table_count: tableCount,
      metric_count: METRIC_COUNT,
      date_range: { start: dateToYearMonth(minDate), end: dateToYearMonth(maxDate) },
      last_refreshed: lastRefreshed,
      schema_type: "star schema · NetSuite-shaped",
    };
  } finally {
    connection.closeSync();
  }
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
