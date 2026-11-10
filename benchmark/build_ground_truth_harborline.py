"""
D-046 Part C: hand-authored ground truth for the 26 answerable Harborline questions. Executes every SQL against
data/northwind.db and writes benchmark/ground_truth_harborline.json BEFORE any model run (the 4 controls have no SQL).
Independent of the metric formulas on purpose: written from the policies and the DDL, so the metrics are tested, not echoed.
Conventions: data ends 2026-10-22; "last month" = September 2026; "today" = 2026-10-22; trailing 12 months = intended
settle date 2025-10-23..2026-10-22. Run from repo root: python3 benchmark/build_ground_truth_harborline.py
"""
import json, decimal, duckdb
H = "harborline"
GT = {
 "S01": f"SELECT ROUND(SUM(market_value_usd),2) FROM {H}.pos_daily_position WHERE position_date_key=(SELECT MAX(position_date_key) FROM {H}.pos_daily_position)",
 "S02": f"SELECT ROUND(100.0*COUNT(*) FILTER (WHERE settlement_status='FAILED')/COUNT(*),2) FROM {H}.stl_trade_instruction WHERE settlement_status IN ('SETTLED','FAILED')",
 "S03": f"SELECT ROUND(SUM(penalty_amount_usd),2) FROM {H}.stl_fail_penalty",
 "S04": f"SELECT ROUND(100.0*COUNT(*) FILTER (WHERE reclaim_filed)/COUNT(*),2) FROM {H}.cae_income_payment WHERE reclaim_eligible",
 "S05": f"SELECT ROUND(100.0*COUNT(*) FILTER (WHERE missed_deadline)/COUNT(*),2) FROM {H}.cae_client_election",
 "S06": f"SELECT ROUND(SUM(funding_cost_usd),2) FROM {H}.pos_cash_balance",
 "S07": f"SELECT ROUND(SUM(invoiced_amount_usd),2) FROM {H}.clt_fee_invoice",
 "S08": f"SELECT ROUND(SUM(settlement_amount_usd),2) FROM {H}.stl_trade_instruction WHERE settlement_status='PENDING' OR (settlement_status='FAILED' AND actual_settle_date_key IS NULL)",
 "M01": f"""SELECT cp.reliability_tier, ROUND(100.0*COUNT(*) FILTER (WHERE i.settlement_status='FAILED')/COUNT(*),2) AS fail_rate_pct
   FROM {H}.stl_trade_instruction i JOIN {H}.dim_counterparty cp USING(counterparty_key) WHERE i.settlement_status IN ('SETTLED','FAILED') GROUP BY 1 ORDER BY 1""",
 "M02": f"""SELECT m.market_code, ROUND(SUM(p.penalty_amount_usd),2) FROM {H}.stl_fail_penalty p JOIN {H}.dim_market m USING(market_key) GROUP BY 1 ORDER BY 2 DESC""",
 "M03": f"""SELECT ROUND(100.0*COUNT(*) FILTER (WHERE x.missed_deadline)/COUNT(*),2) AS missed_rate_pct
   FROM {H}.cae_client_election x JOIN {H}.cae_event e USING(event_key)
   GROUP BY CASE WHEN e.notice_window_days<=2 THEN 1 WHEN e.notice_window_days<=4 THEN 2 ELSE 3 END ORDER BY CASE WHEN e.notice_window_days<=2 THEN 1 WHEN e.notice_window_days<=4 THEN 2 ELSE 3 END""",
 "M04": f"""SELECT waiver_reason, ROUND(SUM(billable_amount_usd-invoiced_amount_usd),2) FROM {H}.clt_fee_invoice WHERE waiver_reason IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""",
 "M05": f"""SELECT m.market_code, ROUND(SUM(ip.reclaim_amount_usd),2) FROM {H}.cae_income_payment ip JOIN {H}.dim_market m USING(market_key)
   WHERE ip.reclaim_eligible AND NOT ip.reclaim_filed GROUP BY 1 ORDER BY 2 DESC LIMIT 5""",
 "M06": f"""SELECT c.client_segment, ROUND(SUM(p.market_value_usd),2) FROM {H}.pos_daily_position p JOIN {H}.dim_client c USING(client_key)
   WHERE p.position_date_key=(SELECT MAX(position_date_key) FROM {H}.pos_daily_position) GROUP BY 1 ORDER BY 2 DESC""",
 "M07": f"""SELECT s.security_type, ROUND(100.0*COUNT(*) FILTER (WHERE i.settlement_status='FAILED')/COUNT(*),2)
   FROM {H}.stl_trade_instruction i JOIN {H}.dim_security s USING(security_key) WHERE i.settlement_status IN ('SETTLED','FAILED') GROUP BY 1 ORDER BY 2 DESC""",
 "M08": f"""SELECT c.client_name, COUNT(*) AS overdraft_days FROM {H}.pos_cash_balance b JOIN {H}.dim_client c USING(client_key) WHERE b.is_overdrawn GROUP BY 1 ORDER BY 2 DESC LIMIT 5""",
 # ── hard cross-area ──
 "H01": f"""WITH ins AS (SELECT cp.reliability_tier t, COUNT(*) n, COUNT(*) FILTER (WHERE i.settlement_status='FAILED') f
              FROM {H}.stl_trade_instruction i JOIN {H}.dim_counterparty cp USING(counterparty_key) WHERE i.settlement_status IN ('SETTLED','FAILED') GROUP BY 1),
   pen AS (SELECT cp.reliability_tier t, SUM(p.penalty_amount_usd) a FROM {H}.stl_fail_penalty p JOIN {H}.dim_counterparty cp USING(counterparty_key) GROUP BY 1)
   SELECT ins.t, ROUND(100.0*ins.f/ins.n,2) AS fail_rate_pct, ROUND(pen.a,2) AS penalties_usd, ROUND(pen.a*1000.0/ins.n,0) AS penalties_per_1000
   FROM ins JOIN pen USING(t) ORDER BY 1""",
 "H02": f"""WITH ev AS (SELECT e.market_key, ROUND(100.0*COUNT(*) FILTER (WHERE e.notice_window_days<=2)/COUNT(*),2) AS short_notice_pct
              FROM {H}.cae_event e WHERE e.is_voluntary GROUP BY 1),
   el AS (SELECT e.market_key, ROUND(100.0*COUNT(*) FILTER (WHERE x.missed_deadline)/COUNT(*),2) AS missed_pct
              FROM {H}.cae_client_election x JOIN {H}.cae_event e USING(event_key) GROUP BY 1)
   SELECT m.market_code, ev.short_notice_pct, el.missed_pct FROM ev JOIN el USING(market_key) JOIN {H}.dim_market m USING(market_key)
   ORDER BY ev.short_notice_pct DESC LIMIT 5""",
 "H03": f"""SELECT m.market_code, ROUND(SUM(ip.reclaim_amount_usd) FILTER (WHERE NOT ip.reclaim_filed),2) AS unfiled_usd, m.tax_reclaim_complexity,
   ROUND(100.0*COUNT(*) FILTER (WHERE ip.reclaim_filed)/COUNT(*),2) AS filed_rate_pct
   FROM {H}.cae_income_payment ip JOIN {H}.dim_market m USING(market_key) WHERE ip.reclaim_eligible GROUP BY m.market_code, m.tax_reclaim_complexity ORDER BY 2 DESC LIMIT 5""",
 "H04": f"""WITH od AS (SELECT client_key, COUNT(*) AS overdraft_days FROM {H}.pos_cash_balance WHERE is_overdrawn GROUP BY 1),
   cd AS (SELECT i.client_key, ROUND(100.0*COUNT(*) FILTER (WHERE cp.reliability_tier IN ('C','D'))/COUNT(*),2) AS cd_share_pct
          FROM {H}.stl_trade_instruction i JOIN {H}.dim_counterparty cp USING(counterparty_key) GROUP BY 1)
   SELECT c.client_name, od.overdraft_days, cd.cd_share_pct FROM od JOIN cd USING(client_key) JOIN {H}.dim_client c USING(client_key)
   ORDER BY od.overdraft_days DESC LIMIT 10""",
 "H05": f"""WITH ag AS (SELECT client_key, COUNT(*) AS aged_fails FROM {H}.stl_trade_instruction WHERE settlement_status='FAILED' AND days_failed>=5 GROUP BY 1),
   sc AS (SELECT client_key, SUM(billable_amount_usd-invoiced_amount_usd) AS sla_credits FROM {H}.clt_fee_invoice WHERE waiver_reason='SLA_CREDIT' GROUP BY 1)
   SELECT c.client_name, ag.aged_fails, c.sla_tier, ROUND(COALESCE(sc.sla_credits,0),2) AS sla_credits_usd
   FROM ag JOIN {H}.dim_client c USING(client_key) LEFT JOIN sc USING(client_key) ORDER BY ag.aged_fails DESC LIMIT 10""",
 # ── hybrid (policy + data) ──
 "P01": f"""SELECT c.client_name, ROUND(100.0*COUNT(*) FILTER (WHERE i.actual_settle_date_key=i.intended_settle_date_key)/COUNT(*),2) AS settlement_rate_pct
   FROM {H}.stl_trade_instruction i JOIN {H}.dim_client c USING(client_key) JOIN {H}.dim_date d ON d.date_key=i.intended_settle_date_key
   WHERE c.sla_tier='PLATINUM' AND d.year_num=2026 AND d.month_num=9 AND i.settlement_status IN ('SETTLED','FAILED')
   GROUP BY 1 HAVING 100.0*COUNT(*) FILTER (WHERE i.actual_settle_date_key=i.intended_settle_date_key)/COUNT(*) < 99.0 ORDER BY 2""",
 "P02": f"""SELECT cp.counterparty_name, ROUND(100.0*COUNT(*) FILTER (WHERE i.settlement_status='FAILED')/COUNT(*),2) AS fail_rate_pct,
   ROUND(AVG(i.days_failed) FILTER (WHERE i.settlement_status='FAILED'),2) AS avg_days_failed
   FROM {H}.stl_trade_instruction i JOIN {H}.dim_counterparty cp USING(counterparty_key)
   WHERE i.settlement_status IN ('SETTLED','FAILED') AND i.intended_settle_date_key>20251022 AND COALESCE(i.fail_reason_code,'')<>'MARKET_RESTRICTION'
   GROUP BY 1 HAVING 100.0*COUNT(*) FILTER (WHERE i.settlement_status='FAILED')/COUNT(*)>10.0 AND AVG(i.days_failed) FILTER (WHERE i.settlement_status='FAILED')>4.0
   ORDER BY 2 DESC""",
 "P03": f"""WITH openf AS (SELECT * FROM {H}.stl_trade_instruction WHERE settlement_status='FAILED' AND actual_settle_date_key IS NULL),
   expo AS (SELECT instruction_key, MAX(penalty_amount_usd) AS daily_penalty FROM {H}.stl_fail_penalty GROUP BY 1),
   od AS (SELECT DISTINCT client_key FROM {H}.pos_cash_balance WHERE is_overdrawn AND balance_date_key=(SELECT MAX(balance_date_key) FROM {H}.pos_cash_balance))
   SELECT o.instruction_ref,
     CASE WHEN COALESCE(e.daily_penalty,0)>500 THEN 1 WHEN o.direction='RECEIVE' AND od.client_key IS NOT NULL THEN 2 WHEN c.sla_tier='PLATINUM' THEN 3 ELSE 4 END AS priority,
     ROUND(o.settlement_amount_usd,2) AS settlement_amount_usd
   FROM openf o JOIN {H}.dim_client c USING(client_key) LEFT JOIN expo e USING(instruction_key) LEFT JOIN od ON od.client_key=o.client_key
   ORDER BY 2, o.settlement_amount_usd DESC LIMIT 10""",
 "P04": f"""SELECT c.client_name, d.year_num, d.month_num, ROUND(SUM(p.penalty_amount_usd),2) AS penalties_usd
   FROM {H}.stl_fail_penalty p JOIN {H}.dim_client c USING(client_key) JOIN {H}.dim_date d ON d.date_key=p.penalty_date_key
   WHERE p.bearer='CLIENT' GROUP BY 1,2,3 HAVING SUM(p.penalty_amount_usd)>50000 ORDER BY 4 DESC""",
 "P05": f"""WITH rev AS (SELECT client_key, SUM(invoiced_amount_usd) inv, SUM(billable_amount_usd-invoiced_amount_usd) FILTER (WHERE waiver_reason='SLA_CREDIT') sla,
                      SUM(invoiced_amount_usd) FILTER (WHERE fee_type='OVERDRAFT') odf FROM {H}.clt_fee_invoice GROUP BY 1),
   pen AS (SELECT client_key, SUM(penalty_amount_usd) p FROM {H}.stl_fail_penalty WHERE bearer='HARBORLINE' GROUP BY 1),
   fund AS (SELECT client_key, SUM(funding_cost_usd) f FROM {H}.pos_cash_balance GROUP BY 1),
   svc AS (SELECT client_key, SUM(analyst_hours)*85 s FROM {H}.clt_service_request GROUP BY 1)
   SELECT c.client_name, ROUND(rev.inv-COALESCE(pen.p,0)-GREATEST(COALESCE(fund.f,0)-COALESCE(rev.odf,0),0)-COALESCE(rev.sla,0)-COALESCE(svc.s,0),2) AS profitability_usd
   FROM {H}.dim_client c JOIN rev USING(client_key) LEFT JOIN pen USING(client_key) LEFT JOIN fund USING(client_key) LEFT JOIN svc USING(client_key)
   WHERE rev.inv-COALESCE(pen.p,0)-GREATEST(COALESCE(fund.f,0)-COALESCE(rev.odf,0),0)-COALESCE(rev.sla,0)-COALESCE(svc.s,0) < 0 ORDER BY 2""",
}
def clean(v):
    if isinstance(v, decimal.Decimal): return float(v)
    return v
con = duckdb.connect("data/northwind.db", read_only=True)
out = {}
for qid, sql in GT.items():
    rows = [[clean(c) for c in r] for r in con.execute(sql).fetchall()]
    out[qid] = {"sql": " ".join(sql.split()), "result": rows}
    head = rows[0] if rows else "EMPTY (correct answer: none)"
    print(f"{qid}: {len(rows):>3} rows  {head}")
json.dump(out, open("benchmark/ground_truth_harborline.json", "w"), indent=1)
print("\nwrote benchmark/ground_truth_harborline.json:", len(out), "answerable questions")
