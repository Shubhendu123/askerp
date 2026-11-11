import { formatMoneyRows, moneyContext } from "./moneyFormat";
import Anthropic from "@anthropic-ai/sdk";
import { getTenantConfig } from "./tenants";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// D-038 B1: voice rules that make narration read like an analyst wrote it
// for a CFO, not like a script describing a dataset.
// D-046: the policy-citation rule is appended only when policy chunks were retrieved, so a tenant without policies (mro, northwind)
// gets a narrator prompt byte-identical to the pre-D-045 one.
const POLICY_RULE = `- POLICY CITATIONS: if a "Policy rules retrieved" section is provided, cite a policy ONLY when a specific claim in your narrative depends on that rule (a threshold, target, criterion or procedure it states, e.g. "below the 99.0% PLATINUM target (POL-001 §2)"). Do not cite to add background, and do not use a retrieved policy to make claims the question and the data do not call for - if the answer is just a number or a ranking, say it without policy commentary. Cite in the form (POL-001 §2), using exactly the label given. Never cite a policy that is not listed in that section, and never cite when no such section is provided. SCOPE: apply a policy only to the entity type it governs (shown as "governs"): counterparty tiers describe individual counterparties and SLA targets are per client - never use them to grade Harborline as a whole, never mention tiers or SLAs for an overall figure.`;

// D-048: narration fidelity. The narrator describes time window / filters / grain only as they appear in the executed SQL.
const FIDELITY_RULE = `- FIDELITY: describe the time window, filters and grain ONLY as stated in the "Executed SQL facts" section. If it says there is no date filter, do not state or imply any period (no "trailing 12 months", "last quarter", "year to date", "recent", "this year"); say nothing about the period, or say "across all periods in the data". Mention a filter (e.g. only settled/failed instructions, a market or status) only if it is listed. Do not add context the SQL does not support.
- NO ARITHMETIC: never add, subtract, multiply, divide, average or rescale numbers yourself. Quote money only exactly as it appears in "Result data" or "Pre-computed totals" (keep the K/M/B unit). If you need a total or sum that is not listed, do not state one.`;
// D-048: appended only when non-policy documents (agreements, guides, notices, incident reports, regulation) are supplied.
const DOC_RULE = `- DOCUMENTS & PRECEDENCE: documents are cited in the form shown, e.g. (CA-001 §2), (MG-IT v2.0 §1), (EVT-2630 §3). When a client agreement or regulation overrides a standard policy for this answer, say so explicitly and cite BOTH, e.g. "Eastgate's agreement sets 98.5% (CA-001 §2), overriding the standard PLATINUM 99.0% (POL-001 §2)". Use only the document version shown; never mention superseded versions. Take every number from the result data or the document text - never invent amounts. When a client agreement chunk and the policy chunk it overrides are both provided, the narrative MUST name both values and contain both citations plus the word "overrides" or "instead of" (e.g. "98.5% (CA-001 §2) instead of the standard 99.0% (POL-001 §2)"); when a contract caps or extends a liability, state the cap or extension and what the data amount would be without it. If no result rows were produced because no SQL was run, answer only from the documents and cite at least one.`;
const FIDELITY_TENANTS = new Set(["harborline"]);

