# AskERP — Architecture & Product Decisions

This document captures the meaningful decisions made during the build, in the format used by Architecture Decision Records (ADRs). Each entry includes context, options considered, decision, and tradeoffs.

## Decision Log

### D-001: Use DuckDB as the analytics warehouse
**Context:** Need a SQL warehouse for synthetic ERP data that runs locally and on Vercel.
**Options considered:** PostgreSQL (heavier), SQLite (limited analytics SQL), DuckDB (purpose-built for analytics, embedded), Snowflake/BigQuery (overkill, paid).
**Decision:** DuckDB.
**Tradeoffs:** Lightweight and fast for analytics queries; SQL dialect close enough to Snowflake/BigQuery to make the "scales to real warehouse" story credible. Limitation: not a real OLTP DB, so transactional workloads not demonstrable.

### D-002: Plain Anthropic SDK over LangChain
**Context:** Need to orchestrate LLM calls for NL→SQL, narration, and validation.
**Options considered:** LangChain (framework, resume keyword), LangGraph (newer agent framework), plain Anthropic SDK (direct calls, custom orchestration).
**Decision:** Plain Anthropic SDK.
**Tradeoffs:** More code to write (~300 lines of orchestration vs. fewer with LangChain), but easier to debug, faster to iterate, and a stronger interview talking point. LangChain reserved for future projects with multi-tool or multi-model needs.

### D-003: Multi-tenant architecture from the start
**Context:** Real ERP analytics products serve many customers. NSAW has 2000+. A single-customer demo doesn't tell that story.
**Options considered:** Single customer only (simpler), full multi-tenant SaaS (overscoped), hybrid: rich primary tenant + thin secondary tenants demonstrating the pattern.
**Decision:** Hybrid — Northwind Furniture as primary tenant with rich data, 2 thin tenants added in Week 4 to demonstrate the pattern.
**Tradeoffs:** +4-6 hours total; in exchange, the architecture genuinely scales and the interview answer for "how does this work for 2000 customers?" becomes credible.

### D-004: 3 years of historical data (Jan 2023 – Dec 2025)
**Context:** Need historical data with enough range for YoY comparisons and seasonality, but not so much that demos become unwieldy.
**Options considered:** 18 months (light, faster), 2 years (one YoY), 3 years (two YoY, default), 5 years (more trends but data bloat and dilution of planted anomalies).
**Decision:** 3 years.
**Tradeoffs:** Two YoY comparisons available, three Q4 peaks visible, planted anomalies remain visible against the dataset. Less long-term trend depth than 5 years, but better demo readability.

### D-005: Calendar fiscal year
**Context:** Northwind Furniture's fiscal calendar affects all date logic.
**Options considered:** Calendar year (Jan-Dec, simple), fiscal year ending June (NetSuite default, more realistic), fiscal year ending March (Indian companies).
**Decision:** Calendar year.
**Tradeoffs:** Simpler date logic in queries and demos; loses the "fiscal date awareness" demo angle (which can be added later as a feature).

### D-006: Star schema with NetSuite-shaped naming
**Context:** Schema design affects LLM accuracy and the "scales to real NetSuite" story.
**Options:** Normalized 3NF (OLTP-style), star schema (analytics standard), one-big-table (denormalized).
**Decision:** Star schema with NetSuite-shaped table names (transaction, transactionline-style).
**Tradeoffs:** LLMs handle star schemas significantly better — fewer joins, predictable patterns. NetSuite-shaped naming makes the "could this work on real NetSuite?" answer "yes, the shape matches."

### D-007: Synthetic data with planted anomalies
**Context:** Demo quality depends on whether the data tells a story or feels random.
**Options:** Random data, real-world data (compliance/privacy issues), synthetic with intentional patterns.
**Decision:** Synthetic with three planted anomalies (refund spike, whale customer churn, margin compression).
**Tradeoffs:** Demos become repeatable and memorable. Risk: anomalies must be subtle enough that the LLM has to actually find them, not so subtle the LLM misses them — calibration needed in Day 3.

