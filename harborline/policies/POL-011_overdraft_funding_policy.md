---
doc_id: POL-011
title: Client Cash Overdraft and Funding Cost Policy
tenant: harborline
domain: treasury
effective_date: 2025-01-01
version: 2.3
owner: Head of Treasury Operations
binds_to: [pos_cash_balance, stl_trade_instruction, dim_client.sla_tier, clt_fee_invoice]
---

# Client Cash Overdraft and Funding Cost Policy

## 1. Purpose
A client cash account is overdrawn when its closing balance in a currency is negative (`pos_cash_balance.is_overdrawn = true`). Overdrafts most often arise when a client's delivery settles and the cash leg is paid away, but a matching receive has failed and the expected cash has not arrived. Harborline funds the shortfall overnight and charges the client. This policy defines tolerance, charging, notification and escalation.

## 2. Causes
In order of frequency:
1. **Failed receive** — the client has sold securities and bought others; the sale fails (no cash in) while the purchase settles (cash out). Linked to `stl_trade_instruction` with `direction = RECEIVE`, `settlement_status = FAILED`.
2. **Late income** — a contractual income credit (POL-008 §4) has not been funded by the market
3. **Client funding error** — the client has not pre-funded a purchase
4. **FX timing** — currency conversion settles a day after the securities leg

## 3. Tolerance
Overdrafts of less than USD 50,000 or lasting one business day are tolerated without charge for PLATINUM and GOLD clients. SILVER clients are charged from the first day. All overdrafts are recorded regardless of charging.

## 4. Funding cost
`funding_cost_usd` is charged daily on the overdrawn amount at the relevant currency's overnight benchmark rate plus 150 bps, annualised, divided by 360. Charges are invoiced monthly under `fee_type = OVERDRAFT`.

Where the overdraft is caused by a counterparty-attributable fail (`stl_fail_penalty.bearer = COUNTERPARTY`, or fail reason COUNTERPARTY_INSTRUCTION_MISSING), Harborline waives the funding cost to the client and recovers it from the counterparty where market practice permits. Waived amounts are recorded with `waiver_reason = SLA_CREDIT`.

## 5. Notification
- Any overdraft above USD 1,000,000 — client notified the same business day
- Any overdraft lasting more than 3 business days — relationship manager informed
- Any overdraft above USD 10,000,000 — Head of Treasury Operations and Chief Risk Officer notified immediately

## 6. Limits
Each client has an unadvised overdraft limit set at onboarding, typically 2% of assets under custody. Overdrafts exceeding the limit require same-day approval from the Head of Treasury Operations. Persistent breaches are a tier-review trigger.

## 7. Reporting
Daily overdraft report by client, currency and cause. Monthly funding cost by client and by causal counterparty, to the Operational Risk Committee. The share of overdraft days caused by failed receives is a standing metric; a rising share indicates counterparty deterioration (POL-007).
