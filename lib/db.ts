import path from "path";
import * as duckdb from "@duckdb/node-api";
import { Pool, types as pgTypes } from "pg";

// Environment-switched DB access layer (D-037):
//   MOTHERDUCK_TOKEN set  -> cloud (MotherDuck via Postgres wire protocol, `pg`)
//   MOTHERDUCK_TOKEN unset -> local file (data/northwind.db via @duckdb/node-api)
// Callers only see executeSQL(sql) — the backend is invisible to them.
// Both backends host the same schemas (main = Northwind, mro_distributor = MRO),
// so schema-qualified SQL (mro_distributor.<table>) is identical on both paths —
// no query rewriting needed.

const DB_PATH = path.join(process.cwd(), "data", "northwind.db");
const MAX_ROWS = 100;
const MOTHERDUCK_DATABASE = "askerp"; // D-032

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}

// ── Local (DuckDB file) ──────────────────────────────────────────────────────

function sanitizeLocal(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(sanitizeLocal);
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
    for (const [k, val] of Object.entries(rec)) out[k] = sanitizeLocal(val);
    return out;
  }
  return v;
}

async function executeSQLLocal(sql: string, maxRows: number): Promise<QueryResult> {
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
        chunk.getColumnValues(c).map((val) => sanitizeLocal(val))
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

// ── Cloud (MotherDuck via Postgres wire protocol) ────────────────────────────
// Postgres wire protocol OIDs: 20=int8, 1700=numeric, 1082=date. `pg` returns
// int8/numeric as strings (precision-safety default) and parses date as a JS
// Date at UTC midnight. Normalize both to match the local path's sanitize()
// output shape: plain numbers, and 'YYYY-MM-DD' strings for dates.
pgTypes.setTypeParser(20, (v: string) => Number(v));
pgTypes.setTypeParser(1700, (v: string) => Number(v));
pgTypes.setTypeParser(1082, (v: string) => v); // wire format is already 'YYYY-MM-DD' text

let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      host: "pg.us-east-1-aws.motherduck.com",
      port: 5432,
      user: "postgres",
      password: process.env.MOTHERDUCK_TOKEN,
      database: MOTHERDUCK_DATABASE,
      ssl: { rejectUnauthorized: true }, // verify-full via Node's system CA store
      max: 3, // small pool: serverless-safe, reused across warm invocations of this instance
    });
  }
  return _pool;
}

async function executeSQLCloud(sql: string, maxRows: number): Promise<QueryResult> {
  const pool = getPool();
  const result = await pool.query(sql);
  const columns = result.fields.map((f) => f.name);
  const allRows = result.rows.map((row) => columns.map((c) => row[c]));
  const truncated = allRows.length > maxRows;
  return { columns, rows: allRows.slice(0, maxRows), row_count: allRows.length, truncated };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function executeSQL(sql: string, maxRows = MAX_ROWS): Promise<QueryResult> {
  return process.env.MOTHERDUCK_TOKEN
    ? executeSQLCloud(sql, maxRows)
    : executeSQLLocal(sql, maxRows);
}
