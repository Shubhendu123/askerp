"""
AskERP — SQL Generator Agent (Day 9)

Takes a user question + retrieved schema/metric chunks and produces
executable DuckDB SQL via Claude claude-sonnet-4-6.

Importable: from agents.sql_generator import generate_sql
CLI:        python3 -m agents.sql_generator "What was our total revenue in 2024?"
             (fetches context from retrieval API on localhost:8001)
"""

import os
import sys
import json
import re

BASE_DIR = os.path.join(os.path.dirname(__file__), "..")

# Load API key from .env.local if not already in environment
def _load_env():
    env_path = os.path.join(BASE_DIR, ".env.local")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    if key.strip() not in os.environ:
                        os.environ[key.strip()] = val.strip().strip('"').strip("'")

_load_env()

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic not installed. Run: pip3 install anthropic")
    sys.exit(1)

_CLIENT = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# ── System prompt ──────────────────────────────────────────────────────────────
_SYSTEM_PROMPT = """You are a SQL generator for a DuckDB analytics warehouse for Northwind Furniture, a ~$50M B2B furniture company.

DATABASE FACTS:
- DuckDB dialect (similar to PostgreSQL/BigQuery)
- Fiscal year: calendar year (Jan-Dec)
- Date dimension: dim_date with columns: date_id (YYYYMMDD integer), date (DATE), year, quarter, month
- All fact tables join to dim_date via date_id foreign keys
- fact_sales_order has: order_id, customer_id, employee_id, order_date_id, location_id, order_status, total_amount, line_count, primary_item_category, effective_unit_cost, effective_gross_margin_pct
- order_status values: 'Confirmed', 'Delivered', 'Cancelled', 'Pending'
- Active orders = order_status NOT IN ('Cancelled', 'Pending')

RULES:
1. Return ONLY valid DuckDB SQL — no CTEs unless necessary, no window functions unless asked
2. Always filter fact_sales_order to exclude Cancelled/Pending unless user asks for cancellations
3. Use dim_date for all date filtering — do not filter on date_id integers directly
4. Aggregate to reasonable granularity — if user says "by quarter" add dd.year, dd.quarter to GROUP BY
5. LIMIT results to 100 rows maximum
6. Never use SELECT * — name the columns explicitly
7. Use table aliases: fso=fact_sales_order, dc=dim_customer, di=dim_item, dd=dim_date, de=dim_employee, dp=fact_payment, fi=fact_invoice

GROSS MARGIN FORMULA:
(SUM(fso.total_amount) - SUM(fso.effective_unit_cost * fso.line_count)) / SUM(fso.total_amount) * 100

Output JSON with exactly these keys:
{
  "sql": "SELECT ...",
  "metric_used": "metric_name or null",
  "sentiment": "positive or negative or none",
  "tables_referenced": ["table1", "table2"],
  "reasoning": "one sentence",
  "confidence": "HIGH or MEDIUM or LOW"
}

For sentiment: if a metric is used, derive it from the metric's sentiment field in the retrieved context.
Use "positive" for metrics where higher is better (revenue, margin, active customers),
"negative" for metrics where higher is worse (churn, cancellation, days to pay),
"none" for neutral or directional metrics (growth rate, segment breakdown).
If no metric is used, set "none".

Output ONLY the JSON object. No markdown, no explanation."""

