"""Ticket bus: Pub/Sub in the cloud, direct HTTP to the orchestrator in LOCAL_MODE."""
from __future__ import annotations

import asyncio
import json
import logging
import os

from sentinel_core.http import ServiceClient
from sentinel_core.schemas import TicketMessage

log = logging.getLogger("gateway.bus")


class HttpBus:
    name = "http-direct"

    def __init__(self, orchestrator_url: str) -> None:
        self._client = ServiceClient(orchestrator_url, timeout=120)
        self._tasks: set[asyncio.Task] = set()
        self._sem = asyncio.Semaphore(int(os.getenv("LOCAL_CONCURRENCY", "8")))

    async def publish(self, msg: TicketMessage) -> None:
        async def _run() -> None:
            async with self._sem:
                try:
                    await self._client.post("/process", msg.model_dump(mode="json"))
                except Exception as e:  # noqa: BLE001
                    log.error("orchestrator call failed for %s: %r", msg.ticket_id, e)

        t = asyncio.create_task(_run())
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)


class PubSubBus:
    name = "pubsub"

    def __init__(self, project: str, topic: str) -> None:
        from google.cloud import pubsub_v1  # type: ignore

        self._pub = pubsub_v1.PublisherClient()
        self._topic = self._pub.topic_path(project, topic)

    async def publish(self, msg: TicketMessage) -> None:
        data = json.dumps(msg.model_dump(mode="json")).encode()
        fut = self._pub.publish(self._topic, data, ticket_id=msg.ticket_id, language=msg.language, source=msg.source)
        await asyncio.to_thread(fut.result, 30)
