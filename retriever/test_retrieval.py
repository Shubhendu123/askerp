"""
AskERP — Naive Retriever Test Harness (Day 7)

Runs 20 hand-written questions through the dense retriever and prints
structured results for empirical analysis. Not pytest — this is an
eval harness. Failures and low-confidence results are the lesson.
"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from retriever.naive_retriever import retrieve

# ── Test questions ─────────────────────────────────────────────────────────────
QUESTIONS = [
    # EASY — single concept, lexically clear
    ("EASY",   "What was our total revenue last quarter?"),
    ("EASY",   "How many active customers do we have?"),
    ("EASY",   "What is our gross margin percentage?"),
    ("EASY",   "Show me the cancellation rate."),
    ("EASY",   "What is the average order value?"),

    # MEDIUM — synonym/paraphrase reasoning required
    ("MEDIUM", "How much did we book in Q3 2024?"),
    ("MEDIUM", "What's our top line?"),
    ("MEDIUM", "How concentrated is our customer base?"),
    ("MEDIUM", "Show me DSO."),
    ("MEDIUM", "What's the refund rate by category?"),

    # HARD — multi-concept, multi-table reasoning
    ("HARD",   "Why did West region revenue drop in Q4 2024?"),
    ("HARD",   "Are we losing whale customers?"),
    ("HARD",   "What happened to outdoor furniture margins in 2025?"),
    ("HARD",   "Which suppliers had quality issues last year?"),
    ("HARD",   "How many of our top customers churned?"),

    # EDGE CASES — designed to fail or struggle
    ("EDGE",   "Tell me about Hilton."),
    ("EDGE",   "What's the weather like in Atlanta?"),
    ("EDGE",   "Show me sales."),
    ("EDGE",   "Numbers."),
    ("EDGE",   ""),
]

SEP = "=" * 64

def fmt_tag(result):
    meta = result["metadata"]
    if result["type"] == "metric":
        return f"{meta.get('domain','?')}/{meta.get('owner','?')}"
    return meta.get("table_type", "?")


def main():
    print(SEP)
    print("AskERP Naive Retriever — 20-Question Eval Harness")
    print(SEP)
    print()

    high_conf  = 0   # top-1 score > 0.7
    low_conf   = 0   # top-1 score < 0.4
    edge_flags = 0   # empty or returned nothing
    total_retrieval_ms = 0.0

    for idx, (difficulty, question) in enumerate(QUESTIONS, start=1):
        print(SEP)
        print(f'Query [{idx:02d}/20] ({difficulty}): "{question}"')

        if not question.strip():
            edge_flags += 1
            print("  [EDGE] Empty query — retriever returned no results.")
            print()
            continue

        t0 = time.time()
        results = retrieve(question, k=5)
        elapsed_ms = (time.time() - t0) * 1000
        total_retrieval_ms += elapsed_ms

        if not results:
            edge_flags += 1
            print("  [EDGE] No results returned.")
            print()
            continue

        top_score = results[0]["score"]
        if top_score > 0.7:
            high_conf += 1
        if top_score < 0.4:
            low_conf += 1

        print("Top 5 retrievals:")
        for rank, r in enumerate(results, 1):
            tag = fmt_tag(r)
            print(f"  {rank}. [{r['score']:.2f}] {r['id']} ({tag})")

        print(f"  retrieval_time: {elapsed_ms:.1f}ms  |  top-1 score: {top_score:.3f}")
        print()

    # ── Summary ────────────────────────────────────────────────────────────────
    answered = sum(1 for _, q in QUESTIONS if q.strip())
    avg_ms   = total_retrieval_ms / max(answered, 1)

    print(SEP)
    print("SUMMARY")
    print(SEP)
    print(f"Total queries             : 20")
    print(f"Queries with results      : {answered}")
    print(f"Total retrieval time      : {total_retrieval_ms:.1f}ms")
    print(f"Avg retrieval time/query  : {avg_ms:.1f}ms")
    print(f"High-confidence (top-1 > 0.7) : {high_conf}/20")
    print(f"Low-confidence  (top-1 < 0.4) : {low_conf}/20")
    print(f"Empty/edge queries flagged    : {edge_flags}/20")
    print()


if __name__ == "__main__":
    main()
