/**
 * SQL validator + classified retry (D-041 Part C).
 * Pure module: no DB or LLM imports. Callers supply generate/explain/execute callbacks, so
 * the same logic serves the eval harness (local DuckDB) and, later, /api/ask (MotherDuck).
 *
 * Pre-execution (deterministic): single read-only SELECT/WITH; every referenced table must be
 * a known table of the active tenant (CTE names allowed); LIMIT enforced; then an EXPLAIN
 * dry-run catches parser/binder errors without running the query.
 * Retry: max 2, only parser_error / binder_error, verbatim error fed back. Never retries
 * refusal, out_of_scope, permission, timeout.
 */

export type ErrorClass =
  | "parser_error" | "binder_error" | "timeout" | "refusal" | "out_of_scope" | "permission" | "other";

export const RETRYABLE: ReadonlySet<ErrorClass> = new Set<ErrorClass>(["parser_error", "binder_error"]);
export const MAX_RETRIES = 2;
export const DEFAULT_MAX_ROWS = Number(process.env.SQL_MAX_ROWS) > 0 ? Number(process.env.SQL_MAX_ROWS) : 1000;

export interface TenantSchemaInfo {
  schema: string;          // e.g. "mro_distributor"
  tables: Set<string>;     // bare table names of the active tenant
  requireQualification?: boolean; // default true; false for tenants whose tables are referenced unqualified (northwind)
}

export interface ValidationFailure { cls: ErrorClass; message: string }

/** Remove comments and string literals so keyword/table scans don't trip on their contents. */
function sanitizeForScan(sql: string): string {
  let out = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\bDISTINCT\s+FROM\b/gi, " ");
  // Functions whose syntax embeds FROM (EXTRACT(year FROM d), SUBSTRING(x FROM 2), TRIM(BOTH ' ' FROM x)) are not table refs.
  for (let i = 0; i < 4; i++) out = out.replace(/\b(EXTRACT|SUBSTRING|TRIM|OVERLAY|POSITION)\s*\([^()]*\)/gi, " 0 ");
  return out;
}

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|COPY|PRAGMA|TRUNCATE|INSTALL|LOAD|EXPORT|CALL)\b/i;

export function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+\s*$/, "");
}

/** Static checks. Returns null when the statement passes. */
export function validateStatic(sqlIn: string, info: TenantSchemaInfo): ValidationFailure | null {
  const scan = sanitizeForScan(stripTrailingSemicolon(sqlIn));
  if (!scan.trim()) return { cls: "other", message: "empty SQL" };
  if (scan.includes(";")) return { cls: "permission", message: "multiple statements are not allowed" };
  if (!/^\s*\(?\s*(SELECT|WITH)\b/i.test(scan)) return { cls: "permission", message: "only a single SELECT/WITH statement is allowed" };
  const bad = scan.match(FORBIDDEN);
  if (bad) return { cls: "permission", message: `forbidden keyword: ${bad[1].toUpperCase()}` };

  // CTE names defined in this statement
  const ctes = new Set<string>();
  for (const m of Array.from(scan.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_]\w*)\s+AS\s*\(/gi))) ctes.add(m[1].toLowerCase());

  // Every FROM/JOIN target
  for (const m of Array.from(scan.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*(\()?/gi))) {
    if (m[2]) continue; // table function, e.g. FROM generate_series(...)
    const parts = m[1].split(".").map((p) => p.trim().toLowerCase());
    if (parts.length === 2) {
      const [schema, table] = parts;
      if (schema !== info.schema.toLowerCase()) return { cls: "out_of_scope", message: `cross-tenant or unknown schema reference: ${schema}.${table}` };
      if (!info.tables.has(table)) return { cls: "binder_error", message: `Unknown table in schema ${info.schema}: ${table}` };
    } else {
      const t = parts[0];
      if (ctes.has(t)) continue;
      if (info.tables.has(t) && info.requireQualification === false) continue;
      if (info.tables.has(t)) return { cls: "binder_error", message: `Table "${t}" must be qualified as ${info.schema}.${t}` };
      return { cls: "binder_error", message: `Unknown table reference: ${t}` };
    }
  }
  return null;
}

/** Append LIMIT when the statement has no top-level LIMIT. */
export function enforceLimit(sqlIn: string, maxRows = DEFAULT_MAX_ROWS): { sql: string; added: boolean } {
  const sql = stripTrailingSemicolon(sqlIn);
  const scan = sanitizeForScan(sql);
  let depth = 0;
  const re = /\(|\)|\bLIMIT\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan))) {
    if (m[0] === "(") depth++;
    else if (m[0] === ")") depth--;
    else if (depth === 0) return { sql, added: false };
  }
  return { sql: `${sql}\nLIMIT ${maxRows}`, added: true };
}

