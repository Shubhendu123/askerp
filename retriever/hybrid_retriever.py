"""
AskERP — Hybrid Dense+Sparse Retriever with Cross-Encoder Reranking (Day 8)

Upgrades over naive_retriever.py:
  1. BM25 sparse retriever combined with dense via Reciprocal Rank Fusion (RRF)
  2. Cross-encoder reranking on top-10 fused results
  3. Example-question repetition in metric document text (embedding bias)
  4. Relative confidence bands from confidence.py

Do NOT modify naive_retriever.py — it stays as the Day 7 baseline.
"""

import os
import sys
import time
from typing import List, Dict, Optional

import numpy as np
import yaml
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer, CrossEncoder

from retriever.confidence import compute_confidence

# ── Paths ──────────────────────────────────────────────────────────────────────
_BASE_DIR     = os.path.join(os.path.dirname(__file__), "..")
_SCHEMA_PATH  = os.path.join(_BASE_DIR, "data", "schema.yaml")
_METRICS_PATH = os.path.join(_BASE_DIR, "data", "metrics.yaml")

for _path in (_SCHEMA_PATH, _METRICS_PATH):
    if not os.path.exists(_path):
        print(f"ERROR: Required file not found: {_path}", file=sys.stderr)
        sys.exit(1)

# RRF rank-fusion constant (standard is 60)
_RRF_K = 60


# ── Document builders ──────────────────────────────────────────────────────────

def _build_table_text(table: dict) -> str:
    cols = []
    for col in table.get("columns", []):
        desc = col.get("description", "")
        cols.append(f"{col['name']} ({desc})" if desc else col["name"])
    description = table.get("description", "")
    prefix = f"{table['name']}: {description}. " if description else f"{table['name']}: "
    return f"{prefix}Columns: {', '.join(cols)}"


def _build_metric_text(metric: dict) -> str:
    """
    Upgrade 3: Example questions are repeated with varied lead-ins so their
    business-phrasing tokens receive higher weight in the embedding.
    Synonyms are also repeated at the end as an additional boost.
    """
    name     = metric["name"]
    domain   = metric.get("domain", "")
    owner    = metric.get("definition_owner", "")
    desc     = metric.get("description", "").strip().replace("\n", " ")
    synonyms = metric.get("synonyms", [])
    examples = metric.get("example_questions", [])

    leads = [
        "Common questions users ask:",
        "Another way to ask:",
        "Also asked as:",
    ]

    parts = [f"{name} ({domain} metric, owned by {owner}): {desc}"]
    if synonyms:
        parts.append(f"Synonyms: {', '.join(synonyms)}")

    # Repeat each example question with a distinct lead-in phrase
    for i, q in enumerate(examples):
        lead = leads[i % len(leads)]
        parts.append(f"{lead} {q}")

    # Synonym repetition at end for embedding bias
    if synonyms:
        parts.append(f"Synonyms again: {', '.join(synonyms)}")

    return ". ".join(parts)


def _tokenize(text: str) -> List[str]:
    """Simple whitespace+punctuation tokenizer for BM25."""
    import re
    return re.findall(r"\w+", text.lower())


# ── Corpus builder ─────────────────────────────────────────────────────────────

def _build_corpus():
    with open(_SCHEMA_PATH) as f:
        schema = yaml.safe_load(f)
    with open(_METRICS_PATH) as f:
        metrics_config = yaml.safe_load(f)

    documents = []

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

    # ── Dense embeddings ───────────────────────────────────────────────────────
    t0 = time.time()
    texts = [doc["text"] for doc in documents]
    embeddings = _DENSE_MODEL.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    embeddings = embeddings.astype(np.float32)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True).astype(np.float32)
    embeddings = embeddings / np.where(norms > 1e-6, norms, 1.0)
    embeddings = np.nan_to_num(embeddings, nan=0.0, posinf=0.0, neginf=0.0)
    t_dense = time.time() - t0

    # ── BM25 index ─────────────────────────────────────────────────────────────
    t1 = time.time()
    tokenized = [_tokenize(t) for t in texts]
    bm25 = BM25Okapi(tokenized)
    t_bm25 = time.time() - t1

    print(
        f"Loaded embedding model. Embedded {n_tables} tables and {n_metrics} metrics "
        f"({len(documents)} documents) in {t_dense:.3f}s (dense) + {t_bm25:.3f}s (BM25)."
    )
    return documents, embeddings, bm25


# ── Load models at import time ─────────────────────────────────────────────────
_DENSE_MODEL   = SentenceTransformer("all-MiniLM-L6-v2")
_RERANK_MODEL  = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
print("Loaded reranker model: ms-marco-MiniLM-L-6-v2")

_DOCUMENTS, _EMBEDDINGS, _BM25 = _build_corpus()


# ── RRF fusion ─────────────────────────────────────────────────────────────────

