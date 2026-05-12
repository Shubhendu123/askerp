import { NextRequest, NextResponse } from "next/server";
import { generateSQL } from "@/lib/sqlGenerator";
import { narrate } from "@/lib/narrator";
import { executeSQL } from "@/lib/db";

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
