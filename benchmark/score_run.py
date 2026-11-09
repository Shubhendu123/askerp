"""
Scoring bridge for the eval harness (D-040, extended D-041). Reuses the D-036 scorer in
build_report.py verbatim: executes only the definitions block (everything before
"# ── score all runs"), so no second legacy scorer exists and build_report.py is untouched.

D-041 R rubric split (the legacy 0-5 R conflated recall and precision):
  R_legacy    = the D-036 0-5 score, unchanged
  R_recall    = |required ∩ retrieved| / |required|     (required = expected primary ∪ tables)
  R_precision = |required ∩ retrieved| / |retrieved|
  required_tables_retrieved = {count, total, share} over expected.tables only
`extra` chunks are non-penalizing in legacy; here they are NOT required, and a retrieved
`extra` chunk is not counted as a hit for precision (strict: precision = share of retrieved
chunks that are required). Control questions score None.

stdin: one JSON record {id, mode, retrieved_chunk_ids, sql_valid, refused, result_rows}
stdout: {"R_legacy","R_recall","R_precision","required_tables_retrieved","A","ctrl_ok"}
Run from repo root.
"""
import json, sys

src = open("benchmark/build_report.py", encoding="utf-8").read()
_ns = {"__name__": "build_report_defs"}
exec(compile(src.split("# ── score all runs")[0], "build_report.py", "exec"), _ns)
_questions = _ns["questions"]


def score_retrieval(qid, retrieved_ids, mode="dense"):
    q = _questions[qid]
    if "control" in q:
        return {"R_legacy": None, "R_recall": None, "R_precision": None, "required_tables_retrieved": None}
    exp = q["expected"]
    got = set(retrieved_ids or [])
    required = set(exp["primary"]) | set(exp["tables"])
    tables = set(exp["tables"])
    hit = got & required
    th = got & tables
    legacy = _ns["score_r"]({"id": qid, "mode": mode, "retrieved_chunk_ids": list(got)})
    return {
        "R_legacy": legacy,
        "R_recall": round(len(hit) / len(required), 4) if required else None,
        "R_precision": round(len(hit) / len(got), 4) if got else 0.0,
        "required_tables_retrieved": {
            "count": len(th), "total": len(tables),
            "share": round(len(th) / len(tables), 4) if tables else None,
        },
    }


def score_record(rec):
    rec.setdefault("refused", False)
    out = score_retrieval(rec["id"], rec.get("retrieved_chunk_ids"), rec.get("mode", "dense"))
    out["A"] = _ns["score_a"](rec)
    out["ctrl_ok"] = None
    if "control" in _questions[rec["id"]]:
        out["ctrl_ok"], _ = _ns["control_pass"](rec)
    return out


if __name__ == "__main__":
    print(json.dumps(score_record(json.load(sys.stdin))))
