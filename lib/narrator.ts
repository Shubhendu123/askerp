import Anthropic from "@anthropic-ai/sdk";
import { getTenantConfig } from "./tenants";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// D-038 B1: voice rules that make narration read like an analyst wrote it
// for a CFO, not like a script describing a dataset.
function buildSystem(tenant: string): string {
  const company = getTenantConfig(tenant).llmDescriptor;
  return `You are a concise data analyst narrator for ${company}.
You receive a business question, the SQL result, and metric metadata. Write a tight, factual interpretation.

Rules:
- Headline: 6-10 words, plain English, no punctuation at end
- Narrative: 2-3 sentences max. State what the number means, one notable pattern if visible, one business implication.
- Use real numbers from the data. Never say "the data shows", "as we can see", "synthetic data", "in this dataset", or reference raw column/table names (e.g. write "order-to-ship time" not "order_to_ship_days", "suppliers" not "supplier_key").
- Currency in prose: abbreviate to 1 decimal — "$69.1M", "$2.3K" — never the full unrounded figure ("$69,129,229.98"). Tables may keep full figures; this rule is for your prose only.
- Percentages in prose: round to 1 decimal place with a "%" sign, even if the underlying value has more decimals — the data may hand you "3.96"; write "4.0%", not "3.96 percent". Day counts in prose: round to whole numbers ("15 days late", not "15.24 days" or "15.24-day").
- Tone: direct analyst, not marketing copy.
- If sentiment is "negative", lead with the risk or problem.
- If sentiment is "positive", lead with the achievement or scale.
- If sentiment is "none", stay neutral and factual.
- CLAIM PRECISION: if more than ~15 rows are returned and one column is a sortable numeric magnitude (days, dollars, a rate), do this before writing the headline: mentally sort that column descending and scan consecutive gaps. If some prefix of rows sits clearly apart from the rest (a gap roughly 2x+ larger than the typical step between neighbors), the headline must report ONLY that prefix — its count and its own threshold — not the full row count. State the threshold as "N rows above X", where X is the value at the gap.
  Example — 43 rows where the "days late" column, sorted descending, reads 16.3, 15.3, 15.2, 14.9, 14.7, 14.3, 13.9, [gap] 7.9, 7.8, 7.8, ... down to 1.0:
    BAD:  "43 suppliers deliver late yet receive early payment" — uses the full row count and ignores the gap after row 7
    GOOD: "7 suppliers average 14+ late days yet are paid faster than the 39-day company average" — reports only the group above the gap
  If you scan the column and the values decline smoothly with no gap that stands out, the set is genuinely homogeneous — report the full count, don't invent a break that isn't there.
- CONSTANT COLUMNS: if a column's value is identical across every row (e.g. a repeated company-wide average), state it once in prose ("company-wide DPO is 39 days") rather than treating it as a per-row finding.
- Output ONLY valid JSON, no markdown.

Output format:
{"headline": "...", "narrative": "..."}`;
}

interface NarrateInput {
  question: string;
  metric_used: string | null;
  sentiment: string | null;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}

export interface NarrateResult {
  headline: string;
  narrative: string;
}

function summariseRows(columns: string[], rows: unknown[][], row_count: number): string {
  if (!rows.length) return "No rows returned.";
  const preview = rows.slice(0, 8);
  const lines = [columns.join(" | "), ...preview.map((r) => (r as unknown[]).join(" | "))];
  if (row_count > preview.length) lines.push(`... and ${row_count - preview.length} more rows`);
  return lines.join("\n");
}

export async function narrate(
  input: NarrateInput,
  tenant: string = process.env.ACTIVE_TENANT ?? "mro"
): Promise<NarrateResult> {
  const { question, metric_used, sentiment, columns, rows, row_count, truncated } = input;

  const userMsg = [
    `Question: ${question}`,
    `Metric: ${metric_used ?? "none"}`,
    `Sentiment: ${sentiment ?? "none"}`,
    `Rows returned: ${row_count}${truncated ? " (truncated at 100)" : ""}`,
    "",
    "Result data:",
    summariseRows(columns, rows, row_count),
  ].join("\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: buildSystem(tenant),
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = (msg.content[0] as { text: string }).text.trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  try {
    const parsed = JSON.parse(raw) as NarrateResult;
    return {
      headline: parsed.headline ?? "",
      narrative: parsed.narrative ?? "",
    };
  } catch {
    // Fallback if JSON parse fails
    return {
      headline: metric_used?.replace(/_/g, " ") ?? "Analysis result",
      narrative: raw.slice(0, 300),
    };
  }
}
