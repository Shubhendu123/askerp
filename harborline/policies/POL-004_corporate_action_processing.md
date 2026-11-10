---
doc_id: POL-004
title: Corporate Action Processing and Election Deadline Policy
tenant: harborline
domain: corporate_actions
effective_date: 2025-01-01
version: 3.0
owner: Head of Asset Servicing
binds_to: [cae_event, cae_client_election, dim_client.sla_tier, dim_market]
---

# Corporate Action Processing and Election Deadline Policy

## 1. Purpose
Corporate actions are the highest operational-risk activity in custody. Industry-wide, close to half of corporate event data still passes between intermediaries by manual means, and a missed election on a voluntary event can oblige the custodian to compensate the client for the difference between the option they would have chosen and the default applied. This policy defines how Harborline captures events, notifies clients, sets internal deadlines, handles defaults, and compensates for errors.

## 2. Event classification
Events are classified in `cae_event.event_type`:

| Type | Voluntary | Client action required |
|---|---|---|
| CASH_DIVIDEND | No | None — paid automatically |
| COUPON | No | None — paid automatically |
| STOCK_SPLIT | No | None — positions adjusted |
| MERGER | Mandatory by default; voluntary where the terms offer a cash/stock election | None where mandatory — positions adjusted (cash or stock per terms); elect cash or stock where the terms offer a choice |
| DIVIDEND_OPTION | Yes | Elect cash or stock |
| RIGHTS_ISSUE | Yes | Elect take-up, sell rights, or lapse |
| TENDER_OFFER | Yes | Elect tender or hold |

Voluntary events (`is_voluntary = true`) create one `cae_client_election` row per entitled client.

## 3. Notification windows
Harborline notifies entitled clients of a voluntary event within the window set by their SLA tier (POL-001 §2): PLATINUM within 1 business day of announcement, GOLD within 2, SILVER within 3.

## 4. Internal and client deadlines
The market or issuer deadline is recorded as `cae_event.response_deadline_date_key`. Harborline sets a **client response deadline one business day earlier** than the market deadline, to allow instruction processing. The notice window (`notice_window_days` = response deadline − announcement date) is the single strongest predictor of missed elections.

## 5. Short-notice events
Where `notice_window_days` is **2 business days or fewer**, the event is classified as short-notice and the following apply:
- Notification is issued the same business day as announcement, irrespective of SLA tier
- The relationship manager contacts PLATINUM and GOLD clients directly by telephone
- The event is logged on the daily short-notice register reviewed by the Head of Asset Servicing

Short-notice events are concentrated in markets where issuer announcement practice is late or inconsistent. Internal review has identified Italy, Hong Kong and Japan as the markets producing the highest share of short-notice events.

## 6. Default elections
Where no client instruction is received by the client response deadline, Harborline applies the issuer's default option. The election is recorded as `election_status = DEFAULTED`. A default is not an error where the client was notified within the SLA window.

## 7. Missed deadlines
An election is `MISSED_DEADLINE` (`missed_deadline = true`) where the client instructed Harborline before the client response deadline but the instruction was not transmitted to the market before the market deadline. This is a Harborline error.

## 8. Compensation
For a MISSED_DEADLINE election, Harborline compensates the client for the difference in value between the option the client elected and the option applied, recorded as `estimated_client_impact_usd`. Compensation above USD 25,000 requires approval of the Head of Asset Servicing; above USD 250,000 requires the Chief Operating Officer. All missed deadlines are reported to the Operational Risk Committee monthly regardless of value.

## 9. Monitoring thresholds
- Monthly missed-deadline rate (missed ÷ voluntary elections) above 1.5% triggers a process review.
- Any single client with two or more missed deadlines in a rolling quarter is escalated to the relationship manager.
- Any market producing more than 30% of its voluntary events as short-notice is referred for a subcustodian service review (POL-012).
