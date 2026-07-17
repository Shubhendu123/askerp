/**
 * AskERP — TypeScript Hybrid Retriever (Voyage AI + BM25 + RRF)
 *
 * Serverless-safe: no Python, no native binaries. Embeddings via Voyage AI REST.
 * Corpus: schema.yaml tables + metrics.yaml metrics (multi-tenant), embedded once at cold start.
 * Tenant isolation (D-035): chunk IDs are tenant-prefixed (`mro:dso_days`);
 *   retrieval filters to one tenant BEFORE ranking — per-tenant BM25 index
 *   (tenant-local IDF) and per-tenant dense scoring. Default tenant comes from
 *   ACTIVE_TENANT env var (falls back to 'mro'). App-side tenant switching is
 *   future work.
 * Dense: Voyage voyage-3-lite cosine similarity
 * Sparse: hand-rolled BM25 Okapi
 * Fusion: Reciprocal Rank Fusion (k=60)
 * Reranker: SKIPPED — no serverless-friendly cross-encoder; known gap.
 * Confidence: relative-confidence bands from top1-top2 gap (ported from confidence.py)
 */

import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TableColumn {
  name: string;
  type?: string;
  description?: string;
  primary_key?: boolean;
  foreign_key?: string;
}

interface TableDef {
  name: string;
  tenant?: string;
  description?: string;
  columns?: TableColumn[];
}

interface MetricDef {
  name: string;
  tenant?: string;
  domain?: string;
  definition_owner?: string;
  description?: string;
  synonyms?: string[];
  example_questions?: string[];
  formula?: string;
}

interface SchemaYaml {
  tables: TableDef[];
}

interface MetricsYaml {
  metrics: MetricDef[];
}

interface Chunk {
  id: string;
  tenant: string;
  type: "table" | "metric";
  name: string;
  text: string;
}

export interface RetrievalResult {
  id: string;
  type: "table" | "metric";
  name: string;
  score: number;
  text: string;
}

export interface ConfidenceResult {
  top1_absolute: number;
  top1_minus_top2_gap: number;
  top1_to_top5_avg_ratio: number;
  confidence_band: "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";
}

export interface RetrieveResponse {
  results: RetrievalResult[];
  confidence: ConfidenceResult;
}

// ── Text builders ─────────────────────────────────────────────────────────────

function buildTableText(table: TableDef): string {
  const desc = table.description ?? "";
  const prefix = desc ? `${table.name}: ${desc}. ` : `${table.name}: `;

  const cols = (table.columns ?? []).map((c) => {
    let s = c.name;
    const meta: string[] = [];
    if (c.type) meta.push(c.type);
    if (c.description) meta.push(c.description);
    if (meta.length > 0) s += ` (${meta.join(", ")})`;
    if (c.primary_key) s += " [PK]";
    if (c.foreign_key) s += ` [FK → ${c.foreign_key}]`;
    return s;
  });

  const fks = (table.columns ?? [])
    .filter((c) => c.foreign_key)
    .map((c) => `${c.name} → ${c.foreign_key}`);

  let text = `${prefix}Columns: ${cols.join(", ")}`;
  if (fks.length > 0) text += `. Foreign keys: ${fks.join(", ")}`;
  return text;
}

const EXAMPLE_LEADS = [
  "Common questions users ask:",
  "Another way to ask:",
  "Also asked as:",
];

// Metrics whose formulas contain {placeholder} substitution variables
const PARAMETERIZED_METRICS = new Set([
  "revenue_growth_yoy",
  "customer_churn_count",
  "repeat_customer_rate",
]);

