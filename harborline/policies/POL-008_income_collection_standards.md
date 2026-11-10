---
doc_id: POL-008
title: Income Collection and Contractual Settlement Standards
tenant: harborline
domain: asset_servicing
effective_date: 2025-01-01
version: 2.2
owner: Head of Asset Servicing
binds_to: [cae_income_payment, cae_event, dim_client.sla_tier, pos_cash_balance]
---

# Income Collection and Contractual Settlement Standards

## 1. Purpose
Income — dividends on equities and ETFs, coupons on bonds, distributions on money market instruments — is collected from the issuer's paying agent via the subcustodian and credited to the client's cash account. This policy sets the standards for timeliness, the contractual income arrangement for eligible clients, and the handling of late and incorrect payments.

## 2. Expected payment date
`cae_income_payment.expected_date_key` is the issuer's payment date (`cae_event.payment_date_key`). `actual_date_key` is the date funds were received by Harborline. `days_late` = actual − expected, in business days.

## 3. Timeliness standard
Target: 95% of income payments received on the expected date; no payment later than 5 business days except where the issuer or paying agent is in default. Late payments are concentrated in markets with manual paying-agent processes.

## 4. Contractual income settlement
Clients on PLATINUM and GOLD tiers receive **contractual income settlement**: Harborline credits the client's account on the expected payment date whether or not funds have been received from the market, and recovers the funds subsequently. SILVER clients receive **actual settlement**: credit on receipt.

Contractual settlement is provided for:
- CASH_DIVIDEND and COUPON events in markets rated LOW or MEDIUM reclaim complexity
- Not provided for HIGH-complexity markets, where receipt timing is less predictable, nor for DIVIDEND_OPTION stock elections

Where contractually advanced funds are not received within 15 business days, the credit is reversed and the client notified.

## 5. Crediting standard
Once received (or advanced under §4), income is credited within the SLA tier window (POL-001 §2): PLATINUM 1 business day, GOLD 2, SILVER 3. Funds are credited net of withholding tax (`net_amount_usd`); reclaim handling is under POL-005.

## 6. Late payment handling
| Days late | Action |
|---|---|
| 1 | Automated query to subcustodian |
| 3 | Asset Servicing analyst chases paying agent via subcustodian |
| 5 | Escalated to Head of Asset Servicing; client notified (SILVER clients, who have not been contractually credited) |
| 10 | Formal claim lodged against paying agent |

## 7. Incorrect payments
Where the amount received differs from the entitlement (quantity × `gross_rate_per_share`), a reconciliation break is raised (POL-009) with `root_cause = CORPORATE_ACTION` and the discrepancy claimed from the paying agent.

## 8. Fees
Income collection is billed under `fee_type = INCOME_COLLECTION` per payment event.
