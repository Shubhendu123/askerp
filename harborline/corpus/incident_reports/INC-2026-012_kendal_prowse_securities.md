---
doc_id: INC-2026-012
doc_type: incident_report
title: Incident Report — Chronic settlement fails, Kendal Prowse Securities
tenant: harborline
authority_rank: null
effective_from: 2026-04-08
effective_to: null
version: 1.1
supersedes: INC-2026-012 v1.0
entities: {counterparty: "Kendal Prowse Securities"}
access_level: INTERNAL
binds_to: [stl_trade_instruction, dim_counterparty, stl_fail_penalty]
---

# Incident Report INC-2026-012
**Counterparty:** Kendal Prowse Securities · **Severity:** High · **Owner:** Head of Operational Risk · **Raised:** 8 April 2026

## Summary
Kendal Prowse Securities is the counterparty with the highest number of aged fails (5+ business days) in Harborline's network and is classified tier D under POL-007.

## Root cause (per counterparty response)
The predominant fail reason is LACK_OF_SECURITIES on deliveries to Harborline clients: the counterparty sells short of inventory and relies on borrowing that is not always secured before settlement date.

## Actions taken
1. Tier D restrictions applied (POL-007 §4): mandatory pre-matching, daily fail report to the counterparty's operations head.
2. All PLATINUM and GOLD clients trading with Kendal Prowse notified of elevated fail risk.
3. 90-day remediation plan agreed. **Review outcome (July 2026): no improvement; remains tier D.** Under POL-007 §4, a second failed review would lead Harborline to recommend that clients route trades through alternative counterparties.
