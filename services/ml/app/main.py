"""ML service HTTP layer (app owner). ML team: edit model.py, not this file."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from sentinel_core.schemas import (
    Classification,
    ClassifyBatchRequest,
    ClassifyBatchResponse,
    ClassifyRequest,
    ServiceInfo,
)

from .model import TriageModel

model = TriageModel()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(model.load)
    yield


app = FastAPI(title="SentinelDesk ML service", lifespan=lifespan)


@app.get("/healthz", response_model=ServiceInfo)
def healthz() -> ServiceInfo:
    return ServiceInfo(service="ml", version=model.version)


@app.post("/classify", response_model=Classification)
async def classify(req: ClassifyRequest) -> Classification:
    return (await asyncio.to_thread(model.predict, [req]))[0]


@app.post("/classify/batch", response_model=ClassifyBatchResponse)
async def classify_batch(req: ClassifyBatchRequest) -> ClassifyBatchResponse:
    return ClassifyBatchResponse(results=await asyncio.to_thread(model.predict, req.items))
