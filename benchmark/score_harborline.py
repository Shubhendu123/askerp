"""
D-046 Part C scorer. Reuses the D-036 A-score (build_report.score_a, verbatim) and the D-041 retrieval rubric, pointed at the
Harborline questions/ground truth. Adds policy coverage and citation accuracy.
  required         = expected primary ∪ tables ∪ policies (chunk ids)
  R_recall         = |required ∩ retrieved| / |required|;  R_precision = |required ∩ retrieved| / |retrieved|
  table coverage   = share of expected tables retrieved
  policy coverage  = share of expected policy chunks retrieved (None when the question requires none)
  citation accuracy= share of policy citations in the narration that point at a retrieved policy chunk (None when no citation);
                     citing a policy that was not retrieved counts as wrong, and so does citing any policy when none was retrieved.
  A (empty ground truth, i.e. the right answer is "none"): 3 = valid SQL returning no rows; 1 = valid SQL returning rows; 0 = failed/refused.
stdin: one record JSON. stdout: scores JSON. `--summarize <file>` prints the table. Run from repo root.
"""
import json, re, sys
src = open("benchmark/build_report.py", encoding="utf-8").read()
_ns = {"__name__": "build_report_defs"}
exec(compile(src.split("# ── score all runs")[0], "build_report.py", "exec"), _ns)
CFG = json.load(open("benchmark/questions_harborline.json"))
Q = {q["id"]: q for q in CFG["questions"]}
GT = json.load(open("benchmark/ground_truth_harborline.json"))
_ns["questions"], _ns["gt"] = Q, GT        # point the D-036 scorer at the Harborline set

CITE = re.compile(r"POL-(\d{3})(?:\s*§\s*(\d+))?")

def citations(text, retrieved):
    cited = [(m.group(1), m.group(2)) for m in CITE.finditer(text or "")]
    if not cited: return None, []
    pol = {i.split(":", 1)[1] for i in retrieved if ":POL-" in i}           # e.g. POL-001#2
    docs = {p.split("#")[0] for p in pol}
    bad = []
    for d, s in cited:
        ok = (f"POL-{d}#{s}" in pol) if s else (f"POL-{d}" in docs)
        if not ok: bad.append(f"POL-{d}" + (f" §{s}" if s else ""))
    return round(1 - len(bad) / len(cited), 4), bad

# D-048 narration fidelity + policy scope checks (ground truth = the executed SQL itself)
WINDOW = re.compile(r"\b(trailing|rolling|last\s+(?:\d+\s+)?(?:month|quarter|year|week)s?|past\s+(?:\d+\s+)?(?:month|quarter|year|week)s?|(?:previous|prior)\s+(?:\d+\s+)?(?:month|quarter|year)s?|year[- ]to[- ]date|ytd|this\s+(?:month|quarter|year)|over\s+the\s+(?:last|past)|recent(?:ly)?|\d+[- ]months?|\d+[- ]days?\s+(?:window|period)|Q[1-4]\s*20\d\d|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d\d|20\d\d)\b", re.I)
SQL_DATE = re.compile(r"date_key|full_date|year_num|month_num|quarter_num|current_date|now\(\)|interval|date_trunc|date\s+'", re.I)
TIER_WORDS = re.compile(r"\b(tier|tiers|platinum|gold|silver|bronze|sla|sla tier)\b", re.I)

def fidelity_scope(rec):
    text = (rec.get("narrative") or "") + " " + (rec.get("headline") or ""); sql = rec.get("sql") or ""
    q = (rec.get("question") or "")
    win = sorted({m.group(0).lower() for m in WINDOW.finditer(text)})
    # a window the question itself asked for (e.g. "last month", "September 2026") is fine only if the SQL has a date filter
    window_bad = bool(win) and not SQL_DATE.search(sql)
    text = re.sub(r"sla[- ]credits?|mid-tier|service[- ]level (?:breach|agreement)s?", " ", text, flags=re.I)
    uses_client = bool(re.search(r"client_key|dim_client|sla_tier", sql, re.I)); uses_cp = bool(re.search(r"counterparty_key|dim_counterparty|reliability_tier", sql, re.I))
    scope = []
    if re.search(r"\bsla\b|platinum|gold|silver|bronze", text, re.I) and not uses_client: scope.append("SLA/client-tier language but SQL is not per client")
    if re.search(r"counterpart\w*\s+tier|tier[- ][abcd]\b|\btier\s+[abcd]\b|\btiers?\b", text, re.I) and not (uses_cp or uses_client): scope.append("tier language but SQL is not per counterparty/client")
    if re.search(r"POL-001", text) and not uses_client: scope.append("cites POL-001 without a per-client SQL")
    if re.search(r"POL-007", text) and not uses_cp: scope.append("cites POL-007 without a per-counterparty SQL")
    return {"window_claims": win, "window_bad": window_bad, "scope_viol": scope}

