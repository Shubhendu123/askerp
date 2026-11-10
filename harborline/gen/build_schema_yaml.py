"""
AskERP D-046 - append the 17 harborline entries to data/schema.yaml (tenant: harborline).
Columns/types/PK/FK/value lists come from harborline/ddl/harborline.sql (single source of truth); table purpose + grain and
column business meaning are authored here. Idempotent: removes existing harborline entries first. Run from repo root.
"""
import re, yaml
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
DDL = (ROOT / "harborline" / "ddl" / "harborline.sql").read_text()

META = {  # name: (type, grain, description)
 "dim_date": ("dimension", "One row per calendar day (2025-05-01 to 2026-10-22 plus settle-date run-off).", "Conformed calendar. Join any *_date_key column to dim_date.date_key (YYYYMMDD). Use month_num/year_num/quarter_num for periods and is_business_day for business-day logic."),
 "dim_market": ("dimension", "One row per market (12 markets).", "Markets Harborline settles in: CSD, settlement cycle, penalty regime (CSDR / CREST / NONE) and tax-reclaim complexity (LOW/MEDIUM/HIGH). Drives penalties (POL-002) and reclaim leakage (POL-005)."),
 "dim_security": ("dimension", "One row per security (800 securities).", "Securities held in custody: type (EQUITY/GOVT_BOND/CORP_BOND/ETF/MMI), issuer, listing market, income frequency and liquidity tier (LOW-liquidity securities fail more)."),
 "dim_client": ("dimension", "One row per institutional client (50 clients).", "Harborline's custody clients with segment and SLA tier (PLATINUM/GOLD/SILVER). sla_tier selects the contractual targets in POL-001; client_segment drives pricing (POL-010) and reclaim eligibility (POL-005)."),
 "dim_counterparty": ("dimension", "One row per trading counterparty (60).", "Brokers, banks, custodians and clearing members Harborline settles against. reliability_tier A (reliable) to D (chronic fails) is the planted driver of fail rates and penalties; tier definitions are in POL-007."),
 "dim_subcustodian": ("dimension", "One row per subcustodian (16): one PRIMARY per market plus BACKUP for US/GB/DE/JP.", "Local agent banks Harborline uses to hold and settle in each market."),
 "dim_currency": ("dimension", "One row per currency (9).", "Currencies with a simplified period-average USD rate. All fact amounts are in USD already; *_local columns keep the local-currency value."),
 "stl_trade_instruction": ("fact", "One row per settlement instruction (one side of one trade); 540,000 rows.", "Settlement instructions: intended vs actual settle date, status (SETTLED/FAILED/PENDING/CANCELLED), fail reason and days_failed. The source of settlement rate, fail rate, aged fails and counterparty fail analysis. FAILED rows always have days_failed >= 1; settled rows have days_failed = 0. Fail rate = FAILED / (SETTLED + FAILED)."),
 "stl_fail_penalty": ("fact", "One row per failed instruction per penalty day (CSDR/CREST penalties accrue daily); ~39K rows. Only CSDR/CREST markets have rows.", "Daily cash penalties on failed instructions, with the bearer (CLIENT / HARBORLINE / COUNTERPARTY) that decides who pays (POL-002 section 5). Join to stl_trade_instruction on instruction_key."),
 "pos_daily_position": ("fact", "One row per client / security / market / day (1.08M rows, ~2,000 client-security pairs).", "Daily holdings and market value. Assets under custody (AUC) = SUM(market_value_usd) on one date; never sum across dates. quantity_pending is stuck in failed settlement."),
 "pos_cash_balance": ("fact", "One row per client / currency / business day.", "Daily client cash balances. is_overdrawn rows carry overdraft_amount_usd and the overnight funding_cost_usd Harborline incurs funding the shortfall (mostly caused by failed receives, POL-011)."),
 "cae_event": ("fact", "One row per corporate action event per security (~3,350 events).", "Corporate action events with the announcement-to-deadline notice window. Voluntary events need a client election; notice_window_days is NULL for mandatory events."),
 "cae_client_election": ("fact", "One row per client per voluntary event they are entitled to (~2,670 rows).", "Client elections on voluntary events. missed_deadline = true is a Harborline error (POL-004 section 7) with estimated_client_impact_usd as the compensation exposure (capped at USD 5M)."),
 "cae_income_payment": ("fact", "One row per income payment per client per event.", "Dividend/coupon income collected: timeliness (days_late), withholding tax, and tax-reclaim eligibility/filing. Unfiled eligible reclaims (reclaim_eligible AND NOT reclaim_filed) are the leakage."),
 "clt_fee_invoice": ("fact", "One row per client / month / fee type (Oct 2026 not invoiced).", "Monthly fee invoices. billable_amount_usd is the standard-rate fee; invoiced_amount_usd is what was charged after waiver or cap. The difference is revenue foregone, by waiver_reason (POL-010 section 5)."),
 "clt_service_request": ("fact", "One row per client service request (~5,300 rows).", "Client service requests with SLA target, breach flag and analyst_hours (cost-to-serve driver, costed at USD 85/hour in POL-010 section 6)."),
 "rec_break": ("fact", "One row per reconciliation break (~5,400 rows).", "Reconciliation breaks between Harborline's books and subcustodian statements, with age and root cause. Open breaks aged 10+ days are escalated (POL-009 section 4)."),
}
DESC = {  # (table, column) -> business meaning; missing ones fall back to the DDL comment / name
 ("dim_date","date_key"):"Surrogate date key in YYYYMMDD form; every *_date_key column in the fact tables joins here.",
 ("dim_date","is_business_day"):"True on business days; failed-day, notice-window and penalty counting use business days.",
 ("dim_date","is_month_end"):"True on the last calendar day of the month.",
 ("dim_market","market_code"):"Two-letter market code: US, GB, DE, FR, IT, NL, CH, JP, HK, AU, CA, SG.",
 ("dim_market","penalty_regime"):"Cash-penalty regime: CSDR (DE, FR, IT, NL), CREST (GB) or NONE (all others). No penalties exist in NONE markets.",
 ("dim_market","tax_reclaim_complexity"):"Tax-reclaim documentation burden: LOW / MEDIUM / HIGH (FR, IT, CH are HIGH). Unfiled reclaim rates are highest in HIGH markets.",
 ("dim_security","security_type"):"Instrument class: EQUITY, GOVT_BOND, CORP_BOND, ETF or MMI. Drives CSDR penalty rate and fail rate (CORP_BOND fails most).",
 ("dim_security","liquidity_tier"):"HIGH / MEDIUM / LOW; LOW-liquidity securities fail more often.",
 ("dim_client","sla_tier"):"PLATINUM / GOLD / SILVER. Selects the contractual settlement-rate target and response times in POL-001 section 2 (99% / 98% / 97%).",
 ("dim_client","client_segment"):"ASSET_MANAGER, PENSION_FUND, INSURANCE, SOVEREIGN_WEALTH or HEDGE_FUND. Drives pricing and treaty/reclaim eligibility; hedge funds are generally not reclaim-eligible.",
 ("dim_counterparty","reliability_tier"):"A (reliable) to D (chronic fails). Fail rate by tier is about 1% / 2.5% / 7% / 14%.",
 ("dim_counterparty","is_affiliated"):"True for Harborline group entities; tiered on the same criteria with no exemption (POL-007 section 5).",
 ("dim_subcustodian","service_tier"):"PRIMARY or BACKUP subcustodian for the market.",
 ("stl_trade_instruction","instruction_key"):"Unique identifier for each settlement instruction.",
 ("stl_trade_instruction","intended_settle_date_key"):"Intended settlement date (ISD). Settlement-rate periods are assigned by this date.",
 ("stl_trade_instruction","actual_settle_date_key"):"Date the instruction actually settled; NULL while unsettled. Equal to intended date for on-time settlements.",
 ("stl_trade_instruction","direction"):"RECEIVE (securities in, cash out) or DELIVER (securities out, cash in). Failed receives create client overdrafts.",
 ("stl_trade_instruction","settlement_amount_usd"):"Cash value of the instruction in USD; the basis for CSDR penalties.",
 ("stl_trade_instruction","settlement_status"):"SETTLED, FAILED, PENDING (not yet due) or CANCELLED. A FAILED instruction missed its intended date (it may have settled later; actual_settle_date_key then has a value).",
 ("stl_trade_instruction","days_failed"):"Business days settlement was late; 0 when settled on the intended date. Aged fail = 5 or more (POL-006 section 3).",
 ("stl_fail_penalty","instruction_key"):"The failed instruction this daily penalty accrued on.",
 ("stl_fail_penalty","penalty_amount_usd"):"Cash penalty for this instruction-day in USD (settlement value x daily bps / 10,000).",
 ("stl_fail_penalty","bearer"):"Who bears the penalty: CLIENT (passed through), HARBORLINE (operational loss) or COUNTERPARTY (claimed back). See POL-002 section 5.",
 ("stl_fail_penalty","penalty_type"):"SEFP (settlement fail) or LMFP (late matching).",
 ("pos_daily_position","market_value_usd"):"Position market value in USD on that date. AUC = SUM on a single date.",
 ("pos_cash_balance","is_overdrawn"):"True when the closing balance is negative; caused mostly by failed receives.",
 ("pos_cash_balance","funding_cost_usd"):"Overnight cost Harborline incurs funding the overdraft (benchmark + 150 bps / 360).",
 ("cae_event","notice_window_days"):"Days between announcement and response deadline (voluntary events only). 2 or fewer = short-notice (POL-004 section 5); the strongest predictor of missed elections.",
 ("cae_event","is_voluntary"):"True when the event needs a client election.",
 ("cae_client_election","missed_deadline"):"True when Harborline failed to transmit the client's instruction before the market deadline - a Harborline error.",
 ("cae_client_election","election_status"):"ELECTED, DEFAULTED (no instruction received - not an error) or MISSED_DEADLINE (Harborline error).",
 ("cae_client_election","estimated_client_impact_usd"):"Compensation exposure for a missed election (0.1-1% of position value, capped at USD 5M); 0 when not missed.",
 ("cae_income_payment","days_late"):"Business days between expected and actual receipt; 0 = on time.",
 ("cae_income_payment","reclaim_eligible"):"True when statutory withholding exceeds the client's treaty rate and the client type qualifies.",
 ("cae_income_payment","reclaim_filed"):"True when Harborline filed the tax reclaim. Eligible but unfiled = leakage.",
 ("cae_income_payment","reclaim_amount_usd"):"Recoverable tax: gross income x (statutory - treaty rate). The value at stake when unfiled.",
 ("clt_fee_invoice","waiver_reason"):"Why invoiced is below billable: SLA_CREDIT, RELATIONSHIP_DISCOUNT or FEE_CAP; NULL when none.",
 ("clt_fee_invoice","invoiced_amount_usd"):"Amount actually charged (revenue). Revenue foregone = billable - invoiced.",
 ("clt_fee_invoice","period_date_key"):"Month-end date of the billing period.",
 ("clt_service_request","analyst_hours"):"Analyst effort on the request; costed at USD 85/hour in client profitability.",
 ("clt_service_request","sla_breached"):"True when resolution_hours exceeded the tier target for the priority.",
 ("rec_break","age_days"):"Business days from detection to resolution (or to today if still open). Aged = 10+ (POL-009 section 4).",
 ("rec_break","break_status"):"OPEN, RESOLVED or WRITTEN_OFF.",
 ("rec_break","root_cause"):"FAILED_SETTLEMENT, CORPORATE_ACTION, FX, TIMING or UNKNOWN; failed settlement is the most common.",
}
def clean(c): return re.sub(r"\s+", " ", c).strip()

