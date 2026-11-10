"""
AskERP D-044 - Tenant 3: Harborline Global Custody. Seeded (SEED=7), reproducible, coherent simulation.

NOT 16 independent random tables. One simulation with three planted causal chains:
  Chain 1  counterparty reliability_tier -> fail prob + days_failed -> daily CSDR/CREST penalties
           -> unreceived cash (failed DELIVER) -> overdrafts + funding cost; failed RECEIVE -> quantity_pending
  Chain 2  short notice window -> missed client elections (window-driven miss probability)
  Chain 3  statutory>treaty withholding -> reclaim_eligible; filing probability falls with market
           reclaim complexity -> unfiled leakage concentrated in HIGH markets (FR, IT, CH)

Run from repo root:  python3 harborline/gen/generate_harborline.py
Drops schema harborline (CASCADE) in data/northwind.db and rebuilds it from harborline/ddl/harborline.sql.
Existing schemas (main, mro_distributor, ops) are never touched.
"""
import sys, time, math
from datetime import date, timedelta
from pathlib import Path
import numpy as np, pandas as pd, duckdb

SEED = 7
rng = np.random.default_rng(SEED)
ROOT = Path(__file__).resolve().parent.parent          # harborline/
import os
DB = Path(os.environ["HL_DB"]) if os.environ.get("HL_DB") else ROOT.parent / "data" / "northwind.db"   # HL_DB: build into a scratch DB (used by patch_d044_impact.py)
DDL = ROOT / "ddl" / "harborline.sql"
S = "harborline"
T0 = time.time()
def log(m): print(f"[{time.time()-T0:6.1f}s] {m}", flush=True)

# ---------------------------------------------------------------- calendar
START, END = date(2025, 5, 1), date(2026, 10, 22)
D0, DEND = date(2020, 1, 1), date(2031, 1, 31)
ND = (DEND - D0).days + 1
all_dates = [D0 + timedelta(days=i) for i in range(ND)]
sD, eD = (START - D0).days, (END - D0).days
NW = eD - sD + 1                                         # 540 window days

def easter(y):
    a = y % 19; b, c = divmod(y, 100); d, e = divmod(b, 4); f = (b + 8) // 25
    g = (b - f + 1) // 3; h = (19 * a + b - d - g + 15) % 30; i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7; m = (a + 11 * h + 22 * l) // 451
    mo, dd = divmod(h + l - 7 * m + 114, 31); return date(y, mo, dd + 1)
def nth_wd(y, m, wd, n):
    d = date(y, m, 1)
    while d.weekday() != wd: d += timedelta(1)
    return d + timedelta(7 * (n - 1))
def last_wd(y, m, wd):
    d = date(y, m + 1, 1) - timedelta(1) if m < 12 else date(y, 12, 31)
    while d.weekday() != wd: d -= timedelta(1)
    return d
def observed(d): return d - timedelta(1) if d.weekday() == 5 else d + timedelta(1) if d.weekday() == 6 else d
# one global business calendar (simplification: a single shared holiday set, not per-market)
HOL = set()
for y in range(2020, 2032):
    HOL |= {date(y, 1, 1), date(y, 5, 1), date(y, 12, 25), date(y, 12, 26), observed(date(y, 7, 4)),
            nth_wd(y, 11, 3, 4), nth_wd(y, 9, 0, 1), last_wd(y, 5, 0), nth_wd(y, 1, 0, 3), nth_wd(y, 2, 0, 3)}
    e = easter(y); HOL |= {e - timedelta(2), e + timedelta(1)}
is_bd = np.array([(d.weekday() < 5 and d not in HOL) for d in all_dates])
dk_arr = np.array([d.year * 10000 + d.month * 100 + d.day for d in all_dates], dtype=np.int64)
bd_idx = np.flatnonzero(is_bd)
bd_cum = np.cumsum(is_bd) - 1                            # position in bd_idx of a business day
def add_bd(day, n):
    """day: array of business-day indexes; returns the business day n business days later."""
    return bd_idx[np.minimum(bd_cum[day] + n, len(bd_idx) - 1)]
def next_bd(day):
    p = np.searchsorted(bd_idx, day); return bd_idx[np.minimum(p, len(bd_idx) - 1)]
def prev_bd(day):
    p = np.searchsorted(bd_idx, day, side="right") - 1; return bd_idx[np.maximum(p, 0)]
BDW = bd_idx[(bd_idx >= sD) & (bd_idx <= eD)]            # business days inside the data window
def day_of(d): return (d - D0).days
def nI(a, mask=None):
    s = pd.array(np.asarray(a), dtype="Int64")
    if mask is not None: s[np.asarray(mask)] = pd.NA
    return s

# ---------------------------------------------------------------- reference data
CCY = [("USD", "US Dollar", 1.0), ("EUR", "Euro", 0.92), ("GBP", "Pound Sterling", 0.79), ("JPY", "Japanese Yen", 150.0),
       ("HKD", "Hong Kong Dollar", 7.82), ("AUD", "Australian Dollar", 1.52), ("CAD", "Canadian Dollar", 1.36),
       ("CHF", "Swiss Franc", 0.88), ("SGD", "Singapore Dollar", 1.34)]
CCY_IDX = {c[0]: i + 1 for i, c in enumerate(CCY)}
CCY_RATE = np.array([0.0] + [c[2] for c in CCY])         # 1-indexed units per USD
OD_RATE = np.array([0.0, 6.0, 3.5, 5.5, 1.0, 5.0, 5.0, 4.8, 1.5, 3.5]) / 100   # overdraft funding rate by currency_key
# code, name, CSD, region, cycle, regime, partial, ccy, reclaim complexity, security weight, security multiplier on fails
MK = [("US", "United States", "DTC", "Americas", "T+1", "NONE", False, "USD", "LOW", .22, .90),
      ("CA", "Canada", "CDS", "Americas", "T+1", "NONE", False, "CAD", "LOW", .06, .95),
      ("GB", "United Kingdom", "CREST", "EMEA", "T+2", "CREST", True, "GBP", "MEDIUM", .12, .95),
      ("DE", "Germany", "Clearstream", "EMEA", "T+2", "CSDR", True, "EUR", "MEDIUM", .09, 1.0),
      ("FR", "France", "Euroclear France", "EMEA", "T+2", "CSDR", True, "EUR", "HIGH", .08, 1.1),
      ("IT", "Italy", "Monte Titoli", "EMEA", "T+2", "CSDR", True, "EUR", "HIGH", .05, 1.4),
      ("NL", "Netherlands", "Euroclear NL", "EMEA", "T+2", "CSDR", True, "EUR", "MEDIUM", .04, 1.0),
      ("CH", "Switzerland", "SIX SIS", "EMEA", "T+2", "NONE", False, "CHF", "HIGH", .06, 1.0),
      ("JP", "Japan", "JASDEC", "APAC", "T+2", "NONE", False, "JPY", "MEDIUM", .12, .85),
      ("HK", "Hong Kong", "CCASS", "APAC", "T+2", "NONE", False, "HKD", "LOW", .06, 1.1),
      ("AU", "Australia", "CHESS", "APAC", "T+2", "NONE", False, "AUD", "MEDIUM", .06, 1.0),
      ("SG", "Singapore", "CDP", "APAC", "T+2", "NONE", False, "SGD", "LOW", .04, .95)]
