import { sqlFacts } from "../lib/narrator";
console.log(sqlFacts("SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE settlement_status = 'FAILED') / COUNT(*), 2) FROM harborline.stl_trade_instruction WHERE settlement_status IN ('SETTLED','FAILED')"));
console.log("---");
console.log(sqlFacts("SELECT d.month_num, COUNT(*) FROM harborline.stl_trade_instruction i JOIN harborline.dim_date d ON d.date_key=i.intended_settle_date_key WHERE d.year_num=2026 GROUP BY 1 ORDER BY 1"));
