import { NextRequest, NextResponse } from "next/server";
import { generateSQL, getTenantSchemaInfo, USE_RETRIEVAL, DEFAULT_TENANT } from "@/lib/sqlGenerator";
import { runWithValidation } from "@/lib/sqlValidator";
import { narrate } from "@/lib/narrator";
import { executeSQL } from "@/lib/db";
import { retrieveWithRanker, expansionEnabled } from "@/lib/retrieval/retriever";
import type { RetrieveResponse, BenchmarkRanker } from "@/lib/retrieval/retriever";

// Production retrieval mode (D-036/D-037): dense won H-tier in the benchmark
// (A 1.21, 64% SQL validity) and is the default; rrf/bm25 remain selectable
// via env for the benchmark harness and future comparison, never deleted.
const VALID_MODES: BenchmarkRanker[] = ["bm25", "dense", "rrf"];
const envMode = process.env.RETRIEVAL_MODE as BenchmarkRanker | undefined;
const RETRIEVAL_MODE: BenchmarkRanker = envMode && VALID_MODES.includes(envMode) ? envMode : "rrf";
// D-041: production default k=10 with table-expansion (Gate B). RETRIEVAL_K overrides; invalid values fall back to 10.
const envK = Number(process.env.RETRIEVAL_K);
const RETRIEVAL_K: number = Number.isInteger(envK) && envK > 0 && envK <= 50 ? envK : 10;
const envTimeout = Number(process.env.SQL_TIMEOUT_MS);
const SQL_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30_000; // D-042: bounds execution; the query itself is not cancelled on the cloud pool

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
    retrievalResp = await retrieveWithRanker(question, RETRIEVAL_K, DEFAULT_TENANT, RETRIEVAL_MODE); // table-expansion is on by default (RETRIEVAL_EXPAND_TABLES)
    retrievalTimeMs = Date.now() - t;
  } catch { /* retrieval failure non-fatal; falls back to full schema path */ }

  // Steps 1-2 (D-042): generate -> static validation -> EXPLAIN dry-run -> execute, with classified retry
  // (max 2; parser/binder errors only; refusals, out-of-scope, permission and timeouts are never retried).
  type Exec = Awaited<ReturnType<typeof executeSQL>>;
  let sqlGenTimeMs = 0;
  let execTimeMs = 0;
  let genException: string | null = null;
  let lastGen: Awaited<ReturnType<typeof generateSQL>> | null = null;
  const outcome = await runWithValidation<Exec>({
    info: getTenantSchemaInfo(DEFAULT_TENANT),
    generate: async (retry) => {
      const t = Date.now();
      try {
        const g = await generateSQL(question, retrievalResp.results, DEFAULT_TENANT, retry);
        const dt = Date.now() - t;
        sqlGenTimeMs += dt;
        lastGen = g;
        // A null sql is the model's refusal; surface it as REFUSE so it classifies as `refusal` and is not retried.
        return { sql: g.sql ?? `REFUSE: ${g.reasoning ?? "no SQL generated"}`, tokens_in: g.usage?.input_tokens ?? 0, tokens_out: g.usage?.output_tokens ?? 0, latency_ms: dt };
      } catch (err) {
        genException = err instanceof Error ? err.message : String(err);
        const dt = Date.now() - t;
        sqlGenTimeMs += dt;
        return { sql: "", tokens_in: 0, tokens_out: 0, latency_ms: dt, apiError: genException };
      }
    },
    explain: async (stmt) => { const t = Date.now(); try { await executeSQL(`EXPLAIN ${stmt}`); } finally { execTimeMs += Date.now() - t; } },
    execute: async (stmt) => {
      const t = Date.now();
      try {
        return await Promise.race([
          executeSQL(stmt),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`query timeout (${SQL_TIMEOUT_MS / 1000}s)`)), SQL_TIMEOUT_MS)),
        ]);
      } finally { execTimeMs += Date.now() - t; }
    },
  });
  const validation = {
    retry_count: outcome.retry_count,
    retry_outcome: outcome.retry_outcome,
    limit_added: outcome.limit_added,
    attempts: outcome.attempts.map((a) => ({ stage: a.stage, error_class: a.error_class, error_message: a.error_message, tokens_in: a.tokens_in, tokens_out: a.tokens_out, latency_ms: a.latency_ms })),
  };
  const retrievalInfo = {
    retrieval_time_ms: retrievalTimeMs,
    retrieved: retrievalResp.results,
    retrieval_confidence: retrievalResp.confidence,
    retrieval_mode: USE_RETRIEVAL ? "chunks" : "full_schema",
    retrieval_ranker: RETRIEVAL_MODE,
    retrieval_k: RETRIEVAL_K,
    retrieval_expand_tables: expansionEnabled(),
  };

  if (!outcome.ok) {
    const cls = outcome.final_error_class;
    if (genException && cls === "other") {
      return NextResponse.json({ question, error: "sql_generation_failed", detail: genException, validation, ...retrievalInfo }, { status: 500 });
    }
    if (cls === "refusal") {
      return NextResponse.json({
        question, sql: null, error: "no_sql_generated",
        detail: (outcome.final_error_message ?? "").replace(/^REFUSE:\s*/i, "") || "SQL generator returned no SQL",
        validation, ...retrievalInfo,
      }, { status: 500 });
    }
    return NextResponse.json({
      question, sql: outcome.finalSql,
      metric_used: (lastGen as Awaited<ReturnType<typeof generateSQL>> | null)?.metric_used ?? null,
      error: "sql_execution_failed", error_class: cls,
      detail: outcome.final_error_message, validation, ...retrievalInfo,
    }, { status: 500 });
  }
  const sqlResult = lastGen as unknown as Awaited<ReturnType<typeof generateSQL>>;
  const execResult = outcome.result as Exec;
  const finalSql = outcome.finalSql;

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
    }, DEFAULT_TENANT);
    narrateTimeMs = Date.now() - t;
    headline = n.headline;
    narrative = n.narrative;
  } catch { /* narrator failure is non-fatal */ }

  return NextResponse.json({
    question,
    sql: finalSql,
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
    total_time_ms: Date.now() - t_start,
    validation,
    ...retrievalInfo,
    error: null,
  });
}
