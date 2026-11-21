# SentinelDesk

**Autonomous incident triage & grounded resolution copilot.** Multilingual (EN/DE) ticket classification, a confidence and risk escalation gate, precedent retrieval (RAG), and grounded replies that cite past tickets. It runs as an event-driven microservice system on Google Cloud.

- 📐 Architecture, feature map, timeline, demo script: [docs/PLAN.md](docs/PLAN.md)
- 🤝 **ML / RAG teams, start here:** [docs/CONTRACT.md](docs/CONTRACT.md)
- 🔌 Gateway API types: [docs/api-types.ts](docs/api-types.ts) · live OpenAPI at `http://localhost:8080/docs`

## Repo layout

```
web/                    Next.js operator console (live queue, triage view, outages, metrics, audit, system)
services/
  gateway/              public FastAPI: REST + SSE, PII guardrail, language detection, Pub/Sub publish, simulator
  orchestrator/         Pub/Sub push worker: pipeline, escalation gate, burst/outage detection
  ml/                   /classify            ← ML team: app/model.py
  rag/                  /retrieve, /draft    ← RAG team: app/retriever.py, app/generator.py
shared/sentinel_core/   pydantic schemas (THE contract), PII masking, lang detect, store, HTTP helpers
scripts/                data_split.py (canonical 80/20), train_baseline.py
eval/                   evaluate.py → eval/results/latest.json (rendered in the console)
infra/                  deploy.sh (GCP one-shot), Cloud Build configs
research/{ml,rag}/      notebooks, training & index-building code, local artifacts (gitignored)
```

## Quick start (local, no GCP needed)

```bash
python scripts/data_split.py          # needs `pip install datasets pandas`; writes data/*.csv (gitignored)
docker compose up --build             # ml, rag, orchestrator, gateway, web
open http://localhost:3000
```

Without Docker:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e "shared[gcp]" -r services/gateway/requirements.txt -r services/orchestrator/requirements.txt \
            -r services/ml/requirements.txt -r services/rag/requirements.txt
(cd services/ml && uvicorn app.main:app --port 8001) &
(cd services/rag && uvicorn app.main:app --port 8002) &
(cd services/orchestrator && uvicorn app.main:app --port 8003) &
(cd services/gateway && uvicorn app.main:app --port 8080) &
(cd web && npm install && npm run dev)
```

Services fall back to stubs when real models are missing, so the full flow always works:
- ML: TF-IDF baseline if `research/ml/artifacts/model.joblib` exists (`python scripts/train_baseline.py`), else a keyword heuristic
- RAG: TF-IDF over `data/kb_train.csv` if present (set `KB_LIMIT=5000` for fast startup), else a 10-ticket fixture; template drafter

## Deploy to GCP

```bash
brew install --cask google-cloud-sdk && gcloud auth login && gcloud auth application-default login
export GCP_PROJECT=<project-id> GCP_REGION=us-central1
./infra/deploy.sh all       # APIs, Artifact Registry, Firestore, GCS, SAs, Pub/Sub(+DLQ), 5 Cloud Run services
./infra/deploy.sh urls
```

## Evaluate

```bash
python eval/evaluate.py --ml-url http://localhost:8001            # Macro-F1 ×3, HP-incident recall, latency
python eval/evaluate.py --ml-url $(gcloud run services describe ml --region us-central1 --format='value(status.url)') \
       --upload gs://$GCP_PROJECT-sentinel-artifacts/eval/latest.json
```

## Escalation gate (`gate-v1`)

| Code | Rule | Severity |
|---|---|---|
| HIGH_PRIORITY_INCIDENT | priority=high ∧ type=Incident | critical |
| LOW_CLASSIFIER_CONFIDENCE | confidence < `GATE_MIN_CONFIDENCE` (0.55) | warning |
| NO_PRECEDENT | best similarity < `GATE_NO_PRECEDENT` (0.20) → no draft generated | critical |
| LOW_RETRIEVAL_SIMILARITY | best similarity < `GATE_MIN_RETRIEVAL` (0.45) | warning |
| UNGROUNDED_DRAFT | refused / not grounded / groundedness < 0.35 / no citations | critical/warning |
| UNSUPPORTED_REQUEST | customer asks for something no precedent supports | warning |
| PROMPT_INJECTION | injection patterns in ticket → never sent to LLM | critical |
| ACTIVE_OUTAGE | ticket joins a detected burst (≥3 similar in 15 min) | critical |
| PIPELINE_DEGRADED | ML/RAG unavailable → fail safe to human | critical |
| SENSITIVE_REQUEST | refunds/legal/GDPR mentioned (annotation only) | info |

Any critical or warning reason → **Escalate to On-Call Engineer**; otherwise → **Auto-Draft Ready**.

## Data & fair play
Split is fixed (seed 42, 80/20) by `scripts/data_split.py`. Only `kb_train.csv` is used for training and indexing. `test.csv` labels are read only by `eval/evaluate.py` for scoring, and the simulator replays `test_inputs.csv` (subject/body only). Dataset: [Tobi-Bueck/customer-support-tickets](https://huggingface.co/datasets/Tobi-Bueck/customer-support-tickets) (CC-BY-NC-4.0).
