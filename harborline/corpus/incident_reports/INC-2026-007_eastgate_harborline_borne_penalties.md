---
doc_id: INC-2026-007
doc_type: incident_report
title: Incident Report — Harborline-borne CSDR penalties on Eastgate Capital Partners account
tenant: harborline
authority_rank: null
effective_from: 2026-02-16
effective_to: null
version: 1.0
supersedes: null
entities: {client: "Eastgate Capital Partners"}
access_level: INTERNAL
binds_to: [stl_fail_penalty, stl_trade_instruction]
---

# Incident Report INC-2026-007
**Client:** Eastgate Capital Partners · **Severity:** High · **Owner:** Head of Settlements · **Raised:** 16 February 2026

## Summary
Harborline-borne penalties (POL-002 §5) on Eastgate's account are the largest of any client. Under the attribution rules, Harborline bears a penalty only where the fail is caused by Harborline itself — a mismatched instruction or late matching on Harborline's side. This report explains why that is concentrated on one client.

## Root cause
Eastgate is a high-turnover hedge fund that sends large volumes of instructions close to the cut-off. Harborline's instruction-enrichment step (adding settlement details before release to the market) mis-populated place-of-settlement data for a subset of Eastgate's EU trades, producing MISMATCHED_INSTRUCTION and LATE_MATCHING fails attributed to Harborline.

## Why it is not passed to the client
Eastgate's agreement (CA-001 §4) confirms that penalties arising from Harborline's own processing errors remain with Harborline.

## Remediation
1. Validation rule added to the enrichment step for EU place-of-settlement codes.
2. Eastgate EU instructions routed through mandatory pre-matching on trade date.
3. Monthly review of Harborline-borne penalties by client, reported to the Operational Risk Committee until two consecutive months fall below USD 5,000.
