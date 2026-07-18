# AskERP Retrieval Benchmark — REPORT (D-036)

> **Historical record.** Entity names below (e.g. "Supplier 097", "Customer 059") reflect the pre-D-038 placeholder naming scheme and are frozen as generated on 2026-07-17 — not updated to the realistic names introduced by D-038. Numeric results, scores, and findings are unaffected (D-038 only touched name columns).

Generated 2026-07-17 from `benchmark/results.jsonl` (160 runs). Model: `claude-haiku-4-5-20251001` for all modes. Tenant: mro (46-doc corpus: 20 tables + 26 metrics). Retrieval top-k: 5.

Modes: `bm25` (BM25 only), `dense` (Voyage dense only), `rrf` (production hybrid), `schema` (no retrieval; full tenant corpus in prompt — R-score N/A, context size counted instead).

## Scoring rubric (mechanical)

R: 0 none / 1 domain-only / 2 partial tables / 3 all tables / 4 correct metric (carries tables+grain+join in-chunk per D-033) / 5 = 4 + no irrelevant chunks. A: 0 fail / 1 wrong / 2 >=50% matched or wrong grain / 3 all ground-truth values matched (1% tolerance, entity+value matching for multi-row answers).

## Per-tier aggregates by mode

| Tier | Mode | n | mean R | mean A | SQL valid % | tokens in | cost $ |
|---|---|---|---|---|---|---|---|
| S | bm25 | 10 | 4.10 | 2.80 | 100% | 16,560 | 0.020 |
| S | dense | 10 | 4.30 | 2.80 | 100% | 18,474 | 0.022 |
| S | rrf | 10 | 4.30 | 3.00 | 100% | 17,526 | 0.021 |
| S | schema | 10 | N/A | 3.00 | 100% | 153,974 | 0.158 |
| M | bm25 | 12 | 4.17 | 2.00 | 83% | 22,735 | 0.031 |
| M | dense | 12 | 4.17 | 2.25 | 92% | 24,301 | 0.033 |
| M | rrf | 12 | 4.17 | 2.08 | 92% | 22,943 | 0.031 |
| M | schema | 12 | N/A | 2.17 | 83% | 184,828 | 0.193 |
| H | bm25 | 14 | 4.07 | 0.29 | 21% | 26,293 | 0.048 |
| H | dense | 14 | 4.57 | 1.21 | 64% | 32,012 | 0.062 |
| H | rrf | 14 | 4.43 | 0.71 | 36% | 31,598 | 0.064 |
| H | schema | 14 | N/A | 0.79 | 50% | 184,929 | 0.213 |
| **all** | bm25 | 36 | 4.11 | 1.56 | 64% | 65,588 | 0.099 |
| **all** | dense | 36 | 4.36 | 2.00 | 83% | 74,787 | 0.117 |
| **all** | rrf | 36 | 4.31 | 1.81 | 72% | 72,067 | 0.116 |
| **all** | schema | 36 | N/A | 1.86 | 75% | 523,731 | 0.564 |

## Controls (C01-C04)

| Control | Mode | Pass | Note |
|---|---|---|---|
| C01 | bm25 | PASS | cross-tenant chunks: 0; answered from mro data |
| C01 | dense | PASS | cross-tenant chunks: 0; answered from mro data |
| C01 | rrf | PASS | cross-tenant chunks: 0; answered from mro data |
| C01 | schema | PASS | cross-tenant chunks: 0; refused |
| C02 | bm25 | PASS | cross-tenant: 0; refused |
| C02 | dense | PASS | cross-tenant: 0; refused |
| C02 | rrf | PASS | cross-tenant: 0; refused |
| C02 | schema | PASS | cross-tenant: 0; refused |
| C03 | bm25 | PASS | refused |
| C03 | dense | PASS | refused |
| C03 | rrf | PASS | refused |
| C03 | schema | PASS | refused |
| C04 | bm25 | PASS | refused |
| C04 | dense | PASS | refused |
| C04 | rrf | PASS | refused |
| C04 | schema | PASS | refused |

## Headline findings

