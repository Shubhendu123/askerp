"use client";

// D-050: Harborline's answer card. MRO / Northwind keep ChangeTab unchanged; Workbench picks this component only for tenants with showInsightTabs=false.
// Layout: headline -> 2-4 short bullets (key figures bold, policy citations as chips linked to the Retrieval panel) -> table that fits its card.

import { Fragment, useEffect, useRef, useState } from "react";
import type { AskResponse } from "./Workbench";
import { formatDuration, formatTitle } from "@/lib/format";
import { prepareTable, fixAcronyms } from "@/lib/valueFormat";
import { formatSql } from "@/lib/sqlFormat";

interface Props { response: AskResponse | null; loading: boolean; }

const sentimentColor = (s: string | null | undefined) => s === "positive" ? "var(--sentiment-positive)" : s === "negative" ? "var(--sentiment-negative)" : "var(--sentiment-neutral)";
const sentimentBg = (s: string | null | undefined) => s === "positive" ? "var(--sentiment-positive-bg)" : s === "negative" ? "var(--sentiment-negative-bg)" : "var(--bg-subtle)";
const sentimentLabel = (s: string | null | undefined) => s === "positive" ? "Favorable" : s === "negative" ? "Unfavorable" : "Neutral";

// ── inline text: **bold** and policy-citation chips ──────────────────────────
const CITE_SRC = String.raw`(?:POL|CA|MG|EVT|INC|REG)-[A-Za-z0-9]+(?: v\d+(?:\.\d+)?)? §\d+`;
const CITE_GROUP = new RegExp(String.raw`\(\s*(${CITE_SRC}(?:\s*(?:,|;|and|&)\s*${CITE_SRC})*)\s*\)`, "g");
const CITE_ONE = new RegExp(`(${CITE_SRC})`, "g");

function Chip({ cite, onCite }: { cite: string; onCite: (c: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCite(cite)}
      title="Open in the Retrieval panel"
      className="align-baseline transition-colors"
      style={{ fontSize: 10, fontWeight: 500, padding: "1px 7px", margin: "0 1px", borderRadius: 999, border: "1px solid var(--accent)", color: "var(--accent)", background: "var(--accent-subtle)", whiteSpace: "nowrap" }}
    >
      {cite}
    </button>
  );
}

function Inline({ text, onCite }: { text: string; onCite: (c: string) => void }) {
  const cleaned = text.replace(CITE_GROUP, "$1").replace(/\(\s*(?:(?:,|;|and|&)\s*)*\)/g, "");
  return (
    <>
      {cleaned.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i} style={{ fontWeight: 600, color: "var(--text-primary)" }}>{part.slice(2, -2)}</strong>;
        return (
          <Fragment key={i}>
            {part.split(CITE_ONE).map((seg, j) => (j % 2 === 1 ? <Chip key={j} cite={seg} onCite={onCite} /> : <Fragment key={j}>{seg}</Fragment>))}
          </Fragment>
        );
      })}
    </>
  );
}