### D-008: Multi-agent architecture over single-LLM or pure ML
**Context:** AskERP needs to translate natural language to data answers — requires intent understanding, schema mapping, safe SQL generation, causal reasoning, narration, and multi-turn context.
**Options considered:**
- Pure ML pipeline (NLU classifier + intent router + parameterized queries): brittle, requires labeled training data, can't generalize to new question types.
- Single LLM call with full schema in prompt: hits ~50-65% accuracy on hard NL→SQL benchmarks (BIRD), can't scale beyond ~50 tables, no validation/retry, opaque failures.
- Multi-agent decomposition (planner → retriever → generator → validator → executor → narrator): each agent specialized, independently evaluable, retry logic, scales architecturally.
**Decision:** Multi-agent decomposition. Each agent has a focused prompt, a defined contract, and independent evaluation.
**Tradeoffs:** Higher cost per query (~$0.02-0.05 vs $0.005 single-call), higher latency (3-6s vs 1-2s), more code to maintain. Mitigation: model tiering (Haiku for validator/critic, Sonnet for generator), parallelize where possible, eval suite catches regressions.
**Out of scope:** Forecasting, anomaly detection, classification — these are ML problems that a production system would solve with trained models, orchestrated by the agent. Demonstrating the orchestration pattern is sufficient for portfolio.

### D-009: DuckDB chosen over Postgres/SQLite for the warehouse
**Context:** Need an embedded SQL warehouse with strong analytical performance for the agent layer to query.
**Options considered:**
- SQLite: lightweight, ubiquitous, but optimized for transactional workloads — analytical queries (group bys, window functions) are slow
- Postgres: full-featured but requires a server, container, or hosted instance — adds deployment complexity for a portfolio project
- DuckDB: embedded like SQLite but built columnar and analytics-first; native Parquet/CSV loading; SQL dialect close to BigQuery/Snowflake/Postgres
**Decision:** DuckDB.
**Tradeoffs:** No multi-user concurrency (single-writer), but our use case is single-tenant-per-deploy. SQL dialect close enough to Snowflake that the architectural pattern transfers. File-based deployment fits Vercel serverless and local dev with no infra changes.

### D-010: Production-shaped loader pattern over quick load script
**Context:** The warehouse is the foundation of every agent decision in Week 2+. Reliability of the load directly affects agent reliability.
**Options considered:**
- Quick load (pandas.to_sql in a notebook): fastest to write, but no idempotency, no validation, no audit trail
- Production-shaped loader: idempotent, schema-driven DDL, FK validation, audit logging, 15-query verification suite
**Decision:** Production-shaped loader.
**Tradeoffs:** ~3x more code to write, but the verification suite catches data issues before they corrupt agent evaluation. The audit log gives reproducibility ("which load was used for which eval run"). The pattern is what an interviewer would expect to see in a real system, not a portfolio shortcut.

### D-011: Customer order distribution is uniform, not Pareto
**Context:** Verification check V15 revealed the top 5 customers all have nearly identical order counts (933-949 range). Real B2B data shows power-law / Pareto distribution where the top customer is typically 2-3x the 5th customer in volume.
**Options considered:**
- Inject Pareto distribution into customer-ordering frequency logic (more realistic, requires regenerating fact_sales_order)
- Accept uniform distribution and document the tradeoff
**Decision:** Accept uniform distribution.
**Tradeoffs:** Loses some realism in "top customers by volume" queries — answers will look flat. Does NOT affect the three planted anomalies (refund spike, whale churn, margin compression), which drive the primary evaluation signal. Honest acknowledgment in interviews positions this as a deliberate scope decision rather than an oversight. Could be added in extension as part of "realistic data noise" workstream.

### D-012: RAG (dense retrieval) over schema-in-prompt or agentic exploration
**Context:** The system needs to give the LLM the right schema/metric context for any natural-language question. Three patterns: schema-in-prompt (stuff everything), RAG (retrieve top-K), agentic exploration (LLM dynamically explores schema via tool calls).
**Options considered:**
- Schema-in-prompt: works for 9 tables (~3K tokens), fails at 50+. Simplest. No retrieval failure modes.
- RAG (dense or hybrid): scales to 100-200 tables. Industry standard for mid-size schemas (Snowflake Cortex Analyst, dbt Semantic Layer, Cube).
- Agentic exploration: scales to 1000+ tables. Higher latency and cost. Required for NSAW-scale schemas.
**Decision:** RAG, with hybrid + reranking added in Day 8. The 9-table demo is small enough that RAG is overkill, but the architecture matches what scales. Agentic exploration deferred to Week 3 as a planner capability when retrieval confidence is low.
**Tradeoffs:** RAG adds ~50ms latency per query and a dependency on the embedding model. In exchange: scales architecturally to 100+ tables without changes; retrievable failure modes are observable and measurable (recall@5); foundation for the planner agent's "explore vs. retrieve" decision in Week 3.

