# Claude Code Prompt — D-041: R-rubric fix + table-expansion retrieval + SQL validator/retry

## Context
Evidence from the D-040 harness (three k=5 runs + k=10 + k=15, all in benchmark/runs/):
- 10 of 20 H-tier failures were REFUSALS; in 8 of 10 the model named a table it couldn't see.
- Required-table coverage: 20% at k=5, 61% at k=10, 74% at k=15. Refusals: 3-4 → 1 → 0.
- `o2c_sales_order_line` is absent at k=5, k=10 AND k=15 — similarity never surfaces it,
  even though retrieved metric chunks declare it in their `tables` field.
- Mean R stayed flat at 4.57 across k=5 runs while half the answers failed, then FELL to 4.00
  at k=10/15 — i.e. the rubric is blind to missing tables and penalises the fix.
Build order below is deliberate: fix measurement, then retrieval, then SQL recovery.

## Scope
Three parts, in order, each with its own gate and harness run. Do NOT touch the semantic
corpus content, the warehouse, the UI, or deployment. Nothing pushed.

---

## PART A — Split the R rubric (do this first; everything else is measured by it)

The current single R score conflates recall and precision and is unusable for this problem.
Replace with two scores, recorded per question in the run file:

- **R_recall** = (required chunks retrieved) / (required chunks total), 0.0–1.0.
  "Required" = the question's expected chunk set in the harness config, metric AND table
  chunks. If the expected set currently lists only metrics for some questions, extend it
  using the `tables` each expected metric declares (record in the ADR that you did this).
- **R_precision** = (retrieved chunks that are in the required set) / (chunks retrieved).
- Keep the legacy 0–5 R score as `R_legacy` so old runs stay comparable. Do not delete it.

Also record per question: `required_tables_retrieved` (count and share) — the coverage number
that drove this whole diagnosis.

**Gate A:** re-score the five EXISTING runs in benchmark/runs/ with the new rubric (no model
calls — rescore from the stored chunk ids). Print a table: run label, k, R_legacy, R_recall,
R_precision, table coverage. The k=10/15 runs must show HIGHER R_recall than k=5 (the fix
must stop looking like a regression).

---

## PART B — Table-expansion retrieval

After ranking and tenant filtering, before returning results: for each retrieved **metric**
chunk, deterministically add the **table** chunks it names in its `tables` field, if not
already present. No similarity search involved — this uses the declared relationship from
D-033.

Rules:
- Expansion is additive and happens after top-k selection, so k still controls how many
  *ranked* chunks are selected; expanded tables are appended.
- Deduplicate. Respect tenant isolation (D-035) — never pull a chunk from another tenant.
- Cap total expanded tables at 12 to bound prompt size; if a cap is hit, log it.
- Control with env var `RETRIEVAL_EXPAND_TABLES` (default **on**). Must be switchable off so
  the harness can A/B it.
- Add a `--expand true|false` flag to the eval harness.

**Gate B — the harness decides k, not us.** Run H-tier four ways, one run each:
`k5-noexpand`, `k5-expand`, `k10-noexpand`, `k10-expand`.
Print: k, expand, R_recall, R_precision, table coverage, refusals, SQL-valid %, mean A,
tokens in, cost. Explicitly report whether `o2c_sales_order_line` was retrieved for H01, H04,
H05, H10 in each configuration — that table is the acceptance test for expansion.
Then state which configuration you'd ship and why, flagging that single runs are noisy
(the k=5 baselines ranged 35.7–64.3% valid) and which differences are inside that noise.

---

## PART C — SQL validator + retry

Applies to SQL that is generated, before and after execution.

Pre-execution validation (cheap, deterministic):
- Read-only: reject anything that isn't a single SELECT/WITH (no INSERT/UPDATE/DELETE/DROP/
  ATTACH/COPY/PRAGMA, no multiple statements).
- Allowed tables: every referenced table must exist in the active tenant's schema; reject
  unknown or cross-tenant references.
- `EXPLAIN` dry-run against DuckDB to catch binder/parser errors without running the query.
- Enforce a LIMIT on result-returning queries if absent (configurable, default 1000).

Error classification — label each failure as one of:
`parser_error | binder_error | timeout | refusal | out_of_scope | permission | other`

Retry policy:
- Max 2 retries, only for `parser_error` and `binder_error`.
- Retry prompt includes the verbatim error plus the retrieved chunks; nothing else changes.
- NEVER retry `refusal`, `out_of_scope`, or `permission` — those are correct behaviour or
  user-facing, and retrying them wastes tokens and can coax a hallucinated answer.
- `timeout`: do not retry; the D-040 interrupt fix stands. Record and move on.
- Record `retry_count` and `retry_outcome` per question (the field already exists from D-040).

**Gate C:** run H-tier with the shipped configuration from Gate B, validator on. Show
before/after: SQL-valid %, failures by type, retry count, retries that succeeded, added cost
and latency from retries. State plainly whether the validator improved anything.

---

## ADR — D-041, appended to DECISIONS.md
Cover: the crowding-out diagnosis and its evidence; both R-rubric defects and the recall/
precision split; table-expansion design and why it beats raising k (o2c_sales_order_line is
never surfaced by similarity at any k tested); the Gate B configuration chosen and the noise
caveat; validator scope and the deliberate no-retry categories; what is still open
(multi-metric composition, the semantic-model/compiler direction as the structural successor
to expansion). Note single-run noise throughout — do not present one run as proven.

## Working style
- Plain-terminal verification, real output not intent. Brief responses.
- If a gate fails, stop and report — do not re-run until numbers look good.
- Commit per part when its gate passes:
  A: "feat: split R rubric into recall/precision + table coverage (D-041)"
  B: "feat: table-expansion retrieval (D-041)"
  C: "feat: SQL validator + classified retry (D-041)"
- Do NOT push. Do NOT deploy. If time or budget runs short, A and B are the priority;
  stop before C and say so.
