"use client";

import { useState } from "react";
import HistorySidebar from "./HistorySidebar";
import AnalysisHeader from "./AnalysisHeader";
import InsightTabs from "./InsightTabs";
import ChangeTab from "./ChangeTab";

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
  error: string | null;
  detail?: string;
}

export default function Workbench() {
  const [history, setHistory] = useState<string[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setLoading(true);
    setActiveQuestion(question);
    setResponse(null);

    if (!history.includes(question)) {
      setHistory((h) => [question, ...h].slice(0, 8));
    }

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data: AskResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setResponse({
        question,
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
        error: "network_error",
        detail: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "var(--bg-page)" }}
    >
      {/* Left sidebar — 170px fixed */}
      <div className="w-[170px] shrink-0 h-full">
        <HistorySidebar
          history={history}
          activeQuestion={activeQuestion}
          onSelect={ask}
          loading={loading}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
        <AnalysisHeader
          response={response}
          loading={loading}
          activeQuestion={activeQuestion}
        />

        {(response || loading) && (
          <>
            <InsightTabs />
            <ChangeTab response={response} loading={loading} />
          </>
        )}

        {!response && !loading && (
          <div className="flex items-center justify-center h-64">
            <p
              className="text-sm"
              style={{ color: "var(--text-tertiary)" }}
            >
              Ask a question to begin your analysis
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
