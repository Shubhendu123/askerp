import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { writeSQL } from "./db";
import { estimateCostUsd } from "./pricing";

// D-043: one trace row per request, written AFTER the response is returned.
// Tracing must never break or delay the answer path: every failure is swallowed.

export const TRACING_ENABLED = (process.env.TRACING_ENABLED ?? "true").toLowerCase() !== "false";
const TRACE_TABLE = process.env.TRACE_TABLE ?? "ops.request_traces"; // override exists for the resilience test
const MODEL = "claude-haiku-4-5-20251001"; // SQL-gen and narration model (same as lib/sqlGenerator, lib/narrator)

export interface TraceData {
  tenant: string;
  question: string;
  retrieval_mode: string;
  retrieval_k: number;
  expand_tables: boolean;
  chunk_ids: string[];
  retrieval_ms: number;
  sql_generated: string | null;
  tokens_in: number;
  tokens_out: number;
  sqlgen_ms: number;
  validation_passed: boolean;
  limit_added: boolean;
  retry_count: number;
  error_type: string | null;
  error_message: string | null;
  rows_returned: number | null;
  exec_ms: number;
  narration_tokens_in: number;
  narration_tokens_out: number;
  narrate_ms: number;
  total_ms: number;
  success: boolean;
}

const COLS = [
  "trace_id", "created_at", "tenant", "question", "retrieval_mode", "retrieval_k", "expand_tables", "chunk_ids",
  "chunks_returned", "retrieval_ms", "sql_generated", "model", "tokens_in", "tokens_out", "sqlgen_ms",
  "validation_passed", "limit_added", "retry_count", "error_type", "error_message", "rows_returned", "exec_ms",
  "narration_tokens_in", "narration_tokens_out", "narrate_ms", "total_ms", "estimated_cost_usd", "success",
];

async function writeTrace(t: TraceData): Promise<void> {
  const estimated = estimateCostUsd(MODEL, t.tokens_in + t.narration_tokens_in, t.tokens_out + t.narration_tokens_out);
  const values: unknown[] = [
    crypto.randomUUID(), new Date().toISOString().replace("T", " ").replace("Z", ""), t.tenant, t.question,
    t.retrieval_mode, t.retrieval_k, t.expand_tables, JSON.stringify(t.chunk_ids),
    t.chunk_ids.length, t.retrieval_ms, t.sql_generated, MODEL, t.tokens_in, t.tokens_out, t.sqlgen_ms,
    t.validation_passed, t.limit_added, t.retry_count, t.error_type, t.error_message, t.rows_returned, t.exec_ms,
    t.narration_tokens_in, t.narration_tokens_out, t.narrate_ms, t.total_ms, Number(estimated.toFixed(6)), t.success,
  ];
  const ph = COLS.map((c, i) => (c === "trace_id" ? `CAST($${i + 1} AS UUID)` : c === "created_at" ? `CAST($${i + 1} AS TIMESTAMP)` : `$${i + 1}`));
  await writeSQL(`INSERT INTO ${TRACE_TABLE} (${COLS.join(", ")}) VALUES (${ph.join(", ")})`, values);
}

/** Fire-and-forget. Never throws, never awaited by the caller. */
export function recordTrace(t: TraceData): void {
  if (!TRACING_ENABLED) return;
  try {
    const p = writeTrace(t).catch((err) => console.error("[trace] write failed (ignored):", err instanceof Error ? err.message : err));
    try { waitUntil(p); } catch { /* not on Vercel: promise just runs */ }
  } catch (err) {
    console.error("[trace] failed to start write (ignored):", err instanceof Error ? err.message : err);
  }
}