### D-013: Chunking at table-level and metric-level granularity (not column-level)
**Context:** RAG chunking strategy determines what units of context are retrievable. Choices range from per-column (fine-grained) to per-schema (coarse).
**Options considered:**
- Per-column: each column is a separate chunk. Maximum granularity but breaks schema integrity — retrieval can mix columns from different tables, generating incoherent context for SQL generation.
- Per-table + per-metric (current choice): each chunk is one queryable concept. Tables include their full column list; metrics include synonyms and example questions.
- Per-domain: chunks group multiple related tables/metrics. Lower retrieval precision; useful for very large schemas as a first-pass filter.
**Decision:** Per-table for schema, per-metric for semantic layer.
**Tradeoffs:** Each chunk is larger (~500-800 chars) so embedding the whole corpus takes more compute upfront. In exchange: retrieved chunks are coherent, complete units. SQL generation never sees a half-table context. For schemas with 1000+ tables, per-domain pre-filtering would be the next step.

(More decisions will be added as we build.)

## Stress-Test Record: Day 7 Naive Dense Retriever

### Eval setup
20 hand-curated questions across 4 difficulty tiers (5 each: EASY, MEDIUM, HARD, EDGE). Retrieval against schema (9 tables) + metrics (15) using all-MiniLM-L6-v2 + cosine similarity. No reranking, no BM25, no query expansion.

### Headline numbers
- Top-1 accuracy on HARD (correct metric/table retrieved): 4/5 = 80%
- Top-1 accuracy on EDGE (graceful failure behavior): 5/5 = 100%
- Real misses on meaningful queries: ~1-2 out of 15
- Avg retrieval latency: 134ms per query

### Failure modes observed (each maps to a Day 8 design target)

**1. Universal score deflation (calibration).** No query scored above 0.7 even when retrieval was correct (Q15 hit bullseye at 0.60). all-MiniLM-L6-v2 produces calibrated scores in 0.2-0.7 range for short-query-long-doc cases. The 0.7 absolute threshold was wrong — relative confidence (top-1 vs top-2 gap) is the better signal.

**2. Domain-knowledge gap (Q14).** "Which suppliers had quality issues" retrieved 'cogs' instead of 'cancellation_rate'. The connection "quality issues → cancellations → supplier" requires domain knowledge not present in technical descriptions. Fix: weight example_questions and synonyms in retrieval embedding.

**3. Semantic ambiguity (Q18).** "Show me sales" returned plausible candidates within 10% of each other (revenue, order count, fact table). Bi-encoder cannot disambiguate. Fix: cross-encoder reranker.

**4. Entity-level queries (Q16, deferred).** "Tell me about Hilton" — Hilton is a data value, not a schema element. Schema RAG fundamentally cannot answer this. Out of Day 8 scope; addressed via separate entity retriever in Week 3.

**5. Graceful degradation (Q17, Q20, Q19).** Out-of-domain and empty queries scored 0.06-0.27 across all candidates. This is correct behavior — gives the planner a clear signal to refuse. Confidence-based refusal is graceful degradation, not failure.

### Day 8 design targets (driven by these observations)

- Hybrid retrieval (BM25 + dense) — addresses #2
- Cross-encoder reranker — addresses #3
- Query expansion via synonyms — addresses #2
- Relative confidence thresholds — addresses #1
- Entity retriever — deferred to Week 3 (separate architectural pattern)

### Honest framing for interviews

"On my eval set, dense-only retrieval achieved 80% top-1 accuracy on hard multi-concept queries, 100% graceful degradation on edge cases, and 1-2 real misses. The 0.7 confidence threshold I started with was wrong for the embedding model — switched to relative confidence between top-1 and top-2. Day 8's hybrid retrieval, reranking, and example-question weighting target the specific failure modes I observed, not theoretical problems."


### D-014: Hybrid retrieval (BM25 + dense) via Reciprocal Rank Fusion
**Context:** Day 7 dense-only retrieval missed Q14 ("Which suppliers had quality issues?") because the connection between "quality issues" and "cancellations" requires domain knowledge not in technical descriptions.
**Options considered:**
- Dense only (Day 7 baseline): captures synonyms but misses exact-match terms and out-of-vocabulary domain phrases.
- BM25 only: captures keywords but misses synonyms (e.g., "top line" → "revenue").
- Hybrid via RRF (Reciprocal Rank Fusion): combines rankings from both retrievers without needing to normalize scores across retrievers.
**Decision:** Hybrid via RRF with k=60 constant.
**Tradeoffs:** Doubles indexing memory (BM25 + dense embeddings). Slightly more complex to debug — when retrieval is wrong, need to inspect both sub-rankings. In exchange: BM25 catches exact-match terms (table names, SKUs, supplier names) that dense embeddings dilute. Production NL→SQL systems (Snowflake Cortex, Cube) use hybrid for this exact reason.

