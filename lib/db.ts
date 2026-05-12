import path from "path";
import * as duckdb from "@duckdb/node-api";

const DB_PATH = path.join(process.cwd(), "data", "northwind.db");
const MAX_ROWS = 100;

function sanitize(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    if (Object.keys(rec).length === 1 && "days" in rec && typeof rec.days === "number") {
      return new Date(rec.days * 86400 * 1000).toISOString().slice(0, 10);
    }
    if ("value" in rec && "scale" in rec && typeof rec.scale === "number") {
      return Number(typeof rec.value === "bigint" ? rec.value : rec.value) /
        Math.pow(10, rec.scale as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rec)) out[k] = sanitize(val);
    return out;
  }
  return v;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}

export async function executeSQL(sql: string, maxRows = MAX_ROWS): Promise<QueryResult> {
  const instance = await duckdb.DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const connection = await instance.connect();
  try {
    const result = await connection.run(sql);
    const chunks = await result.fetchAllChunks();
    const columns: string[] = result.columnNames();
    const allRows: unknown[][] = [];

    for (const chunk of chunks) {
      const nRows = chunk.rowCount;
      const colArrays = columns.map((_, c) =>
        chunk.getColumnValues(c).map((val) => sanitize(val))
      );
      for (let r = 0; r < nRows; r++) {
        allRows.push(colArrays.map((col) => col[r]));
      }
    }

    const truncated = allRows.length > maxRows;
    return { columns, rows: allRows.slice(0, maxRows), row_count: allRows.length, truncated };
  } finally {
    connection.closeSync();
  }
}
