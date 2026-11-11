import { SCOPE_CHECK_TENANTS, checkScope, dropFlaggedSentences } from "@/lib/scopeCheck";
import { NextRequest, NextResponse } from "next/server";
import { generateSQL, getTenantSchemaInfo, USE_RETRIEVAL, DEFAULT_TENANT } from "@/lib/sqlGenerator";
import { runWithValidation } from "@/lib/sqlValidator";
import { narrate, toNarratorDocs, citesAny } from "@/lib/narrator";
import { enrichDocuments } from "@/lib/retrieval/retriever";
import { executeSQL } from "@/lib/db";
import { retrieveWithRanker, expansionEnabled } from "@/lib/retrieval/retriever";
import { recordTrace, type TraceData } from "@/lib/tracing";
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
// D-043: tracing wrapper. The handler fills `tc` as it goes; the trace is written AFTER the response
// exists, fire-and-forget (lib/tracing.ts swallows every error). Failures are traced too.
export async function POST(req: NextRequest) {
  const t_start = Date.now();
  const tc: Partial<TraceData> & { question?: string } = {};
  try {
    const res = await handle(req, t_start, tc);
    if (tc.question) {
      if (res.status >= 400 && tc.success === undefined) tc.success = false;
      tc.total_ms = Date.now() - t_start;
      recordTrace(finalizeTrace(tc));
    }
    return res;
  } catch (err) {
    if (tc.question) {
      tc.success = false; tc.error_type = tc.error_type ?? "other";
      tc.error_message = tc.error_message ?? (err instanceof Error ? err.message : String(err));
      tc.total_ms = Date.now() - t_start;
      recordTrace(finalizeTrace(tc));
    }
    throw err;
  }
}

function finalizeTrace(tc: Partial<TraceData> & { question?: string }): TraceData {
  return {
    tenant: DEFAULT_TENANT, question: tc.question ?? "",
    retrieval_mode: tc.retrieval_mode ?? RETRIEVAL_MODE, retrieval_k: tc.retrieval_k ?? RETRIEVAL_K, expand_tables: tc.expand_tables ?? expansionEnabled(),
    chunk_ids: tc.chunk_ids ?? [], retrieval_ms: tc.retrieval_ms ?? 0,
    sql_generated: tc.sql_generated ?? null, tokens_in: tc.tokens_in ?? 0, tokens_out: tc.tokens_out ?? 0, sqlgen_ms: tc.sqlgen_ms ?? 0,
    validation_passed: tc.validation_passed ?? false, limit_added: tc.limit_added ?? false, retry_count: tc.retry_count ?? 0,
    error_type: tc.error_type ?? null, error_message: tc.error_message ?? null,
    rows_returned: tc.rows_returned ?? null, exec_ms: tc.exec_ms ?? 0,
    narration_tokens_in: tc.narration_tokens_in ?? 0, narration_tokens_out: tc.narration_tokens_out ?? 0, narrate_ms: tc.narrate_ms ?? 0,
    total_ms: tc.total_ms ?? 0, success: tc.success ?? false,
  };
}

