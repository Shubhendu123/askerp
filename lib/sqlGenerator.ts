import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import type { RetrievalResult } from "./retrieval/retriever";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// USE_RETRIEVAL=true → prompt built from retrieved chunks only; false → full schema in prompt (A/B flag)
export const USE_RETRIEVAL = process.env.USE_RETRIEVAL === "true";

const ROOT = process.cwd();
const schemaYaml = fs.readFileSync(path.join(ROOT, "data", "schema.yaml"), "utf-8");
const metricsYaml = fs.readFileSync(path.join(ROOT, "data", "metrics.yaml"), "utf-8");

const SYSTEM_BASE = `You are a SQL generator for a DuckDB analytics warehouse for Northwind Furniture, a ~$50M B2B furniture company.`;

const SYSTEM_RULES = `
RULES:
1. Return ONLY valid DuckDB SQL — no CTEs unless necessary
2. Always filter fact_sales_order to exclude Cancelled/Pending unless the user asks about cancellations
3. Use dim_date for all date filtering — do not filter on date_id integers directly
4. dim_date columns: date_id (YYYYMMDD int), date (DATE), year, quarter, month
5. If user asks "by quarter", include both year and quarter in GROUP BY and SELECT
6. LIMIT results to 100 rows maximum
7. Never use SELECT * — name columns explicitly
8. Table aliases: fso=fact_sales_order, dc=dim_customer, di=dim_item, dd=dim_date, de=dim_employee, dp=fact_payment, fi=fact_invoice

GROSS MARGIN FORMULA:
(SUM(fso.total_amount) - SUM(fso.effective_unit_cost * fso.line_count)) / SUM(fso.total_amount) * 100

For sentiment: use the metric's sentiment field from the SEMANTIC LAYER above.
"positive" = higher is better, "negative" = higher is worse, "none" = directional/neutral.

Output ONLY this JSON object — no markdown, no explanation:
{
  "sql": "SELECT ...",
  "metric_used": "metric_name or null",
  "sentiment": "positive | negative | none",
  "tables_referenced": ["table1"],
  "reasoning": "one sentence",
  "confidence": "HIGH | MEDIUM | LOW"
}`;

// Full-schema prompt (USE_RETRIEVAL=false)
const SYSTEM_FULL = `${SYSTEM_BASE}

DATABASE SCHEMA:
${schemaYaml}

SEMANTIC LAYER (metrics with formulas):
${metricsYaml}
${SYSTEM_RULES}`;

function buildRetrievedSystem(chunks: RetrievalResult[]): string {
  const tables = chunks.filter((c) => c.type === "table");
  const metrics = chunks.filter((c) => c.type === "metric");
  const tableSection = tables.length > 0
    ? `RETRIEVED SCHEMA CONTEXT (top ${tables.length} relevant tables):\n${tables.map((c) => c.text).join("\n\n")}`
    : "";
  const metricSection = metrics.length > 0
    ? `RETRIEVED METRIC CONTEXT (top ${metrics.length} relevant metrics):\n${metrics.map((c) => c.text).join("\n\n")}`
    : "";
  return [SYSTEM_BASE, tableSection, metricSection, SYSTEM_RULES].filter(Boolean).join("\n\n");
}

const FEW_SHOT = `FEW-SHOT EXAMPLES:

Q: What was our total revenue in 2024?
A: {"sql":"SELECT SUM(fso.total_amount) AS total_revenue FROM fact_sales_order fso JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE fso.order_status NOT IN ('Cancelled','Pending') AND dd.year = 2024","metric_used":"total_revenue","sentiment":"positive","tables_referenced":["fact_sales_order","dim_date"],"reasoning":"Sum active orders in 2024.","confidence":"HIGH"}

Q: Top 5 customers by revenue last quarter
A: {"sql":"SELECT dc.customer_name, SUM(fso.total_amount) AS revenue FROM fact_sales_order fso JOIN dim_customer dc ON fso.customer_id = dc.customer_id JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE fso.order_status NOT IN ('Cancelled','Pending') AND dd.year = 2025 AND dd.quarter = 4 GROUP BY dc.customer_name ORDER BY revenue DESC LIMIT 5","metric_used":"total_revenue","sentiment":"positive","tables_referenced":["fact_sales_order","dim_customer","dim_date"],"reasoning":"Join customers, group by name, top 5 by revenue.","confidence":"HIGH"}

Q: Cancellation rate by quarter in 2024
A: {"sql":"SELECT dd.year, dd.quarter, ROUND(COUNT(CASE WHEN fso.order_status = 'Cancelled' THEN 1 END) * 100.0 / COUNT(*), 2) AS cancellation_rate_pct FROM fact_sales_order fso JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE dd.year = 2024 GROUP BY dd.year, dd.quarter ORDER BY dd.year, dd.quarter","metric_used":"cancellation_rate","sentiment":"negative","tables_referenced":["fact_sales_order","dim_date"],"reasoning":"Count cancelled as pct of all orders, grouped by quarter.","confidence":"HIGH"}

Q: Which customers churned in late 2024?
A: {"sql":"SELECT dc.customer_name, MAX(dd.date) AS last_order_date FROM fact_sales_order fso JOIN dim_customer dc ON fso.customer_id = dc.customer_id JOIN dim_date dd ON fso.order_date_id = dd.date_id GROUP BY dc.customer_name HAVING MAX(dd.date) < '2024-11-01' AND MAX(dd.date) > '2024-06-01' ORDER BY last_order_date DESC LIMIT 20","metric_used":"customer_churn_count","sentiment":"negative","tables_referenced":["fact_sales_order","dim_customer","dim_date"],"reasoning":"Last order before Nov 2024 signals churn.","confidence":"MEDIUM"}

Q: Outdoor furniture gross margin in 2025
A: {"sql":"SELECT ROUND((SUM(fso.total_amount) - SUM(fso.effective_unit_cost * fso.line_count)) / SUM(fso.total_amount) * 100, 2) AS gross_margin_pct FROM fact_sales_order fso JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE fso.order_status NOT IN ('Cancelled','Pending') AND fso.primary_item_category = 'Outdoor Furniture' AND dd.year = 2025","metric_used":"gross_margin_pct","sentiment":"positive","tables_referenced":["fact_sales_order","dim_date"],"reasoning":"Gross margin formula filtered to Outdoor Furniture 2025.","confidence":"HIGH"}`;

export interface SQLResult {
  sql: string | null;
  metric_used: string | null;
  sentiment: string | null;
  tables_referenced: string[];
  reasoning: string;
  confidence: string;
  error?: string;
}

export async function generateSQL(
  question: string,
  retrievedChunks?: RetrievalResult[]
): Promise<SQLResult> {
  const system =
    USE_RETRIEVAL && retrievedChunks && retrievedChunks.length > 0
      ? buildRetrievedSystem(retrievedChunks)
      : SYSTEM_FULL;

  const userMsg = `${FEW_SHOT}\n\nQUESTION: ${question}\n\nGenerate the SQL now. Output only the JSON object.`;

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = (msg.content[0] as { text: string }).text
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  try {
    return JSON.parse(raw) as SQLResult;
  } catch {
    return {
      sql: null,
      metric_used: null,
      sentiment: null,
      tables_referenced: [],
      reasoning: `JSON parse failed. Raw: ${raw.slice(0, 200)}`,
      confidence: "LOW",
      error: "json_parse_failed",
    };
  }
}
