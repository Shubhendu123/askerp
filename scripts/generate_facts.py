"""
AskERP — Fact table generator
Generates fact_sales_order, fact_invoice, fact_payment, fact_gl_entry CSVs
with three planted anomalies. Reads dimension CSVs from data/raw/.
"""

import csv
import os
import random
import time
import yaml
from collections import defaultdict
from datetime import date, timedelta

import numpy as np

# ── Setup ──────────────────────────────────────────────────────────────────────
random.seed(42)
np.random.seed(42)

t0 = time.time()
BASE_DIR = os.path.join(os.path.dirname(__file__), "..")
RAW_DIR  = os.path.join(BASE_DIR, "data", "raw")


def read_csv(fname):
    with open(os.path.join(RAW_DIR, fname)) as f:
        return list(csv.DictReader(f))


def write_csv(fname, fieldnames, rows):
    path = os.path.join(RAW_DIR, fname)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return path


def date_to_id(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def id_to_date(did: int) -> date:
    s = str(did)
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def quarter(d: date) -> int:
    return (d.month - 1) // 3 + 1


# ── Read dimensions ────────────────────────────────────────────────────────────
print("Reading dimension tables...")
customers_raw  = read_csv("dim_customer.csv")
items_raw      = read_csv("dim_item.csv")
employees_raw  = read_csv("dim_employee.csv")
locations_raw  = read_csv("dim_location.csv")

customers  = {int(r["customer_id"]): r for r in customers_raw}
items      = {int(r["item_id"]): r for r in items_raw}

# Active item pools
active_item_ids = [int(r["item_id"]) for r in items_raw if r["status"] == "Active"]
items_by_cat = defaultdict(list)
for r in items_raw:
    if r["status"] == "Active":
        items_by_cat[r["category"]].append(int(r["item_id"]))

# Region → reps and managers
region_reps     = defaultdict(list)
region_managers = {}
for e in employees_raw:
    eid = int(e["employee_id"])
    if e["role"] == "Sales Rep" and e["status"] == "Active":
        region_reps[e["region"]].append(eid)
    elif e["role"] == "Sales Manager":
        region_managers[e["region"]] = eid

# Location weights by customer region
REGION_LOC_WEIGHTS = {
    "West":    ([2, 4], [0.90, 0.10]),
    "East":    ([3, 4], [0.95, 0.05]),
    "Central": ([4],    [1.00]),
    "South":   ([4, 5], [0.60, 0.40]),
}

TERMS_TO_DAYS = {"Net 15": 15, "Net 30": 30, "Net 45": 45, "Net 60": 60}

# ── Anomaly 1 setup — rename supplier to "Cascade Manufacturing" ────────────────
print("Setting up Anomaly 1 (Cascade Manufacturing supplier)...")
seating_items = [r for r in items_raw if r["category"] == "Office Seating"]
sup_count = defaultdict(int)
for r in seating_items:
    sup_count[r["supplier"]] += 1
top_supplier = max(sup_count, key=sup_count.get)
print(f"  Renaming '{top_supplier}' → 'Cascade Manufacturing' for Office Seating items")

cascade_item_ids = set()
for r in items_raw:
    if r["category"] == "Office Seating" and r["supplier"] == top_supplier:
        r["supplier"] = "Cascade Manufacturing"
        cascade_item_ids.add(int(r["item_id"]))
        items[int(r["item_id"])]["supplier"] = "Cascade Manufacturing"

write_csv("dim_item.csv", [
    "item_id", "sku", "item_name", "category", "subcategory", "material",
    "unit_cost", "unit_price", "supplier", "lead_time_days", "status"
], items_raw)
print(f"  Cascade item_ids: {sorted(cascade_item_ids)}")

# ── Date pool ─────────────────────────────────────────────────────────────────
print("Building weighted date pool...")

START_DATE = date(2023, 1, 1)
END_DATE   = date(2025, 12, 31)

all_dates = []
d = START_DATE
while d <= END_DATE:
    all_dates.append(d)
    d += timedelta(days=1)

YEAR_W = {2023: 0.28, 2024: 0.33, 2025: 0.39}
Q_W    = {1: 0.20, 2: 0.24, 3: 0.24, 4: 0.32}
DOW_W  = {0: 0.20, 1: 0.20, 2: 0.20, 3: 0.20, 4: 0.15, 5: 0.025, 6: 0.025}

raw_w = np.array([
    YEAR_W[d.year] * Q_W[quarter(d)] * DOW_W[d.weekday()]
    for d in all_dates
], dtype=np.float64)
raw_w /= raw_w.sum()


def sample_dates_global(n: int) -> list:
    idx = np.random.choice(len(all_dates), size=n, replace=True, p=raw_w)
    return [all_dates[i] for i in idx]


def sample_dates_range(n: int, start: date, end: date) -> list:
    mask = np.array([start <= d <= end for d in all_dates])
    sub_w = raw_w * mask
    if sub_w.sum() == 0:
        return []
    sub_w /= sub_w.sum()
    idx = np.random.choice(len(all_dates), size=n, replace=True, p=sub_w)
    return [all_dates[i] for i in idx]


# ── Order count assignment ─────────────────────────────────────────────────────
print("Assigning order counts per customer...")

HILTON_ID   = 1
MARRIOTT_ID = 2
CHURNED_IDS = {HILTON_ID, MARRIOTT_ID}

raw_counts = {}
for cid, c in customers.items():
    if cid == HILTON_ID:
        raw_counts[cid] = 210
    elif cid == MARRIOTT_ID:
        raw_counts[cid] = 190
    elif c["customer_segment"] == "Enterprise":
        raw_counts[cid] = random.randint(400, 800)
    elif c["customer_segment"] == "Mid-Market":
        raw_counts[cid] = random.randint(100, 250)
    else:
        raw_counts[cid] = random.randint(20, 60)

# Scale non-churned to hit ~30,000 total
churned_total = sum(raw_counts[c] for c in CHURNED_IDS)
non_churned   = {c: v for c, v in raw_counts.items() if c not in CHURNED_IDS}
scale = (30000 - churned_total) / sum(non_churned.values())
order_counts = {}
for cid in customers:
    if cid in CHURNED_IDS:
        order_counts[cid] = raw_counts[cid]
    else:
        order_counts[cid] = max(1, int(raw_counts[cid] * scale))

print(f"  Projected total orders: {sum(order_counts.values()):,}")

# ── Outdoor Furniture item set for Anomaly 3 ──────────────────────────────────
outdoor_item_ids = {int(r["item_id"]) for r in items_raw if r["category"] == "Outdoor Furniture"}


def get_effective_cost(item_id: int, order_date: date) -> float:
    base = float(items[item_id]["unit_cost"])
    if item_id in outdoor_item_ids and order_date.year == 2025:
        esc = {1: 1.00, 2: 1.20, 3: 1.40, 4: 1.60}[quarter(order_date)]
        return base * esc
    return base


def sample_qty() -> int:
    r = random.random()
    if r < 0.10:
        return random.randint(1, 4)
    elif r < 0.80:
        return random.randint(5, 15)
    return random.randint(16, 50)


def gen_order_financials(order_date: date, primary_cat: str):
    """Sample items and compute order financials. Returns dict of financial fields."""
    r = random.random()
    if r < 0.10:
        line_count = 1
    elif r < 0.95:
        line_count = random.randint(2, 8)
    else:
        line_count = random.randint(9, 15)

    # First item from primary category; rest from full pool
    cat_pool = items_by_cat.get(primary_cat, active_item_ids)
    sampled = [random.choice(cat_pool)]
    if line_count > 1:
        sampled += random.choices(active_item_ids, k=line_count - 1)

    total_amount = 0.0
    total_cost   = 0.0
    total_qty    = 0
    has_cascade  = False

    for iid in sampled:
        qty   = sample_qty()
        price = float(items[iid]["unit_price"])
        cost  = get_effective_cost(iid, order_date)
        total_amount += qty * price
        total_cost   += qty * cost
        total_qty    += qty
        if iid in cascade_item_ids:
            has_cascade = True

    margin_pct = (total_amount - total_cost) / total_amount * 100 if total_amount > 0 else 0.0
    eff_unit_cost = total_cost / total_qty if total_qty > 0 else 0.0

    return {
        "total_amount":             round(total_amount, 2),
        "line_count":               line_count,
        "effective_unit_cost":      round(eff_unit_cost, 4),
        "effective_gross_margin_pct": round(margin_pct, 4),
        "has_cascade":              has_cascade,
    }


def assign_status(order_date: date) -> str:
    """Assign order status based on how recent the order is."""
    age = (END_DATE - order_date).days
    r = random.random()
    if age <= 7:
        if r < 0.03:  return "Pending"
        if r < 0.08:  return "Confirmed"
        return "Shipped"
    if age <= 14:
        if r < 0.05:  return "Confirmed"
        if r < 0.15:  return "Shipped"
        if r < 0.17:  return "Cancelled"
        return "Delivered"
    # Older orders: standard distribution
    if r < 0.02:  return "Cancelled"
    if r < 0.14:  return "Shipped"
    return "Delivered"


CATEGORIES = list(items_by_cat.keys())
CAT_WEIGHTS = np.array([len(items_by_cat[c]) for c in CATEGORIES], dtype=np.float64)
CAT_WEIGHTS /= CAT_WEIGHTS.sum()

# ── Generate fact_sales_order ──────────────────────────────────────────────────
print("Generating fact_sales_order...")

orders = []
order_id = 1

# Track for Anomaly 1 post-processing
cascade_q3_2024_order_ids = []   # orders with Cascade seating in Q3 2024
Q3_2024_START = date(2024, 7, 1)
Q3_2024_END   = date(2024, 9, 30)

# Track Anomaly 2 last-order dates and revenue
hilton_orders   = []
marriott_orders = []

for cid in sorted(customers.keys()):
    c     = customers[cid]
    seg   = c["customer_segment"]
    region = c["region"]
    n_orders = order_counts[cid]

    locs, loc_w = REGION_LOC_WEIGHTS[region]
    reps = region_reps[region]
    mgr  = region_managers.get(region)

    # Hilton: all orders before Oct 1 2024
    if cid == HILTON_ID:
        order_dates = sample_dates_range(n_orders, START_DATE, date(2024, 9, 30))
    # Marriott: all orders before Nov 1 2024
    elif cid == MARRIOTT_ID:
        order_dates = sample_dates_range(n_orders, START_DATE, date(2024, 10, 31))
    else:
        order_dates = sample_dates_global(n_orders)

    # Whale customers: higher avg order value via bigger qty multiplier
    whale_mult = 2.5 if cid in CHURNED_IDS else 1.0

    for od in order_dates:
        primary_cat = np.random.choice(CATEGORIES, p=CAT_WEIGHTS)
        financials  = gen_order_financials(od, primary_cat)

        # Whale multiplier on amount (simulate larger orders)
        if whale_mult > 1.0:
            financials["total_amount"] = round(financials["total_amount"] * whale_mult, 2)

        # Employee
        if reps and random.random() > 0.10:
            emp_id = random.choice(reps)
        elif mgr:
            emp_id = mgr
        elif reps:
            emp_id = random.choice(reps)
        else:
            emp_id = 1

        loc_id = int(np.random.choice(locs, p=loc_w))
        status = assign_status(od)
        date_id = date_to_id(od)

        row = {
            "order_id":                   order_id,
            "order_date_id":              date_id,
            "customer_id":                cid,
            "employee_id":                emp_id,
            "location_id":                loc_id,
            "order_status":               status,
            "total_amount":               financials["total_amount"],
            "line_count":                 financials["line_count"],
            "primary_item_category":      primary_cat,
            "effective_unit_cost":        financials["effective_unit_cost"],
            "effective_gross_margin_pct": financials["effective_gross_margin_pct"],
        }
        orders.append(row)

        # Anomaly 1 candidates
        if financials["has_cascade"] and Q3_2024_START <= od <= Q3_2024_END:
            cascade_q3_2024_order_ids.append(order_id)

        # Anomaly 2 tracking
        if cid == HILTON_ID:
            hilton_orders.append(row)
        elif cid == MARRIOTT_ID:
            marriott_orders.append(row)

        order_id += 1

print(f"  Generated {len(orders):,} orders before Anomaly 1 application")

# ── Apply Anomaly 1 — Q3 2024 Cascade Manufacturing cancellation spike ─────────
print("Planting Anomaly 1 (Q3 2024 refund spike)...")

order_lookup = {o["order_id"]: o for o in orders}

# Baseline: Cascade seating cancellations in Q3 2023 (for comparison)
Q3_2023_START = date(2023, 7, 1)
Q3_2023_END   = date(2023, 9, 30)
cascade_q3_2023_cancelled = sum(
    1 for o in orders
    if o["primary_item_category"] == "Office Seating"
    and o["order_status"] == "Cancelled"
    and Q3_2023_START <= id_to_date(o["order_date_id"]) <= Q3_2023_END
)

# Cancel 35% of Cascade-seating Q3 2024 orders
n_to_cancel = int(len(cascade_q3_2024_order_ids) * 0.35)
cancel_set   = set(random.sample(cascade_q3_2024_order_ids, n_to_cancel))
for oid in cancel_set:
    order_lookup[oid]["order_status"] = "Cancelled"

print(f"  Anomaly 1 planted: {n_to_cancel} cancelled orders for Office Seating / "
      f"Cascade Manufacturing in Q3 2024 (vs {cascade_q3_2023_cancelled} in Q3 2023 baseline)")

# ── Anomaly 2 report ──────────────────────────────────────────────────────────
hilton_last   = max(id_to_date(o["order_date_id"]) for o in hilton_orders)
marriott_last = max(id_to_date(o["order_date_id"]) for o in marriott_orders)
hilton_rev    = sum(float(o["total_amount"]) for o in hilton_orders)
marriott_rev  = sum(float(o["total_amount"]) for o in marriott_orders)
combined_rev  = hilton_rev + marriott_rev
print(f"  Anomaly 2 planted: Hilton last order = {hilton_last}, "
      f"Marriott last order = {marriott_last}. "
      f"Combined revenue 2023–cutoff = ${combined_rev:,.0f}")

# ── Anomaly 3 report ──────────────────────────────────────────────────────────
outdoor_2025 = [
    o for o in orders
    if o["primary_item_category"] == "Outdoor Furniture"
    and id_to_date(o["order_date_id"]).year == 2025
]
by_q = defaultdict(list)
for o in outdoor_2025:
    by_q[quarter(id_to_date(o["order_date_id"]))].append(float(o["effective_gross_margin_pct"]))
q1_avg = sum(by_q[1]) / len(by_q[1]) if by_q[1] else 0
q4_avg = sum(by_q[4]) / len(by_q[4]) if by_q[4] else 0
print(f"  Anomaly 3 planted: Outdoor Furniture avg margin Q1 2025 = {q1_avg:.1f}%, "
      f"Q4 2025 = {q4_avg:.1f}%, delta = -{q1_avg - q4_avg:.1f} ppt")

# ── Write fact_sales_order ─────────────────────────────────────────────────────
so_fields = [
    "order_id", "order_date_id", "customer_id", "employee_id", "location_id",
    "order_status", "total_amount", "line_count", "primary_item_category",
    "effective_unit_cost", "effective_gross_margin_pct",
]
so_path = write_csv("fact_sales_order.csv", so_fields, orders)
print(f"  ✓ {len(orders):,} rows → {so_path}")

# ── Generate fact_invoice ──────────────────────────────────────────────────────
print("Generating fact_invoice...")

RECENT_CUTOFF = date(2025, 12, 1)   # invoices due on/after this → mostly Open
invoices = []
invoice_id = 1

non_cancelled = [o for o in orders if o["order_status"] != "Cancelled"]

for o in non_cancelled:
    order_date = id_to_date(o["order_date_id"])
    inv_date   = order_date + timedelta(days=random.randint(1, 7))
    if inv_date > END_DATE:
        inv_date = END_DATE

    cid    = int(o["customer_id"])
    terms  = TERMS_TO_DAYS.get(customers[cid]["payment_terms"], 30)
    due_dt = inv_date + timedelta(days=terms)

    inv_amt = float(o["total_amount"])
    tax_amt = round(inv_amt * 0.08, 2)

    # Status
    if due_dt >= RECENT_CUTOFF:
        r = random.random()
        status = "Paid" if r < 0.60 else ("Open" if r < 0.98 else "Voided")
    else:
        r = random.random()
        if r < 0.90:   status = "Paid"
        elif r < 0.95: status = "Overdue"
        elif r < 0.99: status = "Open"
        else:           status = "Voided"

    invoices.append({
        "invoice_id":      invoice_id,
        "order_id":        o["order_id"],
        "invoice_date_id": date_to_id(inv_date),
        "due_date_id":     date_to_id(due_dt),
        "customer_id":     cid,
        "invoice_amount":  round(inv_amt, 2),
        "tax_amount":      tax_amt,
        "status":          status,
    })
    invoice_id += 1

inv_path = write_csv("fact_invoice.csv", [
    "invoice_id", "order_id", "invoice_date_id", "due_date_id",
    "customer_id", "invoice_amount", "tax_amount", "status",
], invoices)
print(f"  ✓ {len(invoices):,} rows → {inv_path}")

# ── Generate fact_payment ──────────────────────────────────────────────────────
print("Generating fact_payment...")

PAY_METHODS = ["Wire", "ACH", "Check", "Credit Card"]
PAY_WEIGHTS = [0.50, 0.30, 0.15, 0.05]
payment_id  = 1
payments    = []

for inv in invoices:
    if inv["status"] == "Voided":
        continue

    inv_date = id_to_date(inv["invoice_date_id"])
    cid      = int(inv["customer_id"])
    terms    = TERMS_TO_DAYS.get(customers[cid]["payment_terms"], 30)

    if inv["status"] == "Paid":
        pay_date = inv_date + timedelta(days=random.randint(0, terms + 5))
        if pay_date > END_DATE:
            pay_date = END_DATE
        payments.append({
            "payment_id":       payment_id,
            "invoice_id":       inv["invoice_id"],
            "payment_date_id":  date_to_id(pay_date),
            "customer_id":      cid,
            "payment_amount":   inv["invoice_amount"],
            "payment_method":   random.choices(PAY_METHODS, weights=PAY_WEIGHTS)[0],
        })
        payment_id += 1

    elif inv["status"] == "Overdue" and random.random() < 0.50:
        # Partial payment
        partial = round(float(inv["invoice_amount"]) * random.uniform(0.3, 0.7), 2)
        pay_date = id_to_date(inv["due_date_id"]) + timedelta(days=random.randint(1, 30))
        if pay_date > END_DATE:
            pay_date = END_DATE
        payments.append({
            "payment_id":       payment_id,
            "invoice_id":       inv["invoice_id"],
            "payment_date_id":  date_to_id(pay_date),
            "customer_id":      cid,
            "payment_amount":   partial,
            "payment_method":   random.choices(PAY_METHODS, weights=PAY_WEIGHTS)[0],
        })
        payment_id += 1

pay_path = write_csv("fact_payment.csv", [
    "payment_id", "invoice_id", "payment_date_id",
    "customer_id", "payment_amount", "payment_method",
], payments)
print(f"  ✓ {len(payments):,} rows → {pay_path}")

# ── Generate fact_gl_entry ─────────────────────────────────────────────────────
print("Generating fact_gl_entry...")

# Pre-index data by (year, month)
inv_by_month  = defaultdict(list)
pay_by_month  = defaultdict(list)
ord_by_month  = defaultdict(list)
for o in orders:
    d = id_to_date(o["order_date_id"])
    ord_by_month[(d.year, d.month)].append(o)
for inv in invoices:
    d = id_to_date(inv["invoice_date_id"])
    inv_by_month[(d.year, d.month)].append(inv)
for p in payments:
    d = id_to_date(p["payment_date_id"])
    pay_by_month[(d.year, d.month)].append(p)

ADJ_ACCOUNTS = [
    ("6000-Salary Expense",  "Expense"),
    ("6100-Rent Expense",    "Expense"),
    ("6200-Utilities",       "Expense"),
    ("6300-Marketing",       "Expense"),
    ("6400-Depreciation",    "Expense"),
    ("7000-Other Income",    "Revenue"),
    ("7100-Interest Income", "Revenue"),
]

gl_entries = []
gl_id = 1

for year in [2023, 2024, 2025]:
    for month in range(1, 13):
        # Last day of month as posting date
        if month == 12:
            post_date = date(year, 12, 31)
        else:
            post_date = date(year, month + 1, 1) - timedelta(days=1)
        post_id = date_to_id(post_date)
        month_start = date(year, month, 1)
        month_days  = (post_date - month_start).days

        month_invs  = inv_by_month[(year, month)]
        month_pays  = pay_by_month[(year, month)]
        month_ords  = ord_by_month[(year, month)]

        revenue  = sum(float(i["invoice_amount"]) for i in month_invs)
        paid_amt = sum(float(p["payment_amount"])  for p in month_pays)
        cogs     = sum(
            float(o["total_amount"]) * (1 - float(o["effective_gross_margin_pct"]) / 100)
            for o in month_ords if o["order_status"] != "Cancelled"
        )
        ar_net   = max(0.0, revenue - paid_amt)
        refunds  = sum(float(o["total_amount"]) for o in month_ords if o["order_status"] == "Cancelled")

        # Standard monthly account postings
        standard = [
            ("4000-Revenue", "Revenue", 0.0,              round(revenue, 2),  "Invoice",    0),
            ("5000-COGS",    "COGS",    round(cogs, 2),    0.0,               "Invoice",    0),
            ("1200-AR",      "Asset",   round(ar_net, 2),  0.0,               "Invoice",    0),
            ("4500-Refunds", "Revenue", round(refunds, 2), 0.0,               "Adjustment", 0),
        ]
        for acct, atype, dr, cr, src, src_id in standard:
            if dr == 0.0 and cr == 0.0:
                continue
            gl_entries.append({
                "gl_entry_id":    gl_id,
                "posting_date_id": post_id,
                "account_code":   acct,
                "account_type":   atype,
                "debit_amount":   dr,
                "credit_amount":  cr,
                "source_type":    src,
                "source_id":      src_id,
            })
            gl_id += 1

        # Adjustment entries — ~270/month to reach ~10,000 total
        for _ in range(270):
            adj_day  = month_start + timedelta(days=random.randint(0, month_days))
            adj_amt  = round(random.uniform(200, 15000), 2)
            acct, atype = random.choice(ADJ_ACCOUNTS)
            is_debit = (atype == "Expense")
            gl_entries.append({
                "gl_entry_id":    gl_id,
                "posting_date_id": date_to_id(adj_day),
                "account_code":   acct,
                "account_type":   atype,
                "debit_amount":   adj_amt if is_debit else 0.0,
                "credit_amount":  0.0 if is_debit else adj_amt,
                "source_type":    "Adjustment",
                "source_id":      gl_id,
            })
            gl_id += 1

gl_path = write_csv("fact_gl_entry.csv", [
    "gl_entry_id", "posting_date_id", "account_code", "account_type",
    "debit_amount", "credit_amount", "source_type", "source_id",
], gl_entries)
print(f"  ✓ {len(gl_entries):,} rows → {gl_path}")

# ── Update schema.yaml ─────────────────────────────────────────────────────────
print("\nUpdating data/schema.yaml...")

schema_path = os.path.join(BASE_DIR, "data", "schema.yaml")
with open(schema_path) as f:
    schema = yaml.safe_load(f)

NEW_COLS = [
    {
        "name": "primary_item_category",
        "type": "VARCHAR",
        "description": "Category of the primary (first) item in the order — used to attribute margin and anomaly analysis to a product category.",
    },
    {
        "name": "effective_unit_cost",
        "type": "DECIMAL",
        "description": "Effective unit cost at the time of the order, accounting for cost fluctuations over time (e.g., Outdoor Furniture quarterly cost escalation in 2025).",
    },
    {
        "name": "effective_gross_margin_pct",
        "type": "DECIMAL",
        "description": "Gross margin percentage at the time of the order ((price - cost) / price × 100), reflecting period-specific cost fluctuations.",
    },
]

for table in schema["tables"]:
    if table["name"] == "fact_sales_order":
        existing_names = {c["name"] for c in table["columns"]}
        for col in NEW_COLS:
            if col["name"] not in existing_names:
                table["columns"].append(col)
        break

with open(schema_path, "w") as f:
    yaml.dump(schema, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
print("  ✓ Added primary_item_category, effective_unit_cost, effective_gross_margin_pct to fact_sales_order")

# ── Sanity checks ──────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("SANITY CHECKS")
print("=" * 70)

# 1. Order count by year and quarter
print("\n[1] Order count by year & quarter:")
yq = defaultdict(int)
for o in orders:
    d = id_to_date(o["order_date_id"])
    yq[(d.year, quarter(d))] += 1
print(f"  {'Year':>4}  {'Q':>2}  {'Orders':>8}  {'% of total':>10}")
print(f"  {'-'*32}")
for (yr, q), cnt in sorted(yq.items()):
    print(f"  {yr:>4}  Q{q}  {cnt:>8,}  {cnt/len(orders)*100:>9.1f}%")
yr_totals = defaultdict(int)
for (yr, q), cnt in yq.items():
    yr_totals[yr] += cnt
print(f"  Year totals: { {yr: f'{cnt:,}' for yr, cnt in sorted(yr_totals.items())} }")

# 2. Order count by region
print("\n[2] Order count by region:")
reg_cnt = defaultdict(int)
for o in orders:
    reg_cnt[customers[int(o["customer_id"])]["region"]] += 1
for reg, cnt in sorted(reg_cnt.items()):
    print(f"  {reg:<10} {cnt:>6,}  ({cnt/len(orders)*100:.1f}%)")

# 3. Anomaly 1: Cascade Manufacturing cancellations by quarter
print("\n[3] Anomaly 1 — Cascade Manufacturing Office Seating cancellations by quarter:")
cas_cancel = defaultdict(int)
cas_total  = defaultdict(int)
for o in orders:
    if o["primary_item_category"] == "Office Seating":
        d = id_to_date(o["order_date_id"])
        key = f"{d.year} Q{quarter(d)}"
        cas_total[key] += 1
        if o["order_status"] == "Cancelled":
            cas_cancel[key] += 1
for k in sorted(cas_total.keys()):
    tot  = cas_total[k]
    canc = cas_cancel.get(k, 0)
    flag = " ← ANOMALY" if "2024 Q3" in k else ""
    print(f"  {k}: {canc}/{tot} cancelled ({canc/tot*100:.1f}%){flag}")

# 3b. Cascade Manufacturing supplier verification
print("\n[3b] Cascade Manufacturing supplier verification:")
dim_items_check = read_csv("dim_item.csv")
sup_dist = defaultdict(int)
for r in dim_items_check:
    sup_dist[r["supplier"]] += 1
print(f"  Total unique suppliers: {len(sup_dist)}")
for sup, cnt in sorted(sup_dist.items(), key=lambda x: -x[1]):
    print(f"  {sup:<35} {cnt:>3} items")
cascade_seating = [r for r in dim_items_check if r["category"] == "Office Seating" and r["supplier"] == "Cascade Manufacturing"]
cascade_ok = "✓ PASS" if cascade_seating else "✗ FAIL"
print(f"\n  Office Seating items with supplier='Cascade Manufacturing': {len(cascade_seating)} {cascade_ok}")
for r in cascade_seating[:3]:
    print(f"    SKU={r['sku']}  name='{r['item_name']}'  supplier='{r['supplier']}'")

# 4. Anomaly 2: Hilton & Marriott order activity by quarter
print("\n[4] Anomaly 2 — Whale customer orders by quarter:")
for whale_id, name in [(HILTON_ID, "Hilton"), (MARRIOTT_ID, "Marriott")]:
    whale_orders = [o for o in orders if int(o["customer_id"]) == whale_id]
    qtr_rev = defaultdict(float)
    qtr_cnt = defaultdict(int)
    for o in whale_orders:
        d = id_to_date(o["order_date_id"])
        k = f"{d.year} Q{quarter(d)}"
        qtr_cnt[k] += 1
        qtr_rev[k] += float(o["total_amount"])
    print(f"  {name} (id={whale_id}):")
    for k in sorted(qtr_cnt.keys()):
        print(f"    {k}: {qtr_cnt[k]:>3} orders, ${qtr_rev[k]:>10,.0f}")
    if whale_id == HILTON_ID:
        churn_date = date(2024, 10, 1)
        churn_label = "Oct 1, 2024"
    else:
        churn_date = date(2024, 11, 1)
        churn_label = "Nov 1, 2024"
    post_churn = sum(1 for o in whale_orders if id_to_date(o["order_date_id"]) >= churn_date)
    churn_ok = "✓ PASS" if post_churn == 0 else f"✗ FAIL ({post_churn} orders after churn)"
    print(f"    Churn date: {churn_label} | Orders from churn date onwards: {post_churn} → {churn_ok}")

# 5. Anomaly 3: Outdoor Furniture margin by quarter in 2025
print("\n[5] Anomaly 3 — Outdoor Furniture gross margin by quarter in 2025:")
out_margins = defaultdict(list)
for o in orders:
    d = id_to_date(o["order_date_id"])
    if o["primary_item_category"] == "Outdoor Furniture" and d.year == 2025:
        out_margins[quarter(d)].append(float(o["effective_gross_margin_pct"]))
for q_num in [1, 2, 3, 4]:
    vals = out_margins[q_num]
    if vals:
        avg = sum(vals) / len(vals)
        print(f"  Q{q_num} 2025: avg margin = {avg:.2f}%  ({len(vals)} orders)")
q1m = sum(out_margins[1]) / len(out_margins[1]) if out_margins[1] else 0
q4m = sum(out_margins[4]) / len(out_margins[4]) if out_margins[4] else 0
margin_ok = "✓ PASS" if q4m < q1m else "✗ FAIL"
print(f"  Trend: Q1={q1m:.2f}% → Q4={q4m:.2f}% (Δ={q4m-q1m:.2f} ppt) {margin_ok}")

# 6. Payment status distribution
print("\n[6] Invoice payment status distribution:")
status_cnt = defaultdict(int)
for inv in invoices:
    status_cnt[inv["status"]] += 1
for st, cnt in sorted(status_cnt.items()):
    print(f"  {st:<10} {cnt:>6,}  ({cnt/len(invoices)*100:.1f}%)")

# 7. Total revenue per year
print("\n[7] Total revenue per year:")
yr_rev = defaultdict(float)
for inv in invoices:
    d = id_to_date(inv["invoice_date_id"])
    yr_rev[d.year] += float(inv["invoice_amount"])
for yr in sorted(yr_rev.keys()):
    print(f"  {yr}: ${yr_rev[yr]:>15,.0f}")
yoy_ok = "✓ PASS" if yr_rev[2025] > yr_rev[2024] > yr_rev[2023] else "✗ FAIL"
print(f"  YoY growth: 2023→2024→2025 {yoy_ok}")

# ── Final summary ──────────────────────────────────────────────────────────────
elapsed = time.time() - t0
print("\n" + "=" * 70)
print("GENERATION COMPLETE")
print("=" * 70)

files = [
    ("fact_sales_order.csv", orders),
    ("fact_invoice.csv",     invoices),
    ("fact_payment.csv",     payments),
    ("fact_gl_entry.csv",    gl_entries),
]
print(f"\n{'File':<25} {'Rows':>8}  {'Size':>10}  Status")
print("-" * 55)
for fname, rows in files:
    fpath = os.path.join(RAW_DIR, fname)
    sz    = os.path.getsize(fpath) / 1024
    ok    = "✓" if len(rows) > 0 else "✗"
    print(f"{fname:<25} {len(rows):>8,}  {sz:>8.1f}KB  {ok}")
print(f"\nGenerated in {elapsed:.1f}s")
