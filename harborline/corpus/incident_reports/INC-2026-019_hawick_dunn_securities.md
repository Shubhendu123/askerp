---
doc_id: INC-2026-019
doc_type: incident_report
title: Incident Report — Missing settlement instructions after platform migration, Hawick Dunn Securities
tenant: harborline
authority_rank: null
effective_from: 2026-06-02
effective_to: null
version: 1.0
supersedes: null
entities: {counterparty: "Hawick Dunn Securities"}
access_level: INTERNAL
binds_to: [stl_trade_instruction, dim_counterparty]
---

# Incident Report INC-2026-019
**Counterparty:** Hawick Dunn Securities · **Severity:** Medium · **Owner:** Head of Settlements · **Raised:** 2 June 2026

## Summary
Hawick Dunn Securities, a tier D counterparty, generated a sustained run of COUNTERPARTY_INSTRUCTION_MISSING and MISMATCHED_INSTRUCTION fails.

## Root cause
The counterparty migrated its post-trade platform and lost standing settlement instructions for several Harborline client accounts. Trades were executed but not instructed to the market, or instructed with outdated account details.

## Distinction from INC-2026-012
Unlike Kendal Prowse (inventory shortfall), Hawick Dunn's fails are **operational, not inventory-driven**, and are expected to fall once settlement instructions are re-established. Penalties are attributed to the counterparty (POL-002 §5) and claimed through the CSD.

## Actions
Standing settlement instructions re-confirmed for all affected accounts; weekly check-in until the fail rate falls below the tier C threshold for one full month.
