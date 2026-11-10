# Claude Code Prompt — D-047: Enterprise document corpus (5 document types, governed retrieval)

## Prerequisite
D-046 committed (Part C Run 1 + Run 2). If not, stop and say so.

## Why
D-045 added 12 internal policies. Real custodians run on far more: regulations, client
contracts that override policy, dated market guides, per-event corporate action notices, and
incident history. Each type exposes a retrieval problem a data-only system can't handle:
precedence, versioning, entity scoping, row-level document linking, institutional memory.

## Read first
DECISIONS.md D-035 (tenant isolation), D-041 (expansion, crowding-out), D-045 (policy chunks,
cap, citation rule), D-046 (relevance floor, narrator citation rule, generator rules).
The corpus: `harborline/corpus/` (23 documents) + `harborline/policies/` (12 policies).

## The corpus
| Folder | Docs | doc_type | authority_rank | Linked by |
|---|---|---|---|---|
| corpus/regulation | 2 | regulation | 1 | markets |
| corpus/client_agreements | 6 | client_agreement | 2 | client (CONFIDENTIAL) |
| policies | 12 | policy | 3 | binds_to tables |
| corpus/market_guides | 6 (IT has v1.0 + v2.0) | market_guide | 4 | market, effective dates |
| corpus/event_notices | 5 | event_notice | null (record) | event_key |
| corpus/incident_reports | 4 | incident_report | null (record) | client / counterparty / event |

Every document has YAML frontmatter: `doc_id, doc_type, title, authority_rank, effective_from,
effective_to, version, supersedes, entities, access_level, binds_to`, and contracts carry
`overrides`. Lower authority_rank wins a conflict: regulation > client agreement > policy > guide.

---

## PART A — Ingest and render

1. **Upgrade the 12 policies' frontmatter** to the same schema: `doc_type: policy`,
   `authority_rank: 3`, `access_level: INTERNAL`, `effective_from` = existing `effective_date`,
   `effective_to: null`, `entities: {}`. Do not change their body text.
2. **Render templated documents.** Event notices and `INC-2630_...` contain `{{PLACEHOLDERS}}`.
   Render them from `cae_event` + `dim_security` for the document's `event_key`:
   `SECURITY_NAME, ISIN, EVENT_REF, ANNOUNCEMENT_DATE, RECORD_DATE, RESPONSE_DEADLINE,
   PAYMENT_DATE, RATE, NOTICE_WINDOW_DAYS`; `RESPONSE_DEADLINE_PLUS_3BD` = deadline + 3 business
   days. Keep templates as source; write rendered output to a build folder. Gate: every
   rendered date and rate equals the warehouse row.
3. **Entity resolution assertion (build time).** Every name in `entities` must resolve to a key:
   clients → `dim_client.client_name`, counterparties → `dim_counterparty.counterparty_name`,
   markets → `dim_market.market_code`, event_key → `cae_event.event_key`. Fail the build if not.
4. **Chunking:** section-level (as D-045). IDs `harborline:CA-001#2`; versioned docs carry the
   version: `harborline:MG-IT@1.0#1`, `harborline:MG-IT@2.0#1`. Every chunk inherits all
   frontmatter metadata. Unify policy + new types as one `document` chunk family with `doc_type`.
5. **Vercel:** extend `outputFileTracingIncludes` to `harborline/corpus/**` (and the render
   output) so production does not silently ship with zero documents.

## PART B — Governed retrieval behaviours

1. **Entity-scoped documents.** Documents with entity scope (client agreements, incident
   reports, event notices) are **excluded from ranked retrieval** and included only when their
   entity is in scope: the question names the client/counterparty/market/event (match against
   the dimension names and codes, and "event NNNN"). This stops 6 contracts crowding every
   answer, and stops a client's CONFIDENTIAL contract surfacing in an unrelated client's answer.
2. **Effective dating.** Default to the version in force today (`effective_to: null`). If the
   question names a past date or month, use the version in force on that date. Superseded
   versions must never appear in a "current" answer.
