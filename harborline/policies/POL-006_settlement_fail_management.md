---
doc_id: POL-006
title: Settlement Fail Management and Escalation Procedure
tenant: harborline
domain: settlement
effective_date: 2025-01-01
version: 2.4
owner: Head of Settlements
binds_to: [stl_trade_instruction.days_failed, stl_trade_instruction.fail_reason_code, dim_counterparty.reliability_tier, dim_client.sla_tier]
governs: "individual failed settlement instructions (ageing and escalation)"
---

# Settlement Fail Management and Escalation Procedure

## 1. Purpose
A settlement fail is any instruction not settled on its intended settlement date (`settlement_status = FAILED`, `days_failed > 0`). Fails incur cash penalties in regulated markets (POL-002), leave clients short of securities or cash, cause overdrafts (POL-011) and trigger reconciliation breaks (POL-009). This procedure defines the chase timeline, escalation points and buy-in triggers.

## 2. Fail reason codes
Every fail is assigned one `fail_reason_code`:

| Code | Meaning | Typical bearer |
|---|---|---|
| LACK_OF_SECURITIES | Delivering party does not hold the securities | Deliverer |
| LACK_OF_CASH | Receiving party has insufficient cash | Receiver |
| MISMATCHED_INSTRUCTION | Instruction details do not agree between parties | Party in error |
| COUNTERPARTY_INSTRUCTION_MISSING | Counterparty has not instructed | Counterparty |
| LATE_MATCHING | Matched after the market matching deadline | Party in error |
| MARKET_RESTRICTION | Market-level block (e.g. trading halt, sanctions screen) | Absorbed |

## 3. Chase timeline
Measured in business days after intended settlement date (`days_failed`):

| Day | Action |
|---|---|
| 1 | Automated chase to counterparty; client notified for PLATINUM tier |
| 2 | Settlements analyst contacts counterparty directly; client notified for all tiers |
| 3 | Escalated to Settlements team lead; relationship manager informed |
| 5 | **Aged fail.** Escalated to Head of Settlements. Counted against the client's aged-fail SLA limit (POL-001 §2) |
| 7 | Buy-in notice issued to counterparty where permitted by market rules |
| 10 | Buy-in executed or trade cancelled; written root-cause note required |
| 15+ | Reported to Operational Risk Committee as a critical fail |

## 4. Prioritisation
When fails exceed team capacity, chase order is by financial impact, not by age:
1. Fails in CSDR/CREST markets with daily penalty exposure above USD 500
2. Fails causing a client overdraft (POL-011)
3. Fails for PLATINUM clients
4. Remaining fails by settlement value, descending

## 5. Counterparty escalation
- A counterparty whose fail rate over a rolling 90 days exceeds 5% is referred for tier review (POL-007).
- A counterparty generating three or more aged fails (day 5+) for the same client in one month triggers a direct discussion between Harborline and the counterparty's operations head.

## 6. Pre-matching
All instructions in T+2 markets are pre-matched on trade date where the counterparty supports it. Pre-matching reduces LATE_MATCHING and MISMATCHED_INSTRUCTION fails and is mandatory ahead of the October 2027 T+1 migration.

## 7. Reporting
Daily fail report by market, counterparty, client and reason code. Weekly aged-fail report (day 5+) to the Head of Settlements. Monthly fail rate by counterparty tier to the Operational Risk Committee.
