# Claude Code Prompt — Build MRO Distributor warehouse (AskERP foundation rebuild, Step 1–2)

## Role
You are building inside the existing AskERP repo. The app and the Northwind Furniture DB
(Tenant 1, 9 tables) already exist. Do NOT touch Northwind. You are adding a second tenant.

## Context (why)
AskERP is an agentic NL→SQL analytics product on an NSAW-shaped warehouse. The current DB is
too small (9 tables), so schema-in-prompt works and RAG is bypassed — that's the root problem.
We are scaling to a realistic NSAW-shaped warehouse so retrieval becomes architecturally
necessary. This task builds the new warehouse + realistic synthetic data. It does NOT touch the
retriever (that's a later step).

## Objective
Create Tenant 2 — `mro_distributor` — a North American B2B industrial/MRO distributor
(~$300M revenue: fasteners, tools, safety, electrical, MRO supplies; multi-warehouse, hundreds
of suppliers, thousands of SKUs). 20 tables across 5 NSAW subject areas, loaded with
business-realistic synthetic data, in the same DuckDB file as Northwind, schema-per-tenant.

## Known deviations from the July handoff (deliberate — do not "fix")
- Handoff says "Northwind Furniture persona retired." Correct as PERSONA; Northwind is RETAINED
  as Tenant 1 (D-003 multi-tenant basis). MRO = Tenant 2, the main demo.
- Handoff says "~25-35 tables." We ship 20 by design: breadth without padding. 8 conformed dims
  + 12 facts covers all 5 locked subject areas; do not add filler tables to hit a count.

## Reference implementation (treat as the spec — do not redesign)
Two reference files are provided and have been built + verified in a clean room:
- `ddl/mro_distributor.sql` — the exact 20-table DDL (authoritative)
- `gen/generate_mro_v2.py` — the exact seeded generator (authoritative, SEED=42)
Integrate these into the repo. Wire the generator's DB path to the app's actual DuckDB file.
If the app uses a non-DuckDB engine, port faithfully but preserve schema, grain, FKs, seed,
and every realism parameter below. Reproduce, don't reinvent.

## Schema (schema-per-tenant, NSAW-shaped) — D-029, D-030
One DuckDB file. Schema `mro_distributor.*` alongside `northwind.*`.
- 8 conformed dimensions: dim_date, dim_item, dim_customer, dim_supplier, dim_warehouse,
  dim_gl_account, dim_employee, dim_subsidiary
- 12 facts, subject-area prefixed:
  - O2C: o2c_sales_order_line, o2c_fulfillment_line, o2c_return_line
  - AR:  ar_invoice, ar_payment_application
  - P2P: p2p_purchase_order_line, p2p_vendor_bill, p2p_bill_payment
  - INV: inv_balance_snapshot (DAILY grain), inv_transaction
  - GL:  gl_journal_line, gl_account_balance
- FKs enforced. Grain documented per table (see DDL comments). Single currency USD.

## Data must be BUSINESS-realistic, not just the right shape
This is non-negotiable. Random-but-correctly-shaped data is a fail. The generator must produce:

1. **Planted supplier→cash causal chain** (the core demo capability). Supplier `reliability_tier`
   A→D drives PO `late_days` → inventory stockouts → inflated `order_to_ship_days` → invoice
   issued at ship date → higher DSO. Lateness magnitudes (mean extra days): A≈0.5, B≈2.5, C≈8,
   D≈16 (gamma-distributed for spread).
2. **Supplier spend concentration (Pareto)**: lognormal supplier sizes; items assigned to
   suppliers weighted by size. Target: top 20% of suppliers ≈ 75% of spend.
3. **Customer revenue concentration (Pareto)**: lognormal customer sizes; demand weighted by
   size. Target: top 20% of customers ≈ 60–65% of revenue.
4. **Category-differentiated cost & margin** (log-uniform cost within band):
   Fasteners ~22% GM, Electrical ~28%, Safety ~35%, Tools ~36%, MRO ~43%.
5. **Customer payment heterogeneity**: ~15% chronic slow payers (pay terms+~20d) vs rest
   (terms+~4d) — a SECOND, independent DSO driver. Target: slow ≈ 66d vs on-time ≈ 41d.
6. **SKU velocity classes** A/B/C (≈10/20/70% of SKUs) weighting order frequency and stock level.
7. **Trend & seasonality**: ~8% YoY growth, Q4 uplift, weekend dips.
8. Seeded (SEED=42), fully reproducible.

## Scale
~1,200 SKUs, 200 customers, 100 suppliers, 4 warehouses, 3 subsidiaries, 18 months
(start 2024-07-01). Daily inventory snapshots on active SKU×warehouse pairs (~1810 pairs).
Expect ~1.6M+ total rows.

## Acceptance criteria (self-verify in a PLAIN terminal — not your own narration)
Run a verification script and confirm ALL of these land. If any miss, tune and rerun.

| Metric | Target | Verified reference value |
|---|---|---|
| Total tables in mro_distributor | 20 | 20 |
| Total rows | >1.5M | ~1.86M |
| Annualized revenue | $250–500M | $298M |
| DSO | 40–50d | 44d |
| DPO | 35–45d | 38d |
| DIO | 70–90d | 85d |
| CCC (DSO+DIO−DPO) | 70–90d | 90d |
| Supplier Pareto (top 20% of spend) | 70–80% | 76% |
| Customer Pareto (top 20% of revenue) | 60–65% | 63% |
| Category gross margins | differentiated | 22%→43% |
| Slow-payer DSO vs on-time | clearly separated | 66d vs 41d |

**Killer-query gate (must pass):** a single query joining P2P + INV + O2C + AR through conformed
dims, grouped by supplier reliability tier, must show a monotonic gradient:
late_days 0.1→15, stockout 3%→13%, order-to-ship 2→7 days (A→D). If the gradient is flat, the
signal didn't propagate — fix before proceeding.

## Working-style constraints (hard rules)
- Verify every claim in a PLAIN terminal you actually run — do not report success from intent.
- Show me row counts and the acceptance-criteria table as real output before declaring done.
- For any visual check, STOP and ask me for a screenshot — no browser automation.
- Token-efficient. Brief. No over-producing prose.
- Don't cut corners to save time. Realism is the point.

## Log these ADRs in DECISIONS.md (do NOT skip — an unlogged DB swap is what hid the last
disconnect)
⚠️ NUMBERING: D-001..D-028 already exist in DECISIONS.md (D-027 = TS/Voyage retrieval,
D-028 = schema-in-prompt retroactive log). Do NOT touch them. Append the following as NEW
entries starting at D-029. Verify the tail of DECISIONS.md first.
- **D-029** Multi-tenant isolation = schema-per-tenant (Northwind = Tenant 1 retained; MRO =
  Tenant 2 main demo). Mirrors NSAW per-instance isolation; subsidiary is a within-tenant dim.
