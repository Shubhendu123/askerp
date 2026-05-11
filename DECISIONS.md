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
