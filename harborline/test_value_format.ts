// D-050: unit tests, no LLM call, no network. Run: npx tsx harborline/test_value_format.ts
import { stripPeriodWords, countFigures, countContext, columnKind, formatCellByKind, formatValue, formatPct, formatCount, humanizeHeader, prepareTable, titleFromQuestion, fixAcronyms } from "../lib/valueFormat";
import { formatMoney, moneyFigureProblems } from "../lib/moneyFormat";
import { resolvePeriod, dateFromKey } from "../lib/period";
import { formatSql } from "../lib/sqlFormat";
import { checkScope, dropFlaggedSentences, pctFigures } from "../lib/scopeCheck";

let bad = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log(`FAIL ${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); } else console.log(`ok   ${m}`); };

// ── money: largest unit that keeps the number under 1,000 ──
eq(formatMoney(712_173_780_000), "$712.2B", "AUC 712173.78M -> $712.2B");
eq(formatValue("assets_under_custody_usd", 712_173_780_000), "$712.2B", "big number uses the same formatter");
eq(formatMoney(999_950), "$1M", "999,950 does not become $1000K");
eq(formatMoney(999_960_000), "$1B", "999.96M does not become $1000M");
eq(formatMoney(1.5e12), "$1.5T", "trillions");
eq(formatMoney(416_000), "$416K", "416000 -> $416K");
eq(formatMoney(950), "$950", "950");
eq(formatCellByKind(columnKind("total_penalty_usd"), 211230.78), "$211.2K", "penalty_usd cell");
for (const c of ["amount", "fee_amount", "cost", "revenue", "impact_usd", "value_usd", "penalty"]) eq(columnKind(c, [1]), "money", `money column: ${c}`);

// ── percent ──
eq(formatPct(93.42), "93.4%", "pct 93.42");
eq(formatCellByKind(columnKind("settlement_rate_pct"), 93.42), "93.4%", "settlement_rate_pct cell");
eq(formatCellByKind(columnKind("target_pct"), 99), "99.0%", "target_pct 99 -> 99.0%");
eq(columnKind("fail_rate", [3.8]), "pct", "*_rate -> pct");
eq(columnKind("penalty_rate_bps", [1.2]), "number", "bps rate is not a percentage");
eq(columnKind("settlement_rate_pct", [93]), "pct", "pct never mistaken for money");

// ── counts ──
eq(formatCount(4112), "4,112", "count 4112");
eq(formatCellByKind(columnKind("instructions"), 4136), "4,136", "instructions");
for (const c of ["count", "num_clients", "fail_count", "events"]) eq(columnKind(c, [1]), "count", `count column: ${c}`);
eq(formatCellByKind("count", 1234567), "1,234,567", "thousands separators");
eq(formatCellByKind(columnKind("instructions"), 828), "828", "no separator below 1,000");

// ── year / month never number-formatted ──
eq(formatCellByKind(columnKind("year_num"), 2026), "2026", "year is not '2,026'");
eq(formatCellByKind(columnKind("month_num"), 9), "Sep", "month 9 -> Sep");
eq(formatCellByKind("id", 1234567), "1234567", "ids/keys never get separators");

// ── table: month combine, formats, Gap ──
const cols = ["client_name", "sla_tier", "year_num", "month_num", "instructions", "settlement_rate_pct", "target_pct", "met_target"];
const rows = [["Eastgate Capital Partners", "PLATINUM", 2026, 9, 4136, 93.42, 99, false], ["Beacon Insurance Group", "PLATINUM", 2026, 9, 828, 97.1, 99, false]];
const t = prepareTable(cols, rows);
eq(t.headers, ["Client", "Tier", "Month", "Instructions", "Settlement rate", "Target", "Gap (pts)", "Met target"], "headers humanized, Month combined, Gap added");
eq(t.rows[0], ["Eastgate Capital Partners", "PLATINUM", "Sep 2026", "4,136", "93.4%", "99.0%", "-5.6", "No"], "row formatted by meaning");
eq(t.rows[1][6], "-1.9", "gap 97.1 - 99 = -1.9");
eq(prepareTable(["counterparty_name", "total_penalties_usd"], [["Acme", 416000]]).rows[0], ["Acme", "$416K"], "money column in a table");
eq(prepareTable(["fail_rate_pct"], [[3.96]]).headers, ["Fail rate"], "no Gap column without a target");
eq(prepareTable(["year_num", "month_num", "total_penalties_usd"], [[2026, 3, 1500000]]).rows[0], ["Mar 2026", "$1.5M"], "year+month only");

// ── headers ──
eq(humanizeHeader("client_name"), "Client", "client_name");
eq(humanizeHeader("assets_under_custody_usd"), "Assets under custody", "assets_under_custody_usd");
eq(humanizeHeader("sla_breach_count"), "SLA breach count", "SLA stays upper-case");
eq(humanizeHeader("auc_by_market"), "AUC by market", "AUC stays upper-case");
eq(fixAcronyms("platinum clients below sla target"), "platinum clients below SLA target", "acronyms in titles");
eq(titleFromQuestion("What are our total assets under custody?"), "Our total assets under custody", "fallback title from question");

// ── relative dates: resolved against the DATA's latest date ──
const latest = dateFromKey(20261022)!;
const lm = resolvePeriod("Which Platinum clients missed their SLA settlement target last month?", latest)!;
eq([lm.label, lm.short], ["September 2026", "Sep 2026"], "last month (data to 22 Oct 2026) = September 2026");
eq(lm.reason, "latest complete month in the data (data runs to 22 Oct 2026)", "reason states why");
eq(resolvePeriod("fail rate last month", dateFromKey(20260930)!)!.label, "September 2026", "last day of month -> that month is complete");
eq(resolvePeriod("fail rate last month", dateFromKey(20260105)!)!.label, "December 2025", "January -> December of the prior year");
eq(resolvePeriod("penalties last quarter", latest)!.short, "Q3 2026", "last quarter = Q3 2026");
eq(resolvePeriod("what is our fail rate", latest), null, "no relative phrase -> null");

// ── SQL pretty-print: whitespace only ──
const sql = "SELECT c.client_name, COUNT(*) FILTER (WHERE i.a = i.b) AS n FROM harborline.t i JOIN harborline.dim_client c ON c.k = i.k LEFT JOIN x ON x.k = c.k WHERE i.s IN ('A', 'B') AND c.t = 'P' AND d BETWEEN 1 AND 2 GROUP BY c.client_name HAVING COUNT(*) > 1 ORDER BY n DESC\nLIMIT 1000";
const f = formatSql(sql);
eq(f.replace(/\s+/g, ""), sql.replace(/\s+/g, ""), "formatSql changes whitespace only");
eq(f.split("\n").filter((l) => /^(SELECT|FROM|JOIN|LEFT JOIN|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT)\b/.test(l)).length, 9, "each clause starts its own line");
eq(f.split("\n").some((l) => l.trim().startsWith("AND c.t")), true, "AND breaks inside WHERE");
eq(f.includes("BETWEEN 1 AND 2"), true, "BETWEEN ... AND stays together");
eq(f.includes("FILTER (WHERE i.a = i.b)"), true, "FILTER (WHERE ...) stays inline");
eq(Math.max(...f.split("\n").map((l) => l.length)) < 100, true, "no line is a wall of text");

// ── narrator accuracy rules, enforced by the existing check ──
const SQLC = "SELECT * FROM harborline.dim_client c JOIN harborline.stl_trade_instruction i ON c.client_key = i.client_key WHERE c.sla_tier = 'PLATINUM' AND d.month_num = 9";
const ctx = { question: "Which Platinum clients missed their SLA settlement target last month?", rowCount: 8, populations: [50, 8, 20, 22], allowedPct: { data: [93.42, 96.82, 99, 98.34], docs: [99, 98, 97, 5, 20] } };
eq(checkScope("Harborline manages $712.2B of client assets.", "SELECT 1", [712.2e9], {}).ok, false, "'manages' assets is flagged");
eq(checkScope("Harborline holds $712.2B in custody.", "SELECT 1", [712.2e9], {}).ok, true, "'holds in custody' passes");
eq(checkScope("A significant mid-tier custodian.", "SELECT 1", [], {}).claimBad.length > 0, true, "marketing claim flagged");
eq(checkScope("Harborline is ahead of industry peers.", "SELECT 1", [], {}).ok, false, "comparison claim flagged");
eq(checkScope("All 8 Platinum clients missed the 99.0% target.", SQLC, [], ctx).ok, true, "'All 8' passes when 8 = Platinum population");
eq(checkScope("All 12 Platinum clients missed the target.", SQLC, [], ctx).ok, false, "'All 12' flagged");
eq(checkScope("All eight clients missed it.", SQLC, [], { ...ctx, populations: [50, 12] }).ok, false, "'All eight' flagged when 8 is not the population");
eq(checkScope("Each client is entitled to a 5% credit.", SQLC, [], ctx).ok, false, "unrequested credit flagged");
eq(checkScope("Each client is entitled to a 5% credit.", SQLC, [], { ...ctx, question: "What SLA credit is Eastgate owed?" }).ok, true, "credit allowed when asked");
eq(checkScope("Rates ranged from 93.4% to 98.3% against the 99.0% target.", SQLC, [], ctx).ok, true, "percentages that match data/docs pass");
eq(checkScope("The target is 99.5% per policy.", SQLC, [], ctx).ok, false, "a policy number that matches no document is flagged");
eq(pctFigures("a 5% credit, capped at 20.5%"), [5, 20.5], "pctFigures");
eq(dropFlaggedSentences("Eastgate settled 93.4%. It is a leading custodian.", SQLC, [], ctx).text, "Eastgate settled 93.4%.", "only the offending sentence is dropped");
eq(moneyFigureProblems("Total is $712.2B", [712.2e9]).length, 0, "money check unchanged: correct figure passes");
eq(moneyFigureProblems("Total is $712.2M", [712.2e9]).join(), "$712.2M", "money check unchanged: x1000 error caught");

eq(stripPeriodWords("Platinum clients missing September settlement SLA"), "Platinum clients missing settlement SLA", "month stripped from narrator title");
eq(stripPeriodWords("Platinum clients below SLA target in September 2026"), "Platinum clients below SLA target", "month+year+preposition stripped");
eq(stripPeriodWords("Total assets under custody"), "Total assets under custody", "title without a period untouched");

// ── count figures + generic "all" (found live: narrator wrote 9,211 for a true total of 11,211) ──
const cc = countContext(["client_name", "instructions"], [["a", 4136], ["b", 1291], ["c", 828], ["d", 1674], ["e", 974], ["f", 620], ["g", 725], ["h", 963]]);
eq(cc.lines[0].includes("total of all 8 returned rows = 11,211"), true, "count total computed in code = 11,211");
eq(countFigures("Across 8 clients, 9,211 instructions in 2026 on 22 Oct 2026, $712.2B, 93.4%, 1,500 bps"), [9211, 1500], "countFigures ignores years, money, percents");
const cctx = { question: "q", rowCount: 8, populations: [8], allowedCounts: [...cc.allowed, 8] };
eq(checkScope("Across these clients, 9,211 instructions were processed.", SQLC, [], cctx).ok, false, "wrong summed count (9,211) is flagged");
eq(checkScope("Across these clients, 11,211 instructions were processed.", SQLC, [], cctx).ok, true, "correct code-computed total passes");
eq(checkScope("Eastgate handled 4,136 instructions.", SQLC, [], cctx).ok, true, "a cell value passes");
eq(checkScope("This reflects all client accounts and markets.", "SELECT 1", [], { question: "q", rowCount: 1 }).ok, false, "generic 'all client accounts' flagged");
eq(checkScope("This covers all 8 Platinum clients.", SQLC, [], cctx).ok, true, "'all 8' with verified population still passes");

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
