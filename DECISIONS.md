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
