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
res = []
for q in QS:
    runs = []
    for i in range(N):
        st, d = post(q); time.sleep(1)
        ok = st == 200 and not d.get("error")
        fs = sh.fidelity_scope({"narrative": d.get("narrative"), "headline": d.get("headline"), "sql": d.get("sql"), "question": q}) if ok else {}
        runs.append({"status": st, "valid": ok, "error": d.get("error"), "detail": (d.get("detail") or "")[:120], "headline": d.get("headline"), "narrative": d.get("narrative"), "sql": d.get("sql"),
                     "rows": d.get("rows"), "row_count": d.get("row_count"), "retries": (d.get("validation") or {}).get("retry_count"), "flags": fs})
    valid = [r["valid"] for r in runs]
    sig = lambda r: json.dumps(r["rows"], sort_keys=True) if r["valid"] else "DECLINE:" + str(r["error"])
    same_rows = len({sig(r) for r in runs}) == 1
    same_head = len({r["headline"] for r in runs}) == 1
    flags = [f for r in runs for f in (["window:" + ",".join(r["flags"]["window_claims"])] if r["flags"].get("window_bad") else []) + r["flags"].get("scope_viol", [])]
    s02 = []
    if q.startswith("What is our overall settlement fail rate"):
        for r in runs:
            if r["valid"] and sh.TIER_WORDS.search((r["narrative"] or "") + " " + (r["headline"] or "")): s02.append("tier/SLA mention")
    flags += s02
    res.append({"question": q, "same_rows": same_rows, "same_headline_text": same_head, "all_valid": all(valid), "flags": flags,
                "verdict": "STABLE" if (same_rows and not flags and (all(valid) or not any(valid))) else "UNSTABLE", "runs": runs})
    print(f"{res[-1]['verdict']:9} rows_same={same_rows} headline_same={same_head} valid={valid} flags={flags} | {q}")
json.dump(res, open(out, "w"), indent=1)
