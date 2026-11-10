---
doc_id: POL-001
title: Client Service Level Agreement Schedule
tenant: harborline
domain: client_service
effective_date: 2025-01-01
version: 3.2
owner: Head of Client Service
doc_type: policy
authority_rank: 3
access_level: INTERNAL
effective_from: 2025-01-01
effective_to: null
supersedes: null
entities: {}
binds_to: [dim_client.sla_tier, stl_trade_instruction, clt_service_request, cae_income_payment, clt_fee_invoice]
governs: "individual clients (each client is measured against its own SLA tier; never Harborline as a whole)"
---

# Client Service Level Agreement Schedule

## 1. Purpose
This schedule defines the contractual service commitments Harborline Global Custody makes to each client, by SLA tier. Every client is assigned exactly one tier at onboarding (`dim_client.sla_tier`). Tier determines settlement performance targets, service request response times, income payment commitments, corporate action notification windows, and the SLA credit payable when a commitment is breached.

## 2. SLA tiers and commitments

| Commitment | PLATINUM | GOLD | SILVER |
|---|---|---|---|
| Monthly settlement rate (settled on intended settlement date) | ≥ 99.0% | ≥ 98.0% | ≥ 97.0% |
| Maximum fails aged > 5 business days per month | 3 | 8 | 15 |
| P1 service request response | 2 business hours | 4 business hours | 8 business hours |
| P2 service request response | 8 business hours | 24 business hours | 48 business hours |
| P3 service request response | 24 business hours | 48 business hours | 72 business hours |
| Income credited to client account | within 1 business day of receipt | within 2 business days | within 3 business days |
| Corporate action notification to client | within 1 business day of announcement | within 2 business days | within 3 business days |
| Contractual income settlement (see POL-008) | Yes | Yes | No |
| Dedicated relationship manager | Yes | Yes | Shared |

Settlement rate is measured as the percentage of a client's instructions in the calendar month where `actual_settle_date_key` equals `intended_settle_date_key`. Instructions cancelled before intended settlement date are excluded from both numerator and denominator.

## 3. SLA credits
Where Harborline breaches a commitment in Section 2 in a calendar month, the client is entitled to a credit against that month's custody fee (`clt_fee_invoice` where `fee_type = CUSTODY_BPS`):

- PLATINUM: 5% of the monthly custody fee per breached commitment, capped at 20% per month
- GOLD: 3% per breached commitment, capped at 12% per month
- SILVER: 1% per breached commitment, capped at 5% per month

Credits are applied as a fee waiver with `waiver_reason = SLA_CREDIT`. Credits are not payable where the breach is caused by a counterparty failure, a market infrastructure outage, or a client instruction received after the market cut-off (POL-003).

## 4. Measurement and reporting
Settlement rate and aged-fail counts are measured per client per calendar month. Service request response time is measured from `raised_date_key` to first substantive response, in business hours of the client's primary market. A request is `sla_breached = true` when `resolution_hours` exceeds the tier target for its priority.

## 5. Tier review
Tiers are reviewed annually. A client may be moved up a tier where assets under custody exceed USD 25 billion (GOLD) or USD 60 billion (PLATINUM), or at the discretion of the Head of Client Service.
