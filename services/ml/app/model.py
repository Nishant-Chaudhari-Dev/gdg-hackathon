"""
=====================  ML TEAM: THIS IS YOUR FILE  =====================

Implement `TriageModel.load()` and `TriageModel.predict()`.
The HTTP layer (main.py), Docker image and deployment are handled for you.

Contract (see docs/CONTRACT.md §2):
  - input : list[ClassifyRequest]  (subject may be "", body is raw ticket text, PII-masked)
  - output: list[Classification]   (same order, same length)
  - every confidence must be a CALIBRATED probability in [0, 1]
  - `Classification.confidence` = overall confidence the escalation gate thresholds on
  - must never raise on empty subject / weird unicode / very long bodies
  - p95 latency target: < 150 ms per single ticket on Cloud Run (2 vCPU, 4 GiB)

Artifacts: put trained files in GCS and set MODEL_URI (gs://.../model.joblib or a dir ending in "/").
Locally MODEL_URI defaults to research/ml/artifacts/model.joblib.

Until you ship, this falls back to (1) the TF-IDF baseline if `scripts/train_baseline.py`
was run, else (2) a keyword heuristic, so the rest of the system works end-to-end.
=========================================================================
"""
from __future__ import annotations

import math
import os

from sentinel_core.artifacts import ensure_local, exists
from sentinel_core.schemas import Classification, ClassifyRequest, HeadPrediction

from .heuristic import heuristic_predict


class TriageModel:
    version: str = "heuristic-0"

    def __init__(self) -> None:
        self._bundle: dict | None = None

    # ------------------------------------------------------------------ #
    def load(self) -> None:
        path = ensure_local(os.getenv("MODEL_URI", "research/ml/artifacts/model.joblib"))
        if exists(path) and path.endswith(".joblib"):
            import joblib

            self._bundle = joblib.load(path)
            self.version = self._bundle.get("version", "baseline")
        # ML TEAM: load your transformer / LightGBM / etc. here instead.

    # ------------------------------------------------------------------ #
    def predict(self, items: list[ClassifyRequest]) -> list[Classification]:
        if self._bundle is None:
            return [heuristic_predict(i.subject, i.body, self.version) for i in items]

        texts = [f"{i.subject or ''}\n{i.body or ''}" for i in items]
        X = self._bundle["vectorizer"].transform(texts)
        heads: dict[str, list[HeadPrediction]] = {}
        for name, clf in self._bundle["heads"].items():
            proba = clf.predict_proba(X)
            labels = list(clf.classes_)
            preds = []
            for row in proba:
                j = int(row.argmax())
                preds.append(
                    HeadPrediction(
                        label=str(labels[j]),
                        confidence=float(row[j]),
                        probs={str(l): round(float(p), 4) for l, p in zip(labels, row)},
                    )
                )
            heads[name] = preds

        out = []
        for k in range(len(items)):
            t, q, p = heads["type"][k], heads["queue"][k], heads["priority"][k]
            overall = math.exp((math.log(t.confidence) + math.log(q.confidence) + math.log(p.confidence)) / 3)
            out.append(Classification(type=t, queue=q, priority=p, confidence=round(overall, 4), model_version=self.version))
        return out
