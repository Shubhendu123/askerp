"""
AskERP — Retrieval API Server (Day 9)
FastAPI service wrapping hybrid_retriever. Keeps embedding model warm.
Run with: uvicorn retriever.api_server:app --port 8001
"""

import time
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

from retriever.hybrid_retriever import retrieve, _DOCUMENTS, _DENSE_MODEL, _RERANK_MODEL

app = FastAPI(title="AskERP Retrieval API", version="1.0")


class RetrieveRequest(BaseModel):
    query: str
    k: int = 5
    metadata_filter: Optional[dict] = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "all-MiniLM-L6-v2",
        "reranker": "ms-marco-MiniLM-L-6-v2",
        "documents": len(_DOCUMENTS),
    }


@app.post("/retrieve")
def retrieve_endpoint(req: RetrieveRequest):
    if not req.query and req.query != "":
        raise HTTPException(status_code=400, detail="query is required")

    t0 = time.time()
    results = retrieve(req.query, k=req.k, metadata_filter=req.metadata_filter)
    retrieval_time_ms = (time.time() - t0) * 1000

    # Expand text to 500 chars for API consumers
    formatted = []
    for r in results:
        from retriever.hybrid_retriever import _DOCUMENTS as docs
        full_doc = next((d for d in docs if d["id"] == r["id"]), None)
        full_text = full_doc["text"][:500] if full_doc else r["text"]
        formatted.append({
            "id":       r["id"],
            "type":     r["type"],
            "name":     r["name"],
            "score":    r["score"],
            "text":     full_text,
            "metadata": r["metadata"],
        })

    confidence = results[0]["confidence"] if results else {
        "top1_absolute": 0.0,
        "top1_minus_top2_gap": 0.0,
        "top1_to_top5_avg_ratio": 0.0,
        "confidence_band": "VERY_LOW",
    }

    return {
        "results": formatted,
        "confidence": confidence,
        "retrieval_time_ms": round(retrieval_time_ms, 2),
    }