NM = len(MK)
mk_code = [m[0] for m in MK]
mk_cycle = np.array([1 if m[4] == "T+1" else 2 for m in MK])
mk_regime = np.array([m[5] for m in MK])
mk_ccy = np.array([CCY_IDX[m[7]] for m in MK])           # currency_key per market (0-based index = market_key-1)
mk_complex = np.array([m[8] for m in MK])
mk_failmult = np.array([m[10] for m in MK])
# statutory dividend withholding / treaty rate by market (approximate, demo values)
STAT = {"US": 30, "CA": 25, "GB": 0, "DE": 26.375, "FR": 25, "IT": 26, "NL": 15, "CH": 35, "JP": 15.315, "HK": 0, "AU": 30, "SG": 0}
TREATY = {"US": 15, "CA": 15, "GB": 0, "DE": 15, "FR": 15, "IT": 15, "NL": 15, "CH": 15, "JP": 10, "HK": 0, "AU": 15, "SG": 0}
TREATY_DOM = {"US", "GB", "IE", "LU", "DE", "FR", "CH", "JP", "CA", "AU", "NL", "IT", "SG", "NO"}
DOM_CCY = {"US": "USD", "CA": "CAD", "GB": "GBP", "IE": "EUR", "LU": "EUR", "DE": "EUR", "FR": "EUR", "NL": "EUR", "IT": "EUR",
           "CH": "CHF", "JP": "JPY", "AU": "AUD", "SG": "SGD", "AE": "USD", "QA": "USD", "KY": "USD", "BM": "USD", "VG": "USD", "NO": "USD"}

log("applying DDL (drop + create schema harborline)")
con = duckdb.connect(str(DB))
con.execute(f"DROP SCHEMA IF EXISTS {S} CASCADE")
con.execute(DDL.read_text())
def load(t, df):
    con.register("df_", df); con.execute(f"INSERT INTO {S}.{t} BY NAME SELECT * FROM df_"); con.unregister("df_")

