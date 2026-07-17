"""
Benchmark Part C (D-036): hand-authored ground truth for the 36 answerable questions.
Executes every SQL against data/northwind.db and writes benchmark/ground_truth.json.
H-tier results are sanity-checked against the planted supplier->cash signal
(tier C/D suppliers are the culprits; gradients run A->D).
Run from repo root: python3 benchmark/build_ground_truth.py
"""
import json
import sys
import duckdb

S = "mro_distributor"

GT = {
    # ── Tier 1 (S) ──
    "S01": {"sql": f"SELECT ROUND(SUM(ext_amount),2) FROM {S}.o2c_sales_order_line"},
    "S02": {"sql": f"SELECT ROUND(SUM(days_to_pay*amount_applied)/SUM(amount_applied),2) FROM {S}.ar_payment_application"},
    "S03": {"sql": f"SELECT ROUND(SUM(days_to_pay*amount_paid)/SUM(amount_paid),2) FROM {S}.p2p_bill_payment"},
    "S04": {"sql": f"""
        SELECT ROUND(
          (SELECT AVG(dv) FROM (SELECT snapshot_date_key, SUM(value_on_hand) dv FROM {S}.inv_balance_snapshot GROUP BY 1))
          / (SELECT SUM(ext_cost)/COUNT(DISTINCT order_date_key) FROM {S}.o2c_sales_order_line), 2)"""},
    "S05": {"sql": f"""
        SELECT ROUND(dso.v + dio.v - dpo.v, 2) FROM
          (SELECT SUM(days_to_pay*amount_applied)/SUM(amount_applied) v FROM {S}.ar_payment_application) dso,
          (SELECT (SELECT AVG(dv) FROM (SELECT snapshot_date_key, SUM(value_on_hand) dv FROM {S}.inv_balance_snapshot GROUP BY 1))
                  / (SELECT SUM(ext_cost)/COUNT(DISTINCT order_date_key) FROM {S}.o2c_sales_order_line) v) dio,
          (SELECT SUM(days_to_pay*amount_paid)/SUM(amount_paid) v FROM {S}.p2p_bill_payment) dpo"""},
    "S06": {"sql": f"SELECT ROUND(SUM(margin_amount)/SUM(ext_amount)*100,2) FROM {S}.o2c_sales_order_line"},
    "S07": {"sql": f"SELECT ROUND(AVG(CASE WHEN is_stockout THEN 100.0 ELSE 0 END),2) FROM {S}.inv_balance_snapshot"},
    "S08": {"sql": f"""
        SELECT ROUND(SUM(value_on_hand),2) FROM {S}.inv_balance_snapshot
        WHERE snapshot_date_key = (SELECT MAX(snapshot_date_key) FROM {S}.inv_balance_snapshot)"""},
    "S09": {"sql": f"""
        SELECT ROUND(AVG(order_total),2) FROM (
          SELECT so_number, SUM(ext_amount) AS order_total FROM {S}.o2c_sales_order_line GROUP BY so_number)"""},
    "S10": {"sql": f"""
        SELECT ROUND((SELECT COUNT(*) FROM {S}.o2c_return_line) * 100.0
                     / (SELECT COUNT(*) FROM {S}.o2c_sales_order_line), 2)"""},

    # ── Tier 2 (M) ──
    "M01": {"sql": f"""
        SELECT d.year_num, d.month_num, ROUND(SUM(sol.ext_amount),2) AS revenue
        FROM {S}.o2c_sales_order_line sol JOIN {S}.dim_date d ON sol.order_date_key = d.date_key
        GROUP BY 1,2 ORDER BY 1,2"""},
    "M02": {"sql": f"""
        SELECT i.category, ROUND(SUM(sol.margin_amount)/SUM(sol.ext_amount)*100,2) AS gm_pct
        FROM {S}.o2c_sales_order_line sol JOIN {S}.dim_item i USING (item_key)
        GROUP BY 1 ORDER BY 2 DESC"""},
    "M03": {"sql": f"""
        SELECT s.supplier_name, ROUND(AVG(po.late_days),2) AS avg_late_days
        FROM {S}.p2p_purchase_order_line po JOIN {S}.dim_supplier s USING (supplier_key)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 5"""},
    "M04": {"sql": f"""
        SELECT s.reliability_tier, ROUND(COUNT(CASE WHEN po.late_days = 0 THEN 1 END)*100.0/COUNT(*),2) AS otd_pct
        FROM {S}.p2p_purchase_order_line po JOIN {S}.dim_supplier s USING (supplier_key)
        GROUP BY 1 ORDER BY 1"""},
    "M05": {"sql": f"""
        SELECT c.segment, ROUND(SUM(sol.ext_amount),2) AS revenue
        FROM {S}.o2c_sales_order_line sol JOIN {S}.dim_customer c USING (customer_key)
        GROUP BY 1 ORDER BY 2 DESC"""},
    "M06": {"sql": f"""
        SELECT w.warehouse_name, ROUND(SUM(snap.value_on_hand),2) AS inv_value
        FROM {S}.inv_balance_snapshot snap JOIN {S}.dim_warehouse w USING (warehouse_key)
        WHERE snap.snapshot_date_key = (SELECT MAX(snapshot_date_key) FROM {S}.inv_balance_snapshot)
        GROUP BY 1 ORDER BY 2 DESC"""},
    "M07": {"sql": f"""
        SELECT c.segment, ROUND(COUNT(CASE WHEN pa.payment_date_key > i.due_date_key THEN 1 END)*100.0/COUNT(*),2) AS overdue_pct
        FROM {S}.ar_invoice i
        JOIN {S}.ar_payment_application pa USING (invoice_key)
        JOIN {S}.dim_customer c ON i.customer_key = c.customer_key
        GROUP BY 1 ORDER BY 2 DESC"""},
    "M08": {"sql": f"""
        SELECT s.supplier_name, ROUND(SUM(po.ext_cost),2) AS spend
        FROM {S}.p2p_purchase_order_line po JOIN {S}.dim_supplier s USING (supplier_key)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10"""},
    "M09": {"sql": f"""
        SELECT d.year_num, d.month_num, ROUND(SUM(b.period_balance),2) AS gl_cogs
        FROM {S}.gl_account_balance b
        JOIN {S}.dim_gl_account a USING (gl_account_key)
        JOIN {S}.dim_date d ON b.period_date_key = d.date_key
        WHERE a.account_name = 'COGS' AND d.year_num = 2025
        GROUP BY 1,2 ORDER BY 1,2"""},
    "M10": {"sql": f"""
        WITH velocity AS (SELECT item_key, SUM(qty_shipped) units FROM {S}.o2c_fulfillment_line GROUP BY 1),
        cutoff AS (SELECT quantile_cont(units, 0.2) q FROM velocity)
        SELECT COUNT(DISTINCT snap.item_key) AS slow_mover_items, ROUND(SUM(snap.value_on_hand),2) AS tied_up_value
        FROM {S}.inv_balance_snapshot snap JOIN velocity v USING (item_key), cutoff
        WHERE snap.snapshot_date_key = (SELECT MAX(snapshot_date_key) FROM {S}.inv_balance_snapshot)
          AND v.units <= cutoff.q"""},
    "M11": {"sql": f"""
        SELECT c.segment, ROUND(AVG(pa.days_to_pay - c.credit_days),2) AS days_beyond_terms
        FROM {S}.ar_payment_application pa JOIN {S}.dim_customer c USING (customer_key)
        GROUP BY 1 ORDER BY 2 DESC"""},
    "M12": {"sql": f"""
        SELECT w.warehouse_name,
               ROUND(COUNT(CASE WHEN ff.ship_date_key IS NOT NULL AND ff.ship_date_key <= sol.promised_ship_date_key
                                 AND ff.qty_shipped >= sol.qty_ordered THEN 1 END)*100.0/COUNT(*),2) AS otif_pct
        FROM {S}.o2c_sales_order_line sol
        LEFT JOIN {S}.o2c_fulfillment_line ff USING (so_line_key)
        JOIN {S}.dim_warehouse w ON sol.warehouse_key = w.warehouse_key
        GROUP BY 1 ORDER BY 2"""},

    # ── Tier 3 (H) ── sanity-checked against the planted signal
    "H01": {"sanity": "top suppliers must be tier C/D", "sql": f"""
        WITH item_supplier AS (SELECT DISTINCT item_key, supplier_key FROM {S}.p2p_purchase_order_line),
        sup AS (SELECT s.supplier_key, s.supplier_name, s.reliability_tier, AVG(po.late_days) late
                FROM {S}.p2p_purchase_order_line po JOIN {S}.dim_supplier s USING (supplier_key) GROUP BY 1,2,3),
        rev AS (SELECT m.supplier_key, SUM(sol.ext_amount) affected_revenue
                FROM {S}.o2c_sales_order_line sol JOIN item_supplier m USING (item_key) GROUP BY 1)
        SELECT sup.supplier_name, sup.reliability_tier, ROUND(sup.late,1) AS avg_late_days,
               ROUND(rev.affected_revenue,2) AS affected_revenue
        FROM sup JOIN rev USING (supplier_key)
        WHERE sup.late > 5 ORDER BY rev.affected_revenue DESC LIMIT 5"""},
    "H02": {"sanity": "DIO must be the largest component", "sql": f"""
        SELECT 'DSO' AS component, ROUND((SELECT SUM(days_to_pay*amount_applied)/SUM(amount_applied) FROM {S}.ar_payment_application),2) AS days
        UNION ALL
        SELECT 'DIO', ROUND((SELECT (SELECT AVG(dv) FROM (SELECT snapshot_date_key, SUM(value_on_hand) dv FROM {S}.inv_balance_snapshot GROUP BY 1))
                             / (SELECT SUM(ext_cost)/COUNT(DISTINCT order_date_key) FROM {S}.o2c_sales_order_line)),2)
        UNION ALL
        SELECT 'DPO', ROUND((SELECT SUM(days_to_pay*amount_paid)/SUM(amount_paid) FROM {S}.p2p_bill_payment),2)"""},
    "H03": {"sanity": "listed suppliers are late (above-avg) yet paid faster than the 39d weighted average", "sql": f"""
        WITH sup_late AS (SELECT supplier_key, AVG(late_days) late FROM {S}.p2p_purchase_order_line GROUP BY 1),
        sup_pay AS (SELECT supplier_key, SUM(days_to_pay*amount_paid)/SUM(amount_paid) pay FROM {S}.p2p_bill_payment GROUP BY 1)
        SELECT s.supplier_name, s.reliability_tier, ROUND(l.late,1) AS avg_late_days, ROUND(p.pay,1) AS days_to_pay
        FROM sup_late l JOIN sup_pay p USING (supplier_key) JOIN {S}.dim_supplier s USING (supplier_key)
        WHERE l.late > (SELECT AVG(late_days) FROM {S}.p2p_purchase_order_line)
          AND p.pay < (SELECT SUM(days_to_pay*amount_paid)/SUM(amount_paid) FROM {S}.p2p_bill_payment)
        ORDER BY l.late DESC"""},
    "H04": {"sanity": "ranking driven by stockout x dio product", "sql": f"""
        WITH cat_inv AS (
          SELECT i.category, AVG(dv) avg_inv, AVG(so_pct) stockout_pct FROM (
            SELECT snap.item_key, snap.snapshot_date_key, SUM(snap.value_on_hand) dv,
                   AVG(CASE WHEN snap.is_stockout THEN 100.0 ELSE 0 END) so_pct
            FROM {S}.inv_balance_snapshot snap GROUP BY 1,2) x
          JOIN {S}.dim_item i USING (item_key) GROUP BY 1),
        cat_daily AS (
          SELECT i.category, SUM(dv)/COUNT(DISTINCT snapshot_date_key) daily_inv
          FROM (SELECT item_key, snapshot_date_key, SUM(value_on_hand) dv FROM {S}.inv_balance_snapshot GROUP BY 1,2) x
          JOIN {S}.dim_item i USING (item_key) GROUP BY 1),
        cat_cogs AS (
          SELECT i.category, SUM(sol.ext_cost)/COUNT(DISTINCT sol.order_date_key) daily_cogs
          FROM {S}.o2c_sales_order_line sol JOIN {S}.dim_item i USING (item_key) GROUP BY 1),
        cat_so AS (
          SELECT i.category, AVG(CASE WHEN snap.is_stockout THEN 100.0 ELSE 0 END) stockout_pct
          FROM {S}.inv_balance_snapshot snap JOIN {S}.dim_item i USING (item_key) GROUP BY 1)
        SELECT d.category, ROUND(d.daily_inv/c.daily_cogs,1) AS dio_days, ROUND(so.stockout_pct,2) AS stockout_pct
        FROM cat_daily d JOIN cat_cogs c USING (category) JOIN cat_so so USING (category)
        ORDER BY (d.daily_inv/c.daily_cogs) * so.stockout_pct DESC"""},
    "H05": {"sanity": "segment view: revenue + collection days", "sql": f"""
        WITH seg_rev AS (
          SELECT c.segment, SUM(sol.ext_amount) revenue
          FROM {S}.o2c_sales_order_line sol JOIN {S}.dim_customer c USING (customer_key) GROUP BY 1),
        seg_pay AS (
          SELECT c.segment, SUM(pa.days_to_pay*pa.amount_applied)/SUM(pa.amount_applied) dtp
          FROM {S}.ar_payment_application pa JOIN {S}.dim_customer c USING (customer_key) GROUP BY 1)
        SELECT r.segment, ROUND(r.revenue,2) AS revenue, ROUND(p.dtp,1) AS collection_days
        FROM seg_rev r JOIN seg_pay p USING (segment) ORDER BY r.revenue DESC"""},
    "H06": {"sanity": "subsidiary 1 carries all inventory (data quirk) so its CCC dominates via DIO", "sql": f"""
        WITH sub_dso AS (
          SELECT subsidiary_key, SUM(days_to_pay*amount_applied)/SUM(amount_applied) dso
          FROM {S}.ar_payment_application GROUP BY 1),
        sub_dpo AS (
          SELECT subsidiary_key, SUM(days_to_pay*amount_paid)/SUM(amount_paid) dpo
          FROM {S}.p2p_bill_payment GROUP BY 1),
        sub_inv AS (
          SELECT subsidiary_key, SUM(dv)/COUNT(DISTINCT snapshot_date_key) daily_inv FROM
            (SELECT subsidiary_key, snapshot_date_key, SUM(value_on_hand) dv FROM {S}.inv_balance_snapshot GROUP BY 1,2) x
          GROUP BY 1),
        sub_cogs AS (
          SELECT subsidiary_key, SUM(ext_cost)/COUNT(DISTINCT order_date_key) daily_cogs
          FROM {S}.o2c_sales_order_line GROUP BY 1)
        SELECT sub.subsidiary_name,
               ROUND(dso.dso,1) AS dso_days,
               ROUND(COALESCE(inv.daily_inv/cogs.daily_cogs, 0),1) AS dio_days,
               ROUND(dpo.dpo,1) AS dpo_days,
               ROUND(dso.dso + COALESCE(inv.daily_inv/cogs.daily_cogs, 0) - dpo.dpo,1) AS ccc_days
        FROM {S}.dim_subsidiary sub
        JOIN sub_dso dso USING (subsidiary_key)
        JOIN sub_dpo dpo USING (subsidiary_key)
        JOIN sub_cogs cogs USING (subsidiary_key)
        LEFT JOIN sub_inv inv USING (subsidiary_key)
        ORDER BY ccc_days DESC"""},
    "H07": {"sanity": "top suppliers must be tier C/D with elevated order-to-ship", "sql": f"""
        WITH item_supplier AS (SELECT DISTINCT item_key, supplier_key FROM {S}.p2p_purchase_order_line),
        sup_late AS (SELECT supplier_key, AVG(late_days) late FROM {S}.p2p_purchase_order_line GROUP BY 1),
        sup_ots AS (
          SELECT m.supplier_key, AVG(ff.order_to_ship_days) ots
          FROM {S}.o2c_fulfillment_line ff JOIN item_supplier m USING (item_key) GROUP BY 1)
        SELECT s.supplier_name, s.reliability_tier, ROUND(l.late,1) AS avg_late_days, ROUND(o.ots,1) AS avg_order_to_ship_days
        FROM sup_late l JOIN sup_ots o USING (supplier_key) JOIN {S}.dim_supplier s USING (supplier_key)
        WHERE l.late > 5 ORDER BY o.ots DESC LIMIT 10"""},
    "H08": {"sanity": "top pairs must be tier C/D sourced", "sql": f"""
        WITH pairs AS (SELECT supplier_key, item_key, AVG(late_days) late FROM {S}.p2p_purchase_order_line GROUP BY 1,2),
        item_so AS (SELECT item_key, AVG(CASE WHEN is_stockout THEN 100.0 ELSE 0 END) so_pct FROM {S}.inv_balance_snapshot GROUP BY 1),
        item_otif AS (
          SELECT sol.item_key,
                 COUNT(CASE WHEN ff.ship_date_key IS NOT NULL AND ff.ship_date_key <= sol.promised_ship_date_key
                             AND ff.qty_shipped >= sol.qty_ordered THEN 1 END)*100.0/COUNT(*) otif
          FROM {S}.o2c_sales_order_line sol LEFT JOIN {S}.o2c_fulfillment_line ff USING (so_line_key) GROUP BY 1)
        SELECT s.supplier_name, s.reliability_tier, i.sku, ROUND(p.late,1) AS avg_late_days,
               ROUND(so.so_pct,1) AS stockout_pct, ROUND(ot.otif,1) AS otif_pct
        FROM pairs p
        JOIN {S}.dim_supplier s USING (supplier_key)
        JOIN {S}.dim_item i USING (item_key)
        JOIN item_so so USING (item_key)
        JOIN item_otif ot USING (item_key)
        WHERE p.late > 5 AND ot.otif < 50
        ORDER BY so.so_pct DESC LIMIT 10"""},
    "H09": {"sanity": "delta ~5 days (D ots ~7.0 vs A ots ~2.0)", "sql": f"""
        WITH item_supplier AS (SELECT DISTINCT item_key, supplier_key FROM {S}.p2p_purchase_order_line),
        tier_ots AS (
          SELECT s.reliability_tier, AVG(ff.order_to_ship_days) ots, COUNT(*) ff_lines
          FROM {S}.o2c_fulfillment_line ff
          JOIN item_supplier m USING (item_key)
          JOIN {S}.dim_supplier s USING (supplier_key)
          GROUP BY 1)
        SELECT ROUND(d.ots - a.ots, 2) AS delay_days_eliminated_per_line, d.ff_lines AS affected_shipments
        FROM (SELECT * FROM tier_ots WHERE reliability_tier='D') d,
             (SELECT * FROM tier_ots WHERE reliability_tier='A') a"""},
    "H10": {"sanity": "top items must be tier C/D sourced", "sql": f"""
        WITH item_supplier AS (SELECT DISTINCT item_key, supplier_key FROM {S}.p2p_purchase_order_line),
        item_late AS (SELECT item_key, AVG(late_days) late FROM {S}.p2p_purchase_order_line GROUP BY 1),
        item_rev AS (SELECT item_key, SUM(ext_amount) revenue FROM {S}.o2c_sales_order_line GROUP BY 1),
        item_so AS (SELECT item_key, AVG(CASE WHEN is_stockout THEN 1.0 ELSE 0 END) so_rate FROM {S}.inv_balance_snapshot GROUP BY 1)
        SELECT i.sku, s.supplier_name, s.reliability_tier, ROUND(l.late,1) AS avg_late_days,
               ROUND(r.revenue,2) AS revenue, ROUND(so.so_rate*100,1) AS stockout_pct
        FROM item_late l
        JOIN item_rev r USING (item_key)
        JOIN item_so so USING (item_key)
        JOIN item_supplier m USING (item_key)
        JOIN {S}.dim_supplier s USING (supplier_key)
        JOIN {S}.dim_item i USING (item_key)
        ORDER BY l.late * r.revenue * so.so_rate DESC LIMIT 10"""},
    "H11": {"sanity": "expected finding: both groups suffer similarly (lateness is supplier-driven, not velocity-driven)", "sql": f"""
        WITH vel AS (SELECT item_key, SUM(qty_shipped) units FROM {S}.o2c_fulfillment_line GROUP BY 1),
        cut AS (SELECT quantile_cont(units,0.8) hi, quantile_cont(units,0.2) lo FROM vel),
        cls AS (SELECT v.item_key, CASE WHEN v.units >= cut.hi THEN 'fast' WHEN v.units <= cut.lo THEN 'slow' END grp FROM vel v, cut),
        item_supplier AS (SELECT DISTINCT item_key, supplier_key FROM {S}.p2p_purchase_order_line),
        grp_late AS (
          SELECT c.grp, AVG(po.late_days) late
          FROM {S}.p2p_purchase_order_line po JOIN cls c USING (item_key) WHERE c.grp IS NOT NULL GROUP BY 1),
        grp_ots AS (
          SELECT c.grp, AVG(ff.order_to_ship_days) ots
          FROM {S}.o2c_fulfillment_line ff JOIN cls c USING (item_key) WHERE c.grp IS NOT NULL GROUP BY 1),
        grp_so AS (
          SELECT c.grp, AVG(CASE WHEN snap.is_stockout THEN 100.0 ELSE 0 END) so_pct
          FROM {S}.inv_balance_snapshot snap JOIN cls c USING (item_key) WHERE c.grp IS NOT NULL GROUP BY 1)
        SELECT l.grp AS mover_group, ROUND(l.late,2) AS avg_supplier_late_days,
               ROUND(o.ots,2) AS avg_order_to_ship_days, ROUND(so.so_pct,2) AS stockout_pct
        FROM grp_late l JOIN grp_ots o USING (grp) JOIN grp_so so USING (grp) ORDER BY 1"""},
    "H12": {"sanity": "expected finding: stockouts are FLAT Q4 vs non-Q4 (generator does not demand-couple stockouts) — the correct answer is 'no material worsening'", "sql": f"""
        SELECT CASE WHEN d.month_num IN (10,11,12) THEN 'Q4' ELSE 'non-Q4' END AS period,
               ROUND(AVG(CASE WHEN snap.is_stockout THEN 100.0 ELSE 0 END),2) AS stockout_pct
        FROM {S}.inv_balance_snapshot snap JOIN {S}.dim_date d ON snap.snapshot_date_key = d.date_key
        GROUP BY 1 ORDER BY 1"""},
    "H13": {"sanity": "listed customers have above-average C/D revenue share AND above-average fulfillment days", "sql": f"""
        WITH item_supplier AS (SELECT DISTINCT item_key, supplier_key FROM {S}.p2p_purchase_order_line),
        cust_cd AS (
          SELECT sol.customer_key,
                 SUM(CASE WHEN s.reliability_tier IN ('C','D') THEN sol.ext_amount ELSE 0 END)*100.0/SUM(sol.ext_amount) cd_pct,
                 SUM(sol.ext_amount) revenue
          FROM {S}.o2c_sales_order_line sol
          JOIN item_supplier m USING (item_key)
          JOIN {S}.dim_supplier s USING (supplier_key)
          GROUP BY 1),
        cust_ots AS (SELECT customer_key, AVG(order_to_ship_days) ots FROM {S}.o2c_fulfillment_line GROUP BY 1)
        SELECT c.customer_name, ROUND(cd.cd_pct,1) AS pct_revenue_from_cd_suppliers,
               ROUND(o.ots,2) AS avg_fulfillment_days, ROUND(cd.revenue,2) AS revenue
        FROM cust_cd cd
        JOIN cust_ots o USING (customer_key)
        JOIN {S}.dim_customer c USING (customer_key)
        WHERE cd.cd_pct > (SELECT SUM(CASE WHEN s.reliability_tier IN ('C','D') THEN sol.ext_amount ELSE 0 END)*100.0/SUM(sol.ext_amount)
                           FROM {S}.o2c_sales_order_line sol JOIN item_supplier m USING (item_key) JOIN {S}.dim_supplier s USING (supplier_key))
          AND o.ots > (SELECT AVG(order_to_ship_days) FROM {S}.o2c_fulfillment_line)
        ORDER BY cd.revenue DESC LIMIT 10"""},
    "H14": {"sanity": "short_only and late_and_short must be 0% (generator ships full quantities) — honest data reality", "sql": f"""
        WITH j AS (
          SELECT sol.so_line_key, sol.qty_ordered, sol.promised_ship_date_key, ff.ship_date_key, ff.qty_shipped
          FROM {S}.o2c_sales_order_line sol LEFT JOIN {S}.o2c_fulfillment_line ff USING (so_line_key)),
        cat AS (
          SELECT CASE
            WHEN ship_date_key IS NULL THEN 'never_shipped'
            WHEN ship_date_key > promised_ship_date_key AND qty_shipped >= qty_ordered THEN 'late_only'
            WHEN ship_date_key <= promised_ship_date_key AND qty_shipped < qty_ordered THEN 'short_only'
            WHEN ship_date_key > promised_ship_date_key AND qty_shipped < qty_ordered THEN 'late_and_short'
            ELSE 'hit' END miss_type
          FROM j)
        SELECT miss_type, COUNT(*) AS lines,
               ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM cat WHERE miss_type != 'hit'),1) AS pct_of_misses
        FROM cat WHERE miss_type != 'hit' GROUP BY 1 ORDER BY 2 DESC"""},
}

