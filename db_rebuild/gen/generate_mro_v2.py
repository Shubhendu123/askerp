"""
AskERP — MRO Distributor generator v2. Adds BUSINESS realism on top of shape:
  - supplier spend Pareto (few strategic suppliers carry most spend)
  - category-differentiated cost & margin bands
  - real lateness magnitudes by reliability tier (days, not fractions)
  - customer payment heterogeneity (planted slow-payer segment -> 2nd DSO driver)
  - SKU velocity classes A/B/C (fast/med/slow movers)
  - mild YoY growth + Q4 seasonality + weekend dips
Seeded, reproducible. Loads data/northwind.db (schema mro_distributor), run from repo root.
DDL must be applied first: db_rebuild/ddl/mro_distributor.sql
"""
import duckdb, numpy as np, pandas as pd
from datetime import date, timedelta
from realism_names import build_supplier_names, build_customer_names, build_employee_names

SEED=42; rng=np.random.default_rng(SEED)
# D-038: dedicated stream for entity names — never touches `rng`, so every
# other generated column stays byte-identical to pre-D-038 generations.
rng_names=np.random.default_rng(SEED); _used_names=set()
N_ITEMS,N_CUST,N_SUPP,N_WH = 1200,200,100,4
START,MONTHS = date(2024,7,1),18
DAYS=MONTHS*30; dates=[START+timedelta(days=i) for i in range(DAYS)]
DB="data/northwind.db"; con=duckdb.connect(DB); S="mro_distributor"  # app DB, run from repo root
_DMIN,_DMAX=dates[0],dates[-1]
def dk(d):
    d=_DMIN if d<_DMIN else _DMAX if d>_DMAX else d
    return d.year*10000+d.month*100+d.day
def load(t,df): con.execute(f"INSERT INTO {S}.{t} SELECT * FROM df")