### D-015: Cross-encoder reranking on top-10 fused results
**Context:** Day 7 query "Show me sales" returned plausible but ambiguous candidates within 10% of each other (revenue, order_volume, fact_sales_order). Bi-encoder retrieval cannot disambiguate at retrieval time.
**Options considered:**
- No reranker: accept ambiguity at retrieval time.
- LLM-based reranker (use Claude to re-score): expensive, slow.
- Cross-encoder (ms-marco-MiniLM-L-6-v2): small, fast, runs on CPU.
**Decision:** Cross-encoder on top-10 fused results.
**Tradeoffs:** +50-100ms latency per query (10 cross-encoder passes vs zero before). In exchange: cross-encoder uses full attention between query and document — much more precise for ambiguous cases than cosine similarity over independently-embedded vectors.

### D-016: Relative confidence (top1-top2 gap) over absolute thresholds
**Context:** Day 7 eval showed all-MiniLM-L6-v2 produces scores in 0.2-0.7 range for short-query-long-doc cases. The 0.7 absolute threshold was wrong — no query crossed it even when retrieval was bullseye (Q15 hit correct at 0.60).
**Options considered:**
- Stick with absolute threshold: easy but uncalibrated.
- Per-model threshold tuning: requires manual calibration per model.
- Relative confidence (gap between top-1 and top-2): self-calibrating.
**Decision:** Relative confidence with HIGH/MEDIUM/LOW/VERY_LOW bands based on top-1 score AND top1-top2 gap. Cross-encoder logits sigmoid-normalised to [0,1] before band computation.
**Tradeoffs:** Slightly more complex to explain. In exchange: works across embedding models without retuning. Correctly classifies out-of-domain queries (Q17 "weather") as VERY_LOW even when top-1 absolute score isn't pathologically low.

### D-017: Accept Q11 regression in hybrid retriever; defer fix to planner agent
**Context:** Day 8 hybrid retriever (BM25 + RRF + cross-encoder reranker) improved 2 queries (Q7, Q14) but regressed Q11 ("Why did West region revenue drop in Q4 2024?"). Naive correctly returned revenue_growth_yoy; hybrid returned top_customer_concentration.
**Root cause:** Q11 is a compound query asking about (a) revenue, (b) a specific region, (c) a specific time period, AND (d) causal reasoning. BM25 over-weighted "West" and "Q4" lexically; the metric description for top_customer_concentration explicitly references the Hilton/Marriott Q4 2024 whale-churn scenario in the West. The hybrid retriever correctly identified a relevant story but the wrong primary metric.
**Options considered:**
- Tune BM25 weights down → likely regresses Q14 (the supplier fix that BM25 enabled).
- Add query rewriting via LLM before retrieval → moves complexity into Week 3 anyway.
- Accept the regression; let the Week 3 planner agent decompose compound queries.
**Decision:** Accept. Compound queries are a planner-layer problem, not a retrieval-layer problem.
**Tradeoffs:** Q11 retrieves a defensible-but-not-primary metric in single-pass retrieval. The Week 3 planner will decompose: "first what's the metric (revenue)? Then what's the breakdown (region, time)? Then what explains the result (concentration, churn)?" Each sub-query goes through retrieval separately. This is the correct architectural location for compound-query handling — retrieval optimizes for direct-match queries, planner handles compound intent.

---

## D-018: Subprocess-based SQL generator (Python from TypeScript)

**Context:** The SQL generator is a Python agent using the Anthropic SDK. The Next.js API route is TypeScript. We need to call the Python agent from within the Next.js route handler.
**Options considered:**
- Direct TypeScript Anthropic SDK call with schema-in-prompt: would duplicate the Python prompt, lose the few-shot examples, require reimplementing the SQL generation logic.
- REST microservice (FastAPI for SQL generator too): adds operational complexity — two Python services to manage instead of one.
- Spawn Python subprocess from Node: simple, zero extra service, leverages existing sql_generator.py as-is.

**Decision:** Spawn Python subprocess, pass question+chunks via stdin as JSON, read SQL response from stdout.
**Tradeoffs:** Slightly higher latency (subprocess start ~100ms) but avoids maintaining duplicate prompt logic in two languages. Shell-injection-safe via stdin rather than argv. Timeout guarded at 30s. Acceptable for a portfolio demo context.

