# Grounded drafting (RAG generation)

Owner: Chitta.

| File | Purpose |
|---|---|
| `services/rag/app/generator.py` | `Generator` for `POST /draft` (contract §4), plus all drafting logic |
| `src/generation.py` | prototype API: `detect_language`, `mask_pii`, `draft`, `request_supported` (wrapper over `generator.py`) |
| `eval/eval_generation.py` | drafting metrics on holdout tickets plus adversarial probes; `--judge` for faithfulness |
| `research/rag/test_generation.py` | 42 offline tests (Gemini is mocked): `python -m pytest research/rag/test_generation.py` |
| `research/rag/proposed_shared/` | proposed upgrades of `shared/sentinel_core/lang.py` and `pii.py` for the app owner (see below) |

## How a draft is produced
1. **PII masking:** done by the gateway, then again before Gemini (masking is idempotent).
2. **Gemini writes, the code verifies.** `gemini-3.5-flash-lite` (Vertex AI, temperature 0.2, JSON schema output) drafts the reply in `req.language` from the retrieved precedents only. The draft is accepted only if:
   - every `[TKT-xxxxx]` it cites was actually retrieved, and it cites at least one;
   - every number in it appears in the ticket or the evidence;
   - it is in the requested language.

   Citation variants such as `[TKT-1, TKT-2]` are normalized into the exact tokens the UI links.
3. **On failure:** one repair round on the same model, with the exact problems fed back. Then `gemini-3.5-flash`. Then an extractive fallback that only quotes past resolutions; it is always marked `grounded=false`, so it goes to human review. A 429 or 503 gets one quick retry first. Any exception returns `refused=true`; the service never raises.
4. **Gate inputs:**
   - `groundedness_score` is the share of substantive sentences that carry a valid citation.
   - `unsupported_requests` combines Gemini's judgement with a keyword check for refunds, compensation, guarantees/SLA, legal and data-deletion requests that no retrieved resolution covers. A Gemini item that a retrieved resolution does cover is dropped.

The prompt forbids invented prices, SLAs, refunds, legal promises and risky commands. It treats ticket text as data, so injected instructions are refused.

## Results (`python eval/eval_generation.py --n 100 --judge`)
These come from the live path: gateway masking and language detection, then the FAISS retriever, then `Generator`, then `gate.post_draft`. Holdout input is read only through `load_test_inputs()`. The full report is in `eval/results/generation_metrics.json`; every draft is in `generation_samples.jsonl`.

| metric (100 holdout tickets) | value |
|---|---|
| citation validity | **100%** |
| language match | **100%** |
| replies with unsupported numbers | **0%** |
| faithful, judged by `gemini-3.8-flash` | **99%** (1 unfaithful: the reply turned the customer's "restarting … may help" into "you have already tried restarting") |
| answered by Gemini on the first pass | 100% |
| escalated because of the draft | 1% (a price-quote request with no price in any precedent) |
| mean groundedness score | 0.983 |
| draft latency p50 / p95 | 1.10 s / 1.43 s (contract target < 4 s) |
| adversarial probes | **6/7**: refund+SLA+lawyer, injection, DE outage, integration+pricing, PII and off-topic all pass. "Passwort vergessen" gets an English reply because the gateway's current `shared/` detector labels it `en`; the proposed detector below fixes this (16/16 on two- or three-word tickets). |

## Proposed for `shared/` (app owner: Soham)
The gateway's language detection and PII masking decide the reply language and what Gemini sees. `research/rag/proposed_shared/lang.py` and `pii.py` are drop-in replacements: same function signatures and the same placeholder labels.

| benchmark | current shared | proposed |
|---|---|---|
| language, subject lines only (5,947 holdout/val, label noise removed) | 96.4% | **97.5%** |
| language, two- or three-word tickets ("Passwort vergessen", "Serverprobleme") | 14/16 | **16/16** |
| PII recall on test cases (e.g. `030/12345678`, `AC-99812345`) | 20/22 | **22/22** |
| look-alikes preserved (dates, versions, error codes, prices, ports, TKT ids) | 16/16 | 16/16 |

On full tickets, every remaining mismatch with the dataset's `language` label is label noise (tickets labelled `de` whose text is English). Over the 5,715 holdout tickets the proposed masker masks exactly one entity, and it is a real phone number.

## Configuration
| env | default | meaning |
|---|---|---|
| `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` | (none) | Vertex AI via ADC (Cloud Run) |
| `GEMINI_LOCATION` | `global` | Vertex location for the Gemini 3.x models |
| `GEMINI_MODEL` | (none) | tried first if set; then `gemini-3.5-flash-lite`, then `gemini-3.5-flash`. `gemini-2.5-flash` is not served to new projects |
| `GEN_MODELS` | (none) | full override of the model chain |
| `GOOGLE_GENAI_USE_VERTEXAI` | (none) | `true` forces Vertex even when an API key is set (local) |
| `GEMINI_API_KEY` | (none) | Gemini Developer API (local only, never in code) |
| `GATE_MIN_RETRIEVAL` | from `<index>/calibration.json` | similarity floor used by `request_supported()` |

Recommended gate settings, from the retrieval calibration: `GATE_MIN_RETRIEVAL=0.87`, `GATE_NO_PRECEDENT=0.841`. The defaults (0.45 / 0.20) never trigger with multilingual-e5 cosine scores.