# ── Few-shot examples ──────────────────────────────────────────────────────────
_FEW_SHOT_EXAMPLES = [
    {
        "question": "What was our total revenue in 2024?",
        "answer": json.dumps({
            "sql": "SELECT SUM(fso.total_amount) AS total_revenue FROM fact_sales_order fso JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE fso.order_status NOT IN ('Cancelled', 'Pending') AND dd.year = 2024",
            "metric_used": "total_revenue",
            "sentiment": "positive",
            "tables_referenced": ["fact_sales_order", "dim_date"],
            "reasoning": "Sum total_amount for confirmed/delivered orders in 2024 using dim_date year filter.",
            "confidence": "HIGH"
        })
    },
    {
        "question": "Top 5 customers by revenue last quarter",
        "answer": json.dumps({
            "sql": "SELECT dc.customer_name, SUM(fso.total_amount) AS revenue FROM fact_sales_order fso JOIN dim_customer dc ON fso.customer_id = dc.customer_id JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE fso.order_status NOT IN ('Cancelled', 'Pending') AND dd.year = 2025 AND dd.quarter = 4 GROUP BY dc.customer_name ORDER BY revenue DESC LIMIT 5",
            "metric_used": "total_revenue",
            "sentiment": "positive",
            "tables_referenced": ["fact_sales_order", "dim_customer", "dim_date"],
            "reasoning": "Join customer dimension, group by name, order by revenue descending, limit 5.",
            "confidence": "HIGH"
        })
    },
    {
        "question": "Average gross margin for Outdoor Furniture in 2025",
        "answer": json.dumps({
            "sql": "SELECT ROUND((SUM(fso.total_amount) - SUM(fso.effective_unit_cost * fso.line_count)) / SUM(fso.total_amount) * 100, 2) AS gross_margin_pct FROM fact_sales_order fso JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE fso.order_status NOT IN ('Cancelled', 'Pending') AND fso.primary_item_category = 'Outdoor Furniture' AND dd.year = 2025",
            "metric_used": "gross_margin_pct",
            "sentiment": "positive",
            "tables_referenced": ["fact_sales_order", "dim_date"],
            "reasoning": "Filter to Outdoor Furniture using primary_item_category, apply gross margin formula.",
            "confidence": "HIGH"
        })
    },
    {
        "question": "Cancellation rate by quarter in 2024",
        "answer": json.dumps({
            "sql": "SELECT dd.quarter, ROUND(COUNT(CASE WHEN fso.order_status = 'Cancelled' THEN 1 END) * 100.0 / COUNT(*), 2) AS cancellation_rate_pct FROM fact_sales_order fso JOIN dim_date dd ON fso.order_date_id = dd.date_id WHERE dd.year = 2024 GROUP BY dd.quarter ORDER BY dd.quarter",
            "metric_used": "cancellation_rate",
            "sentiment": "negative",
            "tables_referenced": ["fact_sales_order", "dim_date"],
            "reasoning": "Count cancelled orders as pct of all orders, grouped by quarter.",
            "confidence": "HIGH"
        })
    },
    {
        "question": "Which customers churned in late 2024?",
        "answer": json.dumps({
            "sql": "SELECT dc.customer_name, MAX(dd.date) AS last_order_date FROM fact_sales_order fso JOIN dim_customer dc ON fso.customer_id = dc.customer_id JOIN dim_date dd ON fso.order_date_id = dd.date_id GROUP BY dc.customer_name HAVING MAX(dd.date) < '2024-11-01' AND MAX(dd.date) > '2024-06-01' ORDER BY last_order_date DESC LIMIT 20",
            "metric_used": "customer_churn_count",
            "sentiment": "negative",
            "tables_referenced": ["fact_sales_order", "dim_customer", "dim_date"],
            "reasoning": "Find customers whose last order was between mid-2024 and Nov 2024, indicating churn.",
            "confidence": "MEDIUM"
        })
    },
]


def _build_user_message(question: str, retrieved_chunks: list) -> str:
    parts = ["RETRIEVED CONTEXT:\n"]

    for chunk in retrieved_chunks[:6]:  # cap at 6 chunks to stay within context
        parts.append(f"[{chunk['id']}]")
        parts.append(chunk.get("text", "")[:600])
        parts.append("")

    parts.append("\nFEW-SHOT EXAMPLES:")
    for ex in _FEW_SHOT_EXAMPLES:
        parts.append(f'Q: {ex["question"]}')
        parts.append(f'A: {ex["answer"]}')
        parts.append("")

    parts.append(f"\nQUESTION: {question}")
    parts.append("\nGenerate the SQL now. Output only the JSON object.")

    return "\n".join(parts)


def generate_sql(question: str, retrieved_chunks: list) -> dict:
    """
    Given a user question and retrieved schema/metric chunks, generate executable SQL.

    Returns:
    {
      "sql": "SELECT ...",
      "metric_used": str | None,
      "tables_referenced": list[str],
      "reasoning": str,
      "confidence": "HIGH" | "MEDIUM" | "LOW"
    }
    """
    user_msg = _build_user_message(question, retrieved_chunks)

    response = _CLIENT.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        return {
            "sql": None,
            "metric_used": None,
            "tables_referenced": [],
            "reasoning": f"JSON parse error: {e}. Raw: {raw[:200]}",
            "confidence": "LOW",
            "error": "json_parse_failed",
        }

    return result


# ── CLI mode ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import urllib.request

    if len(sys.argv) < 2:
        print("Usage: python3 -m agents.sql_generator \"your question here\"")
        sys.exit(1)

    question = sys.argv[1]
    print(f'\nQuestion: "{question}"')
    print("Fetching context from retrieval API...")

    # Call retrieval service
    try:
        payload = json.dumps({"query": question, "k": 5}).encode()
        req = urllib.request.Request(
            "http://localhost:8001/retrieve",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            retrieval_response = json.loads(resp.read())
        chunks = retrieval_response.get("results", [])
        print(f"Retrieved {len(chunks)} chunks (confidence: {retrieval_response.get('confidence', {}).get('confidence_band', '?')})")
    except Exception as e:
        print(f"ERROR: Could not reach retrieval API at localhost:8001 — {e}")
        print("Start it with: uvicorn retriever.api_server:app --port 8001")
        sys.exit(1)

    print("Generating SQL...")
    result = generate_sql(question, chunks)
    print("\nResult:")
    print(json.dumps(result, indent=2))