con = duckdb.connect("data/northwind.db", read_only=True)
questions = {q["id"]: q for q in json.load(open("benchmark/questions.json"))["questions"]}

out, failures = {}, 0
for qid in sorted(GT):
    entry = GT[qid]
    try:
        rows = con.execute(entry["sql"]).fetchall()
        cols = [d[0] for d in con.description]
        result = [[float(c) if hasattr(c, "__float__") and not isinstance(c, (str, bool)) else c for c in r] for r in rows]
        out[qid] = {"question": questions[qid]["question"], "sql": entry["sql"].strip(),
                    "columns": cols, "result": result}
        if "sanity" in entry:
            out[qid]["sanity_note"] = entry["sanity"]
        head = "; ".join(", ".join(str(c) for c in r) for r in result[:3])
        print(f"{qid}: {len(result)} row(s) | {head[:130]}")
    except Exception as e:
        failures += 1
        print(f"{qid}: ERROR {e}")

con.close()

# H-tier sanity gate against the planted signal
print("\n=== H-tier sanity vs planted signal ===")
sane = True
h01_tiers = {r[1] for r in out["H01"]["result"]}
print(f"H01 top-5 tiers: {h01_tiers} (must be subset of C/D): {'OK' if h01_tiers <= {'C','D'} else 'VIOLATION'}")
sane &= h01_tiers <= {"C", "D"}
h02 = {r[0]: r[1] for r in out["H02"]["result"]}
print(f"H02 components: {h02} (DIO largest): {'OK' if h02['DIO'] == max(h02.values()) else 'VIOLATION'}")
sane &= h02["DIO"] == max(h02.values())
h07_tiers = {r[1] for r in out["H07"]["result"]}
print(f"H07 tiers: {h07_tiers} (subset of C/D): {'OK' if h07_tiers <= {'C','D'} else 'VIOLATION'}")
sane &= h07_tiers <= {"C", "D"}
h08_tiers = {r[1] for r in out["H08"]["result"]}
print(f"H08 pair tiers: {h08_tiers} (subset of C/D): {'OK' if h08_tiers <= {'C','D'} else 'VIOLATION'}")
sane &= h08_tiers <= {"C", "D"}
h09 = out["H09"]["result"][0]
print(f"H09 delay eliminated: {h09[0]}d on {h09[1]:,.0f} shipments (expect ~5d): {'OK' if 4 <= h09[0] <= 6 else 'VIOLATION'}")
sane &= 4 <= h09[0] <= 6
h10_tiers = {r[2] for r in out["H10"]["result"]}
print(f"H10 tiers: {h10_tiers} (subset of C/D): {'OK' if h10_tiers <= {'C','D'} else 'VIOLATION'}")
sane &= h10_tiers <= {"C", "D"}
h12 = {r[0]: r[1] for r in out["H12"]["result"]}
h12_flat = abs(h12["Q4"] - h12["non-Q4"]) < 0.5
print(f"H12 stockout Q4 {h12['Q4']}% vs non-Q4 {h12['non-Q4']}% (expect flat): {'OK' if h12_flat else 'VIOLATION'}")
sane &= h12_flat
h14_types = {r[0] for r in out["H14"]["result"]}
h14_ok = "short_only" not in h14_types and "late_and_short" not in h14_types
print(f"H14 miss types: {h14_types} (no short buckets, data ships full): {'OK' if h14_ok else 'VIOLATION'}")
sane &= h14_ok

json.dump(out, open("benchmark/ground_truth.json", "w"), indent=1)
print(f"\nground_truth.json written: {len(out)}/36 questions, {failures} SQL failures, sanity {'PASS' if sane else 'FAIL'}")
sys.exit(0 if failures == 0 and sane and len(out) == 36 else 1)
