import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import type { RetrievalResult } from "./retrieval/retriever";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// USE_RETRIEVAL=true → prompt built from retrieved chunks only; false → full schema in prompt (A/B flag)
export const USE_RETRIEVAL = process.env.USE_RETRIEVAL === "true";

// Tenant this route runs against (D-035/D-037). Mirrors the retriever's own
// ACTIVE_TENANT default so both layers agree without a shared module.
export const DEFAULT_TENANT = process.env.ACTIVE_TENANT ?? "mro";

const ROOT = process.cwd();
const schemaYaml = fs.readFileSync(path.join(ROOT, "data", "schema.yaml"), "utf-8");
const metricsYaml = fs.readFileSync(path.join(ROOT, "data", "metrics.yaml"), "utf-8");

// data/schema.yaml and data/metrics.yaml hold BOTH tenants in one file
// (tenant: northwind | mro per-entry, D-033). Filter before building any
// full-corpus prompt so a tenant never sees the other tenant's tables.
interface YamlTable { name: string; tenant?: string; [k: string]: unknown }
interface YamlMetric { name: string; tenant?: string; [k: string]: unknown }
const parsedSchema = yaml.load(schemaYaml) as { tables: YamlTable[] };
const parsedMetrics = yaml.load(metricsYaml) as { metrics: YamlMetric[] };

function tenantSchemaYaml(tenant: string): string {
  return yaml.dump({ tables: parsedSchema.tables.filter((t) => t.tenant === tenant) });
}
function tenantMetricsYaml(tenant: string): string {
  return yaml.dump({ metrics: parsedMetrics.metrics.filter((m) => m.tenant === tenant) });
}

const SYSTEM_BASE_NORTHWIND = `You are a SQL generator for a DuckDB analytics warehouse for Northwind Furniture, a ~$50M B2B furniture company.`;

const SYSTEM_RULES_NORTHWIND = `
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

// MRO Distributor tenant (D-035/D-037). All tables live under schema
// "mro_distributor" inside the MotherDuck database "askerp" (also present in
// the local file at data/northwind.db). System/rules mirror the benchmark's
// proven prompt (D-036: dense retrieval + this shape scored best on H-tier).
const SYSTEM_BASE_MRO = `You are a SQL generator for a DuckDB analytics warehouse for the MRO Distributor tenant (an industrial supplies distributor). All warehouse tables live in the schema "mro_distributor" — always qualify table names as mro_distributor.<table>.`;

const SYSTEM_RULES_MRO = `
RULES:
1. Return ONLY valid DuckDB SQL — no CTEs unless necessary
2. Always qualify every table as mro_distributor.<table_name>
3. Use mro_distributor.dim_date for all date filtering, joined on the *_date_key integer (YYYYMMDD) columns — never filter on the integer key directly
4. The data covers 18 months of history; unless the question names a period, aggregate over all data
5. LIMIT results to 100 rows maximum
6. Never use SELECT * — name columns explicitly
7. If the question cannot be answered from the provided context and this warehouse's data (missing table, out-of-scope topic, data that does not exist here), set "sql" to null and explain why in "reasoning" — do not invent tables or columns

For sentiment: use the metric's sentiment field from the SEMANTIC LAYER above.
"positive" = higher is better, "negative" = higher is worse, "none" = directional/neutral.

Output ONLY this JSON object — no markdown, no explanation:
{
  "sql": "SELECT ...",
  "metric_used": "metric_name or null",
  "sentiment": "positive | negative | none",
  "tables_referenced": ["mro_distributor.table1"],
  "reasoning": "one sentence",
  "confidence": "HIGH | MEDIUM | LOW"
}`;

function tenantBase(tenant: string): string {
  return tenant === "mro" ? SYSTEM_BASE_MRO : SYSTEM_BASE_NORTHWIND;
}
function tenantRules(tenant: string): string {
  return tenant === "mro" ? SYSTEM_RULES_MRO : SYSTEM_RULES_NORTHWIND;
}
function tenantFewShot(tenant: string): string {
  return tenant === "mro" ? FEW_SHOT_MRO : FEW_SHOT_NORTHWIND;
}

// Full-schema prompt (USE_RETRIEVAL=false), filtered to one tenant's tables/metrics.
const fullSystemCache = new Map<string, string>();
function buildFullSystem(tenant: string): string {
  const cached = fullSystemCache.get(tenant);
  if (cached) return cached;
  const built = `${tenantBase(tenant)}

