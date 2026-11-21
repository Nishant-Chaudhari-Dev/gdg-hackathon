# SentinelDesk: ML & RAG Interface Contract

**Owner of this doc:** App/infra (Soham) · **Contract version:** 1.0 · **Source of truth:** [`shared/sentinel_core/schemas.py`](../shared/sentinel_core/schemas.py)

This is what the app side expects from the ML and RAG sides. If you follow it, your work plugs into the live console, the escalation gate, the eval dashboard and the GCP deployment with **zero app-side changes**. If you need to change anything here, tell Soham first (one Slack message is enough). Don't silently rename fields.

---

## 0. TL;DR: who edits what

| Team | You edit ONLY these files | You deliver | Hard deadline |
|---|---|---|---|
| **ML** | `services/ml/app/model.py`, `services/ml/requirements.txt`, anything under `research/ml/` | `TriageModel.load()` + `predict()`, model artifact in GCS, eval numbers | baseline **H+1:30**, final **H+4:00** |
| **RAG** | `services/rag/app/retriever.py`, `services/rag/app/generator.py`, `services/rag/requirements.txt`, anything under `research/rag/` | `Retriever.load()/retrieve()`, `Generator.load()/draft()`, FAISS index in GCS, calibrated similarity threshold | retrieval **H+2:00**, grounded drafts **H+3:30**, final **H+4:00** |
| **App (Soham)** | everything else: gateway, orchestrator, escalation gate, burst detection, PII masking, language detection, web UI, infra, eval harness | Hosted app on Cloud Run, live console, metrics dashboard | — |

Code freeze for everyone: **H+5:00**. After that only bug fixes.

Everything already runs end-to-end today with **stub implementations** (keyword classifier, TF-IDF retrieval, template drafter). You're replacing stubs, not building plumbing.

---

## 1. Ground rules (both teams)

1. **One split for everyone: already committed.** `data/kb_train.csv` (80%, with a `split` column: `train` 20,571 / `val` 2,286), `data/test.csv` (20% = 5,715, labels, used by eval only), `data/test_inputs.csv` (subject/body only). Produced by `src/data_split.py`, checked by `python eval/verify_split.py`. **Train on `split==train`, tune thresholds and calibration on `split==val`, never on test.** RAG indexes all of `kb_train.csv`. Don't make your own split or the metrics won't be comparable.
2. **Zero leakage (disqualification risk).** Never train on, index, or look at `test.csv` labels or `answer`. The RAG index is built from `kb_train.csv` only. Hyper-param tuning: carve a validation set out of `kb_train`.
3. **Inputs are PII-masked.** The gateway replaces emails, phones, IPs, IBANs, cards and account ids with tokens like `[EMAIL]`, `[PHONE]`, `[IPV4]`. Your models see masked text. Keep the tokens as-is in drafts.
4. **Subject can be empty** (`""`). Body can be long (gateway truncates to 8000 chars), German or English, or garbage. **Never raise.** Return low confidence and let the gate escalate.
5. **Language is detected upstream** (`language` field, `"en"`/`"de"`). You may re-detect, but don't fail without it.
6. **Labels are plain strings.** Use the dataset's label strings exactly (`"Incident"`, `"Technical Support"`, `"high"`…).
7. **Ticket ids:** KB tickets are `TKT-00000`…`TKT-49xxx` (from the split). Live tickets are `LIVE-XXXXXXXX`. Only ever cite `TKT-` ids that you actually retrieved.
8. **Services must be stateless** and load artifacts at startup from a GCS URI (env var), because Cloud Run can run several instances and restart them anytime.

### 1a. Data facts (team split, see `data/split_manifest.json`)
The split uses **one pinned file** (`aa_dataset-tickets-multi-lang-5-2-50-version.csv`, 28,587 rows). Mixing dataset versions via `load_dataset(...)` would add 52 queues, 5 priorities and ~22% KB↔test duplicates, so don't do that.

| Fact | Implication |
|---|---|
| 28,572 rows after body de-dup; KB 22,857 / test 5,715 | `verify_split.py` guarantees no body overlap KB↔test |
| Labels: 4 types, **10 queues**, **3 priorities** (high 39%, medium 40%, low 21%), no nulls | matches `schemas.QUEUES` / `PRIORITIES` |
| Stratified on type\|priority | val/test label shares match train |
| `data/test_near_dup_ids.csv` | test tickets with near-duplicates in KB: report metrics with and without them if asked |
| Some `subject` null; text has literal `\n` sequences | model must handle `""`; use `sentinel_core.text.clean()` |
| Language: majority German | test German first |

