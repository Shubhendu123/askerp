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

## D-043 — Production request tracing (`ops.request_traces`) and `/traces` view

**Status:** Accepted · 2026-11-10

**Context.** D-040 instrumented stages in the eval harness only. Production `/api/ask` logged nothing persistent, so "what did last week cost", "which question types fail" and "did quality move after a change" were unanswerable.

**Decision.**
- One row per request in `ops.request_traces` (DDL: `db_rebuild/ddl/ops_request_traces.sql`; applied by `db_rebuild/apply_ops_ddl.ts`), created in both the local DuckDB file and MotherDuck. Fields cover retrieval, SQL generation (tokens, ms), validation (D-041 `error_type`, `retry_count`, `limit_added`), execution, narration, totals, estimated cost and `success`. Failures and refusals are traced too (`success=false`, `error_type`/`error_message` populated).
- **Why the warehouse, not an external tool:** no new vendor or dependency, traces are SQL-queryable with the same engine as the product, and everything stays in-stack. The cost of this is that ops data shares the warehouse with business data (mitigated by the separate schema).
- **Why a separate `ops` schema, not a tenant:** tenant isolation (D-035 prefixes, the tenant table allow-list in the validator) governs `main` / `mro_distributor`. `ops` is not in any tenant's allow-list, so generated SQL cannot read traces; and it is not a customer-facing dataset.
- **Tracing never degrades the answer path.** The handler fills a trace context as it goes; the row is written *after* the response object exists, not awaited by the request (`recordTrace`, `lib/tracing.ts`). On Vercel the write is registered with `waitUntil` (`@vercel/functions`, the one new dependency; Next 14.2 has no `after()`) so the function is not frozen before the insert finishes. All errors are caught and logged to console. `TRACING_ENABLED=false` switches it off. Reuses the module-scope pg Pool (D-037); locally a short-lived read-write instance is opened and closed (the read path stays READ_ONLY).
- **Resilience verified (gate 3):** with `TRACE_TABLE` pointed at a nonexistent table, S02 still returned HTTP 200 with DSO 44.02; the failure was logged as `[trace] write failed (ignored)` and no row was written.
- **Cost estimation is shared:** the price table moved from `benchmark/run_benchmark.ts` into `lib/pricing.ts`; the harness and tracing both import it. Cost = SQL-gen tokens (including retries) + narration tokens at Haiku 4.5 rates.
- `lib/narrator.ts` now returns `usage` (additive only; behaviour unchanged). Retrieval, generation, validator and narrator logic are otherwise untouched.
- `/traces`: server-rendered read-only page in the existing light theme — tiles for today's (UTC) requests, cost, p50/p95, success rate, retries; the 50 most recent traces with expandable SQL, chunk ids and stage timings.

**Tradeoff — per-row writes.** One INSERT per request. At demo volume this is negligible against the MotherDuck free tier; at scale the production answer is batching (buffer and flush) or a queue.

**Known gaps.**
- `/traces` has **no auth** (consistent with the rest of the demo). Traces expose questions, SQL and errors.
- **No retention policy** — the table grows unbounded.
- **Question text is stored verbatim** — a PII consideration in a real deployment (redaction/hashing needed).
- `created_at` and "today" are UTC.
- Trace write is best-effort: a crash/timeout of the function before `waitUntil` completes can drop a row. Acceptable for observability, not for audit.

**Observed cost of refusals (gate 2).** A refusal costs about the same as a successful answer: C03 (refused) $0.0089 vs S02 $0.0074 and M08 $0.0092. Refusals are full-price failures, not free fallbacks. Correction to the intuitive explanation: narration does *not* run on a refusal (narration tokens were 0). The cost is all retrieval plus SQL generation, and the refusal's SQL-gen input was the largest of the three (8,403 tokens, 18 chunks after table expansion) because refusal-prone questions retrieve broadly. Both retrieval and the full-context generation call are paid before the model declines, so a cheaper pre-generation out-of-scope check is a candidate future optimisation (not built here).

**Outcome taxonomy (`/traces`).** The first version of the view reported a single "success rate", which counted a correct refusal (e.g. C03 attrition: the data genuinely cannot answer it) as a failure. Outcomes are now three: **answered** (`success`), **correctly declined** (`error_type` in refusal / out_of_scope) and **failed** (parser_error / binder_error / timeout / permission / other), with the failure rate as the prominent tile. This is the same class of error as the R-rubric defect in D-041: a metric that scores the wrong thing (there, R-legacy being blind to missing required tables; here, a refusal scored as a defect) and so hides what is actually going wrong. The taxonomy is derived at read time from `success` and `error_type`; the stored schema is unchanged. Caveat: "correctly declined" assumes the refusal was right — a refusal on an answerable question (like the H01/H10 crowding-out cases in D-041) is still a quality failure that this view cannot distinguish without ground truth.

## D-044 — Tenant 3: Harborline Global Custody (securities services) — schema + data

**Status:** Accepted · 2026-11-10 · data layer only (semantic layer, retriever wiring and app are D-045/D-046)

**Persona and why.** Harborline is a mid-tier global custodian (~$800B target AUC, 50 institutional clients, 12 markets). Securities services was chosen because its three documented money leaks — **settlement fails (and CSDR penalties), corporate-action errors, and tax-reclaim leakage** — are exactly the questions an NL→SQL agent should be able to answer over joined data, and each can be planted as a causal chain rather than independent noise.

**Structure (D-029 schema-per-tenant, D-030 prefixes).** Schema `harborline` in `data/northwind.db` and in MotherDuck database `askerp`; **17 tables** — 7 conformed dimensions (date, market, security, client, counterparty, subcustodian, currency) + 10 facts in 5 subject areas: STL (trade_instruction, fail_penalty), POS (daily_position, cash_balance), CAE (event, client_election, income_payment), CLT (fee_invoice, service_request), REC (break). *The prompt said 16 tables; that was a spec arithmetic error (the authoritative DDL has 17). Built as given.* No change to `main` (Northwind, 9 tables), `mro_distributor` (20) or `ops`; row counts of all 29 pre-existing tables verified identical before/after, locally and in the cloud.

**Scale and seed.** SEED=7, 2025-05-01 → 2026-10-22 (540 days), 50 clients, 800 securities, 60 counterparties, 12 markets, 16 subcustodians, 9 currencies. 1,809,101 rows (540,000 instructions; 1.08M daily positions on 2,000 client×security pairs; 117K cash balances; 39K penalties). Generator: `harborline/gen/generate_harborline.py` (one coherent vectorised simulation, ~5 s); verifier: `harborline/verify_harborline.py` (`--cloud` adds MotherDuck run + parity); uploader: `harborline/upload_to_motherduck.py` (table-by-table, D-037 pattern; token from the environment only).

