# Precedent retrieval (RAG retrieval)

Owner: Nishant. Code: `services/rag/app/retriever.py`. Index build and calibration: `research/rag/build_index.py`.

## How a ticket finds its precedents
1. **Embed.** The subject and body, cleaned, go through `intfloat/multilingual-e5-small` (384-dim, max 256 tokens). 99.97% of KB tickets fit in 256 tokens (median 91, p99 181).
2. **Search.** FAISS `IndexFlatIP` holds the 22,850 KB tickets that have a resolution (`kb_train.csv` only, train + val). Scores are cosine similarities, and near-identical tickets are de-duplicated.
3. **Re-rank the top 20.** `score` stays the pure cosine; only the order and the choice change:
   - **rare-term boost** (`RAG_LEX_WEIGHT=0.02`): rewards precedents that share the query's rare terms (doc freq ≤ 2%), such as product names, versions and error codes;
   - **specificity** (`RAG_SPEC_WEIGHT=0.01`): prefers answers with concrete steps (restart, update, reset…) over "please send us more details".
4. **Cross-lingual slot** (`RAG_CROSS_LINGUAL_SLOT=1`). When all 5 hits share the ticket's language, the best precedent in the other language takes slot 5, provided it is ≥ 0.87 and within 0.03 of the slot it replaces. Per-language sub-indexes make this cheap.
5. **`max_score` for the gate (precedent coverage).** This is the best cosine of all candidates, minus `RAG_OOD_WEIGHT × unknown_share`. `unknown_share` is the share of the ticket's words that (almost) never occur in the KB. Off-topic requests score about 50% here, real tickets about 12%, and holdout tickets 0%.

Every knob is an environment variable. Setting it to `0` restores the previous behaviour.

## Gate thresholds: two consistent configurations
`max_score` and the orchestrator's thresholds must be changed **together**.

| Config | rag env | orchestrator env | Off-topic caught (36) | Real hand-written tickets flagged (40) | Real holdout below threshold |
|---|---|---|---|---|---|
| Pure cosine (default) | `RAG_OOD_WEIGHT=0` | `GATE_MIN_RETRIEVAL=0.875`, `GATE_NO_PRECEDENT=0.833` | 100% | 15% | 0% |
| **Coverage (recommended)** | `RAG_OOD_WEIGHT=0.05` | `GATE_MIN_RETRIEVAL=0.855`, `GATE_NO_PRECEDENT=0.816` | **100%** | **7.5%** | 0% |

Calibration never uses the holdout. It uses the hand-written lists in `build_index.py` (36 off-topic, 40 realistic EN/DE tickets) and leave-one-out on the KB `val` rows. To recalibrate: `RAG_OOD_WEIGHT=0.05 python research/rag/build_index.py --calibrate-only`. That updates `<index>/calibration.json` and the deploy file.

## Deploy artifact
`research/rag/index/kb_index.pkl.gz` (about 22 MB) holds fp16 vectors, metadata and calibration. `infra/deploy.sh` uploads it to the RAG service's `INDEX_URI`. The embedding model loads from the Hugging Face Hub at startup.

## Evaluation (all leakage-safe)
| Eval | Command | What it measures |
|---|---|---|
| Label agreement | `python eval/eval_retrieval.py` | queue/type/priority agreement of precedents with 5,715 holdout tickets, cross-lingual rate, latency |
| Judged relevance | `python eval/eval_relevance_judge.py 60 3` | Gemini rates the top-3 precedents of holdout tickets: relevant / partial / irrelevant |
| Answer quality | `python eval/eval_answer_quality.py` | grounded drafts vs the **real agent answers** of KB `val` tickets (leave-one-out), with similarity and a Gemini coverage judge |

Holdout answers are never loaded. `val` answers are part of the KB, so they may be used as references.

### Results (21 Nov 2026)
**Label agreement on 5,715 holdout tickets** (`eval/results/retrieval_metrics.json`):

| | Before re-ranking | After (top match pinned, 2-5 re-ranked) |
|---|---|---|
| Top match agreement, queue / type / priority | 0.762 / 0.918 / 0.797 | 0.762 / 0.918 / 0.797 (unchanged by design) |
| Precision@5, queue / type / priority | 0.452 / 0.797 / 0.538 | **0.481 / 0.807 / 0.566** |
| Top-5 vote macro-F1, queue / type / priority | 0.557 / 0.855 / 0.646 | **0.610 / 0.866 / 0.686** |
| Hits including another language | 6.3% | **49.4%** |
| Real holdout tickets below either gate threshold | 0% | 0% |
| Latency p95 (local GPU; Cloud Run CPU is higher, target < 300 ms) | 34 ms | 68 ms |

**Judged relevance** (Gemini, top-3 of holdout tickets, `eval/results/relevance_judge.json`):

| | Baseline (30 tickets) | Re-ranked incl. #1 (same 30) |
|---|---|---|
| Top match relevant | 86.7% | 80.0% |
| A fully relevant precedent in the top 3 | 90.0% | **100%** |
| Top-3 fully relevant | 61.1% | **64.4%** |

Re-ranking position 1 cost top-match relevance, so the shipped version **pins the best-cosine match at #1** and re-ranks only positions 2-5. Its top match is identical to the baseline for every ticket (label metrics above), so judged top-1 relevance stays at the baseline's 86.7%. The judged top-3 gain was measured before pinning; the Gemini free-tier quota ran out before a re-run.

**Answer quality against real agent answers.** 20 KB `val` tickets, each retrieved without itself, drafted by `gemini-3.5-flash-lite`, compared with the answer the human agent actually sent (`eval/results/answer_quality_metrics.json`):

| | Result |
|---|---|
| Gemini judge: draft covers the key resolution **fully** | 60% |
| Gemini judge: **fully or partly** | **95%** |
| Gemini judge: contradicts the real answer | 5% (1/20; the real agent reported fixes it had already applied, which no draft can know) |
| Semantic similarity to the real answer: draft / generic holding reply | **0.953** / 0.864 (draft better on 100% of tickets) |
| Same, copying the top precedent's answer verbatim | 0.966. Copying is closer in wording, but it is untranslated, untailored and uncited. |
| Mean groundedness (cited + semantically supported) | 0.972 |

Note: on the API-key path, every draft fell back to the extractive reply until the 8 s deadline fix in this change.

## Known limits
- **Generic precedents.** Many historical answers ask for details instead of fixing anything. Grounding repeats that faithfully; specificity re-ranking only softens it.
- **Synthetic near-paraphrases.** The median top-1 cosine of holdout tickets is 0.976, so label-agreement numbers are optimistic. Judged relevance is the more honest number.
- **Static index.** Approved replies are not added back. That would need a gateway/console hook (App).
- **Semantic groundedness** (generator, `GEN_SEM_MIN=0.90`) catches sentences whose cited precedent does not support them. It does not catch subtle misstatements that closely paraphrase the precedent.
