"""
AskERP — Warehouse loader
Reads data/schema.yaml + data/raw/*.csv → creates data/northwind.db
Idempotent: safe to rerun. Driven entirely by schema.yaml.
"""

import os
import sys
import time
import datetime
import subprocess

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb not installed. Run: pip install duckdb pyyaml")
    sys.exit(1)

try:
    import yaml
except ImportError:
    print("ERROR: pyyaml not installed. Run: pip install duckdb pyyaml")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.join(os.path.dirname(__file__), "..")
RAW_DIR    = os.path.join(BASE_DIR, "data", "raw")
DB_PATH    = os.path.join(BASE_DIR, "data", "northwind.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "data", "schema.yaml")
AUDIT_LOG  = os.path.join(BASE_DIR, "data", "load_audit.log")

# ── Type mapping ───────────────────────────────────────────────────────────────
TYPE_MAP = {
    "VARCHAR": "VARCHAR",
    "INTEGER": "INTEGER",
    "DECIMAL": "DECIMAL(18,2)",
    "DATE":    "DATE",
    "BOOLEAN": "BOOLEAN",
}

# ── FK-respecting load order ───────────────────────────────────────────────────
LOAD_ORDER = [
    "dim_date",
    "dim_location",
    "dim_employee",
    "dim_item",
    "dim_customer",
    "fact_sales_order",
    "fact_invoice",
    "fact_payment",
    "fact_gl_entry",
]

# ── Indexes to build after load ────────────────────────────────────────────────
INDEXES = [
    ("idx_fso_date",     "fact_sales_order", "order_date_id"),
    ("idx_fso_cust",     "fact_sales_order", "customer_id"),
    ("idx_fso_emp",      "fact_sales_order", "employee_id"),
    ("idx_inv_date",     "fact_invoice",     "invoice_date_id"),
    ("idx_inv_cust",     "fact_invoice",     "customer_id"),
    ("idx_inv_status",   "fact_invoice",     "status"),
    ("idx_pay_date",     "fact_payment",     "payment_date_id"),
    ("idx_pay_cust",     "fact_payment",     "customer_id"),
    ("idx_gl_date",      "fact_gl_entry",    "posting_date_id"),
    ("idx_gl_acct",      "fact_gl_entry",    "account_code"),
]


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=BASE_DIR, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return "unknown"


def build_ddl(table_def: dict) -> str:
    """Generate CREATE TABLE SQL from a schema.yaml table definition."""
    name = table_def["name"]
    col_defs = []
    fk_defs  = []

    for col in table_def["columns"]:
        col_name = col["name"]
        col_type = TYPE_MAP.get(col.get("type", "VARCHAR"), "VARCHAR")
        is_pk    = col.get("primary_key", False)
        nullable = col.get("nullable", True)
        fk       = col.get("foreign_key")

        defn = f"    {col_name} {col_type}"
        if is_pk:
            defn += " PRIMARY KEY"
        elif not nullable:
            defn += " NOT NULL"
        col_defs.append(defn)

        if fk:
            ref_table, ref_col = fk.split(".")
            # Documented as comments — DuckDB 1.4+ enforces FK constraints at
            # insert time which breaks self-referencing tables (dim_employee) and
            # load ordering. Validation is done explicitly in verify_warehouse.py.
            fk_defs.append(
                f"    -- FK: {col_name} → {ref_table}.{ref_col}"
            )

    all_defs = col_defs + fk_defs
    return f"CREATE TABLE {name} (\n" + ",\n".join(all_defs) + "\n);"


def build_insert_sql(table_def: dict, csv_path: str) -> str:
    """
    Generate INSERT ... SELECT from read_csv().
    Boolean columns need explicit casts because Python writes 'True'/'False'.
    """
    bool_cols = {c["name"] for c in table_def["columns"] if c.get("type") == "BOOLEAN"}
    col_exprs = []
    for col in table_def["columns"]:
        n = col["name"]
        if n in bool_cols:
            col_exprs.append(f"CAST({n} AS BOOLEAN) AS {n}")
        else:
            col_exprs.append(n)

    safe_path = csv_path.replace("'", "''")
    return (
        f"INSERT INTO {table_def['name']}\n"
        f"SELECT {', '.join(col_exprs)}\n"
        f"FROM read_csv('{safe_path}', header=true, nullstr='');"
    )


def main():
    run_start = time.time()

    # ── Load schema ────────────────────────────────────────────────────────────
    with open(SCHEMA_PATH) as f:
        schema = yaml.safe_load(f)

    table_defs = {t["name"]: t for t in schema["tables"]}

    # ── Connect ────────────────────────────────────────────────────────────────
    if os.path.exists(DB_PATH):
        print("Existing warehouse found. Dropping all tables for clean reload.")
        conn = duckdb.connect(DB_PATH)
        # Drop in reverse FK order
        for tname in reversed(LOAD_ORDER):
            try:
                conn.execute(f"DROP TABLE IF EXISTS {tname} CASCADE;")
            except Exception:
                pass
        conn.close()
        os.remove(DB_PATH)

    conn = duckdb.connect(DB_PATH)

    results  = []
    total_rows = 0

    try:
        conn.execute("BEGIN TRANSACTION;")

        # ── Create tables ──────────────────────────────────────────────────────
        for tname in LOAD_ORDER:
            if tname not in table_defs:
                print(f"  [!] WARNING: {tname} not found in schema.yaml — skipping")
                continue

            tdef = table_defs[tname]
            ddl  = build_ddl(tdef)
            conn.execute(ddl)

        # ── Load CSVs ──────────────────────────────────────────────────────────
        for tname in LOAD_ORDER:
            if tname not in table_defs:
                continue

            tdef     = table_defs[tname]
            csv_path = os.path.join(RAW_DIR, f"{tname}.csv")

            if not os.path.exists(csv_path):
                print(f"  [!] WARNING: {csv_path} not found — skipping {tname}")
                continue

            t0  = time.time()
            sql = build_insert_sql(tdef, csv_path)

            try:
                conn.execute(sql)
            except Exception as e:
                conn.execute("ROLLBACK;")
                print(f"\n[✗] ERROR loading {tname}: {e}")
                print(f"    SQL: {sql[:200]}")
                conn.close()
                sys.exit(1)

            row_count = conn.execute(f"SELECT COUNT(*) FROM {tname};").fetchone()[0]
            elapsed   = time.time() - t0
            total_rows += row_count
            results.append((tname, row_count, elapsed))
            print(f"  [✓] {tname}: {row_count:,} rows loaded in {elapsed:.3f}s")

        conn.execute("COMMIT;")

        # ── Build indexes ──────────────────────────────────────────────────────
        print("\nBuilding indexes...")
        for idx_name, tbl, col in INDEXES:
            try:
                conn.execute(f"CREATE INDEX {idx_name} ON {tbl}({col});")
                print(f"  [✓] {idx_name} on {tbl}({col})")
            except Exception as e:
                print(f"  [!] {idx_name}: {e}")

    except Exception as e:
        try:
            conn.execute("ROLLBACK;")
        except Exception:
            pass
        print(f"\n[✗] FATAL: {e}")
        conn.close()
        sys.exit(1)

    conn.close()

    # ── Summary table ──────────────────────────────────────────────────────────
    run_elapsed = time.time() - run_start
    col1 = max(len(r[0]) for r in results) + 2
    print(f"\n{'─'*(col1+22)}")
    print(f"{'Table':<{col1}} {'Rows':>10}   {'Load Time':>10}")
    print(f"{'─'*(col1+22)}")
    for tname, rows, t in results:
        print(f"{tname:<{col1}} {rows:>10,}   {t:>9.3f}s")
    print(f"{'─'*(col1+22)}")
    print(f"{'TOTAL':<{col1}} {total_rows:>10,}   {run_elapsed:>9.3f}s")

    # ── Audit log ──────────────────────────────────────────────────────────────
    sha  = git_sha()
    ts   = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = (
        f"{ts} | LOAD COMPLETE | {len(results)} tables | "
        f"{total_rows:,} total rows | {run_elapsed:.2f}s | git_sha={sha}\n"
    )
    with open(AUDIT_LOG, "a") as f:
        f.write(line)
    print(f"\nAudit log → {AUDIT_LOG}")
    print(f"Warehouse → {DB_PATH}")


if __name__ == "__main__":
    main()
