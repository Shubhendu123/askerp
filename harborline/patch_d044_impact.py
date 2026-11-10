"""
AskERP D-044 patch - rescale cae_client_election.estimated_client_impact_usd on missed elections to 0.1-1% of
position value, capped at USD 5M. Seeded and deterministic: rebuilds the generator into a scratch DuckDB file
(HL_DB), asserts every other election column is identical to the live table, then UPDATEs only the impact column.
Run from repo root:  python3 harborline/patch_d044_impact.py
"""
import os, subprocess, sys, tempfile
from pathlib import Path
import duckdb
ROOT = Path(__file__).resolve().parent.parent
live = duckdb.connect(str(ROOT / "data" / "northwind.db"))
tmp = Path(tempfile.mkdtemp()) / "scratch.db"
subprocess.run([sys.executable, str(ROOT / "harborline" / "gen" / "generate_harborline.py")], check=True,
               env={**os.environ, "HL_DB": str(tmp)}, stdout=subprocess.DEVNULL)
live.execute(f"ATTACH '{tmp}' AS scratch (READ_ONLY)")
cols = "election_key,event_key,client_key,security_key,entitled_quantity,election_status,elected_date_key,deadline_date_key,hours_before_deadline,missed_deadline"
diff = live.execute(f"select count(*) from (select {cols} from harborline.cae_client_election except select {cols} from scratch.harborline.cae_client_election)").fetchone()[0]
assert diff == 0, f"non-impact columns differ in {diff} rows - refusing to patch"
live.execute("""update harborline.cae_client_election x set estimated_client_impact_usd = s.estimated_client_impact_usd
  from scratch.harborline.cae_client_election s where x.election_key = s.election_key""")
print("patched rows:", live.execute("select count(*) from harborline.cae_client_election where missed_deadline").fetchone()[0], "missed elections")
