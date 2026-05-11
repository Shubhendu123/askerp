"""
AskERP — Relative Confidence Helpers (Day 8)

Computes self-calibrating confidence bands from a list of retrieval scores.
Uses top1-top2 gap rather than absolute thresholds so the bands work across
different embedding/reranking models without manual retuning.
"""

from typing import List


def compute_confidence(scores: List[float]) -> dict:
    """
    Given a sorted list of retrieval scores (descending), compute relative
    confidence signals.

    Returns:
        {
          "top1_absolute": float,
          "top1_minus_top2_gap": float,
          "top1_to_top5_avg_ratio": float,
          "confidence_band": "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW"
        }

    Confidence bands:
      HIGH     : gap >= 0.15 AND top1 >= 0.3
      MEDIUM   : gap >= 0.08 AND top1 >= 0.2
      LOW      : gap >= 0.03 OR  top1 >= 0.15
      VERY_LOW : anything else (interpret as "I don't know")
    """
    if not scores:
        return {
            "top1_absolute": 0.0,
            "top1_minus_top2_gap": 0.0,
            "top1_to_top5_avg_ratio": 0.0,
            "confidence_band": "VERY_LOW",
        }

    top1 = float(scores[0])
    top2 = float(scores[1]) if len(scores) > 1 else 0.0
    gap  = top1 - top2

    avg_top5 = sum(float(s) for s in scores[:5]) / min(len(scores), 5)
    ratio    = top1 / avg_top5 if avg_top5 > 0 else 0.0

    if gap >= 0.15 and top1 >= 0.3:
        band = "HIGH"
    elif gap >= 0.08 and top1 >= 0.2:
        band = "MEDIUM"
    elif gap >= 0.03 or top1 >= 0.15:
        band = "LOW"
    else:
        band = "VERY_LOW"

    return {
        "top1_absolute": round(top1, 4),
        "top1_minus_top2_gap": round(gap, 4),
        "top1_to_top5_avg_ratio": round(ratio, 4),
        "confidence_band": band,
    }
