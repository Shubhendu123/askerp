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

def score(rec):
    q = Q[rec["id"]]; got = list(rec.get("retrieved_chunk_ids") or []); gs = set(got)
    out = {"R_recall": None, "R_precision": None, "table_cov": None, "policy_cov": None, "A": None, "ctrl_ok": None, "ctrl_note": None}
    cite, bad = citations(rec.get("narrative", "") + " " + rec.get("headline", ""), got)
    out["citation_acc"], out["bad_citations"] = cite, bad
    if "control" in q:
        c = q["control"]; cross = [i for i in got if c.get("forbidden_prefix") and i.startswith(c["forbidden_prefix"])]
        foreign = [i for i in got if not i.startswith("harborline:")]
        out["cross_tenant_chunks"] = len(foreign)
        declined = bool(rec.get("refused")) or not rec.get("sql_valid")
        out["ctrl_ok"] = (len(foreign) == 0) and declined
        out["ctrl_note"] = f"cross-tenant chunks {len(foreign)}; " + ("declined" if declined else "ANSWERED (fabricated?)")
        return out
    exp = q["expected"]; req = set(exp["primary"]) | set(exp["tables"]) | set(exp.get("policies", []))
    hit = gs & req
    out["R_recall"] = round(len(hit) / len(req), 4) if req else None
    out["R_precision"] = round(len(hit) / len(gs), 4) if gs else 0.0
    out["table_cov"] = round(len(gs & set(exp["tables"])) / len(exp["tables"]), 4) if exp["tables"] else None
    pol = set(exp.get("policies", []))
    out["policy_cov"] = round(len(gs & pol) / len(pol), 4) if pol else None
    if not GT[rec["id"]]["result"]:
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
    if len(sys.argv) > 3 and sys.argv[1] == "--compare": compare(sys.argv[2], sys.argv[3])
    elif len(sys.argv) > 2 and sys.argv[1] == "--summarize": summarize(sys.argv[2])
    else: print(json.dumps(score(json.load(sys.stdin))))
