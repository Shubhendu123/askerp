"""
AskERP — Naive Dense Retriever (Day 7)

Loads schema.yaml and metrics.yaml, builds an in-memory document corpus,
embeds all documents using all-MiniLM-L6-v2, and exposes a retrieve()
function for downstream agents.

Chunking strategy: one chunk per table, one chunk per metric.
Chunk = one queryable concept (table or metric). Per-column chunks would let
retrieval mix columns across tables, breaking schema integrity. Per-table is
the right granularity for schema RAG.
"""

import os
import sys
import time
from typing import List, Dict, Optional

import numpy as np
import yaml
from sentence_transformers import SentenceTransformer

# ── Paths ──────────────────────────────────────────────────────────────────────
_BASE_DIR    = os.path.join(os.path.dirname(__file__), "..")
_SCHEMA_PATH  = os.path.join(_BASE_DIR, "data", "schema.yaml")
_METRICS_PATH = os.path.join(_BASE_DIR, "data", "metrics.yaml")

# ── Verify required files ──────────────────────────────────────────────────────
for _path in (_SCHEMA_PATH, _METRICS_PATH):
    if not os.path.exists(_path):
        print(f"ERROR: Required file not found: {_path}", file=sys.stderr)
        sys.exit(1)


def _build_table_text(table: dict) -> str:
    """Format a table definition into an embeddable text chunk."""
    cols = []
    for col in table.get("columns", []):
        desc = col.get("description", "")
        cols.append(f"{col['name']} ({desc})" if desc else col["name"])
    col_str = ", ".join(cols)
    description = table.get("description", "")
    prefix = f"{table['name']}: {description}. " if description else f"{table['name']}: "
    return f"{prefix}Columns: {col_str}"


def _build_metric_text(metric: dict) -> str:
    """Format a metric definition into an embeddable text chunk."""
    name    = metric["name"]
    domain  = metric.get("domain", "")
    owner   = metric.get("definition_owner", "")
    desc    = metric.get("description", "").strip().replace("\n", " ")
    synonyms = metric.get("synonyms", [])
    examples = metric.get("example_questions", [])

    parts = [f"{name} ({domain} metric, owned by {owner}): {desc}"]
    if synonyms:
        parts.append(f"Synonyms: {', '.join(synonyms)}")
    if examples:
        parts.append(f"Example questions: {'; '.join(examples)}")
    return ". ".join(parts)


def _build_corpus() -> tuple[list, np.ndarray]:
    """Build document list and embedding matrix from YAML files."""
    with open(_SCHEMA_PATH) as f:
        schema = yaml.safe_load(f)
    with open(_METRICS_PATH) as f:
        metrics_config = yaml.safe_load(f)

    documents = []

    # ── Table chunks ───────────────────────────────────────────────────────────
    for table in schema.get("tables", []):
        tname = table["name"]
        table_type = "fact" if tname.startswith("fact_") else "dim"
        documents.append({
            "id":   f"table:{tname}",
            "type": "table",
            "name": tname,
            "text": _build_table_text(table),
            "metadata": {
                "domain":     None,
                "owner":      None,
                "table_type": table_type,
            },
        })

    n_tables = len(documents)

    # ── Metric chunks ──────────────────────────────────────────────────────────
    for metric in metrics_config.get("metrics", []):
        documents.append({
            "id":   f"metric:{metric['name']}",
            "type": "metric",
            "name": metric["name"],
            "text": _build_metric_text(metric),
            "metadata": {
                "domain":     metric.get("domain"),
                "owner":      str(metric.get("definition_owner", "")),
                "table_type": None,
            },
        })

    n_metrics = len(documents) - n_tables

    # ── Embed ──────────────────────────────────────────────────────────────────
    t0 = time.time()
    texts = [doc["text"] for doc in documents]
    embeddings = _MODEL.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    embeddings = embeddings.astype(np.float32)
    # L2-normalise so cosine similarity = dot product
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True).astype(np.float32)
    embeddings = embeddings / np.where(norms > 1e-6, norms, 1.0)
    elapsed = time.time() - t0

    print(
        f"Loaded embedding model. Embedded {n_tables} tables and {n_metrics} metrics "
        f"({len(documents)} documents) in {elapsed:.3f}s."
    )
    return documents, embeddings


# ── Load model and corpus at module import time ────────────────────────────────
_MODEL      = SentenceTransformer("all-MiniLM-L6-v2")
_DOCUMENTS, _EMBEDDINGS = _build_corpus()


def retrieve(
    query: str,
    k: int = 5,
    metadata_filter: Optional[Dict] = None,
) -> List[Dict]:
    """
    Embed the query, compute cosine similarity against all document embeddings,
    return top-k after optional metadata filtering.

    metadata_filter is a dict like {"type": "metric", "domain": "Revenue"}.
    If provided, only documents matching ALL filter keys are considered before ranking.

    Returns list of dicts with keys: id, type, name, score, text, metadata.
    'text' is truncated to 200 chars in the return for readability.
    """
    if not query or not query.strip():
        return []

    # Embed and normalise query
    q_emb = _MODEL.encode([query], convert_to_numpy=True, show_progress_bar=False)[0].astype(np.float32)
    q_norm = float(np.linalg.norm(q_emb))
    if q_norm > 1e-6:
        q_emb = q_emb / q_norm

    # Apply metadata filter to get candidate indices
    if metadata_filter:
        candidates = [
            i for i, doc in enumerate(_DOCUMENTS)
            if all(doc["metadata"].get(fk) == fv for fk, fv in metadata_filter.items())
        ]
        if not candidates:
            return []
        emb_matrix = _EMBEDDINGS[candidates]
        scores     = emb_matrix @ q_emb
        top_local  = np.argsort(scores)[::-1][:k]
        top_indices = [candidates[i] for i in top_local]
        top_scores  = scores[top_local]
    else:
        scores     = _EMBEDDINGS @ q_emb
        top_idx    = np.argsort(scores)[::-1][:k]
        top_indices = top_idx.tolist()
        top_scores  = scores[top_idx]

    results = []
    for idx, score in zip(top_indices, top_scores):
        doc = _DOCUMENTS[idx]
        results.append({
            "id":       doc["id"],
            "type":     doc["type"],
            "name":     doc["name"],
            "score":    float(score),
            "text":     doc["text"][:200],
            "metadata": doc["metadata"],
        })
    return results


# ── CLI ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 -m retriever.naive_retriever \"<question>\"")
        sys.exit(1)

    query = sys.argv[1]
    results = retrieve(query, k=5)

    print(f'\nQuery: "{query}"')
    print("Top 5 retrievals:")
    for i, r in enumerate(results, 1):
        meta = r["metadata"]
        tag  = (
            f"{meta['domain']} / {meta['owner']}"
            if r["type"] == "metric"
            else meta["table_type"]
        )
        print(f"  {i}. [score={r['score']:.3f}] {r['id']} ({tag})")
        print(f"     {r['text']}")
