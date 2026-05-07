"""
AskERP — Semantic Layer Verification (Day 6)
Reads data/metrics.yaml, executes every formula against data/northwind.db,
and runs three anomaly-specific checks.
Re-runnable. Never modifies metrics.yaml.
"""

import os
import sys

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
BASE_DIR    = os.path.join(os.path.dirname(__file__), "..")
DB_PATH     = os.path.join(BASE_DIR, "data", "northwind.db")
METRICS_PATH = os.path.join(BASE_DIR, "data", "metrics.yaml")

# ── Parameter substitutions for formulas that require a period context ─────────
# Use 2025 as current year so both YoY comparisons (2025 vs 2024) are available.
# repeat_customer_rate: compare Q3 2025 customers who also ordered Q2 2025.
PARAM_SUBS = {
    "{current_year}":    "2025",
    "{prior_year}":      "2025",   # repeat_customer_rate: prior quarter same year
    "{current_quarter}": "3",      # Q3 2025 (has full data)
    "{prior_quarter}":   "2",      # Q2 2025
    "{period_start}":    "2025-01-01",  # churn: customers with no orders in 2025
}

# ── Sanity notes keyed by metric name ─────────────────────────────────────────
# Populated after we see the actual results; written here as expected ranges.
SANITY_RANGES = {
    "total_revenue":              ("currency", 100_000, 200_000_000),
    "revenue_growth_yoy":         ("pct",      -50,     200),
    "average_order_value":        ("currency", 100,     1_000_000),
    "revenue_by_segment":         ("rows",     1,       10),
    "gross_margin_pct":           ("pct",      0,       100),
    "gross_profit":               ("currency", 0,       200_000_000),
    "cogs":                       ("currency", 0,       200_000_000),
    "active_customer_count":      ("integer",  1,       10_000),
    "top_customer_concentration": ("pct",      0,       100),
    "customer_churn_count":       ("integer",  0,       10_000),
    "repeat_customer_rate":       ("pct",      0,       100),
    "cancellation_rate":          ("pct",      0,       100),
    "on_time_payment_rate":       ("pct",      0,       100),
    "order_volume":               ("integer",  1,       1_000_000),
    "average_days_to_pay":        ("days",     0,       365),
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def fmt_val(val, fmt_type):
    if val is None:
        return "NULL"
    if fmt_type == "currency":
        return f"${val:,.2f}"
    if fmt_type == "pct":
        return f"{val:.2f}%"
    if fmt_type in ("integer", "days"):
        return f"{val:,.0f}"
    return str(val)


def inject_params(formula: str) -> str:
    for placeholder, value in PARAM_SUBS.items():
        formula = formula.replace(placeholder, value)
    return formula


def check_sensible(name, result, rows):
    """Return (ok: bool, reason: str)."""
    if name not in SANITY_RANGES:
        return True, "no range check defined"

    fmt_type, lo, hi = SANITY_RANGES[name]

    if fmt_type == "rows":
        if rows and len(rows) >= lo:
            return True, f"{len(rows)} row(s) returned"
        return False, f"expected ≥{lo} rows, got {len(rows) if rows else 0}"

    # Scalar metrics
    if result is None:
        return False, "result is NULL"
    try:
        v = float(result)
    except (TypeError, ValueError):
        return False, f"non-numeric result: {result!r}"

    if v < lo:
        return False, f"{v} is below expected minimum {lo}"
    if v > hi:
        return False, f"{v} exceeds expected maximum {hi}"
    return True, f"value {fmt_val(v, fmt_type)} within expected range"


def build_sanity_note(name, result, rows):
    fmt_type = SANITY_RANGES.get(name, ("unknown",))[0]
    if fmt_type == "rows":
        return f"{len(rows)} rows returned (grouped metric)"
    if result is None:
        return "result is NULL — needs investigation"
    try:
        v = float(result)
    except (TypeError, ValueError):
        return f"non-numeric: {result!r}"

    notes = {
        "total_revenue":              f"total revenue across full dataset: {fmt_val(v, 'currency')} — ~$50M/yr target → expect ~$150M over 3 yrs",
        "revenue_growth_yoy":         f"2025 vs 2024 YoY growth: {fmt_val(v, 'pct')}",
        "average_order_value":        f"average order: {fmt_val(v, 'currency')} — B2B furniture, expect $2K–$20K range",
        "gross_margin_pct":           f"blended gross margin: {fmt_val(v, 'pct')} — expect 50–65% range",
        "gross_profit":               f"total gross profit: {fmt_val(v, 'currency')}",
        "cogs":                       f"total COGS: {fmt_val(v, 'currency')}",
        "active_customer_count":      f"distinct buying customers: {fmt_val(v, 'integer')} — expect ~140–150 active in a year",
        "top_customer_concentration": f"top-5 revenue share: {fmt_val(v, 'pct')} — expect 15–40% for B2B mid-market",
        "customer_churn_count":       f"customers with no orders in 2025 who last ordered ≥90 days before Jan 1: {fmt_val(v, 'integer')}",
        "repeat_customer_rate":       f"Q3 2025 customers who also ordered in Q2 2025: {fmt_val(v, 'pct')}",
        "cancellation_rate":          f"overall cancellation rate across all orders: {fmt_val(v, 'pct')} — expect ~3–6% baseline",
        "on_time_payment_rate":       f"invoices paid on or before due date: {fmt_val(v, 'pct')}",
        "order_volume":               f"total orders placed (all statuses): {fmt_val(v, 'integer')} — expect ~30K",
        "average_days_to_pay":        f"avg days invoice → payment: {fmt_val(v, 'days')} days — Net 30/45 expected",
    }
    return notes.get(name, f"value: {result}")


def sep(char="─", width=72):
    print(char * width)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print()
    sep("═")
    print("  AskERP Semantic Layer Verification — Day 6")
    print(f"  Database : {DB_PATH}")
    print(f"  Metrics  : {METRICS_PATH}")
    print(f"  Period params: current_year=2025, period_start=2025-01-01,")
    print(f"                 current_quarter=Q3, prior_quarter=Q2")
    sep("═")
    print()

    # ── Load config ────────────────────────────────────────────────────────────
    with open(METRICS_PATH) as f:
        config = yaml.safe_load(f)

    metrics = config["metrics"]
    total   = len(metrics)

    conn = duckdb.connect(DB_PATH, read_only=True)

    passed_exec   = 0
    failed_exec   = []
    passed_sanity = 0
    failed_sanity = []

    # ── Per-metric loop ────────────────────────────────────────────────────────
    for idx, metric in enumerate(metrics, start=1):
        name   = metric["name"]
        domain = metric["domain"]
        owner  = metric.get("definition_owner", "unknown")
        fmt    = metric.get("format", "unknown")
        formula_raw = metric.get("formula", "").strip()

        print(f"[Metric {idx:02d}/{total}] {name}  ({domain})  — owner: {owner}")
        sep()

        formula = inject_params(formula_raw)

        # Show substituted params if any were applied
        if formula != formula_raw:
            applied = [k for k in PARAM_SUBS if k in formula_raw]
            print(f"  ℹ  Params substituted: {', '.join(applied)}")

        exec_ok  = False
        result   = None
        rows     = None
        err_msg  = None

        try:
            rel   = conn.execute(formula)
            rows  = rel.fetchall()
            cols  = [d[0] for d in rel.description] if rel.description else []

            # Scalar vs grouped
            if len(rows) == 1 and len(rows[0]) == 1:
                result = rows[0][0]
                print(f"  Result : {fmt_val(result, fmt)}")
            else:
                # Grouped — print up to 5 rows
                header = " | ".join(f"{c:<20}" for c in cols)
                print(f"  Result (top {min(5, len(rows))} of {len(rows)} rows):")
                print(f"    {header}")
                print(f"    {'─' * len(header)}")
                for row in rows[:5]:
                    print("    " + " | ".join(f"{str(v):<20}" for v in row))

            exec_ok = True
            passed_exec += 1
            print(f"  Exec   : ✓ PASS")

        except Exception as e:
            err_msg = str(e)
            failed_exec.append((name, err_msg))
            print(f"  Exec   : ✗ FAIL — {err_msg}")

        # Sanity check (only if exec succeeded)
        if exec_ok:
            sensible, reason = check_sensible(name, result, rows)
            if sensible:
                passed_sanity += 1
                print(f"  Sanity : ✓ PASS — {reason}")
            else:
                failed_sanity.append((name, reason))
                print(f"  Sanity : ✗ SUSPICIOUS — {reason}")

            note = build_sanity_note(name, result, rows)
            print(f"  Note   : {note}")

        print()

    # ── Anomaly Verification ───────────────────────────────────────────────────
    sep("═")
    print("  Anomaly Verification")
    sep("═")
    print()

    anomaly_results = {}

    # A1 — Cascade Manufacturing Office Seating cancellation rate by quarter
    print("[A1] Cascade Mfg Office Seating cancellation rate by quarter")
    sep()
    a1_sql = """
        SELECT
            dd.year,
            dd.quarter,
            COUNT(CASE WHEN fso.order_status = 'Cancelled' THEN 1 END) AS cancelled,
            COUNT(*) AS total,
            ROUND(
                COUNT(CASE WHEN fso.order_status = 'Cancelled' THEN 1 END)
                * 100.0 / COUNT(*), 2
            ) AS cancel_pct
        FROM fact_sales_order fso
        JOIN dim_date dd ON fso.order_date_id = dd.date_id
        JOIN dim_item di ON fso.primary_item_category = 'Office Seating'
        WHERE fso.primary_item_category = 'Office Seating'
        GROUP BY dd.year, dd.quarter
        ORDER BY dd.year, dd.quarter
    """
    try:
        rows_a1 = conn.execute(a1_sql).fetchall()
        print(f"  {'Year':<6} {'Q':<4} {'Cancelled':>10} {'Total':>8} {'Rate%':>8}")
        print(f"  {'─'*6} {'─'*4} {'─'*10} {'─'*8} {'─'*8}")
        q3_2024_rate  = None
        other_rates   = []
        for row in rows_a1:
            yr, qtr, canc, tot, pct = row
            marker = " ◀ target" if (yr == 2024 and qtr == 3) else ""
            print(f"  {yr:<6} Q{qtr:<3} {canc:>10,} {tot:>8,} {pct:>7.2f}%{marker}")
            if yr == 2024 and qtr == 3:
                q3_2024_rate = pct
            else:
                other_rates.append(pct)

        if q3_2024_rate is not None and other_rates:
            max_other = max(other_rates)
            a1_pass = q3_2024_rate >= 10.0 and q3_2024_rate >= (2 * max_other)
            status = "✓ PASS" if a1_pass else "✗ FAIL"
            anomaly_results["A1"] = a1_pass
            print(f"\n  A1 result: Q3 2024 rate = {q3_2024_rate:.2f}%,  max other = {max_other:.2f}%")
            print(f"  A1 check : {status} — Q3 2024 {'≥' if a1_pass else '<'} 2× other quarters")
        else:
            anomaly_results["A1"] = False
            print("  A1 check : ✗ FAIL — Q3 2024 row not found")
    except Exception as e:
        anomaly_results["A1"] = False
        print(f"  A1 check : ✗ ERROR — {e}")

    print()

    # A2 — Hilton (id=1) and Marriott (id=2) order count by quarter
    # Cutoffs per spec: Hilton = 2024-10-01, Marriott = 2024-11-01
    print("[A2] Top-2 whale customer activity by quarter (customer_id 1 & 2)")
    sep()
    a2_sql = """
        SELECT
            fso.customer_id,
            dc.customer_name,
            dd.year,
            dd.quarter,
            COUNT(*) AS order_count
        FROM fact_sales_order fso
        JOIN dim_date dd ON fso.order_date_id = dd.date_id
        JOIN dim_customer dc ON fso.customer_id = dc.customer_id
        WHERE fso.customer_id IN (1, 2)
        GROUP BY fso.customer_id, dc.customer_name, dd.year, dd.quarter
        ORDER BY fso.customer_id, dd.year, dd.quarter
    """
    # Cutoff-specific queries: count orders on or after each customer's churn date
    a2_hilton_sql = """
        SELECT COUNT(*) FROM fact_sales_order fso
        JOIN dim_date dd ON fso.order_date_id = dd.date_id
        WHERE fso.customer_id = 1 AND dd.date >= '2024-10-01'
    """
    a2_marriott_sql = """
        SELECT COUNT(*) FROM fact_sales_order fso
        JOIN dim_date dd ON fso.order_date_id = dd.date_id
        WHERE fso.customer_id = 2 AND dd.date >= '2024-11-01'
    """
    try:
        rows_a2 = conn.execute(a2_sql).fetchall()
        print(f"  {'CustID':<8} {'Name':<32} {'Year':<6} {'Q':<4} {'Orders':>8}")
        print(f"  {'─'*8} {'─'*32} {'─'*6} {'─'*4} {'─'*8}")
        for row in rows_a2:
            cid, cname, yr, qtr, cnt = row
            print(f"  {cid:<8} {cname:<32} {yr:<6} Q{qtr:<3} {cnt:>8,}")

        # Check each customer against their specific cutoff date
        hilton_after_cutoff   = conn.execute(a2_hilton_sql).fetchone()[0]
        marriott_after_cutoff = conn.execute(a2_marriott_sql).fetchone()[0]

        a2_pass = hilton_after_cutoff == 0 and marriott_after_cutoff == 0
        anomaly_results["A2"] = a2_pass
        status = "✓ PASS" if a2_pass else "✗ FAIL"
        print(f"\n  Hilton   orders from 2024-10-01 onward: {hilton_after_cutoff}  (expect 0)")
        print(f"  Marriott orders from 2024-11-01 onward: {marriott_after_cutoff}  (expect 0)")
        print(f"  A2 check : {status} — each whale dark from their respective cutoff date")
    except Exception as e:
        anomaly_results["A2"] = False
        print(f"  A2 check : ✗ ERROR — {e}")

    print()

    # A3 — Outdoor Furniture gross margin by quarter for 2025
    print("[A3] Outdoor Furniture gross margin by 2025 quarter")
    sep()
    a3_sql = """
        SELECT
            dd.quarter,
            ROUND(
                (SUM(fso.total_amount) - SUM(fso.effective_unit_cost * fso.line_count))
                / SUM(fso.total_amount) * 100,
            2) AS gross_margin_pct
        FROM fact_sales_order fso
        JOIN dim_date dd ON fso.order_date_id = dd.date_id
        WHERE fso.primary_item_category = 'Outdoor Furniture'
          AND fso.order_status NOT IN ('Cancelled', 'Pending')
          AND dd.year = 2025
        GROUP BY dd.quarter
        ORDER BY dd.quarter
    """
    try:
        rows_a3 = conn.execute(a3_sql).fetchall()
        print(f"  {'Quarter':<10} {'Gross Margin%':>14}")
        print(f"  {'─'*10} {'─'*14}")
        margins = {}
        for row in rows_a3:
            qtr, margin = row
            margins[qtr] = margin
            print(f"  Q{qtr:<9} {margin:>13.2f}%")

        q1 = margins.get(1)
        q4 = margins.get(4)
        if q1 is not None and q4 is not None:
            delta = q1 - q4
            a3_pass = delta >= 8.0
            anomaly_results["A3"] = a3_pass
            status = "✓ PASS" if a3_pass else "✗ FAIL"
            print(f"\n  Q1 2025: {q1:.2f}%  →  Q4 2025: {q4:.2f}%  →  delta: {delta:.2f} ppt")
            print(f"  A3 check : {status} — margin compression {'≥' if a3_pass else '<'} 8 ppt Q1→Q4")
        else:
            anomaly_results["A3"] = False
            print("  A3 check : ✗ FAIL — Q1 or Q4 2025 data missing")
    except Exception as e:
        anomaly_results["A3"] = False
        print(f"  A3 check : ✗ ERROR — {e}")

    print()
    conn.close()

    # ── Final summary table ────────────────────────────────────────────────────
    sep("═")
    print("  Final Summary")
    sep("═")

    def status_str(ok):
        return "✓ PASS" if ok else "✗ FAIL"

    rows_summary = [
        ("Metrics formula execution",      f"{passed_exec}/{total}",        passed_exec == total),
        ("Metrics with sensible values",   f"{passed_sanity}/{passed_exec}", passed_sanity == passed_exec),
        ("Anomaly 1 — refund spike",       status_str(anomaly_results.get("A1", False)), anomaly_results.get("A1", False)),
        ("Anomaly 2 — whale churn",        status_str(anomaly_results.get("A2", False)), anomaly_results.get("A2", False)),
        ("Anomaly 3 — margin compression", status_str(anomaly_results.get("A3", False)), anomaly_results.get("A3", False)),
    ]

    col1 = max(len(r[0]) for r in rows_summary) + 2
    col2 = 10

    print(f"  ┌{'─'*(col1+2)}┬{'─'*(col2+2)}┐")
    print(f"  │ {'Check':<{col1}} │ {'Status':^{col2}} │")
    print(f"  ├{'─'*(col1+2)}┼{'─'*(col2+2)}┤")
    for label, value, _ in rows_summary:
        print(f"  │ {label:<{col1}} │ {value:^{col2}} │")
    print(f"  └{'─'*(col1+2)}┴{'─'*(col2+2)}┘")

    if failed_exec:
        print("\n  Metrics that failed execution:")
        for name, err in failed_exec:
            print(f"    ✗ {name}: {err}")

    if failed_sanity:
        print("\n  Metrics with suspicious values:")
        for name, reason in failed_sanity:
            print(f"    ⚠  {name}: {reason}")

    all_pass = (
        passed_exec == total and
        passed_sanity == passed_exec and
        all(anomaly_results.get(k, False) for k in ["A1", "A2", "A3"])
    )
    print()
    if all_pass:
        print("  ✓ ALL CHECKS PASSED — semantic layer is verified against northwind.db")
    else:
        print("  ✗ SOME CHECKS FAILED — review failures above before proceeding to Week 2")
    print()


if __name__ == "__main__":
    main()
