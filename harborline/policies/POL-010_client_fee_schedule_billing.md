---
doc_id: POL-010
title: Client Fee Schedule and Billing Policy
tenant: harborline
domain: billing
effective_date: 2025-01-01
version: 6.0
owner: Head of Product and Pricing
binds_to: [clt_fee_invoice, dim_client.client_segment, dim_client.sla_tier, pos_daily_position]
---

# Client Fee Schedule and Billing Policy

## 1. Purpose
Harborline's revenue comprises asset-based custody fees, transaction fees, and fees for asset-servicing activity. This policy defines the fee types, standard rates, billing cycle, and the authority to waive or cap fees. All fees are invoiced monthly in USD and recorded in `clt_fee_invoice`, one row per client per month per fee type.

## 2. Fee types and standard rates

| `fee_type` | Basis | Standard rate |
|---|---|---|
| CUSTODY_BPS | Month-end assets under custody (`pos_daily_position.market_value_usd` at month end) | Tiered, see §3 |
| TRANSACTION | Per settled instruction | USD 8.00 (developed markets) / USD 25.00 (other) |
| CORPORATE_ACTION | Per voluntary election processed | USD 45.00 |
| INCOME_COLLECTION | Per income payment credited | USD 6.00 |
| TAX_RECLAIM | Per reclaim recovered | 10% of amount recovered, capped USD 5,000 (POL-005 §7) |
| OVERDRAFT | Daily on overdrawn balance | Benchmark + 150 bps annualised (POL-011) |

## 3. Custody fee tiers (annualised, charged monthly)
| Assets under custody | Rate |
|---|---|
| First USD 5 billion | 1.50 bps |
| USD 5–25 billion | 1.00 bps |
| USD 25–60 billion | 0.70 bps |
| Above USD 60 billion | 0.45 bps |

Monthly custody fee = Σ (tier balance × tier rate) ÷ 12.

## 4. Segment pricing
Standard rates apply to ASSET_MANAGER clients. PENSION_FUND and SOVEREIGN_WEALTH clients receive a 10% discount on CUSTODY_BPS reflecting lower activity and longer tenure. HEDGE_FUND clients pay standard custody rates and a 25% premium on TRANSACTION fees reflecting higher turnover and fail incidence. INSURANCE clients pay standard rates.

## 5. Billable vs invoiced
`billable_amount_usd` is the fee computed at standard rates. `invoiced_amount_usd` is the amount actually charged after any waiver or cap. The difference is revenue foregone, and is reported monthly by `waiver_reason`:

| `waiver_reason` | Description | Authority |
|---|---|---|
| SLA_CREDIT | Credit for an SLA breach (POL-001 §3) | Automatic |
| RELATIONSHIP_DISCOUNT | Negotiated discount | Head of Product and Pricing |
| FEE_CAP | Contractual monthly cap reached | Automatic |

Relationship discounts above 20% of billable, or lasting more than 12 months, require Chief Financial Officer approval.

## 6. Cost-to-serve
Client profitability is assessed quarterly as invoiced revenue less (penalties borne by Harborline for that client's instructions, overdraft funding cost not recovered, SLA credits, and analyst hours on service requests at the standard cost rate of USD 85 per hour). Clients with negative quarterly profitability for two consecutive quarters are reviewed by the Head of Product and Pricing.

## 7. Billing cycle
Invoices are issued within 5 business days of month end. Payment terms 30 days.
