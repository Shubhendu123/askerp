import { NextRequest, NextResponse } from "next/server";
import { generateSQL, USE_RETRIEVAL } from "@/lib/sqlGenerator";
import { narrate } from "@/lib/narrator";
import { executeSQL } from "@/lib/db";
import { retrieve } from "@/lib/retrieval/retriever";
import type { RetrieveResponse } from "@/lib/retrieval/retriever";

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

  // Step 0: Retrieval (always runs; chunks used by SQL generator only when USE_RETRIEVAL=true)
  let retrievalResp: RetrieveResponse = { results: [], confidence: { top1_absolute: 0, top1_minus_top2_gap: 0, top1_to_top5_avg_ratio: 0, confidence_band: "VERY_LOW" } };
  let retrievalTimeMs = 0;
  try {
    const t = Date.now();
    retrievalResp = await retrieve(question, 5);
    retrievalTimeMs = Date.now() - t;
  } catch { /* retrieval failure non-fatal; falls back to full schema path */ }

  // Step 1: Generate SQL
  let sqlResult: Awaited<ReturnType<typeof generateSQL>>;
  let sqlGenTimeMs = 0;
  try {
    const t = Date.now();
    sqlResult = await generateSQL(question, retrievalResp.results);
    sqlGenTimeMs = Date.now() - t;
  } catch (err) {
    return NextResponse.json({
      question, error: "sql_generation_failed",
      detail: err instanceof Error ? err.message : String(err),
      retrieval_time_ms: retrievalTimeMs,
      retrieved: retrievalResp.results,
      retrieval_confidence: retrievalResp.confidence,
      retrieval_mode: USE_RETRIEVAL ? "chunks" : "full_schema",
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
    retrieval_time_ms: retrievalTimeMs,
    total_time_ms: Date.now() - t_start,
    retrieved: retrievalResp.results,
    retrieval_confidence: retrievalResp.confidence,
    retrieval_mode: USE_RETRIEVAL ? "chunks" : "full_schema",
    error: null,
  });
}
