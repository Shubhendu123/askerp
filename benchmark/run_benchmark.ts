/**
 * Benchmark harness (D-036): 40 questions x 4 modes on Haiku (production SQL model).
 * Modes: bm25 | dense | rrf (top-5 retrieval context) | schema (full mro corpus in prompt).
 * Identical prompts across modes except the context block.
 *
 * Usage (repo root):
 *   npx tsx benchmark/run_benchmark.ts --estimate   # print cost estimate, no model calls
 *   npx tsx benchmark/run_benchmark.ts              # full run, checkpoints to benchmark/results.jsonl
 */
import fs from "fs";
import path from "path";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

import Anthropic from "@anthropic-ai/sdk";
import { DuckDBInstance } from "@duckdb/node-api";
import { retrieveWithRanker, getTenantChunks, BenchmarkRanker } from "../lib/retrieval/retriever";

const MODEL = "claude-haiku-4-5-20251001"; // production SQL-generation model
const PRICE_IN = 1.0 / 1e6;  // Haiku 4.5 $/token input
const PRICE_OUT = 5.0 / 1e6; // Haiku 4.5 $/token output
const MAX_OUT_TOKENS = 1024;
const TENANT = "mro";
const RESULTS = "benchmark/results.jsonl";
const MODES = ["bm25", "dense", "rrf", "schema"] as const;

const config = JSON.parse(fs.readFileSync("benchmark/questions.json", "utf-8"));
const TOP_K: number = config.top_k;
const questions: Array<{ id: string; tier: string; question: string }> = config.questions;

const SYSTEM = `You are AskERP's SQL generator for the MRO Distributor tenant (an industrial supplies distributor).
Generate a single DuckDB SQL statement that answers the user's question, using ONLY the tables, columns, and metric formulas provided in the context. All warehouse tables live in the schema "mro_distributor" — always qualify table names as mro_distributor.<table>.
Rules:
- Reply with ONLY the SQL statement. No markdown fences, no commentary.
- The data covers 18 months of history; unless the question names a period, aggregate over all data.
- If the question cannot be answered from the provided context and data (missing table, out-of-scope topic, or data that does not exist in this warehouse), reply with exactly: REFUSE: <one short reason>. Do not invent tables or columns.`;

function buildUserPrompt(context: string, question: string): string {
  return `Context:\n${context}\n\nQuestion: ${question}\nSQL:`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── DuckDB execution (read-only) ───────────────────────────────────────────────

let _db: Awaited<ReturnType<DuckDBInstance["connect"]>> | null = null;
async function getDb() {
  if (!_db) {
    const instance = await DuckDBInstance.create("data/northwind.db", { access_mode: "READ_ONLY" });
    _db = await instance.connect();
  }
  return _db;
}

function sanitize(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object") {
    const o = v as { value?: unknown; scale?: number };
    if (typeof o.value === "bigint" && typeof o.scale === "number") {
      return Number(o.value) / Math.pow(10, o.scale);
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  }
  return v;
}

async function execSql(sql: string, maxErr = 300): Promise<{ ok: boolean; rows?: unknown[][]; columns?: string[]; error?: string; rowCount?: number }> {
  const db = await getDb();
  try {
    const result = (await Promise.race([
      db.run(sql),
      new Promise((_, rej) => setTimeout(() => { db.interrupt(); rej(new Error("query timeout (30s)")); }, 30_000)),
    ])) as Awaited<ReturnType<typeof db.run>>;
    const all = await result.getRows();
    const rows = all.slice(0, 50).map((r) => r.map(sanitize));
    const columns = result.columnNames();
    return { ok: true, rows, columns, rowCount: all.length };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, maxErr) };
  }
}

// ── Context builders ───────────────────────────────────────────────────────────

async function contextFor(mode: string, question: string): Promise<{ context: string; chunkIds: string[] }> {
  if (mode === "schema") {
    const chunks = await getTenantChunks(TENANT);
    return { context: chunks.map((c) => `[${c.id}] ${c.text}`).join("\n\n"), chunkIds: [] };
  }
  const resp = await retrieveWithRanker(question, TOP_K, TENANT, mode as BenchmarkRanker);
  return {
    context: resp.results.map((r) => `[${r.id}] ${r.text}`).join("\n\n"),
    chunkIds: resp.results.map((r) => r.id),
  };
}

