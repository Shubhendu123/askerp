"""
AskERP — Warehouse verification
Runs 15 SQL checks against data/northwind.db to confirm data integrity
and that all three planted anomalies are discoverable in raw SQL.
"""

import os
import sys

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb not installed. Run: pip install duckdb")
    sys.exit(1)

BASE_DIR = os.path.join(os.path.dirname(__file__), "..")
DB_PATH  = os.path.join(BASE_DIR, "data", "northwind.db")

if not os.path.exists(DB_PATH):
    print(f"ERROR: {DB_PATH} not found. Run load_warehouse.py first.")
    sys.exit(1)

conn    = duckdb.connect(DB_PATH, read_only=True)
passed  = 0
failed  = 0
results = []


def check(vid: str, label: str, passed_flag: bool, detail: str = ""):
    global passed, failed
    status = "✓ PASS" if passed_flag else "✗ FAIL"
    msg    = f"[{status}] {vid} — {label}"
    if not passed_flag and detail:
        msg += f"\n         → {detail}"
    results.append(msg)
    if passed_flag:
        passed += 1
    else:
        failed += 1


def q(sql: str):
    return conn.execute(sql).fetchone()


def qa(sql: str):
    return conn.execute(sql).fetchall()


# ── V01 — Row counts within ±5% of expected ───────────────────────────────────
EXPECTED = {
    "dim_date":        1096,
    "dim_location":    5,
    "dim_employee":    30,
    "dim_item":        80,
    "dim_customer":    150,
    "fact_sales_order": 29915,
    "fact_invoice":    29176,
    "fact_payment":    26064,
    "fact_gl_entry":   9859,
}
v01_ok   = True
v01_detail = []
for tbl, exp in EXPECTED.items():
    actual = q(f"SELECT COUNT(*) FROM {tbl}")[0]
    pct    = abs(actual - exp) / exp
    if pct > 0.05:
        v01_ok = False
        v01_detail.append(f"{tbl}: got {actual:,}, expected ~{exp:,} ({pct*100:.1f}% off)")

check("V01", "Row counts match generation (all 9 tables within ±5%)",
      v01_ok, "; ".join(v01_detail))

# ── V02 — FK: fact_sales_order.customer_id → dim_customer ─────────────────────
orphans = q("""
    SELECT COUNT(*) FROM fact_sales_order fso
    WHERE NOT EXISTS (SELECT 1 FROM dim_customer dc WHERE dc.customer_id = fso.customer_id)
""")[0]
check("V02", "FK: every fact_sales_order.customer_id exists in dim_customer",
      orphans == 0, f"{orphans} orphaned customer_ids")

# ── V03 — FK: fact_sales_order employee_id, location_id, order_date_id ────────
bad_emp = q("""
    SELECT COUNT(*) FROM fact_sales_order fso
    WHERE NOT EXISTS (SELECT 1 FROM dim_employee e WHERE e.employee_id = fso.employee_id)
""")[0]
bad_loc = q("""
    SELECT COUNT(*) FROM fact_sales_order fso
    WHERE NOT EXISTS (SELECT 1 FROM dim_location l WHERE l.location_id = fso.location_id)
""")[0]
bad_date = q("""
    SELECT COUNT(*) FROM fact_sales_order fso
    WHERE NOT EXISTS (SELECT 1 FROM dim_date d WHERE d.date_id = fso.order_date_id)
""")[0]
v03_ok = (bad_emp == 0 and bad_loc == 0 and bad_date == 0)
check("V03", "FK: fact_sales_order employee_id, location_id, order_date_id all resolve",
      v03_ok,
      f"bad employee_ids={bad_emp}, bad location_ids={bad_loc}, bad order_date_ids={bad_date}")

# ── V04 — FK: fact_invoice.order_id → fact_sales_order ───────────────────────
orphans = q("""
    SELECT COUNT(*) FROM fact_invoice fi
    WHERE NOT EXISTS (SELECT 1 FROM fact_sales_order fso WHERE fso.order_id = fi.order_id)
""")[0]
check("V04", "FK: every fact_invoice.order_id exists in fact_sales_order",
      orphans == 0, f"{orphans} orphaned order_ids in fact_invoice")