**The three planted chains, with verified numbers (final run, identical local and cloud).**
- *Chain 1 — counterparty → fails → penalties → overdrafts.* Fail rate by `reliability_tier` A/B/C/D = 1.0 / 2.5 / 7.0 / 14.0% (overall 3.84%); mean days failed 1.9 / 3.3 / 6.3 / 11.0; penalties per 1,000 instructions $321 / $986 / $4,315 / $14,235. Fail rate by security type CORP_BOND 8.8% > EQUITY 3.5% > ETF 2.8% > GOVT_BOND 1.3%; LOW liquidity fails more than HIGH. Penalties accrue one row per failed business day, only in CSDR/CREST markets — **0 penalties in NONE-regime markets**. Failed RECEIVE → `quantity_pending`; failed DELIVER → unreceived cash against a thin operating buffer → overdrafts: clients in the lowest quartile of C/D-tier routing have 2.6% overdraft days vs 12.2% in the highest (4.7×).
- *Chain 2 — short notice → missed elections.* Miss rate by notice window ≤2d / 3–4d / ≥5d = 9.4% / 2.4% / 0.3% (overall 1.6%; target ≈2%). ≤2-day windows are 9.9% of elections but 56.8% of misses. Short-notice events are concentrated in IT/HK/JP (by construction). Voluntary events are 25.0% of events.
- *Chain 3 — tax reclaim leakage.* Reclaim-eligible payments are filed 59.9% of the time; unfiled rate HIGH-complexity markets (FR, IT, CH) 79.9% vs MEDIUM 44.8% / LOW 30.1%. Filing probability is calibrated (bisection) to hit a 60% overall target; the *shape* across complexity tiers is the planted signal. Lower-intensity links: late income (~5%), `rec_break` FAILED_SETTLEMENT breaks drawn from failed instructions (higher for weak tiers), service-request volume and SLA breaches scale with client fail counts, `SLA_CREDIT` fee waivers appear for clients with breaches.

**Killer queries** (all three return real answers on both backends): K1 shows the tier gradient and the clients bearing the penalties/overdraft cost (top bearer: a hedge fund with 53% C/D-tier routing, $552K penalties, 621 overdraft days); K2 shows reclaim leakage by market/segment; K3 lists missed elections with their notice windows.

**Decisions made after the first verification run.**
1. *Gate K2 redefined.* The first run failed my own K2 threshold (HIGH markets >45% of unfiled reclaim *dollars*: 44%). The criterion was changed — with the user's approval, not silently — to **unfiled *rate* in HIGH markets > 1.5× the rest** (final: 80.0% vs 34.1% = 2.34×). **Rate and dollar concentration diverge, deliberately not tuned away:** dollars follow volume. In the final data HIGH markets hold 48% of unfiled dollars (vs ~30% of eligible dollars), CH is the largest single dollar leak ($175M) and the US — LOW complexity, 30% unfiled — is second ($144M) purely because it has ~half of all eligible payments. This is the realistic outcome: a leakage dashboard sorted by dollars and one sorted by rate point at different markets. (In the first run, before the fixes below shifted the random stream, the US was the largest dollar leak; the ranking of the top two is sensitive to the draw — the divergence is the stable finding.)
2. *Missed-election impact rescaled twice.* First to 1–5% of the entitled position value (max $66M, median $7.8M — a few positions exceed $1B). Then, before push, **to 0.1–1% of position value capped at USD 5M**, applied as a seeded patch (`harborline/patch_d044_impact.py`: rebuilds the generator into a scratch DB, asserts all other election columns are identical, updates only `estimated_client_impact_usd`). The generator now draws the new fraction from its own stream (`SEED+4401`) while still consuming the old draw from the main stream, so regeneration reproduces the patched values and every other table is unchanged. Result over the 44 missed elections: **max $5,000,000 (cap binds), median $1,170,522, total $79,358,126**. Re-uploaded that one table to MotherDuck (`harborline/upload_table.py cae_client_election`); local/cloud parity confirmed (count, sum, max, median, row hash).
3. *Subcustodians extended 8 → 16:* one PRIMARY per market plus BACKUP for US/GB/DE/JP, so no market has a NULL `subcustodian_key` (verified 0 NULLs in instructions, positions, breaks); ~10% of instructions in those four markets route via the backup.

**Realism notes and approximations.** CSDR daily penalty rates are *approximations* (liquid equity 1.0 bps, ETF 0.5, corporate bond 0.20, government bond 0.10; MMI treated as 0.10; CREST flat 0.5) — demo values, not regulatory figures. Statutory/treaty withholding rates are approximate and applied to equity/ETF dividends only (bond coupons paid gross). One global business calendar is used for all markets (not per-market holidays). Positions are daily on all calendar days; cash balances on business days only. October 2026 is not invoiced (month incomplete). Client, counterparty and security names are fictional.

**Open items.**
- **Reclaim deadlines are all 2028+**: statutes (36 months; 48 for FR/IT) exceed the 18-month data window, so "unfiled reclaims approaching their deadline" has no near-term rows. A historical-backlog patch (older income payments with nearer deadlines) is a follow-up, in the D-034 additive-patch style.
- `db_rebuild/` is MRO-specific; a future tidy is `tenants/<name>/` for all generators.
- Not yet done (D-045/D-046): semantic layer (schema.yaml/metrics.yaml), retriever tenant wiring, app wiring, policy documents.

## D-045 — Policy documents as a third retrieval chunk type

**Status:** Accepted · 2026-11-11 · `policy_refs` expansion and the policy cap verified at Gate B (real retriever, Voyage + BM25 + RRF) after one design fix, below. Part C benchmark results are in D-046.

**What.** `harborline/policies/POL-001..012.md` (YAML frontmatter + `## ` sections) become retrieval chunks of type `policy`, harborline tenant only (frontmatter `tenant`). One chunk per `## ` section (not per document: too coarse to rank; not per paragraph: loses rule context). Embedded text is `title — section heading` + body. Chunk ID `harborline:POL-001#3` (D-035 tenant prefix; `#n` is the section number from the heading). Duplicate-ID assertion retained. 86 chunks / 12 documents / 0 duplicate IDs.

**Metric → policy links.** Optional `policy_refs:` on metrics: `POL-001` (all sections) or `POL-001#2` (one section). On retrieval of a metric chunk, expansion appends the referenced policy chunks deterministically (D-041 mechanism for `tables:`). Build-time assertion: every `policy_refs` entry must resolve to a real policy doc/section of the same tenant.

**Anti-crowding cap.** Policy chunks also rank directly, so a policy-heavy question could crowd out metrics/tables — the failure D-041 diagnosed. Ranked + expanded policy chunks combined are capped at `RETRIEVAL_MAX_POLICY_CHUNKS` (default 3). Policy chunks beyond the cap are skipped in ranking, so their slots go to the next non-policy chunk.

**Verification finding (Gate B) and fix.** The first implementation appended `policy_refs` only into whatever cap budget the *ranked* policy chunks had left. In practice ranked policy text filled the 3 slots first, so a metric's own referenced rule was routinely dropped (for "How many aged fails do we have?", `aged_fails_count` references POL-001#2 but unrelated ranked POL-009#4 took the slot). Fixed: policy candidates are ordered by the rank of the evidence that pulled them in (a ranked policy chunk contributes itself; a ranked metric contributes its `policy_refs`), the first `cap` distinct candidates win, losing ranked-only policy chunks are dropped, referenced ones not already ranked are appended with `expanded: true`. The cap still bounds ranked + expanded combined. Verified: aged fails → POL-001#2 appended by expansion; `counterparty_fail_cash_impact` → POL-007#3/POL-011#2 appended; a "policies about fails, penalties, SLA tiers, counterparty tiers, overdrafts and reclaim" question matched 8 policy sections uncapped and 3 capped, keeping 12 non-policy chunks vs 9; cap=1 also holds with expansion.

**Use.** SQL generator: policy chunks supply thresholds/rules, which it may embed as literals; it must not invent a threshold absent from a retrieved policy (and returns null SQL naming the missing rule). Narrator: cites `(POL-001 §2)` inline only for policies actually retrieved. Retrieval panel: distinct `POLICY` badge; policy chunks always listed even beyond the top 5.