# D-048 DOC tier ---------------------------------------------------------------------------------------------------------------
import pathlib, yaml as _yaml
_AGR = {}   # client_agreement doc_id -> client name (for the confidential-leakage check)
for _f in pathlib.Path("harborline/corpus/client_agreements").glob("*.md"):
    _fm = _yaml.safe_load(_f.read_text().split("---", 2)[1]); _AGR[_fm["doc_id"]] = _fm["entities"]["client"]

def leakage(rec):
    """client_agreement chunks (retrieved or attached post-SQL) whose client the question does not name. Must be 0."""
    q = (rec.get("question") or "").lower(); bad = []
    for cid in list(rec.get("retrieved_chunk_ids") or []) + list(rec.get("enriched_chunk_ids") or []):
        m = re.match(r"harborline:(CA-\d+)#", cid)
        if m and _AGR.get(m.group(1), "").split()[0].lower() not in q: bad.append(cid)
    return bad

def doc_scores(rec, q):
    text = (rec.get("narrative") or "") + " " + (rec.get("headline") or "")
    got = set(rec.get("retrieved_chunk_ids") or []) | set(rec.get("enriched_chunk_ids") or [])
    req = set(q["expected"].get("policies", [])) | set(q["expected"].get("documents", []))
    out = {"doc_cov": round(len(got & req) / len(req), 4) if req else None}
    facts = GT[rec["id"]].get("facts") or []
    out["fact_cov"] = round(sum(1 for f in facts if re.search(f, text, re.I)) / len(facts), 4) if facts and text.strip() else (0.0 if facts else None)
    prec = q.get("precedence")
    if prec: out["precedence_ok"] = bool(all(p in text for p in prec) and re.search(r"overrid|prevail|supersed|instead of|rather than|notwithstanding|not the standard", text, re.I))
    ver = q.get("version")
    if ver: out["version_ok"] = bool(re.search(ver["must"], text) and not re.search(ver["must_not"], text))
    out["leak"] = leakage(rec)
    cites = re.findall(r"\(([A-Z]{2,3}-[A-Za-z0-9-]+?)(?: v([\d.]+))? §(\d+)\)", text)   # (CA-001 §2) / (MG-IT v2.0 §1)
    bad = [f"{d}{(' v' + v) if v else ''} §{n}" for d, v, n in cites if not any(g == f"harborline:{d}#{n}" or g == f"harborline:{d}@{v}#{n}" for g in got) and not d.startswith("POL")]
    out["doc_cite_acc"] = None if not [c for c in cites if not c[0].startswith("POL")] else round(1 - len(bad) / len([c for c in cites if not c[0].startswith("POL")]), 4); out["bad_doc_cites"] = bad
    if q.get("forbid_agreement"): out["ca_chunks"] = sum(1 for i in got if re.match(r"harborline:CA-\d+#", i))
    return out

def citation_present(rec):
    return bool(re.search(r"\((?:[A-Z]{2,3}-[A-Za-z0-9.-]+)(?: v[\d.]+)? §\d+", (rec.get("narrative") or "")))

