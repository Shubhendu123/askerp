"""
AskERP D-044 - reusable verification suite for the harborline tenant.
  python3 harborline/verify_harborline.py            # local data/northwind.db (read-only)
  python3 harborline/verify_harborline.py --cloud    # run the same checks on MotherDuck + local-vs-cloud parity (#12)
Prints the acceptance table (12 checks) and the three killer-query gates. Never prints the token.
"""
import os, sys, json
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parent
CLOUD = "--cloud" in sys.argv
if CLOUD:
    tok = os.environ.get("MOTHERDUCK_TOKEN")
    if not tok: raise SystemExit("MOTHERDUCK_TOKEN not set in the environment (source .env.local first)")
    os.environ.setdefault("motherduck_token", tok)
    con = duckdb.connect("md:askerp")
else:
    con = duckdb.connect(str(ROOT.parent / "data" / "northwind.db"), read_only=True)
S = "harborline"
from decimal import Decimal
def _f(v): return float(v) if isinstance(v, Decimal) else v
def q(sql): return [tuple(_f(v) for v in r) for r in con.execute(sql).fetchall()]
def one(sql): return q(sql)[0][0]
def show(title, sql, hdr=None):
    print(f"\n  {title}")
    rows = q(sql); cols = [d[0] for d in con.description]
    w = [max(len(str(c)), *(len(f"{r[i]:,.2f}" if isinstance(r[i], float) else str(r[i])) for r in rows)) if rows else len(str(c)) for i, c in enumerate(cols)]
    print("    " + "  ".join(str(c).ljust(w[i]) for i, c in enumerate(cols)))
    for r in rows: print("    " + "  ".join((f"{v:,.2f}" if isinstance(v, float) else str(v)).ljust(w[i]) for i, v in enumerate(r)))
    return rows

results = []
def check(n, name, target, value, ok):
    results.append((n, name, target, value, ok))

# 1 tables
nt = one(f"select count(*) from information_schema.tables where table_schema='{S}'")
check(1, "Tables in harborline", "17 (7 dims + 10 facts; prompt's '16' was a spec error)", str(nt), nt == 17)
# 2 rows
tot = sum(one(f"select count(*) from {S}.{t}") for (t,) in q(f"select table_name from information_schema.tables where table_schema='{S}'"))
check(2, "Total rows", "1.5M-2.2M", f"{tot:,}", 1.5e6 <= tot <= 2.2e6)
# 3 existing tenants
base = json.load(open(ROOT / "baseline_counts.json"))
diff = []
for k, v in base.items():
    sc, t = k.split(".")
    if one(f'select count(*) from {sc}."{t}"') != v: diff.append(k)
nm = sum(1 for k in base if k.startswith("main.")); nmro = sum(1 for k in base if k.startswith("mro_distributor."))
check(3, "Existing tenants unchanged", f"Northwind {nm} + MRO {nmro} tables identical", f"{len(base)-len(diff)}/{len(base)} identical", not diff)
# 4 AUC
auc = one(f"select sum(market_value_usd) from {S}.pos_daily_position where position_date_key=(select max(position_date_key) from {S}.pos_daily_position)")
check(4, "Assets under custody (latest)", "$600B-$1T", f"${auc/1e9:,.1f}B", 600e9 <= auc <= 1e12)
# 5 overall fail rate
FR = f"select 100.0*count(*) filter (where settlement_status='FAILED')/count(*) from {S}.stl_trade_instruction where settlement_status in ('SETTLED','FAILED')"
fr = one(FR)
check(5, "Overall settlement fail rate", "3%-4.5%", f"{fr:.2f}%", 3 <= fr <= 4.5)
# 6 by tier
tr = q(f"""select c.reliability_tier, 100.0*count(*) filter (where i.settlement_status='FAILED')/count(*) from {S}.stl_trade_instruction i
           join {S}.dim_counterparty c using(counterparty_key) where i.settlement_status in ('SETTLED','FAILED') group by 1 order by 1""")
