---
doc_id: POL-003
title: Market Settlement Conventions and Instruction Cut-offs
tenant: harborline
domain: settlement
effective_date: 2025-01-01
version: 4.0
owner: Head of Settlements
doc_type: policy
authority_rank: 3
access_level: INTERNAL
effective_from: 2025-01-01
effective_to: null
supersedes: null
entities: {}
binds_to: [dim_market, dim_subcustodian, stl_trade_instruction.is_matched_on_time, stl_trade_instruction.intended_settle_date_key]
governs: "individual markets (settlement cycle, cut-offs)"
---

# Market Settlement Conventions and Instruction Cut-offs

## 1. Purpose
Each market Harborline settles in has its own settlement cycle, instruction cut-off, matching deadline and partial-settlement rules. Client instructions received after the cut-off are processed on a best-efforts basis and are excluded from SLA measurement (POL-001 §3).

## 2. Market table

| Market | CSD | Cycle | Client instruction cut-off (local time, on T) | Matching deadline | Partial settlement |
|---|---|---|---|---|---|
| US | DTC | T+1 | 16:00 ET | ISD 12:00 ET | Not until DTCC automated partials (targeted 2027) |
| CA | CDS | T+1 | 16:00 ET | ISD 12:00 ET | No |
| GB | CREST | T+2 | 17:00 GMT | ISD−1 14:00 | Yes |
| DE | Clearstream | T+2 | 17:00 CET | ISD−1 16:00 | Yes |
| FR | Euroclear France | T+2 | 17:00 CET | ISD−1 16:00 | Yes |
| IT | Monte Titoli | T+2 | 17:00 CET | ISD−1 16:00 | Yes |
| NL | Euroclear Nederland | T+2 | 17:00 CET | ISD−1 16:00 | Yes |
| CH | SIX SIS | T+2 | 17:00 CET | ISD−1 16:00 | Yes |
| JP | JASDEC | T+2 | 15:00 JST | ISD−1 15:00 | No |
| HK | CCASS | T+2 | 15:30 HKT | ISD 10:00 | No |
| AU | CHESS | T+2 | 15:00 AEST | ISD−1 15:00 | No |
| SG | CDP | T+2 | 15:00 SGT | ISD−1 15:00 | No |

"ISD" means intended settlement date. Instructions matched after the matching deadline are flagged `is_matched_on_time = false` and, in CSDR markets, attract a Late Matching Fail Penalty (POL-002 §2).

## 3. Settlement cycle changes
The UK, EU and Switzerland move from T+2 to T+1 on the same date in October 2027. From that date the matching deadline in those markets moves to the trade date, which removes the overnight window currently used to resolve mismatches. Clients will be notified of revised cut-offs at least six months in advance.

## 4. Partial settlement
Where a market supports partial settlement and the client has opted in, a delivery short of the full quantity may settle in tranches. Partial settlement reduces penalty exposure under CSDR because penalties accrue only on the unsettled remainder. Clients in the US and Canada cannot currently benefit from partials: a delivery remains pending until the full quantity is available.

## 5. Subcustodian network
Harborline settles through a primary subcustodian in each market, with a contracted backup in the four largest markets (US, GB, DE, JP). The primary subcustodian for a market is identified by `dim_subcustodian.service_tier = PRIMARY`. Concentration limits for subcustodians are governed by POL-012.

## 6. Market holidays
Settlement, matching and penalty accrual occur on business days of the settlement market only (`dim_date.is_business_day`). Penalties do not accrue on market holidays.
