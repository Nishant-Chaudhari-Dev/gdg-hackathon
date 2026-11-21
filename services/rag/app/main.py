"""RAG service HTTP layer (app owner). RAG team: edit retriever.py and generator.py, not this file."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from sentinel_core.schemas import DraftRequest, DraftResponse, RetrieveRequest, RetrieveResponse, ServiceInfo

from .generator import Generator
from .retriever import Retriever

retriever = Retriever()
generator = Generator()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.gather(asyncio.to_thread(retriever.load), asyncio.to_thread(generator.load))
    yield


app = FastAPI(title="SentinelDesk RAG service", lifespan=lifespan)


@app.get("/healthz", response_model=ServiceInfo)
def healthz() -> ServiceInfo:
    return ServiceInfo(service="rag", version=f"{retriever.version}+{generator.model}",
                       details={"retriever": retriever.version, "generator": generator.model})


@app.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(req: RetrieveRequest) -> RetrieveResponse:
    return await asyncio.to_thread(retriever.retrieve, req)


@app.post("/draft", response_model=DraftResponse)
async def draft(req: DraftRequest) -> DraftResponse:
    resp = await asyncio.to_thread(generator.draft, req)
    # Contract enforcement: citations must be real retrieved ids.
    allowed = {h.ticket_id for h in req.hits}
    resp.cited_ticket_ids = [c for c in resp.cited_ticket_ids if c in allowed]
    return resp