function buildMetricText(metric: MetricDef): string {
  const name = metric.name;
  const domain = metric.domain ?? "";
  const owner = metric.definition_owner ?? "";
  const desc = (metric.description ?? "").trim().replace(/\n/g, " ");
  const synonyms = metric.synonyms ?? [];
  const examples = metric.example_questions ?? [];
  const formula = (metric.formula ?? "").trim().replace(/\n/g, " ");

  // Findability
  const parts: string[] = [`${name} (${domain} metric, owned by ${owner}): ${desc}`];
  if (synonyms.length > 0) parts.push(`Synonyms: ${synonyms.join(", ")}`);
  examples.forEach((q, i) => {
    parts.push(`${EXAMPLE_LEADS[i % EXAMPLE_LEADS.length]} ${q}`);
  });
  if (synonyms.length > 0) parts.push(`Synonyms again: ${synonyms.join(", ")}`);

  // Actionability
  if (formula) {
    parts.push(`FORMULA: ${formula}`);
    const tables = Array.from(new Set(formula.match(/\b(fact_\w+|dim_\w+)\b/g) ?? [])).sort();
    if (tables.length > 0) parts.push(`TABLES: ${tables.join(", ")}`);
    if (PARAMETERIZED_METRICS.has(name)) {
      parts.push(
        "Note: replace {placeholders} with values from the question. " +
        "If the question specifies a period, use it. " +
        "If not, use the most recent complete period in the data."
      );
    }
  }

  return parts.join(". ");
}

// ── BM25 Okapi (hand-rolled for 24 docs) ──────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\w+/g) ?? [];
}

interface BM25Index {
  docs: string[][];
  idf: Map<string, number>;
  avgdl: number;
  k1: number;
  b: number;
}

function buildBM25(corpus: string[]): BM25Index {
  const k1 = 1.5;
  const b = 0.75;
  const docs = corpus.map(tokenize);
  const N = docs.length;

  // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
  const df = new Map<string, number>();
  for (const tokens of docs) {
    const seen = new Set(tokens);
    Array.from(seen).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
  }
  const idf = new Map<string, number>();
  Array.from(df.entries()).forEach(([term, freq]) => {
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  });
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N;
  return { docs, idf, avgdl, k1, b };
}

function bm25Scores(index: BM25Index, query: string): number[] {
  const { docs, idf, avgdl, k1, b } = index;
  const qTokens = tokenize(query);
  return docs.map((doc) => {
    const dl = doc.length;
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of qTokens) {
      const f = tf.get(t) ?? 0;
      const idfScore = idf.get(t) ?? 0;
      score += idfScore * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))));
    }
    return score;
  });
}

// ── RRF Fusion ─────────────────────────────────────────────────────────────────

const RRF_K = 60;

function rrfFuse(denseRanks: number[], bm25Ranks: number[]): number[] {
  const scores = new Map<number, number>();
  const add = (ranks: number[]) => {
    ranks.forEach((idx, rank) => {
      scores.set(idx, (scores.get(idx) ?? 0) + 1.0 / (RRF_K + rank + 1));
    });
  };
  add(denseRanks);
  add(bm25Ranks);
  return Array.from(scores.keys()).sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
}

// ── Confidence (ported from confidence.py) ─────────────────────────────────────

function computeConfidence(scores: number[]): ConfidenceResult {
  if (scores.length === 0) {
    return { top1_absolute: 0, top1_minus_top2_gap: 0, top1_to_top5_avg_ratio: 0, confidence_band: "VERY_LOW" };
  }
  const top1 = scores[0];
  const top2 = scores[1] ?? 0;
  const gap = top1 - top2;
  const slice5 = scores.slice(0, 5);
  const avg5 = slice5.reduce((s, x) => s + x, 0) / slice5.length;
  const ratio = avg5 > 0 ? top1 / avg5 : 0;

  let band: ConfidenceResult["confidence_band"];
  if (gap >= 0.15 && top1 >= 0.3) band = "HIGH";
  else if (gap >= 0.08 && top1 >= 0.2) band = "MEDIUM";
  else if (gap >= 0.03 || top1 >= 0.15) band = "LOW";
  else band = "VERY_LOW";

  return {
    top1_absolute: Math.round(top1 * 10000) / 10000,
    top1_minus_top2_gap: Math.round(gap * 10000) / 10000,
    top1_to_top5_avg_ratio: Math.round(ratio * 10000) / 10000,
    confidence_band: band,
  };
}

// ── Voyage AI embedding via REST ───────────────────────────────────────────────

async function voyageEmbed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: inputType }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${err}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 1e-9 ? dot / denom : 0;
}

// ── Module-level state (cached across warm invocations) ────────────────────────

const DEFAULT_TENANT = process.env.ACTIVE_TENANT ?? "mro";

