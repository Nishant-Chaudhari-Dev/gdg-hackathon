"""Fetch model/index/data artifacts from GCS (cloud) or local disk (dev).

Usage: path = ensure_local(os.getenv("KB_URI", "data/kb_train.csv"))
  - "gs://bucket/path/file" -> downloaded once to /tmp/artifacts/... and that local path returned
  - anything else           -> returned unchanged (may not exist; caller decides fallback)
"""
from __future__ import annotations

import os
from pathlib import Path


def ensure_local(uri: str | None, cache_dir: str = "/tmp/artifacts") -> str | None:
    if not uri:
        return None
    if not uri.startswith("gs://"):
        return uri
    from google.cloud import storage  # type: ignore

    bucket_name, _, blob_path = uri[5:].partition("/")
    dest = Path(cache_dir) / bucket_name / blob_path
    if dest.exists():
        return str(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    if blob_path.endswith("/"):  # directory prefix
        for blob in client.list_blobs(bucket_name, prefix=blob_path):
            if blob.name.endswith("/"):
                continue
            p = Path(cache_dir) / bucket_name / blob.name
            p.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(str(p))
        return str(dest)
    bucket.blob(blob_path).download_to_filename(str(dest))
    return str(dest)


def exists(path: str | None) -> bool:
    return bool(path) and os.path.exists(path)  # type: ignore[arg-type]
