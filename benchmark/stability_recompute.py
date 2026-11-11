"""D-049: recompute stability verdicts offline from a saved stability JSON (no server, no LLM call).
usage: python3 benchmark/stability_recompute.py benchmark/stability_d049.json   (repo root)
Adds same_rows_as_set (order-insensitive) next to the strict order-sensitive same_rows; the verdict stays STRICT."""
import json, re, sys, importlib.util
src = open("benchmark/stability_harborline.py").read()
ns = {"re": re}; exec(src[src.index("MONEY_TOK"):src.index("res = []")], ns)
spec = importlib.util.spec_from_file_location("sh", "benchmark/score_harborline.py"); sh = importlib.util.module_from_spec(spec); spec.loader.exec_module(sh)
path = sys.argv[1]; res = json.load(open(path))
for r in res:
    runs = r["runs"]
    for x in runs:
        x["unit_flags"] = ns["unit_flags"]((x.get("headline") or "") + " " + (x.get("narrative") or ""), x.get("rows")) if x["valid"] else []
        x["flags"] = sh.fidelity_scope({"narrative": x.get("narrative"), "headline": x.get("headline"), "sql": x.get("sql"), "question": r["question"]}) if x["valid"] else {}
    sig = lambda x: json.dumps(x["rows"], sort_keys=True) if x["valid"] else "DECLINE:" + str(x["error"])
    sigset = lambda x: json.dumps(sorted(json.dumps(v, sort_keys=True) for v in (x["rows"] or [])) if x["valid"] else "DECLINE:" + str(x["error"]))
    r["same_rows"] = len({sig(x) for x in runs}) == 1
    r["same_rows_as_set"] = len({sigset(x) for x in runs}) == 1
    r["flags"] = [f for x in runs for f in (["window:" + ",".join(x["flags"]["window_claims"])] if x["flags"].get("window_bad") else []) + x["flags"].get("scope_viol", []) + (["unit:" + ",".join(x["unit_flags"])] if x["unit_flags"] else [])]
    r["outcomes"] = [ns["outcome"](x) for x in runs]
    r["verdict"] = "STABLE-FAIL" if all(o == "failed" for o in r["outcomes"]) else "STABLE" if (r["same_rows"] and not r["flags"] and len(set(r["outcomes"])) == 1) else "UNSTABLE"
    print(f'{r["verdict"]:11} strict_rows_same={r["same_rows"]} as_set={r["same_rows_as_set"]} outcomes={r["outcomes"]} flags={r["flags"]} | {r["question"][:62]}')
json.dump(res, open(path, "w"), indent=1)
