---
doc_id: POL-005
title: Withholding Tax Reclaim Eligibility Matrix
tenant: harborline
domain: tax
effective_date: 2025-01-01
version: 5.1
owner: Head of Tax Services
binds_to: [cae_income_payment, dim_market.tax_reclaim_complexity, dim_client.domicile_country, dim_client.client_segment]
governs: "individual income payments / reclaim claims, by client and market"
---

# Withholding Tax Reclaim Eligibility Matrix

## 1. Purpose
Income paid on foreign securities is subject to withholding tax at the issuer market's statutory rate. Where a double-taxation treaty exists between the issuer market and the client's domicile, the client is entitled to a lower treaty rate, and the difference can be reclaimed. Unfiled reclaims are the single largest source of client value leakage in custody. This matrix defines eligibility, rates, deadlines and filing responsibility.

## 2. How eligibility is determined
For each income payment (`cae_income_payment`):
- `statutory_rate_pct` is the rate actually withheld at source
- `treaty_rate_pct` is the rate the client is entitled to under the applicable treaty, given `dim_client.domicile_country`
- `reclaim_eligible = true` where statutory rate exceeds treaty rate and the client type is treaty-eligible
- `reclaim_amount_usd` = gross income × (statutory rate − treaty rate)

## 3. Statutory and treaty rates by market

| Market | Statutory rate | Treaty rate (US / GB domicile) | Treaty rate (pension funds) | Reclaim complexity | Statute of limitations |
|---|---|---|---|---|---|
| US | 30% | 15% | 0% | LOW | 36 months |
| CA | 25% | 15% | 0% | LOW | 36 months |
| GB | 0% (no WHT on dividends) | — | — | MEDIUM | — |
| DE | 26.375% | 15% | 0% (qualifying) | MEDIUM | 36 months |
| FR | 25% | 15% | 0% (qualifying) | HIGH | 48 months |
| IT | 26% | 15% | 11% | HIGH | 48 months |
| NL | 15% | 15% | 0% | MEDIUM | 36 months |
| CH | 35% | 15% | 0% | HIGH | 36 months |
| JP | 15.315% | 10% | 0% (qualifying) | MEDIUM | 36 months |
| HK | 0% | — | — | LOW | — |
| AU | 30% | 15% | 15% | MEDIUM | 36 months |
| SG | 0% | — | — | LOW | — |

Pension fund and sovereign wealth clients (`client_segment` PENSION_FUND, SOVEREIGN_WEALTH) qualify for the exempt or reduced pension rate in most treaty markets, subject to certification. Hedge funds (`client_segment = HEDGE_FUND`) generally do not qualify for treaty relief and are not reclaim-eligible except where the fund has obtained a specific ruling.

## 4. Reclaim complexity
`dim_market.tax_reclaim_complexity` reflects the documentation burden and the reliability of the reclaim process:
- **LOW** — relief at source is standard; few reclaims are needed
- **MEDIUM** — reclaim is routine with standard documentation
- **HIGH** — reclaim requires market-specific forms, apostilled certificates of residence, issuer-level documentation, or has a history of extended processing times. France, Italy and Switzerland are HIGH.

Historically, the unfiled share of eligible reclaims is concentrated in HIGH-complexity markets.

## 5. Filing deadlines
`reclaim_deadline_date_key` = payment date + the statute of limitations for the market. A reclaim not filed before this date is forfeited. Reclaims with fewer than six months remaining to the statute deadline are classified as **at-risk** and reported weekly.

## 6. Filing responsibility
Harborline files reclaims on behalf of clients where the client has executed the tax service mandate. Filing is recorded as `reclaim_filed = true`. Where the client has not executed a mandate, Harborline notifies the client of eligible amounts quarterly but does not file.

## 7. Fees
Reclaim services are billed under `fee_type = TAX_RECLAIM` at 10% of the amount recovered, capped at USD 5,000 per reclaim.

## 8. Reporting
Unfiled eligible reclaims are reported monthly by market, client segment and months-to-deadline. Any client with unfiled eligible reclaims exceeding USD 500,000 is escalated to the relationship manager.
