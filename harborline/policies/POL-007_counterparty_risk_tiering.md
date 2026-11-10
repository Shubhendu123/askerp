---
doc_id: POL-007
title: Counterparty Risk Tiering and Review Policy
tenant: harborline
domain: risk
effective_date: 2025-01-01
version: 2.0
owner: Head of Operational Risk
binds_to: [dim_counterparty.reliability_tier, stl_trade_instruction, stl_fail_penalty]
governs: "individual counterparties (tiers apply to a counterparty, never to Harborline or a client)"
---

# Counterparty Risk Tiering and Review Policy

## 1. Purpose
Harborline settles against brokers, banks, other custodians and clearing members on behalf of clients. Counterparty settlement behaviour is the largest controllable driver of fail rates, penalty exposure and client overdrafts. Every counterparty is assigned a reliability tier (`dim_counterparty.reliability_tier`) that governs monitoring intensity and the actions Harborline takes.

## 2. Tier definitions
Tier is assigned on trailing 12-month settlement performance:

| Tier | Fail rate (instructions failed ÷ instructions) | Average days failed | Expected behaviour |
|---|---|---|---|
| A | below 1.5% | below 1.0 | Reliable. Standard monitoring. |
| B | 1.5% – 4.0% | 1.0 – 2.0 | Acceptable. Quarterly review. |
| C | 4.0% – 10.0% | 2.0 – 4.0 | Watch list. Monthly review; pre-matching mandatory. |
| D | above 10.0% | above 4.0 | Chronic. Restricted; see §4. |

Fail rate is calculated from `stl_trade_instruction` where `counterparty_key` matches, over the trailing 12 months, excluding fails with `fail_reason_code = MARKET_RESTRICTION`.

## 3. Review triggers
A counterparty is reviewed outside the normal cycle when any of the following occur:
- Rolling 90-day fail rate exceeds the upper bound of its current tier
- Penalties attributed to the counterparty (`stl_fail_penalty.bearer = COUNTERPARTY`) exceed USD 25,000 in a calendar month (POL-002 §7)
- Three or more aged fails (day 5+) for a single client in one month (POL-006 §5)
- A client formally complains about the counterparty's settlement performance

## 4. Tier D restrictions
Counterparties in tier D are subject to:
- Mandatory pre-matching on all instructions
- Daily fail report to the counterparty's operations head
- Notification to all PLATINUM and GOLD clients who trade with the counterparty, advising them of elevated fail risk
- A formal remediation plan with a 90-day review; failure to move to tier C within two review cycles results in Harborline recommending that clients route trades through alternative counterparties

## 5. Affiliated counterparties
Counterparties flagged `is_affiliated = true` are group entities. They are tiered on the same criteria and receive no exemption from tier D restrictions.

## 6. Concentration
No single counterparty may account for more than 15% of Harborline's settlement instruction volume in any market over a calendar quarter. Breaches are reported to the Operational Risk Committee.

## 7. Client reporting
Clients may request their fail rate by counterparty at any time. Relationship managers proactively provide this to PLATINUM clients quarterly.