---

## D-019: @duckdb/node-api for direct DuckDB access from Next.js

**Context:** The semantic layer runs on a DuckDB file (`data/northwind.db`). We need to execute SQL from the Next.js API route.
**Options considered:**
- Shell out to `duckdb` CLI: requires duckdb binary on PATH, parses text output, fragile.
- @duckdb/node-api (official Anthropic-recommended Node bindings): native `.node` addon, requires webpack externalization.
- Better-sqlite3 or pg: would require exporting DuckDB → SQLite/Postgres, losing DuckDB's columnar/analytical advantage.

**Decision:** Use @duckdb/node-api with `serverComponentsExternalPackages: ['@duckdb/node-api']` in next.config.mjs.
**Tradeoffs:** Requires Next.js config change to prevent webpack from bundling the native addon. DuckDB DECIMAL values return as `{value: BigInt, scale: number}` objects requiring custom deserialization in a `sanitize()` helper. Read-only mode (access_mode: "READ_ONLY") protects the data file from accidental mutation.

---

## D-020: Workbench layout over conversational chat

**Context:** Day 9 UI direction.
**Options considered:**
- Conversational chat (industry-standard, easy multi-turn)
- Workbench with insight tabs (Auto Analysis pattern, deep-dive feel)
- Hybrid (chat thread with rich cards)

**Decision:** Workbench layout with warm palette inspired by Auto Analysis (Crux), adapted for AskERP. Left sidebar holds history + input; main area has dark AnalysisHeader, tab strip, and Change tab with a two-column insights/data layout.
**Tradeoffs:** Multi-turn requires the sidebar to load past questions and re-render the workbench. In exchange: each question gets full screen real estate for tabbed depth (Change/Contribution/Trend/Drivers). Aligns with how analyst tools work (Tableau, ThoughtSpot, Auto Analysis).

---

## D-021: Sentiment metadata on metrics for narration tone

**Context:** Growth in revenue is favorable; growth in refunds is unfavorable. Without metadata, every increase is implicitly "good" in narration.
**Options considered:**
- Hardcode in narrator (brittle)
- Infer from metric description via LLM (slow, costs tokens)
- Explicit metadata field (deterministic)

**Decision:** Add `sentiment` field (positive/negative/none) to each metric in data/metrics.yaml.
**Tradeoffs:** Requires per-metric curation. In exchange: narration tone and badge colors are deterministic, fast, and auditable. Same pattern as Auto Analysis's "Sentiment" configuration. The SQL generator receives this via retrieved context and echoes it back in the response JSON.

### D-022: Hide Drivers and Trend tabs in Week 4 demo; rebuild Drivers as full KDA in Week 5

**Context:** Day 9-11 shipped 4 insight tabs inspired by Auto Analysis (Change, Contribution, Trend, Drivers). On live testing, Drivers returned dimensional decomposition (customer segment / category / region breakdown) rather than true driver analysis. This duplicates Contribution and mismatches the tab name. Trend tab is functional but underdeveloped for current synthetic data.

**Options considered:**
- Ship as-is with both tabs visible: risk of interview probes catching the Drivers/Contribution overlap.
- Rename Drivers to "Breakdown": resolves naming but loses the Auto Analysis-pattern story.
- Hide both tabs and rebuild Drivers as proper KDA in Week 5.
- Build full Key Driver Analysis now with synthetic Northwind marketing-mix data and statsmodels regression pipeline: ~3 days, delays reliability work.

**Decision:** Hide Trend and Drivers tabs in the demo. Keep underlying files and API routes intact. Sequence reliability work (validator, retry, evals, observability) before rebuilding Drivers as full statsmodels-based KDA in Week 5.

**Tradeoffs:** Two fewer visible tabs in the demo. In exchange: the demo shows only what works confidently. Each visible tab (Change, Contribution) has clear semantic meaning matching its name. Sequencing reliability before KDA means interview answers about quality, evals, and hallucination defense come first — those get probed more often than insight-engine depth.

**Week 5 rebuild plan for Drivers:**
- Synthetic Northwind marketing-mix driver data (sales spend, lead response time, competitor price index, seasonality, trade shows)
- statsmodels OLS pipeline with VIF, ADF, Breusch-Pagan, Durbin-Watson, standardized coefficients
- Agent calls regression as a tool — not LLM-generated correlations
- Sentiment-aware narration of ranked drivers

### D-025: Redwood-inspired light theme over dark neon theme

