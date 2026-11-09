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

### D-035: Per-tenant retrieval isolation — tenant-prefixed chunk IDs, filter before rank

**Context:** After D-033 the corpus held 70 docs from two tenants in one pool, with 6 chunk IDs colliding across tenants (bare-name keying). A query under one tenant could retrieve the other tenant's chunks — wrong context for SQL generation and a data-governance smell.
**Decision — ID scheme:** every chunk ID is tenant-prefixed at build time: `mro:dso_days`, `northwind:total_revenue`. A build-time assertion throws on any duplicate ID, so collisions are structurally impossible rather than merely absent (the type segment was dropped from IDs; `tenant` and `type` remain fields on the chunk).
**Decision — filter before rank:** `retrieve(query, k, tenant?)` selects a per-tenant index built at init: the tenant's chunks, its slice of the (single-call) corpus embeddings, and a per-tenant BM25 index. Ranking never sees another tenant's docs, and BM25 IDF statistics are tenant-local — filtering after ranking would still let cross-tenant docs shape scores.
**Decision — default tenant:** `ACTIVE_TENANT` env var, falling back to 'mro' (the main demo tenant). The `/api/ask` call site is unchanged (optional param). App-side tenant switching is future work, deliberately not built now.
**Verified (2026-07-17, plain terminal):** 11 probes (10 spec probes + default-tenant path) including "total revenue" under both tenants and two "furniture" leak probes under mro — zero cross-tenant results; furniture probes correctly resolve to mro chunks (gross_margin_pct, dim_item) at LOW confidence instead of leaking Northwind furniture chunks. Typecheck clean. Probe script committed at scripts/probe_tenant_isolation.ts.
**Tradeoffs:** Per-tenant BM25 indexes duplicate index memory per tenant (trivial at this scale). Unknown tenants throw rather than falling back — loud beats silently searching the wrong tenant.

### D-036: 40-question retrieval benchmark — 4 tiers, 4 modes, dual rubric, ground-truth-first