// ── Estimate mode ──────────────────────────────────────────────────────────────

async function estimate() {
  const schemaCtx = (await contextFor("schema", "")).context;
  const schemaCtxTokens = estimateTokens(schemaCtx);
  // Retrieval context: sample real top-5 contexts for 5 questions via bm25 (no API cost)
  const samples: number[] = [];
  for (const q of questions.slice(0, 5)) {
    const { context } = await contextFor("bm25", q.question);
    samples.push(estimateTokens(context));
  }
  const retrievalCtxTokens = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  const sysTokens = estimateTokens(SYSTEM);
  const qTokens = 30;
  const outTokens = 180; // typical SQL response

  const nQ = questions.length;
  const retrievalIn = 3 * nQ * (sysTokens + retrievalCtxTokens + qTokens);
  const schemaIn = nQ * (sysTokens + schemaCtxTokens + qTokens);
  const totalIn = retrievalIn + schemaIn;
  const totalOut = 4 * nQ * outTokens;
  const cost = totalIn * PRICE_IN + totalOut * PRICE_OUT;

  console.log(`=== Cost estimate (model ${MODEL}, $1/M in, $5/M out) ===`);
  console.log(`runs: ${4 * nQ} (${nQ} questions x 4 modes) | top_k=${TOP_K}`);
  console.log(`system prompt: ~${sysTokens} tok | avg top-5 retrieval context: ~${retrievalCtxTokens} tok | full-corpus (schema mode) context: ~${schemaCtxTokens} tok`);
  console.log(`retrieval modes input: 3 x ${nQ} x ~${sysTokens + retrievalCtxTokens + qTokens} = ~${retrievalIn.toLocaleString()} tok`);
  console.log(`schema mode input:     1 x ${nQ} x ~${sysTokens + schemaCtxTokens + qTokens} = ~${schemaIn.toLocaleString()} tok`);
  console.log(`output: ~${totalOut.toLocaleString()} tok`);
  console.log(`ESTIMATED COST: $${cost.toFixed(2)}  (threshold: stop and ask if > $15)`);
  console.log(`plus Voyage embeddings: 1 corpus embed (${(await getTenantChunks(TENANT)).length}+ docs) + ~${2 * nQ} query embeds (dense+rrf) — negligible (<$0.01)`);
}

// ── Full run ───────────────────────────────────────────────────────────────────

async function fullRun() {
  const client = new Anthropic();
  const done = new Set<string>();
  if (fs.existsSync(RESULTS)) {
    for (const line of fs.readFileSync(RESULTS, "utf-8").split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      done.add(`${r.mode}:${r.id}`);
    }
    console.log(`resuming: ${done.size} runs already in ${RESULTS}`);
  }

  let n = done.size;
  for (const mode of MODES) {
    for (const q of questions) {
      const key = `${mode}:${q.id}`;
      if (done.has(key)) continue;
      const t0 = Date.now();
      const { context, chunkIds } = await contextFor(mode, q.question);
      const retrievalMs = Date.now() - t0;

      const t1 = Date.now();
      let sql = "", tokensIn = 0, tokensOut = 0, apiError = "";
      try {
        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_OUT_TOKENS,
          system: SYSTEM,
          messages: [{ role: "user", content: buildUserPrompt(context, q.question) }],
        });
        const block = resp.content.find((b) => b.type === "text");
        sql = (block && block.type === "text" ? block.text : "").trim();
        tokensIn = resp.usage.input_tokens;
        tokensOut = resp.usage.output_tokens;
      } catch (e) {
        apiError = String(e).slice(0, 300);
      }
      const llmMs = Date.now() - t1;

      const refused = sql.startsWith("REFUSE:");
      let exec: Awaited<ReturnType<typeof execSql>> = { ok: false, error: "no sql" };
      if (sql && !refused && !apiError) {
        // strip accidental markdown fences defensively
        const clean = sql.replace(/^```(sql)?/i, "").replace(/```$/, "").trim();
        exec = await execSql(clean);
      }

      const record = {
        id: q.id, tier: q.tier, mode,
        question: q.question,
        retrieved_chunk_ids: chunkIds,
        context_tokens_est: estimateTokens(context),
        sql, refused,
        sql_valid: exec.ok,
        exec_error: exec.ok ? null : (refused ? "refused" : (apiError || exec.error)),
        result_columns: exec.columns ?? null,
        result_rows: exec.rows ?? null,
        tokens_in: tokensIn, tokens_out: tokensOut,
        cost_usd: Number((tokensIn * PRICE_IN + tokensOut * PRICE_OUT).toFixed(6)),
        latency_ms: { retrieval: retrievalMs, llm: llmMs },
        model: MODEL, top_k: mode === "schema" ? null : TOP_K,
        ts: new Date().toISOString(),
      };
      fs.appendFileSync(RESULTS, JSON.stringify(record) + "\n"); // checkpoint immediately
      n++;
      console.log(`[${n}/${4 * questions.length}] ${mode}:${q.id} valid=${exec.ok} refused=${refused} in=${tokensIn} out=${tokensOut} ${llmMs}ms`);
    }
  }
  console.log(`done: ${n} runs in ${RESULTS}`);
}