# ---------- dim_date ----------
dd=pd.DataFrame({"full_date":dates})
dd["date_key"]=dd.full_date.map(dk)
dd["day_of_week"]=dd.full_date.map(lambda d:d.strftime("%A"))
dd["day_of_month"]=dd.full_date.map(lambda d:d.day)
dd["week_of_year"]=dd.full_date.map(lambda d:d.isocalendar().week)
dd["month_num"]=dd.full_date.map(lambda d:d.month)
dd["month_name"]=dd.full_date.map(lambda d:d.strftime("%B"))
dd["quarter_num"]=dd.full_date.map(lambda d:(d.month-1)//3+1)
dd["fiscal_period"]=dd.apply(lambda r:f"FY{str(r.full_date.year)[2:]}-Q{(r.full_date.month-1)//3+1}",axis=1)
dd["year_num"]=dd.full_date.map(lambda d:d.year)
dd["is_month_end"]=dd.full_date.map(lambda d:(d+timedelta(days=1)).month!=d.month)
dd=dd[["date_key","full_date","day_of_week","day_of_month","week_of_year","month_num",
       "month_name","quarter_num","fiscal_period","year_num","is_month_end"]]
load("dim_date",dd)

# ---------- dim_subsidiary / warehouse ----------
load("dim_subsidiary",pd.DataFrame({"subsidiary_key":[1,2,3],
  "subsidiary_name":["MRO Distribution US","MRO Distribution Canada","MRO Industrial Supply"],
  "country":["USA","Canada","USA"],"currency":["USD"]*3,"parent_rollup":["MRO Holdings"]*3}))
load("dim_warehouse",pd.DataFrame({"warehouse_key":[1,2,3,4],
  "warehouse_name":["Chicago DC","Dallas DC","Atlanta Branch","Reno Branch"],
  "region":["Midwest","South","Southeast","West"],"warehouse_type":["DC","DC","Branch","Branch"]}))

# ---------- dim_item: category cost & margin bands (REALISM) ----------
# (cost_lo, cost_hi, gm_lo, gm_hi) by category
CATBAND={
 "Fasteners":(0.05,18,0.18,0.26),     # commodity, thin margin
 "Tools":(15,420,0.30,0.42),          # higher ticket, better margin
 "Safety":(4,140,0.30,0.40),
 "Electrical":(2,90,0.24,0.34),
 "MRO":(6,220,0.36,0.48)}             # specialty consumables, best margin
subcats={"Fasteners":("Bolts","Screws","Anchors","Nuts"),
 "Tools":("Power Tools","Hand Tools","Cutting"),"Safety":("PPE","Signage","Fall Protection"),
 "Electrical":("Wire","Conduit","Connectors"),"MRO":("Lubricants","Adhesives","Filters","Belts")}
it_cat=rng.choice(list(CATBAND),N_ITEMS,p=[0.30,0.22,0.15,0.18,0.15])
it_sub=[rng.choice(subcats[c]) for c in it_cat]
unit_cost=np.empty(N_ITEMS); list_price=np.empty(N_ITEMS)
for k,c in enumerate(it_cat):
    lo,hi,gl,gh=CATBAND[c]
    uc=float(np.exp(rng.uniform(np.log(lo),np.log(hi))))  # log-uniform cost
    gm=rng.uniform(gl,gh)
    unit_cost[k]=round(uc,2); list_price[k]=round(uc/(1-gm),2)
# SKU velocity class A/B/C (fast/med/slow) -> order weighting & stock level
vel=rng.choice(["A","B","C"],N_ITEMS,p=[0.10,0.20,0.70])
vel_w={"A":12.0,"B":4.0,"C":1.0}
item_weight=np.array([vel_w[v] for v in vel])
items=pd.DataFrame({"item_key":np.arange(1,N_ITEMS+1),
  "sku":[f"SKU-{i:05d}" for i in range(1,N_ITEMS+1)],
  "item_name":[f"{s} {c[:3].upper()}-{i}" for i,(c,s) in enumerate(zip(it_cat,it_sub))],
  "category":it_cat,"subcategory":it_sub,"unit_cost":unit_cost,"list_price":list_price,
  "lead_time_class":rng.choice(["Short","Medium","Long"],N_ITEMS,p=[0.5,0.35,0.15]),
  "is_active":True})
load("dim_item",items)

# ---------- dim_customer: size (Pareto) + payment behavior (REALISM) ----------
segs=["Manufacturing","Construction","Facilities","Government"]
regions=["Midwest","South","Southeast","West","Northeast"]
terms=[("Net 30",30),("Net 45",45),("Net 60",60)]
ct=[terms[i] for i in rng.choice(3,N_CUST,p=[0.55,0.30,0.15])]
cust_size=rng.lognormal(0,1.1,N_CUST); cust_size/=cust_size.sum()   # revenue concentration
# 15% chronic slow payers: pay terms + ~20d; rest terms + ~4d
slow=rng.random(N_CUST)<0.15
seg_arr=rng.choice(segs,N_CUST,p=[0.4,0.25,0.25,0.10])   # unchanged position/order in the rng stream
reg_arr=rng.choice(regions,N_CUST)                        # unchanged position/order in the rng stream
cust_names=build_customer_names(seg_arr,rng_names,_used_names)   # D-038, separate stream
cust=pd.DataFrame({"customer_key":np.arange(1,N_CUST+1),
  "customer_name":cust_names,
  "segment":seg_arr,"region":reg_arr,
  "credit_terms":[t[0] for t in ct],"credit_days":[t[1] for t in ct]})
load("dim_customer",cust)
cust_days=dict(zip(cust.customer_key,cust.credit_days))

# ---------- dim_supplier: size (Pareto) + reliability tier (REALISM) ----------
tier=rng.choice(list("ABCD"),N_SUPP,p=[0.45,0.40,0.10,0.05])
sterms=[terms[i] for i in rng.choice(3,N_SUPP,p=[0.5,0.3,0.2])]
supp_size=rng.lognormal(0,1.3,N_SUPP); supp_size/=supp_size.sum()   # strategic vs tail
supp_region_arr=rng.choice(regions+["Import-APAC","Import-EU"],N_SUPP)   # unchanged position in the rng stream
supp_names=build_supplier_names(supp_region_arr,rng_names,_used_names)   # D-038, separate stream
supp_lead_arr=rng.choice([7,14,21,30],N_SUPP,p=[0.3,0.4,0.2,0.1])        # unchanged position in the rng stream
supp=pd.DataFrame({"supplier_key":np.arange(1,N_SUPP+1),
  "supplier_name":supp_names,
  "region":supp_region_arr,
  "payment_terms":[t[0] for t in sterms],"payment_days":[t[1] for t in sterms],
  "promised_lead_days":supp_lead_arr,
  "reliability_tier":tier})
load("dim_supplier",supp)
supp_tier=dict(zip(supp.supplier_key,supp.reliability_tier))
supp_pdays=dict(zip(supp.supplier_key,supp.payment_days))
supp_lead=dict(zip(supp.supplier_key,supp.promised_lead_days))
# REAL lateness magnitudes (mean extra days) by tier
TIER_LATE={"A":0.5,"B":2.5,"C":8.0,"D":16.0}
# item -> supplier assignment WEIGHTED by supplier size (concentration)
item_supplier=rng.choice(np.arange(1,N_SUPP+1),N_ITEMS+1,p=supp_size/supp_size.sum())
item_hurt=np.array([0.0]+[{"A":0.0,"B":0.12,"C":0.45,"D":1.0}[supp_tier[item_supplier[i]]] for i in range(1,N_ITEMS+1)])

# ---------- dim_gl_account / employee ----------
load("dim_gl_account",pd.DataFrame({"gl_account_key":[1,2,3,4,5,6,7,8],
  "account_code":["4000","5000","1200","2000","1300","6000","1000","3000"],
  "account_name":["Revenue","COGS","Accounts Receivable","Accounts Payable","Inventory",
                  "Operating Expense","Cash","Retained Earnings"],
  "account_type":["Revenue","Expense","Asset","Liability","Asset","Expense","Asset","Equity"],
  "statement":["P&L","P&L","BS","BS","BS","P&L","BS","BS"],
  "rollup":["Income","Income","Current Assets","Current Liab","Current Assets","Income","Current Assets","Equity"]}))
n_emp=30
emp_region_arr=list(rng.choice(regions,n_emp))   # unchanged position in the rng stream
emp_names=build_employee_names(n_emp,rng_names,_used_names)   # D-038, separate stream
emp=pd.DataFrame({"employee_key":np.arange(1,n_emp+1),
  "employee_name":emp_names,
  "role":["Sales Rep"]*20+["Buyer"]*10,"region":emp_region_arr})
load("dim_employee",emp)
sales_reps=emp[emp.role=="Sales Rep"].employee_key.values
buyers=emp[emp.role=="Buyer"].employee_key.values

print("dims loaded.")

# ============================================================
# P2P — POs weighted by item velocity (strategic suppliers get more), real lateness
# ============================================================
po_rows,bill_rows,billpay_rows=[],[],[]; po_id=bill_id=billpay_id=0
item_p=item_weight/item_weight.sum()
for d in dates:
    n=rng.poisson(34)
    its=rng.choice(np.arange(1,N_ITEMS+1),n,p=item_p)
    for item in its:
        item=int(item); sup=int(item_supplier[item]); po_id+=1
        promised=supp_lead[sup]
        late=int(max(0,rng.gamma(2.0, TIER_LATE[supp_tier[sup]]/2.0)))  # gamma -> realistic spread
        rec=d+timedelta(days=promised+late)
        qty=int(rng.integers(20,600)); uc=float(items.loc[item-1,"unit_cost"])
        po_rows.append((po_id,f"PO-{po_id:06d}",dk(d),dk(d+timedelta(days=promised)),dk(rec),
                        sup,item,int(rng.integers(1,N_WH+1)),int(rng.choice(buyers)),
                        int(rng.choice([1,2,3],p=[0.6,0.25,0.15])),qty,round(uc,2),round(uc*qty,2),late))
        bill_id+=1; pdays=supp_pdays[sup]; bdue=rec+timedelta(days=pdays); amt=round(uc*qty,2)
        sub=int(rng.choice([1,2,3],p=[0.6,0.25,0.15]))
        billpay_id+=1; dtp=max(1,int(rng.normal(pdays+2,6))); pay=rec+timedelta(days=dtp)  # +2d slack: pay slightly past terms (keeps CCC <= 90)
        if pay<=dates[-1]:
            bill_rows.append((bill_id,f"VB-{bill_id:06d}",dk(rec),dk(bdue),sup,sub,amt,0.0))
            billpay_rows.append((billpay_id,bill_id,dk(pay),sup,sub,amt,dtp))
        else:
            bill_rows.append((bill_id,f"VB-{bill_id:06d}",dk(rec),dk(bdue),sup,sub,amt,amt))
po_df=pd.DataFrame(po_rows,columns=["po_line_key","po_number","po_date_key","promised_date_key",
  "received_date_key","supplier_key","item_key","warehouse_key","employee_key","subsidiary_key",
  "qty_ordered","unit_cost","ext_cost","late_days"]); load("p2p_purchase_order_line",po_df)
load("p2p_vendor_bill",pd.DataFrame(bill_rows,columns=["bill_key","bill_number","bill_date_key",
  "due_date_key","supplier_key","subsidiary_key","bill_amount","open_balance"]))
load("p2p_bill_payment",pd.DataFrame(billpay_rows,columns=["bill_payment_key","bill_key",
  "payment_date_key","supplier_key","subsidiary_key","amount_paid","days_to_pay"]))
print("p2p:",len(po_df),"PO lines | late_days by tier:",
  po_df.merge(supp[["supplier_key","reliability_tier"]],on="supplier_key").groupby("reliability_tier").late_days.mean().round(1).to_dict())

# ============================================================
# O2C — demand weighted by customer size + item velocity; YoY growth; ship delay from hurt
# ============================================================
so_rows,ff_rows,ret_rows=[],[],[]; so_id=ff_id=ret_id=0
cust_p=cust_size/cust_size.sum()
GROWTH=0.08
for di,d in enumerate(dates):
    growth=1+GROWTH*(di/365.0)
    base=300*(1.25 if d.month in(10,11,12) else 1.0)*(0.4 if d.weekday()>=5 else 1.0)*growth
    n=rng.poisson(base)
    its=rng.choice(np.arange(1,N_ITEMS+1),n,p=item_p)
    cs=rng.choice(np.arange(1,N_CUST+1),n,p=cust_p)
    for item,cust_k in zip(its,cs):
        item=int(item); cust_k=int(cust_k); so_id+=1
        wh_k=int(rng.integers(1,N_WH+1)); qty=int(rng.integers(1,80))
        price=float(items.loc[item-1,"list_price"]); uc=float(items.loc[item-1,"unit_cost"])
        ext=round(price*qty,2); extc=round(uc*qty,2); sub=int(rng.choice([1,2,3],p=[0.6,0.25,0.15]))
        so_rows.append((so_id,f"SO-{so_id:06d}",dk(d),cust_k,item,wh_k,int(rng.choice(sales_reps)),
                        sub,qty,round(price,2),ext,round(uc,2),extc,round(ext-extc,2)))
        hurt=item_hurt[item]; ots=int(rng.integers(1,4)+rng.poisson(hurt*5)); ship=d+timedelta(days=ots)
        if ship<=dates[-1]:
            ff_id+=1; ff_rows.append((ff_id,so_id,dk(ship),cust_k,item,wh_k,sub,qty,ots))
        if rng.random()<0.03:
            ret_id+=1; rq=int(max(1,qty*rng.uniform(0.1,0.5)))
            ret_rows.append((ret_id,dk(d+timedelta(days=int(rng.integers(5,30)))),cust_k,item,sub,
                             rq,round(price*rq,2),rng.choice(["Damaged","Wrong Item","Overordered","Quality"])))
so_df=pd.DataFrame(so_rows,columns=["so_line_key","so_number","order_date_key","customer_key",
  "item_key","warehouse_key","employee_key","subsidiary_key","qty_ordered","unit_price",
  "ext_amount","unit_cost","ext_cost","margin_amount"])
# OTIF promise (D-034): dedicated seeded stream, drawn in so_line_key order, so the
# main RNG stream (and every other table) is byte-identical to pre-OTIF generations.
rng_promise=np.random.default_rng(SEED); LT_OFF={"Short":2,"Medium":3,"Long":4}
p_off=so_df.item_key.map(items.set_index("item_key").lead_time_class.map(LT_OFF)).to_numpy()
p_noise=rng_promise.integers(0,2,len(so_df))
so_df["promised_ship_date_key"]=[dk(date(k//10000,(k//100)%100,k%100)+timedelta(days=int(o+n)))
  for k,o,n in zip(so_df.order_date_key,p_off,p_noise)]
load("o2c_sales_order_line",so_df)
ff_df=pd.DataFrame(ff_rows,columns=["ff_line_key","so_line_key","ship_date_key","customer_key",
  "item_key","warehouse_key","subsidiary_key","qty_shipped","order_to_ship_days"]); load("o2c_fulfillment_line",ff_df)
load("o2c_return_line",pd.DataFrame(ret_rows,columns=["return_line_key","return_date_key",
  "customer_key","item_key","subsidiary_key","qty_returned","credit_amount","reason"]))
print("o2c:",len(so_df),"SO lines,",len(ff_df),"fulfillments")

# ============================================================
# AR — invoice at ship date; payment behavior heterogeneity (slow payers)
# ============================================================
ar_inv_rows,ar_pay_rows=[],[]; inv_id=arpay_id=0
ext_lookup=dict(zip(so_df.so_line_key,so_df.ext_amount))
for r in ff_df.itertuples(index=False):
    inv_id+=1; amt=float(ext_lookup[r.so_line_key])
    inv_date=date(r.ship_date_key//10000,(r.ship_date_key//100)%100,r.ship_date_key%100)
    cdays=cust_days[r.customer_key]; due=inv_date+timedelta(days=cdays)
    base_slack=rng.normal(20,10) if slow[r.customer_key-1] else rng.normal(4,6)  # planted slow-payer signal
    dtp=max(1,int(cdays+base_slack)); pay=inv_date+timedelta(days=dtp)
    if pay<=dates[-1]:
        ar_inv_rows.append((inv_id,f"INV-{inv_id:06d}",dk(inv_date),dk(due),int(r.customer_key),int(r.subsidiary_key),round(amt,2),0.0))
        arpay_id+=1; ar_pay_rows.append((arpay_id,inv_id,dk(pay),int(r.customer_key),int(r.subsidiary_key),round(amt,2),dtp))
    else:
        ar_inv_rows.append((inv_id,f"INV-{inv_id:06d}",dk(inv_date),dk(due),int(r.customer_key),int(r.subsidiary_key),round(amt,2),round(amt,2)))
load("ar_invoice",pd.DataFrame(ar_inv_rows,columns=["invoice_key","invoice_number","invoice_date_key",
  "due_date_key","customer_key","subsidiary_key","invoice_amount","open_balance"]))
load("ar_payment_application",pd.DataFrame(ar_pay_rows,columns=["ar_payment_key","invoice_key",
  "payment_date_key","customer_key","subsidiary_key","amount_applied","days_to_pay"]))
print("ar:",len(ar_inv_rows),"invoices,",len(ar_pay_rows),"payments")

# ============================================================
# INV — daily snapshot, stock level scaled by velocity; stockouts ~ hurt
# ============================================================
active=[]
for i in range(1,N_ITEMS+1):
    for w in rng.choice(range(1,N_WH+1),size=int(rng.integers(1,3)),replace=False): active.append((i,int(w)))
snap_rows=[]; snap_id=0
for (i,w) in active:
    hurt=item_hurt[i]; vmul={"A":3.0,"B":1.8,"C":1.0}[vel[i-1]]
    base=int(rng.integers(120,1400)*vmul); uc=float(items.loc[i-1,"unit_cost"]); cycle=int(rng.integers(20,45))
    so_prob=0.015+hurt*0.11
    for di,d in enumerate(dates):
        phase=(di%cycle)/cycle; qoh=int(base*(1-phase)+rng.normal(0,base*0.05))
        if rng.random()<so_prob: qoh=0
        qoh=max(0,qoh); snap_id+=1
        snap_rows.append((snap_id,dk(d),i,w,1,qoh,round(qoh*uc,2),qoh==0))
load("inv_balance_snapshot",pd.DataFrame(snap_rows,columns=["snapshot_key","snapshot_date_key",
  "item_key","warehouse_key","subsidiary_key","qty_on_hand","value_on_hand","is_stockout"]))
txn_rows=[]; txn_id=0
for r in po_df.itertuples(index=False):
    txn_id+=1; txn_rows.append((txn_id,r.received_date_key,r.item_key,r.warehouse_key,r.supplier_key,r.subsidiary_key,"Receipt",r.qty_ordered,round(r.ext_cost,2)))
for r in ff_df.sample(frac=0.5,random_state=SEED).itertuples(index=False):
    txn_id+=1; txn_rows.append((txn_id,r.ship_date_key,r.item_key,r.warehouse_key,None,r.subsidiary_key,"Issue",-int(r.qty_shipped),round(-r.qty_shipped*float(items.loc[r.item_key-1,"unit_cost"]),2)))
load("inv_transaction",pd.DataFrame(txn_rows,columns=["inv_txn_key","txn_date_key","item_key",
  "warehouse_key","supplier_key","subsidiary_key","txn_type","qty_delta","value_delta"]))
print("inv:",len(snap_rows),"snapshots,",len(txn_rows),"transactions")

# ============================================================
# GL — journal lines from flows + monthly balances
# ============================================================
je_rows=[]; je_id=0
def je(dkey,acct,dr,cr):
    global je_id; je_id+=1; je_rows.append((je_id,f"JE-{je_id:07d}",dkey,acct,1,int(rng.choice(buyers)),round(dr,2),round(cr,2),round(dr-cr,2)))
for r in ar_inv_rows: je(r[2],3,r[6],0); je(r[2],1,0,r[6])
extc_lookup=dict(zip(so_df.so_line_key,so_df.ext_cost))
for r in ff_df.itertuples(index=False):
    extc=float(extc_lookup[r.so_line_key]); je(r.ship_date_key,2,extc,0); je(r.ship_date_key,5,0,extc)
je_df=pd.DataFrame(je_rows,columns=["je_line_key","je_number","posting_date_key","gl_account_key",
  "subsidiary_key","employee_key","debit_amount","credit_amount","net_amount"]); load("gl_journal_line",je_df)
bal_rows=[]; bal_id=0
je2=je_df.merge(dd[["date_key","year_num","month_num"]],left_on="posting_date_key",right_on="date_key")
grp=je2.groupby(["year_num","month_num","gl_account_key"]).net_amount.sum().reset_index(); ytd={}
for r in grp.sort_values(["gl_account_key","year_num","month_num"]).itertuples(index=False):
    bal_id+=1; ytd[r.gl_account_key]=ytd.get(r.gl_account_key,0)+r.net_amount
    bal_rows.append((bal_id,dk(date(int(r.year_num),int(r.month_num),28)),r.gl_account_key,1,round(r.net_amount,2),round(ytd[r.gl_account_key],2)))
load("gl_account_balance",pd.DataFrame(bal_rows,columns=["balance_key","period_date_key",
  "gl_account_key","subsidiary_key","period_balance","ytd_balance"]))
print("gl:",len(je_df),"journal lines,",len(bal_rows),"balances")
con.close(); print("DONE v2")
