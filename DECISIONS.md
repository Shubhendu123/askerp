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

(More decisions will be added as we build.)