**Deployment.** Policies are discovered via `fs.readdirSync`, invisible to Next's static file tracing → `experimental.outputFileTracingIncludes` for `/api/ask` in `next.config.mjs` (otherwise production silently has zero policy chunks).

**Also changed.** Corpus embedding is batched (64/call); Voyage caps a call at 128 inputs and the corpus is growing past that.

## D-046 — Harborline semantic layer (schema.yaml + metrics.yaml) and tenant wiring

**Status:** Part B accepted · 2026-11-11 · Part C verification results are appended below once run.

**Schema.** 17 `tenant: harborline` entries (179 columns) appended to `data/schema.yaml`, generated from `harborline/ddl/harborline.sql` by `harborline/gen/build_schema_yaml.py` so types/PK/FK/value lists cannot drift from the real DDL; table purpose/grain and column business meaning are authored in the script. Append-only: the 29 existing entries are byte-identical.

**Metrics.** 24 `tenant: harborline` metrics (settlement 7, positions & cash 4, corporate actions & income 6, billing 4, reconciliation 1, cross-area 2), each with runnable DuckDB `formula` against `harborline.*`, schema-qualified `tables`, `grain`, synonyms/examples and `policy_refs` where a policy rule is embedded (e.g. `aged_fails_count` → POL-006#3, POL-001#2; `client_sla_settlement_compliance` → POL-001#2/#4 with the 99/98/97% tier targets as literals). Gate B (`harborline/verify_semantic_layer.py`): all 24 formulas execute; declaration audit (tables used in formula == `tables:`) passes for all 24; sanity checks against D-044 pass (AUC $712.2B, fail rate 3.84%, tier gradient 1.02/2.45/7.03/13.95%, reclaim filed 59.9%, missed elections 1.65%, penalties $1.43M, missed impact $79.36M).

**Definitions chosen.** Fail/settlement rate use only SETTLED+FAILED instructions (pending/cancelled excluded, matching POL-001 §2). AUC is a single-date balance (latest date). "Last month" = September 2026, the last complete month (October 2026 is incomplete and not invoiced). `client_profitability_usd` follows POL-010 §6 literally over the whole invoiced history (policy reviews quarterly): invoiced − Harborline-borne penalties − unrecovered overdraft funding (funding − OVERDRAFT fees, floored at 0) − SLA credits − analyst hours × USD 85. `counterparty_fail_cash_impact` *allocates* each client's overdraft funding cost across its counterparties by failed-RECEIVE value because the data has no instruction→overdraft key; the metric description says so.

**Tenant wiring (B3).** `lib/tenants.ts` gains `harborline`; `lib/sqlGenerator.ts` gains Harborline base/rules/few-shot (securities examples incl. a trading-P&L refusal — D-037 lesson) and `getTenantSchemaInfo` returns schema `harborline` with qualification required. No MRO/Northwind corpus entry, warehouse or validator logic changed.

**Observations and follow-ups.**
- **Service-request SLA breach rate is 32%** — high versus typical custody operations. A candidate for recalibration of the generator (D-044 style additive patch); left as is so the data matches what was verified.
- **MERGER voluntariness.** The data has 95 voluntary MERGER events while POL-004 §2 said mergers were non-voluntary. Resolved by amending the policy (not the data): MERGER is "mandatory by default; voluntary where the terms offer a cash/stock election". Policy chunk count unchanged (86).
- AUC is $712.2B and the fail rate 3.84% versus the ≈$714B / ≈3.75% in the D-045 brief; both match D-044's own verified numbers, so the brief's figures were approximations.
- Income on time is 94.99% — a hair under the POL-008 95% target; reclaim deadlines are all 2028+ (D-044).
- Gate B retrieval verification and the policy-priority fix are recorded in D-045.

### D-046 Part C — verification (30 questions, ground truth first)

**Set.** `benchmark/questions_harborline.json`: 8 simple, 8 medium, 5 hard cross-area (chain 1 counterparty→fails→penalties; chain 2 notice window→missed elections; chain 3 reclaim leakage; plus overdraft-vs-routing and aged-fails-vs-SLA-credits), 5 hybrid policy+data, 4 controls (MRO question under harborline, furniture question, trading-desk P&L, headcount). Ground truth SQL (`benchmark/build_ground_truth_harborline.py`) was hand-written from the policies and DDL, independent of the metric formulas, and executed before any model run; the scorer was self-checked (ground truth as answer → A=3 for all 26; perturbed answers never 3). Conventions: "last month" = September 2026, "today" = 2026-10-22, SLA targets from POL-001 §2 (99/98/97%). Scored with the D-041 rubric (R_recall, R_precision, table coverage, A-score — the D-036 `score_a` reused verbatim) plus policy coverage and citation accuracy. Run through the production path (rrf, k=10, table + policy expansion → `generateSQL` → validator/retry → narrator with policy citations), single run each, no re-runs to improve numbers.

**P04 and P05 are negative tests.** The correct answer to both is *none*: no client ever bears more than USD 50K of penalties in a month (P04), and no client is unprofitable under the POL-010 §6 definition, even per quarter (P05). The data does not exercise those policy thresholds. Scoring: A=3 for valid SQL returning no rows. Both runs pass both (no rows; headlines "No clients exceeded…", "No clients showed negative profitability…").

**Run 0 (first run, shared-batch embeddings).** Mean A 2.62 over 26 answerable (simple 3.00, medium 2.62, hard 2.40, hybrid 2.20); 25/26 valid SQL; controls 4/4; recall 0.99, precision 0.29; 30/30 questions at the 3-policy-chunk cap; 25 narrations cited a policy, all retrieved (accuracy 1.00) but 17 on questions needing no policy; a required policy cited on 5 of 9 questions. MRO regression: set-identical but a near-tie rank swap in S02 (see below).

**Gate 4 finding → embedding isolation fix.** MRO S02/M08 retrieval was not bit-identical to D-044: same chunks, but two near-tied ranks swapped and scores moved ≤0.004. Cause, measured: Voyage vectors for the same text shift with the composition of the embedding call (cosine 0.9988–0.9999 between batchings; identical for identical calls). Adding a tenant therefore perturbed other tenants' near-ties. Fix (Run 1): legacy tenants (mro, northwind) are embedded in ONE call exactly as before D-044; every other tenant is embedded in its own calls (batches of 64) and never shares a call. Verified bit-identical to D-044 (ids, order, type, ranked/expanded flag, scores) for S02 and M08, on both the Run 1 and Run 2 code; zero policy chunks, zero non-MRO chunks; narrator prompt for tenants without policies is byte-identical to pre-D-045. MRO answers A=3 (S02 44.02, M08 top supplier matches ground truth).

**Run 2 changes (harborline-scoped).** (a) relevance floor 0.50 (dense cosine) on *ranked* policy chunks, `RETRIEVAL_POLICY_MIN_SCORE`; policies pulled in through `policy_refs` are never filtered. Calibrated on 10 questions outside the benchmark (top ranked policy chunk 0.53–0.70 on policy-seeking, 0.29–0.52 on data-only). (b) narrator rule: cite a policy only when a specific claim depends on that rule; the rule is appended to the prompt only when policy chunks are supplied. (c) harborline SQL rules: aggregate each fact table in its own CTE before joining; no arithmetic on YYYYMMDD keys (join dim_date).

**Run 1 vs Run 2 (identical questions, same ground truth).**

| | Run 1 | Run 2 |
|---|---|---|
| R_recall / R_precision (26) | 0.99 / 0.29 | 0.99 / 0.29 |
| table / policy coverage | 0.99 / 1.00 | 0.99 / 1.00 |
| policy chunks per question: mean (min–max) | 3.00 (3–3) | 2.93 (1–3) |
| …on the 9 needing a policy / the 17 not | 3.00 / 3.00 | 3.00 / 2.88 |
| mean A: simple / medium / hard / hybrid | 3.00 / 3.00 / 2.40 / 2.40 | 3.00 / 3.00 / 2.40 / 2.40 |
| mean A all 26; valid SQL | 2.77; 26/26 | 2.77; 26/26 |
| answers citing a policy (of 30) | 26 | 22 |
| citation accuracy (cited ⊆ retrieved); wrong | 0.98; 1 | 1.00; 0 |
| citing answers on questions needing no policy | 17 | 15 |
| required policy cited (of 9) | 6 | 5 |
| S01 (AUC) still cites a policy | yes (POL-010 §3) | yes (POL-010 §3) |
| P04 / P05 negative tests | pass / pass | pass / pass |
| controls | 4/4 | 4/4 |

No per-question A changed between Run 1 and Run 2. **The Run 2 fixes did not meaningfully work**, and the reasons are specific:
- *(a) Floor:* 22 of 26 answerable questions still carry 3 policy chunks, because most are pulled in by `policy_refs` of whichever of the 10 retrieved metrics reference policies (marginal metrics included) — which the floor deliberately does not touch. Only ranked-only chunks were filtered (M06 now has 1). S01 still gets a ranked POL-010#3 above the floor.
- *(b) Narrator rule:* citing answers fell 26→22 but the S01 narration still draws an unsupported fee-tier inference from POL-010 §3 ("lowest tier 0.45 bps"), and 15 citing answers are on questions that need no policy. Haiku does not reliably honour a prose restraint when the policy text is in its context.
- *(c) SQL rules:* ignored. H05 and H02 produce the same direct fact-to-fact joins (no CTE) and the same inflated results (H05: 169,915 aged fails vs 1,999; $29B vs $392K SLA credits). A prose rule is not a control.
- *Noise:* Run 0 → Run 1 changed nothing relevant to SQL generation yet moved mean A 2.62→2.77 (M03 failed with a binder error in Run 0 and passed in Runs 1–2; P02 went 1→2). **Single-run differences of ±1 question are within run-to-run noise**; none of the above should be read as a measured improvement or regression without ≥3 runs.

**Persistent failures (all three runs).** H05 (fan-out, A=1), H02 (milder fan-out, A=2), P03 (chase-priority logic differs from ground truth, A=1), P02 (A=1–2: "trailing 12 months" built with integer arithmetic on YYYYMMDD keys and OR instead of AND for the two tier-D criteria).

**Follow-ups, not done (hypotheses, untested).**
1. Limit `policy_refs` expansion to the top few ranked metrics (or require the metric to be the primary match), so marginal metrics stop filling the cap; keep the floor for ranked policies.
2. Enforce no-fan-out mechanically instead of by prose: a static check in the D-042 validator (two fact tables joined row-to-row without prior aggregation → classified error carried into the retry), plus a date-key-arithmetic check.
3. Narrator citations: post-filter to policy chunks the answer demonstrably needs (e.g. referenced by the used metric, or named in the question) rather than all retrieved; or a second pass.
4. Calibrate the floor against more questions; it is specific to voyage-3-lite cosine on this corpus.
5. Reclaim deadlines (all 2028+), service-request SLA breach rate (32%) and the empty P04/P05 answers mean three policy thresholds are unexercised by the data; consider an additive patch (D-034 style) so the hybrid tests have positive cases.
6. Run ≥3 repetitions per configuration before drawing conclusions.

**Artifacts.** `benchmark/runs_harborline/` holds Run 0 (`harborline_2026-…5130`), Run 1 (`harborline_run1_…`), Run 2 (`harborline_run2_…`) and the MRO regression runs; `python3 benchmark/score_harborline.py --compare <run1> <run2>` reproduces the table.

### D-046 hotfix — three live UI bugs on the harborline deployment

1. **"Show SQL" / "Retrieval" looked dead.** Not a regression from the lint-fix commit: the removed `all` parameter was an unused `.filter` argument and the toggles (`sqlOpen`/`retrievalOpen`) were never touched. Reproduced in headless Chrome against a production build: the buttons toggle and the panels render, but *below* the main card. Harborline's narration is longer (about 800 characters against about 350 for MRO), which pushes the panels to y=878px in an 800px viewport — opened off-screen with no visible change near the button. The same latent issue exists on the MRO site (panels at y=626/781 in an 800px viewport: in view, but at the edge, and out of view on shorter windows). Fix: opened panels scroll into view. Verified at a 560px viewport (Retrieval panel brought to y=121).
2. **Warehouse card "Unavailable".** `/api/warehouse-stats` fell back to the Northwind config for any tenant other than mro and queried `fact_sales_order`, which does not exist in harborline (503). Now tenant-aware: harborline reads `dim_client` (Clients), `stl_trade_instruction` (Settlement instructions), `information_schema` (17 tables), 24 metrics, and takes the date range from loaded positions (`pos_daily_position` min/max key) because harborline's `dim_date` is a 2020–2031 calendar, not the data horizon. Verified on MotherDuck: 50 / 540,000 / 17·24 / 2025–2026 / as of 2026-10-22. MRO output unchanged (200 / 153,672 / 20·26).
3. **Suggested-question chips were Northwind's** (hard-coded in `Workbench.tsx`, also shown on the MRO site). Now `TenantConfig.suggestedQuestions`. Harborline: the four specified questions. Northwind keeps its five. **MRO now gets MRO questions** (previously it showed Northwind's, which an MRO warehouse cannot answer): total revenue, current DSO, best gross-margin category, top 10 suppliers by spend, worst OTIF warehouse.