async function handle(req: NextRequest, t_start: number, tc: Partial<TraceData> & { question?: string }): Promise<NextResponse> {

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
  tc.question = question;

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
  tc.retrieval_mode = RETRIEVAL_MODE; tc.retrieval_k = RETRIEVAL_K; tc.expand_tables = expansionEnabled();
  tc.chunk_ids = retrievalResp.results.map((r) => (r as { id?: string; chunk_id?: string }).id ?? (r as { chunk_id?: string }).chunk_id ?? "");
  tc.retrieval_ms = retrievalTimeMs; tc.sqlgen_ms = sqlGenTimeMs; tc.exec_ms = execTimeMs;
  tc.sql_generated = outcome.finalSql || null;
  tc.tokens_in = outcome.attempts.reduce((a, x) => a + (x.tokens_in ?? 0), 0);
  tc.tokens_out = outcome.attempts.reduce((a, x) => a + (x.tokens_out ?? 0), 0);
  tc.retry_count = outcome.retry_count; tc.limit_added = outcome.limit_added; tc.validation_passed = outcome.ok;
  if (!outcome.ok) { tc.success = false; tc.error_type = outcome.final_error_class ?? "other"; tc.error_message = outcome.final_error_message ?? null; }
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
    // D-048 NO_SQL: the retrieved documents fully answer the question. Only valid when the narration cites a retrieved document.
    const gen0 = lastGen as Awaited<ReturnType<typeof generateSQL>> | null;
    const docs0 = toNarratorDocs(retrievalResp.results);
    if (cls === "refusal" && (gen0?.answer_from_documents || docs0.some((d) => d.doc_type !== "policy")) && docs0.length > 0) { // flag, or a refusal while governed documents are in context: the narration must still cite one
      try {
        const nn = await narrate({ question, metric_used: null, sentiment: gen0?.sentiment ?? null, columns: [], rows: [], row_count: 0, truncated: false, policies: docs0, noSql: true }, DEFAULT_TENANT);
        if (citesAny(nn.narrative + " " + nn.headline, docs0)) {
          return NextResponse.json({ question, sql: null, no_sql: true, headline: nn.headline, narrative: nn.narrative, columns: [], rows: [], row_count: 0,
            reasoning: gen0?.reasoning ?? null, validation, ...retrievalInfo, error: null });
        }
      } catch { /* fall through to refusal */ }
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

  // Step 2b (D-048): post-SQL enrichment - documents linked to the result rows (event_key / client / counterparty), cap 3
  let enriched: Awaited<ReturnType<typeof enrichDocuments>> = [];
  try { enriched = await enrichDocuments(question, execResult.columns, execResult.rows as unknown[][], DEFAULT_TENANT, retrievalResp.results.map((r) => r.id)); } catch { /* non-fatal */ }

  // Step 3: Narrate (non-fatal)
  let headline = "";
  let narrative = "";
  let narrateTimeMs = 0;
  let scopeInfo: { first_violations: string[]; regenerated: boolean; dropped: string[] } | null = null;
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
      sql: finalSql,
      policies: [...toNarratorDocs(retrievalResp.results), ...toNarratorDocs(enriched)],
    }, DEFAULT_TENANT);
    headline = n.headline;
    narrative = n.narrative;
    let tin = n.usage?.input_tokens ?? 0, tout = n.usage?.output_tokens ?? 0;
    // D-049 scope check (harborline only): narrate -> check -> regenerate ONCE without policy chunks -> check -> drop the flagged sentences
    if (SCOPE_CHECK_TENANTS.has(DEFAULT_TENANT)) {
      const first = checkScope(`${headline} ${narrative}`, finalSql);
      if (!first.ok) {
        scopeInfo = { first_violations: [...(first.windowBad ? ["window: " + first.windowClaims.join(", ")] : []), ...first.scopeViol], regenerated: true, dropped: [] };
        try {
          const n2 = await narrate({
            question, metric_used: sqlResult.metric_used ?? null, sentiment: sqlResult.sentiment ?? null, columns: execResult.columns, rows: execResult.rows,
            row_count: execResult.row_count, truncated: execResult.truncated, sql: finalSql, policies: [], // no policy chunks
          }, DEFAULT_TENANT);
          tin += n2.usage?.input_tokens ?? 0; tout += n2.usage?.output_tokens ?? 0;
          headline = n2.headline; narrative = n2.narrative;
        } catch { /* keep the first narration; the drop step below still applies */ }
        if (!checkScope(`${headline} ${narrative}`, finalSql).ok) {
          const nd = dropFlaggedSentences(narrative, finalSql), hd = dropFlaggedSentences(headline, finalSql);
          narrative = nd.text; scopeInfo.dropped = [...nd.dropped, ...hd.dropped];
          if (hd.dropped.length) headline = hd.text || (nd.text.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 90);
        }
      }
    }
    narrateTimeMs = Date.now() - t;
    tc.narration_tokens_in = tin; tc.narration_tokens_out = tout;
  } catch { /* narrator failure is non-fatal */ }
  tc.narrate_ms = narrateTimeMs; tc.rows_returned = execResult.row_count; tc.success = true;

  return NextResponse.json({
    question,
    sql: finalSql,
    metric_used: sqlResult.metric_used ?? null,
    sentiment: sqlResult.sentiment ?? null,
    tables_referenced: sqlResult.tables_referenced ?? [],
    reasoning: sqlResult.reasoning ?? null,
    headline,
    narrative,
    scope_check: scopeInfo,
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
    enriched_documents: enriched,
    error: null,
  });
}
