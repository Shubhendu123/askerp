"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AskResponse {
  question: string;
  sql: string | null;
  metric_used: string | null;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  retrieval_time_ms: number;
  sql_gen_time_ms: number;
  execution_time_ms: number;
  total_time_ms: number;
  error: string | null;
  detail?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text?: string;
  response?: AskResponse;
  loading?: boolean;
}

const SUGGESTED = [
  "What was our total revenue in 2024?",
  "Top 5 customers by order count",
  "Cancellation rate by quarter",
  "Outdoor furniture gross margin in 2025",
  "Which customers churned recently?",
];

// ── Result table ───────────────────────────────────────────────────────────────
function ResultTable({ columns, rows, row_count, truncated }: {
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
}) {
  const display = rows.slice(0, 10);
  return (
    <div className="rounded-md border text-sm overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col} className="whitespace-nowrap font-semibold">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {display.map((row, i) => (
            <TableRow key={i}>
              {(row as unknown[]).map((cell, j) => (
                <TableCell key={j} className="whitespace-nowrap">
                  {cell === null || cell === undefined
                    ? <span className="text-muted-foreground italic">null</span>
                    : typeof cell === "number"
                    ? cell.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : String(cell)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="px-3 py-2 text-xs text-muted-foreground border-t">
        Showing {display.length} of {row_count} rows
        {truncated && " — truncated at 100"}
      </div>
    </div>
  );
}

// ── Assistant message ──────────────────────────────────────────────────────────
function AssistantMessage({ response }: { response: AskResponse }) {
  const [sqlOpen, setSqlOpen] = useState(false);

  if (response.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive mb-1">Error: {response.error}</p>
        {response.detail && (
          <p className="text-muted-foreground font-mono text-xs break-all">
            {response.detail}
          </p>
        )}
        {response.sql && (
          <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
            {response.sql}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {response.metric_used && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {response.metric_used}
          </Badge>
        </div>
      )}

      {response.columns && response.rows && (
        <ResultTable
          columns={response.columns}
          rows={response.rows}
          row_count={response.row_count}
          truncated={response.truncated}
        />
      )}

      {response.sql && (
        <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-muted-foreground">
              {sqlOpen ? "Hide SQL ▲" : "Show SQL ▼"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto mt-1 leading-relaxed">
              {response.sql}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="text-xs text-muted-foreground">
        Retrieved in {Math.round(response.retrieval_time_ms)}ms
        {" · "}SQL in {Math.round(response.sql_gen_time_ms)}ms
        {" · "}Executed in {Math.round(response.execution_time_ms)}ms
        {" · "}Total {Math.round(response.total_time_ms)}ms
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendQuestion(question: string) {
    if (!question.trim() || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: question,
    };
    const loadingMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data: AskResponse = await res.json();

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, response: data }
            : m
        )
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? {
                ...m,
                loading: false,
                response: {
                  question,
                  sql: null,
                  metric_used: null,
                  columns: [],
                  rows: [],
                  row_count: 0,
                  truncated: false,
                  retrieval_time_ms: 0,
                  sql_gen_time_ms: 0,
                  execution_time_ms: 0,
                  total_time_ms: 0,
                  error: "network_error",
                  detail: err instanceof Error ? err.message : "Unknown error",
                },
              }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">AskERP Chat</h1>
          <p className="text-xs text-muted-foreground">
            Northwind Furniture · 3 years · 96K rows
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          claude-sonnet-4-6
        </Badge>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-16">
            <p className="text-2xl mb-3">📊</p>
            <p>Ask anything about Northwind Furniture's ERP data.</p>
            <p className="text-xs mt-1">Revenue · Margins · Customers · Orders</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-3xl ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 text-sm"
                  : "w-full"
              }`}
            >
              {msg.role === "user" && msg.text}
              {msg.role === "assistant" && msg.loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <div className="flex gap-1">
                    <span className="animate-bounce [animation-delay:0ms] w-1.5 h-1.5 bg-muted-foreground rounded-full inline-block" />
                    <span className="animate-bounce [animation-delay:150ms] w-1.5 h-1.5 bg-muted-foreground rounded-full inline-block" />
                    <span className="animate-bounce [animation-delay:300ms] w-1.5 h-1.5 bg-muted-foreground rounded-full inline-block" />
                  </div>
                  Thinking...
                </div>
              )}
              {msg.role === "assistant" && !msg.loading && msg.response && (
                <AssistantMessage response={msg.response} />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t px-4 py-4 space-y-3">
        {/* Suggested chips */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((q) => (
            <button
              key={q}
              onClick={() => sendQuestion(q)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendQuestion(input);
              }
            }}
            placeholder="Ask a question about the data..."
            disabled={loading}
            className="flex-1"
          />
          <Button
            onClick={() => sendQuestion(input)}
            disabled={loading || !input.trim()}
          >
            {loading ? "..." : "Ask"}
          </Button>
        </div>
      </div>
    </div>
  );
}
