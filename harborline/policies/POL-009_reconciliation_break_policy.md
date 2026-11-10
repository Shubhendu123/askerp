---
doc_id: POL-009
title: Reconciliation Break Ageing and Escalation Policy
tenant: harborline
domain: operations
effective_date: 2025-01-01
version: 1.8
owner: Head of Reconciliations
doc_type: policy
authority_rank: 3
access_level: INTERNAL
effective_from: 2025-01-01
effective_to: null
supersedes: null
entities: {}
binds_to: [rec_break, dim_subcustodian, stl_trade_instruction]
governs: "individual reconciliation breaks"
---

# Reconciliation Break Ageing and Escalation Policy

## 1. Purpose
Harborline reconciles its books and records against subcustodian statements daily. A break is any difference in cash balance, security position or transaction between Harborline's records and the subcustodian's. Breaks are recorded in `rec_break`, classified, aged and escalated according to this policy.

## 2. Break types
- **CASH** — difference in a client's cash balance in a currency
- **POSITION** — difference in a client's holding of a security
- **TRANSACTION** — a transaction present on one side and not the other

## 3. Root cause classification
Every break is assigned a `root_cause`:

| Root cause | Description |
|---|---|
| FAILED_SETTLEMENT | A fail has left a position or cash out of line (most common) |
| CORPORATE_ACTION | Entitlement or payment processed differently on each side |
| FX | Currency conversion timing or rate difference |
| TIMING | Both sides correct, but booked on different dates — self-clearing |
| UNKNOWN | Not yet determined; must be resolved to a cause within 5 business days |

## 4. Ageing thresholds and escalation
`age_days` = business days from `detected_date_key` to resolution (or today, if open):

| Age | Classification | Action |
|---|---|---|
| 0–2 | Current | Reconciliations analyst resolves |
| 3–9 | Ageing | Team lead review; root cause must be assigned |
| 10–29 | Aged | Head of Reconciliations; subcustodian engaged formally; reported weekly |
| 30+ | Critical | Operational Risk Committee; write-off assessment begins |

## 5. Materiality
Breaks are prioritised by `break_amount_usd`. Any single break above USD 1,000,000, or any client's open breaks totalling more than USD 5,000,000, is escalated to the Head of Reconciliations on detection regardless of age.

## 6. Write-off authority
Breaks that cannot be resolved may be written off (`break_status = WRITTEN_OFF`) within the following limits:
- Up to USD 10,000 — Head of Reconciliations
- USD 10,000 to USD 100,000 — Chief Operating Officer
- Above USD 100,000 — Chief Operating Officer and Chief Financial Officer jointly

Write-offs are reported monthly to the Operational Risk Committee by root cause and subcustodian.

## 7. Subcustodian performance
Breaks are tracked per subcustodian. A subcustodian whose break count per 1,000 transactions exceeds twice the network average over a quarter is subject to service review under POL-012.
