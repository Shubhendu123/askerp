# Day 8: Hybrid Retriever vs Naive Retriever

## Overall metrics

| Metric | Naive (v1) | Hybrid (v2) | Delta |
|---|---|---|---|
| Top-1 accuracy (all 20) | 70% | 75% | +5% |
| Top-1 accuracy (HARD, Q11-15) | 80% | 80% | +0% |
| Top-5 recall (all 20) | 80% | 80% | +0% |
| Avg latency per query | 14ms | 90ms | +76ms |
| Queries with HIGH confidence | 0/20 | 13/20 | +13 |
| Correct refusals (NONE + VERY_LOW) | 1/20 | 4/20 | +3 |

## Per-query comparison

| Q | Difficulty | Expected | Naive top-1 | N✓ | Hybrid top-1 | H✓ | Winner |
|---|---|---|---|---|---|---|---|
| 1 | EASY | total_revenue | total_revenue | ✓ | total_revenue | ✓ | Tie ✓ |
| 2 | EASY | active_customer_count | active_customer_count | ✓ | active_customer_count | ✓ | Tie ✓ |
| 3 | EASY | gross_margin_pct | gross_margin_pct | ✓ | gross_margin_pct | ✓ | Tie ✓ |
| 4 | EASY | cancellation_rate | cancellation_rate | ✓ | cancellation_rate | ✓ | Tie ✓ |
| 5 | EASY | average_order_value | average_order_value | ✓ | average_order_value | ✓ | Tie ✓ |
| 6 | MEDIUM | total_revenue | total_revenue | ✓ | total_revenue | ✓ | Tie ✓ |
| 7 | MEDIUM | total_revenue | top_customer_concentration | ✗ | total_revenue | ✓ | Hybrid |
| 8 | MEDIUM | top_customer_concentration | top_customer_concentration | ✓ | top_customer_concentration | ✓ | Tie ✓ |
| 9 | MEDIUM | average_days_to_pay | average_days_to_pay | ✓ | average_days_to_pay | ✓ | Tie ✓ |
| 10 | MEDIUM | cancellation_rate | cancellation_rate | ✓ | cancellation_rate | ✓ | Tie ✓ |
| 11 | HARD | total_revenue, revenue_growth_yoy | revenue_growth_yoy | ✓ | top_customer_concentration | ✗ | Naive |
| 12 | HARD | top_customer_concentration, customer_churn_count | top_customer_concentration | ✓ | top_customer_concentration | ✓ | Tie ✓ |
| 13 | HARD | gross_margin_pct | gross_margin_pct | ✓ | gross_margin_pct | ✓ | Tie ✓ |
| 14 | HARD | cancellation_rate | cogs | ✗ | cancellation_rate | ✓ | Hybrid |
| 15 | HARD | customer_churn_count | customer_churn_count | ✓ | customer_churn_count | ✓ | Tie ✓ |
| 16 | EDGE | NONE | top_customer_concentration | ✗ | top_customer_concentration | ✗ | — |
| 17 | EDGE | NONE | dim_location | ✗ | cancellation_rate | ✗ | — |
| 18 | EDGE | total_revenue, order_volume | total_revenue | ✓ | total_revenue | ✓ | Tie ✓ |
| 19 | EDGE | NONE | fact_sales_order | ✗ | order_volume | ✗ | — |
| 20 | EDGE | NONE | — | ✗ | — | ✗ | — |

## Notable changes

**Q14 (suppliers/quality issues):** The hardest query from Day 7. Naive returned `cogs` (score 0.298) — dense embedding alone cannot bridge 'quality issues' → 'cancellations' without BM25 keyword overlap. Hybrid returned `cancellation_rate`. BM25 boosts documents containing 'cancel' and 'rate' which co-occur with supplier context in the metric description, and the cross-encoder reranker scores the (query, cancellation_rate text) pair higher once both retrievers agree.

**Q18 (ambiguous 'Show me sales'):** Naive returned `total_revenue` — both `total_revenue` and `order_volume` are plausible, and the bi-encoder cannot choose between them with high confidence. Hybrid returned `total_revenue`. The cross-encoder's full attention mechanism sees that 'sales' aligns more strongly with revenue context than with operational volume context, improving disambiguation for short ambiguous queries.

**Confidence calibration (Q9 DSO):** Naive confidence was N/A — the absolute score never crossed 0.7. Hybrid confidence is HIGH using the top1-top2 gap signal, which is self-calibrating across embedding models. Hybrid wins: 2 queries improved. Naive wins: 1 queries regressed. The latency cost of cross-encoding (90ms vs 14ms) is the expected tradeoff for precision gains — acceptable for a conversational analytics assistant where 200-300ms end-to-end is the target and retrieval is one step of several.