tables = []
for m in re.finditer(r"CREATE TABLE harborline\.(\w+) \((.*?)\n\);", DDL, re.S):
    name, body = m.group(1), m.group(2)
    cols = []
    for line in body.split("\n"):
        s = line.strip()
        if not s: continue
        if s.startswith("--"):                       # continuation of previous column's comment (value list)
            cols[-1]["_c"] += " " + s[2:].strip(); continue
        code, _, cm = s.partition("--")
        cm = cm.strip().replace("<-- ", "").replace("<--", "").strip()
        mm = re.match(r"(\w+)\s+([A-Z]+(?:\([\d,]+\))?)(.*?),?\s*$", code.strip().rstrip(","))
        col = {"name": mm.group(1), "type": mm.group(2)}
        rest = mm.group(3)
        if "PRIMARY KEY" in rest: col["primary_key"] = True
        fk = re.search(r"REFERENCES harborline\.(\w+)\((\w+)\)", rest)
        if fk: col["foreign_key"] = f"harborline.{fk.group(1)}.{fk.group(2)}"
        col["_c"] = cm
        cols.append(col)
    for c in cols:
        d = DESC.get((name, c["name"]))
        base = clean(c.pop("_c"))
        vals = [v.strip() for v in re.split(r"[/,]", re.sub(r"^.*?:", "", base) if ":" in base else base) if v.strip().isupper()]
        if d: c["description"] = d + (f" Values: {' / '.join(vals)}." if vals and not all(v in d for v in vals) else "")
        elif c["name"].endswith("_date_key") and c.get("foreign_key"):
            c["description"] = f"{base.rstrip('.') + '. ' if base else ''}Date key (YYYYMMDD) of the {c['name'][:-9].replace('_', ' ')} date; joins to dim_date.date_key."
        elif c.get("foreign_key"): c["description"] = base or f"Foreign key to {c['foreign_key'].split('.')[1]} ({c['name']})."
        else: c["description"] = base or c["name"].replace("_", " ").capitalize() + "."
    typ, grain, desc = META[name]
    tables.append({"name": name, "tenant": "harborline", "schema": "harborline", "type": typ, "grain": grain,
                   "description": desc + f" Query as harborline.{name}.", "columns": cols})
assert len(tables) == 17, len(tables)

p = ROOT / "data" / "schema.yaml"
txt = p.read_text()
assert "tenant: harborline" not in txt, "harborline entries already present - git checkout data/schema.yaml first"
assert txt.lstrip().startswith("tables:"), "expected tables: to be the only top-level key"
p.write_text(txt.rstrip("\n") + "\n" + yaml.dump(tables, sort_keys=False, allow_unicode=True, width=90, default_flow_style=False))   # append-only: existing entries stay byte-identical
doc = yaml.safe_load(p.read_text())
print("harborline tables:", len(tables), "| total:", len(doc["tables"]), "| columns:", sum(len(t["columns"]) for t in tables))