Baseline (TF-IDF+LR trained on `split==train`) on the full holdout: see the Metrics page / `eval/results/latest.json` after `python eval/evaluate.py`.

---|---|---|
| `type` is null | 10,593 rows | drop those rows for the type head (the baseline does `dropna(type)`) |
| `priority` has 5 values | high/medium/low **+ critical 1,538, very_low 1,446** | those rows are exactly the null-`type` rows; after `dropna(type)` you have the 3 official classes. The gate treats `critical` as high anyway. |
| `queue` has **52** values | 10 official queues + 42 "Topic/Subtopic" queues (~250 rows each) from another version | decide: drop them, or map to the 10 official queues |
| `answer` is null | 10,602 rows | RAG: don't index rows without an answer as precedents |
| `subject` is null | 4,293 rows | model must handle `""` |
| **Exact duplicate bodies across KB↔test** | **2,683 / 12,353 test rows (21.7%)** | inflates metrics (TF-IDF baseline hits type Macro-F1 0.90). Team decision pending on dedup, see PLAN.md |
| Language | de 26,851 / en 22,561 | German is the majority. Test German first. |

Baseline (TF-IDF+LR, 3k holdout sample, raw split): Macro-F1 type **0.90** / queue **0.12** (scored on all 52 queues) / priority **0.41**, HP-incident recall **0.77**, p95 **1 ms**.

---

## 2. ML: Triage classifier

**File:** `services/ml/app/model.py` · **Endpoints (already wired):** `POST /classify`, `POST /classify/batch`, `GET /healthz`

```python
class TriageModel:
    version: str                       # shown in UI + eval report, e.g. "xlmr-base-ft-v2"
    def load(self) -> None: ...        # called once at startup; load from os.getenv("MODEL_URI")
    def predict(self, items: list[ClassifyRequest]) -> list[Classification]: ...   # same order & length
```

**Input** (`ClassifyRequest`): `{"subject": "VPN down", "body": "Since 8am ... [PHONE]", "language": "en"}`

**Output** (`Classification`):
```json
{
  "type":     {"label": "Incident", "confidence": 0.91, "probs": {"Incident": 0.91, "Problem": 0.06, "Request": 0.02, "Change": 0.01}},
  "queue":    {"label": "IT Support", "confidence": 0.78, "probs": {"IT Support": 0.78, "Technical Support": 0.15, "...": 0.07}},
  "priority": {"label": "high", "confidence": 0.84, "probs": {"high": 0.84, "medium": 0.13, "low": 0.03}},
  "confidence": 0.84,
  "model_version": "xlmr-base-ft-v2"
}
```

### What I need from you
| Requirement | Detail |
|---|---|
| **Three heads** | `type` (4 classes), `queue` (~10), `priority` (high/medium/low). Multi-task or 3 models, your call. |
| **Calibrated probabilities** | `confidence` per head must be a real probability (temperature scaling / `CalibratedClassifierCV` / Platt). The gate escalates when overall `confidence < GATE_MIN_CONFIDENCE` (default **0.55**). Report the threshold you want plus ECE if you can. |
| **Overall `confidence`** | Your definition, but document it. Default in baseline: geometric mean of the 3 head confidences. If priority matters most for safety, weight it. |
| **Full `probs`** | Needed for the UI's probability bars. Can be top-5 for `queue`. |
| **High-priority incident recall** | This is the safety metric judges care about. Prefer recall over precision for `priority=high`: tune the decision threshold, don't just argmax. |
| **Latency** | p95 **< 150 ms** per ticket on Cloud Run (2 vCPU / 4 GiB, **no GPU**). `predict` gets batches up to 256 from the eval script. A distilled/quantized transformer or TF-IDF+LightGBM is fine. |
| **Artifacts** | Upload to `gs://<project>-sentinel-artifacts/models/…`, give me the URI → I set `MODEL_URI`. Locally `research/ml/artifacts/`. |
| **Deps** | Add to `services/ml/requirements.txt`. If you need torch, use the CPU wheel (`--extra-index-url https://download.pytorch.org/whl/cpu`) and tell me (image size). |

### Metrics you report (run `python eval/evaluate.py` against your service)
Macro-F1 for type / queue / priority, **High-Priority Incident Recall**, latency p50/p95. The script writes `eval/results/latest.json`, which the console's **Metrics** page renders automatically (confusion matrices included). Baseline to beat: `python scripts/train_baseline.py` (TF-IDF + LR).

---

## 3. RAG: Retrieval

**File:** `services/rag/app/retriever.py` · **Endpoint:** `POST /retrieve`