- **rrf does NOT beat schema-in-prompt on H-tier**: mean A 0.71 vs 0.79. Top-5 retrieval can miss tables a hard multi-subject-area query needs, while the full corpus always contains them — the honest read is that at 46 docs, retrieval trades answer completeness for a 6x smaller prompt.
- Token economics: schema mode consumed 585,325 input tokens vs 78,632 for rrf across the same questions — ~7x. At 46 docs the whole corpus still fits in prompt; retrieval is the architecture that survives corpus growth, not (yet) the cost winner on quality.
- H-tier retrieval quality: bm25 4.07, dense 4.57, rrf 4.43 (best: dense).
- S-tier (single-metric) answers: bm25 2.80, dense 2.80, rrf 3.00, schema 3.00 — direct metric lookups are largely solved by every mode; the corpus actionability fields (formula in-chunk) do the work.
- Controls: 16/16 passed. Zero cross-tenant chunks in every retrieval run (D-035 isolation held under benchmark load).
- H-tier SQL validity: bm25 21%, dense 64%, rrf 36%, schema 50%.

## Per-question results

| ID | Mode | R | A | SQL valid | Tokens in/out | Latency ms (retr+llm) | Notes |
|---|---|---|---|---|---|---|---|
| S01 | bm25 | 4 | 3 | Y | 1473/30 | 7869+1174 |  |
| S01 | dense | 4 | 3 | Y | 2088/30 | 366+1014 |  |
| S01 | rrf | 4 | 3 | Y | 1593/30 | 307+1008 |  |
| S01 | schema | N/A | 3 | Y | 15396/30 | 0+1163 |  |
| S02 | bm25 | 4 | 3 | Y | 1650/44 | 1+1401 |  |
| S02 | dense | 4 | 3 | Y | 2021/44 | 295+1409 |  |
| S02 | rrf | 4 | 3 | Y | 1687/44 | 303+1224 |  |
| S02 | schema | N/A | 3 | Y | 15397/44 | 0+1283 |  |
| S03 | bm25 | 4 | 3 | Y | 1634/46 | 1+1329 |  |
| S03 | dense | 4 | 3 | Y | 1955/46 | 297+1330 |  |
| S03 | rrf | 4 | 3 | Y | 1723/46 | 311+1742 |  |
| S03 | schema | N/A | 3 | Y | 15398/46 | 0+1781 |  |
| S04 | bm25 | 4 | 3 | Y | 1767/117 | 1+2558 |  |
| S04 | dense | 5 | 3 | Y | 1790/125 | 407+1427 |  |
| S04 | rrf | 5 | 3 | Y | 1780/117 | 320+1772 |  |
| S04 | schema | N/A | 3 | Y | 15397/125 | 0+2552 |  |
| S05 | bm25 | 4 | 3 | Y | 1708/231 | 2+1823 |  |
| S05 | dense | 4 | 3 | Y | 2368/231 | 305+2315 |  |
| S05 | rrf | 5 | 3 | Y | 2390/231 | 301+3697 |  |
| S05 | schema | N/A | 3 | Y | 15397/243 | 0+3437 |  |
| S06 | bm25 | 4 | 3 | Y | 1633/44 | 1+1206 |  |
| S06 | dense | 4 | 3 | Y | 1471/44 | 290+1135 |  |
| S06 | rrf | 4 | 3 | Y | 1633/44 | 409+1150 |  |
| S06 | schema | N/A | 3 | Y | 15398/44 | 1+1935 |  |
| S07 | bm25 | 4 | 1 | Y | 1711/81 | 1+1237 |  |
| S07 | dense | 5 | 1 | Y | 1749/89 | 294+1274 |  |
| S07 | rrf | 4 | 3 | Y | 1728/44 | 307+1160 |  |
| S07 | schema | N/A | 3 | Y | 15398/44 | 0+1415 |  |
| S08 | bm25 | 5 | 3 | Y | 1813/65 | 2+1221 |  |
| S08 | dense | 5 | 3 | Y | 1836/65 | 294+1146 |  |
| S08 | rrf | 5 | 3 | Y | 1813/65 | 425+1336 |  |
| S08 | schema | N/A | 3 | Y | 15400/65 | 0+1599 |  |
| S09 | bm25 | 4 | 3 | Y | 1486/58 | 1+2146 |  |
| S09 | dense | 4 | 3 | Y | 1494/58 | 310+1579 |  |
| S09 | rrf | 4 | 3 | Y | 1494/58 | 311+1451 |  |
| S09 | schema | N/A | 3 | Y | 15397/61 | 0+1594 |  |
| S10 | bm25 | 4 | 3 | Y | 1685/54 | 1+1582 |  |
| S10 | dense | 4 | 3 | Y | 1702/54 | 299+1175 |  |
| S10 | rrf | 4 | 3 | Y | 1685/53 | 314+1085 |  |
| S10 | schema | N/A | 3 | Y | 15396/54 | 0+1414 |  |
| M01 | bm25 | 4 | 1 | Y | 1804/139 | 1+1571 |  |
| M01 | dense | 4 | 1 | Y | 2183/140 | 407+2488 |  |
| M01 | rrf | 4 | 1 | Y | 1804/154 | 300+1758 |  |
| M01 | schema | N/A | 3 | Y | 15400/119 | 0+1672 |  |
| M02 | bm25 | 4 | 3 | Y | 1707/99 | 2+1626 |  |
| M02 | dense | 4 | 3 | Y | 1729/100 | 303+1606 |  |
| M02 | rrf | 4 | 3 | Y | 1622/102 | 305+1480 |  |
| M02 | schema | N/A | 3 | Y | 15405/96 | 0+1678 |  |
| M03 | bm25 | 5 | 3 | Y | 2760/112 | 1+1485 |  |
| M03 | dense | 4 | 3 | Y | 2699/113 | 404+1432 |  |
| M03 | rrf | 4 | 3 | Y | 2699/112 | 308+1660 |  |
| M03 | schema | N/A | 3 | Y | 15406/112 | 0+1967 |  |
| M04 | bm25 | 5 | 3 | Y | 2799/111 | 1+1535 |  |
| M04 | dense | 5 | 3 | Y | 2432/111 | 297+1703 |  |
| M04 | rrf | 5 | 3 | Y | 2799/111 | 314+1804 |  |
| M04 | schema | N/A | 3 | Y | 15402/105 | 1+1628 |  |
| M05 | bm25 | 4 | 3 | Y | 1510/71 | 1+1133 |  |
| M05 | dense | 3 | 3 | Y | 1997/77 | 297+1486 |  |
| M05 | rrf | 4 | 3 | Y | 1987/71 | 398+1466 |  |
| M05 | schema | N/A | 3 | Y | 15396/63 | 0+1479 |  |
| M06 | bm25 | 4 | 1 | Y | 1834/142 | 1+3495 |  |
| M06 | dense | 5 | 3 | Y | 1625/134 | 304+1380 |  |
| M06 | rrf | 5 | 1 | Y | 1625/139 | 407+1861 |  |
| M06 | schema | N/A | 1 | Y | 15398/125 | 0+1772 |  |
| M07 | bm25 | 4 | 0 | N | 1591/127 | 0+1514 | Error: Binder Error: Ambiguous reference to column name "cus |
| M07 | dense | 4 | 0 | N | 1591/127 | 298+2386 | Error: Binder Error: Ambiguous reference to column name "cus |
| M07 | rrf | 4 | 0 | N | 1591/127 | 305+1768 | Error: Binder Error: Ambiguous reference to column name "cus |
| M07 | schema | N/A | 0 | N | 15402/124 | 1+1755 | Error: Binder Error: Ambiguous reference to column name "cus |
| M08 | bm25 | 4 | 3 | Y | 1971/136 | 1+1795 |  |
| M08 | dense | 4 | 3 | Y | 2674/127 | 296+1930 |  |
| M08 | rrf | 4 | 3 | Y | 2075/135 | 327+1413 |  |
| M08 | schema | N/A | 3 | Y | 15401/135 | 0+2868 |  |
| M09 | bm25 | 4 | 3 | Y | 1615/198 | 0+3845 |  |
| M09 | dense | 4 | 1 | Y | 1808/173 | 296+1984 |  |
| M09 | rrf | 4 | 1 | Y | 1808/173 | 309+3012 |  |
| M09 | schema | N/A | 3 | Y | 15406/188 | 0+2316 |  |
| M10 | bm25 | 4 | 1 | Y | 1963/245 | 1+2331 |  |
| M10 | dense | 4 | 1 | Y | 2317/244 | 320+2252 |  |
| M10 | rrf | 4 | 1 | Y | 1694/247 | 311+2448 |  |
| M10 | schema | N/A | 1 | Y | 15407/290 | 0+3092 |  |
| M11 | bm25 | 4 | 3 | Y | 1537/95 | 1+2771 |  |
| M11 | dense | 5 | 3 | Y | 1609/128 | 304+1308 |  |
| M11 | rrf | 4 | 3 | Y | 1501/87 | 301+1656 |  |
| M11 | schema | N/A | 3 | Y | 15405/95 | 0+2680 |  |
| M12 | bm25 | 4 | 0 | N | 1644/178 | 1+2075 | Error: Catalog Error: Table with name mst_warehouse does not |
| M12 | dense | 4 | 3 | Y | 1637/181 | 323+2623 |  |
| M12 | rrf | 4 | 3 | Y | 1738/181 | 299+2048 |  |
| M12 | schema | N/A | 0 | N | 15400/175 | 0+2130 | Error: Binder Error: Ambiguous reference to column name "war |
| H01 | bm25 | 4 | 0 | N | 2223/722 | 0+5084 | Error: query timeout (30s) |
| H01 | dense | 4 | 0 | N | 2336/107 | 639+2940 | refused |
| H01 | rrf | 4 | 0 | N | 2349/897 | 301+5441 | Error: query timeout (30s) |
| H01 | schema | N/A | 1 | Y | 15408/677 | 1+4919 |  |
| H02 | bm25 | 4 | 0 | N | 1872/512 | 1+3279 | Error: query timeout (30s) |
| H02 | dense | 4 | 1 | Y | 2501/431 | 299+3831 |  |
| H02 | rrf | 4 | 0 | N | 2477/496 | 381+3974 | Error: query timeout (30s) |
| H02 | schema | N/A | 0 | N | 15412/126 | 1+3281 | refused |
| H03 | bm25 | 4 | 0 | N | 1689/254 | 1+4525 | Error: query timeout (30s) |
| H03 | dense | 4 | 1 | Y | 2330/357 | 340+2756 |  |
| H03 | rrf | 4 | 0 | N | 1596/239 | 540+2171 | Error: query timeout (30s) |
| H03 | schema | N/A | 1 | Y | 15402/361 | 0+3151 |  |
| H04 | bm25 | 4 | 0 | N | 1776/239 | 0+3145 | Error: query timeout (30s) |
| H04 | dense | 5 | 3 | Y | 1861/342 | 401+3978 |  |
| H04 | rrf | 4 | 0 | N | 1867/292 | 372+2344 | Error: query timeout (30s) |
| H04 | schema | N/A | 3 | Y | 15407/422 | 0+3723 |  |
| H05 | bm25 | 4 | 0 | N | 0/0 | 0+32932 | Error: Request timed out. |
| H05 | dense | 5 | 0 | N | 1781/66 | 366+2787 | refused |
| H05 | rrf | 4 | 0 | N | 1846/415 | 45157+3584 | Error: Binder Error: Table "i" does not have a column named  |
| H05 | schema | N/A | 1 | Y | 15406/288 | 0+3177 |  |
| H06 | bm25 | 4 | 1 | Y | 1684/586 | 1+30568 |  |
| H06 | dense | 5 | 3 | Y | 1687/567 | 345+3653 |  |
| H06 | rrf | 5 | 3 | Y | 1687/494 | 371+3107 |  |
| H06 | schema | N/A | 3 | Y | 15416/572 | 0+3970 |  |
| H07 | bm25 | 4 | 1 | Y | 2455/311 | 2+4578 |  |
| H07 | dense | 5 | 3 | Y | 2302/547 | 977+3707 |  |
| H07 | rrf | 5 | 3 | Y | 2302/545 | 322+3632 |  |
| H07 | schema | N/A | 0 | N | 15409/379 | 0+2927 | Error: query timeout (30s) |
| H08 | bm25 | 4 | 0 | N | 2469/700 | 0+4173 | Error: Binder Error: Ambiguous reference to column name "ite |
| H08 | dense | 5 | 1 | Y | 2370/670 | 345+8000 |  |
| H08 | rrf | 4 | 1 | Y | 2424/747 | 313+4564 |  |
| H08 | schema | N/A | 0 | N | 15409/678 | 1+8971 | Error: query timeout (30s) |
| H09 | bm25 | 4 | 0 | N | 1534/129 | 1+2892 | refused |
| H09 | dense | 5 | 2 | Y | 2368/405 | 381+2986 |  |
| H09 | rrf | 4 | 0 | N | 2299/411 | 572+3176 | Error: Binder Error: Referenced table "tier_d_o2c" not found |
| H09 | schema | N/A | 0 | N | 15415/141 | 0+2370 | Error: query timeout (30s) |
| H10 | bm25 | 4 | 0 | N | 2392/78 | 1+2059 | refused |
| H10 | dense | 5 | 0 | N | 2346/130 | 323+2874 | refused |
| H10 | rrf | 5 | 0 | N | 2836/70 | 319+2510 | refused |
| H10 | schema | N/A | 0 | N | 15411/734 | 1+4919 | Error: query timeout (30s) |
| H11 | bm25 | 5 | 2 | Y | 2327/327 | 0+2932 |  |
| H11 | dense | 4 | 2 | Y | 2351/385 | 300+2661 |  |
| H11 | rrf | 5 | 2 | Y | 2327/326 | 405+3173 |  |
| H11 | schema | N/A | 0 | N | 0/0 | 1+32801 | Error: Request timed out. |
| H12 | bm25 | 4 | 0 | N | 1509/70 | 1+2277 | refused |
| H12 | dense | 5 | 0 | N | 3128/870 | 303+5555 | Error: Parser Error: syntax error at or near "JOIN"

