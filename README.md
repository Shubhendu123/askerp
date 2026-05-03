# AskERP
**Conversational analytics for Northwind Furniture — ask questions, get answers.**

Status: 🚧 Under construction (Week 1 of 3-week sprint)

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

## Roadmap
- [x] Project scaffold
- [ ] Synthetic ERP data (Northwind Furniture)
- [ ] Semantic layer + metrics definitions
- [ ] NL→SQL pipeline with schema retrieval
- [ ] Visualization & insight narration
- [ ] Guardrails (validation, RBAC, hallucination checks)
- [ ] Evals harness
- [ ] Multi-turn conversation

## Local Setup
1. Clone this repo
2. `npm install`
3. Copy `.env.example` to `.env.local` and add your Anthropic API key
4. `npm run dev`
