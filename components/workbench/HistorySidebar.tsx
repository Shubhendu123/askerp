"use client";

import { useState } from "react";

const SUGGESTED = [
  "What was our total revenue in 2024?",
  "Top 5 customers by order count",
  "Cancellation rate by quarter",
  "Outdoor furniture gross margin in 2025",
  "Which customers churned recently?",
];

interface Props {
  history: string[];
  activeQuestion: string | null;
  onSelect: (q: string) => void;
  loading: boolean;
}

export default function HistorySidebar({
  history,
  activeQuestion,
  onSelect,
  loading,
}: Props) {
  const [input, setInput] = useState("");

  function submit() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    onSelect(q);
  }

  return (
    <div
      className="flex flex-col h-full border-r"
      style={{
        background: "var(--bg-accent)",
        borderColor: "var(--divider)",
      }}
    >
      {/* Logo / title */}
      <div
        className="px-3 py-3 border-b"
        style={{ borderColor: "var(--divider)" }}
      >
        <span
          className="font-semibold text-sm"
          style={{ color: "var(--text-primary)" }}
        >
          AskERP
        </span>
        <p
          className="text-[10px] mt-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          Northwind Furniture
        </p>
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-2 space-y-1">
        {history.length > 0 && (
          <p
            className="px-1 mb-2 text-[10px] uppercase tracking-widest font-medium"
            style={{ color: "var(--text-tertiary)" }}
          >
            Recent
          </p>
        )}
        {history.map((q) => {
          const isActive = q === activeQuestion;
          return (
            <button
              key={q}
              onClick={() => !loading && onSelect(q)}
              disabled={loading}
              className="w-full text-left px-2 py-1.5 rounded text-[11px] leading-snug transition-colors disabled:cursor-not-allowed"
              style={{
                background: isActive ? "var(--bg-surface)" : "transparent",
                border: isActive
                  ? "1px solid var(--accent-primary)"
                  : "1px solid transparent",
                color: isActive
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              }}
            >
              {q.length > 60 ? q.slice(0, 57) + "…" : q}
            </button>
          );
        })}

        {/* Suggested chips (only when no history) */}
        {history.length === 0 && (
          <>
            <p
              className="px-1 mb-2 text-[10px] uppercase tracking-widest font-medium"
              style={{ color: "var(--text-tertiary)" }}
            >
              Try asking
            </p>
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => !loading && onSelect(q)}
                disabled={loading}
                className="w-full text-left px-2 py-1.5 rounded text-[11px] leading-snug transition-colors disabled:cursor-not-allowed"
                style={{
                  background: "transparent",
                  border: "1px solid var(--divider)",
                  color: "var(--text-secondary)",
                }}
              >
                {q.length > 60 ? q.slice(0, 57) + "…" : q}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Input */}
      <div
        className="px-2 py-3 border-t space-y-1"
        style={{ borderColor: "var(--divider)" }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask a question…"
          disabled={loading}
          rows={3}
          className="w-full resize-none rounded px-2 py-1.5 text-[11px] leading-snug outline-none border transition-colors disabled:opacity-50"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--divider)",
            color: "var(--text-primary)",
          }}
        />
        <button
          onClick={submit}
          disabled={loading || !input.trim()}
          className="w-full py-1.5 rounded text-[11px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: "var(--accent-primary)" }}
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
