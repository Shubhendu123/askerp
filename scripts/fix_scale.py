"""
AskERP — Warehouse scale fix
Reduces all monetary values by 20x to match the ~$50M/yr Northwind persona.
Operates directly on data/northwind.db. Reversible: rerun load_warehouse.py to restore.
"""

import os
import sys

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb not installed.")
    sys.exit(1)

BASE_DIR = os.path.join(os.path.dirname(__file__), "..")
DB_PATH  = os.path.join(BASE_DIR, "data", "northwind.db")

UPDATES = [
    ("fact_sales_order", "UPDATE fact_sales_order SET total_amount = total_amount / 20.0"),
    ("fact_invoice",     "UPDATE fact_invoice SET invoice_amount = invoice_amount / 20.0, tax_amount = tax_amount / 20.0"),
    ("fact_payment",     "UPDATE fact_payment SET payment_amount = payment_amount / 20.0"),
    ("fact_gl_entry",    "UPDATE fact_gl_entry SET debit_amount = debit_amount / 20.0, credit_amount = credit_amount / 20.0"),
]

def main():
    print(f"Connecting to {DB_PATH}")
    conn = duckdb.connect(DB_PATH)

    print("\nApplying 20x scale reduction to monetary columns...\n")

    conn.execute("BEGIN TRANSACTION;")
    try:
        for table, sql in UPDATES:
            conn.execute(sql)
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  [✓] {table}: {count:,} rows updated")

        conn.execute("COMMIT;")
    except Exception as e:
        conn.execute("ROLLBACK;")
        print(f"\n[✗] ERROR: {e} — rolled back")
        conn.close()
        sys.exit(1)

    # ── Verification ───────────────────────────────────────────────────────────
    print("\nPost-fix verification:")
    total_revenue = conn.execute("""
        SELECT SUM(total_amount)
        FROM fact_sales_order
        WHERE order_status NOT IN ('Cancelled', 'Pending')
    """).fetchone()[0]

    print(f"  Total revenue (all years, non-cancelled): ${total_revenue:,.2f}")

    by_year = conn.execute("""
        SELECT dd.year, SUM(fso.total_amount) AS rev
        FROM fact_sales_order fso
        JOIN dim_date dd ON fso.order_date_id = dd.date_id
        WHERE fso.order_status NOT IN ('Cancelled', 'Pending')
        GROUP BY dd.year
        ORDER BY dd.year
    """).fetchall()

    print()
    for year, rev in by_year:
        flag = "  ✓" if 30_000_000 <= rev <= 100_000_000 else "  ⚠ outside $30M–$100M target"
        print(f"  {year}: ${rev:,.2f}{flag}")

    target_ok = 100_000_000 <= total_revenue <= 200_000_000
    print(f"\n  Total in $100M–$200M range: {'✓ PASS' if target_ok else '✗ FAIL — check values above'}")

    conn.close()

if __name__ == "__main__":
    main()
