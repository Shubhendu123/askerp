# Claude Code Prompt — D-044: Tenant 3, Harborline Global Custody (schema + data)

## Scope — data layer only
Build a third tenant: `harborline`, a securities services / global custody business.
Schema, synthetic data, verification, and upload to MotherDuck. NOTHING else.
Do NOT touch the existing tenants (`main` = Northwind, `mro_distributor` = MRO), the
retriever, schema.yaml, metrics.yaml, the app, or deployment. Those are D-045/D-046.

## Read first
- DECISIONS.md, especially D-029 (schema-per-tenant), D-030 (subject-area prefixes +
  conformed dims), D-031 (planted correlated signal), D-034 (additive patch pattern),
  D-037 (MotherDuck upload pattern).
- `db_rebuild/gen/generate_mro_v2.py` — the generator pattern to follow (seeded, coherent
  simulation, planted causal chain, NOT 16 independent random tables).
- `harborline/ddl/harborline.sql` — the authoritative DDL. Apply it as given; do not redesign.

## Persona
**Harborline Global Custody** — mid-tier global custodian, ~$800B assets under custody,
serving 50 institutional clients (asset managers, pension funds, insurers, sovereign wealth,
hedge funds) across 12 markets. Reporting currency USD; local currency kept as an attribute.

## Scale (18 months, 2025-05-01 to 2026-10-22, SEED=7)
- 50 clients · 800 securities · 60 counterparties · 12 markets · 8 subcustodians · 9 currencies
- ~1,000 settlement instructions/day → ~540,000 rows
- Daily positions on ~2,000 client×security pairs → ~1.08M rows
- Expect ~1.8M rows total

## Reference data (use these exact markets)
| code | CSD | cycle | penalty regime | reclaim complexity |
|---|---|---|---|---|
| US | DTC | T+1 | NONE | LOW |
| CA | CDS | T+1 | NONE | LOW |
| GB | CREST | T+2 | CREST | MEDIUM |
| DE | Clearstream | T+2 | CSDR | MEDIUM |
| FR | Euroclear France | T+2 | CSDR | HIGH |
| IT | Monte Titoli | T+2 | CSDR | HIGH |
| NL | Euroclear NL | T+2 | CSDR | MEDIUM |
| CH | SIX SIS | T+2 | NONE | HIGH |
| JP | JASDEC | T+2 | NONE | MEDIUM |
| HK | CCASS | T+2 | NONE | LOW |
| AU | CHESS | T+2 | NONE | MEDIUM |
| SG | CDP | T+2 | NONE | LOW |

Penalty rates (approximate published CSDR daily rates — use as given for the demo, and note
in the ADR that they are approximations):
liquid equity 1.0 bps · ETF 0.5 bps · corporate bond 0.20 bps · government bond 0.10 bps.
CREST-regime fails use a flat 0.5 bps. Markets with regime NONE must produce ZERO penalties.

## THE THREE PLANTED CAUSAL CHAINS (this is the point — do not generate independent randomness)

**Chain 1 — counterparty → fails → penalties → overdraft → client impact**
`dim_counterparty.reliability_tier` A→D drives both fail probability and `days_failed`.
Target fail rates by tier: A ≈ 1%, B ≈ 2.5%, C ≈ 7%, D ≈ 14% (monotonic, A-vs-D gap ≥ 10 pts).
Fails in CSDR/CREST markets generate one `stl_fail_penalty` row **per failed day**.
A failed RECEIVE leaves `quantity_pending` on the position; a failed DELIVER leaves cash
unreceived → `pos_cash_balance.is_overdrawn` with a `funding_cost_usd` charge. Clients whose
trades route through tier C/D counterparties must show measurably more overdraft days.
Also plant: fail rate by `security_type` follows reality — CORP_BOND worst, then EQUITY/ETF,
GOVT_BOND best. And `liquidity_tier` LOW fails more than HIGH.

**Chain 2 — short notice → missed elections**
`cae_event.notice_window_days` = deadline − announcement. Voluntary events (~25% of events)
require a client election. Miss rate must be driven by the notice window, not random:
≤2 days ≈ 8–10% missed, 3–4 days ≈ 3%, ≥5 days ≈ 0.5%. Overall ≈ 2%.
Concentrate short-notice events in specific markets (IT, HK, JP) so "which markets announce
late" has a real answer. Missed elections carry `estimated_client_impact_usd`.

