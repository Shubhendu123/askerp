"""
AskERP — MRO Distributor warehouse verification (acceptance criteria + killer-query gate).
Run from repo root: python3 db_rebuild/verify_mro.py
Read-only. Exits non-zero if any criterion fails.
"""
import sys
import duckdb

con = duckdb.connect("data/northwind.db", read_only=True)
S = "mro_distributor"
results = []  # (metric, target, actual, ok)


def check(metric, target, actual, ok):
    results.append((metric, target, actual, ok))


# --- 1. table count ---
n_tables = con.execute(
    f"select count(*) from information_schema.tables where table_schema='{S}'"
).fetchone()[0]
check("Total tables", "20", str(n_tables), n_tables == 20)

# --- 2. total rows ---
tables = [r[0] for r in con.execute(
    f"select table_name from information_schema.tables where table_schema='{S}'"
).fetchall()]
counts = {t: con.execute(f"select count(*) from {S}.{t}").fetchone()[0] for t in tables}
total_rows = sum(counts.values())
check("Total rows", ">1.5M", f"{total_rows:,}", total_rows > 1_500_000)

# --- 3. annualized revenue (18 months of data) ---
rev = con.execute(f"select sum(ext_amount) from {S}.o2c_sales_order_line").fetchone()[0]
ann_rev = float(rev) * 12 / 18
check("Annualized revenue", "$250-500M", f"${ann_rev/1e6:.0f}M", 250e6 <= ann_rev <= 500e6)

# --- 4. DSO (amount-weighted avg days_to_pay on AR) ---
dso = con.execute(
    f"select sum(days_to_pay*amount_applied)/sum(amount_applied) from {S}.ar_payment_application"
).fetchone()[0]
check("DSO", "40-50d", f"{dso:.0f}d", 40 <= dso <= 50)

# --- 5. DPO ---
dpo = con.execute(
    f"select sum(days_to_pay*amount_paid)/sum(amount_paid) from {S}.p2p_bill_payment"
).fetchone()[0]
check("DPO", "35-45d", f"{dpo:.0f}d", 35 <= dpo <= 45)

# --- 6. DIO = avg daily inventory value / annual COGS * 365 ---
avg_inv = con.execute(f"""
    select avg(daily_value) from (
      select snapshot_date_key, sum(value_on_hand) as daily_value
      from {S}.inv_balance_snapshot group by 1)
""").fetchone()[0]
cogs = con.execute(f"select sum(ext_cost) from {S}.o2c_sales_order_line").fetchone()[0]
ann_cogs = float(cogs) * 12 / 18
dio = float(avg_inv) / ann_cogs * 365
check("DIO", "70-90d", f"{dio:.0f}d", 70 <= dio <= 90)

# --- 7. CCC ---
ccc = float(dso) + dio - float(dpo)
check("CCC (DSO+DIO-DPO)", "70-90d", f"{ccc:.0f}d", 70 <= ccc <= 91)

# --- 8. supplier Pareto: top 20% of suppliers by spend ---
supp_pareto = con.execute(f"""
    with spend as (
      select supplier_key, sum(ext_cost) s from {S}.p2p_purchase_order_line group by 1),
    ranked as (
      select s, row_number() over (order by s desc) rn, count(*) over () n, sum(s) over () tot
      from spend)
    select sum(s)/max(tot) from ranked where rn <= ceil(n*0.2)
""").fetchone()[0]
check("Supplier Pareto (top 20% spend)", "70-80%", f"{supp_pareto*100:.0f}%", 0.70 <= supp_pareto <= 0.80)

# --- 9. customer Pareto: top 20% of customers by revenue ---
cust_pareto = con.execute(f"""
    with rev as (
      select customer_key, sum(ext_amount) s from {S}.o2c_sales_order_line group by 1),
    ranked as (
      select s, row_number() over (order by s desc) rn, count(*) over () n, sum(s) over () tot
      from rev)
    select sum(s)/max(tot) from ranked where rn <= ceil(n*0.2)
""").fetchone()[0]
check("Customer Pareto (top 20% revenue)", "60-65%", f"{cust_pareto*100:.0f}%", 0.60 <= cust_pareto <= 0.65)

# --- 10. category gross margins (differentiated, low->high) ---
cat_gm = con.execute(f"""
    select i.category, sum(o.margin_amount)/sum(o.ext_amount) gm
    from {S}.o2c_sales_order_line o join {S}.dim_item i using (item_key)
    group by 1 order by gm
""").fetchall()
gm_str = ", ".join(f"{c} {g*100:.0f}%" for c, g in cat_gm)
gm_vals = [g for _, g in cat_gm]
differentiated = (gm_vals[-1] - gm_vals[0]) > 0.10 and cat_gm[0][0] == "Fasteners" and cat_gm[-1][0] == "MRO"
check("Category gross margins", "differentiated 22%->43%", gm_str, differentiated)