rt = [r[1] for r in tr]
check(6, "Fail rate by counterparty tier", "A<B<C<D, A-vs-D gap >=10pts", " / ".join(f"{r[0]}={r[1]:.1f}%" for r in tr), rt == sorted(rt) and rt[-1] - rt[0] >= 10)
# 7 by type
ty = dict(q(f"""select s.security_type, 100.0*count(*) filter (where i.settlement_status='FAILED')/count(*) from {S}.stl_trade_instruction i
            join {S}.dim_security s using(security_key) where i.settlement_status in ('SETTLED','FAILED') group by 1"""))
check(7, "Fail rate by security type", "CORP_BOND > EQUITY > GOVT_BOND", " / ".join(f"{k}={ty[k]:.1f}%" for k in ("CORP_BOND", "EQUITY", "ETF", "GOVT_BOND")),
      ty["CORP_BOND"] > ty["EQUITY"] > ty["GOVT_BOND"])
# 8 NONE-regime penalties
np_ = one(f"select count(*) from {S}.stl_fail_penalty p join {S}.dim_market m using(market_key) where m.penalty_regime='NONE'")
check(8, "Penalties in NONE-regime markets", "exactly 0", str(np_), np_ == 0)
# 9 miss rate by window
mw = q(f"""select case when e.notice_window_days<=2 then '<=2d' when e.notice_window_days<=4 then '3-4d' else '>=5d' end b,
           count(*) n, 100.0*count(*) filter (where missed_deadline)/count(*) r
           from {S}.cae_client_election x join {S}.cae_event e using(event_key) group by 1 order by 1""")
mwd = {r[0]: r[2] for r in mw}; ov = one(f"select 100.0*count(*) filter (where missed_deadline)/count(*) from {S}.cae_client_election")
check(9, "Missed election rate by notice window", "<=2d materially worse than >=5d (overall ~2%)",
      f"<=2d={mwd['<=2d']:.1f}% 3-4d={mwd['3-4d']:.1f}% >=5d={mwd['>=5d']:.1f}% overall={ov:.1f}%", mwd["<=2d"] >= 5 * max(mwd[">=5d"], .1) and mwd["<=2d"] > mwd["3-4d"] > mwd[">=5d"])
# 10 reclaim filed
fl = one(f"select 100.0*count(*) filter (where reclaim_filed)/count(*) from {S}.cae_income_payment where reclaim_eligible")
cx = q(f"""select m.tax_reclaim_complexity, count(*) filter (where not reclaim_filed) unfiled, count(*) elig,
           100.0*count(*) filter (where not reclaim_filed)/count(*) from {S}.cae_income_payment p join {S}.dim_market m using(market_key)
           where reclaim_eligible group by 1""")
cxd = {r[0]: r for r in cx}; tun = sum(r[1] for r in cx)
hi_share = 100.0 * cxd["HIGH"][1] / tun; hi_elig = 100.0 * cxd["HIGH"][2] / sum(r[2] for r in cx)
check(10, "Tax reclaim filed rate", "55%-65%; unfiled concentrated in HIGH markets",
      f"filed={fl:.1f}%; HIGH = {hi_share:.0f}% of unfiled vs {hi_elig:.0f}% of eligible (unfiled rate HIGH {cxd['HIGH'][3]:.0f}% vs MED {cxd['MEDIUM'][3]:.0f}% / LOW {cxd['LOW'][3]:.0f}%)",
      55 <= fl <= 65 and hi_share > 1.5 * hi_elig)
# 11 overdraft by exposure
ex = q(f"""with exp as (select client_key, 100.0*count(*) filter (where c.reliability_tier in ('C','D'))/count(*) cd_share
                      from {S}.stl_trade_instruction i join {S}.dim_counterparty c using(counterparty_key) group by 1),
           od as (select client_key, 100.0*count(*) filter (where is_overdrawn)/count(*) od_rate, sum(funding_cost_usd) fc from {S}.pos_cash_balance group by 1),
           j as (select e.client_key, cd_share, od_rate, fc, ntile(4) over (order by cd_share) qt from exp e join od using(client_key))
           select qt, round(min(cd_share),1) cd_min, round(max(cd_share),1) cd_max, count(*) clients, round(avg(od_rate),2) overdraft_day_pct, round(sum(fc),0) funding_cost from j group by 1 order by 1""")
