-- ============================================================
-- AskERP — Tenant 2: MRO Distributor (main demo)
-- NSAW-shaped warehouse. Schema-per-tenant isolation (D-027).
-- Subject-area-prefixed naming + conformed dims (D-028).
-- Single currency (USD). Grain is the contract.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS mro_distributor;

-- ============================================================
-- CONFORMED DIMENSIONS (8) — shared across all 5 subject areas
-- ============================================================

CREATE TABLE mro_distributor.dim_date (
  date_key        INTEGER PRIMARY KEY,     -- YYYYMMDD
  full_date       DATE NOT NULL,
  day_of_week     VARCHAR,
  day_of_month    INTEGER,
  week_of_year    INTEGER,
  month_num       INTEGER,
  month_name      VARCHAR,
  quarter_num     INTEGER,
  fiscal_period   VARCHAR,                 -- e.g. 'FY25-Q3'
  year_num        INTEGER,
  is_month_end    BOOLEAN
);

CREATE TABLE mro_distributor.dim_subsidiary (
  subsidiary_key  INTEGER PRIMARY KEY,
  subsidiary_name VARCHAR NOT NULL,
  country         VARCHAR,
  currency        VARCHAR DEFAULT 'USD',
  parent_rollup   VARCHAR
);

CREATE TABLE mro_distributor.dim_item (
  item_key        INTEGER PRIMARY KEY,
  sku             VARCHAR NOT NULL,
  item_name       VARCHAR,
  category        VARCHAR,                 -- Fasteners/Tools/Safety/Electrical/MRO
  subcategory     VARCHAR,
  unit_cost       DECIMAL(12,2),
  list_price      DECIMAL(12,2),
  lead_time_class VARCHAR,                 -- Short/Medium/Long
  is_active       BOOLEAN
);

CREATE TABLE mro_distributor.dim_customer (
  customer_key    INTEGER PRIMARY KEY,
  customer_name   VARCHAR,
  segment         VARCHAR,                 -- Manufacturing/Construction/Facilities/Government
  region          VARCHAR,
  credit_terms    VARCHAR,                 -- Net 30 / Net 45 / Net 60
  credit_days     INTEGER
);

CREATE TABLE mro_distributor.dim_supplier (
  supplier_key      INTEGER PRIMARY KEY,
  supplier_name     VARCHAR,
  region            VARCHAR,
  payment_terms     VARCHAR,              -- Net 30 / Net 45 / Net 60
  payment_days      INTEGER,
  promised_lead_days INTEGER,             -- contractual lead time
  reliability_tier  VARCHAR               -- A (reliable) .. D (chronic late)  <-- planted signal
);

CREATE TABLE mro_distributor.dim_warehouse (
  warehouse_key   INTEGER PRIMARY KEY,
  warehouse_name  VARCHAR,
  region          VARCHAR,
  warehouse_type  VARCHAR                  -- DC / Branch
);

CREATE TABLE mro_distributor.dim_gl_account (
  gl_account_key  INTEGER PRIMARY KEY,
  account_code    VARCHAR,
  account_name    VARCHAR,
  account_type    VARCHAR,                 -- Asset/Liability/Equity/Revenue/Expense
  statement       VARCHAR,                 -- P&L / BS
  rollup          VARCHAR
);

CREATE TABLE mro_distributor.dim_employee (
  employee_key    INTEGER PRIMARY KEY,
  employee_name   VARCHAR,
  role            VARCHAR,                 -- Sales Rep / Buyer
  region          VARCHAR
);

-- ============================================================
-- O2C — Order to Cash
-- ============================================================

