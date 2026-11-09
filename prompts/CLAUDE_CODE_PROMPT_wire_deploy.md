# Claude Code Prompt — Wire live app to MotherDuck + MRO tenant (dense retrieval), deploy

## Context — read first
DECISIONS.md D-032 (MotherDuck hosting), D-034..D-036 (OTIF, tenant isolation, benchmark).
The warehouse lives in MotherDuck database `askerp` (schemas: main = Northwind, mro_distributor
= MRO; parity-verified). The repo's data/northwind.db is untracked; the live Vercel deploy
still runs the old bundled-file path — this task ends that era.
Benchmark verdict (D-036): dense-only retrieval won H-tier (A 1.21, 64% SQL validity) and
is the chosen production mode. rrf and bm25 remain available as non-default test paths.

## Objective
Production reads MotherDuck (no bundled DB), tenant = mro, retrieval mode = dense.
Local dev keeps working against the local file. Then deploy and smoke-test live.

## Build steps

### 1. DB access layer — environment-switched
- Production (Vercel): connect to MotherDuck over its Postgres-protocol endpoint using the
  `pg` npm package (serverless-safe, no native DuckDB binary). Consult MotherDuck's current
  docs for the endpoint host/connection format before writing code — do not guess it.
- Local dev: keep the existing local-file DuckDB path.
- Switch on env (e.g. MOTHERDUCK_TOKEN present => cloud). One query interface for the rest
  of the app; call sites should not know which backend answered.
- Table qualification: cloud queries hit `mro_distributor.*` inside database `askerp`;
  verify the generated SQL's schema-qualification works identically on both backends
  (adjust search_path/session defaults rather than rewriting SQL strings).
- Connection reuse: create the client/pool once per warm serverless instance (module scope),
  NOT per request — MotherDuck compute (CU) is metered; per-request reconnects burn it.
- If SQL-dialect differences surface between DuckDB-native and the Postgres endpoint (e.g.
  date functions), fix at the query-generation layer and record each in the ADR. If any
  dialect gap is fundamental (a benchmark query cannot run via pg), STOP and report before
  working around it.

### 2. Retrieval default -> dense (production)
- Default mode: dense for the live /api/ask path. Implement as config/env
  (RETRIEVAL_MODE=dense) with rrf as fallback value — do not delete rrf/bm25 paths; the
  benchmark harness depends on them.
- Keep ACTIVE_TENANT=mro default from D-035.

### 3. Env vars
- Required in production: MOTHERDUCK_TOKEN, ACTIVE_TENANT=mro, RETRIEVAL_MODE=dense,
  plus existing VOYAGE_API_KEY, ANTHROPIC_API_KEY, USE_RETRIEVAL=true (unchanged).
- .env.example updated. NEVER print, log, or commit any token value. The user will add
  MOTHERDUCK_TOKEN in the Vercel dashboard themselves — when you reach that point, PAUSE
  and tell them; do not attempt it via CLI with the token inline.

### 4. Pre-push smoke test (gate — plain terminal)
Run the app locally in PRODUCTION mode (cloud path forced) and prove, with real output:
- /api/ask "What is our total revenue?" -> answer consistent with the anchor (~$447M/18mo,
  ~$298M annualized) and retrieved chunks are mro:* only
- /api/ask "What is our OTIF rate by warehouse?" -> runs, plausible (~78% overall)
- one H-tier question (H03) -> SQL executes against MotherDuck (answer quality per benchmark
  expectations; it must RUN)
- confirm zero reads of data/northwind.db in this mode (e.g. temporarily rename the file
  during the test)
- report per-query latency vs the old local-file path; flag if p50 exceeds ~3s

### 5. Deploy
- Commit: "feat: MotherDuck production backend + MRO tenant + dense retrieval (D-037)".
- PAUSE before pushing: confirm with the user that MOTHERDUCK_TOKEN is set in Vercel.
- Push. Verify build succeeds. Then live smoke test on the deployed URL: S02 (DSO) and
  M08 (top suppliers by spend) through the real site; paste responses + latency.
- If the deploy fails or live queries error: report exactly what failed; do NOT roll back
  the repo state without asking.

### 6. ADR D-037
Deployment architecture: MotherDuck via pg (serverless constraints), env-switched backends,
connection-reuse pattern, dense-as-default with benchmark rationale (D-036 numbers), any
dialect fixes encountered, live smoke results.

## Working style (hard rules)
- Verify in a PLAIN terminal; real output, not intent. Brief responses.
- PAUSE points: (a) before Vercel env setup — user adds token; (b) before push.
- Never expose secrets. If blocked, ask — one question cluster at a time.
- Scope: no UI changes, no retriever algorithm changes beyond the mode default, no phase-5
  work (top-k sweep etc. comes later).
