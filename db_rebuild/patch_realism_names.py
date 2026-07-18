"""
AskERP — D-038: additive realism-name patch.
Applies deterministic, seeded entity names to dim_customer/dim_supplier/
dim_employee in data/northwind.db WITHOUT regenerating any other data —
same additive-patch pattern as db_rebuild/patch_otif.py / D-034.

Reads the ALREADY-GENERATED region/segment values from the live DB (these
were themselves produced by the main `rng` stream and are untouched by this
patch) and feeds them to realism_names.py's builders in the EXACT same call
order as db_rebuild/gen/generate_mro_v2.py (customer, then supplier, then
employee, sharing one rng_names stream and one used-names set) — so a future
full regeneration reproduces these exact names.
Run from repo root: python3 db_rebuild/patch_realism_names.py
"""
import sys
import numpy as np
import duckdb

sys.path.insert(0, "db_rebuild/gen")
from realism_names import build_customer_names, build_supplier_names, build_employee_names

SEED = 42
DB = "data/northwind.db"
S = "mro_distributor"

con = duckdb.connect(DB)

cols = [r[1] for r in con.execute(f"PRAGMA table_info('{S}.dim_customer')").fetchall()]
sample_name = con.execute(f"SELECT customer_name FROM {S}.dim_customer LIMIT 1").fetchone()[0]
if not sample_name.startswith("Customer "):
    raise SystemExit(f"dim_customer.customer_name is not old-style ('{sample_name}') — patch already applied, aborting.")

cust = con.execute(f"SELECT customer_key, segment FROM {S}.dim_customer ORDER BY customer_key").fetchdf()
supp = con.execute(f"SELECT supplier_key, region FROM {S}.dim_supplier ORDER BY supplier_key").fetchdf()
emp = con.execute(f"SELECT employee_key FROM {S}.dim_employee ORDER BY employee_key").fetchdf()

rng_names = np.random.default_rng(SEED)
used = set()
# Same order as generate_mro_v2.py: customer block precedes supplier block precedes employee block.
cust_names = build_customer_names(cust["segment"].tolist(), rng_names, used)
supp_names = build_supplier_names(supp["region"].tolist(), rng_names, used)
emp_names = build_employee_names(len(emp), rng_names, used)

assert len(set(cust_names)) == len(cust_names) == len(cust)
assert len(set(supp_names)) == len(supp_names) == len(supp)
assert len(set(emp_names)) == len(emp_names) == len(emp)

import pandas as pd
cust_df = pd.DataFrame({"customer_key": cust["customer_key"], "new_name": cust_names})
supp_df = pd.DataFrame({"supplier_key": supp["supplier_key"], "new_name": supp_names})
emp_df = pd.DataFrame({"employee_key": emp["employee_key"], "new_name": emp_names})

con.register("cust_df", cust_df)
con.execute(f"""
    UPDATE {S}.dim_customer AS c SET customer_name = cust_df.new_name
    FROM cust_df WHERE c.customer_key = cust_df.customer_key
""")
con.register("supp_df", supp_df)
con.execute(f"""
    UPDATE {S}.dim_supplier AS s SET supplier_name = supp_df.new_name
    FROM supp_df WHERE s.supplier_key = supp_df.supplier_key
""")
con.register("emp_df", emp_df)
con.execute(f"""
    UPDATE {S}.dim_employee AS e SET employee_name = emp_df.new_name
    FROM emp_df WHERE e.employee_key = emp_df.employee_key
""")

n_cust_old = con.execute(f"SELECT COUNT(*) FROM {S}.dim_customer WHERE customer_name LIKE 'Customer %'").fetchone()[0]
n_supp_old = con.execute(f"SELECT COUNT(*) FROM {S}.dim_supplier WHERE supplier_name LIKE 'Supplier %'").fetchone()[0]
n_emp_old = con.execute(f"SELECT COUNT(*) FROM {S}.dim_employee WHERE employee_name LIKE 'Employee %'").fetchone()[0]
con.close()
print(f"patched: {len(cust_df)} customers, {len(supp_df)} suppliers, {len(emp_df)} employees")
print(f"remaining old-style names: customers={n_cust_old} suppliers={n_supp_old} employees={n_emp_old}")