def score(rec):
    q = Q[rec["id"]]; got = list(rec.get("retrieved_chunk_ids") or []); gs = set(got)
    out = {"R_recall": None, "R_precision": None, "table_cov": None, "policy_cov": None, "A": None, "ctrl_ok": None, "ctrl_note": None}
    cite, bad = citations(rec.get("narrative", "") + " " + rec.get("headline", ""), got)
    out["citation_acc"], out["bad_citations"] = cite, bad
    out.update(fidelity_scope(rec))
    if rec["id"] == "S02":   # D-048 ground-truth check: overall fail rate - no tier/SLA talk, no stated time window the SQL lacks
        txt = (rec.get("narrative") or "") + " " + (rec.get("headline") or "")
        out["s02_tier_mention"] = bool(TIER_WORDS.search(txt)); out["s02_ok"] = (not TIER_WORDS.search(txt)) and not out["window_bad"] and bool(rec.get("sql_valid"))
    if "control" in q:
        c = q["control"]; cross = [i for i in got if c.get("forbidden_prefix") and i.startswith(c["forbidden_prefix"])]
        foreign = [i for i in got if not i.startswith("harborline:")]
        out["cross_tenant_chunks"] = len(foreign)
        declined = bool(rec.get("refused")) or not rec.get("sql_valid")
        out["ctrl_ok"] = (len(foreign) == 0) and declined
        out["ctrl_note"] = f"cross-tenant chunks {len(foreign)}; " + ("declined" if declined else "ANSWERED (fabricated?)")
        return out
    exp = q["expected"]; req = set(exp["primary"]) | set(exp["tables"]) | set(exp.get("policies", [])) | set(exp.get("documents", []))
    if q["tier"] == "DOC": out.update(doc_scores(rec, q))
    hit = gs & req
    out["R_recall"] = round(len(hit) / len(req), 4) if req else None
    out["R_precision"] = round(len(hit) / len(gs), 4) if gs else 0.0
    out["table_cov"] = round(len(gs & set(exp["tables"])) / len(exp["tables"]), 4) if exp["tables"] else None
    pol = set(exp.get("policies", []))
    out["policy_cov"] = round(len(gs & pol) / len(pol), 4) if pol else None
    if GT[rec["id"]].get("doc_only"):   # D-048: answered from documents. 3 = NO_SQL (or SQL) answer with every expected fact and a cited document; 2 = all facts; 1 = some facts; 0 = none / API failure never reaches here
        fc = out.get("fact_cov") or 0.0; cited = rec.get("no_sql_cited") or citation_present(rec)
        out["A"] = 3 if (fc == 1.0 and cited) else 2 if fc == 1.0 else 1 if fc >= 0.5 else 0
    elif not GT[rec["id"]]["result"]:
        rows = rec.get("result_rows")
        out["A"] = 0 if (not rec.get("sql_valid") or rows is None) else (3 if len(rows) == 0 else 1)
    else:
        out["A"] = _ns["score_a"](rec)
    return out

def summarize(path):
    recs = [json.loads(l) for l in open(path) if l.strip()]
    mean = lambda xs: (sum(xs) / len(xs)) if xs else float("nan")
    print(f"\n{'id':4} {'Rrec':>5} {'Rprec':>6} {'tbl':>5} {'pol':>5} {'A':>2} {'cite':>5}  note")
    for r in recs:
        s = r["scoring"]; f = lambda v: "  -  " if v is None else f"{v:5.2f}"
        note = s.get("ctrl_note") or ""
        if s.get("bad_citations"): note += f" BAD CITES {s['bad_citations']}"
        print(f"{r['id']:4} {f(s['R_recall'])} {f(s['R_precision']):>6} {f(s['table_cov'])} {f(s['policy_cov'])} {('-' if s['A'] is None else s['A']):>2} {f(s['citation_acc'])}  {note}")
    print(f"\n{'tier':5}{'n':>3} {'Rrec':>6}{'Rprec':>7}{'tblCov':>8}{'polCov':>8}{'meanA':>7}{'SQLvalid':>9}{'refused':>8}")
    for t in ["S", "M", "H", "P", "C", "ALL"]:
        rs = [r for r in recs if t == "ALL" or r["tier"] == t]
        if not rs: continue
        g = lambda k: [r["scoring"][k] for r in rs if r["scoring"][k] is not None]
        v = sum(1 for r in rs if r["scoring"].get("sql_valid", r.get("sql_valid")))
        print(f"{t:5}{len(rs):>3} {mean(g('R_recall')):6.2f}{mean(g('R_precision')):7.2f}{mean(g('table_cov')):8.2f}{mean(g('policy_cov')):8.2f}{mean(g('A')):7.2f}{100*v/len(rs):8.0f}%{sum(1 for r in rs if r['scoring'].get('refused')):>8}")
    cc = [r["scoring"]["citation_acc"] for r in recs if r["scoring"]["citation_acc"] is not None]
    print(f"\ncitation accuracy: {mean(cc):.2f} over {len(cc)} answers that cited a policy; "
          f"answers with any citation: {len(cc)}/{len(recs)}; wrong citations: {sum(len(r['scoring']['bad_citations']) for r in recs)}")
    ctrl = [r for r in recs if r["tier"] == "C"]
    print(f"controls passed: {sum(1 for r in ctrl if r['scoring']['ctrl_ok'])}/{len(ctrl)}")



