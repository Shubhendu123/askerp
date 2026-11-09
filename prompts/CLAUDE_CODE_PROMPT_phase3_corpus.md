# Claude Code Prompt — Phase 3: MRO retrieval corpus (schema.yaml + metrics.yaml)

## Scope — corpus files ONLY
Extend `schema.yaml` and `metrics.yaml` so the retrieval layer can describe the MRO
Distributor tenant (schema `mro_distributor`, 20 tables, already built and verified in
`data/northwind.db`, D-029..D-032). Do NOT touch app code, retriever code, API routes, UI,
or deployment. Do NOT modify or reorder any existing Northwind entry — MRO is ADDED alongside.

## Read first
1. The existing `schema.yaml` and `metrics.yaml` — match their field structure and
   conventions EXACTLY. Northwind entries are the template; MRO entries must be
   indistinguishable in format.
2. `db_rebuild/ddl/mro_distributor.sql` — authoritative table/column/grain reference.
3. DECISIONS.md D-027..D-032 for context.

## The one rule that matters most — chunk actionability (June lesson, do not repeat the bug)
Every metric entry MUST carry, inside the entry itself:
- **formula**: real, runnable DuckDB SQL against the `mro_distributor.*` schema
- **tables**: the exact tables the formula touches
- **grain**: the level the metric is computed at (e.g., per-supplier, per-month, company-total)
A metric that is findable (good description/synonyms) but not actionable (missing/vague
formula) retrieves fine and then fails at SQL generation. That bug already happened once.
Schema entries similarly need: table purpose, grain, key columns with business meaning,
join keys to conformed dimensions.

## Tenant tagging (forward-looking, cheap now)
Add a `tenant` field to EVERY entry in both files — `northwind` on all existing entries,
`mro` on all new ones. Do not implement retriever-side tenant filtering (that is Phase 4);
just tag. Log the tagging decision in the ADR.

## Parameterized metrics — avoid the known failure mode
3 Northwind metrics are templated with placeholders ({current_year} etc.) and fail without
a planner agent (deferred). For MRO: write formulas WITHOUT placeholders wherever possible
(use relative date logic like `CURRENT_DATE - INTERVAL 90 DAY` or full-history aggregates).
If a metric truly needs a parameter, keep it out of this launch set and note it in the ADR
as planner-agent backlog.

## The 25 MRO metrics (locked list — implement exactly these)
O2C (6): total_revenue, gross_margin_pct, avg_order_value, order_count,
  avg_order_to_ship_days, return_rate_pct
AR (5): dso_days, ar_open_balance, overdue_invoice_pct, avg_days_to_pay_vs_terms,
  collection_days_by_segment
P2P (5): dpo_days, supplier_on_time_delivery_pct, avg_po_late_days_by_supplier,
  open_payables, spend_by_supplier
INV (5): dio_days, inventory_value_on_hand, stockout_rate_pct, inventory_turns,
  slow_moving_inventory_value
GL (2): gl_revenue_by_period, gl_cogs_trend
Cross-subject-area (2): cash_conversion_cycle_days (DSO+DIO−DPO),
  supplier_lateness_cash_impact (the P2P→INV→O2C→AR join — the killer demo metric)

Definitions must use the verified reference values as sanity anchors: revenue ≈ $298M
annualized, DSO ≈ 44d, DPO ≈ 39d, DIO ≈ 85d, CCC ≈ 89d, supplier OTD gradient by
reliability_tier A→D.

## Verification gates (ALL must pass — show real terminal output)
1. Both YAML files parse cleanly (python yaml.safe_load or equivalent).
2. **Execute every one of the 25 MRO formulas against `data/northwind.db`** and print
   metric_name → result. Every formula must run without error and return a plausible value
   (sanity-check against the anchors above; flag anything >20% off and investigate before
   accepting). No formula ships unexecuted. This is the no-fictitious-claims gate.
3. Diff check: existing Northwind entries byte-identical except for the added tenant tag.
4. Coverage: all 20 mro_distributor tables described in schema.yaml.
5. Corpus size report: count of retrievable docs before (24) vs after — the chunker/loader
   that feeds the retriever must parse the extended files without error. Do not deploy or
   re-embed for production; a local parse/chunk run is sufficient.

## ADR
Append **D-033** to DECISIONS.md: MRO retrieval corpus design — 25-metric launch set
(selection rationale: spans all 5 subject areas + 2 cross-area), actionability fields
mandatory (formula+tables+grain), tenant tagging added corpus-wide with retriever-side
filtering deferred to Phase 4, parameterized metrics excluded (planner-agent backlog).

## Working style (hard rules)
- Verify in a PLAIN terminal; paste real output, not intent.
- Brief responses. No over-producing.
- If a visual check is needed, ask for a screenshot.
- Stop after the gates + ADR. Do NOT wire the retriever, do NOT redeploy, do NOT touch
  MotherDuck. Commit locally only if all gates pass, message:
  "feat: MRO retrieval corpus — schema+metrics for Tenant 2 (D-033)". Do not push.