/** Deterministic facts about the executed SQL: its WHERE/HAVING/ON predicates and whether any date filter exists. */
export function sqlFacts(sql: string): string {
  const flat = sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
  const preds: string[] = [];
  const stop = /^(?:GROUP BY|ORDER BY|HAVING|LIMIT|UNION|WINDOW|WHERE)\b/i;
  for (const m of Array.from(flat.matchAll(/\b(WHERE|HAVING)\b/gi))) {
    if (/FILTER\s*\($/i.test(flat.slice(0, m.index).trimEnd())) continue; // aggregate FILTER (WHERE ...) is not a row filter
    let depth = 0, i = m.index! + m[0].length;
    const start = i;
    for (; i < flat.length; i++) {
      const ch = flat[i];
      if (ch === "(") depth++;
      else if (ch === ")") { if (depth === 0) break; depth--; }
      else if (depth === 0 && /\s/.test(flat[i - 1] ?? " ") && stop.test(flat.slice(i))) break;
    }
    preds.push(`${m[1].toUpperCase()} ${flat.slice(start, i).trim()}`);
  }
  const dateRe = /\b(?:\w*date_key|full_date|year_num|month_num|quarter_num|CURRENT_DATE|NOW\(\)|INTERVAL|DATE_TRUNC|DATE\s+')/i;
  const dated = dateRe.test(preds.join(" ")) || /\bJOIN\b[^;]*\bON\b[^;]*\b(?:year_num|month_num|full_date)\b/i.test(flat);
  const grain = /\bGROUP BY\b(.+?)(?=\b(?:HAVING|ORDER BY|LIMIT)\b|\)|$)/i.exec(flat)?.[1]?.trim();
  return [
    `Filters (WHERE/HAVING): ${preds.length ? preds.join(" ; ").slice(0, 900) : "none"}`,
    `Date/time filter: ${dated ? "present - see the filters above; state only that exact window" : "NONE - the query covers all periods in the data"}`,
    `Grouped by: ${grain ?? "nothing (single aggregate)"}`,
  ].join("\n");
}

function buildSystem(tenant: string, withPolicies = false, withDocs = false): string {
  const company = getTenantConfig(tenant).llmDescriptor;
  const base = `You are a concise data analyst narrator for ${company}.
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
  let out = base;
  if (withPolicies) out = out.replace("- Output ONLY valid JSON", `${POLICY_RULE}\n- Output ONLY valid JSON`);
  if (withDocs) out = out.replace("- Output ONLY valid JSON", `${DOC_RULE}\n- Output ONLY valid JSON`);
  if (FIDELITY_TENANTS.has(tenant)) out = out.replace("- Output ONLY valid JSON", `${FIDELITY_RULE}\n- Output ONLY valid JSON`);
  return out;
}

interface NarrateInput {
  question: string;
  metric_used: string | null;
  sentiment: string | null;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  sql?: string; // D-048: the executed SQL; its filters are passed to the narrator (fidelity tenants only)
  policies?: Array<{ citation: string; text: string; governs?: string; doc_type?: string; authority_rank?: number | null; access_level?: string }>;
  noSql?: boolean;       // D-048: no SQL was run; answer from the documents only
  enrichedCitations?: string[]; // D-048: citations of documents attached after the SQL ran (two-stage retrieval) // D-045: retrieved policy chunks, the only citable rules
}

export interface NarrateResult {
  headline: string;
  narrative: string;
  usage?: { input_tokens: number; output_tokens: number }; // D-043: for request tracing
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
  const { question, metric_used, sentiment, columns, rows, row_count, truncated, policies, sql, noSql } = input;

  const userMsg = [
    `Question: ${question}`,
    `Metric: ${metric_used ?? "none"}`,
    `Sentiment: ${sentiment ?? "none"}`,
    `Rows returned: ${row_count}${truncated ? " (truncated at 100)" : ""}`,
    "",
    "Result data:",
    noSql ? "No SQL was run for this question; answer from the documents below only." : summariseRows(columns, FIDELITY_TENANTS.has(tenant) ? formatMoneyRows(columns, rows) : rows, row_count), // D-049: money pre-formatted K/M/B in code (harborline only)
    ...(sql && FIDELITY_TENANTS.has(tenant) ? ["", "Executed SQL facts:", sqlFacts(sql)] : []),
    ...(FIDELITY_TENANTS.has(tenant) && !noSql && moneyContext(columns, rows).lines.length ? ["", "Pre-computed totals (computed in code; use verbatim):", ...moneyContext(columns, rows).lines] : []),
    ...(policies && policies.length > 0
      ? ["", "Policy rules retrieved (cite as shown):", ...policies.map((p) => `[${p.citation}]${p.governs ? ` (governs: ${p.governs})` : ""}${p.doc_type && p.doc_type !== "policy" ? ` (${p.doc_type}, authority_rank ${p.authority_rank ?? "n/a"}, ${p.access_level ?? ""})` : ""} ${p.text.slice(0, 1200)}`)]
      : []),
  ].join("\n");

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 320,
    system: buildSystem(tenant, !!(policies && policies.length > 0), !!(policies && policies.some((p) => p.doc_type && p.doc_type !== "policy"))),
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = (msg.content[0] as { text: string }).text.trim()
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "");

  const usage = { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
  try {
    const parsed = JSON.parse(raw) as NarrateResult;
    return {
      headline: parsed.headline ?? "",
      narrative: parsed.narrative ?? "",
      usage,
    };
  } catch {
    // Fallback if JSON parse fails
    return {
      headline: metric_used?.replace(/_/g, " ") ?? "Analysis result",
      narrative: raw.slice(0, 300),
      usage,
    };
  }
}

/** D-048: map retrieved policy/document chunks to the narrator's citable-document list. */
export function toNarratorDocs(results: Array<{ type: string; id: string; text: string; policy?: { citation: string; governs?: string; doc_type?: string; authority_rank?: number | null; access_level?: string } }>) {
  return results.filter((r) => r.type === "policy" || r.type === "document").map((r) => ({
    citation: r.policy?.citation ?? r.id, text: r.text, governs: r.policy?.governs,
    doc_type: r.policy?.doc_type, authority_rank: r.policy?.authority_rank, access_level: r.policy?.access_level,
  }));
}

/** D-048: a NO_SQL answer must cite at least one of the documents it was given; otherwise it is treated as a refusal. */
export function citesAny(text: string, docs: Array<{ citation: string }>): boolean {
  return docs.some((d) => text.includes(`(${d.citation}`) || text.includes(d.citation));
}
