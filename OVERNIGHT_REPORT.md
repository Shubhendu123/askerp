# Overnight report (D-047 / D-048)

Written progressively; each section is appended when its step finishes. No tokens are printed or stored here.

## Decisions I made on your behalf
1. **Numbering:** this work is logged as D-047; the corpus work as D-048 (per your instruction). Run label prefixes in `benchmark/runs_harborline/` say `d048_run*` for the D-047 fixed-code rrf runs (renaming files would break nothing but was not worth the churn). `PROMPT_D047_*` and `harborline_corpus_d047.zip` are not staged in the D-047 commit.
2. **policy_refs audit:** kept only refs where the metric's formula applies a threshold/rule from that policy: 22 metrics had refs, 5 keep one (aged_fails_count→POL-006 §3, short_notice_event_share_pct→POL-004 §5, client_profitability_usd→POL-010 §6, open_breaks_aged_value_usd→POL-009 §4, client_sla_settlement_compliance→POL-001 §2). 17 refs removed (incl. AUC→POL-010; counterparty_fail_cash_impact lost both refs).
3. **Fan-out rule exemption:** `cae_event` is a header (parent) table; joining it to `cae_client_election` is many-to-one and safe (two ground-truth queries do it), so the validator exempts a parent+single-child join unless a parent column is inside an aggregate/FILTER.
4. **Fidelity/scope checks** are heuristic regexes over the narration vs executed SQL (false positives possible, e.g. the word "tier" in prose).
5. **Schema ablation mode** = entire Harborline corpus (all metrics, tables, policy sections, no caps) in the prompt, per your clarification; the narrator also receives all policy sections.
6. **Stability verdict definition:** STABLE = result rows identical in all 3 runs, no scope/fidelity flags, and either valid every time or declined every time. Headline text equality is reported separately (wording varies by design).
7. **Winner rule:** differences outside run-to-run range only; ties → cheaper → simpler.

## D-047 fixes: Part C, 3 runs on fixed code (rrf, k=10) — DONE
Mean A [min-max] over 3 runs: simple 3.00 [3.00-3.00]; medium 2.75 [2.62-3.00]; hard 2.53 [2.20-3.00]; hybrid 2.40 [2.40-2.40]; all 26: 2.72 [2.65-2.77]. Valid SQL 25 [24-25]. Policy chunks/question 1.90 (was ~3); 7 questions with zero; required-policy coverage 0.89. R_recall 0.98, R_precision 0.30. Controls 4/4 ×3; P04/P05 A=3 ×3.
- S01 still cites POL-010 §3 in 3/3 (1 policy chunk; arrives via ranking, not policy_refs).
- S02 overall fail rate: passes no-tier/no-phantom-window in 2/3 (run 3 narrator mentioned tiers). No answer stated a time window absent from the SQL (0/0/0).
- H05: correct 3/3 (10 rows = GT; 1 validator retry each; was 169,915 vs 1,999 before). H02: correct 1/3; 2/3 the validator rejected SQL until retries ran out (A=0, no answer) - previously wrong counts; follow-up needed.
- Scope-flag answers per run: 3-5 (mostly "tier" wording on S01/S06/M07; heuristic).
- Gates so far: MRO S02/M08 retrieval ids+scores identical to D-044, 0 policy chunks: PASS. `tsc --noEmit`: PASS. `next build`: PASS. Validator unit tests (50/50 known-good accepted; H05/H02 Run-2 SQL rejected; rules absent → no change): PASS.

## BLOCKER: Anthropic API credit exhausted (~21:00 local, 2026-11-10)
Every model call now fails with HTTP 400 `Your credit balance is too low to access the Anthropic API`. I verified with one tiny direct call using the key in `.env.local` AND with a call to the live site: `POST https://harborline-omega.vercel.app/api/ask` returns `sql_generation_failed` with the same message, so **the live Harborline demo (and presumably the MRO site) is currently down for the same reason**, independent of any code change. Needs a credit top-up (Plans & Billing) - I cannot do that.
Everything below that needs a model call is blocked; I record it and continue with independent steps.