def multi(files):
    """D-048: aggregate N runs. mean and [min,max] of mean-A per tier, policy chunks, S01/S02/H05/H02 and fidelity/scope checks."""
    RUNS = [{r["id"]: r for r in map(json.loads, open(f)) if r} for f in files]; n = len(RUNS)
    mean = lambda xs: (sum(xs) / len(xs)) if xs else float("nan")
    npol = lambda r: sum(1 for i in r["retrieved_chunk_ids"] if ":POL-" in i)
    rng = lambda xs, fmt="{:.2f}": f"{fmt.format(mean(xs))}  [{fmt.format(min(xs))} - {fmt.format(max(xs))}]"
    CITES = lambda r: sorted(set(re.findall(r"POL-\d{3}\s*§\s*\d+", r.get("narrative") or "")))
    print(f"\nD-048: {n} runs of 30 questions")
    for t, nm in zip("SMHP", ["simple (8)", "medium (8)", "hard cross-area (5)", "hybrid (5)"]):
        print(f"  mean A {nm:22s}", rng([mean([r['scoring']['A'] for r in R.values() if r['tier'] == t]) for R in RUNS]))
    print(f"  mean A {'all answerable (26)':22s}", rng([mean([r['scoring']['A'] for r in R.values() if r['tier'] != 'C']) for R in RUNS]))
    print("  valid SQL (of 26)                 ", rng([sum(1 for r in R.values() if r['tier'] != 'C' and r['sql_valid']) for R in RUNS], "{:.0f}"))
    print("  policy chunks / question (mean)   ", rng([mean([npol(r) for r in R.values()]) for R in RUNS]))
    print("  policy chunks, 17 not needing one ", rng([mean([npol(r) for q, r in R.items() if not Q[q].get('expected', {}).get('policies') and r['tier'] != 'C']) for R in RUNS]))
    print("  policy chunks, 9 needing one      ", rng([mean([npol(r) for q, r in R.items() if Q[q].get('expected', {}).get('policies')]) for R in RUNS]))
    print("  questions with zero policy chunks ", rng([sum(1 for r in R.values() if npol(r) == 0) for R in RUNS], "{:.0f}"))
    print("  policy coverage (required)        ", rng([mean([r['scoring']['policy_cov'] for r in R.values() if r['scoring']['policy_cov'] is not None]) for R in RUNS]))
    print("  R_recall / R_precision            ", rng([mean([r['scoring']['R_recall'] for r in R.values() if r['scoring']['R_recall'] is not None]) for R in RUNS]), "/", rng([mean([r['scoring']['R_precision'] for r in R.values() if r['scoring']['R_precision'] is not None]) for R in RUNS]))
    print("  validator retries (total)         ", rng([sum(r['retry_count'] for r in R.values()) for R in RUNS], "{:.0f}"))
    for q in ("S01", "S02", "H05", "H02"):
        print(f"  {q} ({Q[q]['question'][:60]}...)")
        for i, R in enumerate(RUNS, 1):
            r = R[q]; sc = r["scoring"]
            extra = f" s02_ok={sc.get('s02_ok')} tier_words={sc.get('s02_tier_mention')}" if q == "S02" else ""
            print(f"     run{i}: A={sc['A']} valid={r['sql_valid']} rows={r['row_count']} (GT {len(GT[q]['result'])}) retries={r['retry_count']} policy_chunks={npol(r)} cites={CITES(r)} window_claims={sc['window_claims']}{extra}")
    print("FIDELITY / SCOPE (all 30 answers per run)")
    print("  answers stating a time window the SQL lacks ", rng([sum(1 for r in R.values() if r['scoring'].get('window_bad')) for R in RUNS], "{:.0f}"))
    print("  scope violations (policy/tier on wrong entity)", rng([sum(1 for r in R.values() if r['scoring'].get('scope_viol')) for R in RUNS], "{:.0f}"))
    print("  S02 check passes (no tier/SLA, no phantom window)", sum(1 for R in RUNS if R['S02']['scoring'].get('s02_ok')), "/", n)
    print("  citations: wrong", [sum(len(r['scoring']['bad_citations']) for r in R.values()) for R in RUNS], " answers citing a policy", [sum(1 for r in R.values() if r['scoring']['citation_acc'] is not None) for R in RUNS])
    print("  controls passed (of 4)", [sum(1 for r in R.values() if r['tier'] == 'C' and r['scoring']['ctrl_ok']) for R in RUNS], " P04/P05 A", [(R['P04']['scoring']['A'], R['P05']['scoring']['A']) for R in RUNS])
    for i, R in enumerate(RUNS, 1):
        for r in R.values():
            sc = r["scoring"]
            if sc.get("window_bad") or sc.get("scope_viol"): print(f"     run{i} {r['id']}: window={sc['window_claims'] if sc.get('window_bad') else '-'} scope={sc['scope_viol']}")

