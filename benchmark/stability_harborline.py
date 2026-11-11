"""D-047/D-048 demo stability: POST each question N times to <base>/api/ask, compare results, run scope/fidelity checks.
usage: python3 benchmark/stability_harborline.py <base_url> <out.json> [N] [q1|q2|...]   (run from repo root; no secrets used)"""
import json, sys, time, re, urllib.request, importlib.util
base, out = sys.argv[1].rstrip("/"), sys.argv[2]; N = int(sys.argv[3]) if len(sys.argv) > 3 else 3
QS = sys.argv[4].split("|") if len(sys.argv) > 4 else [
 "What is our overall settlement fail rate?", "What are our total assets under custody?",
 "Which counterparties' settlement fails cost us the most in penalties?", "Which Platinum clients missed their SLA settlement target last month?",
 "Which corporate action elections did we miss, and what was the notice window?", "Which counterparties meet our tier-D criteria?",
 "What is our trading desk's P&L?"]
spec = importlib.util.spec_from_file_location("sh", "benchmark/score_harborline.py"); sh = importlib.util.module_from_spec(spec); spec.loader.exec_module(sh)
def post(q):
    req = urllib.request.Request(base + "/api/ask", data=json.dumps({"question": q}).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {"error": "http_error"}
    except Exception as e: return 0, {"error": str(e)[:100]}

MONEY_TOK = re.compile(r"\$\s?(\d[\d,]*\.?\d*)\s?(K|M|B|thousand|million|billion)?\b", re.I)
SCALE = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "b": 1e9, "billion": 1e9}
def unit_flags(text, rows):
    """D-049: a $ figure in the narration that is ~1000x (or 1/1000) a number in the result rows is a unit error (e.g. $416K -> '$416M')."""
    vals = [abs(float(c)) for r in (rows or []) for c in r if isinstance(c, (int, float)) and not isinstance(c, bool) and abs(float(c)) >= 1000]
    # also sums the narrator may quote: running totals (top-N) of each numeric column and the column total
    for j in range(max((len(r) for r in (rows or [])), default=0)):
        col = [float(r[j]) for r in rows if len(r) > j and isinstance(r[j], (int, float)) and not isinstance(r[j], bool)]
        if len(col) == len(rows) and col: vals += [abs(sum(col[:n])) for n in range(2, len(col) + 1) if abs(sum(col[:n])) >= 1000]
    bad = []
    for m in MONEY_TOK.finditer(text or ""):
        n = float(m.group(1).replace(",", "")) * SCALE.get((m.group(2) or "").lower(), 1)
        if n and any(abs(n / v - 1000) / 1000 < 0.02 or abs(n / v - 0.001) / 0.001 < 0.02 for v in vals): bad.append(m.group(0).strip())
    return bad
def outcome(r):
    """valid answer | declined (a deliberate refusal) | failed (any other error, incl. HTTP 500 sql_execution_failed)."""
    if r["valid"]: return "valid"
    return "declined" if r["error"] in ("no_sql_generated",) else "failed"
res = []
for q in QS:
    runs = []
    for i in range(N):
        st, d = post(q); time.sleep(1)
        if re.search(r"credit balance is too low|rate_limit_error|overloaded_error|invalid_request_error", str(d.get("detail") or "") + str(d.get("error") or ""), re.I):
            print("ABORTED: API credits/limits - not scored"); sys.exit(3)   # an API failure is never a wrong answer
        ok = st == 200 and not d.get("error")
        fs = sh.fidelity_scope({"narrative": d.get("narrative"), "headline": d.get("headline"), "sql": d.get("sql"), "question": q}) if ok else {}
        runs.append({"status": st, "valid": ok, "error": d.get("error"), "detail": (d.get("detail") or "")[:120], "headline": d.get("headline"), "narrative": d.get("narrative"), "sql": d.get("sql"),
                     "rows": d.get("rows"), "row_count": d.get("row_count"), "retries": (d.get("validation") or {}).get("retry_count"), "flags": fs, "status_code": st,
                     "unit_flags": unit_flags((d.get("headline") or "") + " " + (d.get("narrative") or ""), d.get("rows")) if ok else [], "scope_check": d.get("scope_check")})
    valid = [r["valid"] for r in runs]
    sig = lambda r: json.dumps(r["rows"], sort_keys=True) if r["valid"] else "DECLINE:" + str(r["error"])
    same_rows = len({sig(r) for r in runs}) == 1
    same_head = len({r["headline"] for r in runs}) == 1
    flags = [f for r in runs for f in (["window:" + ",".join(r["flags"]["window_claims"])] if r["flags"].get("window_bad") else []) + r["flags"].get("scope_viol", []) + (["unit:" + ",".join(r["unit_flags"])] if r["unit_flags"] else [])]
    s02 = []
    if q.startswith("What is our overall settlement fail rate"):
        for r in runs:
            if r["valid"] and sh.TIER_WORDS.search((r["narrative"] or "") + " " + (r["headline"] or "")): s02.append("tier/SLA mention")
    flags += s02
    res.append({"question": q, "same_rows": same_rows, "same_headline_text": same_head, "all_valid": all(valid), "flags": flags,
                "outcomes": [outcome(r) for r in runs], "http_500_non_refusal": sum(1 for r in runs if r["status_code"] == 500 and outcome(r) == "failed"),
                "verdict": ("STABLE-FAIL" if all(outcome(r) == "failed" for r in runs) else "STABLE" if (same_rows and not flags and not any(r["unit_flags"] for r in runs) and len({outcome(r) for r in runs}) == 1) else "UNSTABLE"),
                "runs": runs})
    print(f"{res[-1]['verdict']:9} rows_same={same_rows} headline_same={same_head} valid={valid} flags={flags} | {q}")
json.dump(res, open(out, "w"), indent=1)