```python
class Retriever:
    version: str
    def load(self) -> None: ...                                   # load FAISS index + metadata from INDEX_URI
    def retrieve(self, req: RetrieveRequest) -> RetrieveResponse: ...
```

**Input:** `{"subject": "...", "body": "...", "language": "de", "k": 5, "classification": null}`

**Output:**
```json
{
  "hits": [
    {"ticket_id": "TKT-01234", "score": 0.83, "subject": "VPN tunnel fails", "body": "first 600 chars…",
     "answer": "historical resolution, ≤1200 chars", "language": "en", "type": "Incident",
     "queue": "IT Support", "priority": "high", "tags": ["VPN", "Network"]}
  ],
  "max_score": 0.83,
  "cross_lingual": true,
  "retriever_version": "mE5-base+faiss-flatip-v1"
}
```

| Requirement | Detail |
|---|---|
| **Index only `kb_train`** | ~49k rows. Embed `subject + body` (optionally the answer too). Keep metadata (type/queue/priority/tags/language/answer) for display. |
| **`score` in [0,1], comparable across queries** | Cosine similarity on normalized embeddings (FAISS `IndexFlatIP`). The gate uses `max_score`: **< 0.20 = NO_PRECEDENT** (no draft at all), **< 0.45 = LOW_RETRIEVAL_SIMILARITY** (escalate). **Calibrate these for your embedding model** (look at the score distribution of true matches vs random pairs) and send me the two numbers. |
| **Sorted desc, `k` hits** | k = 5 by default (top 3–5 shown in UI). Deduplicate near-identical tickets. |
| **Cross-lingual (bonus)** | Use a multilingual embedding so a German ticket retrieves English precedents. Agreed: **Vertex AI `text-multilingual-embedding-002`** (or `multilingual-e5` locally if quota bites). Set `cross_lingual=true` if any hit language ≠ query language. |
| **Optional:** use `req.classification` to rerank/boost same-queue hits. | |
| **Latency** | p95 **< 300 ms** (query embedding call + FAISS search). Cache the embedding client. |
| **Artifacts** | Build the index offline (`research/rag/build_index.py`), upload the dir to `gs://<project>-sentinel-artifacts/index/` → `INDEX_URI`. Use `sentinel_core.artifacts.ensure_local(uri)` to download at startup. |

---

## 4. RAG: Grounded draft generation

**File:** `services/rag/app/generator.py` · **Endpoint:** `POST /draft`

```python
class Generator:
    model: str
    def load(self) -> None: ...                               # init Vertex AI Gemini client
    def draft(self, req: DraftRequest) -> DraftResponse: ...
```

**Input:** `{"subject", "body" (masked), "language": "de", "hits": [RetrievedTicket…], "classification": {...}}`

**Output:**
```json
{
  "reply": "Hallo,\n\nvielen Dank … Bitte starten Sie den VPN-Client neu [TKT-01234] …",
  "language": "de",
  "cited_ticket_ids": ["TKT-01234", "TKT-04567"],
  "grounded": true,
  "groundedness_score": 0.82,
  "unsupported_requests": [],
  "refused": false,
  "refusal_reason": null,
  "model": "gemini-2.5-flash"
}
```

