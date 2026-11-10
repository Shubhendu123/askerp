-- ============================================================
-- AskERP — Tenant 3: Harborline Global Custody (securities services)
-- Schema-per-tenant isolation (D-029). Subject-area prefixes (D-030).
-- Reporting currency USD; local currency retained as an attribute.
-- Grain is the contract — documented per table.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS harborline;

-- ============================================================
-- CONFORMED DIMENSIONS (7)
-- ============================================================

CREATE TABLE harborline.dim_date (
  date_key          INTEGER PRIMARY KEY,      -- YYYYMMDD
  full_date         DATE NOT NULL,
  day_of_week       VARCHAR,
  is_business_day   BOOLEAN,
  day_of_month      INTEGER,
  week_of_year      INTEGER,
  month_num         INTEGER,
  month_name        VARCHAR,
  quarter_num       INTEGER,
  fiscal_period     VARCHAR,                  -- 'FY26-Q2'
  year_num          INTEGER,
  is_month_end      BOOLEAN
);

CREATE TABLE harborline.dim_market (
  market_key        INTEGER PRIMARY KEY,
  market_code       VARCHAR NOT NULL,         -- US, GB, DE, FR, IT, NL, CH, JP, HK, AU, CA, SG
  market_name       VARCHAR,
  csd_name          VARCHAR,                  -- DTC, CREST, Clearstream, Euroclear France...
  region            VARCHAR,                  -- Americas / EMEA / APAC
  settlement_cycle  VARCHAR,                  -- T+1 / T+2
  penalty_regime    VARCHAR,                  -- CSDR / CREST / NONE
  partial_settlement_allowed BOOLEAN,
  local_currency    VARCHAR,
  tax_reclaim_complexity VARCHAR              -- LOW / MEDIUM / HIGH  <-- reclaim-leak signal
);

CREATE TABLE harborline.dim_security (
  security_key      INTEGER PRIMARY KEY,
  isin              VARCHAR NOT NULL,
  security_name     VARCHAR,
  security_type     VARCHAR,                  -- EQUITY / GOVT_BOND / CORP_BOND / ETF / MMI
  issuer_name       VARCHAR,
  issuer_country    VARCHAR,
  market_key        INTEGER REFERENCES harborline.dim_market(market_key),
  local_currency    VARCHAR,
  income_frequency  VARCHAR,                  -- NONE / ANNUAL / SEMI_ANNUAL / QUARTERLY
  liquidity_tier    VARCHAR                   -- HIGH / MEDIUM / LOW  <-- fail-rate driver
);

CREATE TABLE harborline.dim_client (
  client_key        INTEGER PRIMARY KEY,
  client_name       VARCHAR,
  client_segment    VARCHAR,                  -- ASSET_MANAGER / PENSION_FUND / INSURANCE / SOVEREIGN_WEALTH / HEDGE_FUND
  domicile_country  VARCHAR,
  sla_tier          VARCHAR,                  -- PLATINUM / GOLD / SILVER  <-- joins to SLA policy doc
  onboarded_date_key INTEGER REFERENCES harborline.dim_date(date_key),
  relationship_manager VARCHAR,
  base_currency     VARCHAR
);

CREATE TABLE harborline.dim_counterparty (
  counterparty_key  INTEGER PRIMARY KEY,
  counterparty_name VARCHAR,
  counterparty_type VARCHAR,                  -- BROKER_DEALER / BANK / CUSTODIAN / CLEARING_MEMBER
  region            VARCHAR,
  reliability_tier  VARCHAR,                  -- A (reliable) .. D (chronic fails)  <-- PLANTED SIGNAL
  is_affiliated     BOOLEAN
);

CREATE TABLE harborline.dim_subcustodian (
  subcustodian_key  INTEGER PRIMARY KEY,
  subcustodian_name VARCHAR,
  market_key        INTEGER REFERENCES harborline.dim_market(market_key),
  service_tier      VARCHAR,                  -- PRIMARY / BACKUP
  contract_start_date_key INTEGER REFERENCES harborline.dim_date(date_key)
);

CREATE TABLE harborline.dim_currency (
  currency_key      INTEGER PRIMARY KEY,
  currency_code     VARCHAR NOT NULL,         -- USD, EUR, GBP, JPY, HKD, AUD, CAD, CHF, SGD
  currency_name     VARCHAR,
  usd_rate          DECIMAL(12,6)             -- units per USD, period-average (simplified)
);

-- ============================================================
-- STL — Settlement  (fail / penalty source)
-- ============================================================

