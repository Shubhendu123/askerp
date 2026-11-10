---
doc_id: POL-002
title: Settlement Discipline and Cash Penalty Framework (CSDR and CREST)
tenant: harborline
domain: settlement
effective_date: 2025-01-01
version: 2.1
owner: Head of Settlements
binds_to: [dim_market.penalty_regime, stl_fail_penalty, stl_trade_instruction, dim_security.security_type]
---

# Settlement Discipline and Cash Penalty Framework

## 1. Scope
This policy sets out how cash penalties for settlement fails are calculated, attributed and passed on. Penalties arise under two regimes, identified by `dim_market.penalty_regime`:

- **CSDR** — the EU Central Securities Depositories Regulation settlement discipline regime. Applies in Germany (Clearstream), France (Euroclear France), Italy (Monte Titoli) and the Netherlands (Euroclear Nederland).
- **CREST** — the UK settlement discipline arrangements operated through CREST.
- **NONE** — United States, Canada, Switzerland, Japan, Hong Kong, Australia and Singapore have no cash penalty regime. Fails in these markets incur no penalty but remain subject to fail management under POL-006.

No penalty row may exist for an instruction in a market whose regime is NONE.

## 2. Penalty types
- **SEFP — Settlement Fail Penalty.** Charged for each business day an instruction remains unsettled after its intended settlement date.
- **LMFP — Late Matching Fail Penalty.** Charged where the instruction is matched after the intended settlement date (`is_matched_on_time = false`), for each business day between the intended settlement date and the matching date.

## 3. Daily penalty rates (CSDR)
Penalties accrue daily on the settlement value of the failed instruction. The rates below are the approximate published CSDR rates and are the rates applied in this framework:

| Instrument (`security_type`) | Daily rate |
|---|---|
| EQUITY (liquid) | 1.00 bps |
| ETF | 0.50 bps |
| CORP_BOND | 0.20 bps |
| GOVT_BOND | 0.10 bps |
| MMI | 0.10 bps |

Daily penalty = settlement value (USD) × rate ÷ 10,000.

## 4. CREST rates
CREST-regime fails are charged at a flat 0.50 bps per business day on settlement value, irrespective of instrument type.

## 5. Attribution — who bears the penalty
`stl_fail_penalty.bearer` is set according to the fail reason:

| Fail reason | Bearer |
|---|---|
| LACK_OF_SECURITIES on a DELIVER, or LACK_OF_CASH on a RECEIVE | CLIENT |
| COUNTERPARTY_INSTRUCTION_MISSING, or counterparty-side lack of securities/cash | COUNTERPARTY |
| MISMATCHED_INSTRUCTION or LATE_MATCHING caused by Harborline | HARBORLINE |
| MARKET_RESTRICTION | HARBORLINE (absorbed; not passed to client) |

Penalties borne by COUNTERPARTY are claimed through the CSD's monthly net settlement. Penalties borne by HARBORLINE are an operational loss and are reported monthly to the Operational Risk Committee.

## 6. Pass-through to clients
Penalties with `bearer = CLIENT` are billed in the following month's invoice under `fee_type = TRANSACTION` with the penalty reference. Clients on PLATINUM tier are notified within one business day of any single penalty exceeding USD 5,000.

## 7. Reporting thresholds
- Any counterparty generating more than USD 25,000 of penalties in a calendar month is referred for tier review under POL-007.
- Any client bearing more than USD 50,000 of penalties in a calendar month is escalated to the relationship manager for a root-cause review.
- Harborline-borne penalties exceeding USD 100,000 in a month trigger a mandatory operational review.

## 8. Forthcoming changes
The UK, EU and Switzerland migrate to T+1 settlement in October 2027. The compression of the fail-resolution window from one business day to a matter of hours is expected to increase both fail frequency and penalty exposure. Chase procedures in POL-006 will be revised ahead of migration.
