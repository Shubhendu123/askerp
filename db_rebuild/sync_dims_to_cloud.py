"""
AskERP — D-038: sync patched dim_customer/dim_supplier/dim_employee to
MotherDuck (database askerp). Only these 3 tables — everything else in the
warehouse is unchanged by the realism-names patch.
Token is read from the process environment (MOTHERDUCK_TOKEN, sourced from
.env.local by the caller's shell) — never printed or persisted here.
Run from repo root: python3 db_rebuild/sync_dims_to_cloud.py
"""
import os
import duckdb

token = os.environ.get("MOTHERDUCK_TOKEN")
if not token:
    raise SystemExit("MOTHERDUCK_TOKEN not set in the environment — source .env.local first.")
os.environ.setdefault("motherduck_token", token)

TABLES = ["dim_customer", "dim_supplier", "dim_employee"]
S = "mro_distributor"

local = duckdb.connect("data/northwind.db", read_only=True)
cloud = duckdb.connect("md:askerp")

for t in TABLES:
    df = local.execute(f"SELECT * FROM {S}.{t}").fetchdf()
    cloud.register("df", df)
    cloud.execute(f"CREATE OR REPLACE TABLE askerp.{S}.{t} AS SELECT * FROM df")
    n = cloud.execute(f"SELECT COUNT(*) FROM askerp.{S}.{t}").fetchone()[0]
    print(f"{t}: uploaded, cloud row count = {n}")

local.close()
cloud.close()
