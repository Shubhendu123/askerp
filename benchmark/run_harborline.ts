/**
 * D-046 Part C runner - Harborline verification through the PRODUCTION path (not a benchmark-only prompt):
 * retrieveWithRanker (rrf, k=10, table + policy expansion) -> generateSQL -> runWithValidation (EXPLAIN + retry) -> narrate (with policy citations).
 * Single run, no re-runs to improve numbers. Executes against the local data/northwind.db (parity with MotherDuck verified in D-044).
 *   npx tsx benchmark/run_harborline.ts            # 30 harborline questions (ACTIVE_TENANT=harborline)
 *   npx tsx benchmark/run_harborline.ts --regression   # S02 + M08 under tenant mro (zero policy chunks, unchanged retrieval/answers)
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([A-Za-z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
process.env.MOTHERDUCK_TOKEN = "";        // local file backend (never prints or uses the cloud token here)
process.env.USE_RETRIEVAL = "true";       // chunk-built prompt, as in production
process.env.TRACING_ENABLED = "false";
const REGRESSION = process.argv.includes("--regression");
const LABEL = (() => { const i = process.argv.indexOf("--label"); return i >= 0 ? process.argv[i + 1] : "run"; })();
process.env.ACTIVE_TENANT = REGRESSION ? "mro" : "harborline";

async function main() {
  const { retrieveWithRanker, retrieveAll } = await import("../lib/retrieval/retriever");
  const { generateSQL, getTenantSchemaInfo } = await import("../lib/sqlGenerator");
  const { runWithValidation } = await import("../lib/sqlValidator");
  const { narrate } = await import("../lib/narrator");
  const { executeSQL } = await import("../lib/db");
  const { estimateCostUsd } = await import("../lib/pricing");

  const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  const K = Number(arg("--k", "10")), MODE = arg("--mode", "rrf") as "rrf" | "bm25" | "dense" | "schema"; // D-047 ablation; defaults = production
  const tenant = REGRESSION ? "mro" : "harborline";
  const cfg = JSON.parse(fs.readFileSync(REGRESSION ? "benchmark/questions.json" : "benchmark/questions_harborline.json", "utf-8"));
  const qs: Array<{ id: string; tier: string; question: string }> = REGRESSION
    ? cfg.questions.filter((q: { id: string }) => ["S02", "M08"].includes(q.id)) : cfg.questions;
  const runId = `${REGRESSION ? "mro-regression" : "harborline"}_${LABEL}_${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomBytes(2).toString("hex")}`;
  fs.mkdirSync("benchmark/runs_harborline", { recursive: true });
  const file = `benchmark/runs_harborline/${runId}.jsonl`;
  console.log(`run ${runId}: tenant=${tenant} mode=${MODE} k=${K} expand=on questions=${qs.length} -> ${file}`);

  let total = 0;
  for (const q of qs) {
    const t0 = Date.now();
    const ret = MODE === "schema" ? await retrieveAll(tenant) : await retrieveWithRanker(q.question, K, tenant, MODE);
    const ids = ret.results.map((r) => r.id);
    type Exec = Awaited<ReturnType<typeof executeSQL>>;
    const hold: { g: Awaited<ReturnType<typeof generateSQL>> | null } = { g: null };
    let tin = 0, tout = 0;
    const out = await runWithValidation<Exec>({
      info: getTenantSchemaInfo(tenant),
      generate: async (retry) => {
        const t = Date.now();
        try {
          const g = await generateSQL(q.question, ret.results, tenant, retry);
          hold.g = g;
          return { sql: g.sql ?? `REFUSE: ${g.reasoning ?? "no SQL generated"}`, tokens_in: g.usage?.input_tokens ?? 0, tokens_out: g.usage?.output_tokens ?? 0, latency_ms: Date.now() - t };
        } catch (e) { return { sql: "", tokens_in: 0, tokens_out: 0, latency_ms: Date.now() - t, apiError: String(e) }; }
      },
      explain: async (s) => { await executeSQL(`EXPLAIN ${s}`); },
      execute: async (s) => executeSQL(s),
    });
    tin += out.attempts.reduce((a, x) => a + (x.tokens_in ?? 0), 0); tout += out.attempts.reduce((a, x) => a + (x.tokens_out ?? 0), 0);
    const refused = out.final_error_class === "refusal";
    const exec = out.ok ? (out.result as Exec) : null;
    let headline = "", narrative = "", ntin = 0, ntout = 0;
    if (exec) {
      try {
        const n = await narrate({
          question: q.question, metric_used: hold.g?.metric_used ?? null, sentiment: hold.g?.sentiment ?? null,
          columns: exec.columns, rows: exec.rows, row_count: exec.row_count, truncated: exec.truncated,
          sql: out.finalSql,
          policies: ret.results.filter((r) => r.type === "policy").map((r) => ({ citation: r.policy?.citation ?? r.id, text: r.text, governs: r.policy?.governs })),
        }, tenant);
        headline = n.headline; narrative = n.narrative; ntin = n.usage?.input_tokens ?? 0; ntout = n.usage?.output_tokens ?? 0;
      } catch { /* narration failure must not lose the record */ }
    }
    const cost = estimateCostUsd("claude-haiku-4-5-20251001", tin + ntin, tout + ntout);
    total += cost;
    const base = {
      run_id: runId, id: q.id, tier: q.tier, question: q.question, tenant, mode: MODE, k: K,
      retrieved_chunk_ids: ids, expanded_chunk_ids: ret.results.filter((r) => r.expanded).map((r) => r.id),
      sql: out.finalSql, metric_used: hold.g?.metric_used ?? null, refused, sql_valid: out.ok,
      error_class: out.final_error_class, error_message: out.final_error_message, retry_count: out.retry_count,
      result_columns: exec?.columns ?? null, result_rows: exec ? exec.rows.slice(0, 100) : null, row_count: exec?.row_count ?? 0,
      headline, narrative, tokens_in: tin + ntin, tokens_out: tout + ntout, cost_usd: Number(cost.toFixed(6)), latency_ms: Date.now() - t0,
    };
    const scoring = REGRESSION
      ? JSON.parse(execFileSync("python3", ["benchmark/score_run.py"], { input: JSON.stringify({ id: q.id, mode: "rrf", retrieved_chunk_ids: ids, sql_valid: out.ok, refused, result_rows: exec ? exec.rows : null }), encoding: "utf-8" }))
      : JSON.parse(execFileSync("python3", ["benchmark/score_harborline.py"], { input: JSON.stringify({ ...base, result_rows: exec ? exec.rows : null }), encoding: "utf-8" }));
    const rec = { ...base, scoring: { ...scoring, sql_valid: out.ok, refused } };
    fs.appendFileSync(file, JSON.stringify(rec) + "\n");
    console.log(`${q.id} valid=${out.ok} refused=${refused} retries=${out.retry_count} Rrec=${scoring.R_recall} A=${scoring.A} cite=${scoring.citation_acc ?? "-"} $${cost.toFixed(4)} ${rec.latency_ms}ms${out.ok ? "" : " ERR=" + String(out.final_error_message).slice(0, 80)}`);
  }
  console.log(`\ndone. total est. cost $${total.toFixed(3)}; run file: ${file}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
