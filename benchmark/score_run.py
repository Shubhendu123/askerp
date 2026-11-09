"""
Scoring bridge for the eval harness (D-040). Reuses the D-036 scorer in build_report.py
verbatim: executes only the definitions block (everything before "# ── score all runs"),
so no second scorer exists and build_report.py is untouched.
stdin: one JSON record {id, mode, retrieved_chunk_ids, sql_valid, refused, result_rows}
stdout: {"R":..,"A":..,"ctrl_ok":..}
Run from repo root.
"""
import json, sys

src = open("benchmark/build_report.py", encoding="utf-8").read()
ns = {"__name__": "build_report_defs"}
exec(compile(src.split("# ── score all runs")[0], "build_report.py", "exec"), ns)

rec = json.load(sys.stdin)
rec.setdefault("refused", False)
out = {"R": ns["score_r"](rec), "A": ns["score_a"](rec), "ctrl_ok": None}
if "control" in ns["questions"][rec["id"]]:
    out["ctrl_ok"], _ = ns["control_pass"](rec)
print(json.dumps(out))