**Deployment note.** `/chat` is prerendered at build time, so the tenant strings (header, placeholder, chips) are baked from `ACTIVE_TENANT` *at build*: each Vercel project must have `ACTIVE_TENANT` set for the build, not only at runtime.

## D-047 — Harborline: policy-ref audit, validator rules, scope + fidelity + Harborline retrieval-mode ablation

Harborline only; MRO and Northwind are unchanged (S02/M08 retrieval ids and scores bit-identical to D-044, zero policy chunks).

**Fixes.**
1. *`policy_refs` audit.* A ref is kept only where the metric's formula applies a threshold or rule from that policy. 22 metrics carried refs; 5 keep one (`aged_fails_count`→POL-006 §3 days≥5; `short_notice_event_share_pct`→POL-004 §5 ≤2 days; `client_profitability_usd`→POL-010 §6 analyst-hour cost; `open_breaks_aged_value_usd`→POL-009 §4 age≥10; `client_sla_settlement_compliance`→POL-001 §2 tier targets). 17 refs removed (e.g. AUC→POL-010; `counterparty_fail_cash_impact` lost both). They described context, not a rule the SQL applies.
2. *Expansion limit.* `policy_refs` are followed only for the 3 highest-ranked metrics (`POLICY_REF_TOP_METRICS`); the 3-chunk cap, relevance floor and evidence-rank ordering stay.
3. *Validator rules (rejections that use the existing retry, class `binder_error`).* (a) arithmetic on `*_date_key` columns; (b) one SELECT scope referencing ≥2 fact tables (`stl_/pos_/cae_/clt_/rec_`) not pre-aggregated in separate CTEs. `cae_event` is a declared parent table: joining it to its child election table is many-to-one and allowed unless a parent column is inside an aggregate/FILTER. Tenant opt-in via `TenantSchemaInfo.rules`; only harborline sets it. Unit test `harborline/test_validator_rules.ts`: 50/50 known-good SQL accepted (24 metric formulas + 26 ground truths), Run-2 H05/H02 SQL rejected, rules absent ⇒ no effect.
4. *Policy scope.* Each policy has a `governs:` frontmatter line, passed to generator and narrator with an explicit scope rule (tiers→counterparties, SLA targets→per client, never grade Harborline as a whole).
5. *Narration fidelity.* The narrator (harborline only) receives deterministic "Executed SQL facts" (filters, whether any date filter exists, grouping) and a rule to describe window/filters/grain only as executed.
6. *Scorer.* New checks: window stated but absent from SQL; policy/tier language on the wrong entity; S02 no-tier/SLA/phantom-window. Heuristic regexes; "tier" in prose can false-positive.