-- grain: 1 row per settlement instruction (one side of one trade)
CREATE TABLE harborline.stl_trade_instruction (
  instruction_key       BIGINT PRIMARY KEY,
  instruction_ref       VARCHAR,
  trade_date_key        INTEGER REFERENCES harborline.dim_date(date_key),
  intended_settle_date_key INTEGER REFERENCES harborline.dim_date(date_key),
  actual_settle_date_key   INTEGER REFERENCES harborline.dim_date(date_key),  -- NULL while unsettled
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  security_key          INTEGER REFERENCES harborline.dim_security(security_key),
  counterparty_key      INTEGER REFERENCES harborline.dim_counterparty(counterparty_key),
  market_key            INTEGER REFERENCES harborline.dim_market(market_key),
  subcustodian_key      INTEGER REFERENCES harborline.dim_subcustodian(subcustodian_key),
  currency_key          INTEGER REFERENCES harborline.dim_currency(currency_key),
  direction             VARCHAR,              -- RECEIVE / DELIVER
  quantity              BIGINT,
  settlement_amount_local DECIMAL(18,2),
  settlement_amount_usd   DECIMAL(18,2),
  settlement_status     VARCHAR,              -- SETTLED / FAILED / PENDING / CANCELLED
  fail_reason_code      VARCHAR,              -- NULL when settled: LACK_OF_SECURITIES / LACK_OF_CASH
                                              -- / MISMATCHED_INSTRUCTION / COUNTERPARTY_INSTRUCTION_MISSING
                                              -- / MARKET_RESTRICTION / LATE_MATCHING
  days_failed           INTEGER,              -- 0 when settled on ISD   <-- PLANTED SIGNAL
  is_matched_on_time    BOOLEAN
);

-- grain: 1 row per instruction per penalty day (CSDR penalties accrue daily)
CREATE TABLE harborline.stl_fail_penalty (
  penalty_key           BIGINT PRIMARY KEY,
  instruction_key       BIGINT REFERENCES harborline.stl_trade_instruction(instruction_key),
  penalty_date_key      INTEGER REFERENCES harborline.dim_date(date_key),
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  counterparty_key      INTEGER REFERENCES harborline.dim_counterparty(counterparty_key),
  market_key            INTEGER REFERENCES harborline.dim_market(market_key),
  penalty_type          VARCHAR,              -- SEFP (settlement fail) / LMFP (late matching)
  penalty_regime        VARCHAR,              -- CSDR / CREST
  penalty_rate_bps      DECIMAL(8,4),         -- daily rate applied
  penalty_amount_usd    DECIMAL(14,2),
  bearer                VARCHAR               -- CLIENT / HARBORLINE / COUNTERPARTY
);

-- ============================================================
-- POS — Positions & Cash
-- ============================================================

-- grain: 1 row per client / security / market / day
CREATE TABLE harborline.pos_daily_position (
  position_key          BIGINT PRIMARY KEY,
  position_date_key     INTEGER REFERENCES harborline.dim_date(date_key),
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  security_key          INTEGER REFERENCES harborline.dim_security(security_key),
  market_key            INTEGER REFERENCES harborline.dim_market(market_key),
  subcustodian_key      INTEGER REFERENCES harborline.dim_subcustodian(subcustodian_key),
  currency_key          INTEGER REFERENCES harborline.dim_currency(currency_key),
  quantity_settled      BIGINT,
  quantity_pending      BIGINT,               -- stuck in failed settlement
  market_value_local    DECIMAL(18,2),
  market_value_usd      DECIMAL(18,2)         -- AUC source
);

-- grain: 1 row per client / currency / day
CREATE TABLE harborline.pos_cash_balance (
  cash_balance_key      BIGINT PRIMARY KEY,
  balance_date_key      INTEGER REFERENCES harborline.dim_date(date_key),
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  currency_key          INTEGER REFERENCES harborline.dim_currency(currency_key),
  opening_balance_usd   DECIMAL(18,2),
  closing_balance_usd   DECIMAL(18,2),
  is_overdrawn          BOOLEAN,              -- caused by failed receives  <-- signal target
  overdraft_amount_usd  DECIMAL(18,2),
  funding_cost_usd      DECIMAL(14,2)         -- overnight charge on the overdraft
);

-- ============================================================
-- CAE — Corporate Actions & Entitlements
-- ============================================================

-- grain: 1 row per corporate action event per security
CREATE TABLE harborline.cae_event (
  event_key             BIGINT PRIMARY KEY,
  event_ref             VARCHAR,
  security_key          INTEGER REFERENCES harborline.dim_security(security_key),
  market_key            INTEGER REFERENCES harborline.dim_market(market_key),
  event_type            VARCHAR,              -- CASH_DIVIDEND / COUPON / STOCK_SPLIT / RIGHTS_ISSUE
                                              -- / TENDER_OFFER / MERGER / DIVIDEND_OPTION
  is_voluntary          BOOLEAN,              -- voluntary events require a client election
  announcement_date_key INTEGER REFERENCES harborline.dim_date(date_key),
  record_date_key       INTEGER REFERENCES harborline.dim_date(date_key),
  response_deadline_date_key INTEGER REFERENCES harborline.dim_date(date_key),
  payment_date_key      INTEGER REFERENCES harborline.dim_date(date_key),
  notice_window_days    INTEGER,              -- deadline - announcement  <-- PLANTED SIGNAL
  gross_rate_per_share  DECIMAL(14,6)
);

