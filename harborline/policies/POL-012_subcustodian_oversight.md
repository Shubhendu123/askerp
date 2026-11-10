---
doc_id: POL-012
title: Subcustodian Network Oversight and Concentration Policy
tenant: harborline
domain: risk
effective_date: 2025-01-01
version: 1.5
owner: Head of Network Management
doc_type: policy
authority_rank: 3
access_level: INTERNAL
effective_from: 2025-01-01
effective_to: null
supersedes: null
entities: {}
binds_to: [dim_subcustodian, dim_market, pos_daily_position, rec_break, stl_trade_instruction]
governs: "individual subcustodians / markets"
---

# Subcustodian Network Oversight and Concentration Policy

## 1. Purpose
Harborline holds client assets through a network of subcustodians, one or more per market (`dim_subcustodian`). Subcustodian failure, poor service or excessive concentration is a direct risk to client assets and to Harborline's own regulatory standing. This policy defines selection, monitoring, concentration limits and service review.

## 2. Network structure
Each market has one PRIMARY subcustodian (`service_tier = PRIMARY`). The four largest markets by assets under custody — US, GB, DE, JP — also have a contracted BACKUP to which assets can be migrated within 30 business days. Backup arrangements are tested annually.

## 3. Concentration limits
- No single subcustodian may hold more than 35% of total assets under custody across all markets (measured on `pos_daily_position.market_value_usd` at month end).
- No single subcustodian may hold more than 90% of assets in any market where a backup is contracted.
- Breaches are reported to the Chief Risk Officer and a remediation plan agreed within 60 days.

## 4. Performance monitoring
Each subcustodian is scored quarterly on:

| Measure | Source | Threshold for review |
|---|---|---|
| Settlement fail rate attributable to subcustodian | `stl_trade_instruction` where fail reason is MISMATCHED_INSTRUCTION or LATE_MATCHING on Harborline's side | above 1.5% |
| Reconciliation breaks per 1,000 transactions | `rec_break` by `subcustodian_key` | above 2× network average (POL-009 §7) |
| Income payment timeliness | `cae_income_payment.days_late` | more than 8% of payments late |
| Corporate action notification lag | `cae_event` announcement vs subcustodian notification | short-notice share above 30% (POL-004 §9) |
| Statement delivery | Daily statement received by 07:00 local | fewer than 98% on time |

## 5. Service review
A subcustodian breaching any threshold in §4 for two consecutive quarters enters formal service review: a remediation plan with monthly milestones, a named senior contact, and a decision point at six months to retain, migrate to backup, or re-tender.

## 6. Due diligence
Every subcustodian undergoes annual due diligence covering financial strength, regulatory standing, segregation of client assets, insurance, cyber controls and business continuity. Results are reported to the Board Risk Committee.

## 7. Market exit
Where a subcustodian gives notice, or Harborline elects to exit a market, assets are migrated to the backup or a newly appointed subcustodian with a minimum of 90 days' client notice.