**Result, 3 runs, rrf k=10 (fixed code).** Mean A [min–max]: simple 3.00 [3.00–3.00], medium 2.75 [2.62–3.00], hard 2.53 [2.20–3.00], hybrid 2.40 [2.40–2.40], all 26: 2.72 [2.65–2.77]; valid SQL 25 [24–25]. Policy chunks/question 1.90 (was ≈3); 7 questions get none; required-policy coverage 0.89. R_recall 0.98, R_precision 0.30. Controls 4/4 ×3; P04/P05 correct ×3. No answer stated a time window absent from the SQL (0/0/0). **H05 now correct 3/3** (10 rows = ground truth; the Run-2 fan-out gave 169,915 aged fails vs 1,999). **H02 correct 1/3**: in 2 runs the validator rejected every attempt (A=0, no answer instead of a wrong one) - the generator does not reliably produce the CTE form. **S02 (overall fail rate): no-tier/no-window check passes 2/3**; run 3's narration mentioned tiers. **S01 still cites POL-010 §3 in 3/3** (the policy arrives by ranking, not by a ref). Scope-heuristic flags 3–5 answers/run (mostly "tier" wording).

**Gate status.** MRO bit-identical PASS; `tsc` PASS; `next build` PASS; controls 4/4 PASS; P04/P05 PASS; validator tests PASS; **S02 checks 3/3 FAIL (2/3)** ⇒ not pushed.

**Retrieval ablation (mode, k=10, expansion on; all cells run on the D-047 code; 26 answerable questions, mean A with [min–max] across runs).** Cells: rrf ×3, dense ×3, bm25 ×2, schema ×2 (schema = the whole corpus, all metrics + tables + 86 policy sections, in the prompt). bm25 run 3 and schema run 3 and the k sweep were **aborted: API credits** (the Anthropic balance ran out again; aborted runs are not scored and an API failure is never counted as a wrong answer).
| mode | n | A all-26 | simple | medium | hard | hybrid | R_recall | R_precision | policy cov | tokens in / question | cost / run |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rrf | 3 | 2.72 [2.65–2.77] | 3.00 | 2.75 [2.62–3.00] | 2.53 [2.20–3.00] | 2.40 [2.40–2.40] | 0.98 | 0.30 | 0.89 | 9,452 | $0.35 |
| dense | 3 | 2.72 [2.65–2.77] | 3.00 | 2.88 [2.62–3.00] | 2.40 | 2.33 [2.20–2.40] | 0.97 | 0.24 | 0.89 | 10,578 | $0.38 |
| bm25 | 2 | 2.69 [2.69–2.69] | 3.00 | 3.00 | 2.40 | **2.00** | 0.97 | 0.23 | 0.89 | 10,484 | $0.37 |
| schema | 2 | 2.67 [2.65–2.69] | 2.88 | 2.81 | 2.40 | 2.40 | 1.00 | 0.03 | 1.00 | 46,146 | $1.38 |
Reading (only differences outside run-to-run range count): accuracy is a **tie** across all four modes (2.67–2.72, ranges overlap; one-question swings dominate). The one separated difference is **bm25 on hybrid questions (2.00 vs 2.40 for rrf/schema, policy coverage 0.80 vs 1.00)** - lexical-only retrieval misses policy chunks. rrf has the best retrieval precision (0.30 vs dense 0.24) and the lowest token use. schema costs ~4× per run (46K input tokens per question vs 9K) for no accuracy gain, so putting the whole corpus in the prompt is not justified on Harborline.
**Recommendation: keep rrf, k=10 (unchanged).** Rule applied: ties → cheaper → simpler; rrf is the cheapest of the tied modes. This does **not** reproduce MRO's D-036 finding that dense won: on Harborline dense is statistically tied with rrf (and 10% costlier in tokens), and the corpus (24 metrics, 17 tables, 86 policy sections) is too small and too heavily keyworded to separate them with 26 questions. The k sweep (5/15, exploratory, 1 run each) was **not run** (aborted: API credits); k=10 stays the measured setting. Retrieval-level (model-free) metrics are deterministic, so the R_precision difference is real; accuracy differences are not resolvable at this n.

## D-048 — Enterprise document corpus (6 document types) + governed retrieval (harborline only)

Supersedes the numbering in `harborline/PROMPT_D047_enterprise_document_corpus.md` (written before D-047 existed). MRO and Northwind are untouched: MRO S02/M08 retrieval ids and scores bit-identical to D-044, zero document chunks.

**Corpus (35 documents → 171 chunks, one family with `doc_type`).** policy ×12 (86 chunks, authority_rank 3), regulation ×2 (9; rank 1), client_agreement ×6 (19; rank 2; CONFIDENTIAL), market_guide ×6 incl. MG-IT v1.0 + v2.0 (19; rank 4), event_notice ×5 (23; record), incident_report ×4 (15; record). Frontmatter schema: `doc_id, doc_type, title, authority_rank, effective_from, effective_to, version, supersedes, entities, access_level, binds_to` (+ `overrides` on contracts). Lower authority_rank wins a conflict. Chunk ids `harborline:CA-001#2`; market guides carry their version `harborline:MG-IT@1.0#1`. Duplicate-id assertion kept (0 duplicates). Un-numbered `## Client: ...` subtitles label the document instead of becoming a section.

**Build.** `python3 harborline/build_corpus.py` renders the 6 templated documents (5 event notices + INC-2630) from `cae_event` + `dim_security` into `harborline/corpus_rendered/` (templates stay in `corpus/`), checks every rendered date, notice window and rate against the warehouse row (all match; `RESPONSE_DEADLINE_PLUS_3BD` uses `dim_date.is_business_day`), and asserts every entity of all 35 documents resolves to a key (clients, counterparties, markets, event_keys). `outputFileTracingIncludes` for `/api/ask` now ships `harborline/corpus/**` and `harborline/corpus_rendered/**`.

