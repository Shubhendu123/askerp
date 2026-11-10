"""D-048 Part C: author the 12 DOC-tier questions + ground truth BEFORE any model run (idempotent; run from repo root).
Ground-truth SQL is executed against data/northwind.db; expected facts are regexes over the narration; required_docs are chunk ids."""
import duckdb, json, re, pathlib
con = duckdb.connect("data/northwind.db", read_only=True)
def secid(doc_glob, heading):
    f = next(pathlib.Path("harborline").rglob(doc_glob)); parts = re.split(r"^## ", f.read_text().split("\n---\n", 1)[1], flags=re.M)[1:]
    nums = [p for p in parts]; out = []
    for i, p in enumerate(parts):
        h = p.split("\n", 1)[0].strip()
        if not re.match(r"\d+\.", h) and i == 0 and any(re.match(r"\d+\.", x) for x in parts): continue
        n = int(re.match(r"(\d+)\.", h).group(1)) if re.match(r"(\d+)\.", h) else i + 1
        if heading.lower() in h.lower(): return n
    raise KeyError((doc_glob, heading))
H = "harborline:"
def D(doc, glob, head, ver=None): return f"{H}{doc}{('@' + ver) if ver else ''}#{secid(glob, head)}"
RUN = lambda sql: [[(float(x) if hasattr(x, 'as_integer_ratio') and not isinstance(x, (int, bool)) else x) for x in r] for r in con.execute(sql).fetchall()]
Q = []
def add(id, question, tests, sql, facts, docs, primary=(), tables=(), doc_only=False, precedence=None, version=None, forbid_agreement=False, entities_in_scope=()):
    Q.append(dict(id=id, tier="DOC", question=question, tests=tests, doc_only=doc_only, precedence=precedence, version=version, forbid_agreement=forbid_agreement, facts=facts,
                  expected=dict(primary=list(primary), tables=list(tables), policies=[d for d in docs if ":POL-" in d], documents=[d for d in docs if ":POL-" not in d]), _sql=sql))
add("D01", "Did Eastgate Capital Partners meet its settlement SLA in September 2026?", "precedence: 98.5% (CA-001) over 99.0% (POL-001)",
    "SELECT c.client_name, ROUND(100.0*COUNT(*) FILTER (WHERE i.actual_settle_date_key=i.intended_settle_date_key)/COUNT(*),2) AS settlement_rate_pct, 98.5 AS target_pct FROM harborline.stl_trade_instruction i JOIN harborline.dim_client c USING(client_key) JOIN harborline.dim_date d ON d.date_key=i.intended_settle_date_key WHERE c.client_name='Eastgate Capital Partners' AND d.year_num=2026 AND d.month_num=9 AND i.settlement_status IN ('SETTLED','FAILED') GROUP BY 1",
    [r"98\.5", r"99\.0?"], [D("CA-001", "CA-001*", "Settlement performance"), D("POL-001", "POL-001*", "SLA tiers")], primary=["harborline:client_sla_settlement_compliance"],
    tables=["harborline:stl_trade_instruction", "harborline:dim_client"], precedence=["CA-001 §2", "POL-001 §2"])
add("D02", "How much does Harborline owe Pinnacle for the missed rights issue?", "contract cap USD 2M (CA-002 §2) vs data impact; gross-negligence review (INC)",
    "SELECT c.client_name, x.event_key, x.estimated_client_impact_usd, LEAST(x.estimated_client_impact_usd, 2000000) AS owed_under_cap_usd FROM harborline.cae_client_election x JOIN harborline.dim_client c USING(client_key) WHERE c.client_name='Pinnacle Asset Management' AND x.event_key=2630 AND x.missed_deadline",
    [r"2(\.0)?\s*(M|million)|2,000,000", r"gross negligence|legal"], [D("CA-002", "CA-002*", "Liability"), D("INC-EVT-2630", "INC-2630*", "Compensation"), D("POL-004", "POL-004*", "8.")],
    primary=["harborline:missed_election_impact_usd"], tables=["harborline:cae_client_election"], precedence=["CA-002 §2", "POL-004 §8"])
add("D03", "For Vantage's missed dividend option in Italy, what should have been applied?", "standing instruction cash (CA-005) vs issuer default shares (EVT-2704)",
    "SELECT c.client_name, x.event_key, x.election_status, x.estimated_client_impact_usd FROM harborline.cae_client_election x JOIN harborline.dim_client c USING(client_key) WHERE c.client_name='Vantage Sovereign Investment Authority' AND x.event_key=2704",
    [r"cash", r"(standing instruction)", r"shares"], [D("CA-005", "CA-005*", "Standing election"), D("EVT-2704", "EVT-2704*", "Default if no")], primary=["harborline:missed_election_impact_usd"], tables=["harborline:cae_client_election"], precedence=["CA-005 §1", "POL-004 §6"])