q1, q4 = ex[0][4], ex[-1][4]
check(11, "Overdraft days by counterparty exposure", "high C/D-exposure clients measurably higher",
      f"lowest C/D-exposure quartile {q1:.2f}% vs highest {q4:.2f}% ({q4/max(q1,.01):.1f}x)", q4 > 1.5 * q1)
# 12 parity
if CLOUD:
    loc = duckdb.connect(str(ROOT.parent / "data" / "northwind.db"), read_only=True)
    mism = []
    for (t,) in q(f"select table_name from information_schema.tables where table_schema='{S}'"):
        a = loc.execute(f"select count(*) from {S}.{t}").fetchone()[0]; b = one(f"select count(*) from {S}.{t}")
        if a != b: mism.append((t, a, b))
    n_t = one(f"select count(*) from information_schema.tables where table_schema='{S}'")
    check(12, "Cloud parity", "all row counts match local", f"{n_t} tables compared, {len(mism)} mismatches", not mism and n_t > 0)
else:
    check(12, "Cloud parity", "all row counts match local", "(run with --cloud)", None)

print("\n" + "=" * 118 + "\nACCEPTANCE TABLE" + ("  [MotherDuck]" if CLOUD else "  [local]") + "\n" + "=" * 118)
print(f"{'#':>2}  {'Check':38s}{'Target':50s}{'Result':60s}")
for n, name, target, value, ok in results:
    print(f"{n:>2}  {name:38s}{target[:48]:50s}{value}  [{'PASS' if ok else 'n/a' if ok is None else 'FAIL'}]")
show("#11 detail - overdraft-day rate by client quartile of C/D-tier counterparty exposure", f"select * from (values {','.join(str(tuple(r)) for r in ex)}) t(quartile, cd_share_min, cd_share_max, clients, overdraft_day_pct, funding_cost_usd)")

print("\n" + "=" * 118 + "\nKILLER QUERY GATES\n" + "=" * 118)
print("\nK1: Which counterparties' settlement fails cost the most in penalties, and which clients bear the impact?")
k1a = show("K1a - tier gradient (STL + penalties + counterparty)", f"""
  select c.reliability_tier tier, count(distinct i.instruction_key) instructions,
         round(100.0*count(distinct i.instruction_key) filter (where i.settlement_status='FAILED')/count(distinct i.instruction_key),2) fail_pct,
         round(avg(i.days_failed) filter (where i.settlement_status='FAILED'),2) avg_days_failed,
         round(coalesce(sum(p.penalty_amount_usd),0),0) penalties_usd,
         round(coalesce(sum(p.penalty_amount_usd),0)/count(distinct i.instruction_key)*1000,2) penalty_usd_per_1k_instr
  from {S}.stl_trade_instruction i join {S}.dim_counterparty c using(counterparty_key)
  left join {S}.stl_fail_penalty p on p.instruction_key=i.instruction_key
  where i.settlement_status in ('SETTLED','FAILED') group by 1 order by 1""")
show("K1b - top 8 counterparties by penalties, with the client bearing the most", f"""
  with pc as (select counterparty_key, client_key, sum(penalty_amount_usd) amt from {S}.stl_fail_penalty group by 1,2),
       top as (select counterparty_key, sum(amt) total, arg_max(client_key, amt) top_client from pc group by 1 order by 2 desc limit 8)
  select c.counterparty_name, c.reliability_tier tier, round(t.total,0) penalties_usd, cl.client_name top_bearing_client, cl.client_segment
  from top t join {S}.dim_counterparty c using(counterparty_key) join {S}.dim_client cl on cl.client_key=t.top_client order by t.total desc""")
