"""
AskERP D-044 - upload schema harborline to MotherDuck (database askerp), table by table (D-037 pattern).
Creates the schema from harborline/ddl/harborline.sql, then inserts each table from the local DB in FK order.
Token comes from the environment (MOTHERDUCK_TOKEN); it is never read from disk, printed, or persisted here.
Run from repo root after `set -a; source .env.local; set +a`:  python3 harborline/upload_to_motherduck.py
"""
import os, time
from pathlib import Path
import duckdb

tok = os.environ.get("MOTHERDUCK_TOKEN")
if not tok: raise SystemExit("MOTHERDUCK_TOKEN not set in the environment")
os.environ.setdefault("motherduck_token", tok)
ROOT = Path(__file__).resolve().parent
S = "harborline"
ORDER = ["dim_date", "dim_currency", "dim_market", "dim_subcustodian", "dim_client", "dim_counterparty", "dim_security",
         "stl_trade_instruction", "stl_fail_penalty", "pos_daily_position", "pos_cash_balance",
         "cae_event", "cae_client_election", "cae_income_payment", "clt_fee_invoice", "clt_service_request", "rec_break"]
local = duckdb.connect(str(ROOT.parent / "data" / "northwind.db"), read_only=True)
cloud = duckdb.connect("md:askerp")
before = {r[0] for r in cloud.execute("select schema_name from information_schema.schemata").fetchall()}
print("cloud schemas before:", sorted(before))
cloud.execute(f"DROP SCHEMA IF EXISTS {S} CASCADE")      # only ever drops the harborline schema (idempotent rerun)
cloud.execute((ROOT / "ddl" / "harborline.sql").read_text())
t0 = time.time()
for t in ORDER:
    n = local.execute(f"select count(*) from {S}.{t}").fetchone()[0]
    step = 250_000
    for off in range(0, n, step):
        df = local.execute(f"select * from {S}.{t} order by 1 limit {step} offset {off}").fetchdf()
        cloud.register("df_", df); cloud.execute(f"INSERT INTO {S}.{t} BY NAME SELECT * FROM df_"); cloud.unregister("df_")
    c = cloud.execute(f"select count(*) from {S}.{t}").fetchone()[0]
    print(f"  {t:26s} local={n:>10,} cloud={c:>10,} {'OK' if n == c else 'MISMATCH'}  [{time.time()-t0:5.0f}s]", flush=True)