add("D04", "What was the client instruction cut-off for Italian trades in February 2026?", "versioning: 17:00 CET (MG-IT v1.0), not 16:00", None, [r"17:00"], [D("MG-IT", "MG-IT-v1*", "Settlement", "1.0")], doc_only=True, version={"must": r"17:00", "must_not": r"\b16:00"})
add("D05", "What is the client instruction cut-off for Italian trades today?", "versioning: 16:00 CET (MG-IT v2.0)", None, [r"16:00"], [D("MG-IT", "MG-IT-v2*", "Settlement", "2.0")], doc_only=True, version={"must": r"16:00", "must_not": r"\b17:00"})
add("D06", "If Montclair had tendered in event 2706, would all its shares have been bought?", "notice-only terms: partial offer, pro-rata scaling (EVT-2706)", None, [r"30\s*%", r"pro.?rata|scaled"], [D("EVT-2706", "EVT-2706*", "Scaling")], doc_only=True)
add("D07", "Is Westmark's missed German takeover election (event 2751) still recoverable, and what do we owe?", "multi-doc: additional acceptance period (EVT-2751 + MG-DE §2), uncapped + interest (CA-004 §2)",
    "SELECT c.client_name, x.event_key, x.estimated_client_impact_usd FROM harborline.cae_client_election x JOIN harborline.dim_client c USING(client_key) WHERE c.client_name='Westmark Sovereign Investment Authority' AND x.event_key=2751 AND x.missed_deadline",
    [r"additional acceptance|acceptance period", r"interest", r"no cap|uncapped|in full"], [D("CA-004", "CA-004*", "Corporate action"), D("MG-DE", "MG-DE*", "tender", "2.1"), D("EVT-2751", "EVT-2751*", "Terms")],
    primary=["harborline:missed_election_impact_usd"], tables=["harborline:cae_client_election"], precedence=["CA-004 §2", "POL-004 §8"])
add("D08", "Has Kendal Prowse Securities been through remediation, and what was the outcome?", "institutional memory (INC-2026-012)", None, [r"no improvement", r"tier D|tier-D"], [D("INC-2026-012", "INC-2026-012*", "Actions")], doc_only=True)
add("D09", "Why does Eastgate carry so many Harborline-borne penalties?", "data share + explanation (INC-2026-007, CA-001 §4)",
    "SELECT c.client_name, COUNT(*) FILTER (WHERE p.bearer='HARBORLINE') AS harborline_borne_penalties, COUNT(*) AS penalties, ROUND(100.0*COUNT(*) FILTER (WHERE p.bearer='HARBORLINE')/COUNT(*),2) AS harborline_borne_pct FROM harborline.stl_fail_penalty p JOIN harborline.dim_client c USING(client_key) WHERE c.client_name='Eastgate Capital Partners' GROUP BY 1",
    [r"instruction.?processing|processing error|own error"], [D("INC-2026-007", "INC-2026-007*", "Root cause"), D("CA-001", "CA-001*", "Penalty allocation")], primary=["harborline:harborline_borne_penalties_usd"], tables=["harborline:stl_fail_penalty"])
add("D10", "Which of Westmark's eligible reclaims breached its 90-day filing window?", "contract rule in SQL (CA-004 §1)",
    "SELECT ip.income_payment_key, ip.actual_date_key, ip.reclaim_amount_usd FROM harborline.cae_income_payment ip JOIN harborline.dim_client c USING(client_key) JOIN harborline.dim_date d ON d.date_key=ip.actual_date_key WHERE c.client_name='Westmark Sovereign Investment Authority' AND ip.reclaim_eligible AND NOT ip.reclaim_filed AND d.full_date + INTERVAL 90 DAY < DATE '2026-10-22' ORDER BY ip.actual_date_key",
    [r"90"], [D("CA-004", "CA-004*", "Reclaim filing"), D("POL-005", "POL-005*", "5.")], primary=["harborline:unfiled_reclaim_value_usd"], tables=["harborline:cae_income_payment"], precedence=["CA-004 §1", "POL-005 §5"])
add("D11", "What is Redwood Asset Management's settlement rate?", "leakage control: zero client_agreement chunks (Redwood has none)",
    "SELECT c.client_name, ROUND(100.0*COUNT(*) FILTER (WHERE i.actual_settle_date_key=i.intended_settle_date_key)/COUNT(*),2) AS settlement_rate_pct FROM harborline.stl_trade_instruction i JOIN harborline.dim_client c USING(client_key) WHERE c.client_name='Redwood Asset Management' AND i.settlement_status IN ('SETTLED','FAILED') GROUP BY 1",
    [r"%"], [], primary=["harborline:settlement_rate_pct"], tables=["harborline:stl_trade_instruction", "harborline:dim_client"], forbid_agreement=True)
add("D12", "When do the UK and EU move to T+1?", "NO_SQL: 11 October 2027 (REG-002)", None, [r"11 October 2027|October 11, 2027|2027-10-11"], [D("REG-002", "REG-002*", "")] if False else [f"{H}REG-002#1"], doc_only=True)
gt = json.load(open("benchmark/ground_truth_harborline.json")); cfg = json.load(open("benchmark/questions_harborline.json"))
cfg["questions"] = [q for q in cfg["questions"] if q["tier"] != "DOC"]
for q in Q:
    sql = q.pop("_sql")
    gt[q["id"]] = {"sql": sql, "result": RUN(sql) if sql else [], "facts": q["facts"], "doc_only": q["doc_only"]}
    cfg["questions"].append(q)
json.dump(cfg, open("benchmark/questions_harborline.json", "w"), indent=1); json.dump(gt, open("benchmark/ground_truth_harborline.json", "w"), indent=1, default=str)
for q in Q: print(q["id"], "rows:", len(gt[q["id"]]["result"]), gt[q["id"]]["result"][:2], "| docs:", q["expected"]["policies"] + q["expected"]["documents"])
