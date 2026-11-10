# Claude Code Prompt — D-043: Production observability (request traces)

## Context
D-040 built per-stage instrumentation, but it lives in the eval harness only. Production
(`/api/ask`) logs nothing persistent — timings appear in the UI response and are then lost.
There is no way to answer "what did last week cost", "which question types fail most", or
"did quality move after a change". This closes the last unbuilt piece of the original plan.

## Objective
Every production request writes one trace row to a queryable table in the warehouse, plus a
simple page to read them. Do NOT change retrieval, SQL generation, the validator, or the
narrator. Nothing about the answer path may get slower or less reliable.

---

## PART A — Trace storage

Create a NEW schema `ops` in the warehouse (both local DuckDB file and MotherDuck), separate
from `main` and `mro_distributor`. Tenant isolation is unaffected — `ops` is not a tenant.

Table `ops.request_traces`, one row per request. Fields:
- `trace_id` (uuid), `created_at` (timestamp), `tenant`, `question`
- retrieval: `retrieval_mode`, `retrieval_k`, `expand_tables` (bool), `chunk_ids` (list or
  JSON string), `chunks_returned` (int), `retrieval_ms`
- generation: `sql_generated` (text), `model`, `tokens_in`, `tokens_out`, `sqlgen_ms`
- validation: `validation_passed` (bool), `limit_added` (bool), `retry_count`,
  `error_type` (the D-041 classification: parser_error | binder_error | timeout | refusal |
  out_of_scope | permission | other | null), `error_message` (verbatim, nullable)
- execution: `rows_returned`, `exec_ms`
- narration: `narration_tokens_in`, `narration_tokens_out`, `narrate_ms`
- totals: `total_ms`, `estimated_cost_usd`
- `success` (bool)

Reuse the cost-estimation logic already in the harness — do not write a second one.

## PART B — Writing traces, without risking the request

Hard requirements:
1. **A trace write must never break or delay the user's answer.** Write it after the response
   is returned (fire-and-forget / non-blocking). If the write throws, swallow the error, log
   to console, and move on.
2. Failures get traced too — a request that errors or refuses still writes a row with
   `success: false` and the error fields populated. A trace table that only contains successes
   is useless.
3. Use the existing module-scope connection/pool (D-037). Do not open a new connection per
   request.
4. Control with env var `TRACING_ENABLED` (default on). Must be switchable off.

Note in the ADR: this writes one row per request. At demo volume that is negligible against
the MotherDuck free tier, but batching would be the production answer at scale.

## PART C — A simple trace view

A page at `/traces` (plain, no redesign — match the existing Redwood light theme):
- Summary tiles: requests today, total cost today, p50 and p95 total latency, success rate,
  retry count
- A table of the most recent 50 traces: time, question (truncated), tenant, success,
  error_type, retries, rows, total_ms, cost
- Clicking a row expands to show the generated SQL, the retrieved chunk ids, and per-stage
  timings
- No auth on this page (consistent with the rest of the demo) — note it in the ADR as a gap

---

## Gates (plain terminal / real output)
1. `ops.request_traces` exists in MotherDuck. Show the DDL and a row count of 0 before use.
2. Ask three questions through the LIVE local path: S02 (DSO), M08 (top suppliers), and one
   that fails or refuses (use C03 "what is our employee attrition rate"). Show the three rows
   written, with every field populated as expected — including `success: false` and
   `error_type` on the third.
3. **Resilience test:** temporarily make the trace write fail (e.g. point it at a bad table
   name) and confirm the user still gets a correct answer for S02. Show that output, then
   revert. This is the gate that matters most.
4. Run an aggregate query against the table and print it, e.g. cost and p50 latency grouped by
   `success`, and a count by `error_type`. This proves the table is actually useful.
5. `/traces` renders. Ask me for a screenshot rather than checking it yourself.
6. `npx tsc --noEmit` clean.

## ADR — D-043, appended to DECISIONS.md
Cover: why traces are stored in the warehouse rather than an external tool (no new dependency,
SQL-queryable, stays in-stack); the `ops` schema choice and why it is not a tenant; the
fire-and-forget design and the rule that tracing never degrades the answer path; the per-row
write vs batching tradeoff; and the known gaps — no auth on `/traces`, no retention policy,
question text stored verbatim (a PII consideration in a real deployment).

## Working style
- Plain-terminal verification, real output not intent. Brief responses.
- For the `/traces` page, STOP and ask me for a screenshot — no browser automation.
- Commit when gates pass: "feat: production request tracing + trace view (D-043)".
- Push after the gates pass, then confirm one live request on the deployed URL writes a trace.
- Scope: nothing else. No narration evals, no caching, no auth.
