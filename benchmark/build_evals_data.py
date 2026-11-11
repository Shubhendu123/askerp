"""D-049: build evals/evals_data.json for the /evals page. EVERY number is derived from committed files - nothing is typed in.
  headline   <- benchmark/runs_harborline/harborline_d048_run{1,2,3}_*.jsonl (the 3 rrf/k=10 runs on the fixed code; scored records)
  ablation   <- the mode-ablation table in DECISIONS.md (D-047 section)
  stability  <- benchmark/stability_d049.json (D-049 step-6 runs; verdicts computed by benchmark/stability_harborline.py)
  problems   <- the "Problems found and fixed" table in DECISIONS.md (D-049 section); every ADR id is checked to exist
  mro        <- benchmark/mro_retrieval_check_d049.json (retrieval-only MRO S02/M08 vs the D-044 baseline)
usage (repo root): python3 benchmark/build_evals_data.py"""
import glob, json, os, re, sys

DEC = open("DECISIONS.md", encoding="utf-8").read()
mean = lambda xs: sum(xs) / len(xs)


def headline():
    files = sorted(glob.glob("benchmark/runs_harborline/harborline_d048_run[123]_*.jsonl"))
    assert len(files) == 3, f"expected 3 headline runs, found {len(files)}"
    runs = [{r["id"]: r for r in map(json.loads, open(f)) if r} for f in files]
    tiers = {"S": "simple", "M": "medium", "H": "hard cross-area", "P": "hybrid"}
    per_tier = {}
    for t, nm in tiers.items():
        xs = [mean([r["scoring"]["A"] for r in R.values() if r["tier"] == t]) for R in runs]
        per_tier[nm] = {"mean": mean(xs), "min": min(xs), "max": max(xs), "n_questions": sum(1 for r in runs[0].values() if r["tier"] == t)}
    allx = [mean([r["scoring"]["A"] for r in R.values() if r["tier"] != "C"]) for R in runs]
    valid = [sum(1 for r in R.values() if r["tier"] != "C" and r["sql_valid"]) for R in runs]
    ctrl = [sum(1 for r in R.values() if r["tier"] == "C" and r["scoring"]["ctrl_ok"]) for R in runs]
    return {"files": [os.path.basename(f) for f in files], "n_runs": 3, "n_answerable": sum(1 for r in runs[0].values() if r["tier"] != "C"),
            "A_all": {"mean": mean(allx), "min": min(allx), "max": max(allx), "per_run": allx},
            "valid_sql": {"mean": mean(valid), "min": min(valid), "max": max(valid)}, "controls_passed": ctrl, "per_tier": per_tier}


def ablation():
    sec = DEC[DEC.index("## D-047"):DEC.index("## D-048")]
    lines = [l for l in sec.split("\n") if l.startswith("|")]
    hdr = [c.strip() for c in lines[0].strip("|").split("|")]
    assert hdr[0] == "mode", hdr
    rows = []
    for l in lines[2:]:
        cells = [c.strip().replace("**", "") for c in l.strip("|").split("|")]
        if len(cells) != len(hdr) or cells[0] not in ("rrf", "dense", "bm25", "schema"):
            continue
        rows.append(dict(zip(hdr, cells)))
    cost = lambda r: float(r["cost / run"].lstrip("$"))
    base = next(r for r in rows if r["mode"] == "rrf")
    for r in rows:
        m = re.match(r"([\d.]+)(?:\s*\[([\d.]+)[–-]([\d.]+)\])?", r["A all-26"])
        r["A_mean"] = float(m.group(1)); r["A_min"] = float(m.group(2) or m.group(1)); r["A_max"] = float(m.group(3) or m.group(1))
        r["relative_cost"] = round(cost(r) / cost(base), 2)
    return {"columns": hdr, "rows": rows, "source": "DECISIONS.md D-047"}


def problems():
    sec = DEC[DEC.index("## D-049"):]
    m = re.search(r"\*\*Problems found and fixed\.\*\*\s*\n((?:\|.*\n?)+)", sec)
    assert m, "D-049 'Problems found and fixed' table missing in DECISIONS.md"
    out = []
    for l in m.group(1).strip().split("\n")[2:]:
        c = [x.strip() for x in l.strip("|").split("|")]
        adr = re.findall(r"D-\d{3}", c[2])
        for a in adr:
            assert re.search(rf"^#+ {a}\b", DEC, re.M), f"{a} is not an ADR heading in DECISIONS.md"
        out.append({"problem": c[0], "fix": c[1], "adr": c[2]})
    assert len(out) == 4, f"expected 4 rows, got {len(out)}"
    return out


def stability():
    p = "benchmark/stability_d049.json"
    if not os.path.exists(p):
        return None
    res = json.load(open(p))
    return [{"question": r["question"], "verdict": r["verdict"], "rows_same": r["same_rows"], "headline_same": r["same_headline_text"], "outcomes": r.get("outcomes"),
             "flags": r["flags"], "http_500_non_refusal": r.get("http_500_non_refusal", 0), "n_runs": len(r["runs"])} for r in res]


def mro():
    p = "benchmark/mro_retrieval_check_d049.json"
    return json.load(open(p)) if os.path.exists(p) else None


data = {"headline": headline(), "ablation": ablation(), "stability": stability(), "problems": problems(), "mro_retrieval": mro()}
os.makedirs("evals", exist_ok=True)
json.dump(data, open("evals/evals_data.json", "w"), indent=1)
print("wrote evals/evals_data.json:", {k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in data.items()})