**Context:** The original AskERP UI used a dark theme with neon-green/purple accents. While visually striking in a thumbnail, it read as a generic "AI demo" rather than enterprise analytics software, undermining the positioning of AskERP as a NetSuite-adjacent product.

**Options considered:**
- Keep dark neon theme: distinctive but reads as portfolio toy, fights the "built in NetSuite" story.
- Generic light SaaS theme (teal fintech): clean but no Oracle DNA.
- Classic NetSuite gray: authentic but dated, utilitarian.
- Redwood-inspired (Oracle's current design system): warm neutrals, brick-red brand, modern card structure.

**Decision:** Redwood-inspired light theme. Teal (#0F6E56) as the primary interactive color, Oracle brick-red (#A53725) reserved for the brand mark only, warm off-white canvas, white surfaces. Sentiment colors (green/red) kept distinct from brand red.

**Tradeoffs:** Less "flashy" in a portfolio thumbnail than dark neon. In exchange: reads as credible enterprise software, aligns to Oracle's actual design direction (defensible interview story — "I aligned to Redwood, the design system NetSuite is migrating to"), and makes dense financial data more legible. Brand-red vs sentiment-red collision resolved by using teal for all interactive elements and two distinct red shades.

### D-026: App shell with persistent navigation + inhabited empty state

**Context:** The original empty state was a near-empty canvas with a centered hero and two ambiguous cards. No persistent navigation. It read as an early prototype, not a product.

**Decision:** Add a left nav rail (Ask active; Dashboard/Saved/Data as structural stubs) and a top header with brand + context. Replace the empty void with an inhabited landing: search, suggested chips, a live data-overview card (real warehouse stats via /api/warehouse-stats), and recent analyses.

**Tradeoffs:** Dashboard/Saved/Data nav items are non-functional stubs in the demo — structural signals, not working features. The data-overview card adds a DB query on landing (cached 60s). In exchange: the product reads as real enterprise software with navigational structure and a canvas that feels connected to live data.

---

### D-027: Port retrieval to TypeScript with Voyage AI embeddings for serverless live path

**Context:** The Python hybrid retriever (retriever/hybrid_retriever.py) uses sentence-transformers + rank_bm25 + a cross-encoder reranker — none of which can run on Vercel serverless (binary native addons, Python runtime requirement). The retriever was standalone and not wired into /api/ask.
**Options considered:**
- Keep Python retriever + proxy via an always-on service (Railway, Fly.io): adds infra complexity, cold-start latency, extra cost, and a single-point-of-failure dependency.
- Port to TypeScript + serverless-safe embedding API: all logic runs in-process on Vercel, no external service dependency; embedding API latency replaces model load latency.
- Use OpenAI/Cohere embeddings: possible but Voyage was already used in Python experiments and voyage-3-lite is optimized for retrieval at low cost.
**Decision:** TS port with Voyage AI (voyage-3-lite) for dense embeddings via REST, hand-rolled BM25 Okapi for sparse, RRF (k=60) for fusion. Reranker dropped — no serverless-friendly cross-encoder; cross-encoder was the last step in the Python pipeline and required native binaries.
**Tradeoffs:** +~200–400ms per request for Voyage embedding API call vs. local model inference; corpus embeddings cached in module memory across warm invocations (cold start embeds all 24 docs). Reranker dropped reduces ranking quality at the margin; RRF alone is sufficient for a 24-doc corpus. Env var `USE_RETRIEVAL` gates the prompt path for A/B comparison without a deploy.

---

### D-028: schema-in-prompt swap (commit 8ad9de0) — retroactive log

**Context:** An earlier commit (8ad9de0) swapped the SQL generator from retrieved-context prompting to full schema-in-prompt without a logged decision. This retroactively documents that change for honest history.
**Decision made at commit 8ad9de0:** Use full schema.yaml + metrics.yaml in the system prompt rather than retrieved chunks. This was the pragmatic unblocking step when the Python retriever was stranded.
**Tradeoffs:** Full-schema prompt works reliably for the current 9-table DB. Token cost grows linearly as schema grows; retrieval becomes necessary at ~20+ tables to keep prompts manageable. D-027 (this session) restores the retrieval path and gates it behind `USE_RETRIEVAL` for controlled comparison.

---

### D-029: Multi-tenant isolation via schema-per-tenant

**Context:** AskERP's warehouse must serve multiple tenants (D-003 committed to multi-tenancy from the start). Tenant 2 (MRO distributor) is being added as the main demo; Northwind Furniture is retained as Tenant 1.
**Options considered:** Separate DuckDB files per tenant (isolation but no cross-tenant conformity story), one shared schema with tenant_id columns (row-level isolation, leaky), schema-per-tenant in one DuckDB file.
**Decision:** Schema-per-tenant. Northwind = Tenant 1 (currently the `main` schema), MRO = Tenant 2 (`mro_distributor` schema), same DuckDB file. Mirrors NSAW's per-instance isolation model; subsidiary is a within-tenant dimension, not a tenant boundary.
**Tradeoffs:** One file grows large (187MB+ with MRO), motivating D-032. In exchange: hard namespace isolation per tenant, no tenant_id predicate to forget, and the "how does this scale to 2000 customers" answer stays structural. Note: the Northwind persona is retired as the demo narrative, but the tenant is retained as the multi-tenancy basis.

### D-030: Subject-area-prefixed naming + conformed dimensions (NSAW-shaped)

**Context:** The MRO warehouse needed a naming/structure convention that reads as NSAW rather than a toy star schema.
**Options considered:** Flat naming (Northwind-style dim_/fact_), subject-area schemas (o2c.*, p2p.* — over-nested for DuckDB), subject-area table prefixes within one tenant schema.
**Decision:** 8 conformed dimensions (dim_date, dim_item, dim_customer, dim_supplier, dim_warehouse, dim_gl_account, dim_employee, dim_subsidiary) shared across 12 facts prefixed by subject area: o2c_, ar_, p2p_, inv_, gl_ — 20 tables across 5 NSAW subject areas. 20 by design, not ~25-35: breadth without filler tables.
**Tradeoffs:** Prefixes make table names longer. In exchange: cross-subject-area joins flow through conformed dims (the killer-query pattern), retrieval chunks can carry subject-area context, and the schema is large enough that schema-in-prompt stops being viable — which is the point (root problem behind D-028).

### D-031: Synthetic data carries planted, correlated business signal

**Context:** Random-but-correctly-shaped data cannot demonstrate causal analytics. The MRO tenant (NA B2B MRO distributor persona, ~$300M revenue, 18 months from 2024-07, SEED=42) needed data where a real question has a real, discoverable answer.
**Decision:** Generator plants a supplier→cash causal chain — supplier reliability_tier A→D drives PO late_days (gamma, mean 0.5/2.5/8/16d) → stockouts → inflated order_to_ship_days → invoice at ship date → higher DSO — plus business realism: supplier spend Pareto (lognormal; top 20% ≈ 74% of spend), customer revenue Pareto (top 20% ≈ 63%), category-differentiated margins (Fasteners 21% → MRO 43%), payment heterogeneity (15% chronic slow payers: 61d vs 41d weighted DSO), SKU velocity classes A/B/C, ~8% YoY growth with Q4 uplift and weekend dips.
**Verified (2026-07-17, db_rebuild/verify_mro.py, all pass):** 20 tables, 2.33M rows, $298M annualized revenue, DSO 44d, DPO 39d, DIO 85d, CCC 89d, and a monotonic killer-query gradient A→D (late_days 0.1→15.1, stockout 2.7%→13.3%, order-to-ship 2.0→7.0d) joining P2P+INV+O2C+AR through conformed dims.
**Deviations from the clean-room reference:** one tuning change — vendor bill payment slack +2d (pay slightly past terms) to bring CCC from 91d into the ≤90d band; DPO stayed in its 35-45d target. DB path wired from build/askerp.duckdb to data/northwind.db per integration spec.
**Note:** This is a deliberate departure from D-011 (Northwind's uniform-not-Pareto customer distribution). Realism is required for the MRO demo tenant; D-011 stands for Northwind. Architecturally this fulfills the multi-tenant basis laid down in D-003.

### D-032: Warehouse hosting = MotherDuck (storage/compute separation)

**Context:** The combined DuckDB file is now ~200MB with the MRO tenant loaded. Vercel serverless functions cannot bundle it (northwind.db at 14MB could be committed and bundled; the MRO-loaded file cannot).
**Options considered:** Commit the large file anyway (bloats repo, exceeds serverless bundle limits), always-on DB service (Postgres etc. — loses DuckDB dialect, adds infra), MotherDuck (DuckDB-native cloud with storage/compute separation).
**Decision:** MotherDuck for deployment. DuckDB dialect preserved; serverless-safe via thin client / Postgres-protocol endpoint — no native binary, the same constraint class D-027 solved for embeddings. DB files are gitignored (`*.duckdb`); local dev may still use the local file.
**Tradeoffs:** Adds a hosted dependency and network latency to the query path. This ADR logs the decision only — wiring MotherDuck is a separate later step, not part of the warehouse build.

### D-033: MRO retrieval corpus — 25-metric launch set with mandatory actionability fields

**Context:** Phase 3 extends schema.yaml and metrics.yaml so retrieval can describe the MRO tenant (20 tables, D-029..D-032). The June RAG-reconnect lesson: a metric that is findable but not actionable (missing/vague formula) retrieves fine and then fails at SQL generation.
**Decision — launch set:** 25 metrics spanning all 5 subject areas — O2C (6), AR (5), P2P (5), INV (5), GL (2) — plus 2 cross-subject-area working-capital metrics (cash_conversion_cycle_days and supplier_lateness_cash_impact, the killer P2P→INV→O2C→AR diagnostic). Selection favors breadth across subject areas over depth in any one, so every retrieval domain has coverage.
**Decision — actionability mandatory:** every MRO metric entry carries formula (runnable DuckDB SQL against mro_distributor.*), tables, and grain inside the entry. Every MRO schema entry carries purpose, grain, schema qualifier, and FK join paths to conformed dimensions. All 25 formulas were executed against data/northwind.db before shipping (25/25 pass; anchors: $298M annualized revenue, DSO 44d, DPO 39d, DIO 83.5d, CCC 88d, monotonic A→D supplier gradient). No formula shipped unexecuted.
**Decision — tenant tagging:** every table and metric entry in both files now carries a `tenant` field (northwind | mro), added corpus-wide. Retriever-side tenant filtering is deferred to Phase 4 — this phase only tags. metric_domains entries are left untagged (domains are shared vocabulary, not retrievable chunks). Known Phase 4 item: chunk IDs are keyed by bare name, so 6 IDs now collide across tenants (4 conformed dim names + total_revenue + gross_margin_pct); tenant-prefixed chunk IDs or tenant filtering resolves this.
**Decision — parameterized metrics excluded:** all 25 formulas run without placeholder substitution (full-history aggregates, latest-snapshot filters, or bottom-quantile logic instead of {current_year}-style templates). Period filtering is injected by the agent layer, matching the Northwind convention. Metrics that inherently need parameters (e.g., churn against a period boundary) are planner-agent backlog, alongside the 3 templated Northwind metrics.
**Tradeoffs:** Full-history formulas answer "over all loaded data" by default — correct for a demo corpus, but period-scoped questions rely on the agent layer to inject date filters. Corpus grows 24 → 69 docs; retrieval precision under the larger corpus is Phase 4's problem to measure (the point of scaling the warehouse was to make retrieval necessary).

### D-034: True OTIF via additive promised_ship_date_key

**Context:** OTIF (on-time and in-full) is distribution's canonical service metric, but the MRO schema had no customer promise date — order_to_ship_days measured speed with no baseline to miss against.
**Decision:** Add `promised_ship_date_key` to `mro_distributor.o2c_sales_order_line` additively — no regeneration of ship dates, orders, AR, or GL. Promise = order date + lead-time-class offset (Short 2d / Medium 3d / Long 4d) + 0-1d seeded noise, clamped to the date spine. The noise comes from a dedicated `default_rng(42)` stream drawn in so_line_key order, in both the local patch (db_rebuild/patch_otif.py) and the generator, so a fresh regeneration reproduces the column exactly without perturbing the main RNG stream (every other table stays byte-identical to pre-OTIF generations).
**Verified (2026-07-17, plain terminal):** overall OTIF 78.1% (target band 75-90%); by source-supplier reliability tier: A 91.4% > B 77.6% > C 36.3% > D 5.7% — monotonic, A-D gap 85.7 points (gate ≥15). The existing hurt-chain propagated naturally; no offset tuning was required. `otif_pct` metric added to metrics.yaml (26 MRO metrics), formula executed at 78.1%; the new column was added to the o2c_sales_order_line schema.yaml entry to keep the corpus truthful.
**Cloud sync:** only the changed table re-uploaded to MotherDuck (`CREATE OR REPLACE TABLE askerp.mro_distributor.o2c_sales_order_line AS SELECT * FROM localdb...`); cloud vs local parity verified — 153,672 rows and OTIF 78.1144% on both.
**Tradeoffs:** In-full is structurally always satisfied in current data (the generator ships full quantities), so OTIF misses are entirely lateness- or never-shipped-driven; a qty-short mechanism is future realism work. Promise offsets are class-based rather than per-item negotiated dates — simpler, and sufficient for the planted signal to surface.