# ---------------------------------------------------------------- dim_date, dim_currency, dim_market
dd = pd.DataFrame({"date_key": dk_arr, "full_date": all_dates})
dd["day_of_week"] = [d.strftime("%A") for d in all_dates]; dd["is_business_day"] = is_bd
dd["day_of_month"] = [d.day for d in all_dates]; dd["week_of_year"] = [d.isocalendar()[1] for d in all_dates]
dd["month_num"] = [d.month for d in all_dates]; dd["month_name"] = [d.strftime("%B") for d in all_dates]
dd["quarter_num"] = [(d.month - 1) // 3 + 1 for d in all_dates]
dd["fiscal_period"] = [f"FY{str(d.year)[2:]}-Q{(d.month - 1) // 3 + 1}" for d in all_dates]
dd["year_num"] = [d.year for d in all_dates]; dd["is_month_end"] = [(d + timedelta(1)).month != d.month for d in all_dates]
load("dim_date", dd)
load("dim_currency", pd.DataFrame({"currency_key": range(1, 10), "currency_code": [c[0] for c in CCY],
                                   "currency_name": [c[1] for c in CCY], "usd_rate": [c[2] for c in CCY]}))
load("dim_market", pd.DataFrame({"market_key": range(1, NM + 1), "market_code": mk_code, "market_name": [m[1] for m in MK],
    "csd_name": [m[2] for m in MK], "region": [m[3] for m in MK], "settlement_cycle": [m[4] for m in MK],
    "penalty_regime": [m[5] for m in MK], "partial_settlement_allowed": [m[6] for m in MK],
    "local_currency": [m[7] for m in MK], "tax_reclaim_complexity": [m[8] for m in MK]}))

# ---------------------------------------------------------------- dim_subcustodian (16: PRIMARY per market + BACKUP for US/GB/DE/JP)
# Separate RNG so subcustodian choices never shift the main simulation stream.
rng_sub = np.random.default_rng(SEED + 1)
BACKUP_MK = ["US", "GB", "DE", "JP"]
SUB_NAMES = ["Liberty Harbor Custody", "Maple Leaf Trust Services", "Albion Custody Services", "Rhine Securities Services",
             "Seine Titres & Conservation", "Lombarda Depositary", "Zuiderzee Bewaar", "Helvetia Safekeeping",
             "Sakura Trust Custody", "Harbour Pearl Custody", "Southern Cross Custodial", "Merlion Securities Services"]
BK_NAMES = ["Continental Bank Custody (US backup)", "Thames Reserve Custody (GB backup)", "Main-Frankfurt Verwahrung (DE backup)", "Fuji Reserve Trust (JP backup)"]
sub_of_market = np.arange(1, NM + 1, dtype=np.int64)       # primary subcustodian key == market_key (every market has one)
backup_of_market = np.zeros(NM, dtype=np.int64)
for i, c in enumerate(BACKUP_MK): backup_of_market[mk_code.index(c)] = NM + 1 + i
sub_mk_list = list(range(1, NM + 1)) + [mk_code.index(c) + 1 for c in BACKUP_MK]
load("dim_subcustodian", pd.DataFrame({"subcustodian_key": range(1, 17), "subcustodian_name": SUB_NAMES + BK_NAMES,
    "market_key": sub_mk_list, "service_tier": ["PRIMARY"] * NM + ["BACKUP"] * 4,
    "contract_start_date_key": [int(dk_arr[day_of(date(int(rng_sub.integers(2016, 2024)), int(rng_sub.integers(1, 13)), 1))]) for _ in range(16)]}))

# ---------------------------------------------------------------- dim_client (50)
NC = 50
seg = np.array(["ASSET_MANAGER"] * 18 + ["PENSION_FUND"] * 12 + ["INSURANCE"] * 8 + ["SOVEREIGN_WEALTH"] * 4 + ["HEDGE_FUND"] * 8)
rng.shuffle(seg)
DOMS = {"ASSET_MANAGER": ["US", "GB", "IE", "LU", "DE", "FR", "CH", "JP", "CA", "AU", "NL"],
        "PENSION_FUND": ["US", "CA", "NL", "GB", "AU", "CH", "DE", "JP"],
        "INSURANCE": ["DE", "FR", "CH", "GB", "JP", "US", "NL", "IT"],
        "SOVEREIGN_WEALTH": ["AE", "SG", "QA", "NO"], "HEDGE_FUND": ["KY", "US", "GB", "BM", "IE", "VG"]}
dom = np.array([rng.choice(DOMS[s]) for s in seg])
A1 = ["Northgate", "Meridian", "Cobalt", "Ironbridge", "Silverleaf", "Halcyon", "Redwood", "Bluehaven", "Granite", "Clearwater",
      "Everstone", "Kestrel", "Lakeshore", "Marlowe", "Oakmont", "Pinnacle", "Quayside", "Ravenscroft", "Stonebridge", "Thornfield",
      "Union Crest", "Vantage", "Westmark", "Yarrow", "Zenith", "Ashford", "Beacon", "Corvid", "Dunmore", "Eastgate",
      "Fairhaven", "Greystone", "Highmoor", "Inverness", "Juniper", "Kingsley", "Larkspur", "Montclair", "Nightingale", "Orchard",
      "Penrose", "Quill", "Rosemont", "Sandstone", "Tidewater", "Umber", "Valmont", "Whitcombe", "Xenon", "Yorkshire"]
SFX = {"ASSET_MANAGER": "Asset Management", "PENSION_FUND": "Pension Fund", "INSURANCE": "Insurance Group",
       "SOVEREIGN_WEALTH": "Sovereign Investment Authority", "HEDGE_FUND": "Capital Partners"}
a1 = list(rng.permutation(A1))
cl_name = [f"{a1[i]} {SFX[seg[i]]}" for i in range(NC)]
seg_size = {"ASSET_MANAGER": 1.0, "PENSION_FUND": 1.5, "INSURANCE": 1.0, "SOVEREIGN_WEALTH": 2.5, "HEDGE_FUND": 0.4}
seg_turn = {"ASSET_MANAGER": 1.2, "PENSION_FUND": 0.6, "INSURANCE": 0.5, "SOVEREIGN_WEALTH": 0.5, "HEDGE_FUND": 3.0}
size_w = np.exp(rng.normal(0, 1.0, NC)) * np.array([seg_size[s] for s in seg])
auc_target = 800e9 * size_w / size_w.sum()                # client AUC at start (sums to $800B)
order = np.argsort(-auc_target)
sla = np.empty(NC, dtype=object); sla[order[:8]] = "PLATINUM"; sla[order[8:28]] = "GOLD"; sla[order[28:]] = "SILVER"
RMS = ["A. Whitfield", "R. Okonkwo", "M. Tanaka", "S. Lindqvist", "P. Duarte", "H. Brandt", "L. Moreau", "J. Alvarez", "K. Nair", "T. Becker"]
load("dim_client", pd.DataFrame({"client_key": range(1, NC + 1), "client_name": cl_name, "client_segment": seg, "domicile_country": dom,
    "sla_tier": sla, "onboarded_date_key": [int(dk_arr[day_of(date(rng.integers(2012, 2025), rng.integers(1, 13), 1))]) for _ in range(NC)],
    "relationship_manager": rng.choice(RMS, NC), "base_currency": [DOM_CCY[d] for d in dom]}))
treaty_dom = np.array([d in TREATY_DOM for d in dom])
# per-client routing mix over counterparty tiers A..D (hedge funds skew to weak counterparties, pensions to strong)
TIERMIX = {"ASSET_MANAGER": [.45, .30, .15, .10], "PENSION_FUND": [.60, .28, .09, .03], "INSURANCE": [.55, .30, .11, .04],
           "SOVEREIGN_WEALTH": [.55, .28, .12, .05], "HEDGE_FUND": [.25, .30, .25, .20]}
cl_tier_p = np.array([rng.dirichlet(np.array(TIERMIX[s]) * 40) for s in seg])
cl_vol_w = (auc_target ** 0.8) * np.array([seg_turn[s] for s in seg]); cl_vol_w /= cl_vol_w.sum()

# ---------------------------------------------------------------- dim_counterparty (60)
NCP = 60
cp_tier = np.array(["A"] * 22 + ["B"] * 19 + ["C"] * 12 + ["D"] * 7)
B1 = ["Alder & Finch", "Brandt Wilkes", "Calloway Hart", "Dunbar Pryce", "Everly Stone", "Falkirk Lowe", "Garrick Moss", "Holloway Reed",
      "Ingram Vale", "Jessop Crane", "Kensington Ward", "Lockhart Dyer", "Marchmont Shaw", "Norwood Teague", "Overton Blythe", "Pemberton Gray",
      "Quentin Ashby", "Radcliffe Moor", "Sterling Hale", "Thackeray Webb", "Underhill Cross", "Vance Holloway", "Whitlock Frost", "Yardley Penn",
      "Ainsworth Cole", "Beaumont Ryle", "Carrow Nash", "Delaney Voss", "Eastwick Lane", "Fenwick Drake", "Gilmour Pike", "Harcourt Bell",
      "Isherwood Fay", "Jarrow Tate", "Kirkwall Rowe", "Lymington Cray", "Mortlake Dean", "Newbury Orr", "Oakhurst Lee", "Prestwick Hume",
      "Queensferry Pitt", "Rothbury Ames", "Selwyn Marsh", "Tavistock Rye", "Ulverston Glenn", "Wexford Hart", "Ambleside Kerr", "Bexley Nunn",
      "Cheswick Orme", "Dalry Fenn", "Elstree Gale", "Farnley Shaw", "Glossop Reid", "Hawick Dunn", "Ilkley Marr", "Jedburgh Colt",
      "Kendal Prowse", "Lyndhurst Boyd", "Malvern Ley", "Nantwich Strand"]
TY = ["BROKER_DEALER", "BANK", "CUSTODIAN", "CLEARING_MEMBER"]
cp_type = rng.choice(TY, NCP, p=[.45, .30, .10, .15])
suffix = {"BROKER_DEALER": "Securities", "BANK": "Bank", "CUSTODIAN": "Trust", "CLEARING_MEMBER": "Clearing"}
cp_name = [f"{B1[i]} {suffix[cp_type[i]]}" for i in range(NCP)]
load("dim_counterparty", pd.DataFrame({"counterparty_key": range(1, NCP + 1), "counterparty_name": cp_name, "counterparty_type": cp_type,
    "region": rng.choice(["Americas", "EMEA", "APAC"], NCP, p=[.4, .4, .2]), "reliability_tier": cp_tier,
    "is_affiliated": rng.random(NCP) < 0.08}))
cp_w = np.exp(rng.normal(0, 0.7, NCP))                    # volume weight within a tier

# ---------------------------------------------------------------- dim_security (800)
NS = 800
sec_mk = rng.choice(NM, NS, p=np.array([m[9] for m in MK]) / sum(m[9] for m in MK))   # 0-based market index
TYPES = ["EQUITY", "GOVT_BOND", "CORP_BOND", "ETF", "MMI"]
sec_type = rng.choice(TYPES, NS, p=[.55, .12, .17, .12, .04])
LIQ = {"EQUITY": [.45, .38, .17], "ETF": [.6, .3, .1], "GOVT_BOND": [.8, .18, .02], "CORP_BOND": [.15, .45, .40], "MMI": [.5, .4, .1]}
sec_liq = np.array([rng.choice(["HIGH", "MEDIUM", "LOW"], p=LIQ[t]) for t in sec_type])
FREQ_EQ = {"US": "QUARTERLY", "CA": "QUARTERLY", "GB": "QUARTERLY", "AU": "SEMI_ANNUAL", "JP": "SEMI_ANNUAL", "HK": "SEMI_ANNUAL",
           "SG": "SEMI_ANNUAL", "NL": "SEMI_ANNUAL"}
def freq(t, m):
    c = mk_code[m]
    if t in ("EQUITY",): return "NONE" if rng.random() < 0.08 else FREQ_EQ.get(c, "ANNUAL")
    if t == "ETF": return "QUARTERLY" if c in ("US", "CA", "GB") else "SEMI_ANNUAL"
    if t in ("GOVT_BOND", "CORP_BOND"): return "ANNUAL" if c in ("DE", "FR", "IT", "NL", "CH") else "SEMI_ANNUAL"
    return "NONE"
sec_freq = np.array([freq(t, m) for t, m in zip(sec_type, sec_mk)])
sec_ccy = mk_ccy[sec_mk]
price0 = np.where(np.isin(sec_type, ["GOVT_BOND", "CORP_BOND", "MMI"]), 100 * np.exp(rng.normal(0, .03, NS)),
                  np.exp(rng.normal(np.log(60), .8, NS)) * np.where(sec_type == "ETF", 1.2, 1.0) * CCY_RATE[sec_ccy] ** 0.8)
ann_yield = np.where(sec_type == "EQUITY", rng.uniform(.012, .04, NS), np.where(sec_type == "ETF", rng.uniform(.01, .03, NS),
                     np.where(sec_type == "MMI", 0, rng.uniform(.02, .055, NS))))
ISSA = ["Alder", "Brightwell", "Calder", "Dunmore", "Elmstead", "Fairlight", "Garrow", "Hollin", "Ivybridge", "Jessamine", "Kingfisher",
        "Lancaster", "Mornington", "Netherby", "Ormerod", "Pendle", "Quarrel", "Ridley", "Saltmarsh", "Tarrant", "Ulverley", "Vickery",
        "Wendover", "Yelverton", "Ashgrove", "Blackwater", "Crestfall", "Dovedale", "Eskdale", "Foxhall", "Glenmoor", "Hartwell", "Ironside",
        "Jarvis", "Kelburn", "Lowther", "Marsden", "Northcote", "Oldfield", "Pickering"]
ISSB = ["Holdings", "Industries", "Energy", "Pharma", "Logistics", "Foods", "Networks", "Materials", "Financial", "Retail", "Motors",
        "Utilities", "Systems", "Capital", "Healthcare", "Minerals", "Telecom", "Aerospace", "Chemicals", "Water"]
LEGAL = {"US": "Inc", "CA": "Corp", "GB": "plc", "DE": "AG", "FR": "SA", "IT": "S.p.A.", "NL": "N.V.", "CH": "AG", "JP": "K.K.", "HK": "Ltd", "AU": "Ltd", "SG": "Ltd"}
def isin(cc, n):
    body = cc + f"{n:09d}"; digs = "".join(str(int(ch, 36)) for ch in body)
    tot = 0
    for i, ch in enumerate(reversed(digs)):
        v = int(ch) * (2 if i % 2 == 0 else 1); tot += v // 10 + v % 10
    return body + str((10 - tot % 10) % 10)
pick = rng.permutation(len(ISSA) * len(ISSB))[:NS]
sec_name, sec_issuer, sec_isin = [], [], []
for i in range(NS):
    iss = f"{ISSA[pick[i] // len(ISSB)]} {ISSB[pick[i] % len(ISSB)]}"; c = mk_code[sec_mk[i]]
    t = sec_type[i]
    if t == "EQUITY": nm = f"{iss} {LEGAL[c]}"
    elif t == "ETF": nm = f"{iss.split()[0]} {['Global', 'Income', 'Index', 'Value'][i % 4]} ETF"
    elif t == "GOVT_BOND": nm = f"{[m[1] for m in MK][sec_mk[i]]} Govt {rng.uniform(1, 5):.2f}% {2026 + int(rng.integers(1, 20))}"
    elif t == "CORP_BOND": nm = f"{iss} {rng.uniform(2, 6):.2f}% {2026 + int(rng.integers(1, 12))}"
    else: nm = f"{[m[1] for m in MK][sec_mk[i]]} T-Bill/CP {int(rng.integers(1, 12))}M"
    sec_name.append(nm); sec_issuer.append(iss if t != "GOVT_BOND" else f"Government of {[m[1] for m in MK][sec_mk[i]]}")
    sec_isin.append(isin(c, 100000 + i * 37))
load("dim_security", pd.DataFrame({"security_key": range(1, NS + 1), "isin": sec_isin, "security_name": sec_name, "security_type": sec_type,
    "issuer_name": sec_issuer, "issuer_country": [mk_code[m] for m in sec_mk], "market_key": sec_mk + 1,
    "local_currency": [CCY[c - 1][0] for c in sec_ccy], "income_frequency": sec_freq, "liquidity_tier": sec_liq}))
log("dimensions loaded")

# ---------------------------------------------------------------- price paths (security x window day)
mkt_f = rng.normal(0.0001, 0.006, NW)
vol = np.select([sec_type == "EQUITY", sec_type == "ETF", sec_type == "CORP_BOND", sec_type == "GOVT_BOND"], [.010, .006, .003, .0025], .0003)
beta = np.where(np.isin(sec_type, ["EQUITY", "ETF"]), rng.uniform(.6, 1.3, NS), .1)
ret = mkt_f[None, :] * beta[:, None] + rng.normal(0, 1, (NS, NW)) * vol[:, None]
ret[:, 0] = 0
price = price0[:, None] * np.exp(np.cumsum(ret, axis=1))                  # NS x NW local price

# ---------------------------------------------------------------- client x security holdings (~2,000 pairs)
sec_turn = np.select([sec_liq == "HIGH", sec_liq == "MEDIUM"], [1.5, 1.0], 0.4) * np.where(np.isin(sec_type, ["GOVT_BOND", "MMI"]), 0.7, 1.0)
pairs = set()
for s in range(NS):                                                       # every security has at least one holder
    pairs.add((int(rng.choice(NC, p=cl_vol_w ** 0.5 / (cl_vol_w ** 0.5).sum())), s))
home = np.array([mk_code.index(d) if d in mk_code else -1 for d in dom])
pairs_per_client = np.maximum(15, (2000 * (auc_target / auc_target.sum()) ** 0.7 / ((auc_target / auc_target.sum()) ** 0.7).sum())).astype(int)
while len(pairs) < 2000:
    c = int(rng.choice(NC, p=pairs_per_client / pairs_per_client.sum()))
    w = np.where(sec_mk == home[c], 3.0, 1.0) * sec_turn; w = w / w.sum()
    pairs.add((c, int(rng.choice(NS, p=w))))
pairs = sorted(pairs); P = len(pairs)
pc = np.array([p[0] for p in pairs]); ps = np.array([p[1] for p in pairs])
cnt = np.bincount(pc, minlength=NC)
pw = np.exp(rng.normal(0, 0.8, P)); pw_sum = np.bincount(pc, weights=pw, minlength=NC)
base_val_usd = auc_target[pc] * pw / pw_sum[pc]
base_qty = np.maximum(1000, np.round(base_val_usd * CCY_RATE[sec_ccy[ps]] / price[ps, 0])).astype(np.int64)
log(f"{P} client x security pairs")

# ---------------------------------------------------------------- CHAIN 1: settlement instructions
N = 540_000
w_pair = cl_vol_w[pc] / cnt[pc] * sec_turn[ps]; w_pair /= w_pair.sum()
pair_i = rng.choice(P, N, p=w_pair)
dw = np.ones(len(BDW)); d_m = np.array([all_dates[d].day for d in BDW]); dw[d_m >= 27] *= 1.12; dw[d_m <= 2] *= 0.95; dw /= dw.sum()
trade_day = np.sort(rng.choice(BDW, N, p=dw))
i_cl, i_sec = pc[pair_i], ps[pair_i]
i_mk = sec_mk[i_sec]; i_ccy = sec_ccy[i_sec]
u = rng.random(N); cum = np.cumsum(cl_tier_p[i_cl], axis=1)
tier = (u[:, None] > cum[:, :3]).sum(axis=1)                              # 0..3 = A..D
i_cp = np.empty(N, dtype=np.int64)
for t in range(4):
    m = tier == t; ids = np.flatnonzero(cp_tier == "ABCD"[t]); wt = cp_w[ids] / cp_w[ids].sum()
    i_cp[m] = ids[rng.choice(len(ids), m.sum(), p=wt)]
isd = add_bd(trade_day, mk_cycle[i_mk])
direction = np.where(rng.random(N) < 0.5, "RECEIVE", "DELIVER")
frac = np.minimum(rng.lognormal(np.log(0.0012), 0.9, N), 0.05)
qty = np.maximum(1, np.round(base_qty[pair_i] * frac)).astype(np.int64)
px = price[i_sec, np.clip(trade_day - sD, 0, NW - 1)]
amt_local = np.round(qty * px, 2); amt_usd = np.round(amt_local / CCY_RATE[i_ccy], 2)
# fail probability: tier rate x (type x liquidity x market multipliers), normalised so each tier's realised rate == target
TIER_RATE = np.array([.01, .025, .07, .14])
tm = {"EQUITY": 1.0, "ETF": .9, "CORP_BOND": 1.7, "GOVT_BOND": .45, "MMI": .35}; lm = {"HIGH": .6, "MEDIUM": 1.0, "LOW": 2.2}
wmult = np.array([tm[t] for t in sec_type])[i_sec] * np.array([lm[l] for l in sec_liq])[i_sec] * mk_failmult[i_mk]
for t in range(4): wmult[tier == t] /= wmult[tier == t].mean()
p_fail = np.minimum(TIER_RATE[tier] * wmult, 0.6)
cancelled = rng.random(N) < 0.004
pending = isd > eD
failed = (rng.random(N) < p_fail) & ~cancelled & ~pending
DAYS_MEAN = np.array([1.6, 2.4, 4.0, 7.0])
days_failed = np.where(failed, np.minimum(25, rng.geometric(1 / DAYS_MEAN[tier])), 0).astype(np.int64)   # >=1, mean by tier
act_settle = np.where(failed, add_bd(isd, np.maximum(days_failed, 1)), isd)
unsettled = cancelled | pending | (act_settle > eD)                        # no actual settlement inside the window
act_has = ~unsettled
REASONS = ["LACK_OF_SECURITIES", "MISMATCHED_INSTRUCTION", "COUNTERPARTY_INSTRUCTION_MISSING", "MARKET_RESTRICTION", "LATE_MATCHING"]
reason = np.full(N, None, dtype=object)
fr = np.flatnonzero(failed)
rec_f = fr[direction[fr] == "RECEIVE"]; del_f = fr[direction[fr] == "DELIVER"]
reason[rec_f] = rng.choice(REASONS, len(rec_f), p=[.50, .12, .15, .10, .13])
reason[del_f] = rng.choice(["LACK_OF_CASH"] + REASONS[1:], len(del_f), p=[.50, .12, .15, .10, .13])
matched = np.ones(N, dtype=bool)
matched[fr] = ~np.isin(reason[fr], ["LATE_MATCHING", "MISMATCHED_INSTRUCTION", "COUNTERPARTY_INSTRUCTION_MISSING"])
matched[rng.random(N) < 0.015] = False
status = np.select([cancelled, pending, failed], ["CANCELLED", "PENDING", "FAILED"], "SETTLED")
instr = pd.DataFrame({"instruction_key": np.arange(1, N + 1), "instruction_ref": [f"INS-{i:07d}" for i in range(1, N + 1)],
    "trade_date_key": dk_arr[trade_day], "intended_settle_date_key": dk_arr[isd],
    "actual_settle_date_key": nI(dk_arr[np.minimum(act_settle, ND - 1)], unsettled),
    "client_key": i_cl + 1, "security_key": i_sec + 1, "counterparty_key": i_cp + 1, "market_key": i_mk + 1,
    "subcustodian_key": np.where((backup_of_market[i_mk] > 0) & (rng_sub.random(N) < 0.10), backup_of_market[i_mk], sub_of_market[i_mk]),
    "currency_key": i_ccy, "direction": direction,
    "quantity": qty, "settlement_amount_local": amt_local, "settlement_amount_usd": amt_usd, "settlement_status": status,
    "fail_reason_code": reason, "days_failed": days_failed, "is_matched_on_time": matched})
load("stl_trade_instruction", instr)
n_dec = (~cancelled & ~pending).sum()
log(f"instructions {N:,}; fails {failed.sum():,} ({100*failed.sum()/n_dec:.2f}% of decided)")

# penalties: one row per failed business day, CSDR/CREST markets only (regime NONE -> zero rows by construction)
pen_mask = failed & (mk_regime[i_mk] != "NONE")
pi = np.flatnonzero(pen_mask)
reps = np.minimum(days_failed[pi], 30)
row_inst = np.repeat(pi, reps)
k = np.arange(len(row_inst)) - np.repeat(np.cumsum(reps) - reps, reps)
pen_day = add_bd(isd[row_inst], k)
keep = pen_day <= eD
row_inst, pen_day = row_inst[keep], pen_day[keep]
reg = mk_regime[i_mk[row_inst]]
RATE = {"EQUITY": 1.0, "ETF": .5, "CORP_BOND": .2, "GOVT_BOND": .1, "MMI": .1}
rate_bps = np.where(reg == "CREST", 0.5, np.array([RATE[t] for t in sec_type])[i_sec[row_inst]])
bearer_i = rng.choice(["CLIENT", "HARBORLINE", "COUNTERPARTY"], len(pi), p=[.5, .2, .3])
bearer_map = dict(zip(pi, bearer_i))
pen = pd.DataFrame({"penalty_key": np.arange(1, len(row_inst) + 1), "instruction_key": row_inst + 1,
    "penalty_date_key": dk_arr[pen_day], "client_key": i_cl[row_inst] + 1, "counterparty_key": i_cp[row_inst] + 1,
    "market_key": i_mk[row_inst] + 1, "penalty_type": np.where(reason[row_inst] == "LATE_MATCHING", "LMFP", "SEFP"),
    "penalty_regime": reg, "penalty_rate_bps": rate_bps, "penalty_amount_usd": np.round(rate_bps / 1e4 * amt_usd[row_inst], 2),
    "bearer": [bearer_map[i] for i in row_inst]})
load("stl_fail_penalty", pen)
log(f"penalties {len(pen):,}")

# ---------------------------------------------------------------- POS: daily positions (settled flows + failed-receive pending)
delta = np.zeros((P, NW + 1), dtype=np.int64); pend = np.zeros((P, NW + 1), dtype=np.int64)
sg = np.where(direction == "RECEIVE", 1, -1) * qty
m = act_has
np.add.at(delta, (pair_i[m], np.clip(act_settle[m] - sD, 0, NW)), sg[m])
mr = failed & (direction == "RECEIVE")
np.add.at(pend, (pair_i[mr], np.clip(isd[mr] - sD, 0, NW)), qty[mr])
ms = mr & act_has
np.add.at(pend, (pair_i[ms], np.clip(act_settle[ms] - sD, 0, NW)), -qty[ms])
q_settled = base_qty[:, None] + np.cumsum(delta[:, :NW], axis=1)
low = q_settled.min(axis=1)
base_qty = base_qty + np.where(low < 1000, 1000 - low, 0)                  # keep holdings positive
q_settled = base_qty[:, None] + np.cumsum(delta[:, :NW], axis=1)
q_pend = np.cumsum(pend[:, :NW], axis=1)
mv_local = np.round(q_settled * price[ps], 2)
mv_usd = np.round(mv_local / CCY_RATE[sec_ccy[ps]][:, None], 2)
pk = np.arange(P * NW)
pos = pd.DataFrame({"position_key": pk + 1, "position_date_key": np.tile(dk_arr[sD:eD + 1], P),
    "client_key": np.repeat(pc + 1, NW), "security_key": np.repeat(ps + 1, NW), "market_key": np.repeat(sec_mk[ps] + 1, NW),
    "subcustodian_key": np.repeat(sub_of_market[sec_mk[ps]], NW),
    "currency_key": np.repeat(sec_ccy[ps], NW), "quantity_settled": q_settled.ravel(), "quantity_pending": q_pend.ravel(),
    "market_value_local": mv_local.ravel(), "market_value_usd": mv_usd.ravel()})
load("pos_daily_position", pos)
auc_last = mv_usd[:, -1].sum()
log(f"positions {len(pos):,}; AUC on {END}: ${auc_last/1e9:,.1f}B")
del pos

# cash balances: thin operating buffer per client/currency; failed DELIVER = cash not received -> may overdraw
gid = i_cl * 10 + i_ccy
vol_g = pd.Series(amt_usd[act_has]).groupby(gid[act_has]).agg(["sum", "count"])
vol_g = vol_g[vol_g["count"] >= 300]
groups = vol_g.index.values; G = len(groups)
gpos = {g: i for i, g in enumerate(groups)}
nb = len(BDW); bpos = {int(d): i for i, d in enumerate(BDW)}
bw_of_day = np.searchsorted(BDW, np.arange(ND))
U = np.zeros((G, nb + 1))
mf = np.flatnonzero(failed & (direction == "DELIVER") & np.isin(gid, groups))
gi = np.array([gpos[g] for g in gid[mf]]); s0 = bw_of_day[isd[mf]]
e0 = np.where(act_has[mf], bw_of_day[np.minimum(act_settle[mf], ND - 1)], nb)    # unreceived until settled
np.add.at(U, (gi, np.clip(s0, 0, nb)), amt_usd[mf]); np.add.at(U, (gi, np.clip(e0, 0, nb)), -amt_usd[mf])
U = np.cumsum(U, axis=1)[:, :nb]
BETA = float(sys.argv[1]) if len(sys.argv) > 1 else 0.30
buf = BETA * (vol_g["sum"].values / nb) * np.exp(rng.normal(0, .3, G))
noise = np.zeros((G, nb)); e = rng.normal(0, .18, (G, nb))
for t in range(1, nb): noise[:, t] = .6 * noise[:, t - 1] + e[:, t]
closing = buf[:, None] * (1 + noise) - U
opening = np.concatenate([closing[:, :1], closing[:, :-1]], axis=1)
od = np.maximum(0, -closing); cg_ccy = groups % 10; cg_cl = groups // 10
fund = np.round(od * OD_RATE[cg_ccy][:, None] / 360, 2)
cash = pd.DataFrame({"cash_balance_key": np.arange(1, G * nb + 1), "balance_date_key": np.tile(dk_arr[BDW], G),
    "client_key": np.repeat(cg_cl + 1, nb), "currency_key": np.repeat(cg_ccy, nb), "opening_balance_usd": np.round(opening.ravel(), 2),
    "closing_balance_usd": np.round(closing.ravel(), 2), "is_overdrawn": (closing < 0).ravel(),
    "overdraft_amount_usd": np.round(od.ravel(), 2), "funding_cost_usd": fund.ravel()})
load("pos_cash_balance", cash)
log(f"cash balances {len(cash):,}; overdrawn day share {100*(closing<0).mean():.1f}%")

# ---------------------------------------------------------------- CAE events
EV, ev_rows = [], []
n_per_year = {"ANNUAL": 1, "SEMI_ANNUAL": 2, "QUARTERLY": 4}
for s in range(NS):                                                        # mandatory income events from income_frequency
    f = sec_freq[s]
    if f == "NONE": continue
    n = n_per_year[f]; step = 365.0 / n; phase = rng.uniform(0, step)
    t = sD - 20 + phase
    while t <= eD - 11:
        if t >= sD: ev_rows.append((s, int(t), "CASH_DIVIDEND" if sec_type[s] in ("EQUITY", "ETF") else "COUPON", False, 0))
        t += step
ev = pd.DataFrame(ev_rows, columns=["s", "pay_raw", "event_type", "vol", "w"])
n_mand = len(ev)
extra_split = rng.choice(np.flatnonzero(sec_type == "EQUITY"), int(n_mand * 0.01), replace=True)
ev = pd.concat([ev, pd.DataFrame({"s": extra_split, "pay_raw": rng.integers(sD + 5, eD - 11, len(extra_split)),
                                  "event_type": "STOCK_SPLIT", "vol": False, "w": 0})], ignore_index=True)
n_mand = len(ev)
# voluntary events: 25% of all events, weighted to securities that clients actually hold
holders = np.bincount(ps, minlength=NS).astype(float)
n_vol = int(round(n_mand / 3))
vs = rng.choice(NS, n_vol, p=(holders * np.isin(sec_type, ["EQUITY", "CORP_BOND"])) / (holders * np.isin(sec_type, ["EQUITY", "CORP_BOND"])).sum())
vtype = np.array([rng.choice(["TENDER_OFFER", "MERGER", "RIGHTS_ISSUE", "DIVIDEND_OPTION"], p=[.25, .15, .25, .35]) if sec_type[s] == "EQUITY"
                  else "TENDER_OFFER" for s in vs])
LATE_MK = {"IT", "HK", "JP"}
late = np.array([mk_code[sec_mk[s]] in LATE_MK for s in vs])
bucket = np.where(late, rng.choice(3, n_vol, p=[.45, .30, .25]), rng.choice(3, n_vol, p=[.05, .20, .75]))   # 0:<=2d 1:3-4d 2:>=5d
dl = np.zeros(n_vol, dtype=np.int64); an = np.zeros(n_vol, dtype=np.int64); wd = np.zeros(n_vol, dtype=np.int64)
todo = np.arange(n_vol)
for _ in range(80):                                                         # rejection sampling: deadline & announcement both business days
    if len(todo) == 0: break
    d = next_bd(rng.integers(sD + 8, eD - 14, len(todo)))
    b = bucket[todo]
    w = np.where(b == 0, rng.integers(1, 3, len(todo)), np.where(b == 1, rng.integers(3, 5, len(todo)), rng.integers(5, 22, len(todo))))
    ok = is_bd[d - w]
    dl[todo[ok]], an[todo[ok]], wd[todo[ok]] = d[ok], (d - w)[ok], w[ok]
    todo = todo[~ok]
assert len(todo) == 0, len(todo)
# NOTE on impact: estimated_client_impact_usd = 0.1-1% of the entitled position value, capped at USD 5M (compensation ~ option difference, not the whole holding).
# Rescaled in the D-044 patch: the original 1-5% draw is still consumed from the main rng (keeps every other table byte-identical); the new fraction uses its own seeded stream.
vol_ev = pd.DataFrame({"s": vs, "event_type": vtype, "vol": True, "w": wd, "dl": dl, "an": an})
# mandatory event dates
ev["pay"] = next_bd(ev["pay_raw"].values); ev["an"] = prev_bd(ev["pay"].values - rng.integers(10, 31, len(ev)))
ev["dl"] = -1
vol_ev["pay"] = next_bd(vol_ev["dl"].values + rng.integers(3, 11, n_vol))
ev = pd.concat([ev.drop(columns=["pay_raw"]), vol_ev], ignore_index=True)
ev["rec"] = np.where(ev["vol"], ev["an"], prev_bd(ev["pay"].values - rng.integers(2, 7, len(ev))))
ev = ev[ev["pay"] <= eD].reset_index(drop=True)
NE = len(ev)
rate_ps = np.where(ev["event_type"].isin(["CASH_DIVIDEND", "COUPON", "DIVIDEND_OPTION"]),
                   price0[ev["s"]] * ann_yield[ev["s"]] / np.array([n_per_year.get(f, 2) for f in sec_freq[ev["s"]]]), 0.0)
cae_event = pd.DataFrame({"event_key": np.arange(1, NE + 1), "event_ref": [f"CAE-{i:06d}" for i in range(1, NE + 1)],
    "security_key": ev["s"].values + 1, "market_key": sec_mk[ev["s"]] + 1, "event_type": ev["event_type"].values,
    "is_voluntary": ev["vol"].values.astype(bool), "announcement_date_key": dk_arr[ev["an"].values],
    "record_date_key": dk_arr[ev["rec"].values], "response_deadline_date_key": nI(dk_arr[np.maximum(ev["dl"].values, 0)], ~ev["vol"].values.astype(bool)),
    "payment_date_key": dk_arr[ev["pay"].values],
    "notice_window_days": nI(ev["w"].values, ~ev["vol"].values.astype(bool)), "gross_rate_per_share": np.round(rate_ps, 6)})
load("cae_event", cae_event)
log(f"cae events {NE:,} (voluntary {int(ev['vol'].sum()):,} = {100*ev['vol'].mean():.1f}%)")

# elections: CHAIN 2
by_sec = {}
for p in range(P): by_sec.setdefault(int(ps[p]), []).append(p)
P_MISS = np.array([.09, .03, .005])
el = []
for e_i in np.flatnonzero(ev["vol"].values):
    r = ev.iloc[e_i]; w = int(r["w"]); b = 0 if w <= 2 else 1 if w <= 4 else 2
    for p in by_sec.get(int(r["s"]), []):
        el.append((e_i + 1, int(pc[p]), int(r["s"]), int(base_qty[p]), int(r["an"]), int(r["dl"]), w, b, int(p)))
elc = pd.DataFrame(el, columns=["event_key", "c", "s", "q", "an", "dl", "w", "b", "p"])
miss = rng.random(len(elc)) < P_MISS[elc["b"].values]
dflt = (~miss) & (rng.random(len(elc)) < 0.13)
st = np.where(miss, "MISSED_DEADLINE", np.where(dflt, "DEFAULTED", "ELECTED"))
hrs_ok = np.maximum(2, np.round(rng.uniform(0.05, 0.95, len(elc)) * elc["w"].values * 24)).astype(int)
hours = np.where(miss, -rng.integers(1, 73, len(elc)), np.where(dflt, 0, hrs_ok))
el_day = np.maximum(elc["an"].values, elc["dl"].values - hours // 24)
px_el = price[elc["s"].values, np.clip(elc["dl"].values - sD, 0, NW - 1)] / CCY_RATE[sec_ccy[elc["s"].values]]
_old_frac = rng.uniform(.01, .05, len(elc))                       # consumed only to keep the main random stream unchanged
_frac = np.random.default_rng(SEED + 4401).uniform(.001, .01, len(elc))
impact = np.where(miss, np.minimum(np.round(elc["q"].values * px_el * _frac, 2), 5_000_000.0), 0.0)
election = pd.DataFrame({"election_key": np.arange(1, len(elc) + 1), "event_key": elc["event_key"].values, "client_key": elc["c"].values + 1,
    "security_key": elc["s"].values + 1, "entitled_quantity": elc["q"].values.astype(np.int64), "election_status": st,
    "elected_date_key": nI(dk_arr[el_day], miss | dflt), "deadline_date_key": dk_arr[elc["dl"].values],
    "hours_before_deadline": nI(hours, dflt), "missed_deadline": miss, "estimated_client_impact_usd": impact})
load("cae_client_election", election)
log(f"elections {len(elc):,}; missed {miss.sum()} ({100*miss.mean():.2f}%)")

# income payments + tax reclaim: CHAIN 3
inc_ev = np.flatnonzero(ev["event_type"].isin(["CASH_DIVIDEND", "COUPON"]).values)
ip = []
for e_i in inc_ev:
    r = ev.iloc[e_i]
    for p in by_sec.get(int(r["s"]), []): ip.append((e_i, int(p)))
ip = np.array(ip); ie, ipr = ip[:, 0], ip[:, 1]
i_s = ev["s"].values[ie]; i_c = pc[ipr]; i_q = base_qty[ipr]
i_m = sec_mk[i_s]
exp_day = ev["pay"].values[ie]
is_late = rng.random(len(ie)) < 0.05
dl_days = np.where(is_late, rng.integers(1, 11, len(ie)), 0)
act_day = np.where(exp_day + dl_days <= eD, exp_day + dl_days, exp_day); dl_days = act_day - exp_day
gross_usd = np.round(i_q * rate_ps[ie] / CCY_RATE[sec_ccy[i_s]], 2)
withheld = np.isin(sec_type[i_s], ["EQUITY", "ETF"])                        # dividends only; bond coupons treated as gross-paid
stat = np.where(withheld, np.array([STAT[mk_code[m]] for m in range(NM)])[i_m], 0.0)
treaty = np.where(withheld & treaty_dom[i_c], np.array([TREATY[mk_code[m]] for m in range(NM)])[i_m], stat)
domestic = np.array([dom[c] == mk_code[m] for c, m in zip(i_c, i_m)])
treaty = np.where(domestic, stat, treaty)
elig = stat > treaty
# filing probability falls with reclaim complexity; base solved so overall filed share == 60%
cx_delta = {"LOW": .18, "MEDIUM": .05, "HIGH": -.30}
dlt = np.array([cx_delta[x] for x in mk_complex])[i_m] + np.where(seg[i_c] == "HEDGE_FUND", -.05, 0) + np.where(seg[i_c] == "PENSION_FUND", .04, 0)
lo, hi = -1.0, 1.5
for _ in range(60):
    mid = (lo + hi) / 2
    if np.clip(mid + dlt[elig], .02, .98).mean() < .60: lo = mid
    else: hi = mid
filed = elig & (rng.random(len(ie)) < np.clip((lo + hi) / 2 + dlt, .02, .98))
wh = np.round(gross_usd * stat / 100, 2)
recl_amt = np.where(elig, np.round(gross_usd * (stat - treaty) / 100, 2), 0.0)
pay_date = np.array(all_dates, dtype=object)[act_day]
statute = np.array([48 if mk_code[m] in ("FR", "IT") else 36 for m in i_m])
def add_months(d, n):
    y, m0 = divmod(d.month - 1 + n, 12); yy = d.year + y; mm = m0 + 1
    import calendar
    return date(yy, mm, min(d.day, calendar.monthrange(yy, mm)[1]))
recl_dl = np.array([dk_arr[day_of(add_months(d, int(n)))] if e_ else 0 for d, n, e_ in zip(pay_date, statute, elig)])
income = pd.DataFrame({"income_payment_key": np.arange(1, len(ie) + 1), "event_key": ie + 1, "client_key": i_c + 1,
    "security_key": i_s + 1, "market_key": i_m + 1, "currency_key": sec_ccy[i_s], "expected_date_key": dk_arr[exp_day],
    "actual_date_key": dk_arr[act_day], "days_late": dl_days, "gross_amount_usd": gross_usd, "withholding_tax_usd": wh,
    "net_amount_usd": np.round(gross_usd - wh, 2), "statutory_rate_pct": stat, "treaty_rate_pct": treaty,
    "reclaim_eligible": elig, "reclaim_filed": filed, "reclaim_amount_usd": recl_amt,
    "reclaim_deadline_date_key": nI(recl_dl, ~elig)})
load("cae_income_payment", income)
log(f"income payments {len(income):,}; eligible {elig.sum():,}; filed {100*filed.sum()/max(1,elig.sum()):.1f}%")

# ---------------------------------------------------------------- per-client outcome tallies (drive CLT, REC)
fails_c = np.bincount(i_cl[failed], minlength=NC).astype(float)
od_days_c = np.bincount(cg_cl, weights=(closing < 0).sum(axis=1), minlength=NC)
miss_c = np.bincount(elc["c"].values[miss], minlength=NC)
late_c = np.bincount(i_c[is_late], minlength=NC)
congestion = fails_c / max(1.0, np.median(fails_c))

# ---------------------------------------------------------------- CLT: service requests
SLA_H = {"PLATINUM": 8, "GOLD": 24, "SILVER": 48}
sr = []
fail_idx_by_c = {c: np.flatnonzero(failed & (i_cl == c)) for c in range(NC)}
for c in range(NC):
    for cat, lam in (("FAIL_QUERY", .16 * fails_c[c]), ("INCOME_QUERY", .6 * late_c[c] + .01 * (i_c == c).sum()),
                     ("CORPORATE_ACTION_QUERY", .05 * (elc["c"].values == c).sum() + 3 * miss_c[c]),
                     ("REPORTING", 14 + 4 * (sla[c] == "PLATINUM")), ("RECONCILIATION", .02 * fails_c[c] + 4),
                     ("ONBOARDING", 2 if dk_arr[0] else 0)):
        n = int(rng.poisson(lam))
        for _ in range(n):
            if cat == "FAIL_QUERY" and len(fail_idx_by_c[c]):
                day = int(add_bd(np.array([isd[rng.choice(fail_idx_by_c[c])]]), int(rng.integers(1, 4)))[0])
            else:
                day = int(rng.choice(BDW))
            sr.append((c, day, cat))
src = pd.DataFrame(sr, columns=["c", "day", "cat"])
src = src[src["day"] <= eD].reset_index(drop=True)
tgt = np.array([SLA_H[sla[c]] for c in src["c"]])
res_h = np.round(tgt * rng.lognormal(np.log(.45), .7, len(src)) * (1 + .12 * congestion[src["c"].values]), 2)
res_day = add_bd(src["day"].values, np.maximum(0, (res_h // 24).astype(int)) + (res_h % 24 > 8).astype(int))
open_ = res_day > eD
elapsed = (eD - src["day"].values) * 24
prio = np.where(src["cat"].values == "FAIL_QUERY", rng.choice(["P1", "P2", "P3"], len(src), p=[.2, .5, .3]), rng.choice(["P1", "P2", "P3"], len(src), p=[.05, .35, .6]))
srv = pd.DataFrame({"service_request_key": np.arange(1, len(src) + 1), "client_key": src["c"].values + 1, "raised_date_key": dk_arr[src["day"].values],
    "resolved_date_key": nI(dk_arr[np.minimum(res_day, ND - 1)], open_), "request_category": src["cat"].values, "priority": prio,
    "resolution_hours": pd.array(np.where(open_, np.nan, res_h), dtype="Float64"), "sla_target_hours": tgt,
    "sla_breached": np.where(open_, elapsed > tgt, res_h > tgt),
    "analyst_hours": np.round(rng.lognormal(np.log(1.6), .6, len(src)) * np.where(src["cat"].values == "FAIL_QUERY", 1.3, 1.0), 2)})
srv["resolution_hours"] = srv["resolution_hours"].astype("Float64")
load("clt_service_request", srv)
log(f"service requests {len(srv):,}; breached {100*srv['sla_breached'].mean():.1f}%")

# ---------------------------------------------------------------- REC: breaks
rb = []
fr_i = np.flatnonzero(failed)
pb = np.where(tier[fr_i] == 3, .18, np.where(tier[fr_i] == 2, .14, .08))
for i in fr_i[rng.random(len(fr_i)) < pb]:
    det = int(add_bd(np.array([isd[i]]), int(min(days_failed[i], 4)))[0])
    rb.append((i_cl[i], i_sec[i], i_mk[i], det, "FAILED_SETTLEMENT", float(amt_usd[i]) * rng.uniform(.3, 1), rng.choice(["CASH", "POSITION", "TRANSACTION"], p=[.4, .3, .3])))
for e_i in np.flatnonzero(miss):
    rb.append((int(elc["c"].values[e_i]), int(elc["s"].values[e_i]), int(sec_mk[elc["s"].values[e_i]]), int(elc["dl"].values[e_i]) + 1, "CORPORATE_ACTION",
               float(impact[e_i]) or 1000.0, "CASH"))
for j in np.flatnonzero(is_late & (rng.random(len(ie)) < .5)):
    rb.append((int(i_c[j]), int(i_s[j]), int(i_m[j]), int(act_day[j]), "CORPORATE_ACTION", float(gross_usd[j]) * .1, "CASH"))
for cause, n in (("FX", 700), ("TIMING", 1100), ("UNKNOWN", 550)):
    for _ in range(n):
        p = int(rng.integers(P)); rb.append((int(pc[p]), int(ps[p]), int(sec_mk[ps[p]]), int(rng.choice(BDW)), cause,
                                             float(np.exp(rng.normal(10.5, 1.1))), rng.choice(["CASH", "POSITION", "TRANSACTION"])))
rbd = pd.DataFrame(rb, columns=["c", "s", "m", "det", "cause", "amt", "typ"])
rbd = rbd[rbd["det"] <= eD].reset_index(drop=True)
med = rbd["cause"].map({"FAILED_SETTLEMENT": 3, "CORPORATE_ACTION": 6, "FX": 2, "TIMING": 1.5, "UNKNOWN": 12}).values
rdays = np.maximum(1, np.round(rng.lognormal(np.log(med), .7))).astype(int)
rdate = add_bd(rbd["det"].values, rdays)
isopen = rdate > eD
written = (~isopen) & (rng.random(len(rbd)) < .03)
rec = pd.DataFrame({"break_key": np.arange(1, len(rbd) + 1), "break_ref": [f"BRK-{i:06d}" for i in range(1, len(rbd) + 1)],
    "detected_date_key": dk_arr[rbd["det"].values], "resolved_date_key": nI(dk_arr[np.minimum(rdate, ND - 1)], isopen),
    "client_key": rbd["c"].values + 1, "security_key": rbd["s"].values + 1, "market_key": rbd["m"].values + 1,
    "subcustodian_key": sub_of_market[rbd["m"].values], "break_type": rbd["typ"].values,
    "break_amount_usd": np.round(rbd["amt"].values, 2), "age_days": np.where(isopen, eD - rbd["det"].values, rdate - rbd["det"].values),
    "break_status": np.where(isopen, "OPEN", np.where(written, "WRITTEN_OFF", "RESOLVED")), "root_cause": rbd["cause"].values})
load("rec_break", rec)
log(f"breaks {len(rec):,}")

# ---------------------------------------------------------------- CLT: monthly fee invoices
months = sorted({(d.year, d.month) for d in (all_dates[i] for i in range(sD, eD + 1))})
months = [(y, m_) for (y, m_) in months if (date(y + (m_ == 12), m_ % 12 + 1, 1) - timedelta(1)) <= END]   # complete months only
dkey_to_mo = lambda dkv: (dkv // 10000, (dkv // 100) % 100)
inv = []
disc_client = set(order[:5]); cap_client = set(order[:3])
mo_arr = lambda days: np.array([(all_dates[d].year, all_dates[d].month) for d in days])
trade_mo = trade_day.copy()
tm_key = np.array([all_dates[d].year * 100 + all_dates[d].month for d in range(ND)])
for (y, mo) in months:
    mk_ = y * 100 + mo
    me_day = max(i for i in range(sD, eD + 1) if tm_key[i] == mk_)   # last calendar day of the month
    in_mo = (np.array([tm_key[sD + t] for t in range(NW)]) == mk_)
    auc_c = np.bincount(pc, weights=(mv_usd[:, in_mo]).mean(axis=1), minlength=NC)
    tx_c = np.bincount(i_cl[tm_key[trade_day] == mk_], minlength=NC)
    fund_c = np.zeros(NC)
    inmo_b = np.array([tm_key[d] == mk_ for d in BDW])
    np.add.at(fund_c, cg_cl, fund[:, inmo_b].sum(axis=1))
    elc_mo = np.bincount(elc["c"].values[[tm_key[d] == mk_ for d in elc["dl"].values]], minlength=NC)
    inc_mask = np.array([tm_key[d] == mk_ for d in act_day])
    inc_c = np.bincount(i_c[inc_mask], weights=gross_usd[inc_mask], minlength=NC)
    rec_c = np.bincount(i_c[inc_mask & filed], weights=recl_amt[inc_mask & filed], minlength=NC)
    br_mask = np.array([tm_key[d] == mk_ for d in src["day"].values]) & srv["sla_breached"].values.astype(bool)
    br_c = np.bincount(src["c"].values[br_mask], minlength=NC)
    for c in range(NC):
        rows = [("CUSTODY_BPS", auc_c[c], float(rng.uniform(.9, 1.6)) / 10000 / 12 * (0.75 if sla[c] == "PLATINUM" else 1.0)),
                ("TRANSACTION", tx_c[c], 11.0), ("CORPORATE_ACTION", elc_mo[c], 45.0),
                ("INCOME_COLLECTION", inc_c[c], .0005), ("TAX_RECLAIM", rec_c[c], .10), ("OVERDRAFT", fund_c[c], 1.15)]
        for ft, basis, rate in rows:
            if basis <= 0: continue
            bill = round(basis * rate, 2); invd, why = bill, None
            if ft == "CUSTODY_BPS":
                if br_c[c] and rng.random() < min(.85, .22 * br_c[c]): invd, why = round(bill * rng.uniform(.88, .97), 2), "SLA_CREDIT"
                elif c in disc_client: invd, why = round(bill * .92, 2), "RELATIONSHIP_DISCOUNT"
                elif c in cap_client: invd, why = round(bill * .96, 2), "FEE_CAP"
            elif ft == "TRANSACTION" and br_c[c] >= 2 and rng.random() < .35:
                invd, why = round(bill * .93, 2), "SLA_CREDIT"
            inv.append((c + 1, int(dk_arr[me_day]), ft, round(float(basis), 2), rate, bill, invd, why))
invdf = pd.DataFrame(inv, columns=["client_key", "period_date_key", "fee_type", "basis_amount_usd", "fee_rate", "billable_amount_usd", "invoiced_amount_usd", "waiver_reason"])
invdf.insert(0, "invoice_ref", [f"INV-{i:06d}" for i in range(1, len(invdf) + 1)]); invdf.insert(0, "fee_invoice_key", np.arange(1, len(invdf) + 1))
load("clt_fee_invoice", invdf)
log(f"fee invoices {len(invdf):,}")

tot = 0
for (t,) in con.execute("select table_name from information_schema.tables where table_schema=? order by 1", [S]).fetchall():
    n = con.execute(f"select count(*) from {S}.{t}").fetchone()[0]; tot += n; print(f"  {t:26s}{n:>12,}")
print(f"  {'TOTAL':26s}{tot:>12,}")
con.execute("CHECKPOINT"); con.close()
log("done")
