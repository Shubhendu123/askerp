"""Re-upload ONE harborline table to MotherDuck (delete + reinsert) and check parity. Usage: upload_table.py <table>. Token from env only."""
import os, sys, duckdb
t = sys.argv[1]; S = "harborline"
tok = os.environ.get("MOTHERDUCK_TOKEN") or sys.exit("MOTHERDUCK_TOKEN not set")
os.environ.setdefault("motherduck_token", tok)
local = duckdb.connect("data/northwind.db", read_only=True); cloud = duckdb.connect("md:askerp")
df = local.execute(f"select * from {S}.{t} order by 1").fetchdf()
cloud.execute(f"DELETE FROM {S}.{t}"); cloud.register("df_", df); cloud.execute(f"INSERT INTO {S}.{t} BY NAME SELECT * FROM df_")
q = f"select count(*), sum(estimated_client_impact_usd), max(estimated_client_impact_usd), median(estimated_client_impact_usd) from {S}.{t} where missed_deadline"
a, b = local.execute(q).fetchone(), cloud.execute(q).fetchone()
n = f"select count(*), hash(list(x order by election_key)) from (select * from {S}.{t}) x"
print("local:", a, "\ncloud:", b, "\nparity:", "OK" if a == b and local.execute(n).fetchone() == cloud.execute(n).fetchone() else "MISMATCH")
