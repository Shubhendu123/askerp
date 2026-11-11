// D-049: unit test for the scope check, no LLM call. Run: npx tsx harborline/test_scope_check.ts
import { checkScope, dropFlaggedSentences } from "../lib/scopeCheck";
let bad = 0;
const t = (ok: boolean, m: string) => { if (!ok) { bad++; console.log("FAIL " + m); } else console.log("ok   " + m); };
const NODATE = "SELECT ROUND(100.0*COUNT(*) FILTER (WHERE settlement_status='FAILED')/COUNT(*),2) FROM harborline.stl_trade_instruction WHERE settlement_status IN ('SETTLED','FAILED')";
const DATED = "SELECT c.client_name FROM harborline.stl_trade_instruction i JOIN harborline.dim_client c USING(client_key) JOIN harborline.dim_date d ON d.date_key=i.intended_settle_date_key WHERE d.month_num=9";
// the false positive: a year-like token alone is not a window
t(checkScope("Settlement fail rate is 3.8% across all periods; the 2026 data is complete.", NODATE).ok, "bare year is not a window");
t(checkScope("Fail rate was 3.8% over the trailing 12 months.", NODATE).windowBad, "'trailing 12 months' with no date logic is flagged");
t(!checkScope("Fail rate was 3.8% over the trailing 12 months.", DATED).windowBad, "same text is fine when the SQL has date logic");
t(checkScope("Fail rate in March 2026 was 3.8%.", NODATE).windowBad, "'March 2026' with no date logic is flagged");
t(checkScope("Total assets under custody are $712.2B, in the highest fee tier.", NODATE).scopeViol.length > 0, "fee-tier claim on a non-per-entity SQL is flagged");
t(checkScope("8 Platinum clients missed their SLA target (POL-001 §2).", DATED).ok, "per-client SQL may use client tiers");
const d = dropFlaggedSentences("Fail rate is 3.8%. This is over the trailing 12 months. Penalties are rising.", NODATE);
t(d.dropped.length === 1 && d.text === "Fail rate is 3.8%. Penalties are rising.", "only the flagged sentence is dropped");
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