/** Map a raw error message to an ErrorClass. */
export function classifyError(message: string): ErrorClass {
  const m = message || "";
  if (/^REFUSE\b/i.test(m)) return "refusal";
  if (/query timeout|INTERRUPT/i.test(m)) return "timeout";
  if (/Parser Error/i.test(m)) return "parser_error";
  // Catalog errors (unknown table/function) are name-resolution failures raised by the binder stage.
  if (/Binder Error|Catalog Error/i.test(m)) return "binder_error";
  if (/permission|read-only|not allowed|Cannot execute statement/i.test(m)) return "permission";
  return "other";
}

export function shouldRetry(cls: ErrorClass, retriesSoFar: number): boolean {
  return RETRYABLE.has(cls) && retriesSoFar < MAX_RETRIES;
}

export interface Attempt {
  sql: string;
  stage: "static" | "explain" | "execute" | "ok" | "refused";
  error_class: ErrorClass | null;
  error_message: string | null;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
}

export interface GenResult { sql: string; tokens_in: number; tokens_out: number; latency_ms: number; apiError?: string }

export interface RunDeps<T> {
  info: TenantSchemaInfo;
  maxRows?: number;
  /** Generate SQL; on a retry, receives the prior SQL and its verbatim error. */
  generate: (retry?: { prevSql: string; error: string }) => Promise<GenResult>;
  /** EXPLAIN dry run: resolve on success, throw with the engine's verbatim message otherwise. */
  explain: (sql: string) => Promise<void>;
  /** Run the statement; return the caller's result or throw. */
  execute: (sql: string) => Promise<T>;
}

export interface RunOutcome<T> {
  ok: boolean;
  result?: T;
  finalSql: string;
  attempts: Attempt[];
  retry_count: number;
  retry_outcome: "none" | "recovered" | "exhausted" | "not_retryable";
  final_error_class: ErrorClass | null;
  final_error_message: string | null;
  limit_added: boolean;
}

export async function runWithValidation<T>(d: RunDeps<T>): Promise<RunOutcome<T>> {
  const attempts: Attempt[] = [];
  let retries = 0;
  let retry: { prevSql: string; error: string } | undefined;
  let limitAdded = false;

  for (;;) {
    const g = await d.generate(retry);
    const base = { tokens_in: g.tokens_in, tokens_out: g.tokens_out, latency_ms: g.latency_ms };
    const fail = (stage: Attempt["stage"], sql: string, cls: ErrorClass, msg: string) => {
      attempts.push({ sql, stage, error_class: cls, error_message: msg, ...base });
      if (shouldRetry(cls, retries)) {
        retries++;
        retry = { prevSql: sql, error: msg };
        return false; // continue loop
      }
      return true; // stop
    };

    let stop: boolean;
    let sql = g.sql;
    if (g.apiError) { stop = fail("static", sql, "other", g.apiError); }
    else if (/^REFUSE\b/i.test(sql) || !sql) { stop = fail("static", sql, "refusal", sql || "empty response"); }
    else {
      const sv = validateStatic(sql, d.info);
      if (sv) { stop = fail("static", sql, sv.cls, sv.message); }
      else {
        const lim = enforceLimit(sql, d.maxRows);
        sql = lim.sql; limitAdded = limitAdded || lim.added;
        let phase: "explain" | "execute" = "explain";
        try {
          await d.explain(sql);
          phase = "execute";
          const result = await d.execute(sql);
          attempts.push({ sql, stage: "ok", error_class: null, error_message: null, ...base });
          return {
            ok: true, result, finalSql: sql, attempts, retry_count: retries,
            retry_outcome: retries > 0 ? "recovered" : "none",
            final_error_class: null, final_error_message: null, limit_added: limitAdded,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          stop = fail(phase, sql, classifyError(msg), msg);
        }
      }
    }
    if (stop) {
      const last = attempts[attempts.length - 1];
      return {
        ok: false, finalSql: last.sql, attempts, retry_count: retries,
        retry_outcome: retries > 0 ? "exhausted" : "not_retryable",
        final_error_class: last.error_class, final_error_message: last.error_message, limit_added: limitAdded,
      };
    }
  }
}
