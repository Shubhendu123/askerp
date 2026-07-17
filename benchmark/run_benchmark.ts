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

async function execSql(sql: string): Promise<{ ok: boolean; rows?: unknown[][]; columns?: string[]; error?: string }> {
  const db = await getDb();
  try {
    const result = (await Promise.race([
      db.run(sql),
      new Promise((_, rej) => setTimeout(() => rej(new Error("query timeout (30s)")), 30_000)),
    ])) as Awaited<ReturnType<typeof db.run>>;
    const rows = (await result.getRows()).slice(0, 50).map((r) => r.map(sanitize));
    const columns = result.columnNames();
    return { ok: true, rows, columns };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
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

const mode = process.argv.includes("--estimate") ? "estimate" : "run";
(mode === "estimate" ? estimate() : fullRun()).then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); }
);
