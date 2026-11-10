---
doc_id: INC-EVT-2630
doc_type: incident_report
title: Incident Report — Missed rights issue election, Pinnacle Asset Management (event 2630)
tenant: harborline
authority_rank: null
effective_from: "2025-07-09"
effective_to: null
version: 1.0
supersedes: null
entities: {client: "Pinnacle Asset Management", event_key: 2630, market: GB}
access_level: INTERNAL
binds_to: [cae_client_election, cae_event, dim_subcustodian]
---

# Incident Report — Missed rights issue election (event 2630)
**Client:** Pinnacle Asset Management · **Market:** GB · **Severity:** Critical · **Owner:** Head of Asset Servicing

## What happened
Pinnacle instructed Harborline to take up its rights in full, but the instruction was not transmitted to the market before the deadline. The rights lapsed and were placed by the underwriters (see EVT-2630).

## Root cause
1. **Short notice.** The event had a compressed subscription period (EVT-2630 narrative), and the subcustodian's notification lagged the issuer announcement.
2. **Wrong internal deadline.** Harborline's system applied the standard client deadline of one business day before the market deadline (POL-004 §4), instead of the two business days required by Pinnacle's agreement (CA-002 §4). Pinnacle's instruction arrived within its contractual window, but Harborline's internal queue treated it as on time and did not prioritise it.

## Compensation
The estimated client impact is recorded in `cae_client_election`. Pinnacle's agreement caps Harborline's liability at USD 2,000,000 per event (CA-002 §2) unless the miss resulted from gross negligence. Whether the deadline-configuration error constitutes gross negligence is under review by Legal.

## Remediation
Client-specific deadline overrides from client agreements are now loaded into the corporate actions system and checked daily.