**Governed retrieval.**
1. *Entity scoping.* client_agreement / incident_report / event_notice never enter ranked retrieval; they are linked only when the question names a strong entity (client, counterparty, `event NNNN`/`CAE-…`; first-name aliases such as "Eastgate", "Pinnacle"); a market alone links an event notice only with event vocabulary. A named event restricts event notices to that event. Best 2 sections per linked document. This is both the anti-crowding measure and the confidentiality measure: a client's contract appears only for that client's questions.
2. *Effective dating.* Documents not in force at the question's as-of date are not retrievable (as-of = ISO date, "Month YYYY" month-end, "last month", else today; `RETRIEVAL_TODAY` overrides). MG-IT v1.0 serves "February 2026", v2.0 serves "today".
3. *Precedence.* A linked contract section that cites the policy section it overrides (`overrides:` and a literal reference in the chunk text) pulls that policy section in, so both can be cited. Generator rule: lower authority_rank wins; use the contract threshold for an in-scope client. Narrator rule: state the override, name both values, cite both.
4. *Post-SQL enrichment (two-stage).* `enrichDocuments` attaches documents linked to result rows carrying `event_key` / `client_name` / `counterparty_name` (best section per document by BM25 vs the question, cap 3) to the narrator's context. Rows keyed only by `client_key` do not link (gap).
5. *NO_SQL.* The generator may return `sql: null` + `answer_from_documents: true`; the route/runner then narrates from documents only and the answer counts only if it cites a retrieved document (otherwise it stays a refusal). A refusal while governed documents are in context takes the same path.
6. *Caps.* Document chunks of all types ≤ 5 per request; priority entity-linked (+ overridden policy sections, + the market guide of a linked event's market) > policy_refs-expanded > ranked above the relevance floor; policy sub-cap 3 unchanged. Ranked document-type chunks (regulation, guides) additionally need dense cosine ≥ the floor to enter either rank list.
7. *access_level* is carried and shown as a CONFIDENTIAL badge in the Retrieval panel. **It is not enforced - there is no user identity (gap).**
8. *Isolation of earlier behaviour.* Corpus documents are embedded in their own Voyage calls and BM25 statistics (IDF, avgdl) are computed over the pre-corpus chunks only, so existing chunk vectors/BM25 scores are unchanged. Model-free regression on the original 30 questions: retrieved id sets identical to D-047 run 1 for 25/30; the 5 differences are 2 intentional market-guide chunks on reclaim questions (M05, H03) and marginal metric swaps on S05, C01, C02. Without the two isolation measures it was 18/30.

**DOC tier (12 questions, ground truth authored and executed before any model run; `benchmark/build_ground_truth_doc.py`).** Retrieval-only: required-document coverage 0.85 (misses: D06 EVT-2706 §3 "Scaling", D07 EVT-2751 §2, D09 INC-2026-007 §2 - the per-document top-2 sections by similarity; not tuned afterwards); **confidential leakage 0** across all 38 non-control questions, 0 client_agreement chunks for D11 (Redwood has no contract).
Model runs (single run each, per the budget instruction; no 30-question Run 3 regression was executed):
| | Run 1 | Run 2 |
|---|---|---|
| mean A (12) | 1.33 | 1.67 |
| doc coverage | 0.83 | 0.83 |
| fact coverage | 0.46 | 0.85 |
| precedence correct (D01,D02,D03,D07,D10) | 1/5 | 2/5 |
| version correct (D04,D05) | 2/2 | 1/2 |
| confidential leakage | 0 | 0 |
Run 1 exposed a defect in my NO_SQL rule: the model refused, without the flag, on questions that need warehouse numbers (D02, D03, D06-D09) and 6 answers were empty. Run 2 (after tightening the NO_SQL rule to "no warehouse number needed", routing refusals-with-documents to a cited document answer, and a stronger narrator precedence rule) fixed D02 (cap USD 2.0M stated and cited with the POL-004 §8 override; A=1 because the SQL path needed a retry) and D08. Remaining failures at the end: D03/D07/D09 are still answered from documents without the data numbers (no_sql used where SQL was needed), D01 narration cites only the contract and not the standard 99.0%, D06 retrieval misses the Scaling section, and D10's SQL is logically wrong (counts filed reclaims too: 100 vs 52 in the ground truth - filing dates are not in the warehouse, so only unfiled reclaims can be proven late). D05's v2.0 answer (16:00) was scored not-version-correct in Run 2 because its text also mentions the old 17:00 cut-off (a mention of the superseded value, not a wrong answer). **Treat these as a first, weak result, not validation.**

**Gaps.** access_level not enforced; only 5 event notices; documents are synthetic and written to be consistent with the warehouse; enrichment cannot link on `client_key`/`counterparty_key` alone; DOC tier ran once per iteration; the 30-question model regression (Run 3) was deliberately not run (budget) - only the model-free retrieval comparison above exists.


## D-049 — Demo-ready: governed tier-D metric, fan-out relaxation, code-side money units, live scope check, /evals page (harborline only)

MRO and Northwind unchanged. **No Anthropic API calls were made for D-049.** All model-in-the-loop tests ran through a local shim (`tools/llm-shim/`, test tooling only, not product code) that answers Messages-API requests with `claude -p` on a subscription login, the request's system prompt replacing Claude Code's, all tools disabled, `ANTHROPIC_API_KEY` removed from the child process. The app was pointed at it with `ANTHROPIC_BASE_URL` (the SDK honours it; the URL is not hardcoded) with a dummy key, tracing off and the local DuckDB file, so no test traffic reached MotherDuck traces or the production site. Caveat: the shim is Haiku 4.5 through Claude Code, not the metered API, so token counts and exact sampling are not comparable with the benchmark runs.

**Fixes (each tested with its own question, at most 2 retries).**
1. *Missed elections.* The fan-out rule now exempts parent-table aggregates that are idempotent under row duplication (`MIN`, `MAX`, `COUNT(DISTINCT …)`); `SUM`/`AVG`/`COUNT(col)` of a parent column still violate. One few-shot example shows the pre-aggregated CTE shape for `cae_client_election` + `cae_event` (a sibling question, not the demo question). The demo question returns valid SQL (44 rows) but needed 2 validator retries in the one test run.
2. *Tier-D.* New governed metric `counterparties_meeting_tier_d_criteria` encoding POL-007 §2 exactly: fail rate > 10% and average days failed > 4 over the trailing 12 months (window ends at the latest settlement date in the data), excluding `MARKET_RESTRICTION` fails, `policy_refs: [POL-007#2]`. Ground truth (formula run directly in DuckDB): 7 counterparties - Jedburgh Colt Securities 13.6%/6.68d, Lyndhurst Boyd Trust 13.21%/7.37d, Ilkley Marr Trust 12.95%/6.45d, Nantwich Strand Bank 12.9%/6.53d, Hawick Dunn Securities 12.79%/6.74d, Kendal Prowse Securities 12.43%/6.75d, Malvern Ley Bank 12.28%/6.93d (identical to the 7 assigned tier D). Two generator rules added: (11) run a retrieved governed metric's formula unchanged when it answers the question exactly; (12) exclude codes with `(col IS NULL OR col <> 'X')` - the first test run wrote `fail_reason_code != 'MARKET_RESTRICTION'`, which drops every settled row, returned 0 rows, and the narration confidently said no counterparty qualifies. With both rules the test run used the governed metric and returned exactly the 7.
3. *Money units.* `lib/moneyFormat.ts` formats money columns (K/M/B) before they reach the narrator (harborline only; `harborline/test_money_format.ts`, no LLM: 416000 → "$416K").
4. *Scope check in the live pipeline.* `lib/scopeCheck.ts`: the false positive is fixed first (a bare year such as "2026" is not a stated window; also fixed in `score_harborline.py`). Then narrate → check → if it fails, regenerate once with no policy chunks → check → if it still fails, drop the flagged sentences. Response field `scope_check`. Tested on total AUC (first narration made the fee-tier claim, was flagged, the policy-free regeneration was clean) and overall fail rate (clean first time).

**Problems found and fixed.**
| problem | fix | ADR |
|---|---|---|
| Crowding-out: ranked and expanded context chunks displaced the metric and table chunks a question needed | Table expansion with R_recall/R_precision scoring; policy chunks capped at 3 per request (D-045) | D-041, D-045 |
| Cross-tenant ranking drift: adding a tenant shifted other tenants' near-tied ranks (Voyage vectors move with the embedding call's batch composition) | Embedding isolation: legacy tenants embed in one call as before, every other tenant in its own batches | D-046 |
| Fan-out count inflation: joining two fact tables row-to-row multiplied rows and inflated counts and sums | Validator rule: one SELECT may reference at most one fact table (parent-child exemption), with a classified retry | D-047 |
| Tier-D instability: the model re-derived the tier-D criteria on every run and returned a different list each time | Governed metric encoding POL-007 §2 exactly, with the formula run unchanged | D-049 |

