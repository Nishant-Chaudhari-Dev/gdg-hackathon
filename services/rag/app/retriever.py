"""
=====================  RAG TEAM: THIS IS YOUR FILE (1/2)  =====================

Implement `Retriever.load()` and `Retriever.retrieve()`.

Contract (docs/CONTRACT.md §3):
  - index ONLY the 80% kb_train split (never test.csv answers -> disqualification)
  - return top-k RetrievedTicket sorted by score desc
  - `score` MUST be in [0, 1] and comparable across queries (cosine sim is ideal):
    the escalation gate uses max_score < RETRIEVAL_MIN_SCORE (default 0.45) => human review.
    Tell the app owner your calibrated threshold.
  - cross-lingual: a German query should be able to retrieve English precedents (multilingual
    embeddings, e.g. Vertex text-multilingual-embedding-002 or multilingual-e5); set cross_lingual=True
    when any hit language != query language.
  - p95 latency target: < 300 ms

Agreed stack: Vertex AI embeddings + FAISS index stored at INDEX_URI (gs://.../index/ dir).
Until you ship, this falls back to TF-IDF over data/kb_train.csv, or a tiny built-in fixture KB.
================================================================================
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from sentinel_core.artifacts import ensure_local, exists
from sentinel_core.text import clean
from sentinel_core.schemas import RetrievedTicket, RetrieveRequest, RetrieveResponse

FIXTURE = Path(__file__).parent / "fixture_kb.json"


class Retriever:
    version = "fixture-0"

    def __init__(self) -> None:
        self._df = None
        self._vec = None
        self._X = None

    def load(self) -> None:
        import pandas as pd
        from sklearn.feature_extraction.text import TfidfVectorizer

        kb_path = ensure_local(os.getenv("KB_URI", "data/kb_train.csv"))
        if exists(kb_path):
            df = pd.read_csv(kb_path)
            limit = int(os.getenv("KB_LIMIT", "0"))
            if limit:
                df = df.head(limit)
            self.version = f"tfidf-{len(df)}"
        else:
            df = pd.DataFrame(json.loads(FIXTURE.read_text()))
            self.version = "fixture-0"
        df = df.fillna("")
        for col in ("subject", "body", "answer"):
            df[col] = df[col].map(clean)
        df = df[df["answer"] != ""]  # a precedent without a resolution is useless for grounding
        self._df = df.reset_index(drop=True)
        self._vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1, max_features=300_000)
        self._X = self._vec.fit_transform((df["subject"] + "\n" + df["body"]).tolist())
        # RAG TEAM: replace with embeddings + FAISS (load index + metadata from INDEX_URI).

    def retrieve(self, req: RetrieveRequest) -> RetrieveResponse:
        assert self._df is not None
        q = self._vec.transform([f"{req.subject}\n{req.body}"])
        sims = (self._X @ q.T).toarray().ravel()
        idx = sims.argsort()[::-1][: req.k]
        hits = []
        for i in idx:
            r = self._df.iloc[int(i)]
            tags = [str(r.get(f"tag_{n}", "")) for n in range(1, 9) if str(r.get(f"tag_{n}", ""))]
            hits.append(
                RetrievedTicket(
                    ticket_id=str(r["ticket_id"]),
                    # sqrt: rough calibration of raw TF-IDF cosine toward embedding-like scale (stub only)
                    score=round(float(min(max(sims[i], 0.0), 1.0)) ** 0.5, 4),
                    subject=str(r["subject"])[:300],
                    body=str(r["body"])[:600],
                    answer=str(r["answer"])[:1200],
                    language=str(r.get("language", "")) or None,
                    type=str(r.get("type", "")) or None,
                    queue=str(r.get("queue", "")) or None,
                    priority=str(r.get("priority", "")) or None,
                    tags=tags,
                )
            )
        max_score = hits[0].score if hits else 0.0
        cross = any(h.language and req.language and h.language != req.language for h in hits)
        return RetrieveResponse(hits=hits, max_score=max_score, cross_lingual=cross, retriever_version=self.version)
