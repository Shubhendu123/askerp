"""
AskERP — Part A (D-034): additive OTIF patch.
Adds promised_ship_date_key to mro_distributor.o2c_sales_order_line in
data/northwind.db WITHOUT regenerating any other data.

promised = order_date + lead_time_class offset (Short 2d / Medium 3d / Long 4d)
           + seeded noise (0-1d), clamped to the dim_date range.
Noise comes from a dedicated default_rng(SEED) stream over rows ordered by
so_line_key — identical to the stream the generator now draws, so a fresh
regeneration reproduces this column exactly.
Run from repo root: python3 db_rebuild/patch_otif.py
"""
import duckdb
import numpy as np
import pandas as pd
from datetime import date, timedelta

SEED = 42
OFFSET = {"Short": 2, "Medium": 3, "Long": 4}

con = duckdb.connect("data/northwind.db")
S = "mro_distributor"

cols = [r[1] for r in con.execute(f"PRAGMA table_info('{S}.o2c_sales_order_line')").fetchall()]
if "promised_ship_date_key" in cols:
    raise SystemExit("promised_ship_date_key already exists — patch already applied, aborting.")

df = con.execute(f"""
    SELECT sol.so_line_key, sol.order_date_key, i.lead_time_class
    FROM {S}.o2c_sales_order_line sol
    JOIN {S}.dim_item i USING (item_key)
    ORDER BY sol.so_line_key
""").fetchdf()

dmax = con.execute(f"SELECT MAX(full_date) FROM {S}.dim_date").fetchone()[0]

rng_promise = np.random.default_rng(SEED)
noise = rng_promise.integers(0, 2, len(df))
off = df.lead_time_class.map(OFFSET).to_numpy()


def to_date(k):
    return date(k // 10000, (k // 100) % 100, k % 100)


def to_key(d):
    d = min(d, dmax)
    return d.year * 10000 + d.month * 100 + d.day


promised = [
    to_key(to_date(int(k)) + timedelta(days=int(o + n)))
    for k, o, n in zip(df.order_date_key, off, noise)
]
pdf = pd.DataFrame({"so_line_key": df.so_line_key, "promised_ship_date_key": promised})

con.execute(f"ALTER TABLE {S}.o2c_sales_order_line ADD COLUMN promised_ship_date_key INTEGER")
con.register("pdf", pdf)
con.execute(f"""
    UPDATE {S}.o2c_sales_order_line AS sol
    SET promised_ship_date_key = pdf.promised_ship_date_key
    FROM pdf WHERE sol.so_line_key = pdf.so_line_key
""")
n_null = con.execute(
    f"SELECT COUNT(*) FROM {S}.o2c_sales_order_line WHERE promised_ship_date_key IS NULL"
).fetchone()[0]
con.close()
print(f"patched {len(pdf):,} rows, NULL promises: {n_null}")