**Verification (through the shim, 3 runs per question; verdict rule as in OVERNIGHT_REPORT.md: STABLE = identical result rows in every run, no scope/fidelity/unit flag, same outcome every run; a consistent error is STABLE-FAIL; narration wording may vary).** Raw runs: `benchmark/stability_d049.json`; verdicts recomputed offline by `benchmark/stability_recompute.py`.
| question | rows identical | outcomes | flags | verdict | what happened |
|---|---|---|---|---|---|
| What is our overall settlement fail rate? | yes | valid / valid / valid | none | **STABLE** | 3.8% every time; no tier/SLA words, no phantom window; scope check intervened in 1 of 3 runs |
| What are our total assets under custody? | yes | valid / valid / valid | none | **STABLE** | $712.2B every time; the scope check fired on 3 of 3 first narrations (fee-tier language) and the policy-free regeneration was clean - the S01 problem is now handled in the pipeline |
| Which counterparties' settlement fails cost us the most in penalties? | yes | valid / valid / valid | unit:$416M | **UNSTABLE** | same 60 rows, but run 2's headline says "$416M" for two counterparties worth $416.0K (the narrator still mis-scaled a figure it summed itself; code-side formatting only covers cell values). Headlines also quote different top-N (4 / 2 / 8) |
| Which Platinum clients missed their SLA settlement target last month? | no (set: yes) | valid / valid / valid | none | **UNSTABLE** | same 8 clients and values in all runs; run 3 orders them differently, so strict row comparison fails (identical as a set) |
| Which corporate action elections did we miss, and what was the notice window? | no | valid / valid / valid | unit:$22.3M | **UNSTABLE** | valid SQL 3/3 and no HTTP 500 (was 0/3), 44 rows each time, but the SQL varies (extra announcement-date column in run 1). A '$22.3M' unit flag fired on run 2; possibly a false positive of the sum heuristic |
| Which counterparties meet our tier-D criteria? | yes | valid / valid / valid | none | **STABLE** | the same 7 counterparties 3/3 via the governed metric (was a different list every run) |
| What is our trading desk's P&L? | yes | declined / declined / declined | none | **STABLE** | declines 3/3 (HTTP 500 `no_sql_generated` is the deliberate refusal) |

**MRO S02/M08, retrieval only (no LLM; `benchmark/mro_retrieval_check_d049.json`).** Ids and order identical to D-044, zero policy or non-MRO chunks, both questions. Scores: **drift, reported as drift not failure** - M08 differs by 0.0016 on one run and is bit-identical to D-044 on the other (same code, so Voyage variance); S02 differs from the single D-044 reference run by 0.0021 in both current runs, which is *not* shown to be variance and is unresolved.

**Gates.** `tsc --noEmit` PASS; `next build` PASS (`/evals` prerenders); unit tests (no LLM) PASS: money format, scope check, validator rules. Tier-D list equals ground truth (7/7). Missed elections returns valid SQL (no HTTP 500). **Push gate FAIL: "Platinum SLA, P&L and fail rate STABLE" - Platinum SLA is UNSTABLE** under the strict row comparison (row order differs in one run; identical as a set). **Nothing was pushed** (D-047, D-048 and D-049 remain local; the live site is unchanged and no request was sent to it). I did not loosen the comparison to make the gate pass; with an order-insensitive comparison Platinum, P&L and fail rate would all be STABLE and nothing returned a non-refusal HTTP 500.

