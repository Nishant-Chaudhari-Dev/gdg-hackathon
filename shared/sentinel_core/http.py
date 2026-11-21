"""Service-to-service HTTP helpers. On Cloud Run, attaches Google ID tokens when USE_ID_TOKEN=1."""
from __future__ import annotations

import asyncio
import os
import time

import httpx

_token_cache: dict[str, tuple[str, float]] = {}


def _fetch_id_token(audience: str) -> str:
    import google.auth.transport.requests  # type: ignore
    import google.oauth2.id_token  # type: ignore

    req = google.auth.transport.requests.Request()
    return google.oauth2.id_token.fetch_id_token(req, audience)


async def auth_headers(base_url: str) -> dict[str, str]:
    if os.getenv("USE_ID_TOKEN", "0") != "1" or not base_url.startswith("https://"):
        return {}
    tok = _token_cache.get(base_url)
    if tok and tok[1] > time.time():
        return {"Authorization": f"Bearer {tok[0]}"}
    token = await asyncio.to_thread(_fetch_id_token, base_url)
    _token_cache[base_url] = (token, time.time() + 45 * 60)
    return {"Authorization": f"Bearer {token}"}


class ServiceClient:
    """Thin async JSON client for an internal service."""

    def __init__(self, base_url: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout)

    async def post(self, path: str, payload: dict, extra_headers: dict | None = None) -> dict:
        headers = {**(await auth_headers(self.base_url)), **(extra_headers or {})}
        r = await self._client.post(f"{self.base_url}{path}", json=payload, headers=headers)
        r.raise_for_status()
        return r.json()

    async def get(self, path: str, params: dict | None = None, extra_headers: dict | None = None) -> dict:
        headers = {**(await auth_headers(self.base_url)), **(extra_headers or {})}
        r = await self._client.get(f"{self.base_url}{path}", params=params, headers=headers)
        r.raise_for_status()
        return r.json()

    async def aclose(self) -> None:
        await self._client.aclose()
