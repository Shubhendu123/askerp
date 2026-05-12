import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a concise data analyst narrator for Northwind Furniture, a ~$50M B2B furniture company.
You receive a business question, the SQL result, and metric metadata. Write a tight, factual interpretation.

Rules:
- Headline: 6-10 words, plain English, no punctuation at end
- Narrative: 2-3 sentences max. State what the number means, one notable pattern if visible, one business implication.
- Use real numbers from the data. Never say "the data shows" or "as we can see".
- Tone: direct analyst, not marketing copy.
- If sentiment is "negative", lead with the risk or problem.
- If sentiment is "positive", lead with the achievement or scale.
- If sentiment is "none", stay neutral and factual.
- Output ONLY valid JSON, no markdown.

Output format:
{"headline": "...", "narrative": "..."}`;

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

export async function narrate(input: NarrateInput): Promise<NarrateResult> {
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
    system: SYSTEM,
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
