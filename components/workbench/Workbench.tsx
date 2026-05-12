"use client";

import { useState, useRef } from "react";
import AnalysisHeader from "./AnalysisHeader";
import InsightTabs from "./InsightTabs";
import ChangeTab from "./ChangeTab";
import ContributionTab from "./ContributionTab";
import TrendTab from "./TrendTab";
import { canContribute, canTrend } from "@/lib/chartUtils";

export interface AskResponse {
  question: string;
  sql: string | null;
  metric_used: string | null;
  sentiment: "positive" | "negative" | "none" | null;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  retrieval_time_ms: number;
  sql_gen_time_ms: number;
  execution_time_ms: number;
  total_time_ms: number;
  retrieved: unknown[];
  reasoning: string | null;
  headline: string;
  narrative: string;
  narrate_time_ms: number;
  error: string | null;
  detail?: string;
}

const SUGGESTED = [
  "What was our total revenue in 2024?",
  "Top 5 customers by order count",
  "Cancellation rate by quarter",
  "Outdoor furniture gross margin in 2025",
  "Which customers churned recently?",
];

export default function Workbench() {
  const [history, setHistory] = useState<string[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("change");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setActiveQuestion(q);
    setResponse(null);
    setInput("");
    setActiveTab("change");

    if (!history.includes(q)) {
      setHistory((h) => [q, ...h].slice(0, 8));
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data: AskResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setResponse({
        question: q,
        sql: null,
        metric_used: null,
        sentiment: null,
        columns: [],
        rows: [],
        row_count: 0,
        truncated: false,
        retrieval_time_ms: 0,
        sql_gen_time_ms: 0,
        execution_time_ms: 0,
        total_time_ms: 0,
        retrieved: [],
        reasoning: null,
        headline: "",
        narrative: "",
        narrate_time_ms: 0,
        error: "network_error",
        detail: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    ask(input);
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--bg-page)" }}
    >
      {/* ── Top ask bar ─────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 border-b px-6 py-4"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--divider)",
        }}
      >
        {/* Brand row */}
        <div className="flex items-center gap-3 mb-3">
          <span
            className="font-semibold text-sm shrink-0"
            style={{ color: "var(--text-primary)" }}
          >
            AskERP
          </span>
          <span
            className="text-[11px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            Northwind Furniture · 3 years · 96K rows
          </span>
        </div>

        {/* Input row — full width */}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask a question about Northwind Furniture data…"
            disabled={loading}
            rows={1}
            className="flex-1 resize-none rounded-lg px-4 py-2.5 text-sm leading-snug outline-none border transition-colors disabled:opacity-50"
            style={{
              background: "var(--bg-page)",
              border: "1.5px solid var(--divider)",
              color: "var(--text-primary)",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "var(--accent-primary)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "var(--divider)")
            }
          />
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className="shrink-0 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--accent-primary)" }}
          >
            {loading ? "Thinking…" : "Ask"}
          </button>
        </div>

        {/* Suggested chips — only when no history */}
        {history.length === 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                disabled={loading}
                className="text-[11px] px-3 py-1 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-accent)]"
                style={{
                  borderColor: "var(--divider)",
                  color: "var(--text-secondary)",
                  background: "transparent",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* History chips — once there's history */}
        {history.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <span
              className="text-[10px] self-center uppercase tracking-wider mr-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              Recent:
            </span>
            {history.map((q) => {
              const isActive = q === activeQuestion;
              return (
                <button
                  key={q}
                  onClick={() => !loading && ask(q)}
                  disabled={loading}
                  className="text-[11px] px-3 py-1 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    borderColor: isActive
                      ? "var(--accent-primary)"
                      : "var(--divider)",
                    color: isActive
                      ? "var(--accent-primary)"
                      : "var(--text-secondary)",
                    background: isActive ? "var(--bg-accent)" : "transparent",
                    fontWeight: isActive ? 500 : 400,
                  }}
                >
                  {q.length > 45 ? q.slice(0, 42) + "…" : q}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Results area ────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-5 space-y-3 max-w-5xl w-full mx-auto">
        {/* Empty state */}
        {!response && !loading && (
          <div
            className="flex flex-col items-center justify-center pt-24 text-center"
          >
            <p
              className="text-4xl mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              📊
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Ask anything about Northwind Furniture&apos;s ERP data
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              Revenue · Margins · Customers · Orders
            </p>
          </div>
        )}

        {/* Analysis output */}
        {(response || loading) && (() => {
          const cols = response?.columns ?? [];
          const rows = response?.rows ?? [];
          const hasData = !response?.error && cols.length > 0 && rows.length > 0;
          const enabledTabs: Record<string, boolean> = {
            change: true,
            contribution: hasData && canContribute(cols, rows),
            trend: hasData && canTrend(cols, rows),
            drivers: false,
          };
          // If active tab becomes disabled (e.g. new query), fall back to change
          const safeTab = enabledTabs[activeTab] ? activeTab : "change";

          return (
            <>
              <AnalysisHeader
                response={response}
                loading={loading}
                activeQuestion={activeQuestion}
              />
              <InsightTabs
                activeTab={safeTab}
                onTabChange={setActiveTab}
                enabledTabs={enabledTabs}
              />
              {safeTab === "change" && (
                <ChangeTab response={response} loading={loading} />
              )}
              {safeTab === "contribution" && response && (
                <ContributionTab response={response} />
              )}
              {safeTab === "trend" && response && (
                <TrendTab response={response} />
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
