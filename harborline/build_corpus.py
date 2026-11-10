"""D-048 corpus build (run from repo root): render templated documents from the warehouse and assert entity resolution.
  python3 harborline/build_corpus.py          # render harborline/corpus/** templates -> harborline/corpus_rendered/, then verify
Templates stay in harborline/corpus/ (source); rendered copies go to harborline/corpus_rendered/ (what retrieval loads).
Fails (exit 1) when a placeholder is unresolved, an entity does not resolve to a warehouse key, or a rendered date/rate != the warehouse row."""
import duckdb, re, sys, yaml, pathlib, datetime
ROOT = pathlib.Path("harborline"); SRC = ROOT / "corpus"; OUT = ROOT / "corpus_rendered"
con = duckdb.connect("data/northwind.db", read_only=True)
def fm_of(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S); return yaml.safe_load(m.group(1)) if m else None
def iso(k): s = str(k); return f"{s[:4]}-{s[4:6]}-{s[6:]}"
ev = {r[0]: r for r in con.execute("""select e.event_key,e.event_ref,s.security_name,s.isin,e.announcement_date_key,e.record_date_key,e.response_deadline_date_key,
   e.payment_date_key,e.notice_window_days,e.gross_rate_per_share,s.local_currency from harborline.cae_event e join harborline.dim_security s using(security_key)""").fetchall()}
bdays = [r[0] for r in con.execute("select date_key from harborline.dim_date where is_business_day order by 1").fetchall()]
def plus_bd(k, n):
    nxt = [d for d in bdays if d > k]; return nxt[n - 1]
def vals_chk(dl):
    return iso(plus_bd(dl, 3))
errors = []; rendered = {}
for f in sorted(SRC.rglob("*.md")):
    t = f.read_text(); fm = fm_of(t)
    if fm is None: errors.append(f"{f}: no frontmatter"); continue
    if "{{" not in t: continue
    ek = (fm.get("entities") or {}).get("event_key")
    if ek not in ev: errors.append(f"{f}: event_key {ek} not in cae_event"); continue
    _, ref, sec, isin, ann, rec, dl, pay, nw, rate, ccy = ev[ek]
    vals = {"SECURITY_NAME": sec, "ISIN": isin, "EVENT_REF": ref, "ANNOUNCEMENT_DATE": iso(ann), "RECORD_DATE": iso(rec), "RESPONSE_DEADLINE": iso(dl),
            "PAYMENT_DATE": iso(pay), "NOTICE_WINDOW_DAYS": str(nw), "RATE": f"{ccy} {float(rate):.4f}".rstrip("0").rstrip("."), "RESPONSE_DEADLINE_PLUS_3BD": iso(plus_bd(dl, 3))}
    out = t
    for k, v in vals.items(): out = out.replace("{{" + k + "}}", v)
    left = re.findall(r"\{\{[A-Z_0-9]+\}\}", out)
    if left: errors.append(f"{f}: unresolved placeholders {sorted(set(left))}"); continue
    dest = OUT / f.relative_to(SRC); dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(out); rendered[f] = (dest, ek, vals)
# gate: every rendered date and rate equals the warehouse row
print(f"rendered {len(rendered)} templated documents -> {OUT}")
for f, (dest, ek, vals) in rendered.items():
    txt = dest.read_text(); row = con.execute("select announcement_date_key,record_date_key,response_deadline_date_key,payment_date_key,notice_window_days,gross_rate_per_share from harborline.cae_event where event_key=?", [ek]).fetchone()
    src = f.read_text(); has = lambda ph: ("{{" + ph + "}}") in src
    checks = {}
    if has("ANNOUNCEMENT_DATE"): checks["announcement"] = iso(row[0]) in txt
    if has("RECORD_DATE"): checks["record"] = iso(row[1]) in txt
    if has("RESPONSE_DEADLINE"): checks["deadline"] = iso(row[2]) in txt
    if has("PAYMENT_DATE"): checks["payment"] = iso(row[3]) in txt
    if has("NOTICE_WINDOW_DAYS"): checks["notice"] = f"{row[4]} business days" in txt
    if has("RATE"): checks["rate"] = f"{float(row[5]):.4f}".rstrip("0").rstrip(".") in txt
    if has("RESPONSE_DEADLINE_PLUS_3BD"): checks["deadline+3bd"] = vals_chk(row[2]) in txt
    bad = [k for k, v in checks.items() if not v]
    print(f"  {f.name:48} event {ek}: dates/rate match warehouse: {'YES' if not bad else 'NO ' + str(bad)}"); errors += [f"{f.name}: {b} mismatch" for b in bad]
# entity resolution (every document, templated or not, policies included)
cl = {r[0] for r in con.execute("select client_name from harborline.dim_client").fetchall()}
cp = {r[0] for r in con.execute("select counterparty_name from harborline.dim_counterparty").fetchall()}
mk = {r[0] for r in con.execute("select market_code from harborline.dim_market").fetchall()}
evk = {r[0] for r in con.execute("select event_key from harborline.cae_event").fetchall()}
n = 0
for f in sorted(list(SRC.rglob("*.md")) + list((ROOT / "policies").glob("POL-*.md"))):
    fm = fm_of(f.read_text()); n += 1
    for kind, val in (fm.get("entities") or {}).items():
        pool = {"client": cl, "client_impacted": cl, "counterparty": cp, "market": mk, "markets": mk, "event_key": evk}.get(kind)
        if pool is None: errors.append(f"{f.name}: unknown entity kind '{kind}'"); continue
        for v in (val if isinstance(val, list) else [val]):
            if v not in pool: errors.append(f"{f.name}: entity {kind}='{v}' does not resolve")
print(f"entity resolution: {n} documents checked")
if errors:
    print("FAIL"); [print(" -", e) for e in errors]; sys.exit(1)
print("OK: corpus build passes (placeholders resolved, dates/rates equal the warehouse, all entities resolve)")