3. **Precedence.** When chunks of different authority address the same rule, the lower
   authority_rank wins. The narrator must state the override explicitly and cite both
   ("Eastgate's agreement sets 98.5% (CA-001 §2), overriding the standard PLATINUM 99.0%
   (POL-001 §2)"). The SQL generator must use the contract threshold for an in-scope client.
4. **Post-SQL enrichment (row-level linking).** After execution, if result rows contain an
   `event_key`, client or counterparty that has linked documents, attach those document chunks
   (cap 3) to the narrator's context. This is two-stage retrieval: the data result decides which
   documents the narrator reads.
5. **Document-only answers.** If retrieved documents fully answer the question and no data is
   needed (e.g. "When does the EU move to T+1?"), the generator may return `NO_SQL`; the narrator
   answers from documents. A `NO_SQL` answer must cite at least one document, otherwise treat it
   as a refusal.
6. **Caps.** Document chunks (all types) capped at 5 per request. Priority: entity-linked >
   `policy_refs`-expanded > ranked above the D-046 relevance floor.
7. **access_level** is carried and shown as a badge in the Retrieval panel (e.g. CONFIDENTIAL).
   There is no user identity, so it is not enforced — record this as a gap.

## PART C — Verify (ground truth first)

Add 11 questions to `benchmark/questions_harborline.json` as tier `DOC`. Hand-author ground
truth (SQL where needed, expected facts and required doc chunks) BEFORE any model run.

| ID | Question | Tests |
|---|---|---|
| D01 | Did Eastgate Capital Partners meet its settlement SLA in September 2026? | precedence: 98.5% (CA-001) over 99.0% (POL-001) |
| D02 | How much does Harborline owe Pinnacle for the missed rights issue? | contract cap USD 2M (CA-002 §2) vs data impact; gross-negligence review (INC) |
| D03 | For Vantage's missed dividend option in Italy, what should have been applied? | standing instruction cash (CA-005) vs issuer default shares (EVT-2704) |
| D04 | What was the client instruction cut-off for Italian trades in February 2026? | versioning: 17:00 CET (MG-IT v1.0), not 16:00 |
| D05 | What is the client instruction cut-off for Italian trades today? | versioning: 16:00 CET (MG-IT v2.0) |
| D06 | If Montclair had tendered in event 2706, would all its shares have been bought? | notice-only terms: partial offer, pro-rata scaling (EVT-2706) |
| D07 | Is Westmark's missed German takeover election (event 2751) still recoverable, and what do we owe? | multi-doc: additional acceptance period (EVT-2751 + MG-DE §2), uncapped + interest (CA-004 §2) |
| D08 | Has Kendal Prowse Securities been through remediation, and what was the outcome? | institutional memory (INC-2026-012) |
| D09 | Why does Eastgate carry so many Harborline-borne penalties? | data share + explanation (INC-2026-007, CA-001 §4) |
| D10 | Which of Westmark's eligible reclaims breached its 90-day filing window? | contract rule in SQL (CA-004 §1) |
| D11 | What is Redwood Asset Management's settlement rate? | **leakage control:** zero client_agreement chunks (Redwood has none) |

Also D12: "When do the UK and EU move to T+1?" → `NO_SQL`, 11 October 2027 (REG-002).

Scoring additions: **document coverage** (required doc chunks retrieved), **precedence
correctness** (override applied and both cited), **version correctness**, **confidential
leakage** (client_agreement chunks retrieved for an out-of-scope client — must be 0 across
the whole run), plus the existing A-score and citation accuracy.

Regression: rerun the full 30-question Part C set as **Run 3** and compare with D-046 Run 2 —
no tier may drop by more than noise. MRO S02/M08 retrieval must remain bit-identical.

## Gates (real terminal output)
1. Corpus: 35 documents, chunk count by doc_type, zero duplicate IDs, entity assertion passes,
   rendered notices match the warehouse
2. Behaviour demos: one question each showing entity scoping, version selection, precedence
   statement, post-SQL enrichment, and a NO_SQL answer
3. DOC-tier results table + confidential leakage = 0
4. Run 3 vs Run 2 regression table; MRO bit-identical
5. `npx tsc --noEmit` clean
If a gate fails, stop and report. Do not re-run to get better numbers.

## ADR — D-047
Document types and why each exists; the metadata schema; authority ranking and precedence;
entity scoping as both an anti-crowding and a confidentiality measure; effective dating;
post-SQL enrichment as two-stage retrieval; NO_SQL path; results; gaps (access_level not
enforced without identity; only 5 event notices; documents are synthetic, written to be
consistent with the warehouse).

## Working style
Plain-terminal verification, brief. Commit: "feat: enterprise document corpus + governed
retrieval (D-047)". Do NOT push unless told.
