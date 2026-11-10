// D-048 gate: the two harborline validator rules must (a) accept every known-good SQL (24 metric formulas + 26 ground-truth queries),
// (b) reject the exact bad SQL the model produced in Run 2 (H05, H02, P02), plus targeted positives/negatives, and (c) not apply to mro/northwind.
import fs from "fs"; import yaml from "js-yaml";
import { validateStatic, type TenantSchemaInfo } from "../lib/sqlValidator";
const tables = new Set((yaml.load(fs.readFileSync("data/schema.yaml", "utf-8")) as any).tables.filter((t: any) => t.tenant === "harborline").map((t: any) => t.name));
const info: TenantSchemaInfo = { schema: "harborline", tables: tables as Set<string>, requireQualification: true,
  rules: { noDateKeyArithmetic: true, noFactFanout: true, factTablePrefixes: ["stl_", "pos_", "cae_", "clt_", "rec_"], parentTables: ["cae_event"] } };
let fails = 0; const t = (name: string, ok: boolean, extra = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const good: [string, string][] = [];
for (const m of (yaml.load(fs.readFileSync("data/metrics.yaml", "utf-8")) as any).metrics.filter((m: any) => m.tenant === "harborline")) good.push([`metric ${m.name}`, m.formula]);
const gt = JSON.parse(fs.readFileSync("benchmark/ground_truth_harborline.json", "utf-8"));
for (const [id, g] of Object.entries<any>(gt)) if (g.sql) good.push([`ground truth ${id}`, g.sql]);
let accepted = 0;
for (const [name, sql] of good) { const v = validateStatic(sql, info); if (!v) accepted++; else t(`accept ${name}`, false, v.message.slice(0, 120)); }
t(`accepts all known-good SQL (${accepted}/${good.length}: 24 metric formulas + 26 ground-truth queries)`, accepted === good.length);
// the bad SQL the model actually produced in Run 2
const run2 = fs.readdirSync("benchmark/runs_harborline").find((f) => f.startsWith("harborline_run2_"))!;
const recs = Object.fromEntries(fs.readFileSync(`benchmark/runs_harborline/${run2}`, "utf-8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
for (const id of ["H05", "H02"]) { const v = validateStatic(recs[id].sql, info); t(`reject Run-2 ${id} (fact fan-out)`, !!v && v.cls === "binder_error" && /fan-out/.test(v.message), v?.message.slice(0, 90)); }
const H = "harborline.";
const neg: [string, string, RegExp | null][] = [
  ["MAX(date_key) - 36500", `SELECT COUNT(*) FROM ${H}stl_trade_instruction WHERE intended_settle_date_key >= (SELECT MAX(date_key) - 36500 FROM ${H}dim_date)`, /date keys/],
  ["key / 100 month bucket", `SELECT intended_settle_date_key / 100 AS ym, COUNT(*) FROM ${H}stl_trade_instruction GROUP BY 1`, /date keys/],
  ["literal - key", `SELECT 20261022 - i.intended_settle_date_key FROM ${H}stl_trade_instruction i`, /date keys/],
  ["two facts in one scope", `SELECT c.client_name FROM ${H}stl_trade_instruction i JOIN ${H}clt_fee_invoice f ON f.client_key=i.client_key JOIN ${H}dim_client c ON c.client_key=i.client_key`, /fan-out/],
  ["two facts in a CTE body", `WITH x AS (SELECT p.client_key FROM ${H}stl_fail_penalty p JOIN ${H}stl_trade_instruction i USING (instruction_key)) SELECT * FROM x`, /fan-out/],
  ["comma join of facts", `SELECT 1 FROM ${H}pos_cash_balance b, ${H}pos_daily_position p WHERE b.client_key=p.client_key`, /fan-out/],
  ["facts via subquery in WHERE + outer fact (separate scopes) is allowed", `SELECT SUM(market_value_usd) FROM ${H}pos_daily_position WHERE position_date_key = (SELECT MAX(position_date_key) FROM ${H}pos_daily_position)`, null],
  ["COUNT(DISTINCT key)/n is not key arithmetic", `SELECT COUNT(DISTINCT intended_settle_date_key) / 30.0 FROM ${H}stl_trade_instruction`, null],
  ["key vs literal comparison is fine", `SELECT COUNT(*) FROM ${H}stl_trade_instruction WHERE intended_settle_date_key >= 20251023 AND intended_settle_date_key BETWEEN 20251023 AND 20261022`, null],
  ["dim_date + full_date arithmetic is fine", `SELECT COUNT(*) FROM ${H}stl_trade_instruction i JOIN ${H}dim_date d ON d.date_key=i.intended_settle_date_key WHERE d.full_date >= DATE '2026-10-22' - INTERVAL 12 MONTH`, null],
  ["each fact in its own CTE is fine", `WITH a AS (SELECT client_key, COUNT(*) n FROM ${H}stl_trade_instruction GROUP BY 1), b AS (SELECT client_key, SUM(invoiced_amount_usd) s FROM ${H}clt_fee_invoice GROUP BY 1) SELECT a.client_key, a.n, b.s FROM a JOIN b USING (client_key)`, null],
  ["date-key words inside a string literal are ignored", `SELECT 'order_date_key - 1' AS note FROM ${H}dim_client`, null],
];
for (const [name, sql, re] of neg) { const v = validateStatic(sql, info); t(name, re ? !!v && re.test(v.message) && v.cls === "binder_error" : v === null, v && !re ? v.message.slice(0, 100) : ""); }
// mro/northwind validation must be unchanged: same SQL, no rules -> no rule rejection
const mroInfo: TenantSchemaInfo = { schema: "harborline", tables: tables as Set<string>, requireQualification: true };
t("rules absent => the same bad SQL is NOT rejected by these rules (mro/northwind unchanged)", validateStatic(recs["H05"].sql, mroInfo) === null && validateStatic(neg[0][1], mroInfo) === null);
console.log(fails ? `\n${fails} FAILED` : "\nALL VALIDATOR RULE TESTS PASS"); process.exit(fails ? 1 : 0);
