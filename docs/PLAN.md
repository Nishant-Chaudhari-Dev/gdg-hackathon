# SentinelDesk: Build Plan & Architecture

## Architecture (event-driven microservices on GCP)

```
                       ┌────────────────────────── Cloud Run ──────────────────────────┐
 Browser ──HTTPS──►  web (Next.js console)                                             │
    │                                                                                   │
    └──REST + SSE──► gateway (FastAPI, public)                                          │
                       │ PII mask · lang detect · ticket record → Firestore             │
                       │ publish TicketMessage                                          │
                       ▼                                                                │
                 Pub/Sub topic `tickets` ──push (OIDC)──► orchestrator (private)        │
                 (DLQ `tickets-dlq`, 5 attempts)          │ classify ∥ retrieve          │
                                                          ├──► ml  (private)  /classify  │
                                                          ├──► rag (private)  /retrieve  │
                                                          │ burst detection → outages    │
                                                          │ escalation gate (pre)        │
                                                          ├──► rag /draft (Gemini/Vertex)│
                                                          │ escalation gate (post)       │
                                                          ▼                              │
                                               Firestore (tickets, outages, audit)       │
                       gateway polls changes ◄────────────┘  → SSE → every console tab   │
                       └────────────────────────────────────────────────────────────────┘
 GCS: kb_train.csv, model.joblib, FAISS index, eval/latest.json · Artifact Registry · Cloud Build · Vertex AI
```

**Why this shape:** ingest never blocks on ML (Pub/Sub absorbs bursts, retries and dead-letters); ML and RAG scale and deploy independently (RAG needs RAM for the index, ML needs CPU); every service is stateless, so Cloud Run can autoscale; all state lives in Firestore, so any gateway instance can serve any SSE client. Failures degrade to *escalate to human* (`PIPELINE_DEGRADED`), never to a silent wrong answer.

**LOCAL_MODE** (same code, no cloud): `STORE=memory` + `BUS=http`. The gateway calls the orchestrator directly, and the orchestrator reads and writes the gateway's in-memory store via `/internal/*`.

## Feature map (problem statement → implementation)

| Requirement | Where |
|---|---|
| Classify type/queue/priority + calibrated confidence | ml-service (`model.py`, ML team) |
| Macro-F1 + High-Priority Incident Recall on 20% holdout | `eval/evaluate.py` → Metrics page |
| Escalation gate (HP incident, low conf, low similarity, unsupported) | `orchestrator/app/gate.py` (10 reason codes) |
| Top-k precedent retrieval (RAG) | rag-service `retriever.py` (RAG team) |
| Grounded EN/DE reply citing ticket ids, no fabrication | rag-service `generator.py` (RAG team) + citation validation |
| Live console: labels, confidence, latency, badge, precedents, draft | `web/` Console page |
| **Bonus** cross-lingual retrieval | multilingual embeddings + `cross_lingual` flag + UI badge |
| **Bonus** outage/burst detection + Major Incident banner | `orchestrator/app/burst.py` + global banner + Outages page |
| **Bonus** PII guardrail before any LLM call | `shared/sentinel_core/pii.py` at gateway; UI "what the LLM saw" toggle |
| Extra: human-in-the-loop (approve/edit/reject/override/ack) + audit log | gateway `/actions`, Audit page |
| Extra: traffic simulator (mixed/outage/German/adversarial) | gateway `/api/simulate` |
| Extra: live ops metrics (escalation rate, p50/p95 per stage, reasons) | gateway `/api/metrics` |
| Extra: system topology/health page | gateway `/api/system` |
| Extra: on-call paging (critical keyword + escalated → push to on-call phone, rate limited) | orchestrator `alerts.py` → Pub/Sub `alerts` → `services/notifier` → ntfy |

## Timeline (H = hackathon start, 6 h total)

| Time | App (Soham) | ML | RAG |
|---|---|---|---|
| H+0:00–0:45 | ✅ Skeleton, contract, stubs, local stack | data split, EDA, class balance | data split, embedding choice |
| H+0:45–1:30 | GCP project setup, first deploy of stubs (`deploy.sh all`) | baseline model (beat TF-IDF) | index build script, first FAISS index |
| H+1:30–2:30 | UI polish, wire SSE, simulator scenarios | transformer / LightGBM, calibration | `/retrieve` live, calibrate thresholds |
| H+2:30–3:30 | Redeploy with real ML/RAG, tune gate thresholds | threshold for HP recall | Gemini drafting, citations, refusals |
| H+3:30–4:30 | Eval run on full holdout → dashboard; adversarial tests | eval + fixes | DE/EN + cross-lingual + refusal tests |
| H+4:30–5:00 | Load test (simulate 100), fix bugs | final artifact | final index/prompt |
| **H+5:00** | **Code freeze** | | |
| H+5:00–6:00 | README, demo script, rehearse | metrics slide | RAG slide |

## Demo script (5 min)
1. Console: paste German hospital VPN outage → **Escalate to On-Call** (HIGH_PRIORITY_INCIDENT), PII phone masked, DE detected, precedents (cross-lingual), latency.
2. English password reset → **Auto-Draft Ready**, click a citation chip to jump to the precedent, edit and **Approve**.
3. Refund + SLA guarantee demand → escalated with UNSUPPORTED_REQUEST; draft shows no fabricated numbers.
4. Prompt injection sample → blocked before the LLM.
5. Queue → Simulate "outage" → live rows stream in → **Major Incident banner** appears.
6. Metrics → Macro-F1 ×3, HP-incident recall, confusion matrices, p95 latency; System page → GCP topology all green.

## Open items / risks
- `gcloud` CLI not installed on Soham's machine: install it (`brew install --cask google-cloud-sdk`) before the first deploy.
- Vertex AI quota for embeddings during index build (49k texts): batch 250/request, ~5–8 min.
- Cold starts: every service is `--min-instances 1`.
- Firestore change feed is polling (1 s) by design: simple and robust on Cloud Run.