def _rrf_fuse(dense_ids: List[int], bm25_ids: List[int]) -> List[int]:
    """
    Reciprocal Rank Fusion.
    score(doc) = sum_over_retrievers( 1 / (RRF_K + rank) )
    rank is 1-indexed; documents not in a retriever's list get rank = inf → 0.
    Returns doc indices sorted by fused score descending.
    """
    scores: Dict[int, float] = {}
    for rank, doc_idx in enumerate(dense_ids, start=1):
        scores[doc_idx] = scores.get(doc_idx, 0.0) + 1.0 / (_RRF_K + rank)
    for rank, doc_idx in enumerate(bm25_ids, start=1):
        scores[doc_idx] = scores.get(doc_idx, 0.0) + 1.0 / (_RRF_K + rank)
    return sorted(scores, key=lambda i: scores[i], reverse=True)


# ── Main retrieve function ─────────────────────────────────────────────────────

def retrieve(
    query: str,
    k: int = 5,
    metadata_filter: Optional[Dict] = None,
) -> List[Dict]:
    """
    Hybrid retrieval pipeline:
      1. Dense top-10 (cosine similarity)
      2. BM25 top-10
      3. RRF fusion → top-20
      4. Cross-encoder reranking → top-10
      5. Apply metadata filter, return top-k

    Returns list of dicts: id, type, name, score (cross-encoder), text (200 chars),
    metadata, confidence (from compute_confidence).
    """
    if not query or not query.strip():
        return []

    candidate_pool = list(range(len(_DOCUMENTS)))

    # Apply metadata filter before retrieval if supplied
    if metadata_filter:
        candidate_pool = [
            i for i in candidate_pool
            if all(
                _DOCUMENTS[i]["metadata"].get(fk) == fv
                for fk, fv in metadata_filter.items()
            )
        ]
        if not candidate_pool:
            return []

    pool_size = len(candidate_pool)
    fetch_k   = min(10, pool_size)

    # ── Step 1: Dense retrieval ────────────────────────────────────────────────
    q_emb = _DENSE_MODEL.encode([query], convert_to_numpy=True, show_progress_bar=False)[0].astype(np.float32)
    q_norm = float(np.linalg.norm(q_emb))
    if q_norm > 1e-6:
        q_emb = q_emb / q_norm

    pool_emb = _EMBEDDINGS[candidate_pool].astype(np.float32)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        dense_scores = pool_emb @ q_emb
    dense_scores = np.nan_to_num(dense_scores, nan=0.0, posinf=0.0, neginf=0.0)
    dense_local  = np.argsort(dense_scores)[::-1][:fetch_k].tolist()
    dense_ids    = [candidate_pool[i] for i in dense_local]

    # ── Step 2: BM25 retrieval ─────────────────────────────────────────────────
    query_tokens = _tokenize(query)
    if query_tokens:
        bm25_all = _BM25.get_scores(query_tokens)
        pool_bm25 = [(i, bm25_all[i]) for i in candidate_pool]
        pool_bm25.sort(key=lambda x: x[1], reverse=True)
        bm25_ids = [i for i, _ in pool_bm25[:fetch_k]]
    else:
        bm25_ids = []

    # ── Step 3: RRF fusion ─────────────────────────────────────────────────────
    fused_ids = _rrf_fuse(dense_ids, bm25_ids)[:min(10, pool_size)]

    # ── Step 4: Cross-encoder reranking ───────────────────────────────────────
    pairs = [(query, _DOCUMENTS[i]["text"]) for i in fused_ids]
    raw_ce = _RERANK_MODEL.predict(pairs)
    # Sigmoid-normalise logits → [0, 1] so confidence bands are calibrated
    ce_scores = (1.0 / (1.0 + np.exp(-raw_ce))).tolist()

    ranked = sorted(zip(fused_ids, ce_scores), key=lambda x: x[1], reverse=True)
    top_k  = ranked[:k]

    # ── Step 5: Build results + confidence ────────────────────────────────────
    sorted_scores = [s for _, s in top_k]
    conf = compute_confidence(sorted_scores)

    results = []
    for doc_idx, score in top_k:
        doc = _DOCUMENTS[doc_idx]
        results.append({
            "id":         doc["id"],
            "type":       doc["type"],
            "name":       doc["name"],
            "score":      round(float(score), 4),
            "text":       doc["text"][:200],
            "metadata":   doc["metadata"],
            "confidence": conf,
        })
    return results


# ── CLI ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 -m retriever.hybrid_retriever \"<question>\"")
        sys.exit(1)

    query   = sys.argv[1]
    results = retrieve(query, k=5)

    print(f'\nQuery: "{query}"')
    if not results:
        print("  No results.")
        sys.exit(0)

    conf = results[0]["confidence"]
    print(f"Confidence: {conf['confidence_band']} "
          f"(top1={conf['top1_absolute']:.3f}, gap={conf['top1_minus_top2_gap']:.3f})")
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
