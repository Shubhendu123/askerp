"""Re-score existing run files with the D-041 rubric (no model calls). Run from repo root:
   python3 benchmark/rescore.py [benchmark/runs/*.jsonl]   -- never modifies run files."""
import json, sys, glob
sys.path.insert(0, "benchmark")
from score_run import score_retrieval

files = sys.argv[1:] or sorted(glob.glob("benchmark/runs/*.jsonl"))
rows = []
for f in files:
    recs = [json.loads(l) for l in open(f) if l.strip()]
    sc = [score_retrieval(r["id"], (r.get("retrieval") or {}).get("chunk_ids") or r.get("retrieved_chunk_ids"), r["mode"]) for r in recs]
    sc = [s for s in sc if s["R_recall"] is not None]
    m = lambda xs: sum(xs) / len(xs)
    leg = [(r.get("scoring") or {}).get("R", (r.get("scoring") or {}).get("R_legacy")) for r in recs]
    rows.append((recs[0]["label"], recs[0]["k"], m([s["R_legacy"] for s in sc]), m([s["R_recall"] for s in sc]),
                 m([s["R_precision"] for s in sc]), m([s["required_tables_retrieved"]["share"] for s in sc]),
                 m([l for l in leg if l is not None])))
print(f"{'run label':<18}{'k':>3}{'R_legacy':>10}{'R_recall':>10}{'R_prec':>8}{'tblCov':>8}   (R_legacy stored in file)")
for lab, k, l, rc, rp, tc, stored in sorted(rows, key=lambda r: (r[1], r[0])):
    print(f"{lab:<18}{k:>3}{l:>10.2f}{rc:>10.3f}{rp:>8.3f}{tc:>8.3f}   ({stored:.2f})")