- **D-030** Subject-area-prefixed naming (o2c_/p2p_/gl_/inv_/ar_) + 8 conformed dimensions.
- **D-031** Synthetic data carries planted, correlated signal (supplier→cash chain) + business
  realism (Pareto concentration, category margins, payment heterogeneity, velocity, growth).
  Persona: NA B2B MRO distributor ~$300M. Verified ratios above. Note in the ADR: this is a
  deliberate departure from D-011 (Northwind uniform-not-Pareto) — realism is required for the
  MRO demo tenant; D-011 stands for Northwind. Also reference D-003 (multi-tenant from the
  start) as the architectural basis Tenant 2 fulfills.
- **D-032** Warehouse hosting = MotherDuck (storage/compute separation). The 187MB MRO DB
  cannot be bundled into the Vercel serverless function (northwind.db at 14MB could). DB is
  gitignored; deployment queries MotherDuck (DuckDB dialect preserved; serverless-safe via
  Postgres-protocol endpoint / thin client — no native binary, same constraint class D-027
  solved for embeddings). Local dev may still use the local file. Wiring MotherDuck is a
  SEPARATE later step — this ADR logs the decision, not the migration.

## Definition of done
1. 20 tables created in `mro_distributor`, FKs enforced, Northwind untouched.
2. Generator runs clean, seeded, reproducible; data loaded.
3. All acceptance criteria pass in plain-terminal output you show me.
4. Killer-query gradient passes.
5. D-029/030/031/032 written to DECISIONS.md.
6. Report: what you built, the verification output, and any deviation from the reference.
Do NOT start on the retriever — stop after the DB is built and verified.
Do NOT regenerate schema.yaml / metrics.yaml yet — that is the NEXT task. When it happens,
every metric chunk must carry formula + tables + grain (the chunk-actionability lesson from
the RAG reconnect). This task = DB only.