# ── V05 — FK: fact_payment.invoice_id → fact_invoice ─────────────────────────
orphans = q("""
    SELECT COUNT(*) FROM fact_payment fp
    WHERE NOT EXISTS (SELECT 1 FROM fact_invoice fi WHERE fi.invoice_id = fp.invoice_id)
""")[0]
check("V05", "FK: every fact_payment.invoice_id exists in fact_invoice",
      orphans == 0, f"{orphans} orphaned invoice_ids in fact_payment")

# ── V06 — Date dimension covers 2023-01-01 → 2025-12-31, no gaps ─────────────
date_check = q("""
    SELECT COUNT(*), MIN(date), MAX(date)
    FROM dim_date
""")
cnt, min_d, max_d = date_check
v06_ok = (cnt == 1096 and str(min_d) == "2023-01-01" and str(max_d) == "2025-12-31")
check("V06", "Date dimension covers exactly 2023-01-01 to 2025-12-31, no gaps (1,096 days)",
      v06_ok,
      f"count={cnt}, min={min_d}, max={max_d}")

# ── V07 — Anomaly 1: Cascade Manufacturing cancellation spike Q3 2024 ─────────
cancel_rates = qa("""
    SELECT dd.year, dd.quarter,
           SUM(CASE WHEN fso.order_status = 'Cancelled' THEN 1.0 ELSE 0 END) / COUNT(*) * 100
    FROM fact_sales_order fso
    JOIN dim_date dd ON fso.order_date_id = dd.date_id
    WHERE fso.primary_item_category = 'Office Seating'
    GROUP BY dd.year, dd.quarter
    ORDER BY dd.year, dd.quarter
""")
q3_2024_rate  = next((r[2] for r in cancel_rates if r[0] == 2024 and r[1] == 3), 0)
other_rates   = [r[2] for r in cancel_rates if not (r[0] == 2024 and r[1] == 3)]
max_other     = max(other_rates) if other_rates else 0
v07_ok = q3_2024_rate >= 10.0 and max_other <= 5.0
check("V07",
      "Anomaly 1: Office Seating cancellation rate ≥10% in Q3 2024 vs ≤5% in all other quarters",
      v07_ok,
      f"Q3 2024 rate={q3_2024_rate:.1f}%, max other quarter={max_other:.1f}%")

# ── V08 — Anomaly 2: Hilton zero orders from 2024-10-01 ──────────────────────
hilton_post = q("""
    SELECT COUNT(*) FROM fact_sales_order fso
    JOIN dim_date dd ON fso.order_date_id = dd.date_id
    WHERE fso.customer_id = 1
    AND dd.date >= '2024-10-01'
""")[0]
check("V08", "Anomaly 2: Hilton (customer_id=1) has zero orders from 2024-10-01 onwards",
      hilton_post == 0, f"found {hilton_post} orders after churn date")

# ── V09 — Anomaly 2: Marriott zero orders from 2024-11-01 ────────────────────
marriott_post = q("""
    SELECT COUNT(*) FROM fact_sales_order fso
    JOIN dim_date dd ON fso.order_date_id = dd.date_id
    WHERE fso.customer_id = 2
    AND dd.date >= '2024-11-01'
""")[0]
check("V09", "Anomaly 2: Marriott (customer_id=2) has zero orders from 2024-11-01 onwards",
      marriott_post == 0, f"found {marriott_post} orders after churn date")

# ── V10 — Anomaly 3: Outdoor Furniture margin delta ≥ 8 ppt across 2025 ──────
margins_2025 = qa("""
    SELECT dd.quarter, AVG(fso.effective_gross_margin_pct)
    FROM fact_sales_order fso
    JOIN dim_date dd ON fso.order_date_id = dd.date_id
    WHERE fso.primary_item_category = 'Outdoor Furniture'
    AND dd.year = 2025
    GROUP BY dd.quarter
    ORDER BY dd.quarter
""")
margin_by_q = {r[0]: r[1] for r in margins_2025}
q1_margin   = margin_by_q.get(1, 0)
q4_margin   = margin_by_q.get(4, 0)
delta        = q1_margin - q4_margin
v10_ok = delta >= 8.0
check("V10",
      "Anomaly 3: Outdoor Furniture avg margin in Q4 2025 is ≥8 ppt below Q1 2025",
      v10_ok,
      f"Q1={q1_margin:.2f}%, Q4={q4_margin:.2f}%, Δ={delta:.2f} ppt (need ≥8)")