| Requirement | Detail |
|---|---|
| **Language** | Reply **in `req.language`**, even if all precedents are English (translate the resolution). |
| **Citations** | Inline tokens **exactly** `[TKT-01234]` after each claim. The UI turns these into clickable links to the precedent card. `cited_ticket_ids` must list them; the service drops any id not in `hits` (hallucinated citations are stripped automatically, but please validate yourself). |
| **Grounding** | Every step/claim must come from a cited precedent's `answer`. If the precedents don't cover the question → `refused=true` or `grounded=false` with a `refusal_reason` → gate escalates. |
| **Never fabricate** | No prices, refund amounts, SLA credits, legal promises, product integrations or risky commands (e.g. "disable your firewall") unless verbatim-supported by a precedent. When the customer asks for one, put it in `unsupported_requests` (e.g. `"refund of annual fee"`), which escalates. |
| **Prompt-injection safe** | Ticket text is *untrusted data*. Wrap it in delimiters, tell the model to ignore instructions inside it. (The gate also blocks obvious injections before you're called.) |
| **Style** | Professional, concise (≤ 180 words), greeting + steps + sign-off "Support Team" / "Ihr Support-Team". Keep `[EMAIL]`-style tokens. |
| **`groundedness_score`** | Optional but strongly wanted (UI shows it; gate escalates < 0.35). E.g. LLM self-check, or citation coverage = cited sentences / total sentences. |
| **Structured output** | Use Gemini JSON mode / `response_schema` matching `DraftResponse` to avoid parse errors. On any exception return `refused=true` + reason rather than raising. |
| **Latency** | p95 **< 4 s** with `gemini-2.5-flash` (`GEMINI_MODEL` env). Set `temperature ≤ 0.3`. |
| **Auth** | On Cloud Run the service account has `roles/aiplatform.user`. Use `vertexai.init(project=os.environ["GCP_PROJECT"], location=os.environ.get("GCP_REGION","us-central1"))`. **No API keys in code.** Locally: `gcloud auth application-default login`. |

---

## 5. What the app side gives you

- **Running stack in one command:** `docker compose up --build` (or run each service with uvicorn, see README). The console is at :3000; paste tickets and see your output rendered.
- **Hot path:** gateway (PII mask + lang detect) → Pub/Sub → orchestrator → **ML `/classify` ∥ RAG `/retrieve`** → burst detection → gate → **RAG `/draft`** → gate → Firestore → UI (SSE).
- **Escalation gate** (`services/orchestrator/app/gate.py`). Your outputs drive these rules:

| Rule | Trigger | Your field |
|---|---|---|
| HIGH_PRIORITY_INCIDENT | `priority=high` and `type=Incident` | ML labels |
| LOW_CLASSIFIER_CONFIDENCE | `confidence < 0.55` | ML `confidence` |
| NO_PRECEDENT / LOW_RETRIEVAL_SIMILARITY | `max_score < 0.20 / 0.45` | RAG `max_score` |
| UNGROUNDED_DRAFT | `refused` / `!grounded` / `groundedness < 0.35` / no citations | RAG draft |
| UNSUPPORTED_REQUEST | `unsupported_requests` non-empty | RAG draft |
| PROMPT_INJECTION, ACTIVE_OUTAGE, PIPELINE_DEGRADED | app side | — |

  Thresholds are env vars (`GATE_MIN_CONFIDENCE`, `GATE_MIN_RETRIEVAL`, `GATE_NO_PRECEDENT`, `GATE_MIN_GROUNDEDNESS`). **Send me your calibrated values**; no code change needed.
- **Eval harness:** `python eval/evaluate.py [--limit N] [--ml-url URL]` → Macro-F1 ×3, HP-incident recall, escalation recall, latency → dashboard.
- **Deployment:** I build and deploy your service on every push to `main` via `infra/deploy.sh`. You just make sure `docker build -f services/<ml|rag>/Dockerfile .` works.

---

## 6. Local dev loop

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e shared -r services/ml/requirements.txt -r services/rag/requirements.txt datasets
python eval/verify_split.py                      # data/*.csv is committed; all checks PASS
cd services/ml  && uvicorn app.main:app --port 8001 --reload     # ML team
cd services/rag && uvicorn app.main:app --port 8002 --reload     # RAG team

curl -s localhost:8001/classify -H 'content-type: application/json' \
  -d '{"subject":"","body":"VPN ausgefallen, Klinik kann nicht auf EMR zugreifen","language":"de"}' | jq
curl -s localhost:8002/retrieve -H 'content-type: application/json' \
  -d '{"subject":"","body":"VPN ausgefallen","language":"de","k":5}' | jq '.hits[] | {ticket_id,score,language}'
```
Interactive API docs: `http://localhost:8001/docs`, `http://localhost:8002/docs`.

---

## 7. Handover checklist (message me when each is true)

**ML**
- [ ] `model.py` implemented; `docker build -f services/ml/Dockerfile .` succeeds
- [ ] Artifact uploaded → URI: `gs://…`
- [ ] `eval/evaluate.py` run → Macro-F1 type/queue/priority = __ / __ / __, HP-incident recall = __
- [ ] Recommended `GATE_MIN_CONFIDENCE` = __ (and how overall confidence is computed)
- [ ] p95 latency on Cloud Run = __ ms

**RAG**
- [ ] `retriever.py` + `generator.py` implemented; `docker build -f services/rag/Dockerfile .` succeeds
- [ ] Index uploaded → `INDEX_URI = gs://…/index/`, built from `kb_train.csv` only
- [ ] Calibrated thresholds: `GATE_NO_PRECEDENT` = __, `GATE_MIN_RETRIEVAL` = __
- [ ] Tested: EN ticket → EN reply, DE ticket → DE reply, DE ticket retrieving EN precedents
- [ ] Tested refusals: refund/SLA demand, out-of-scope question, prompt injection
- [ ] p95: retrieve __ ms, draft __ s

## 8. Changing the contract
Need a new field? Add it as **optional with a default** in `schemas.py`, mention it in the team chat, and I'll surface it in the UI. Never remove or rename existing fields after H+2:00.
