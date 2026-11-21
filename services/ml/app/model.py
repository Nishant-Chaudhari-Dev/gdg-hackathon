"""
ML service model: TF-IDF (word + char) features; each head = best of LR / LinearSVC / SGD / ensembles,
optionally blended with a kNN vote of similar training tickets (word TF-IDF cosine), all picked on
split==val by research/ml/train.py. Temperature/bias calibration fitted on split==val,
recall-tuned threshold for priority=high. Contract: docs/CONTRACT.md §2.

Overall confidence = weighted geometric mean of the three calibrated head confidences
(weights from the bundle; default type 1, queue 1, priority 2).
Never raises: any failure falls back to the keyword heuristic.
"""
from __future__ import annotations

import math
import os

import numpy as np
from sklearn.preprocessing import normalize

from sentinel_core.artifacts import ensure_local, exists
from sentinel_core.schemas import Classification, ClassifyRequest, HeadPrediction
from sentinel_core.text import clean

from .heuristic import heuristic_predict

HEADS = ("type", "queue", "priority")
MAX_CHARS = 8000


def build_text(subject, body) -> str:  # MUST match research/ml/train.py
    s, b = clean(subject), clean(body)
    return f"{s}\n{s}\n{b}" if s else b


def _softmax(Z: np.ndarray) -> np.ndarray:
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


def _knn_probs(nb_idx, nb_sim, ytr, n_cls, k, p) -> np.ndarray:  # MUST match knn_probs in research/ml/train.py
    nb = ytr[nb_idx[:, :k]]
    w = np.clip(nb_sim[:, :k], 0, None) ** p
    P = np.stack([(w * (nb == j)).sum(1) for j in range(n_cls)], axis=1) + 1e-9
    return P / P.sum(1, keepdims=True)


class TriageModel:
    version: str = "heuristic-0"

    def __init__(self) -> None:
        self._b: dict | None = None
        self._knn: dict | None = None

    def load(self) -> None:
        try:
            path = ensure_local(os.getenv("MODEL_URI", "research/ml/artifacts/model.joblib"))
            if exists(path) and path.endswith(".joblib"):
                import joblib

                b = joblib.load(path)
                self._feat = b.get("featurizer") or b.get("vectorizer")  # old baseline bundles still load
                self._heads = b["heads"]
                self._cal = b.get("calibration", {})
                self._dec = b.get("decision", {})
                self._thr = b.get("high_thr")
                self._w = b.get("weights", {"type": 1.0, "queue": 1.0, "priority": 1.0})
                self._knn = b.get("knn")  # None for bundles without the kNN vote
                self.version = b.get("version", "unknown")
                self._b = b
        except Exception:
            self._b = None

    def predict(self, items: list[ClassifyRequest]) -> list[Classification]:
        if not items:
            return []
        if self._b is not None:
            try:
                return self._predict(items)
            except Exception:
                pass
        return [heuristic_predict(i.subject, i.body, self.version) for i in items]

    def _neighbours(self, X):
        knn = self._knn
        kmax = max(k for k, p, a in knn["params"].values())
        S = (normalize(X[:, :knn["n_word"]]) @ knn["XtrT"]).toarray()
        idx = np.argpartition(-S, kmax - 1, axis=1)[:, :kmax]
        sims = np.take_along_axis(S, idx, 1)
        order = np.argsort(-sims, axis=1)
        return np.take_along_axis(idx, order, 1), np.take_along_axis(sims, order, 1)

    def _predict(self, items: list[ClassifyRequest]) -> list[Classification]:
        X = self._feat.transform([build_text(i.subject, (i.body or "")[:MAX_CHARS]) for i in items])
        use_knn = bool(self._knn and self._knn.get("params"))
        if use_knn:
            nb_idx, nb_sim = self._neighbours(X)
        per_head: dict[str, list[HeadPrediction]] = {}
        for h in HEADS:
            members = self._heads[h] if isinstance(self._heads[h], (list, tuple)) else [self._heads[h]]
            labels = [str(c) for c in members[0].classes_]
            raw = np.mean([m.predict_proba(X) for m in members], axis=0)
            if use_knn and h in self._knn["params"]:
                k, p, a = self._knn["params"][h]
                raw = (1 - a) * raw + a * _knn_probs(nb_idx, nb_sim, self._knn["y"][h], len(labels), k, p)
            T, bias = self._cal.get(h, (1.0, None))
            L = np.log(np.clip(raw, 1e-9, 1.0)) / T
            cal = _softmax(L + bias if bias is not None else L)
            idx = (cal if self._dec.get(h) == "cal" else raw).argmax(1)
            if h == "priority" and self._thr is not None and "high" in labels:
                hi = labels.index("high")
                idx = np.where(cal[:, hi] >= self._thr, hi, idx)
            per_head[h] = [
                HeadPrediction(
                    label=labels[j],
                    confidence=float(min(max(cal[k_, j], 0.0), 1.0)),
                    probs={l: round(float(p_), 4) for l, p_ in zip(labels, cal[k_])},
                )
                for k_, j in enumerate(idx)
            ]
        wsum = sum(self._w.get(h, 1.0) for h in HEADS)
        out = []
        for k_ in range(len(items)):
            hp = {h: per_head[h][k_] for h in HEADS}
            overall = math.exp(sum(self._w.get(h, 1.0) * math.log(max(hp[h].confidence, 1e-6)) for h in HEADS) / wsum)
            out.append(Classification(type=hp["type"], queue=hp["queue"], priority=hp["priority"],
                                      confidence=round(min(max(overall, 0.0), 1.0), 4), model_version=self.version))
        return out