// ── table ─────────────────────────────────────────────────────────────────────
function DataTable({ columns, rows, row_count, truncated, overrides, onCite }: { columns: string[]; rows: unknown[][]; row_count: number; truncated: boolean; overrides?: NonNullable<AskResponse["overrides"]>; onCite: (c: string) => void }) {
  const visible = rows.slice(0, 10);
  const t = prepareTable(columns, visible);
  // D-050: rows whose target comes from a client agreement carry a dagger, explained in the footnote below the table
  const tgt = t.headers.indexOf("Target");
  if (overrides?.length && tgt >= 0) visible.forEach((r, ri) => { if (overrides.some((o) => (r as unknown[]).some((c) => String(c).toLowerCase() === o.client.toLowerCase()))) t.rows[ri][tgt] += " †"; });
  return (
    <div className="overflow-hidden" style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
      <table className="w-full text-[12px] border-collapse" style={{ tableLayout: "auto" }}>
        <thead>
          <tr style={{ background: "var(--bg-subtle)" }}>
            {t.headers.map((h, ci) => (
              <th key={ci} className="px-3 py-2 font-medium text-[11px]" style={{ color: "var(--text-secondary)", textAlign: t.align[ci], overflowWrap: "anywhere" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((row, ri) => (
            <tr key={ri} style={{ borderTop: "1px solid var(--border)", background: ri % 2 === 1 ? "var(--bg-subtle)" : "var(--bg-surface)" }}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5" style={{ color: "var(--text-primary)", textAlign: t.align[ci], fontWeight: t.align[ci] === "right" ? 500 : 400, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1.5 text-[10px]" style={{ borderTop: "1px solid var(--border)", color: "var(--text-tertiary)", background: "var(--bg-surface)" }}>
        Showing {visible.length} of {row_count} rows{truncated && " — truncated at 100"}
      </div>
      {overrides?.map((o) => (
        <div key={o.client} className="px-3 py-1.5 text-[11px]" style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}>
          † {o.client}: target {o.to.toFixed(1)}% per its client agreement <Chip cite={o.source} onCite={onCite} />, instead of the standard {o.from !== null ? `${o.from.toFixed(1)}%` : "tier target"} <Chip cite={o.supersedes} onCite={onCite} />.
        </div>
      ))}
    </div>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="text-[10px] px-2.5 py-0.5 rounded-full transition-colors"
      style={{ border: "1px solid var(--border)", color: active ? "var(--accent)" : "var(--text-secondary)", background: active ? "var(--accent-subtle)" : "transparent" }}>
      {children}
    </button>
  );
}

type Doc = { id: string; type: string; name: string; score: number; text: string; policy?: { doc_type?: string; access_level?: string; citation?: string } };

export default function HarborlineAnswer({ response, loading }: Props) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const [retrievalOpen, setRetrievalOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const sqlRef = useRef<HTMLDivElement>(null);
  const retrievalRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (sqlOpen) sqlRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [sqlOpen]);
  useEffect(() => {
    if (!retrievalOpen) return;
    (hlRef.current ?? retrievalRef.current)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [retrievalOpen, highlight]);

  const openCitation = (c: string) => { setRetrievalOpen(true); setHighlight(c); };

  const ok = !!response && !response.error;
  const isSingleStat = ok && response!.columns?.length === 1 && response!.row_count === 1;
  const isTable = ok && response!.columns?.length > 0 && response!.row_count > 0 && !isSingleStat;
  const bullets = response?.bullets?.length ? response.bullets : response?.narrative ? [response.narrative] : [];

  // Retrieval panel: top results (policy + document chunks always shown) plus the documents attached after the SQL ran.
  const retrieved = (Array.isArray(response?.retrieved) ? (response!.retrieved as Doc[]) : []).filter((r, i) => i < 5 || r.type === "policy" || r.type === "document");
  const seen = new Set(retrieved.map((r) => r.id));
  const attached = ((response?.enriched_documents ?? []) as Doc[]).filter((r) => !seen.has(r.id));
  const panelDocs: Array<Doc & { attached?: boolean }> = [...retrieved, ...attached.map((d) => ({ ...d, attached: true }))];

  return (
    <div className="space-y-3">
      <div className="p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
        <p className="label-caps mb-2">Insights</p>

        {loading && !response && (
          <div className="space-y-2">
            <div className="h-4 rounded animate-pulse w-2/3" style={{ background: "var(--bg-subtle)" }} />
            {[0, 1, 2].map((i) => <div key={i} className="h-3 rounded animate-pulse" style={{ background: "var(--bg-subtle)", width: `${90 - i * 12}%` }} />)}
          </div>
        )}

        {response?.error && (
          <p className="text-[12px] leading-snug" style={{ color: "var(--sentiment-negative)" }}>
            <span className="font-medium">{response.error.replace(/_/g, " ")}</span>{response.detail ? ` — ${response.detail}` : ""}
          </p>
        )}

        {ok && (
          <>
            {response!.headline && <p className="text-[15px] font-semibold leading-snug" style={{ color: sentimentColor(response!.sentiment) }}>{response!.headline}</p>}
            {response!.period && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                Period: <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{response!.period.label}</span> — {response!.period.reason}
              </p>
            )}
            {bullets.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                    <span className="mt-[7px] shrink-0 rounded-full" style={{ width: 5, height: 5, background: sentimentColor(response!.sentiment) }} />
                    <span><Inline text={b} onCite={openCitation} /></span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full" style={{ background: sentimentBg(response!.sentiment), color: sentimentColor(response!.sentiment) }}>{sentimentLabel(response!.sentiment)}</span>
              <PillButton active={sqlOpen} onClick={() => setSqlOpen((v) => !v)}>{sqlOpen ? "Hide SQL" : "Show SQL"}</PillButton>
              <PillButton active={retrievalOpen} onClick={() => { setHighlight(null); setRetrievalOpen((v) => !v); }}>{retrievalOpen ? "Hide Retrieval" : "Retrieval"}</PillButton>
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                {response!.row_count} row{response!.row_count === 1 ? "" : "s"} · {formatDuration(response!.total_time_ms)}
              </span>
            </div>
          </>
        )}

        {/* single-stat: the big number is shown once, in the analysis header above */}

        {isTable && (
          <div className="mt-4">
            <DataTable columns={response!.columns} rows={response!.rows} row_count={response!.row_count} truncated={response!.truncated} overrides={response!.overrides} onCite={openCitation} />
          </div>
        )}

        {response?.error && response.sql && (
          <pre className="text-[11px] p-3 mt-3 whitespace-pre-wrap break-words" style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)", borderRadius: "var(--radius-md)" }}>{formatSql(response.sql)}</pre>
        )}
      </div>

      {sqlOpen && response?.sql && (
        <div ref={sqlRef} className="p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <p className="label-caps mb-2">Generated SQL</p>
          <pre className="text-[12px] p-3 leading-relaxed whitespace-pre-wrap break-words" style={{ background: "var(--bg-subtle)", color: "var(--text-primary)", fontFamily: "ui-monospace, monospace", borderRadius: "var(--radius-md)", overflowWrap: "anywhere" }}>
            {formatSql(response.sql)}
          </pre>
          <p className="mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            Retrieval {formatDuration(response.retrieval_time_ms)} · SQL gen {formatDuration(response.sql_gen_time_ms)} · Exec {formatDuration(response.execution_time_ms)} · Narrate {formatDuration(response.narrate_time_ms)} · Total {formatDuration(response.total_time_ms)}
          </p>
        </div>
      )}

      {retrievalOpen && panelDocs.length > 0 && (
        <div ref={retrievalRef} className="p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <p className="label-caps mb-3">Top retrievals</p>
          <div className="space-y-2">
            {panelDocs.map((r) => {
              const isHl = !!highlight && r.policy?.citation === highlight;
              return (
                <div key={r.id} ref={isHl ? hlRef : undefined} className="flex items-start gap-3 p-2"
                  style={{ background: isHl ? "var(--accent-subtle)" : "var(--bg-subtle)", borderRadius: "var(--radius-sm)", outline: isHl ? "1.5px solid var(--accent)" : "none" }}>
                  <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ background: r.type === "metric" ? "var(--accent)" : "var(--brand)", color: "#fff", opacity: r.type === "table" ? 0.6 : 1 }}>
                    {r.type === "policy" ? "POLICY" : r.type === "document" ? (r.policy?.doc_type ?? "document").replace("_", " ") : r.type}
                  </span>
                  {r.policy?.access_level === "CONFIDENTIAL" && <span className="text-[9px] uppercase font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ background: "#b91c1c", color: "#fff" }}>CONFIDENTIAL</span>}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.type === "policy" || r.type === "document" ? r.name : fixAcronyms(formatTitle(r.name))}
                      <span className="ml-2 text-[10px] font-normal" style={{ color: "var(--text-tertiary)" }}>{r.attached ? "attached to result" : `score ${r.score.toFixed(4)}`}</span>
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{isHl ? r.text.slice(0, 600) : r.text.slice(0, 140)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