# ── V11 — West region has ≥35% of customers ──────────────────────────────────
west_pct = q("""
    SELECT SUM(CASE WHEN region = 'West' THEN 1.0 ELSE 0 END) / COUNT(*) * 100
    FROM dim_customer
""")[0]
check("V11", "West region has at least 35% of customers",
      west_pct >= 35.0, f"West = {west_pct:.1f}%")

# ── V12 — Customer segment counts ─────────────────────────────────────────────
seg_counts = {r[0]: r[1] for r in qa("""
    SELECT customer_segment, COUNT(*) FROM dim_customer GROUP BY customer_segment
""")}
v12_ok = (
    seg_counts.get("Enterprise", 0) == 30
    and seg_counts.get("Mid-Market", 0) == 60
    and seg_counts.get("SMB", 0) == 60
)
check("V12", "Customer segments: Enterprise=30, Mid-Market=60, SMB=60",
      v12_ok, f"actual: {seg_counts}")

# ── V13 — Revenue grows YoY ───────────────────────────────────────────────────
yr_rev = {r[0]: r[1] for r in qa("""
    SELECT dd.year, SUM(fi.invoice_amount)
    FROM fact_invoice fi
    JOIN dim_date dd ON fi.invoice_date_id = dd.date_id
    GROUP BY dd.year
    ORDER BY dd.year
""")}
v13_ok = yr_rev.get(2025, 0) > yr_rev.get(2024, 0) > yr_rev.get(2023, 0)
check("V13", "Revenue grows YoY: 2023 < 2024 < 2025",
      v13_ok,
      f"2023=${yr_rev.get(2023,0):,.0f}, 2024=${yr_rev.get(2024,0):,.0f}, 2025=${yr_rev.get(2025,0):,.0f}")

# ── V14 — No NULLs in PK columns ─────────────────────────────────────────────
PK_COLS = {
    "dim_date":         "date_id",
    "dim_location":     "location_id",
    "dim_employee":     "employee_id",
    "dim_item":         "item_id",
    "dim_customer":     "customer_id",
    "fact_sales_order": "order_id",
    "fact_invoice":     "invoice_id",
    "fact_payment":     "payment_id",
    "fact_gl_entry":    "gl_entry_id",
}
null_counts = []
for tbl, pk in PK_COLS.items():
    nulls = q(f"SELECT COUNT(*) FROM {tbl} WHERE {pk} IS NULL")[0]
    if nulls > 0:
        null_counts.append(f"{tbl}.{pk}={nulls} NULLs")
check("V14", "No NULL values in primary key columns of any table",
      len(null_counts) == 0, "; ".join(null_counts))

# ── V15 — Sample join returns valid output ────────────────────────────────────
sample = qa("""
    SELECT dc.customer_name, COUNT(*) AS order_count
    FROM fact_sales_order fso
    JOIN dim_customer dc ON fso.customer_id = dc.customer_id
    GROUP BY dc.customer_name
    ORDER BY order_count DESC
    LIMIT 5
""")
v15_ok = len(sample) == 5 and all(row[0] and row[1] > 0 for row in sample)
check("V15", "Sample join (fact_sales_order ⋈ dim_customer) returns 5 valid rows",
      v15_ok, f"returned {len(sample)} rows")
if v15_ok:
    print()
    print("  V15 sample (top 5 customers by order count):")
    for name, cnt in sample:
        print(f"    {name:<45} {cnt:>5} orders")

conn.close()

# ── Print results ──────────────────────────────────────────────────────────────
print()
for line in results:
    print(line)

total = passed + failed
print(f"\n{'='*60}")
if failed == 0:
    print(f"VERIFICATION RESULT: {total}/{total} PASSED")
else:
    print(f"VERIFICATION RESULT: {passed}/{total} PASSED — {failed} FAILED")
print(f"{'='*60}")

sys.exit(0 if failed == 0 else 1)