**Context:** The MRO rebuild's purpose was to make retrieval architecturally necessary; this benchmark measures whether it actually earns its keep against schema-in-prompt, with evidence instead of intuition.
**Design:** 40 locked questions (10 simple / 12 medium / 14 hard / 4 controls) × 4 modes — bm25-only, dense-only (Voyage), rrf (production hybrid), and schema (full 46-doc corpus in prompt) — all through Haiku (`claude-haiku-4-5-20251001`, the production SQL model), identical prompts except the context block, top-k 5. Ground truth was hand-authored and executed BEFORE any model run (36/36 SQL in benchmark/ground_truth.json), with H-tier answers sanity-gated against the planted signal (C/D culprits, DIO-dominant CCC, flat Q4 stockouts, zero short-shipments) — all 8 checks passed. Dual rubric: R (retrieval quality 0-5, mechanical from per-question expected-chunk lists) and A (answer quality 0-3, executed-result vs ground truth at 1% numeric tolerance with entity matching). Every run checkpointed to benchmark/results.jsonl; REPORT.md generated from it by script. 160/160 runs, $0.98 total.
**Headline numbers:** S-tier is solved by every mode (mean A 2.8-3.0 — in-chunk formulas do the work). M-tier: A ≈ 2.0-2.25 across modes. H-tier is where truth lives: **rrf (A 0.71) did NOT beat schema-in-prompt (A 0.79)** — top-5 retrieval can miss tables a cross-subject-area query needs — and dense-only was actually best (A 1.21, SQL validity 64% vs rrf 36%). Retrieval's win is economics and architecture, not H-tier quality at this corpus size: rrf used ~7x fewer input tokens than schema mode (78.6K vs 585K). Controls 16/16 — zero cross-tenant chunks in every retrieval run (D-035 held under load). Negative results reported plainly, not spun.
**Known limitations (logged, not hidden):** single model, single top-k, no sweeps; LLM-free mechanical R-scoring is coarse because D-033 chunks are actionability-complete; A-scoring accepts one ground-truth framing per question, so H-tier scores are lower bounds (a defensible alternative analysis scores A=1); C01/C02 partly measure the D-035 design rather than model behavior. Phase 5 candidates: top-k sweep for H-tier (the miss pattern suggests k=5 is the binding constraint), planner-agent decomposition for compound queries (D-017's deferred fix), and a stronger generation model on H-tier only.

### D-037: Production backend — MotherDuck via Postgres wire protocol, MRO tenant, dense retrieval default

**Context:** The live Vercel deploy still bundled data/northwind.db and ran retrieval un-tenanted; D-032 put the warehouse in MotherDuck (database `askerp`) and D-036 picked a production retrieval mode. This closes the loop: production reads the cloud warehouse, defaults to tenant `mro`, and ranks with the mode the benchmark actually won.
**Decision — DB access layer:** `lib/db.ts` switches on `MOTHERDUCK_TOKEN` presence: unset → local file (`@duckdb/node-api`, unchanged); set → MotherDuck's Postgres wire-protocol endpoint (`pg.us-east-1-aws.motherduck.com:5432`, database `askerp`) via the `pg` npm package — serverless-safe, no native DuckDB binary in the Lambda. One `executeSQL(sql)` interface; call sites never know which backend answered. `pg`'s Postgres wire protocol returns int8/numeric as strings by default (precision-safety) and dates as UTC-midnight `Date` objects; three `pg.types.setTypeParser` overrides (OIDs 20, 1700, 1082) normalize both backends to the same output shape (`Number`, `'YYYY-MM-DD'` string) so no downstream code branches on backend.
**Decision — no SQL rewriting needed:** both backends host identical schemas (`main` = Northwind, `mro_distributor` = MRO) inside one database/file, so schema-qualified SQL (`mro_distributor.<table>`) is byte-identical on both paths. Zero dialect gaps surfaced in testing — the stop-and-report trigger in the build prompt was never hit.
**Decision — connection reuse:** the `pg.Pool` is a module-scope singleton (`max: 3`), created lazily on first query and reused across warm invocations of the same serverless instance — never per-request, since MotherDuck compute is metered.
**Decision — retrieval mode:** `RETRIEVAL_MODE` env var selects the ranker (`bm25` | `dense` | `rrf`), read once at module load in `app/api/ask/route.ts`; unset or invalid falls back to `rrf` (the pre-D-037 default), never crashes. Production sets `RETRIEVAL_MODE=dense` — the D-036 benchmark winner on H-tier (A 1.21, 64% SQL validity vs rrf's 0.71/36%). `bm25`/`rrf` paths are untouched; the benchmark harness still exercises all three via `retrieveWithRanker`.
**Fix discovered mid-build (necessary plumbing, not scope creep):** `lib/sqlGenerator.ts` was still 100% hardcoded to the Northwind schema (system prompt, rules, few-shot all referenced `fact_sales_order`) despite the retriever already defaulting to tenant `mro` since D-035 — the live app would have generated broken SQL against MRO chunks. Added tenant-aware `SYSTEM_BASE`/`SYSTEM_RULES`/few-shot (mro variant mirrors the benchmark's winning prompt shape) and threaded `tenant` through `generateSQL`; also fixed the `USE_RETRIEVAL=false` full-schema fallback, which previously dumped **both** tenants' raw YAML into one prompt — now filtered per tenant. Northwind path re-verified unchanged.
**Verified (2026-07-18, plain terminal, both backends, local DB file physically renamed away for every cloud-path query):**
| Query | Local result | Cloud result | Local DB-exec ms | Cloud DB-exec ms |
|---|---|---|---|---|
| Total revenue | $447,163,502.40 | identical | 28 | 2,432 |
| OTIF by warehouse | Atlanta Branch 78.67% | identical | 36 | 658 |
| H03 (late-but-fast-paid suppliers) | Supplier 097, 15.24 late days, paid 32.03d vs 39.24d avg | identical | 215 | 1,365 |

Cloud DB-exec p50 = 1,365ms, under the 3s flag threshold. All retrieved chunks `mro:*` only on every run (D-035 isolation held over the real MotherDuck connection). End-to-end latency (5.3-10.8s) is dominated by the two LLM calls on both backends equally, not a cloud-specific cost. Two SQL-generation hiccups (an ambiguous-column binder error, a zero-row H03 from a flawed correlated subquery) were observed on an earlier attempt and reproduced as stochastic Haiku variance on retry — not a regression, not a dialect issue, matches D-036's documented H/M-tier SQL-validity rates exactly.
**Incident (logged for the record):** mid-build, a diagnostic `sed` command using `&` in a replacement (which expands to the whole matched line, not the captured group) printed the MotherDuck token in full to tool output. Caught immediately, work paused, user rotated the token in MotherDuck and re-entered it in both `.env.local` and Vercel before the build resumed. No token value appears in this repo, any commit, or this file.
**Live deploy verification (2026-07-18, commit 373e7b0, plain terminal, real HTTP against askerp.vercel.app):** S02 "What is our current DSO?" → 44.02 (exact ground-truth match), `retrieval_ranker: dense`, chunks `mro:*` only, execution_time_ms 581. M08 "top 10 suppliers by spend?" → Supplier 021 $69,129,229.98 (exact ground-truth match), same ranker/tenant confirmation, execution_time_ms 252. Both total_time_ms under 6s.
**Deploy debugging detour (logged, both resolved, worth remembering):** (1) `MOTHERDUCK_TOKEN` set correctly in Vercel's dashboard didn't reach the function on the first attempt — root cause unconfirmed (likely a stray character in the key name on the first save), fixed by deleting and re-adding the variable fresh, then redeploying; a temporary env-presence diagnostic route (booleans only, no token values) isolated this to the one variable rather than a general config problem before the fix. (2) That diagnostic route itself then gave a false negative after the fix — it had no request-derived data, so Next.js statically optimized it and Vercel's edge served a cached response frozen from first build; adding `export const dynamic = "force-dynamic"` fixed it. Neither issue touched `/api/ask` itself, which was dynamic (confirmed via the build's `ƒ` marker) and never subject to the caching bug — its failures during the detour were the real (if temporary) env-var problem, not an artifact. The diagnostic route was deleted once its job was done.
**Tradeoffs:** `pg.Pool` max 3 is a guess tuned for a single low-traffic serverless instance, not load-tested. Postgres-wire error messages surface DuckDB's binder text verbatim (e.g. "Ambiguous reference to column name...") — acceptable for now since `sql_execution_failed` responses aren't user-facing prose.

### D-038: Realism pass — entity names + narrator voice + demo identity

**Context:** Placeholder names ("Supplier 021", "Customer 059"), a Northwind-branded shell serving MRO data, and raw-figure narration were the last "toy project" tells a hiring manager would spot in seconds. Two workstreams: real entity names (data) and demo-credibility polish (output + UI). No schema, key, or metric changes — names are pure labels; all joins stayed on numeric keys throughout.
**Decision — deterministic name banks:** `db_rebuild/gen/realism_names.py` holds pure, side-effect-free name-generation functions — region-flavored suppliers (domestic geo-prefix banks per US region + Import-APAC city bank + Import-EU DE/IT/Nordic banks), segment-flavored customers (Manufacturing/Construction/Facilities/Government), diverse ordinary employee names. A dedicated `rng_names = np.random.default_rng(42)` stream (shared `used`-name set, cartesian-product-then-shuffle for guaranteed uniqueness) never touches the main generator's `rng` object — every existing `rng.choice`/`rng.lognormal` call was extracted to a named variable in its *original relative position* in `generate_mro_v2.py`, so the main stream's draw sequence, and therefore every other generated column, stays byte-identical to pre-D-038 generations. Call order (customer → supplier → employee) matches the generator's own block order, so a future full regeneration reproduces these exact names.
**Decision — additive application, not regeneration:** `db_rebuild/patch_realism_names.py` mirrors the D-034 `patch_otif.py` pattern — reads the *already-generated* region/segment/employee values from the live local DB, feeds them to the same builder functions in the same call order, `UPDATE`s only the three name columns. 18 months of transactional history untouched. `db_rebuild/sync_dims_to_cloud.py` re-uploads only `dim_customer`/`dim_supplier`/`dim_employee` to MotherDuck (`CREATE OR REPLACE TABLE`, same D-034 pattern).
**Verified (2026-07-18, plain terminal):** 200 customers, 100 suppliers, 30 employees patched; zero remaining old-style-name matches in local DB, cloud DB, corpus files (`schema.yaml`/`metrics.yaml`), or `lib/sqlGenerator.ts`. Parity: row counts and top-5-supplier-by-spend (name + spend) byte-identical local vs cloud. Two banks needed widening after a first dry run hit `ValueError: name bank exhausted` (Construction's 50-combo pool against ~50 expected customers, too tight against sampling variance) — fixed by adding prefix/noun words for headroom (Construction/Facilities/Government now ≥112 combos each) before any DB write.
**Downstream truth sweep:** 8 `ground_truth.json` entries (H01, H03, H07, H08, H10, H13, M03, M08) embed supplier/customer names in their stored `result`; each was re-executed against the renamed DB and the `result` field replaced with fresh output. All 36 entries (not just the 8) re-verified end-to-end against the live DB — zero mismatches. One of the 8 (H08) exposed a **pre-existing, unrelated bug**: `ORDER BY so.so_pct DESC LIMIT 10` with many tied values and no secondary sort key is nondeterministic at the `LIMIT` boundary — reruns of the *identical* SQL against *identical* underlying numeric data returned a different top-10 set depending on tie order. Fixed with an explicit tiebreaker (`, s.supplier_key, i.sku`) in both `ground_truth.json` and `benchmark/build_ground_truth.py`, confirmed stable across repeated runs. `benchmark/results.jsonl` left untouched (historical, per instruction); `benchmark/REPORT.md` got a one-line footnote marking its names as frozen pre-D-038.
**Decision — `lib/tenants.ts` as single source of truth:** one config object per tenant (`company`, `headerPill`, `searchPlaceholder`, `analysisLabel`, `warehouseLabel`, `metaDescription`, `llmDescriptor`) feeds both UI strings and LLM system prompts — the shell and the model's own self-description can no longer contradict each other. `getActiveTenantConfig()` (reads `ACTIVE_TENANT`) is server-only; Server Components (`TopHeader`, `app/chat/page.tsx`, `app/layout.tsx`) call it and pass the resolved plain object as props to Client Components (`Workbench` → `AnalysisHeader`/`DataOverviewCard`) — `ACTIVE_TENANT` is not `NEXT_PUBLIC_`-prefixed, so client code never reads it directly. `/chat` is statically prerendered, so the tenant identity bakes in at **build time**, matching "no tenant-switching UI" — verified by two full rebuilds (`ACTIVE_TENANT=mro`, then `=northwind`), each producing zero cross-tenant string leakage.
**Bug fix, not polish — `app/api/warehouse-stats/route.ts`:** this route bypassed `lib/db.ts` entirely, hardcoding a direct local-file DuckDB connection scoped to the `main` (Northwind) schema — **broken in production** (no bundled file there, would 503) regardless of tenant, and showing Northwind's 9-table/15-metric counts even when it happened to run. Rewritten to use `executeSQL` from `lib/db.ts` (same environment-switched backend `/api/ask` uses) with tenant-branched queries (`mro_distributor.*`, 20 tables, 26 metrics vs `main`, 9 tables, 15 metrics). `last_refreshed` changed from `fs.statSync(...).mtime` (file-touch time — showed *today*, since the realism patch had just written the file, implying live data the warehouse doesn't have) to `MAX(dim_date.full_date)` — the actual data horizon (2025-12-22 for mro). Footer label reworded "Last refreshed" → "Data as of" to match the new semantics.
**Decision — narrator voice (`lib/narrator.ts`):** made tenant-aware (was 100% hardcoded to "Northwind Furniture, a ~$50M B2B furniture company" regardless of which tenant's data it narrated — same gap class as pre-D-037 `sqlGenerator.ts`). Added rules: currency abbreviated in prose ($69.1M, never the full unrounded figure), percentages/days rounded, banned toy-tell phrases ("the data shows", "synthetic data", raw column names), constant-column-stated-once handling. The claim-precision rule (don't report a full row count when the real story is a sharp subset) needed **two rounds of iteration to actually change model behavior**, not just be present in the prompt — logged honestly rather than claimed as a one-shot fix:
  - *v1* (abstract rule): tested against "which suppliers are late but still paid faster than average?" (43 rows) — headline still said "43 suppliers", unchanged.
  - *v2* (added a worked example): same test, same result — no change across 3 reruns. Root-caused: the generated SQL for this question didn't `SELECT` `reliability_tier`, so no segment column existed for the model to name even if it wanted to.
  - *v3* (explicit procedural instruction — "sort the numeric column descending, scan for a 2x+ gap, report only the group above the gap, state the threshold"): fixed it. 3/3 reruns correctly identified "7 suppliers average 14+ late days" (the real D-tier group, verified against the underlying data: 7 suppliers at 14.3–16.3 days, then a genuine gap to 12 C-tier suppliers at 5.7–7.9 days) instead of the generic 43-row count.
  - Percent rounding needed one similar iteration: the model was echoing the SQL's raw `ROUND(...,2)` output ("3.96 percent") until the rule explicitly said "round to 1 decimal even if the underlying value has more decimals, e.g. the data may hand you 3.96 — write 4.0%, not 3.96 percent." Fixed; the model now writes "nearly 4 percent" — accurate, professional, and not the literal `%` glyph the rule asked for, but a legitimate stylistic variant, not a toy-tell. Not chased further.
**Decision — `lib/format.ts`:** `formatTitle()` (acronym whitelist: PO, DPO, DSO, DIO, CCC, OTIF, GL, AR stay uppercase; minor connector words lowercased when not leading) and `formatDuration()` (`<1000ms` → `"580ms"`; `<60s` → `"1.4s"`/`"28s"`; else `"1m 5s"`) replace ~15 hand-rolled `.replace(/_/g," ")` and raw-`ms` call sites across `AnalysisHeader.tsx`, `ChangeTab.tsx`, `TrendTab.tsx`. Also removed Tailwind's `capitalize` utility class from the metric-title `<h2>` — CSS `text-transform: capitalize` was force-lowercasing the rest of every word at render time, silently undoing `formatTitle`'s correct acronym casing (e.g. rendering "PO" as "Po") regardless of the underlying (correct) string content.
**Verified (2026-07-18, plain terminal + local server, both tenant builds):** `formatTitle("avg_po_late_days_by_supplier")` → `"Avg PO Late Days by Supplier"`; `formatDuration(27546)` → `"28s"`, `formatDuration(1400)` → `"1.4s"` (both match the spec's own examples exactly). M08 live: real supplier name (`Guangzhou Precision Components`, $69.1M in prose) with correct spend. Zero `Northwind`/`Summit Industrial` cross-leakage in either rebuild's rendered HTML. `npx tsc --noEmit` clean throughout.
**Logged, not fixed (out of scope per the build prompt):** first live query after a cold Vercel function start has been reported at ~27.5s end-to-end — plausibly connection setup + corpus embedding on first hit, not re-measured in this session. Phase-6 candidate: split cold/warm latency measurement, consider an embedding cache or a keep-warm ping.
**Tradeoffs:** Narrator claim-precision and percent-rounding rules are prompt-level nudges verified against a handful of test questions, not benchmarked at scale the way D-036 benchmarked SQL generation — behavior on unseen question shapes is not guaranteed, only demonstrated. Employee/customer/supplier name banks are generous (100–900+ combinations) but finite; a much larger regenerated dataset (e.g. 10x current entity counts) would need wider banks or would raise `ValueError` loudly rather than silently degrading to duplicates — by design.

### D-040: Minimal eval harness — on-demand, tier-selectable, per-stage instrumented

**Numbering note:** D-039 (product rename) was never executed; the numbering skips it deliberately.
**Context:** The D-036 benchmark was a one-off: a fixed 40×4 run whose results were scored after the fact by `build_report.py`. Any change to retrieval, prompts or models now needs a repeatable, cheap measurement, or claims about improvement can't be defended. This is the minimum needed to get one; it is not the full eval system.
**Decision — scope:** `benchmark/run_benchmark.ts` gained an `--eval` mode (an extension, not a rewrite; the original `--estimate`/full-run paths are unchanged). Entry point: `npm run eval -- [--tier S|M|H|C|all] [--mode dense] [--k 5] [--label <tag>] [--model <name>]`. Dense is the default; bm25/rrf/schema remain reachable. Retriever, SQL generator, corpus, narrator and UI were not touched. A cost estimate prints first and the run stops if it exceeds $5.
**Decision — scoring reuse:** no second scorer. `benchmark/score_run.py` executes only the definitions block of `build_report.py` (everything before "# ── score all runs") and applies the D-036 R/A rubric and control checks (1% numeric tolerance). `build_report.py`, `results.jsonl` and `REPORT.md` are untouched.
**Decision — run-file schema:** one JSON line per question appended to `benchmark/runs/<run_id>.jsonl` immediately after that question finishes (a crash mid-run loses nothing). Fields: `run_id, ts, id, tier, mode, k, model, label, question`; `retrieval{chunk_ids, latency_ms}`; `sql_generation{sql, tokens_in, tokens_out, latency_ms, estimated_cost_usd}`; `sql_execution{ran, error_message (verbatim, up to 2000 chars), rows_returned, latency_ms}`; `narration{tokens_in, tokens_out, latency_ms, estimated_cost_usd}`; `retry_count` (0 until the validator lands); `scoring{R, A, sql_valid, refused, ctrl_ok}`; `total_latency_ms`, `total_cost_usd`. Narration runs only when SQL produced a result; its token usage is captured by wrapping the SDK `create` call, so `lib/narrator.ts` is unmodified. A refusal is recorded as `ran: false`, `sql_valid: false`, with the `REFUSE:` text in `error_message`.
**Fix found while building — runaway query:** the first gate run hung on H12 at ~780% CPU. The pre-existing 30s timeout in `execSql` rejected the promise but never cancelled the DuckDB query, so it kept running on the shared connection and blocked every later question. The timeout now calls `interrupt()`. In the rerun, H07 hit this path and was recorded as `INTERRUPT Error: Interrupted!` instead of hanging. The partial first run was discarded.
**Baseline (gate run, `2026-11-09T08-49-37-401Z_5425`, H tier, dense, k=5, Haiku 4.5, label `d040-baseline`):** 14 questions, mean R 4.57, mean A 0.50, SQL validity 5/14 (35.7%), 37,130 tokens in / 6,879 out, total cost $0.0715, p50 6,267ms / p95 10,957ms. Per question: H01 R4/A0✗, H02 R4/A1, H03 R4/A2, H04 R5/A0✗, H05 R5/A0✗, H06 R5/A0✗, H07 R5/A0✗, H08 R5/A1, H09 R5/A2, H10 R5/A0✗, H11 R4/A0✗, H12 R5/A0✗, H13 R4/A1, H14 R4/A0✗ (✗ = SQL did not run).
**Gate 4 — literal wording not met, and why that is acceptable:** the gate expected H01 to record `Binder Error: column "po_key" does not exist`. On this sample H01 *refused* (`REFUSE: ...`), as it also did in the July D-036 dense run, so there was no Binder Error to capture. The gate was mis-specified: its real requirement is that the harness records failures verbatim and does not crash on them. That is demonstrated by other failures in the same run: H06 (`Parser Error: syntax error at end of input`), H11 (`Binder Error: Ambiguous reference to column name "item_key"`), H12 (`Binder Error: Table "dd" does not have a column named "quarter"`), H14 (`Binder Error: Referenced table "ff" not found!`), plus H07's recorded interrupt. Re-running until H01 produced the specific error was rejected as result-shopping.
**Caveat — single stochastic sample:** SQL generation is non-deterministic. This is one run, not a distribution; the July D-036 dense run had 64% H-tier SQL validity against 35.7% here, and the difference cannot be attributed to anything without repeated runs. Treat the baseline as a first data point, not a stable reference. Refusals score A=0 (counted as SQL failures), which weighs on both numbers.
**Deliberately deferred:** diff against a previous run, a regression gate, multi-mode sweeps, report redesign, top-k sweep, model comparison, validator/retry (the `retry_count` field exists, always 0).
**Tradeoffs:** The scorer bridge depends on the marker comment in `build_report.py`; changing that comment breaks scoring. Cost figures use a small hardcoded price table (Haiku, Sonnet); other models fall back to Haiku rates with a warning.

### D-041: R-rubric split, table-expansion retrieval, SQL validator with classified retry

**Context — the crowding-out diagnosis:** D-040's harness produced five H-tier runs (3×k=5, k=10, k=15). 10 of the 20 H-tier failures across the three k=5 runs were *refusals*, and in 8 of those 10 the model named a table it had not been shown. Dense top-k fills with sibling metric chunks (`avg_po_late_days_by_supplier`, `supplier_on_time_delivery_pct`, `dpo_days`) while the tables that carry the joins stay out. Required-table coverage: 20% at k=5, 61% at k=10, 74% at k=15 (pooled count); refusals 3–4 → 1 → 0. `o2c_sales_order_line` was absent at k=5, k=10 and k=15 for H01/H04/H05/H10 — similarity never surfaces it. Mean legacy R was blind to all of this: 4.57 at k=5 while half the answers failed, then *fell* to 4.00 at k=10/15.
**Part A — R rubric (commit 4edd618).** Two defects in the legacy 0–5 R: (1) it treats retrieving any one primary metric as R≥4 on the premise that metric chunks carry their tables in-chunk — false for multi-table questions, so it is blind to missing tables; (2) R=5 requires every retrieved chunk to be in the acceptable set, so it penalises larger k (a precision effect) while never rewarding coverage. Replaced by `R_recall` = required∩retrieved / required and `R_precision` = required∩retrieved / retrieved, where required = expected `primary` ∪ `tables` (strict: all primaries, not any-of; `extra` chunks are not required and not counted as precision hits), plus `required_tables_retrieved` {count,total,share}. `R_legacy` retained, bit-identical to D-036 (verified: rescored values equal stored). The expected sets already listed tables for every non-control question, so no extension from metric declarations was needed (controls C01–C04 score None). Gate A rescore of the five existing runs: R_recall 0.421 (k=5) → 0.730 (k=10) → 0.815 (k=15); R_precision 0.457 → 0.407 → 0.305; mean per-question table coverage 0.235 → 0.633 → 0.755 — the k=10/15 runs no longer look like a regression. Note: per-question mean coverage (0.235) differs from the pooled 20% quoted above; both are correct aggregations of the same data.
**Part B — table expansion (commit 553759f).** After ranking and tenant filtering, for each retrieved *metric* chunk the table chunks it declares in its `tables:` list (metrics.yaml, D-033) are appended if absent. Deterministic, no similarity search; additive after top-k so k still controls ranked chunks; deduplicated; ids are tenant-prefixed so cross-tenant pulls are impossible (D-035); capped at 12 expanded tables with a logged warning (max observed 8, cap never hit); `RETRIEVAL_EXPAND_TABLES` env (default on) and `--expand true|false` harness flag. The declarations are carried as chunk metadata only — chunk text and embeddings are unchanged. Why it beats raising k: it uses the declared relationship, so it reaches tables similarity never ranks.
**Gate B (H tier, dense, Haiku 4.5, one run each):** k5-noexpand — recall 0.421, coverage 0.235, 3 refusals, 57.1% valid, mean A 1.07, $0.077; k5-expand — 0.853, 0.848, 1, 64.3%, 0.93, $0.114; k10-noexpand — 0.730, 0.633, 1, 71.4%, 1.57, $0.112; k10-expand — 0.936, 0.924, 0, 64.3%, 1.36, $0.147. `o2c_sales_order_line` reached H04/H05 at k=5+expand and all four of H01/H04/H05/H10 at k=10+expand. Retrieval metrics (recall, coverage) are deterministic, so those gaps are real; SQL-valid and mean A are single stochastic samples — the three k=5 baselines alone spanned 35.7–64.3% valid — so differences between configurations in those columns are inside the noise. Refusal counts are small-N.
**Ship decision: k=10 with expansion** (initially k=5+expand was preferred on cost; revised by the user because k=10+expand is the only configuration that delivers `o2c_sales_order_line` to all four target questions and has zero refusals). Production defaults set: `/api/ask` retrieves at k=10 (`RETRIEVAL_K` env override, invalid values fall back to 10); expansion defaults on. **Tradeoffs, stated plainly:** cost +29% vs k=10-noexpand and about 1.9× the k=5 baseline ($0.147 vs $0.077 per 14 H questions); precision falls to 0.35 (about 15 chunks per prompt, most of them context the question does not strictly need). **The k=10 result depends on a second relevant metric happening to rank within the top 10** — at k=5 H01 and H10 miss `o2c_sales_order_line` because no retrieved metric declares it. This is not guaranteed for other questions; k=10 is a better bet, not a guarantee.
**Declaration audit (no change made).** All 26 MRO metric `tables:` lists were compared with the schema-qualified tables parsed from each formula: 0 used-but-undeclared, 0 declared-but-unused (the unqualified FROM/JOIN names in `supplier_lateness_cash_impact` and `slow_moving_inventory_value` are CTEs). So the data is consistent; the H01/H10 gap at k=5 exists because `supplier_lateness_cash_impact` genuinely joins `o2c_fulfillment_line`, not `o2c_sales_order_line`. The benchmark's *expected set* for those questions lists `o2c_sales_order_line` as a judgment about what a good answer needs (reasonable for H10's revenue-impact wording) — it is not a data error and was not altered.
**Part C — validator and classified retry.** `lib/sqlValidator.ts` (pure module; callers supply generate/explain/execute): static checks (single SELECT/WITH only; forbidden DDL/DML/ATTACH/COPY/PRAGMA etc.; every FROM/JOIN table must be a known table of the active tenant or a CTE; other schemas are `out_of_scope`; unqualified or unknown names are `binder_error`), `EXPLAIN` dry-run to surface parser/binder errors without executing, `LIMIT` appended when no top-level limit (default 1000, `SQL_MAX_ROWS`). Error classes: `parser_error | binder_error | timeout | refusal | out_of_scope | permission | other` (DuckDB `Catalog Error` is classed as `binder_error`: it is a name-resolution failure that a retry can legitimately fix). Retry policy: max 2, **only** parser/binder errors, retry prompt = original prompt + the failed SQL + the verbatim error (chunks unchanged). **Deliberately never retried:** refusal and out_of_scope (correct behaviour — retrying wastes tokens and can coax a hallucinated answer), permission (user-facing), timeout (the D-040 `interrupt()` fix stands). Harness: `--validator on|off` (default off, so D-040/Gate-B runs stay comparable); per-question `validation{error_class, retry_outcome, first_attempt, attempts[], retry_overhead, limit_added}` and `retry_count`. False-positive check before spending: all 152 distinct previously-successful SQL statements in the existing run files pass the static validator (an initial 49 rejections were test artefacts — stored SQL still contained markdown fences, which the validator path strips).
**Gate C (k=10 + expansion, validator on, one run, {C[0]['run_id']}):** SQL-valid 78.6% (11/14) final vs 71.4% (10/14) on the first attempts *of the same run* (the cleanest before/after, since it isolates the validator from generation noise); prior k10-expand run without the validator was 64.3% (9/14, a separate sample). First-attempt failures: timeout 2, refusal 1, binder_error 1; final failures: timeout 2, refusal 1. Exactly one retry occurred and it succeeded: H13 (binder_error caught by EXPLAIN → corrected on retry 1). Retry overhead: 6,993 tokens in / 483 out, $0.0094 (about 6% of the $0.1553 run), +4.4s summed latency. The validator added `LIMIT 1000` to 12 of 14 queries. **Plain verdict: it improved exactly one of 14 questions** — real but tiny, and one sample; it cannot be separated from noise. It did not change the three failures that matter most (two 30s timeouts — H01 and H07 — and the H10 refusal), because those are by design not retried. Mean A was 1.21 vs 1.36 for the earlier k10-expand run; the recovered H13 scores A=1, so recovery of *validity* did not mean recovery of *correctness*.
**What the validator is not yet:** it is wired into the eval harness only, not into `/api/ask` — production behaviour is unchanged apart from the k=10/expansion defaults. Wiring it (and adapting the JSON-envelope generator in `lib/sqlGenerator.ts` to the retry loop) is a separate step.
**Still open:** (1) the two timeouts (H01, H07) — EXPLAIN cannot catch a query that is valid but pathologically expensive; they need a cost/plan guard or a better join pattern, and H01 took 36.5s end-to-end; (2) the H10 refusal, partly a genuine data gap (single source supplier per item, no alternative-supplier data); (3) multi-metric composition — questions needing several metrics' formulas combined; (4) the structural successor to expansion is a semantic model / query compiler that plans joins from declared relationships instead of asking the LLM to assemble them; (5) `o2c_sales_order_line` still depends on a second metric ranking in (see ship-decision caveat). All SQL-validity figures here are single stochastic samples and are not presented as proven.

### D-042: Validator + classified retry wired into live /api/ask

**Context:** D-041 built the SQL validator and retry loop but only inside the eval harness; production `/api/ask` still did generate → execute with no checks, so the harness measured behaviour production did not have. This closes that gap.
**Decision — what changed:** `app/api/ask/route.ts` now runs `runWithValidation` (`lib/sqlValidator.ts`): static checks (single read-only SELECT/WITH, forbidden DDL/DML keywords, every FROM/JOIN table must belong to the active tenant or be a CTE) → `EXPLAIN` dry-run through the same `executeSQL` the query uses (so it works unchanged on the local file and on MotherDuck) → `LIMIT 1000` appended when absent → execute under a 30s timeout (`SQL_TIMEOUT_MS`). `lib/sqlGenerator.ts` was adapted to the loop: `generateSQL` takes an optional `retry {prevSql, error}` that appends the failed SQL and the verbatim engine error to the prompt (same system prompt and retrieved chunks, nothing else changes), returns token usage, and a null `sql` from the JSON envelope is surfaced as `REFUSE: <reasoning>` so it classifies as a refusal. New `getTenantSchemaInfo(tenant)` supplies the validator's table list; the validator gained `requireQualification` (false for the northwind tenant, whose tables are referenced unqualified).
**Policy (identical to the D-041 harness):** max 2 retries, only for `parser_error` and `binder_error` (DuckDB `Catalog Error` counts as binder). Never retried: `refusal`, `out_of_scope` (other-schema/cross-tenant references), `permission` (non-read-only statements), `timeout`. Response shapes are preserved (`sql_generation_failed`, `no_sql_generated`, `sql_execution_failed`, all 500) and gain `validation{retry_count, retry_outcome, limit_added, attempts[]}`; a failed execution also reports `error_class`. Every response now reports `retrieval_k` and `retrieval_expand_tables` so the deployed configuration is observable.
**Gate (local dev server, backend = MotherDuck since `MOTHERDUCK_TOKEN` is set in `.env.local`; k=10, expansion on, dense, all chunks `mro:*`):**
- S02 "What is our current DSO?" → 44.02 (exact ground-truth match), 0 retries, LIMIT added; total 9.8s (3.5s of it retrieval on a cold embedding index).
- M08 "top 10 suppliers by spend" → Guangzhou Precision Components $69,129,229.98 first, 10 rows (matches the D-037/D-038 verified figure), 0 retries; total 6.4s.
- H13 → two consecutive `binder_error`s caught by the EXPLAIN dry-run (`aggregate function calls cannot be nested`, then `Ambiguous reference to column name "customer_key"`), each fed back verbatim; the third attempt passed and executed, 50 rows, narrated. **Retried twice and recovered end to end**; total 21.1s (14.2s generation across three attempts). One sample — H13 needed one retry in the D-041 harness run and two here; retry counts are stochastic.
No regression on S02/M08.
**Caveats:** (1) the 30s timeout bounds the request but cannot cancel the query itself on the MotherDuck pool (the harness's `interrupt()` fix applies to its own single connection); a runaway cloud query occupies one of the 3 pooled connections until it finishes. (2) The EXPLAIN pre-check adds one round-trip per attempt (negligible locally, roughly the cloud round-trip time on MotherDuck). (3) `row_count` is now capped by the enforced `LIMIT 1000` instead of reflecting the full result size. (4) Observed, not fixed: M08's narration called the spend "annual" though the warehouse spans 18 months — a narrator-precision issue outside this change.
**Closes** the harness/production gap named in D-041. Still open from D-041: pathological-but-valid queries (timeouts), multi-metric composition, the semantic-model/compiler direction.
