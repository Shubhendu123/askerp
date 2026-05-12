import Anthropic from "@anthropic-ai/sdk";
import { executeSQL } from "@/lib/db";
import { prepContribution, type ContributionRow } from "@/lib/chartUtils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a SQL analyst. Given a base DuckDB SQL query and a metric name, generate 3 breakdown variants — one per dimension below.

DIMENSIONS TO BREAK DOWN BY:
1. Customer Segment — use dc.customer_segment (join dim_customer dc ON fso.customer_id = dc.customer_id if not already joined)
2. Product Category — use fso.primary_item_category (already on fact_sales_order, no join needed)
3. Region — use dc.region (join dim_customer dc ON fso.customer_id = dc.customer_id if not already joined)

RULES:
- Keep ALL existing WHERE filters and aggregate functions from the base SQL
- Add the dimension column to SELECT and GROUP BY
- Remove any existing GROUP BY that would conflict, but keep date filters
- Add ORDER BY the aggregate value DESC
- LIMIT 8 rows per breakdown
- If dim_customer is already joined (aliased dc), reuse that alias — don't join twice
- Output ONLY valid JSON, no markdown

Output format:
[
  {"dimension": "Customer Segment", "column": "customer_segment", "sql": "SELECT dc.customer_segment, ..."},
  {"dimension": "Product Category", "column": "primary_item_category", "sql": "SELECT fso.primary_item_category, ..."},
  {"dimension": "Region", "column": "region", "sql": "SELECT dc.region, ..."}
]`;

export interface DriverDimension {
  dimension: string;
  column: string;
  data: ContributionRow[];
  error?: string;
}

export async function runDrivers(
  originalSql: string,
  metricUsed: string | null
): Promise<DriverDimension[]> {
  // Step 1: Generate 3 breakdown SQLs
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Metric: ${metricUsed ?? "unknown"}\n\nBase SQL:\n${originalSql}\n\nGenerate the 3 breakdown variants.`
    }],
  });

  const raw = (msg.content[0] as { text: string }).text
    .trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  let breakdowns: Array<{ dimension: string; column: string; sql: string }>;
  try {
    breakdowns = JSON.parse(raw);
  } catch {
    return [];
  }

  // Step 2: Execute each breakdown SQL
  const results = await Promise.all(
    breakdowns.map(async (b): Promise<DriverDimension> => {
      try {
        const result = await executeSQL(b.sql, 8);
        const data = prepContribution(result.columns, result.rows);
        return { dimension: b.dimension, column: b.column, data };
      } catch (err) {
        return {
          dimension: b.dimension,
          column: b.column,
          data: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  // Only return dimensions that have data
  return results.filter((r) => r.data.length > 0);
}
