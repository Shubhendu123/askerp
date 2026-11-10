---
doc_id: REG-002
doc_type: regulation
title: T+1 Settlement Migration — UK, EU and Switzerland
tenant: harborline
authority_rank: 1
effective_from: 2025-06-01
effective_to: null
version: 1.1
supersedes: REG-002 v1.0
entities: {markets: [GB, DE, FR, IT, NL, CH]}
access_level: PUBLIC
binds_to: [dim_market.settlement_cycle, stl_trade_instruction]
---

# T+1 Settlement Migration — UK, EU and Switzerland

## 1. Change
The United Kingdom, the European Union and Switzerland move from a T+2 to a T+1 standard settlement cycle on the industry-agreed date of **11 October 2027**. The United States and Canada moved to T+1 on 28 May 2024.

## 2. Markets affected in Harborline's network
GB (CREST), DE (Clearstream), FR (Euroclear France), IT (Monte Titoli), NL (Euroclear Nederland) and CH (SIX SIS). JP, HK, AU and SG are unaffected by this change.

## 3. Operational impact
- Matching must complete on trade date. The overnight window currently used to repair mismatched instructions disappears.
- Client instruction cut-offs move earlier (see the affected market guides, which will be re-issued as new versions at least six months before migration).
- FX for cross-currency purchases must be executed on trade date.
- Fail volumes and CSDR penalty exposure are expected to rise during the transition, concentrated in counterparties already on the watch list (POL-007 tiers C and D).

## 4. Harborline readiness commitments
- Pre-matching mandatory for all instructions in affected markets from 1 April 2027 (POL-006 §6).
- Tier-D counterparties to be notified individually of the migration timeline.
- PLATINUM and GOLD clients to receive revised cut-off schedules by 11 April 2027.