-- grain: 1 row per client per voluntary event they are entitled to
CREATE TABLE harborline.cae_client_election (
  election_key          BIGINT PRIMARY KEY,
  event_key             BIGINT REFERENCES harborline.cae_event(event_key),
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  security_key          INTEGER REFERENCES harborline.dim_security(security_key),
  entitled_quantity     BIGINT,
  election_status       VARCHAR,              -- ELECTED / DEFAULTED / MISSED_DEADLINE
  elected_date_key      INTEGER REFERENCES harborline.dim_date(date_key),
  deadline_date_key     INTEGER REFERENCES harborline.dim_date(date_key),
  hours_before_deadline INTEGER,              -- negative when missed
  missed_deadline       BOOLEAN,              -- <-- the error event
  estimated_client_impact_usd DECIMAL(14,2)   -- value difference vs the elected option
);

-- grain: 1 row per income payment per client per event
CREATE TABLE harborline.cae_income_payment (
  income_payment_key    BIGINT PRIMARY KEY,
  event_key             BIGINT REFERENCES harborline.cae_event(event_key),
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  security_key          INTEGER REFERENCES harborline.dim_security(security_key),
  market_key            INTEGER REFERENCES harborline.dim_market(market_key),
  currency_key          INTEGER REFERENCES harborline.dim_currency(currency_key),
  expected_date_key     INTEGER REFERENCES harborline.dim_date(date_key),
  actual_date_key       INTEGER REFERENCES harborline.dim_date(date_key),
  days_late             INTEGER,
  gross_amount_usd      DECIMAL(16,2),
  withholding_tax_usd   DECIMAL(16,2),
  net_amount_usd        DECIMAL(16,2),
  statutory_rate_pct    DECIMAL(6,3),         -- rate actually withheld
  treaty_rate_pct       DECIMAL(6,3),         -- rate the client is entitled to
  reclaim_eligible      BOOLEAN,
  reclaim_filed         BOOLEAN,              -- <-- revenue-leak signal
  reclaim_amount_usd    DECIMAL(16,2),
  reclaim_deadline_date_key INTEGER REFERENCES harborline.dim_date(date_key)  -- statute of limitations
);

-- ============================================================
-- CLT — Client & Billing
-- ============================================================

-- grain: 1 row per client / billing period (month) / fee type
CREATE TABLE harborline.clt_fee_invoice (
  fee_invoice_key       BIGINT PRIMARY KEY,
  invoice_ref           VARCHAR,
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  period_date_key       INTEGER REFERENCES harborline.dim_date(date_key),  -- month end
  fee_type              VARCHAR,              -- CUSTODY_BPS / TRANSACTION / CORPORATE_ACTION
                                              -- / INCOME_COLLECTION / TAX_RECLAIM / OVERDRAFT
  basis_amount_usd      DECIMAL(18,2),        -- AUC or transaction count basis
  fee_rate              DECIMAL(10,6),
  billable_amount_usd   DECIMAL(16,2),
  invoiced_amount_usd   DECIMAL(16,2),        -- differs from billable where a fee cap/waiver applies
  waiver_reason         VARCHAR               -- NULL / SLA_CREDIT / RELATIONSHIP_DISCOUNT / FEE_CAP
);

-- grain: 1 row per client service request (cost-to-serve)
CREATE TABLE harborline.clt_service_request (
  service_request_key   BIGINT PRIMARY KEY,
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  raised_date_key       INTEGER REFERENCES harborline.dim_date(date_key),
  resolved_date_key     INTEGER REFERENCES harborline.dim_date(date_key),
  request_category      VARCHAR,              -- FAIL_QUERY / INCOME_QUERY / CORPORATE_ACTION_QUERY
                                              -- / REPORTING / RECONCILIATION / ONBOARDING
  priority              VARCHAR,              -- P1 / P2 / P3
  resolution_hours      DECIMAL(10,2),
  sla_target_hours      INTEGER,              -- from the client's SLA tier
  sla_breached          BOOLEAN,
  analyst_hours         DECIMAL(8,2)          -- cost-to-serve driver
);

-- ============================================================
-- REC — Reconciliation & Exceptions
-- ============================================================

-- grain: 1 row per reconciliation break
CREATE TABLE harborline.rec_break (
  break_key             BIGINT PRIMARY KEY,
  break_ref             VARCHAR,
  detected_date_key     INTEGER REFERENCES harborline.dim_date(date_key),
  resolved_date_key     INTEGER REFERENCES harborline.dim_date(date_key),
  client_key            INTEGER REFERENCES harborline.dim_client(client_key),
  security_key          INTEGER REFERENCES harborline.dim_security(security_key),
  market_key            INTEGER REFERENCES harborline.dim_market(market_key),
  subcustodian_key      INTEGER REFERENCES harborline.dim_subcustodian(subcustodian_key),
  break_type            VARCHAR,              -- CASH / POSITION / TRANSACTION
  break_amount_usd      DECIMAL(16,2),
  age_days              INTEGER,
  break_status          VARCHAR,              -- OPEN / RESOLVED / WRITTEN_OFF
  root_cause            VARCHAR               -- FAILED_SETTLEMENT / CORPORATE_ACTION / FX / TIMING / UNKNOWN
);