**Known gaps.** (1) Penalties headline unit error persists in 1 of 3 runs. (2) Platinum answers vary in row order, and missed-elections SQL varies between runs. (3) The shim is Claude Code on a subscription, not the metered API: sampling and token counts differ from the benchmark runs, and the 30-question benchmark was NOT re-run for D-049 (that needs the API), so the headline A-score on `/evals` is still the D-047/D-048 run, not a measurement of these fixes. (4) The scope check is regex-based and can drop a legitimate sentence or miss a paraphrase. (5) `/evals` shows the Evals link for harborline only (my choice, to keep MRO's UI unchanged); the page itself is reachable on any tenant by URL.

**API calls.** Zero Anthropic API calls. The app ran with a dummy key (`ANTHROPIC_API_KEY=shim-not-a-real-key`) and `ANTHROPIC_BASE_URL` at the shim, so a direct call would have failed authentication; the shim's `claude -p` child had `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` removed and reports `apiKeySource: none` (subscription login), `tools: []`. No benchmark runner (which calls the API) was executed. Voyage embedding calls (not Anthropic) were made for retrieval.

**D-049 addendum - deterministic ORDER BY.** Harborline generator rule 13: every multi-row result ends with an explicit ORDER BY (main measure first, entity name as tie-break). Re-ran only the Platinum SLA question 3 times through the shim (`benchmark/stability_d049_platinum_rerun.json`): **STABLE** (identical rows in identical order, valid 3/3, no flags). The other six questions were not re-run, so their verdicts above stand as measured before this rule. The push gate was not re-evaluated; all commits were pushed at the user's explicit instruction regardless of verdict. Still zero Anthropic API calls.

**D-049 addendum 2 - penalties headline unit error.** Cause: the narrator summed figures itself ("two counterparties = $416M" for $416.0K). Fix: (1) `moneyContext` computes column totals and running top-2..5 sums in code and passes them pre-formatted ("Pre-computed totals"); the harborline narrator rule now forbids arithmetic or rescaling. (2) The live scope check also verifies every money figure in the narration (including spelled-out "416 million dollars") against the formatted cells, code-computed totals and running sums (6% rounding tolerance, so a x1000 error is always caught); a failure triggers the existing regenerate-once, then drop-the-sentence path. Unit tests (no LLM) in `harborline/test_money_format.ts`. Test: the penalties question 3x through the shim (`benchmark/stability_d049_penalties_rerun.json`): **STABLE** (same rows, valid 3/3, no flags). **Honest note:** the prompt change alone did not stop the model from mis-scaling - in all 3 runs a sentence containing "$691.7M" (true value $691.7K, a top-5 sum) was generated even on regeneration, and the check dropped it; the headline then falls back to the first clean narrative sentence (can read truncated). The guarantee comes from the check, not from the narrator. Other questions were not re-run. Zero Anthropic API calls.


## D-050 — Harborline UI polish, meaning-based formatting, narrator accuracy checks (harborline only)

MRO and Northwind unchanged. **No Anthropic API calls were made for D-050.** Everything model-in-the-loop ran through the local shim (`tools/llm-shim/`, `claude -p` on a subscription login, dummy API key, tracing off, local DuckDB, no MotherDuck, no request to production). Voyage embedding calls (not Anthropic) were made for retrieval, as in D-049.

**How MRO stays unchanged.** Branding is per-tenant config (`lib/tenants.ts`: `productName`, `monogram`, `theme`, `showFeaturePills`, `showInsightTabs`); the defaults reproduce the old UI. The navy palette is CSS-token overrides under `html[data-theme="navy"]` only. Harborline renders a new component (`HarborlineAnswer.tsx`); `ChangeTab`, `ContributionTab` and the MRO formatters are untouched. `AnalysisHeader` and `/traces` branch on tenant. Evidence: MRO screenshots before vs after (same questions, `ACTIVE_TENANT=mro`): landing page byte-identical; answer pages visually identical (red AE mark, AskERP, pills, tabs, `$447.16M` legacy formatting) - only the LLM's wording and timings differ.

**What changed.**
1. *Branding.* "Harborline Analyst", an original navy "HA" monogram, navy/slate palette, feature pills and Change/Contribution tabs removed. Descriptor no longer says "mid-tier".
2. *Formatting by column meaning* (`lib/valueFormat.ts`): money (*_usd, amount, value, cost, fee, penalty, revenue, impact...) -> K/M/B/T with the largest unit under 1,000 (712173.78M -> $712.2B in header, big number and table; $999,950 -> $1M, not $1000K); *_pct / *_rate -> "93.4%" (Harborline stores percentages on a 0-100 scale; bps / fx / per-share rates are not percentages); counts -> "4,112"; year/month never number-formatted, `year_num`+`month_num` -> one "Month" column "Sep 2026"; booleans Yes/No. Unit tests per type: `harborline/test_value_format.ts` (no LLM).
3. *Titles and labels.* The narrator returns a short title (code strips any month/year it adds and appends the resolved period), headers are humanized ("Client", "Tier", "Settlement rate", "Target"), acronyms stay upper-case, a "Gap (pts)" column appears when a rate and a target are both present. Tables wrap and fit their card (checked: no horizontal overflow at 1440px).
4. *Relative dates* (`lib/period.ts`): resolved against the DATA's latest date, shown as a "Period:" line and given to the narrator. The data's latest settlement date is 2026-10-22, so "last month" = **September 2026 (latest complete month in the data)** - confirmed correct, matching the generator prompt.
5. *Narrator rules* (prompt + enforced in `lib/scopeCheck.ts`, via the existing narrate -> check -> regenerate-once -> drop-sentence path): custodians HOLD assets (never "manages"); no marketing/comparison words; "all N" only when N is the verified full population (PLATINUM clients in total: **8**, so "All 8" is correct for that question; a generic "all clients/markets/accounts" is flagged); every percentage must match the result cells or a supplied document; SLA credits are not mentioned unless asked (POL-001 §3: PLATINUM 5% per breached commitment capped at 20%, with exclusions - dropped rather than paraphrased); counts are checked too. **Found live and fixed:** the narrator wrote "9,211 instructions" for a true column total of 11,211 - the money check did not cover counts. Totals of count columns are now computed in code and handed to the narrator, and any 4+ digit integer in prose must match a cell, a code-computed total or a document number.
6. *Insights layout.* One-line headline, 2-4 bullets (bold key numbers), citation chips ("POL-001 §2") that open the Retrieval panel on that document (documents attached after the SQL ran are now listed there too).
7. *SQL panel* pretty-printed (`lib/sqlFormat.ts`, whitespace-only; tested that content is unchanged).
8. */traces.* Tenant column widened (it overlapped Outcome), Time column widened, note "Live: every request is logged.", and a robust timestamp format for the local driver.
9. */evals.* `evals_data.json` regenerated: Demo stability uses `stability_d049_platinum_rerun.json` and `stability_d049_penalties_rerun.json`, with before -> after derived from the committed files (penalties: UNSTABLE ($416M unit error) -> STABLE after code check; Platinum: UNSTABLE (row order differed) -> STABLE after deterministic ORDER BY). Notes added: "Offline snapshot from committed benchmark runs; updates on each benchmark run."; headline A-score unchanged, labelled "measured before D-049".
10. *Optional, done.* Eastgate (CA-001 §2) overrides the PLATINUM target (98.5%, not 99.0%). Deterministic lookup (`findTargetOverrides`, keyed on client names in the rows and the agreement's `overrides` front-matter, not on retrieval rank): the row uses 98.5%, `met_target` is recomputed, the row gets a dagger and a footnote with both chips, and the narrator is told to say it in one bullet citing CA-001 §2 and POL-001 §2. Skipped unless the result has client, rate and target columns. It did **not** destabilise the visible values (see below).

**Verification (through the shim, 3 runs per question, verdict rule as in D-049).** Raw runs: `benchmark/stability_d050.json`.
| question | rows identical | outcomes | flags | verdict |
|---|---|---|---|---|
| total assets under custody | yes | valid x3 | none | **STABLE** ($712.2B) |
| counterparties' penalties | yes | valid x3 | none | **STABLE** (no unit flag) |
| Platinum SLA last month | **no** | valid x3 | none | **UNSTABLE** |
| tier-D criteria | yes | valid x3 | none | **STABLE** |
| trading desk P&L | yes | declined x3 | none | **STABLE** (deliberate refusal) |

*Why Platinum is UNSTABLE:* the 8 clients, their values and order, and the Eastgate 98.5% override were identical in all 3 runs. The difference is the generated SQL shape: run 1 omitted the `met_target` column that runs 2 and 3 included, so the row tuples differ. That is the same SQL-shape variance D-049 recorded for the generator, which D-050 did not touch; the strict comparison counts it, and I did not loosen the rule. (D-049's ORDER BY rule fixed row order, not column set.) A possible follow-up is a generator rule fixing the output columns for the governed SLA question.

**Gates.** `tsc --noEmit` clean; `next build` passes; unit tests pass (value format, money format, scope check, validator rules). **Push gate FAIL: Platinum SLA is UNSTABLE. Nothing was pushed** (D-047 to D-050 remain local; production is unchanged and no request was sent to it).

**Screenshots** (Playwright on system Chrome, local, 1440px): `benchmark/screenshots_d050/` - `01_auc_answer.png`, `02_platinum_answer.png`, `03_traces.png`, `04_evals.png`.

**Known gaps.** (1) The shim is Haiku through Claude Code, not the metered API; the 30-question benchmark was not re-run (needs the API), so the A-score on /evals is still the pre-D-049 measurement. (2) The scope/claim check is regex-based: it can drop a legitimate sentence or miss a paraphrase; the narrator also still tends to mention SLA credits and the check drops that sentence in most Platinum runs (a prompt-only fix did not hold; the guarantee comes from the check). (3) Percent check tolerance is 0.05 pts / whole-number rounding. (4) Local traces test rows written for the /traces screenshot were deleted from the local DuckDB afterwards (0 rows, as before).

**API calls.** Zero Anthropic API calls (dummy key `shim-not-a-real-key`; the shim child runs with `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` removed).
