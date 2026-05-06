# AskERP
**Conversational analytics for Northwind Furniture — ask questions, get answers.**

Status: 🚧 Week 1 complete (data foundation) — Week 2 starting (semantic layer + agent loop)

## About
AskERP is an LLM-powered analytics assistant that lets enterprise users query ERP data, generate visualizations, and receive AI-narrated insights through natural language. Built on a synthetic NetSuite-shaped data warehouse for a fictional B2B furniture company, Northwind Furniture. The goal is to demonstrate how conversational AI can lower the barrier to enterprise data access.

## Tech Stack
- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui
- DuckDB (embedded analytics warehouse)
- Anthropic Claude API
- Recharts (visualization)
- Vercel (hosting)

## Architecture Decisions
Major architectural and product decisions are documented in [DECISIONS.md](DECISIONS.md) as Architecture Decision Records (ADRs).

## Data Layer
Synthetic ERP data for Northwind Furniture (~$50M B2B furniture company) — 3 years of history (2023-2025), 96K rows across 9 tables. Includes three deliberately planted anomalies (refund spike, whale customer churn, margin compression) that serve as evaluation ground truth for the agent layer. Data is generated reproducibly via scripts (CSVs and warehouse file are gitignored).

## Roadmap
- [x] Project scaffold
- [x] Synthetic ERP data (Northwind Furniture)
- [x] Production-shaped DuckDB loader + verification suite
- [ ] Semantic layer + metrics definitions
- [ ] NL→SQL pipeline with schema retrieval (RAG)
- [ ] Multi-agent orchestration
- [ ] Visualization & insight narration
- [ ] Guardrails (validation, RBAC, hallucination checks)
- [ ] Evals harness (component + end-to-end + agentic)
- [ ] Multi-turn conversation
- [ ] Multi-tenancy demonstration

## Local Setup
1. Clone this repo
2. `npm install`
3. Copy `.env.example` to `.env.local` and add your Anthropic API key
4. `npm run dev`
