"use client";

import { useState, useRef } from "react";
import AnalysisHeader from "./AnalysisHeader";
import InsightTabs from "./InsightTabs";
import ChangeTab from "./ChangeTab";
import ContributionTab from "./ContributionTab";
import TrendTab from "./TrendTab";
import DriversTab from "./DriversTab";
import { canContribute, canTrend, canDrivers } from "@/lib/chartUtils";

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

const FEATURES = [
  { icon: "⚡", label: "Natural Language" },
  { icon: "📈", label: "Trend Analysis" },
  { icon: "🔍", label: "Driver Breakdown" },
  { icon: "💬", label: "AI Narration" },
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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-page)" }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 border-b"
        style={{ background: "var(--bg-surface)", borderColor: "var(--divider)" }}
      >
        <div className="max-w-5xl mx-auto px-6 py-4">

          {/* Brand + dataset row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {/* Logo mark */}
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)" }}
              >
                <span className="text-white text-xs font-bold">AE</span>
              </div>
              <span className="font-bold text-lg tracking-tight gradient-text">AskERP</span>
              <div
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium"
                style={{ background: "var(--bg-accent)", color: "var(--text-secondary)", border: "1px solid var(--divider2)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Northwind Furniture · 3 yrs · 96K rows
              </div>
            </div>

            {/* Feature pills — right side */}
            <div className="hidden md:flex items-center gap-2">
              {FEATURES.map((f) => (
                <span
                  key={f.label}
                  className="text-[10px] px-2 py-1 rounded-full font-medium"
                  style={{ background: "var(--bg-accent)", color: "var(--text-tertiary)", border: "1px solid var(--divider)" }}
                >
                  {f.icon} {f.label}
                </span>
              ))}
            </div>
          </div>

          {/* Ask input */}
          <div className="flex gap-3 items-start">
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
              placeholder="Ask anything about Northwind Furniture — revenue, margins, customers, orders…"
              disabled={loading}
              rows={1}
              className="input-glow flex-1 resize-none rounded-xl px-4 py-3 text-sm leading-snug border transition-all disabled:opacity-40"
              style={{
                background: "var(--bg-input)",
                border: "1.5px solid var(--divider2)",
                color: "var(--text-primary)",
              }}
            />
            <button
              onClick={() => ask(input)}
              disabled={loading || !input.trim()}
              className="btn-gradient shrink-0 px-6 py-3 rounded-xl text-sm font-semibold text-white"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Thinking
                </span>
              ) : "Ask"}
            </button>
          </div>

          {/* Suggested / History chips */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {history.length === 0 ? (
              SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  disabled={loading}
                  className="text-[11px] px-3 py-1 rounded-full border transition-all disabled:opacity-40 hover:border-indigo-500/50 hover:text-indigo-300"
                  style={{ borderColor: "var(--divider2)", color: "var(--text-secondary)", background: "transparent" }}
                >
                  {q}
                </button>
              ))
            ) : (
              <>
                <span className="text-[10px] self-center uppercase tracking-widest mr-1" style={{ color: "var(--text-tertiary)" }}>
                  Recent:
                </span>
                {history.map((q) => {
                  const isActive = q === activeQuestion;
                  return (
                    <button
                      key={q}
                      onClick={() => !loading && ask(q)}
                      disabled={loading}
                      className="text-[11px] px-3 py-1 rounded-full border transition-all disabled:opacity-40"
                      style={{
                        borderColor: isActive ? "var(--accent-primary)" : "var(--divider2)",
                        color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
                        background: isActive ? "var(--accent-glow)" : "transparent",
                        fontWeight: isActive ? 500 : 400,
                      }}
                    >
                      {q.length > 45 ? q.slice(0, 42) + "…" : q}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      <main className="flex-1 px-6 py-6 max-w-5xl w-full mx-auto">

        {/* Empty state */}
        {!response && !loading && (
          <div className="flex flex-col items-center justify-center pt-20 text-center">
            {/* Glow orb */}
            <div className="relative mb-8">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(139,92,246,0.2) 100%)",
                  border: "1px solid rgba(99,102,241,0.3)",
                  boxShadow: "0 0 60px rgba(99,102,241,0.15)",
                }}
              >
                📊
              </div>
            </div>

            <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
              What do you want to know?
            </h2>
            <p className="text-sm mb-8 max-w-sm" style={{ color: "var(--text-secondary)" }}>
              Ask a plain-English question about Northwind Furniture&apos;s ERP data.
              The AI agent figures out the rest.
            </p>

            {/* Feature cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-2xl">
              {[
                { icon: "💬", title: "AI Narration", desc: "Plain-English insight with every result" },
                { icon: "📈", title: "Trend Analysis", desc: "Spot patterns over time automatically" },
                { icon: "🔍", title: "Driver Breakdown", desc: "Why by segment, category & region" },
                { icon: "📋", title: "Data Table", desc: "Full results with formatting" },
              ].map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl p-4 text-left"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--divider)" }}
                >
                  <p className="text-xl mb-2">{f.icon}</p>
                  <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{f.title}</p>
                  <p className="text-[11px] leading-snug" style={{ color: "var(--text-tertiary)" }}>{f.desc}</p>
                </div>
              ))}
            </div>
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
            drivers: canDrivers(response?.metric_used ?? null, hasData),
          };
          const safeTab = enabledTabs[activeTab] ? activeTab : "change";

          return (
            <div className="space-y-4">
              <AnalysisHeader response={response} loading={loading} activeQuestion={activeQuestion} />
              <InsightTabs activeTab={safeTab} onTabChange={setActiveTab} enabledTabs={enabledTabs} />
              {safeTab === "change" && <ChangeTab response={response} loading={loading} />}
              {safeTab === "contribution" && response && <ContributionTab response={response} />}
              {safeTab === "trend" && response && <TrendTab response={response} />}
              {safeTab === "drivers" && response && <DriversTab response={response} />}
            </div>
          );
        })()}
      </main>
    </div>
  );
}
