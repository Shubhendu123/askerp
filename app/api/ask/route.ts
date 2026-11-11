import { moneyContext } from "@/lib/moneyFormat";
import { SCOPE_CHECK_TENANTS, checkScope, dropFlaggedSentences, pctFigures, type CheckContext } from "@/lib/scopeCheck";
import { resolvePeriod, dateFromKey, type ResolvedPeriod } from "@/lib/period";
import { fixAcronyms, titleFromQuestion, countContext, countFigures, stripPeriodWords } from "@/lib/valueFormat";
import { NextRequest, NextResponse } from "next/server";
import { generateSQL, getTenantSchemaInfo, USE_RETRIEVAL, DEFAULT_TENANT } from "@/lib/sqlGenerator";
import { runWithValidation } from "@/lib/sqlValidator";
import { narrate, toNarratorDocs, citesAny, stripBold } from "@/lib/narrator";
import { enrichDocuments, findTargetOverrides } from "@/lib/retrieval/retriever";
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

  // Step 2b' (D-050, harborline only): a client agreement that overrides the standard SLA target for a client in the result (Eastgate CA-001 §2: 98.5%).
  // The row uses the contract target (and met_target is recomputed); the response lists the override so the UI footnotes it. Skipped unless the
  // result has a client column, a settlement-rate column and a target column - nothing is guessed.
  type Applied = { client: string; from: number | null; to: number; source: string; supersedes: string };
  const overrides: Applied[] = [];
  const overrideFacts: string[] = [];
  if (SCOPE_CHECK_TENANTS.has(DEFAULT_TENANT)) {
    try {
      const cols = execResult.columns;
      const ci = cols.findIndex((c) => /^(client_name|client)$/i.test(c)), ti = cols.findIndex((c) => /target/i.test(c)), ri = cols.findIndex((c) => /rate/i.test(c) && !/target/i.test(c)), mi = cols.findIndex((c) => /^met_/i.test(c));
      if (ci >= 0 && ti >= 0 && ri >= 0) {
        const found = await findTargetOverrides(cols, execResult.rows as unknown[][], DEFAULT_TENANT);
        let rows = (execResult.rows as unknown[][]).map((r) => [...r]);
        for (const ov of found) {
          const hit = rows.filter((r) => String(r[ci]).toLowerCase() === ov.client.toLowerCase());
          if (!hit.length) continue;
          const from = Number(hit[0][ti]);
          for (const r of hit) { r[ti] = ov.target; if (mi >= 0 && typeof r[mi] === "boolean") r[mi] = Number(r[ri]) >= ov.target; }
          if (mi >= 0) rows = rows.filter((r) => !(String(r[ci]).toLowerCase() === ov.client.toLowerCase() && r[mi] === true)); // met the contract target -> not a miss
          overrides.push({ client: ov.client, from: isFinite(from) ? from : null, to: ov.target, source: ov.citation, supersedes: ov.supersedes });
          const have = new Set(enriched.map((e) => e.id));
          for (const d of [ov.policyChunk, ov.chunk]) if (d && !have.has(d.id)) { enriched.push(d); have.add(d.id); }
          overrideFacts.push(`Contract override applied to the table: ${ov.client}'s settlement-rate target is ${ov.target}% (${ov.citation}), overriding the standard ${isFinite(from) ? from.toFixed(1) : "PLATINUM"}% (${ov.supersedes}); that row already uses ${ov.target}%. Say this in exactly ONE bullet (do not repeat it in any other bullet) and cite both ${ov.citation} and ${ov.supersedes}.`);
        }
        if (overrides.length) { execResult.rows = rows; execResult.row_count = rows.length; }
      }
    } catch { /* non-fatal: the table stays as the SQL returned it */ }
  }

  // Step 2c (D-050, harborline only): facts computed in code - the resolved relative period and population sizes ("all N" is only valid for the full population)
  const harbor = SCOPE_CHECK_TENANTS.has(DEFAULT_TENANT);
  let period: ResolvedPeriod | null = null;
  let populations: number[] | undefined;
  const facts: string[] = [...overrideFacts];
  if (harbor) {
    const toN = (v: unknown) => Number(typeof v === "bigint" ? Number(v) : v);
    try {
      const mx = await executeSQL("SELECT max(actual_settle_date_key) AS d FROM harborline.stl_trade_instruction");
      const latest = dateFromKey((mx.rows[0] as unknown[])[0]);
      if (latest) period = resolvePeriod(question, latest);
      if (period) facts.push(`Resolved period: "${period.phrase}" = ${period.label}, the ${period.reason}. State this once, in the headline or the first bullet, with its reason.`);
    } catch { /* non-fatal */ }
    try {
      const entity = /dim_client|client_key|sla_tier/i.test(finalSql) ? { table: "dim_client", col: "sla_tier", noun: "clients" }
        : /dim_counterparty|counterparty_key|reliability_tier/i.test(finalSql) ? { table: "dim_counterparty", col: "reliability_tier", noun: "counterparties" } : null;
      if (entity) {
        const pop = await executeSQL(`SELECT ${entity.col} AS t, count(*) AS n FROM harborline.${entity.table} GROUP BY 1 ORDER BY 1`);
        const per = pop.rows.map((r) => [String((r as unknown[])[0]), toN((r as unknown[])[1])] as const);
        const total = per.reduce((a, [, n]) => a + n, 0);
        populations = [total, ...per.map(([, n]) => n)];
        facts.push(`Population facts: Harborline has ${total} ${entity.noun} in total (${per.map(([t, n]) => `${n} ${t}`).join(", ")}); this result has ${execResult.row_count} rows. Write "all N" only if N is one of these full-population sizes.`);
      }
    } catch { /* non-fatal */ }
  }

  // Step 3: Narrate (non-fatal)
  let title = "";
  let headline = "";
  let narrative = "";
  let bullets: string[] = [];
  let narrateTimeMs = 0;
  let scopeInfo: { first_violations: string[]; regenerated: boolean; dropped: string[] } | null = null;
  try {
    const t = Date.now();
    const docsForNarrator = [...toNarratorDocs(retrievalResp.results), ...toNarratorDocs(enriched)];
    const n = await narrate({
      question,
      metric_used: sqlResult.metric_used ?? null,
      sentiment: sqlResult.sentiment ?? null,
      columns: execResult.columns,
      rows: execResult.rows,
      row_count: execResult.row_count,
      truncated: execResult.truncated,
      sql: finalSql,
      facts,
      policies: docsForNarrator,
    }, DEFAULT_TENANT);
    title = n.title ?? "";
    headline = n.headline;
    narrative = n.narrative;
    bullets = n.bullets ?? [];
    let tin = n.usage?.input_tokens ?? 0, tout = n.usage?.output_tokens ?? 0;
    // D-049 scope check (harborline only): narrate -> check -> regenerate ONCE without policy chunks -> check -> drop the flagged sentences
    // D-050: the same check now also covers the narrator accuracy rules (custody wording, marketing/comparison claims, "all N", percentages vs source text, unrequested credits)
    if (harbor) {
      const cells = execResult.rows as unknown[][];
      const allowedMoney = moneyContext(execResult.columns, cells).allowed;
      const numCells = cells.flatMap((r) => r.map((v) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : NaN))).filter((x) => isFinite(x));
      const docPct = (docs: { text: string }[]) => docs.flatMap((d) => pctFigures(d.text));
      const allowedCounts = [...numCells.filter(Number.isInteger).map(Math.abs), ...countContext(execResult.columns, cells).allowed, ...docsForNarrator.flatMap((d) => countFigures(d.text)), execResult.row_count, ...(populations ?? [])];
      const ctx: CheckContext = { question, rowCount: execResult.row_count, populations, allowedPct: { data: numCells, docs: docPct(docsForNarrator) }, allowedCounts };
      const textOf = (x: { title?: string; headline: string; bullets: string[]; narrative: string }) => [x.title, x.headline, x.bullets.length ? x.bullets.map(stripBold).join(" ") : x.narrative].filter(Boolean).join(" ");
      const first = checkScope(textOf({ title, headline, bullets, narrative }), finalSql, allowedMoney, ctx);
      if (!first.ok) {
        scopeInfo = { first_violations: [...(first.windowBad ? ["window: " + first.windowClaims.join(", ")] : []), ...first.scopeViol, ...(first.moneyBad.length ? ["money: " + first.moneyBad.join(", ")] : []), ...first.claimBad], regenerated: true, dropped: [] };
        const policyFree = first.windowBad || first.scopeViol.length > 0;
        try {
          const n2 = await narrate({
            question, metric_used: sqlResult.metric_used ?? null, sentiment: sqlResult.sentiment ?? null, columns: execResult.columns, rows: execResult.rows,
            row_count: execResult.row_count, truncated: execResult.truncated, sql: finalSql, facts,
            policies: policyFree ? [] : docsForNarrator, // no policy chunks when the scope check failed; a money-only or claim-only failure keeps them
          }, DEFAULT_TENANT);
          tin += n2.usage?.input_tokens ?? 0; tout += n2.usage?.output_tokens ?? 0;
          title = n2.title ?? title; headline = n2.headline; narrative = n2.narrative; bullets = n2.bullets ?? [];
        } catch { /* keep the first narration; the drop step below still applies */ }
        if (!checkScope(textOf({ title, headline, bullets, narrative }), finalSql, allowedMoney, ctx).ok) {
          const drop = (x: string) => dropFlaggedSentences(x, finalSql, allowedMoney, ctx);
          const hd = drop(headline);
          const kept = bullets.map(drop);
          scopeInfo.dropped = [...hd.dropped, ...kept.flatMap((k) => k.dropped)];
          bullets = kept.map((k) => k.text).filter(Boolean);
          narrative = bullets.length ? bullets.map(stripBold).join(" ") : drop(narrative).text;
          if (hd.dropped.length) headline = hd.text || (narrative.split(/(?<=[.!?])\s/)[0] ?? "").slice(0, 90);
          if (!checkScope(title, finalSql, allowedMoney, ctx).ok) title = "";
        }
      }
    }
    narrateTimeMs = Date.now() - t;
    tc.narration_tokens_in = tin; tc.narration_tokens_out = tout;
  } catch { /* narrator failure is non-fatal */ }
  if (harbor) {
    title = fixAcronyms(period ? stripPeriodWords(title.trim()) : title.trim()) || titleFromQuestion(question);
    if (period && !title.includes(period.short)) title = `${title} — ${period.short}`;
  }
  tc.narrate_ms = narrateTimeMs; tc.rows_returned = execResult.row_count; tc.success = true;

  return NextResponse.json({
    question,
    sql: finalSql,
    metric_used: sqlResult.metric_used ?? null,
    sentiment: sqlResult.sentiment ?? null,
    tables_referenced: sqlResult.tables_referenced ?? [],
    reasoning: sqlResult.reasoning ?? null,
    title: harbor ? title : undefined,
    bullets: harbor ? bullets : undefined,
    period: period ?? undefined,
    overrides: overrides.length ? overrides : undefined,
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
