---
doc_id: MG-IT
doc_type: market_guide
title: Market Guide — Italy (Monte Titoli)
tenant: harborline
authority_rank: 4
effective_from: 2025-01-01
effective_to: 2026-03-31
version: 1.0
supersedes: null
entities: {market: IT}
access_level: INTERNAL
binds_to: [dim_market, stl_trade_instruction, cae_event, cae_income_payment]
---

# Market Guide — Italy (Monte Titoli) — Version 1.0
**In force 1 January 2025 to 31 March 2026. Superseded by version 2.0.**

## 1. Settlement
CSD: Monte Titoli. Cycle: T+2. CSDR penalty regime applies. Partial settlement available on opt-in.
**Client instruction cut-off: 17:00 CET on trade date.** Matching deadline: 16:00 CET on ISD−1.

## 2. Corporate actions practice
Italian issuers frequently publish voluntary event terms late relative to the response deadline, and the subcustodian's notification can lag the issuer announcement by a business day. Short-notice events (notice window of 2 business days or fewer) are common for DIVIDEND_OPTION and RIGHTS_ISSUE events. Treat every Italian voluntary event as potentially short-notice and apply POL-004 §5 on announcement.

## 3. Tax
Statutory dividend withholding 26%. Treaty relief at source is rarely achieved in practice; most relief is obtained by reclaim, which requires an original certificate of tax residence and issuer-level documentation, and has historically had long processing times. Reclaim complexity: HIGH. Statute of limitations: 48 months.