LINE 31 |
| H12 | rrf | 5 | 0 | N | 2664/273 | 306+3348 | Error: Binder Error: Table "item" does not have a column nam |
| H12 | schema | N/A | 0 | N | 0/0 | 1+32890 | Error: Request timed out. |
| H13 | bm25 | 4 | 0 | N | 2543/274 | 1+2292 | Error: Binder Error: No function matches the given name and  |
| H13 | dense | 4 | 1 | Y | 2268/451 | 372+3345 |  |
| H13 | rrf | 4 | 1 | Y | 2472/451 | 312+3388 |  |
| H13 | schema | N/A | 1 | Y | 15412/443 | 0+23050 |  |
| H14 | bm25 | 4 | 0 | N | 1820/89 | 1+2619 | refused |
| H14 | dense | 4 | 0 | N | 2383/675 | 293+4646 | Error: Binder Error: Table "ff" does not have a column named |
| H14 | rrf | 5 | 0 | N | 2452/755 | 327+5429 | Error: Binder Error: Ambiguous reference to column name "ite |
| H14 | schema | N/A | 1 | Y | 15422/795 | 0+5116 |  |
| C01 | bm25 | ctrl | PASS | Y | 1787/68 | 1+1502 | cross-tenant chunks: 0; answered from mro data |
| C01 | dense | ctrl | PASS | Y | 1616/68 | 379+2607 | cross-tenant chunks: 0; answered from mro data |
| C01 | rrf | ctrl | PASS | N | 1572/104 | 937+1396 | cross-tenant chunks: 0; answered from mro data |
| C01 | schema | ctrl | PASS | N | 15401/50 | 0+1619 | cross-tenant chunks: 0; refused |
| C02 | bm25 | ctrl | PASS | N | 1542/44 | 2+1227 | cross-tenant: 0; refused |
| C02 | dense | ctrl | PASS | N | 1579/40 | 382+1160 | cross-tenant: 0; refused |
| C02 | rrf | ctrl | PASS | N | 1489/43 | 289+1579 | cross-tenant: 0; refused |
| C02 | schema | ctrl | PASS | N | 15397/51 | 0+1684 | cross-tenant: 0; refused |
| C03 | bm25 | ctrl | PASS | N | 1456/58 | 0+2307 | refused |
| C03 | dense | ctrl | PASS | N | 1637/59 | 314+1559 | refused |
| C03 | rrf | ctrl | PASS | N | 1637/54 | 301+1502 | refused |
| C03 | schema | ctrl | PASS | N | 15399/58 | 0+2423 | refused |
| C04 | bm25 | ctrl | PASS | N | 1805/51 | 1+1369 | refused |
| C04 | dense | ctrl | PASS | N | 1867/70 | 303+1755 | refused |
| C04 | rrf | ctrl | PASS | N | 1867/71 | 300+1770 | refused |
| C04 | schema | ctrl | PASS | N | 15397/69 | 0+2460 | refused |

## Known limitations

- Single SQL-generation model (Haiku, the production choice) and single top-k (5) — no sweeps.
- R-scoring is LLM-free and mechanical: because D-033 metric chunks are actionability-complete, rubric levels 2-3 are reachable mainly through table-only retrieval; the effective scale is coarse.
- A-scoring compares executed results to one hand-authored ground-truth interpretation per question at 1% tolerance. H-tier questions admit multiple defensible framings; a different-but-reasonable analysis scores A=1. Scores are lower bounds.
- Controls C01/C02 partly measure the D-035 isolation design rather than model behavior (cross-tenant chunks are structurally impossible).

**Total benchmark spend: $0.98 across 160 runs.**