show("K1c - clients bearing the impact: penalties + overdraft days + funding cost (top 8 by penalties)", f"""
  with pen as (select client_key, sum(penalty_amount_usd) pen_usd, count(distinct instruction_key) pen_instr from {S}.stl_fail_penalty group by 1),
       cd as (select i.client_key, round(100.0*count(*) filter (where c.reliability_tier in ('C','D'))/count(*),1) cd_exposure_pct
              from {S}.stl_trade_instruction i join {S}.dim_counterparty c using(counterparty_key) group by 1),
       od as (select client_key, count(*) filter (where is_overdrawn) overdraft_days, round(sum(funding_cost_usd),0) funding_cost from {S}.pos_cash_balance group by 1)
  select cl.client_name, cl.client_segment, round(p.pen_usd,0) penalties_usd, cd.cd_exposure_pct, od.overdraft_days, od.funding_cost
  from pen p join {S}.dim_client cl using(client_key) join cd using(client_key) join od using(client_key) order by p.pen_usd desc limit 8""")
k1_ok = all(k1a[i][5] < k1a[i + 1][5] for i in range(3)) and all(k1a[i][2] < k1a[i + 1][2] for i in range(3))
print(f"\n  K1 gate: fail% and penalty-per-1k-instructions both rise monotonically A->D: {'PASS' if k1_ok else 'FAIL'}")

print("\nK2: Where are we leaking tax reclaim revenue, by market and client segment?")
k2a = show("K2a - by market (CAE + dim_market): unfiled reclaim = leakage", f"""
  select m.market_code, m.tax_reclaim_complexity complexity, count(*) eligible_payments,
         round(100.0*count(*) filter (where not p.reclaim_filed)/count(*),1) unfiled_pct,
         round(sum(p.reclaim_amount_usd) filter (where not p.reclaim_filed),0) unfiled_usd,
         round(sum(p.reclaim_amount_usd),0) eligible_usd
  from {S}.cae_income_payment p join {S}.dim_market m using(market_key) where p.reclaim_eligible group by 1,2 order by unfiled_usd desc""")
show("K2b - by complexity", f"""
  select m.tax_reclaim_complexity complexity, round(sum(p.reclaim_amount_usd) filter (where not p.reclaim_filed),0) unfiled_usd,
         round(100.0*sum(p.reclaim_amount_usd) filter (where not p.reclaim_filed)/sum(sum(p.reclaim_amount_usd) filter (where not p.reclaim_filed)) over (),1) pct_of_leakage,
         round(100.0*count(*) filter (where not p.reclaim_filed)/count(*),1) unfiled_rate_pct
  from {S}.cae_income_payment p join {S}.dim_market m using(market_key) where p.reclaim_eligible group by 1 order by 2 desc""")
k2c = show("K2c - by client segment (CAE + dim_client)", f"""
  select c.client_segment, count(*) eligible_payments, round(100.0*count(*) filter (where not p.reclaim_filed)/count(*),1) unfiled_pct,
         round(sum(p.reclaim_amount_usd) filter (where not p.reclaim_filed),0) unfiled_usd
  from {S}.cae_income_payment p join {S}.dim_client c using(client_key) where p.reclaim_eligible group by 1 order by 4 desc""")
show("K2d - earliest-expiring unfiled reclaims", f"""
  select m.market_code, c.client_name, round(p.reclaim_amount_usd,0) reclaim_usd, d.full_date reclaim_deadline
  from {S}.cae_income_payment p join {S}.dim_market m using(market_key) join {S}.dim_client c using(client_key) join {S}.dim_date d on d.date_key=p.reclaim_deadline_date_key
  where p.reclaim_eligible and not p.reclaim_filed order by d.full_date, p.reclaim_amount_usd desc limit 5""")