def ablate(specs):
    """D-047 ablation. specs: 'name=glob' ... Each glob = the N runs of one configuration. Per tier: mean and [min-max] across runs."""
    import glob
    mean = lambda xs: (sum(xs) / len(xs)) if xs else float("nan")
    cfgs = {}
    for sp in specs:
        name, pat = sp.split("=", 1); fs_ = sorted(glob.glob(pat))
        cfgs[name] = [{r["id"]: r for r in map(json.loads, open(f)) if r} for f in fs_]
    metrics = [("A", lambda r: r["scoring"]["A"]), ("R_recall", lambda r: r["scoring"]["R_recall"]), ("R_prec", lambda r: r["scoring"]["R_precision"]),
               ("pol_cov", lambda r: r["scoring"]["policy_cov"]), ("tok_in", lambda r: r["tokens_in"]), ("cost$", lambda r: r["cost_usd"])]
    for tier, tn in (("S", "simple"), ("M", "medium"), ("H", "hard"), ("P", "hybrid"), ("ALL", "all 26 answerable")):
        print(f"\n== {tn} ==   (mean [min-max] over runs of the per-run tier mean; tok_in/cost$ = per-question mean)")
        print(f"{'config':16}{'n':>2}" + "".join(f"{m:>26}" for m, _ in metrics))
        for name, RUNS in cfgs.items():
            cells = []
            for m, fn in metrics:
                per = []
                for R in RUNS:
                    xs = [fn(r) for r in R.values() if r["tier"] != "C" and (tier == "ALL" or r["tier"] == tier) and fn(r) is not None]
                    if xs: per.append(mean(xs))
                f = "{:.0f}" if m == "tok_in" else ("{:.4f}" if m == "cost$" else "{:.2f}")
                cells.append("-" if not per else f"{f.format(mean(per))} [{f.format(min(per))}-{f.format(max(per))}]")
            print(f"{name:16}{len(RUNS):>2}" + "".join(f"{c:>26}" for c in cells))
    print("\n== run totals ==")
    for name, RUNS in cfgs.items():
        print(f"{name:16} runs={len(RUNS)} cost/run " + ", ".join(f"${sum(r['cost_usd'] for r in R.values()):.3f}" for R in RUNS) + " | valid SQL/26 " + ", ".join(str(sum(1 for r in R.values() if r['tier'] != 'C' and r['sql_valid'])) for R in RUNS) + " | controls " + ", ".join(str(sum(1 for r in R.values() if r['tier'] == 'C' and r['scoring']['ctrl_ok'])) for R in RUNS) + " | policy chunks/q " + ", ".join(f"{mean([sum(1 for i in r['retrieved_chunk_ids'] if ':POL-' in i) for r in R.values()]):.1f}" for R in RUNS))

