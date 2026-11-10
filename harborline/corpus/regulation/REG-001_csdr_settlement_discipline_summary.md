---
doc_id: REG-001
doc_type: regulation
title: CSDR Settlement Discipline Regime — Harborline Summary
tenant: harborline
authority_rank: 1
effective_from: 2022-02-01
effective_to: null
version: 2.0
supersedes: REG-001 v1.0
entities: {markets: [DE, FR, IT, NL]}
access_level: INTERNAL
binds_to: [stl_fail_penalty, stl_trade_instruction, dim_market.penalty_regime]
---

# CSDR Settlement Discipline Regime — Harborline Summary

> This is Harborline's internal summary of the regulation for operational use. It is not the legal text. Where this summary and the regulation differ, the regulation governs.

## 1. What the regime is
The EU Central Securities Depositories Regulation (CSDR) settlement discipline regime has applied since 1 February 2022 to transactions settling in EU central securities depositories. For Harborline this covers Clearstream (DE), Euroclear France (FR), Monte Titoli (IT) and Euroclear Nederland (NL).

## 2. Who levies penalties
Cash penalties are calculated and levied by the CSD on the **failing participant**, and redistributed to the receiving participant. Harborline is the CSD participant for its clients' accounts, so the CSD charges Harborline. Whether Harborline then passes the penalty to a client is a contractual matter between Harborline and the client — the regulation does not decide it. Internal attribution rules are in POL-002 §5; client agreements may override them.

## 3. Penalty basis
Penalties accrue for each business day an instruction fails to settle after its intended settlement date, at a daily rate that depends on the asset class, applied to the value of the failed instruction. Late-matching penalties apply where instructions are matched after the intended settlement date.

## 4. Mandatory buy-ins
Under the CSDR Refit, the mandatory buy-in rules have not been applied, and may only be activated by the European Commission as a last resort if settlement efficiency does not improve. Harborline's buy-in steps in POL-006 §3 are therefore contractual and market-practice measures, not a regulatory obligation.

## 5. Precedence
Where an internal policy conflicts with this regime, this regime governs. Client agreements cannot contract out of penalties levied by a CSD; they can only allocate who ultimately bears them.
