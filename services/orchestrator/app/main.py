"""Orchestrator worker. Cloud: Pub/Sub push subscription -> /pubsub/push. Local: gateway -> /process."""
from __future__ import annotations

import base64
import json
import logging
import os

from fastapi import FastAPI, HTTPException, Request, Response

from sentinel_core.schemas import ServiceInfo, TicketMessage
from sentinel_core.store import FirestoreStore, RemoteStore, Store

from . import pipeline

logging.basicConfig(level=logging.INFO)
VERSION = "orchestrator-0.1"


def _make_store() -> Store:
    if os.getenv("STORE", "remote") == "firestore":
        return FirestoreStore()
    return RemoteStore(os.getenv("GATEWAY_URL", "http://localhost:8080"), os.getenv("INTERNAL_TOKEN", "dev-token"))


store = _make_store()
app = FastAPI(title="SentinelDesk orchestrator")


@app.get("/healthz", response_model=ServiceInfo)
def healthz() -> ServiceInfo:
    return ServiceInfo(service="orchestrator", version=VERSION,
                       details={"store": store.name, "ml": pipeline.ML_URL, "rag": pipeline.RAG_URL})


@app.post("/process")
async def process_direct(msg: TicketMessage) -> dict:
    """LOCAL_MODE path (gateway calls directly instead of Pub/Sub)."""
    return await pipeline.process(store, msg)


@app.post("/pubsub/push", status_code=204)
async def pubsub_push(request: Request) -> Response:
    envelope = await request.json()
    try:
        data = base64.b64decode(envelope["message"]["data"]).decode()
        msg = TicketMessage.model_validate(json.loads(data))
    except Exception as e:  # malformed -> ack (204) so it doesn't redeliver forever
        logging.error("bad pubsub message: %r", e)
        return Response(status_code=204)
    try:
        await pipeline.process(store, msg)
    except Exception as e:  # store failure -> 500 => Pub/Sub retries, then dead-letter
        logging.exception("processing failed")
        raise HTTPException(500, str(e)) from e
    return Response(status_code=204)
