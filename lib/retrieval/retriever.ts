/**
 * AskERP — TypeScript Hybrid Retriever (Voyage AI + BM25 + RRF)
 *
 * Serverless-safe: no Python, no native binaries. Embeddings via Voyage AI REST.
 * Corpus: schema.yaml tables + metrics.yaml metrics + policy sections (harborline only, D-045), multi-tenant,
 *   embedded once at cold start.
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
  tables?: string[]; // declared table dependencies, e.g. "mro_distributor.o2c_sales_order_line" (D-033)
  policy_refs?: string[]; // D-045: "POL-001" (whole doc) or "POL-001#2" (one section); expanded deterministically like tables
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
  type: "table" | "metric" | "policy";
  name: string;
  text: string;
  tables?: string[]; // metric chunks only: declared table names, schema prefix stripped (metadata; not embedded)
  policyRefs?: string[]; // metric chunks only (D-045)
  policy?: PolicyMeta;   // policy chunks only
}

export interface PolicyMeta {
  doc_id: string;
  title: string;
  section: string;       // heading text, e.g. "2. SLA tiers and commitments"
  section_no: number;
  citation: string;      // "POL-001 §2" - what the narrator cites
  binds_to: string[];
  governs: string;       // D-048: the entity type this policy applies to (scope rule)
  domain: string;
  effective_date: string;
}

export interface RetrievalResult {
  id: string;
  type: "table" | "metric" | "policy";
  name: string;
  score: number;
  text: string;
  expanded?: boolean; // true when appended by table-/policy-expansion rather than ranked (D-041/D-045)
  policy?: PolicyMeta; // policy chunks only (D-045)
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

// ── Policy documents (D-045) ───────────────────────────────────────────────────
// One chunk per `## ` section of harborline/policies/POL-*.md. Embedded text is prefixed with
// "title — section heading" so short sections stay findable. Chunk id: `harborline:POL-001#3`
// (tenant prefix per D-035; the number is the section number from the heading, else ordinal).

export function loadPolicyChunks(root: string): Chunk[] {
  const dir = path.join(root, "harborline", "policies");
  if (!fs.existsSync(dir)) return [];
  const out: Chunk[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => /^POL-\d+.*\.md$/.test(x)).sort()) {
    const raw = fs.readFileSync(path.join(dir, f), "utf-8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) throw new Error(`Policy ${f}: missing YAML frontmatter`);
    const fm = yaml.load(m[1]) as Record<string, unknown>;
    const docId = String(fm.doc_id ?? "");
    if (!docId) throw new Error(`Policy ${f}: frontmatter has no doc_id`);
    const tenant = String(fm.tenant ?? "harborline");
    const title = String(fm.title ?? docId);
    const parts = m[2].split(/^## /m).slice(1); // [0] is the H1 preamble, not a section
    parts.forEach((part, ordinal) => {
      const nl = part.indexOf("\n");
      const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
      const body = (nl < 0 ? "" : part.slice(nl + 1)).trim();
      const no = Number(heading.match(/^(\d+)\./)?.[1] ?? ordinal + 1);
      const meta: PolicyMeta = {
        doc_id: docId, title, section: heading, section_no: no, citation: `${docId} §${no}`,
        binds_to: Array.isArray(fm.binds_to) ? (fm.binds_to as unknown[]).map(String) : [],
        governs: String(fm.governs ?? ""),
        domain: String(fm.domain ?? ""), effective_date: String(fm.effective_date instanceof Date ? fm.effective_date.toISOString().slice(0, 10) : fm.effective_date ?? ""),
      };
      out.push({ id: `${tenant}:${docId}#${no}`, tenant, type: "policy", name: `${docId} §${no} ${heading.replace(/^\d+\.\s*/, "")}`,
        text: `${title} — ${heading}\n${body}`, policy: meta });
    });
  }
  return out;
}

/**
 * Relevance floor for RANKED policy chunks (dense cosine). Policy chunks below it are not admitted by ranking; policies pulled in
 * through a retrieved metric's `policy_refs` are never filtered by it. Calibrated on 10 questions outside the benchmark: the top
 * ranked policy chunk scored 0.53-0.70 on policy-seeking questions and 0.29-0.52 on data-only ones (D-046). 0 disables.
 */
export function policyMinScore(): number {
  const n = Number(process.env.RETRIEVAL_POLICY_MIN_SCORE ?? 0.5);
  return Number.isFinite(n) && n >= 0 ? n : 0.5;
}

export function maxPolicyChunks(): number {
  const n = Number(process.env.RETRIEVAL_MAX_POLICY_CHUNKS ?? 3);
  return Number.isInteger(n) && n >= 0 ? n : 3;
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
    chunks.push({
      id: `${tenant}:${metric.name}`, tenant, type: "metric", name: metric.name, text: buildMetricText(metric),
      tables: (metric.tables ?? []).map((t) => t.split(".").pop() as string),
      policyRefs: metric.policy_refs ?? [],
    });
  }
  chunks.push(...loadPolicyChunks(ROOT)); // D-045: harborline only (frontmatter tenant)

  const ids = new Set<string>();
  for (const c of chunks) {
    if (ids.has(c.id)) throw new Error(`Duplicate chunk id after tenant prefixing: ${c.id}`);
    ids.add(c.id);
  }
  // D-045: every metric policy_refs entry must resolve to a real policy doc (or doc#section) of the same tenant.
  for (const c of chunks) {
    for (const ref of c.policyRefs ?? []) {
      const ok = ref.includes("#") ? ids.has(`${c.tenant}:${ref}`) : chunks.some((x) => x.type === "policy" && x.tenant === c.tenant && x.policy!.doc_id === ref);
      if (!ok) throw new Error(`Metric ${c.id}: policy_refs entry '${ref}' does not resolve to a policy document`);
    }
  }

  // Embed the full corpus in one call, then partition per tenant so ranking
  // (dense scoring AND BM25 with tenant-local IDF) only ever sees one tenant.
  // Embedding isolation (D-046): Voyage vectors for the same text shift slightly with the composition of the call
  // (cosine 0.9988-0.9999 measured), so embedding every tenant in shared calls lets a new tenant perturb the near-ties of
  // existing ones. Rule: the two legacy tenants (mro, northwind) are embedded together in ONE call exactly as before
  // D-044 (keeps D-036/D-041 numbers reproducible, bit-identical); every other tenant is embedded in its own calls
  // (batches of 64, Voyage caps a call at 128 inputs) and never shares a call with another tenant.
  const LEGACY_EMBED_GROUP = new Set(["mro", "northwind"]);
  const embeddings: number[][] = new Array(chunks.length);
  const groups = new Map<string, number[]>();
  chunks.forEach((c, i) => {
    const g = LEGACY_EMBED_GROUP.has(c.tenant) ? "__legacy__" : c.tenant;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(i);
  });
  for (const [g, idxs] of Array.from(groups.entries())) {
    const size = g === "__legacy__" ? idxs.length : 64;
    for (let b = 0; b < idxs.length; b += size) {
      const part = idxs.slice(b, b + size);
      const vecs = await voyageEmbed(part.map((i) => chunks[i].text), "document");
      part.forEach((i, j) => { embeddings[i] = vecs[j]; });
    }
  }

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

// ── Table expansion (D-041) ────────────────────────────────────────────────────
// After ranking + tenant filtering: for each retrieved METRIC chunk, deterministically append
// the TABLE chunks it declares in `tables` (D-033), if not already present. No similarity
// search. Additive: k still controls how many ranked chunks are selected.

const EXPAND_TABLE_CAP = 12;

export function expansionEnabled(override?: boolean): boolean {
  if (override !== undefined) return override;
  const v = (process.env.RETRIEVAL_EXPAND_TABLES ?? "true").toLowerCase();
  return !["false", "0", "off", "no"].includes(v);
}

function expandTables(results: RetrievalResult[], index: TenantIndex, tenant: string, enabled: boolean): RetrievalResult[] {
  if (!enabled) return results;
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const present = new Set(results.map((r) => r.id));
  const added: RetrievalResult[] = [];
  let capped = false;
  outer: for (const r of results) {
    if (r.type !== "metric") continue;
    for (const t of byId.get(r.id)?.tables ?? []) {
      const id = `${tenant}:${t}`; // tenant-prefixed: cannot resolve to another tenant's chunk (D-035)
      const c = byId.get(id);
      if (!c || c.type !== "table" || c.tenant !== tenant || present.has(id)) continue;
      if (added.length >= EXPAND_TABLE_CAP) { capped = true; break outer; }
      present.add(id);
      added.push({ id: c.id, type: c.type, name: c.name, score: 0, text: c.text, expanded: true });
    }
  }
  if (capped) console.warn(`[retrieval] table-expansion cap (${EXPAND_TABLE_CAP}) hit; further tables dropped`);
  return [...results, ...added];
}

// ── Policy expansion + cap (D-045) ────────────────────────────────────────────
// Anti-crowding (D-041 lesson): policy chunks also rank directly against the question, so at most
// RETRIEVAL_MAX_POLICY_CHUNKS (default 3) are returned per request, ranked + expanded combined.

function toResult(c: Chunk, score: number, expanded?: boolean): RetrievalResult {
  return { id: c.id, type: c.type, name: c.name, score, text: c.text, ...(expanded ? { expanded: true } : {}), ...(c.policy ? { policy: c.policy } : {}) };
}

/** Pick up to k ranked chunks in rank order, skipping policy chunks beyond the cap (slots go to the next non-policy chunk). */
function pickRanked(order: number[], scoreOf: (i: number) => number, chunks: Chunk[], k: number, floor = 0): { idxs: number[]; scores: number[] } {
  const cap = maxPolicyChunks();
  const idxs: number[] = [], scores: number[] = [];
  let pol = 0;
  for (const i of order) {
    if (idxs.length >= k) break;
    if (chunks[i].type === "policy") { if (pol >= cap || scoreOf(i) < floor) continue; pol++; }
    idxs.push(i); scores.push(Math.max(0, scoreOf(i)));
  }
  return { idxs, scores };
}

/**
 * Policy selection under the cap. Candidates are ordered by the rank of the evidence that pulled them in: walking the
 * ranked list in order, a ranked policy chunk contributes itself and a ranked metric contributes its `policy_refs`
 * (deterministic, like table expansion). The first `cap` distinct candidates win; ranked-only policy chunks that lose are
 * dropped, referenced ones not already ranked are appended with expanded=true. (Found in Gate B: with ranked policies
 * filling the cap first, a metric's own referenced rule was routinely crowded out by unrelated ranked policy text.)
 */
/** D-048: policy_refs are followed only for the N highest-ranked metric chunks (results arrive in rank order). */
const POLICY_REF_TOP_METRICS = 3;

function expandPolicies(results: RetrievalResult[], index: TenantIndex, tenant: string, enabled: boolean): RetrievalResult[] {
  const cap = maxPolicyChunks();
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const cand: string[] = [];
  const add = (id: string) => { if (!cand.includes(id)) cand.push(id); };
  let metricsSeen = 0;
  for (const r of results) {
    if (r.expanded) continue; // table-expansion entries carry no evidence rank
    if (r.type === "policy") add(r.id);
    else if (enabled && r.type === "metric" && ++metricsSeen <= POLICY_REF_TOP_METRICS) { // D-048: only the top-ranked metrics may pull in their policy_refs
      for (const ref of byId.get(r.id)?.policyRefs ?? []) {
        const targets = ref.includes("#")
          ? [byId.get(`${tenant}:${ref}`)]
          : index.chunks.filter((c) => c.type === "policy" && c.policy!.doc_id === ref);
        for (const c of targets) if (c && c.tenant === tenant) add(c.id);
      }
    }
  }
  const keep = new Set(cand.slice(0, cap));
  const out = results.filter((r) => r.type !== "policy" || keep.has(r.id));
  const present = new Set(out.map((r) => r.id));
  for (const id of cand.slice(0, cap)) if (!present.has(id)) out.push(toResult(byId.get(id)!, 0, true));
  return out;
}

// ── Test path (benchmark, D-036) ───────────────────────────────────────────────
// Exposes each ranker separately. Production default path is retrieve() below
// (rrf) and is unchanged.

export type BenchmarkRanker = "bm25" | "dense" | "rrf";

export async function getTenantChunks(tenant: string): Promise<Array<{ id: string; type: string; name: string; text: string }>> {
  await ensureInit();
  const index = _tenants!.get(tenant);
  if (!index) throw new Error(`Unknown tenant '${tenant}'`);
  return index.chunks.map((c) => ({ id: c.id, type: c.type, name: c.name, text: c.text }));
}

/** D-047 ablation (schema mode): the tenant's ENTIRE corpus - every metric, table and policy section - as results, no ranking, no caps. */
export async function retrieveAll(tenant: string): Promise<RetrieveResponse> {
  await ensureInit();
  const index = _tenants!.get(tenant);
  if (!index) throw new Error(`Unknown tenant '${tenant}'`);
  return { results: index.chunks.map((c) => toResult(c, 1)), confidence: computeConfidence([1]) };
}

export async function retrieveWithRanker(
  query: string,
  k: number,
  tenant: string,
  ranker: BenchmarkRanker,
  expand?: boolean // undefined => RETRIEVAL_EXPAND_TABLES env (default on)
): Promise<RetrieveResponse> {
  if (ranker === "rrf") return retrieve(query, k, tenant, expand);

  await ensureInit();
  const index = _tenants!.get(tenant);
  if (!index) throw new Error(`Unknown tenant '${tenant}'`);

  let ranked: number[];
  const rawScore = new Map<number, number>(); // bm25 normalised to [0,1] for confidence bands; dense = cosine
  if (ranker === "bm25") {
    const raw = bm25Scores(index.bm25, query);
    ranked = raw.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map((x) => x.i);
    const max = Math.max(...raw, 1e-9);
    raw.forEach((v, i) => rawScore.set(i, Math.max(0, v / max)));
  } else {
    const [queryEmb] = await voyageEmbed([query], "query");
    const dense = index.embeddings.map((emb) => cosine(queryEmb, emb));
    ranked = dense.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s).map((x) => x.i);
    dense.forEach((v, i) => rawScore.set(i, Math.max(0, v)));
  }
  const picked = pickRanked(ranked, (i) => rawScore.get(i) ?? 0, index.chunks, k, ranker === "bm25" ? 0 : policyMinScore()); // bm25 scores are max-normalised, not cosine: no floor
  const ranked_results = picked.idxs.map((i, r) => toResult(index.chunks[i], Math.round(picked.scores[r] * 10000) / 10000));
  const exp = expansionEnabled(expand);
  return {
    results: expandPolicies(expandTables(ranked_results, index, tenant, exp), index, tenant, exp),
    confidence: computeConfidence(picked.scores),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function retrieve(query: string, k = 5, tenant?: string, expand?: boolean): Promise<RetrieveResponse> {
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
  const picked = pickRanked(fused, (i) => denseScores[i], chunks, k, policyMinScore()); // policy chunks capped (D-045) and floored (D-046)
  const confidence = computeConfidence(picked.scores);
  const results: RetrievalResult[] = picked.idxs.map((i, rank) => toResult(chunks[i], Math.round(picked.scores[rank] * 10000) / 10000));
  const exp = expansionEnabled(expand);
  return { results: expandPolicies(expandTables(results, index, activeTenant, exp), index, activeTenant, exp), confidence };
}
