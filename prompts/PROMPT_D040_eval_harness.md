# Claude Code Prompt — Step 1: Minimal eval harness

## Scope
Make the existing benchmark runnable on demand with per-stage instrumentation. Dense mode
only. No diff engine, no regression gate, no report redesign — those come later.
Do NOT touch the retriever, SQL generator, semantic corpus, or UI.

## Read first
- `benchmark/run_benchmark.ts`, `benchmark/questions.json`, `benchmark/ground_truth.json`,
  `benchmark/results.jsonl`, `benchmark/build_report.py`
- DECISIONS.md D-036 (benchmark design, scoring rubric)
Reuse what exists. This is an extension of run_benchmark.ts, not a rewrite.

## Build

### 1. One command, with flags
A single entry point (e.g. `npm run eval`) accepting:
- `--tier S|M|H|C|all` (default all) — run one tier only
- `--mode dense` (default dense; keep other modes reachable but not required)
- `--k <n>` (default 5) — top-k passthrough, needed for the next step
- `--label <string>` — free-text tag stored with the run
- `--model <name>` (optional) — SQL-gen model override, so a Haiku/Sonnet comparison needs
  no code change later

### 2. Per-stage instrumentation
For every question, record a structured record with:
- question id, tier, mode, k, model, label, timestamp, run_id
- retrieval: chunk ids returned, latency_ms
- sql_generation: tokens_in, tokens_out, latency_ms, estimated_cost_usd
- sql_execution: ran (bool), error_message (verbatim if any), rows_returned, latency_ms
- narration: tokens_in, tokens_out, latency_ms, estimated_cost_usd
- retry_count (field must exist now, value 0 until Phase 5 lands)
- scoring: R score, A score, sql_valid (bool)
- total_latency_ms, total_cost_usd

### 3. Scoring — reuse, don't reinvent
Use the existing R/A rubric and ground-truth comparison from D-036 (1% numeric tolerance).
If run_benchmark.ts already implements scoring, call it; do not write a second scorer.

### 4. Output
- Append every record to `benchmark/runs/<run_id>.jsonl`, written incrementally
  (a crash mid-run must not lose completed questions)
- Print a terminal summary at the end: per-tier mean R, mean A, SQL-validity %, total tokens,
  total cost, p50/p95 latency
- Leave `results.jsonl` and `REPORT.md` untouched — historical artifacts

### 5. Cost guard
Print an estimated cost before running and proceed. If the estimate exceeds $5, stop and ask.

## Gates (show real terminal output)
1. `npm run eval -- --tier H --mode dense --k 5` completes all 14 H-tier questions
2. The run file exists, has 14 records, every field populated (retry_count present as 0)
3. Terminal summary prints and is numerically consistent with the file
4. Known failure is captured verbatim: H01's `Binder Error: column "po_key" does not exist`
   appears in `error_message` with `sql_valid: false` — the harness must record failures,
   not crash on them
5. `npx tsc --noEmit` clean

## ADR — required, do not skip
Append **D-040** to `DECISIONS.md` (repo root), after the highest existing ADR (D-038).
Follow the existing ADR format in that file. Content: minimal eval harness — scope
(dense-only, tier-selectable, per-stage instrumentation), rationale (July's benchmark was a
one-off; changes now need a repeatable measurement), what was deliberately deferred (diff vs
previous run, regression gate, multi-mode sweeps), the run-file schema, and the baseline
numbers from the gate run.
Note in the ADR that **D-039 (product rename) was never executed** — the numbering skips it.

## Working style
Plain-terminal verification, real output not intent. Brief. Commit when gates pass:
"feat: minimal eval harness with per-stage instrumentation (D-040)". Do not push.
Stop after the gates + ADR — no validator work, no top-k sweep, no model comparison.
