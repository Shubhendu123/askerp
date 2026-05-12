import { NextRequest, NextResponse } from "next/server";
import path from "path";
import * as duckdb from "@duckdb/node-api";
import { generateSQL } from "@/lib/sqlGenerator";
import { narrate } from "@/lib/narrator";

const DB_PATH = path.join(process.cwd(), "data", "northwind.db");
const MAX_ROWS = 100;

// ── DuckDB value sanitizer ─────────────────────────────────────────────────────
function sanitize(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    // DuckDB DATE: {days: N} — days since 1970-01-01
    if (Object.keys(rec).length === 1 && "days" in rec && typeof rec.days === "number") {
      return new Date(rec.days * 86400 * 1000).toISOString().slice(0, 10);
    }
    // DuckDB DECIMAL: {value: BigInt, scale: number}
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

// ── DuckDB execution ───────────────────────────────────────────────────────────
async function executeSQL(sql: string) {
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

    const truncated = allRows.length > MAX_ROWS;
    return { columns, rows: allRows.slice(0, MAX_ROWS), row_count: allRows.length, truncated };
  } finally {
    connection.closeSync();
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const t_start = Date.now();

  let question: string;
  try {
    const body = await req.json();
    question = (body.question ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Step 1: Generate SQL
  let sqlResult: Awaited<ReturnType<typeof generateSQL>>;
  let sqlGenTimeMs = 0;
  try {
    const t = Date.now();
    sqlResult = await generateSQL(question);
    sqlGenTimeMs = Date.now() - t;
  } catch (err) {
    return NextResponse.json({
      question, error: "sql_generation_failed",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }

  if (!sqlResult.sql) {
    return NextResponse.json({
      question, sql: null, error: "no_sql_generated",
      detail: sqlResult.reasoning ?? "SQL generator returned no SQL",
    }, { status: 500 });
  }

  // Step 2: Execute SQL
  let execResult: Awaited<ReturnType<typeof executeSQL>>;
  let execTimeMs = 0;
  try {
    const t = Date.now();
    execResult = await executeSQL(sqlResult.sql);
    execTimeMs = Date.now() - t;
  } catch (err) {
    return NextResponse.json({
      question, sql: sqlResult.sql,
      metric_used: sqlResult.metric_used ?? null,
      error: "sql_execution_failed",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }

  // Step 3: Narrate (non-fatal)
  let headline = "";
  let narrative = "";
  let narrateTimeMs = 0;
  try {
    const t = Date.now();
    const n = await narrate({
      question,
      metric_used: sqlResult.metric_used ?? null,
      sentiment: sqlResult.sentiment ?? null,
      columns: execResult.columns,
      rows: execResult.rows,
      row_count: execResult.row_count,
      truncated: execResult.truncated,
    });
    narrateTimeMs = Date.now() - t;
    headline = n.headline;
    narrative = n.narrative;
  } catch { /* narrator failure is non-fatal */ }

  return NextResponse.json({
    question,
    sql: sqlResult.sql,
    metric_used: sqlResult.metric_used ?? null,
    sentiment: sqlResult.sentiment ?? null,
    tables_referenced: sqlResult.tables_referenced ?? [],
    reasoning: sqlResult.reasoning ?? null,
    headline,
    narrative,
    columns: execResult.columns,
    rows: execResult.rows,
    row_count: execResult.row_count,
    truncated: execResult.truncated,
    sql_gen_time_ms: sqlGenTimeMs,
    execution_time_ms: execTimeMs,
    narrate_time_ms: narrateTimeMs,
    retrieval_time_ms: 0,
    total_time_ms: Date.now() - t_start,
    retrieved: [],
    error: null,
  });
}