def compare(fa, fb, la="Run 1", lb="Run 2"):
    """Side-by-side of two run files (D-046): retrieval, policy load, accuracy by tier, citations, negative tests."""
    A = {r["id"]: r for r in map(json.loads, open(fa)) if r}; B = {r["id"]: r for r in map(json.loads, open(fb)) if r}
    mean = lambda xs: (sum(xs) / len(xs)) if xs else float("nan")
    npol = lambda r: sum(1 for i in r["retrieved_chunk_ids"] if ":POL-" in i)
    need = {q for q in Q if Q[q].get("expected", {}).get("policies")}
    def cites(r): return {f"harborline:POL-{d}#{s}" for d, s in re.findall(r"POL-(\d{3})\s*§\s*(\d+)", (r.get("narrative") or ""))}
    def stats(R):
        ans = [r for r in R.values() if r["tier"] != "C"]
        f = lambda k: mean([r["scoring"][k] for r in ans if r["scoring"][k] is not None])
        cit = [r for r in R.values() if cites(r)]
        return {
            "R_recall": f("R_recall"), "R_precision": f("R_precision"), "table_cov": f("table_cov"), "policy_cov": f("policy_cov"),
            "pol_mean": mean([npol(r) for r in R.values()]), "pol_min": min(npol(r) for r in R.values()), "pol_max": max(npol(r) for r in R.values()),
            "pol_need": mean([npol(r) for q, r in R.items() if q in need]), "pol_noneed": mean([npol(r) for q, r in R.items() if q not in need and r["tier"] != "C"]),
            "pol_zero": sum(1 for r in R.values() if npol(r) == 0),
            "A": {t: mean([r["scoring"]["A"] for r in ans if r["tier"] == t]) for t in "SMHP"}, "A_all": mean([r["scoring"]["A"] for r in ans]),
            "valid": sum(1 for r in ans if r["sql_valid"]), "n": len(ans),
            "cite_ans": len(cit), "cite_acc": mean([r["scoring"]["citation_acc"] for r in cit]), "bad": sum(len(r["scoring"]["bad_citations"]) for r in R.values()),
            "unneeded": sum(1 for r in cit if r["id"] not in need),
            "need_cited": sum(1 for q in need if cites(R[q]) & set(Q[q]["expected"]["policies"])),
            "S01_cites": bool(cites(R["S01"])), "S01_pol": npol(R["S01"]),
            "ctrl": sum(1 for r in R.values() if r["tier"] == "C" and r["scoring"]["ctrl_ok"]),
            "cost": sum(r["cost_usd"] for r in R.values()), "retries": sum(r["retry_count"] for r in R.values()),
        }
    a, b = stats(A), stats(B)
    row = lambda name, x, y, fmt="{:.2f}": print(f"  {name:44s}{fmt.format(x):>10}{fmt.format(y):>10}")
    print(f"\n{'':46s}{la:>10}{lb:>10}")
    print("RETRIEVAL (26 answerable)"); row("R_recall", a["R_recall"], b["R_recall"]); row("R_precision", a["R_precision"], b["R_precision"])
    row("table coverage", a["table_cov"], b["table_cov"]); row("policy coverage (9 questions needing a policy)", a["policy_cov"], b["policy_cov"])
    print("POLICY CHUNKS PER QUESTION (30)"); row("mean", a["pol_mean"], b["pol_mean"]); row("  on the 9 needing a policy (mean)", a["pol_need"], b["pol_need"])
    row("  on the 17 not needing one (mean)", a["pol_noneed"], b["pol_noneed"]); row("min / max", a["pol_min"], b["pol_min"], "{}"); row("max", a["pol_max"], b["pol_max"], "{}"); row("questions with zero policy chunks", a["pol_zero"], b["pol_zero"], "{}")
    print("ANSWER ACCURACY (mean A, 0-3)")
    for t, n in zip("SMHP", ["simple (8)", "medium (8)", "hard cross-area (5)", "hybrid (5)"]): row(n, a["A"][t], b["A"][t])
    row("all answerable (26)", a["A_all"], b["A_all"]); row("valid SQL (of 26)", a["valid"], b["valid"], "{}"); row("validator retries (total)", a["retries"], b["retries"], "{}")
    print("CITATIONS"); row("answers that cite a policy (of 30)", a["cite_ans"], b["cite_ans"], "{}"); row("citation accuracy (cited was retrieved)", a["cite_acc"], b["cite_acc"])
    row("wrong citations", a["bad"], b["bad"], "{}"); row("citing answers on questions needing NO policy", a["unneeded"], b["unneeded"], "{}")
    row("required policy cited (of 9 needing one)", a["need_cited"], b["need_cited"], "{}")
    print(f"  S01 still cites a policy?                   {str(a['S01_cites']):>10}{str(b['S01_cites']):>10}   (policy chunks retrieved for S01: {a['S01_pol']} -> {b['S01_pol']})")
    print("NEGATIVE TESTS (right answer is 'none')")
    for q in ("P04", "P05"): print(f"  {q}: rows returned {A[q]['row_count']} -> {B[q]['row_count']} | A {A[q]['scoring']['A']} -> {B[q]['scoring']['A']} | headline: {B[q]['headline'][:70]!r}")
    row("controls passed (of 4)", a["ctrl"], b["ctrl"], "{}"); row("est. cost USD", a["cost"], b["cost"], "{:.3f}")
    print("PER-QUESTION A changes:", {q: (A[q]['scoring']['A'], B[q]['scoring']['A']) for q in A if A[q]['scoring']['A'] != B[q]['scoring']['A']} or "none")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--ablate": ablate(sys.argv[2:])
    elif len(sys.argv) > 2 and sys.argv[1] == "--multi": multi(sys.argv[2:])
    elif len(sys.argv) > 3 and sys.argv[1] == "--compare": compare(sys.argv[2], sys.argv[3])
    elif len(sys.argv) > 2 and sys.argv[1] == "--summarize": summarize(sys.argv[2])
    else: print(json.dumps(score(json.load(sys.stdin))))
