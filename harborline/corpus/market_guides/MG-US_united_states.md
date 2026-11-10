---
doc_id: MG-US
doc_type: market_guide
title: Market Guide — United States (DTC)
tenant: harborline
authority_rank: 4
effective_from: 2025-01-01
effective_to: null
version: 3.0
supersedes: MG-US v2.0
entities: {market: US}
access_level: INTERNAL
binds_to: [dim_market, stl_trade_instruction, cae_income_payment]
---

# Market Guide — United States (DTC)

## 1. Settlement
CSD: DTC. Cycle: T+1 since 28 May 2024. No cash penalty regime. **Partial settlement is not currently available**: a delivery remains pending until the full quantity is available; DTCC automated partial settlement is targeted for 2027.
Client instruction cut-off: 16:00 ET on trade date.

## 2. Fails
The US is Harborline's largest market by instruction volume, so it carries the highest *count* of fails even though its fail *rate* is not the highest. Always compare markets on rate, not count.

## 3. Tax
Statutory withholding on dividends to non-residents 30%; treaty rate 15% for US/UK-domiciled treaty clients, 0% for qualifying pension funds. Relief at source is standard where documentation (Forms W-8) is on file; reclaims are needed only where documentation was missing at the record date. Reclaim complexity LOW, but the volume of US income means unfiled US reclaims can still be large in dollar terms.