**Chain 3 — tax reclaim leakage**
Income payments carry `statutory_rate_pct` (withheld) and `treaty_rate_pct` (entitled).
Where statutory > treaty and the client's domicile has a treaty, `reclaim_eligible = true`
and `reclaim_amount_usd` = the difference. Only ~60% get `reclaim_filed = true`, and the
unfiled share must concentrate in `tax_reclaim_complexity = HIGH` markets (FR, IT, CH).
`reclaim_deadline_date_key` = payment date + statute (use 48 months FR/IT, 36 months others),
so "which unfiled reclaims are approaching the deadline" is answerable.

Also include, at lower intensity: ~5% of income payments late; `rec_break` rows with
`root_cause = FAILED_SETTLEMENT` correlating with Chain 1; `clt_service_request` volume and
SLA breaches correlating with client fail counts; fee waivers (`SLA_CREDIT`) appearing for
clients with poor service outcomes.

## Build steps
1. Apply `harborline/ddl/harborline.sql` to the app DB (`data/northwind.db`) — ADDITIVE.
   Verify the two existing tenants are untouched (row-count check before and after).
2. Write `harborline/gen/generate_harborline.py` — seeded (SEED=7), reproducible, coherent
   simulation following the chains above. Include a realistic business calendar
   (`dim_date.is_business_day`); settlement and penalties only accrue on business days.
3. Load, then write `harborline/verify_harborline.py` — a reusable suite covering the
   acceptance table below plus the three killer queries.
4. Upload to MotherDuck as schema `harborline` inside database `askerp`, using the
   table-by-table pattern from D-037. The token is in the shell environment — never read,
   print, or persist it. Verify row-count parity local vs cloud for every table.

## Acceptance criteria — show real terminal output
| # | Check | Target |
|---|---|---|
| 1 | Tables in `harborline` | 16 |
| 2 | Total rows | 1.5M–2.2M |
| 3 | Existing tenants unchanged | Northwind 9 tables + MRO 20 tables, identical row counts |
| 4 | Assets under custody (latest date) | $600B–$1T |
| 5 | Overall settlement fail rate | 3%–4.5% |
| 6 | Fail rate by counterparty tier | monotonic A<B<C<D, A-vs-D gap ≥10 pts |
| 7 | Fail rate by security type | CORP_BOND > EQUITY > GOVT_BOND |
| 8 | Penalties in NONE-regime markets | exactly 0 |
| 9 | Missed election rate by notice window | ≤2 days materially worse than ≥5 days |
| 10 | Tax reclaim filed rate | 55%–65%, unfiled concentrated in HIGH-complexity markets |
| 11 | Overdraft days by counterparty tier | clients exposed to C/D tiers measurably higher |
| 12 | Cloud parity | every table's row count matches local, zero mismatches |

**Killer-query gates — all three must return a real answer:**
- **K1:** "Which counterparties' settlement fails cost the most in penalties, and which clients
  bear the impact?" — joins STL + penalties + POS cash + dim_client + dim_counterparty.
  Must show the tier gradient.
- **K2:** "Where are we leaking tax reclaim revenue, by market and client segment?" —
  CAE + dim_market + dim_client. Must show HIGH-complexity market concentration.
- **K3:** "Which corporate action elections did we miss, and what was the notice window?" —
  CAE event + election. Must show short-window concentration.

If any gate fails, tune the generator and rerun from a clean schema drop. Do not move on
with a flat gradient — a flat signal means the demo question has no real answer.

## ADR — D-044, appended to DECISIONS.md
Cover: the persona and why securities services (settlement fails, corporate action errors and
tax reclaim leakage are the industry's three documented money leaks); the 5 subject areas and
16 tables; the three planted chains and their verified numbers; market/penalty-regime realism
and that CSDR rates are approximations; scale and seed; that this is Tenant 3 under D-029
schema-per-tenant with no change to existing tenants. Note that `db_rebuild/` is MRO-specific
and a future tidy would be `tenants/<name>/`.

## Working style
- Verify in a PLAIN terminal; real output, not intent. Brief responses.
- Pause and report if an acceptance gate fails — do not silently retune to pass.
- Commit when gates pass: "feat: Harborline securities tenant — schema + data (D-044)".
- Do NOT push. Do NOT touch the semantic layer, policy documents, or app wiring.
