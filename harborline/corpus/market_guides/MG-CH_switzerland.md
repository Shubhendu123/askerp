---
doc_id: MG-CH
doc_type: market_guide
title: Market Guide — Switzerland (SIX SIS)
tenant: harborline
authority_rank: 4
effective_from: 2025-01-01
effective_to: null
version: 1.4
supersedes: MG-CH v1.3
entities: {market: CH}
access_level: INTERNAL
binds_to: [dim_market, cae_event, cae_income_payment]
---

# Market Guide — Switzerland (SIX SIS)

## 1. Settlement
CSD: SIX SIS. Cycle: T+2, moving to T+1 on 11 October 2027. No cash penalty regime. Partial settlement available.

## 2. Tax — the largest reclaim market by value
Swiss dividend withholding tax is **35%**, the highest statutory rate in Harborline's network. Treaty relief is obtained almost entirely by reclaim from the Swiss Federal Tax Administration, not at source. Reclaims require a completed reclaim form, a certificate of residence and dividend vouchers. Reclaim complexity: HIGH. Statute of limitations: 36 months from the end of the calendar year of payment.

Because the statutory rate is high and relief is reclaim-only, unfiled Swiss reclaims are typically the largest single source of client value leakage by dollar amount, even where the unfiled rate is similar to other HIGH-complexity markets.

## 3. Corporate actions
DIVIDEND_OPTION events (scrip dividends) are offered by several large Swiss issuers. Default is usually cash.