// ── Eval harness (D-040): on-demand, tier-selectable, per-stage instrumented ───
// Reuses the contextFor/execSql/SYSTEM/prompt code above and the D-036 scorer in
// build_report.py (via benchmark/score_run.py) — no second scorer.

import { execFileSync } from "child_process";
import crypto from "crypto";

const PRICES: Record<string, [number, number]> = { // $/token [in, out]
  "claude-haiku-4-5-20251001": [1.0 / 1e6, 5.0 / 1e6],
  "claude-sonnet-4-5": [3.0 / 1e6, 15.0 / 1e6],
};
function priceFor(model: string): [number, number] {
  const p = PRICES[model];
  if (!p) { console.warn(`WARN: no price entry for ${model}; using Haiku rates for cost estimates`); return PRICES[MODEL]; }
  return p;
}

function flag(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

type RetScore = { R_legacy: number | null; R_recall: number | null; R_precision: number | null; required_tables_retrieved: { count: number; total: number; share: number | null } | null; A: number | null; ctrl_ok: boolean | null };
function scoreRecord(rec: object): RetScore {
  const out = execFileSync("python3", ["benchmark/score_run.py"], { input: JSON.stringify(rec), encoding: "utf-8" });
  return JSON.parse(out);
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function printSummary(file: string) {
  const recs = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  console.log(`\n=== Run summary: ${recs[0]?.run_id} (${recs.length} records, mode=${recs[0]?.mode}, k=${recs[0]?.k}, model=${recs[0]?.model}) ===`);
  console.log("tier  n   R_leg  recall  prec  tblCov  meanA  SQLvalid%  tokens_in  tokens_out  cost_usd  p50_ms  p95_ms");
  const tiers = Array.from(new Set(recs.map((r) => r.tier))).sort();
  for (const t of [...tiers, "ALL"]) {
    const rs = t === "ALL" ? recs : recs.filter((r) => r.tier === t);
    const nn = (f: (r: any) => number | null | undefined) => rs.map(f).filter((x: number | null | undefined) => x !== null && x !== undefined) as number[]; // eslint-disable-line
    const R = nn((r) => r.scoring.R_legacy);
    const Rrec = nn((r) => r.scoring.R_recall);
    const Rprec = nn((r) => r.scoring.R_precision);
    const cov = nn((r) => r.scoring.required_tables_retrieved?.share);
    const A = rs.map((r) => r.scoring.A).filter((x: number | null) => x !== null);
    const valid = rs.filter((r) => r.scoring.sql_valid).length;
    const tin = rs.reduce((a, r) => a + r.sql_generation.tokens_in + r.narration.tokens_in, 0);
    const tout = rs.reduce((a, r) => a + r.sql_generation.tokens_out + r.narration.tokens_out, 0);
    const cost = rs.reduce((a, r) => a + r.total_cost_usd, 0);
    const lat = rs.map((r) => r.total_latency_ms).sort((a, b) => a - b);
    console.log(
      `${t.padEnd(5)} ${String(rs.length).padEnd(3)} ${mean(R).toFixed(2).padStart(5)}  ${mean(Rrec).toFixed(2).padStart(6)}  ${mean(Rprec).toFixed(2).padStart(4)}  ${mean(cov).toFixed(2).padStart(6)}  ${mean(A).toFixed(2).padStart(5)}  ${((100 * valid) / rs.length).toFixed(1).padStart(8)}%  ${String(tin).padStart(9)}  ${String(tout).padStart(10)}  ${cost.toFixed(4).padStart(8)}  ${String(pct(lat, 50)).padStart(6)}  ${String(pct(lat, 95)).padStart(6)}`
    );
  }
}

async function evalRun() {
  const tierArg = (flag("tier", "all") as string).toUpperCase() === "ALL" ? "all" : (flag("tier") as string).toUpperCase();
  const evalMode = flag("mode", "dense") as string;
  const k = Number(flag("k", "5"));
  const label = flag("label", "") as string;
  const model = flag("model", MODEL) as string;
  const expandFlag = flag("expand");
  if (expandFlag !== undefined && !["true", "false"].includes(expandFlag)) throw new Error(`bad --expand ${expandFlag}`);
  const expand = expandFlag === undefined ? undefined : expandFlag === "true";
  if (!["bm25", "dense", "rrf", "schema"].includes(evalMode)) throw new Error(`bad --mode ${evalMode}`);
  if (tierArg !== "all" && !["S", "M", "H", "C"].includes(tierArg)) throw new Error(`bad --tier ${tierArg}`);
  const qs = tierArg === "all" ? questions : questions.filter((q) => q.tier === tierArg);
  const [pIn, pOut] = priceFor(model);

  // cost guard: rough estimate from sampled context sizes (no API calls)
  const sample = await Promise.all(qs.slice(0, 3).map((q) => contextFor(evalMode, q.question)));
  const ctxTok = Math.round(sample.reduce((a, s) => a + estimateTokens(s.context), 0) / Math.max(1, sample.length));
  const estCost = qs.length * ((estimateTokens(SYSTEM) + ctxTok + 30) * pIn + 180 * pOut + (600 * PRICES[MODEL][0] + 120 * PRICES[MODEL][1]));
  console.log(`Eval: tier=${tierArg} mode=${evalMode} k=${k} model=${model} label="${label}" questions=${qs.length}`);
  console.log(`ESTIMATED COST: $${estCost.toFixed(3)} (stop-and-ask threshold: $5)`);
  if (estCost > 5) { console.error("Estimate exceeds $5 — stopping. Re-run after confirming."); process.exit(2); }

  // capture usage from narrator's own Anthropic client without modifying narrator.ts
  const MsgProto = Object.getPrototypeOf(new Anthropic({ apiKey: "x" }).messages) as { create: (...a: unknown[]) => Promise<{ usage: { input_tokens: number; output_tokens: number } }> };
  const origCreate = MsgProto.create;
  let captured: { in: number; out: number } | null = null;
  MsgProto.create = async function (this: unknown, ...a: unknown[]) {
    const r = await origCreate.apply(this, a);
    captured = { in: r.usage.input_tokens, out: r.usage.output_tokens };
    return r;
  };
  const { narrate } = await import("../lib/narrator");

  const client = new Anthropic();
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomBytes(2).toString("hex")}`;
  fs.mkdirSync("benchmark/runs", { recursive: true });
  const file = `benchmark/runs/${runId}.jsonl`;
  console.log(`run_id=${runId} -> ${file}`);
  const [nIn, nOut] = PRICES[MODEL];

  for (const q of qs) {
    const tq = Date.now();
    const t0 = Date.now();
    const rk = evalMode === "schema" ? { context: (await contextFor("schema", q.question)).context, chunkIds: [] as string[], expandedIds: [] as string[] } : await (async () => {
      const resp = await retrieveWithRanker(q.question, k, TENANT, evalMode as BenchmarkRanker, expand);
      return { context: resp.results.map((r) => `[${r.id}] ${r.text}`).join("\n\n"), chunkIds: resp.results.map((r) => r.id), expandedIds: resp.results.filter((r) => r.expanded).map((r) => r.id) };
    })();
    const retrievalMs = Date.now() - t0;

    const t1 = Date.now();
    let sql = "", sIn = 0, sOut = 0, apiError = "";
    try {
      const resp = await client.messages.create({
        model, max_tokens: MAX_OUT_TOKENS, system: SYSTEM,
        messages: [{ role: "user", content: buildUserPrompt(rk.context, q.question) }],
      });
      const block = resp.content.find((b) => b.type === "text");
      sql = (block && block.type === "text" ? block.text : "").trim();
      sIn = resp.usage.input_tokens; sOut = resp.usage.output_tokens;
    } catch (e) { apiError = String(e); }
    const sqlGenMs = Date.now() - t1;
    const sqlCost = sIn * pIn + sOut * pOut;

    const refused = sql.startsWith("REFUSE:");
    const t2 = Date.now();
    let exec: Awaited<ReturnType<typeof execSql>> = { ok: false, error: "no sql" };
    if (sql && !refused && !apiError) {
      exec = await execSql(sql.replace(/^```(sql)?/i, "").replace(/```$/, "").trim(), 2000);
    }
    const execMs = Date.now() - t2;
    const errMsg = exec.ok ? null : (refused ? sql : (apiError || exec.error || null));

    // narration (only when there is a result to narrate)
    let nTin = 0, nTout = 0, narrMs = 0;
    if (exec.ok && exec.rows && exec.columns) {
      captured = null;
      const t3 = Date.now();
      try {
        await narrate({ question: q.question, metric_used: null, sentiment: null, columns: exec.columns, rows: exec.rows, row_count: exec.rowCount ?? exec.rows.length, truncated: false }, TENANT);
      } catch { /* narration failure must not lose the record */ }
      narrMs = Date.now() - t3;
      const c = captured as { in: number; out: number } | null;
      if (c) { nTin = c.in; nTout = c.out; }
    }
    const narrCost = nTin * nIn + nTout * nOut;

    const base = {
      run_id: runId, ts: new Date().toISOString(), id: q.id, tier: q.tier, mode: evalMode, k, expand: expand ?? (process.env.RETRIEVAL_EXPAND_TABLES ?? "true") !== "false", model, label,
      question: q.question,
      retrieval: { chunk_ids: rk.chunkIds, expanded_chunk_ids: rk.expandedIds, latency_ms: retrievalMs },
      sql_generation: { sql, tokens_in: sIn, tokens_out: sOut, latency_ms: sqlGenMs, estimated_cost_usd: Number(sqlCost.toFixed(6)) },
      sql_execution: { ran: !!(sql && !refused && !apiError), error_message: errMsg, rows_returned: exec.ok ? (exec.rowCount ?? 0) : 0, latency_ms: execMs },
      narration: { tokens_in: nTin, tokens_out: nTout, latency_ms: narrMs, estimated_cost_usd: Number(narrCost.toFixed(6)) },
      retry_count: 0,
    };
    const scorerInput = { id: q.id, mode: evalMode, retrieved_chunk_ids: rk.chunkIds, sql_valid: exec.ok, refused, result_rows: exec.ok ? exec.rows ?? null : null };
    const sc = scoreRecord(scorerInput);
    const record = {
      ...base,
      scoring: { R_legacy: sc.R_legacy, R_recall: sc.R_recall, R_precision: sc.R_precision, required_tables_retrieved: sc.required_tables_retrieved, A: sc.A, sql_valid: exec.ok, refused, ctrl_ok: sc.ctrl_ok },
      total_latency_ms: Date.now() - tq,
      total_cost_usd: Number((sqlCost + narrCost).toFixed(6)),
    };
    fs.appendFileSync(file, JSON.stringify(record) + "\n"); // incremental: a crash never loses completed questions
    console.log(`${q.id} valid=${exec.ok} Rrec=${sc.R_recall} A=${sc.A} cost=$${record.total_cost_usd} ${record.total_latency_ms}ms${errMsg ? " ERR=" + String(errMsg).slice(0, 90) : ""}`);
  }
  printSummary(file);
  console.log(`\nrun file: ${file}`);
}

const cli = process.argv.includes("--eval") ? "eval" : process.argv.includes("--estimate") ? "estimate" : "run";
(cli === "eval" ? evalRun() : cli === "estimate" ? estimate() : fullRun()).then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); }
);