## Mode ablation + k sweep - INCOMPLETE (credit exhausted)
Valid: rrf k=10 ×3, bm25 k=10 runs 1-2. Invalid (credit errors, moved to `benchmark/runs_harborline/invalid_credit_exhausted/`): bm25 run 3 (partial: 17/26 valid, 12 credit errors), dense ×3, schema ×3. k sweep not run.
| config (k=10) | runs | mean A all-26 [range] | valid SQL/26 | R_recall | R_prec | policy cov | tok in/q | cost/run | policy chunks/q |
|---|---|---|---|---|---|---|---|---|---|
| rrf | 3 | 2.72 [2.65-2.77] | 25,25,24 | 0.98 | 0.30 | 0.89 | 9452 | $0.34-0.36 | 1.9 |
| rrf (r1,r2 only) | 2 | 2.75 [2.73-2.77] | 25,25 | 0.98 | 0.30 | 0.89 | 9483 | $0.34-0.36 | 1.9 |
| bm25 (r1,r2) | 2 | 2.69 [2.69-2.69] | 24,24 | 0.97 | 0.23 | 0.89 | 10484 | $0.36-0.39 | 2.7 |
| dense | 0 usable | - | - | - | - | - | - | - | - |
| schema (whole corpus incl. all 86 policy sections) | 0 usable | - | - | - | - | - | - | - | 86 |
Per-tier (rrf, 3 runs): simple 3.00 [3.00-3.00], medium 2.75 [2.62-3.00], hard 2.53 [2.20-3.00], hybrid 2.40 [2.40-2.40]. bm25 r1-r2 vs rrf is inside run-to-run noise.
**Recommendation: no change. Production stays rrf / k=10** (the mode actually measured with all fixes). No conclusion about dense (MRO's D-036 winner) for Harborline; the ablation must be re-run after the top-up: `npx tsx benchmark/run_harborline.ts --mode dense|schema|bm25 --k 10 --label ...` ×3, then k=5/15 for the winner, then `python3 benchmark/score_harborline.py --ablate "name=glob" ...`.

## D-047 gates
| gate | result |
|---|---|
| MRO S02/M08 retrieval ids+scores identical to D-044, 0 policy chunks | PASS |
| `npx tsc --noEmit` | PASS |
| `next build` | PASS |
| validator unit tests (50/50 accept, H05/H02 reject, rules-absent no-op) | PASS |
| controls 4/4 (3 runs) | PASS |
| P04/P05 negative tests (3 runs) | PASS |
| S02 checks 3/3 (no tier/SLA, no phantom window) | **FAIL - 2/3** (run 3 narration mentioned tiers) |
| ablation complete | **FAIL - blocked by credit** |
**Push decision: NOT PUSHED** (a gate failed; also nothing could be verified live). Committed locally only. Pushing would redeploy both sites.

## Live check of the fail-rate question - NOT DONE
Blocked: the live site returns the credit error (see above). The live site is also running the pre-D-047 code, so the check would not have exercised the fixes anyway.

## Demo stability (live + local) - NOT DONE
Blocked by credit. Script ready: `python3 benchmark/stability_harborline.py <base_url> <out.json> [N] [q1|q2...]` (verdict STABLE = identical rows in all runs + no scope/fidelity flags + consistently valid or consistently declined).

## D-048 (enterprise document corpus) - in progress
Committed D-047 first (f492f5a, local only). Unzipped `harborline_corpus_d047.zip` into `harborline/` (corpus/ = 23 documents) and deleted the zip. The prompt file `harborline/PROMPT_D047_enterprise_document_corpus.md` remains (identical to the zip copy).
- Part A1 done: 12 policies' frontmatter upgraded (doc_type, authority_rank 3, access_level INTERNAL, effective_from, effective_to, supersedes, entities {}); bodies unchanged.
- Part A2/A3 done: `python3 harborline/build_corpus.py` renders the 6 templated documents (5 event notices + INC-2630) to `harborline/corpus_rendered/` (templates stay in `corpus/`), checks every rendered date/rate/notice window against the warehouse row (all match), and asserts all entities of all 35 documents resolve (clients, counterparties, markets, event_keys): PASS. Run it before a build; the Next build itself does not need the warehouse (rendered files are committed).

## Instruction changes received mid-run (applied)
1. **Budget trims:** k sweep = 1 run per k (5 and 15; k=10 reuses the 3-run baseline) and labelled *exploratory* in the ADR; D-048 skips the 30-question Run 3 regression and runs only the 12 DOC-tier questions. (Both blocked anyway by the credit failure below until credit is restored.)
2. **API failures are never scored.** Audit of what I already reported: the numbers in D-047 (rrf ×3, bm25 r1-r2) contain no credit-error records (grep: 0 files at top level). The credit-failed runs (dense ×3, schema ×3, bm25 r3) were excluded from every table and moved to `benchmark/runs_harborline/invalid_credit_exhausted/` - their `A=0` values were never reported as results. **Status of those runs: aborted: API credits.** The runner (`benchmark/run_harborline.ts`) now aborts on a credit/billing/rate-limit/429/overloaded error: it prints `ABORTED: API credits/limits`, renames the partial file to `*.ABORTED_API_CREDITS.txt` (not `.jsonl`, so it can't be scored) and exits 3.

## Credit restored (API call returned 200 at ~D-048 build time) - resumed API steps
- Mode ablation resumed: dense ×3, schema ×3, bm25 run 3 re-run **on the D-047 commit (git worktree at f492f5a)** so every ablation cell uses the same code (the working tree now contains D-048 retrieval changes). Results are merged into the ADR/report when done. The k sweep (1 run per k, exploratory) follows only if a non-rrf winner or noise-separated difference makes it meaningful (see Decisions).
- D-048 DOC-tier (12 questions) running in the main tree.

## D-048 gates (retrieval + build) 
| gate | result |
|---|---|
| Corpus: 35 documents (12 policy + 23), 212 harborline chunks (17 table, 24 metric, 86 policy, 85 document), 0 duplicate ids, entity assertion, rendered notices match warehouse | PASS (`python3 harborline/build_corpus.py`, `npx tsx harborline/test_corpus_retrieval.ts`) |
| Behaviour demos (retrieval): entity scoping (Redwood → 0 agreements; Pinnacle → CA-002 only), version selection (Feb 2026 → MG-IT v1.0, today → v2.0), precedence (D01 CA-001 §2 + POL-001 §2 both retrieved), enrichment (rows with event 2630/2706 → CA-002 §2, EVT-2630 §3, EVT-2706 §5), NO_SQL (D12 REG-002 §1) | PASS |
| Confidential leakage = 0 (38 non-control questions) | PASS |
| DOC-tier required-document coverage (retrieval) | 0.85 (not a pass/fail threshold; misses D06, D07, D09) |
| MRO S02/M08 retrieval identical to D-044 | PASS - 3 of 4 checks bit-identical; 1 check (made mid-run) showed 4th-decimal cosine differences with identical ids/order; an immediate re-run was bit-identical again, so that is Voyage service variance, not a code change |
| `tsc --noEmit`, `next build` | PASS |
| Retrieval regression vs D-047 run 1 (original 30 questions) | 25/30 identical; 5 differences explained in D-048 ADR |
| 30-question model regression (Run 3) | NOT RUN (budget instruction) |
DOC-tier model runs: Run 1 mean A 1.33; Run 2 (after NO_SQL/narrator-rule fix) 1.67; fact coverage 0.46 → 0.85; precedence correct 2/5; leakage 0. Details in D-048. Weak result; several answers (D03, D07, D09) still skip the SQL data.
D-048 committed locally, NOT pushed (instruction).
