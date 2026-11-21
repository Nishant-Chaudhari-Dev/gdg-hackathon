"""Holdout evaluation against the RUNNING ml-service (local or Cloud Run).

Only subject + body are sent to the model; labels from data/test.csv are used solely for scoring.
Writes eval/results/latest.json (rendered on the console's Metrics page) and optionally uploads to GCS.

    python eval/evaluate.py                                  # ml at http://localhost:8001, full test split
    python eval/evaluate.py --limit 2000 --ml-url https://ml-xxxx.run.app --upload gs://BUCKET/eval/latest.json
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone

import httpx
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))
from sentinel_core.http import auth_headers  # noqa: E402

HEADS = ("type", "queue", "priority")


def head_report(y_true: list[str], y_pred: list[str]) -> dict:
    labels = sorted(set(y_true) | set(y_pred))
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=labels, zero_division=0)
    return {
        "macro_f1": round(float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)), 4),
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "labels": labels,
        "confusion": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
        "per_class": {l: {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                          "f1": round(float(f[i]), 4), "support": int(s[i])} for i, l in enumerate(labels)},
    }


def pct(v: list[float]) -> dict:
    v = sorted(v)
    if not v:
        return {"p50": 0, "p95": 0, "mean": 0, "n": 0}
    return {"p50": round(v[len(v) // 2], 1), "p95": round(v[int(0.95 * (len(v) - 1))], 1),
            "mean": round(statistics.mean(v), 1), "n": len(v)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", default="data/test.csv")
    ap.add_argument("--ml-url", default=os.getenv("ML_URL", "http://localhost:8001"))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--latency-sample", type=int, default=100)
    ap.add_argument("--min-confidence", type=float, default=float(os.getenv("GATE_MIN_CONFIDENCE", "0.55")))
    ap.add_argument("--out", default="eval/results/latest.json")
    ap.add_argument("--upload", default=os.getenv("EVAL_REPORT_URI", ""))
    a = ap.parse_args()

    df = pd.read_csv(a.test)
    if a.limit:
        df = df.sample(n=min(a.limit, len(df)), random_state=0)
    df = df.dropna(subset=["body"]).reset_index(drop=True)
    inputs = [{"subject": "" if pd.isna(s) else str(s), "body": str(b)} for s, b in zip(df["subject"], df["body"])]

    import asyncio

    headers = asyncio.run(auth_headers(a.ml_url))
    client = httpx.Client(base_url=a.ml_url, timeout=120, headers=headers)
    info = client.get("/health").json()

    preds: list[dict] = []
    t0 = time.time()
    for i in range(0, len(inputs), a.batch):
        r = client.post("/classify/batch", json={"items": inputs[i : i + a.batch]})
        r.raise_for_status()
        preds += r.json()["results"]
        print(f"\rclassified {len(preds)}/{len(inputs)}", end="", flush=True)
    print(f"  ({time.time() - t0:.1f}s)")

    lat = []
    for item in inputs[: a.latency_sample]:
        t = time.perf_counter()
        client.post("/classify", json=item).raise_for_status()
        lat.append((time.perf_counter() - t) * 1000)

    report: dict = {"generated_at": datetime.now(timezone.utc).isoformat(), "n_test": len(df),
                    "model_version": info.get("version", "unknown"), "heads": {}}
    for h in HEADS:
        # Score each head only on rows that carry that label (dataset mixes versions with null labels).
        idx = [i for i in range(len(df)) if isinstance(df.loc[i, h], str) and df.loc[i, h]]
        report["heads"][h] = head_report([str(df.loc[i, h]) for i in idx], [str(preds[i][h]["label"]) for i in idx])
        report["heads"][h]["n_scored"] = len(idx)

    hp = [(i, p) for i, p in enumerate(preds) if df.loc[i, "priority"] == "high" and df.loc[i, "type"] == "Incident"]
    caught = sum(1 for _, p in hp if p["priority"]["label"] == "high" and p["type"]["label"] == "Incident")
    escalated = sum(1 for _, p in hp if (p["priority"]["label"] == "high" and p["type"]["label"] == "Incident")
                    or p["confidence"] < a.min_confidence)
    esc_all = sum(1 for p in preds if (p["priority"]["label"] == "high" and p["type"]["label"] == "Incident")
                  or p["confidence"] < a.min_confidence)
    report["high_priority_incident_recall"] = round(caught / len(hp), 4) if hp else 0.0
    report["escalation"] = {"rate": round(esc_all / len(preds), 4) if preds else 0.0,
                            "hp_incident_escalated_recall": round(escalated / len(hp), 4) if hp else 0.0}
    report["latency_ms"] = pct(lat)
    report["notes"] = (f"Holdout n={len(df)}; HP-incident support={len(hp)}; gate min_confidence={a.min_confidence}. "
                       "Escalation figures cover classifier-driven rules only.")

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({h: report["heads"][h]["macro_f1"] for h in HEADS} | {
        "hp_incident_recall": report["high_priority_incident_recall"], **report["escalation"], "latency": report["latency_ms"]}, indent=2))
    print(f"wrote {a.out}")

    if a.upload.startswith("gs://"):
        from google.cloud import storage  # type: ignore

        bucket, _, path = a.upload[5:].partition("/")
        storage.Client(project=os.getenv("GCP_PROJECT")).bucket(bucket).blob(path).upload_from_filename(a.out, content_type="application/json")
        print(f"uploaded {a.upload}")


if __name__ == "__main__":
    main()