hi_n = sum(r[2] for r in k2a if r[1] == "HIGH"); hi_un = sum(r[2] * r[3] / 100 for r in k2a if r[1] == "HIGH")
ot_n = sum(r[2] for r in k2a if r[1] != "HIGH"); ot_un = sum(r[2] * r[3] / 100 for r in k2a if r[1] != "HIGH")
hi_rate, ot_rate = 100 * hi_un / hi_n, 100 * ot_un / ot_n
hi_usd = sum(r[4] for r in k2a if r[1] == "HIGH"); all_usd = sum(r[4] for r in k2a)
print(f"\n  K2 gate (redefined, D-044): unfiled rate in HIGH markets {hi_rate:.1f}% vs {ot_rate:.1f}% elsewhere = {hi_rate/ot_rate:.2f}x (need > 1.5x): {'PASS' if hi_rate > 1.5 * ot_rate else 'FAIL'}")
print(f"  (info) dollars diverge from rate: HIGH = {100*hi_usd/all_usd:.0f}% of unfiled reclaim $; largest single $ leak = {max(k2a, key=lambda r: r[4])[0]} (volume-driven)")

print("\nK3: Which corporate action elections did we miss, and what was the notice window?")
show("K3a - miss rate by notice window and market group (CAE event + election)", f"""
  select case when e.notice_window_days<=2 then '1. <=2d' when e.notice_window_days<=4 then '2. 3-4d' else '3. >=5d' end window_bucket,
         case when m.market_code in ('IT','HK','JP') then 'IT/HK/JP' else 'other' end markets, count(*) elections,
         count(*) filter (where x.missed_deadline) missed, round(100.0*count(*) filter (where x.missed_deadline)/count(*),1) miss_pct
  from {S}.cae_client_election x join {S}.cae_event e using(event_key) join {S}.dim_market m on m.market_key=e.market_key group by 1,2 order by 1,2""")
k3b = show("K3b - share of ALL misses by window vs share of all elections", f"""
  select case when e.notice_window_days<=2 then '<=2d' when e.notice_window_days<=4 then '3-4d' else '>=5d' end window_bucket,
         round(100.0*count(*)/sum(count(*)) over (),1) pct_of_elections,
         round(100.0*count(*) filter (where x.missed_deadline)/sum(count(*) filter (where x.missed_deadline)) over (),1) pct_of_misses
  from {S}.cae_client_election x join {S}.cae_event e using(event_key) group by 1 order by 1""")
show("K3c - the 8 costliest missed elections", f"""
  select e.event_ref, e.event_type, m.market_code, e.notice_window_days notice_days, c.client_name, round(x.estimated_client_impact_usd,0) impact_usd
  from {S}.cae_client_election x join {S}.cae_event e using(event_key) join {S}.dim_market m on m.market_key=e.market_key join {S}.dim_client c using(client_key)
  where x.missed_deadline order by x.estimated_client_impact_usd desc limit 8""")
d = {r[0]: r for r in k3b}
print(f"\n  K3 gate: <=2d windows are {d['<=2d'][1]}% of elections but {d['<=2d'][2]}% of misses: {'PASS' if d['<=2d'][2] > 3 * d['<=2d'][1] else 'FAIL'}")

print("\nINTEGRITY")
print("  NULL subcustodian_key  instructions:", one(f"select count(*) from {S}.stl_trade_instruction where subcustodian_key is null"),
      "| positions:", one(f"select count(*) from {S}.pos_daily_position where subcustodian_key is null"),
      "| breaks:", one(f"select count(*) from {S}.rec_break where subcustodian_key is null"))
print("  subcustodians:", one(f"select count(*) from {S}.dim_subcustodian"), "(", q(f"select service_tier, count(*) from {S}.dim_subcustodian group by 1 order by 1"), ")")
print("  instructions routed via BACKUP:", one(f"select count(*) from {S}.stl_trade_instruction i join {S}.dim_subcustodian s using(subcustodian_key) where s.service_tier='BACKUP'"))
show("estimated_client_impact_usd of missed elections (top 5 + stats)", f"select round(max(estimated_client_impact_usd),0) max_usd, round(median(estimated_client_impact_usd),0) median_usd, round(avg(estimated_client_impact_usd),0) mean_usd, count(*) missed from {S}.cae_client_election where missed_deadline")
fails = [r for r in results if r[4] is False]
print("\n" + ("ALL ACCEPTANCE CHECKS PASS" if not fails else f"FAILED CHECKS: {[r[0] for r in fails]}"))