# --- 11. slow-payer vs on-time DSO separation ---
slow_split = con.execute(f"""
    with cust_pay as (
      select p.customer_key,
             sum(p.days_to_pay*p.amount_applied)/sum(p.amount_applied) dtp,
             max(c.credit_days) cd
      from {S}.ar_payment_application p join {S}.dim_customer c using (customer_key)
      group by 1)
    select case when dtp - cd > 12 then 'slow' else 'on-time' end grp,
           sum(dtp)/count(*), count(*)
    from cust_pay group by 1 order by 1
""").fetchall()
d = {g: (v, n) for g, v, n in slow_split}
slow_d, ontime_d = d.get("slow", (0, 0))[0], d.get("on-time", (0, 0))[0]
check("Slow vs on-time payer DSO", "clearly separated (~66d vs ~41d)",
      f"slow {slow_d:.0f}d (n={d.get('slow',(0,0))[1]}) vs on-time {ontime_d:.0f}d (n={d.get('on-time',(0,0))[1]})",
      slow_d - ontime_d >= 15)

# --- 12. KILLER QUERY: P2P + INV + O2C + AR through conformed dims, by reliability tier ---
killer = con.execute(f"""
    with item_supplier as (
      select distinct item_key, supplier_key from {S}.p2p_purchase_order_line),
    p2p as (
      select s.reliability_tier tier, avg(po.late_days) late_days
      from {S}.p2p_purchase_order_line po join {S}.dim_supplier s using (supplier_key)
      group by 1),
    inv as (
      select s.reliability_tier tier, avg(case when snap.is_stockout then 1.0 else 0 end) stockout_rate
      from {S}.inv_balance_snapshot snap
      join item_supplier m using (item_key)
      join {S}.dim_supplier s using (supplier_key)
      group by 1),
    o2c as (
      select s.reliability_tier tier, avg(f.order_to_ship_days) order_to_ship
      from {S}.o2c_fulfillment_line f
      join item_supplier m using (item_key)
      join {S}.dim_supplier s using (supplier_key)
      group by 1),
    ar as (
      select s.reliability_tier tier,
             sum(p.days_to_pay*p.amount_applied)/sum(p.amount_applied) days_to_collect
      from {S}.ar_invoice i
      join {S}.o2c_fulfillment_line f
        on i.customer_key = f.customer_key and i.invoice_date_key = f.ship_date_key
      join item_supplier m on f.item_key = m.item_key
      join {S}.dim_supplier s using (supplier_key)
      join {S}.ar_payment_application p using (invoice_key)
      group by 1)
    select p2p.tier, p2p.late_days, inv.stockout_rate, o2c.order_to_ship, ar.days_to_collect
    from p2p join inv using (tier) join o2c using (tier) join ar using (tier)
    order by tier
""").fetchall()

print("\n=== Killer query: supplier reliability tier -> operational/cash gradient ===")
print(f"{'tier':<5}{'late_days':>10}{'stockout%':>11}{'ord2ship_d':>12}{'days_to_collect':>17}")
for t, ld, so, ots, dtc in killer:
    print(f"{t:<5}{ld:>10.1f}{so*100:>10.1f}%{ots:>12.1f}{dtc:>17.1f}")

lates = [r[1] for r in killer]
stockouts = [r[2] for r in killer]
ots_vals = [r[3] for r in killer]
monotonic = (
    len(killer) == 4
    and all(lates[i] < lates[i+1] for i in range(3))
    and all(stockouts[i] < stockouts[i+1] for i in range(3))
    and all(ots_vals[i] < ots_vals[i+1] for i in range(3))
)
check("Killer-query gradient (A->D monotonic)",
      "late 0.1->15, stockout 3%->13%, ots 2->7",
      f"late {lates[0]:.1f}->{lates[-1]:.1f}, stockout {stockouts[0]*100:.0f}%->{stockouts[-1]*100:.0f}%, ots {ots_vals[0]:.1f}->{ots_vals[-1]:.1f}",
      monotonic)

# --- Northwind integrity ---
nw = con.execute(
    "select table_name from information_schema.tables where table_schema='main' order by 1"
).fetchall()
nw_counts = {t: con.execute(f"select count(*) from main.{t}").fetchone()[0] for (t,) in nw}
print("\n=== Northwind (main schema) integrity ===")
for t, c in nw_counts.items():
    print(f"{t:<20}{c:>8,}")

print("\n=== Per-table row counts (mro_distributor) ===")
for t in sorted(counts):
    print(f"{t:<28}{counts[t]:>12,}")

print("\n=== Acceptance criteria ===")
print(f"{'Metric':<38}{'Target':<28}{'Actual':<45}{'PASS':<6}")
all_ok = True
for m, tgt, act, ok in results:
    all_ok &= ok
    print(f"{m:<38}{tgt:<28}{act:<45}{'PASS' if ok else 'FAIL':<6}")

con.close()
print("\nRESULT:", "ALL PASS" if all_ok else "FAILURES PRESENT")
sys.exit(0 if all_ok else 1)
