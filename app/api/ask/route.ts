import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import * as duckdb from "@duckdb/node-api";
import { narrate } from "@/lib/narrator";

function sanitize(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(sanitize);
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    // DuckDB DATE type: {days: N} — days since 1970-01-01
    if (Object.keys(rec).length === 1 && "days" in rec && typeof rec.days === "number") {
      return new Date(rec.days * 86400 * 1000).toISOString().slice(0, 10);
    }
    // DuckDB DECIMAL type: {value: BigInt, scale: number}
    if ("value" in rec && "scale" in rec && typeof rec.scale === "number") {
      const raw = typeof rec.value === "bigint" ? Number(rec.value) : Number(rec.value);
      return raw / Math.pow(10, rec.scale as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rec)) {
      out[k] = sanitize(val);
    }
    return out;
  }
  return v;
}

const DB_PATH = path.join(process.cwd(), "data", "northwind.db");
const RETRIEVAL_URL = "http://localhost:8001/retrieve";
const SUBPROCESS_TIMEOUT_MS = 30_000;
const MAX_ROWS = 100;

// ── Retrieval ──────────────────────────────────────────────────────────────────
async function fetchRetrieval(question: string) {
  const res = await fetch(RETRIEVAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: question, k: 5 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Retrieval service returned ${res.status}`);
  return res.json();
}

// ── SQL generation via subprocess ──────────────────────────────────────────────
function runSqlGenerator(question: string, chunks: unknown[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "agents", "sql_generator.py");
    const env = { ...process.env };

    // Pass question and chunks via stdin as JSON to avoid shell injection
    const child = spawn(
      "python3",
      ["-c",
       `
import sys, json, os
sys.path.insert(0, '${process.cwd().replace(/'/g, "\\'")}')
from agents.sql_generator import generate_sql
data = json.loads(sys.stdin.read())
result = generate_sql(data['question'], data['chunks'])
print(json.dumps(result))
`
      ],
      { env, cwd: process.cwd() }
    );

    const input = JSON.stringify({ question, chunks });
    let stdout = "";
    let stderr = "";

    child.stdin.write(input);
    child.stdin.end();
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("SQL generator timed out after 30s"));
    }, SUBPROCESS_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`SQL generator exited ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// ── DuckDB execution ───────────────────────────────────────────────────────────
async function executeSQL(sql: string): Promise<{ columns: string[]; rows: unknown[][]; row_count: number; truncated: boolean }> {
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
        chunk.getColumnValues(c).map((v) => sanitize(v))
      );
      for (let r = 0; r < nRows; r++) {
        allRows.push(colArrays.map((col) => col[r]));
      }
    }

    const truncated = allRows.length > MAX_ROWS;
    return {
      columns,
      rows: allRows.slice(0, MAX_ROWS),
      row_count: allRows.length,
      truncated,
    };
  } finally {
    await connection.closeSync();
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

  // Step 1: Retrieve
  let retrieved: unknown[] = [];
  let retrievalTimeMs = 0;
  try {
    const t_ret = Date.now();
    const retrieval = await fetchRetrieval(question);
    retrievalTimeMs = Date.now() - t_ret;
    retrieved = retrieval.results ?? [];
  } catch (err) {
    return NextResponse.json({
      question,
      error: "retrieval_failed",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 });
  }

  // Step 2: Generate SQL
  let sqlResult: Record<string, unknown>;
  let sqlGenTimeMs = 0;
  try {
    const t_gen = Date.now();
    const raw = await runSqlGenerator(question, retrieved);
    sqlGenTimeMs = Date.now() - t_gen;
    sqlResult = JSON.parse(raw);
  } catch (err) {
    return NextResponse.json({
      question,
      retrieved,
      error: "sql_generation_failed",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }

  const sql = sqlResult.sql as string | null;
  if (!sql) {
    return NextResponse.json({
      question,
      retrieved,
      sql: null,
      error: "no_sql_generated",
      detail: sqlResult.reasoning ?? "SQL generator returned no SQL",
    }, { status: 500 });
  }

  // Step 3: Execute SQL
  let execResult: Awaited<ReturnType<typeof executeSQL>>;
  let execTimeMs = 0;
  try {
    const t_exec = Date.now();
    execResult = await executeSQL(sql);
    execTimeMs = Date.now() - t_exec;
  } catch (err) {
    return NextResponse.json({
      question,
      retrieved,
      sql,
      metric_used: sqlResult.metric_used ?? null,
      error: "sql_execution_failed",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }

  // Step 4: Narrate (non-blocking — failure returns empty strings, doesn't abort)
  let headline = "";
  let narrative = "";
  let narrateTimeMs = 0;
  try {
    const t_narr = Date.now();
    const narration = await narrate({
      question,
      metric_used: sqlResult.metric_used as string | null ?? null,
      sentiment: sqlResult.sentiment as string | null ?? null,
      columns: execResult.columns,
      rows: execResult.rows,
      row_count: execResult.row_count,
      truncated: execResult.truncated,
    });
    narrateTimeMs = Date.now() - t_narr;
    headline = narration.headline;
    narrative = narration.narrative;
  } catch {
    // narrator failure is non-fatal
  }

  return NextResponse.json({
    question,
    retrieved,
    sql,
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
    retrieval_time_ms: retrievalTimeMs,
    sql_gen_time_ms: sqlGenTimeMs,
    execution_time_ms: execTimeMs,
    narrate_time_ms: narrateTimeMs,
    total_time_ms: Date.now() - t_start,
    error: null,
  });
}