CREATE TABLE mro_distributor.o2c_sales_order_line (
  so_line_key     BIGINT PRIMARY KEY,
  so_number       VARCHAR,
  order_date_key  INTEGER REFERENCES mro_distributor.dim_date(date_key),
  customer_key    INTEGER REFERENCES mro_distributor.dim_customer(customer_key),
  item_key        INTEGER REFERENCES mro_distributor.dim_item(item_key),
  warehouse_key   INTEGER REFERENCES mro_distributor.dim_warehouse(warehouse_key),
  employee_key    INTEGER REFERENCES mro_distributor.dim_employee(employee_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  qty_ordered     INTEGER,
  unit_price      DECIMAL(12,2),
  ext_amount      DECIMAL(14,2),
  unit_cost       DECIMAL(12,2),
  ext_cost        DECIMAL(14,2),
  margin_amount   DECIMAL(14,2)
);

CREATE TABLE mro_distributor.o2c_fulfillment_line (
  ff_line_key     BIGINT PRIMARY KEY,
  so_line_key     BIGINT REFERENCES mro_distributor.o2c_sales_order_line(so_line_key),
  ship_date_key   INTEGER REFERENCES mro_distributor.dim_date(date_key),
  customer_key    INTEGER REFERENCES mro_distributor.dim_customer(customer_key),
  item_key        INTEGER REFERENCES mro_distributor.dim_item(item_key),
  warehouse_key   INTEGER REFERENCES mro_distributor.dim_warehouse(warehouse_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  qty_shipped     INTEGER,
  order_to_ship_days INTEGER               -- fulfillment lead time (signal target)
);

CREATE TABLE mro_distributor.o2c_return_line (
  return_line_key BIGINT PRIMARY KEY,
  return_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  customer_key    INTEGER REFERENCES mro_distributor.dim_customer(customer_key),
  item_key        INTEGER REFERENCES mro_distributor.dim_item(item_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  qty_returned    INTEGER,
  credit_amount   DECIMAL(14,2),
  reason          VARCHAR
);

-- ============================================================
-- AR — Accounts Receivable / Customer Payments  (DSO source)
-- ============================================================

CREATE TABLE mro_distributor.ar_invoice (
  invoice_key     BIGINT PRIMARY KEY,
  invoice_number  VARCHAR,
  invoice_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  due_date_key    INTEGER REFERENCES mro_distributor.dim_date(date_key),
  customer_key    INTEGER REFERENCES mro_distributor.dim_customer(customer_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  invoice_amount  DECIMAL(14,2),
  open_balance    DECIMAL(14,2)
);

CREATE TABLE mro_distributor.ar_payment_application (
  ar_payment_key  BIGINT PRIMARY KEY,
  invoice_key     BIGINT REFERENCES mro_distributor.ar_invoice(invoice_key),
  payment_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  customer_key    INTEGER REFERENCES mro_distributor.dim_customer(customer_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  amount_applied  DECIMAL(14,2),
  days_to_pay     INTEGER
);

-- ============================================================
-- P2P — Procure to Pay  (DPO source + late-supplier signal)
-- ============================================================

CREATE TABLE mro_distributor.p2p_purchase_order_line (
  po_line_key     BIGINT PRIMARY KEY,
  po_number       VARCHAR,
  po_date_key     INTEGER REFERENCES mro_distributor.dim_date(date_key),
  promised_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  received_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  supplier_key    INTEGER REFERENCES mro_distributor.dim_supplier(supplier_key),
  item_key        INTEGER REFERENCES mro_distributor.dim_item(item_key),
  warehouse_key   INTEGER REFERENCES mro_distributor.dim_warehouse(warehouse_key),
  employee_key    INTEGER REFERENCES mro_distributor.dim_employee(employee_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  qty_ordered     INTEGER,
  unit_cost       DECIMAL(12,2),
  ext_cost        DECIMAL(14,2),
  late_days       INTEGER                  -- received - promised (planted signal)
);

CREATE TABLE mro_distributor.p2p_vendor_bill (
  bill_key        BIGINT PRIMARY KEY,
  bill_number     VARCHAR,
  bill_date_key   INTEGER REFERENCES mro_distributor.dim_date(date_key),
  due_date_key    INTEGER REFERENCES mro_distributor.dim_date(date_key),
  supplier_key    INTEGER REFERENCES mro_distributor.dim_supplier(supplier_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  bill_amount     DECIMAL(14,2),
  open_balance    DECIMAL(14,2)
);

CREATE TABLE mro_distributor.p2p_bill_payment (
  bill_payment_key BIGINT PRIMARY KEY,
  bill_key        BIGINT REFERENCES mro_distributor.p2p_vendor_bill(bill_key),
  payment_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  supplier_key    INTEGER REFERENCES mro_distributor.dim_supplier(supplier_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  amount_paid     DECIMAL(14,2),
  days_to_pay     INTEGER
);

-- ============================================================
-- INV — Inventory & Supply Chain  (DIO source)
-- ============================================================

CREATE TABLE mro_distributor.inv_balance_snapshot (
  snapshot_key    BIGINT PRIMARY KEY,
  snapshot_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  item_key        INTEGER REFERENCES mro_distributor.dim_item(item_key),
  warehouse_key   INTEGER REFERENCES mro_distributor.dim_warehouse(warehouse_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  qty_on_hand     INTEGER,
  value_on_hand   DECIMAL(14,2),
  is_stockout     BOOLEAN                  -- qty_on_hand = 0 (signal target)
);

CREATE TABLE mro_distributor.inv_transaction (
  inv_txn_key     BIGINT PRIMARY KEY,
  txn_date_key    INTEGER REFERENCES mro_distributor.dim_date(date_key),
  item_key        INTEGER REFERENCES mro_distributor.dim_item(item_key),
  warehouse_key   INTEGER REFERENCES mro_distributor.dim_warehouse(warehouse_key),
  supplier_key    INTEGER REFERENCES mro_distributor.dim_supplier(supplier_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  txn_type        VARCHAR,                 -- Receipt/Issue/Adjustment/Transfer
  qty_delta       INTEGER,
  value_delta     DECIMAL(14,2)
);

-- ============================================================
-- GL — General Ledger / Record to Report
-- ============================================================

CREATE TABLE mro_distributor.gl_journal_line (
  je_line_key     BIGINT PRIMARY KEY,
  je_number       VARCHAR,
  posting_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  gl_account_key  INTEGER REFERENCES mro_distributor.dim_gl_account(gl_account_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  employee_key    INTEGER REFERENCES mro_distributor.dim_employee(employee_key),
  debit_amount    DECIMAL(14,2),
  credit_amount   DECIMAL(14,2),
  net_amount      DECIMAL(14,2)
);

CREATE TABLE mro_distributor.gl_account_balance (
  balance_key     BIGINT PRIMARY KEY,
  period_date_key INTEGER REFERENCES mro_distributor.dim_date(date_key),
  gl_account_key  INTEGER REFERENCES mro_distributor.dim_gl_account(gl_account_key),
  subsidiary_key  INTEGER REFERENCES mro_distributor.dim_subsidiary(subsidiary_key),
  period_balance  DECIMAL(16,2),
  ytd_balance     DECIMAL(16,2)
);
