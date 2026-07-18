"use client";

import { useState, useRef } from "react";
import { Clock, ArrowLeft } from "lucide-react";
import AnalysisHeader from "./AnalysisHeader";
import InsightTabs from "./InsightTabs";
import ChangeTab from "./ChangeTab";
import ContributionTab from "./ContributionTab";
import DataOverviewCard from "./DataOverviewCard";
import { canContribute } from "@/lib/chartUtils";
import { getTenantConfig, type TenantConfig } from "@/lib/tenants";

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

interface HistoryItem {
  q: string;
  ts: number;
}

const SUGGESTED = [
  "What was our total revenue in 2024?",
  "Top 5 customers by order count",
  "Cancellation rate by quarter",
  "Outdoor furniture gross margin in 2025",
  "Which customers churned recently?",
];

function relativeTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

interface WorkbenchProps {
  tenant?: TenantConfig;
}

export default function Workbench({ tenant = getTenantConfig("mro") }: WorkbenchProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
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

    setHistory((h) => {
      const without = h.filter((item) => item.q !== q);
      return [{ q, ts: Date.now() }, ...without].slice(0, 8);
    });

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

  function backToOverview() {
    setResponse(null);
    setActiveQuestion(null);
    setInput("");
  }

  const isLanding = !response && !loading;

  return (
    <div className="max-w-5xl w-full mx-auto">
      {/* ── Persistent ask bar ─────────────────────────────────────────────── */}
      <div className="flex gap-2 items-stretch">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          placeholder={tenant.searchPlaceholder}
          disabled={loading}
          rows={1}
          className="input-glow flex-1 resize-none text-sm leading-snug transition-all disabled:opacity-50"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            padding: "10px 14px",
          }}
        />
        <button
          onClick={() => ask(input)}
          disabled={loading || !input.trim()}
          className="shrink-0 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "var(--accent)",
            borderRadius: "var(--radius-md)",
            padding: "0 22px",
          }}
          onMouseEnter={(e) => {
            if (!loading && input.trim()) e.currentTarget.style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--accent)";
          }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Thinking
            </span>
          ) : (
            "Ask"
          )}
        </button>
      </div>

      {/* ── Landing (inhabited empty state) ────────────────────────────────── */}
      {isLanding && (
        <div className="mt-4 space-y-6">
          {/* Suggested question chips */}
          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="transition-colors"
                style={{
                  fontSize: 11,
                  padding: "5px 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Connected data source */}
          <div>
            <p className="label-caps mb-2">Connected data source</p>
            <DataOverviewCard tenant={tenant} />
          </div>

          {/* Recent analyses */}
          <div>
            <p className="label-caps mb-2">Recent analyses</p>
            {history.length === 0 ? (
              <div
                className="rounded-xl"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px dashed var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: "16px",
                }}
              >
                <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  Your recent questions will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {history.map((item) => (
                  <button
                    key={item.q}
                    onClick={() => ask(item.q)}
                    className="w-full flex items-center gap-3 text-left transition-colors"
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      padding: "10px 12px",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                  >
                    <Clock size={14} style={{ color: "var(--text-tertiary)" }} className="shrink-0" />
                    <span
                      className="flex-1 truncate"
                      style={{ fontSize: 13, color: "var(--text-primary)" }}
                    >
                      {item.q}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-tertiary)" }} className="shrink-0">
                      {relativeTime(item.ts)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Answered / loading state ───────────────────────────────────────── */}
      {!isLanding && (() => {
        const cols = response?.columns ?? [];
        const rows = response?.rows ?? [];
        const hasData = !response?.error && cols.length > 0 && rows.length > 0;
        const enabledTabs: Record<string, boolean> = {
          change: true,
          contribution: hasData && canContribute(cols, rows),
        };
        const safeTab = enabledTabs[activeTab] ? activeTab : "change";

        return (
          <div className="mt-4 space-y-4">
            <button
              onClick={backToOverview}
              disabled={loading}
              className="flex items-center gap-1.5 transition-colors disabled:opacity-40"
              style={{ fontSize: 12, color: "var(--text-secondary)" }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.color = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <ArrowLeft size={14} />
              Back to overview
            </button>
            <AnalysisHeader response={response} loading={loading} activeQuestion={activeQuestion} tenant={tenant} />
            <InsightTabs activeTab={safeTab} onTabChange={setActiveTab} enabledTabs={enabledTabs} />
            {safeTab === "change" && <ChangeTab response={response} loading={loading} />}
            {safeTab === "contribution" && response && <ContributionTab response={response} />}
          </div>
        );
      })()}
    </div>
  );
}
