"""
AskERP D-046 Gate B - execute every harborline metric formula against data/northwind.db, sanity-check against D-044's verified
numbers, and run the D-041 declaration audit (tables referenced in the formula == `tables:`). Run from repo root.
"""
import re, sys, yaml, duckdb
con = duckdb.connect("data/northwind.db", read_only=True)
M = [m for m in yaml.safe_load(open("data/metrics.yaml"))["metrics"] if m.get("tenant") == "harborline"]
S = yaml.safe_load(open("data/schema.yaml"))["tables"]
known = {t["name"] for t in S if t.get("tenant") == "harborline"}
print(f"{len(M)} harborline metrics\n")
bad = 0; res = {}
for m in M:
    f = m["formula"]
    ph = re.findall(r"\{[a-z_]+\}", f)
    try:
        rows = con.execute(f).fetchall(); res[m["name"]] = rows
        shown = rows[0][0] if len(rows) == 1 and len(rows[0]) == 1 else f"{len(rows)} rows, first: {tuple(rows[0])}"
        print(f"  OK   {m['name']:36s} {shown}")
    except Exception as e:
        bad += 1; print(f"  FAIL {m['name']:36s} {str(e)[:150]}")
    if ph: bad += 1; print(f"       placeholders: {ph}")
print("\nDECLARATION AUDIT (formula tables vs tables:)")
for m in M:
    # strip CTE names: tables are `harborline.<name>` references only
    used = sorted(set(re.findall(r"harborline\.(\w+)", m["formula"])))
    decl = sorted(t.split(".")[-1] for t in m["tables"])
    ok = used == decl and all(u in known for u in used)
    if not ok: bad += 1
    print(f"  {'OK  ' if ok else 'DIFF'} {m['name']:36s}" + ("" if ok else f" used={used} declared={decl}"))
print("\nSANITY vs D-044")
g = lambda k: res[k][0][0]
chk = [("AUC ~ $714B (D-044 prompt) / 712.2B observed", float(g("assets_under_custody_usd")) / 1e9, 700, 725),
       ("fail rate ~3.75-3.84%", float(g("settlement_fail_rate_pct")), 3.6, 4.0),
       ("settlement rate = 100 - fail rate", float(g("settlement_rate_pct")) + float(g("settlement_fail_rate_pct")), 99.99, 100.01),
       ("missed election ~1.6% (D-044) / ~2% target", float(g("missed_election_rate_pct")), 1.2, 2.2),
       ("reclaim filed ~60%", float(g("reclaim_filed_rate_pct")), 58, 62),
       ("tier gradient A", float(res["fail_rate_by_counterparty_tier"][0][2]), 0.7, 1.4),
       ("tier gradient B", float(res["fail_rate_by_counterparty_tier"][1][2]), 2.0, 3.0),
       ("tier gradient C", float(res["fail_rate_by_counterparty_tier"][2][2]), 6.0, 8.0),
       ("tier gradient D", float(res["fail_rate_by_counterparty_tier"][3][2]), 12.5, 15.5),
       ("penalty total = sum of bearers ($1.43M)", float(g("penalty_total_usd")) / 1e6, 1.40, 1.46),
       ("missed impact total $79.4M", float(g("missed_election_impact_usd")) / 1e6, 79.3, 79.4)]
for label, v, lo, hi in chk:
    ok = lo <= v <= hi; bad += (not ok); print(f"  {'OK  ' if ok else 'FLAG'} {label:48s} {v:,.3f}  [{lo},{hi}]")
print("\nTIER GRADIENT:", res["fail_rate_by_counterparty_tier"])
sys.exit(1 if bad else 0)