DATABASE SCHEMA:
${tenantSchemaYaml(tenant)}

SEMANTIC LAYER (metrics with formulas):
${tenantMetricsYaml(tenant)}
${tenantRules(tenant)}`;
  fullSystemCache.set(tenant, built);
  return built;
}

function buildRetrievedSystem(chunks: RetrievalResult[], tenant: string): string {
  const tables = chunks.filter((c) => c.type === "table");
  const metrics = chunks.filter((c) => c.type === "metric");
  const tableSection = tables.length > 0
    ? `RETRIEVED SCHEMA CONTEXT (top ${tables.length} relevant tables):\n${tables.map((c) => c.text).join("\n\n")}`
    : "";
  const metricSection = metrics.length > 0
    ? `RETRIEVED METRIC CONTEXT (top ${metrics.length} relevant metrics):\n${metrics.map((c) => c.text).join("\n\n")}`
    : "";
  return [tenantBase(tenant), tableSection, metricSection, tenantRules(tenant)].filter(Boolean).join("\n\n");
}

const FEW_SHOT_MRO = `FEW-SHOT EXAMPLES:

Q: What is our total revenue?
A: {"sql":"SELECT ROUND(SUM(ext_amount),2) AS total_revenue FROM mro_distributor.o2c_sales_order_line","metric_used":"total_revenue","sentiment":"positive","tables_referenced":["mro_distributor.o2c_sales_order_line"],"reasoning":"Sum extended amount across all order lines.","confidence":"HIGH"}

Q: What is our current DSO?
A: {"sql":"SELECT ROUND(SUM(days_to_pay*amount_applied)/SUM(amount_applied),2) AS dso_days FROM mro_distributor.ar_payment_application","metric_used":"dso_days","sentiment":"negative","tables_referenced":["mro_distributor.ar_payment_application"],"reasoning":"Weighted-average days to pay across applied payments.","confidence":"HIGH"}

Q: Which item category has the best gross margin?
A: {"sql":"SELECT i.category, ROUND(SUM(sol.margin_amount)/SUM(sol.ext_amount)*100,2) AS gm_pct FROM mro_distributor.o2c_sales_order_line sol JOIN mro_distributor.dim_item i USING (item_key) GROUP BY 1 ORDER BY 2 DESC","metric_used":"gross_margin_pct","sentiment":"positive","tables_referenced":["mro_distributor.o2c_sales_order_line","mro_distributor.dim_item"],"reasoning":"Margin amount over extended amount, grouped by item category.","confidence":"HIGH"}

Q: Who are our top 10 suppliers by spend?
A: {"sql":"SELECT s.supplier_name, ROUND(SUM(po.ext_cost),2) AS spend FROM mro_distributor.p2p_purchase_order_line po JOIN mro_distributor.dim_supplier s USING (supplier_key) GROUP BY 1 ORDER BY 2 DESC LIMIT 10","metric_used":"spend_by_supplier","sentiment":"none","tables_referenced":["mro_distributor.p2p_purchase_order_line","mro_distributor.dim_supplier"],"reasoning":"Sum extended cost per supplier, top 10 by spend.","confidence":"HIGH"}

Q: What was Northwind Furniture's total revenue?
A: {"sql":null,"metric_used":null,"sentiment":"none","tables_referenced":[],"reasoning":"Northwind is a different tenant; this warehouse only contains MRO Distributor data.","confidence":"HIGH"}`;

const FEW_SHOT_NORTHWIND = `FEW-SHOT EXAMPLES:

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
  retrievedChunks?: RetrievalResult[],
  tenant: string = DEFAULT_TENANT
): Promise<SQLResult> {
  const system =
    USE_RETRIEVAL && retrievedChunks && retrievedChunks.length > 0
      ? buildRetrievedSystem(retrievedChunks, tenant)
      : buildFullSystem(tenant);

  const userMsg = `${tenantFewShot(tenant)}\n\nQUESTION: ${question}\n\nGenerate the SQL now. Output only the JSON object.`;

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