interface TenantIndex {
  chunks: Chunk[];
  embeddings: number[][];
  bm25: BM25Index;
}

let _tenants: Map<string, TenantIndex> | null = null;
let _initPromise: Promise<void> | null = null;

async function initCorpus(): Promise<void> {
  const ROOT = process.cwd();
  const schemaRaw = fs.readFileSync(path.join(ROOT, "data", "schema.yaml"), "utf-8");
  const metricsRaw = fs.readFileSync(path.join(ROOT, "data", "metrics.yaml"), "utf-8");
  const schema = yaml.load(schemaRaw) as SchemaYaml;
  const metricsConfig = yaml.load(metricsRaw) as MetricsYaml;

  // Tenant-prefixed chunk IDs (D-035): `mro:dso_days`, `northwind:total_revenue`.
  const chunks: Chunk[] = [];
  for (const table of schema.tables ?? []) {
    const tenant = table.tenant ?? "northwind";
    chunks.push({ id: `${tenant}:${table.name}`, tenant, type: "table", name: table.name, text: buildTableText(table) });
  }
  for (const metric of metricsConfig.metrics ?? []) {
    const tenant = metric.tenant ?? "northwind";
    chunks.push({ id: `${tenant}:${metric.name}`, tenant, type: "metric", name: metric.name, text: buildMetricText(metric) });
  }

  const ids = new Set<string>();
  for (const c of chunks) {
    if (ids.has(c.id)) throw new Error(`Duplicate chunk id after tenant prefixing: ${c.id}`);
    ids.add(c.id);
  }

  // Embed the full corpus in one call, then partition per tenant so ranking
  // (dense scoring AND BM25 with tenant-local IDF) only ever sees one tenant.
  const embeddings = await voyageEmbed(chunks.map((c) => c.text), "document");

  const tenants = new Map<string, TenantIndex>();
  for (const tenant of Array.from(new Set(chunks.map((c) => c.tenant)))) {
    const idxs = chunks.map((c, i) => ({ c, i })).filter((x) => x.c.tenant === tenant);
    const tChunks = idxs.map((x) => x.c);
    tenants.set(tenant, {
      chunks: tChunks,
      embeddings: idxs.map((x) => embeddings[x.i]),
      bm25: buildBM25(tChunks.map((c) => c.text)),
    });
  }
  _tenants = tenants;
}

async function ensureInit(): Promise<void> {
  if (_tenants !== null) return;
  if (!_initPromise) _initPromise = initCorpus();
  await _initPromise;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function retrieve(query: string, k = 5, tenant?: string): Promise<RetrieveResponse> {
  if (!query.trim()) {
    return { results: [], confidence: computeConfidence([]) };
  }

  await ensureInit();
  const activeTenant = tenant ?? DEFAULT_TENANT;
  const index = _tenants!.get(activeTenant);
  if (!index) {
    throw new Error(
      `Unknown tenant '${activeTenant}' — known tenants: ${Array.from(_tenants!.keys()).join(", ")}`
    );
  }
  const chunks = index.chunks;
  const corpusEmbs = index.embeddings;
  const bm25 = index.bm25;

  // Dense retrieval
  const [queryEmb] = await voyageEmbed([query], "query");
  const denseScores = corpusEmbs.map((emb) => cosine(queryEmb, emb));
  const denseRanks = denseScores
    .map((s, i) => ({ i, s }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  // BM25 retrieval
  const bm25Raw = bm25Scores(bm25, query);
  const bm25Ranks = bm25Raw
    .map((s, i) => ({ i, s }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  // RRF fusion — take top-10 from each for fusion, then return top-k
  const fused = rrfFuse(denseRanks.slice(0, 10), bm25Ranks.slice(0, 10));

  // Use dense cosine score as the reported score (no reranker)
  const topK = fused.slice(0, k);
  const scores = topK.map((i) => Math.max(0, denseScores[i]));
  const confidence = computeConfidence(scores);

  const results: RetrievalResult[] = topK.map((i, rank) => ({
    id: chunks[i].id,
    type: chunks[i].type,
    name: chunks[i].name,
    score: Math.round(scores[rank] * 10000) / 10000,
    text: chunks[i].text,
  }));

  return { results, confidence };
}
