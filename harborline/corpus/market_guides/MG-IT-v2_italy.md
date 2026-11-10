---
doc_id: MG-IT
doc_type: market_guide
title: Market Guide — Italy (Monte Titoli)
tenant: harborline
authority_rank: 4
effective_from: 2026-04-01
effective_to: null
version: 2.0
supersedes: MG-IT v1.0
entities: {market: IT}
access_level: INTERNAL
binds_to: [dim_market, stl_trade_instruction, cae_event, cae_income_payment]
---

# Market Guide — Italy (Monte Titoli) — Version 2.0
**In force from 1 April 2026. Supersedes version 1.0.**

## 1. Settlement
CSD: Monte Titoli. Cycle: T+2 (moving to T+1 on 11 October 2027, see REG-002). CSDR penalty regime applies. Partial settlement available on opt-in.
**Client instruction cut-off: 16:00 CET on trade date** (moved one hour earlier from 1 April 2026 to allow pre-matching ahead of T+1). Matching deadline: 16:00 CET on ISD−1.

## 2. What changed from version 1.0
- Client cut-off moved from 17:00 to 16:00 CET.
- Pre-matching on trade date is now mandatory for all Italian instructions.
- Rights issues: Harborline now sells untaken rights by default only on client instruction; previously rights were allowed to lapse.

## 3. Corporate actions practice
Unchanged from version 1.0: treat Italian voluntary events as potentially short-notice.

## 4. Tax
Unchanged: 26% statutory withholding, reclaim complexity HIGH, statute 48 months. Certificates of residence must be dated within the calendar year of the income payment.
