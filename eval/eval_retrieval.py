"""Retrieval (RAG precedent search) metrics on the 20% holdout.

Owner: RAG team (Nishant).
Run from the repo root (after `python research/rag/build_index.py`):
    python eval/eval_retrieval.py [--sample N]

Evaluates the same Retriever class the RAG service runs (services/rag/app/retriever.py).

Leakage rules followed here:
  * Queries use ONLY the holdout subject + body.
  * The holdout `answer` column is never loaded (usecols excludes it).
  * Holdout type/queue/priority are read only to SCORE results after retrieval.
  * The index contains only data/kb_train.csv tickets (see research/rag/build_index.py).

Writes eval/results/retrieval_metrics.json.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sentinel_core.schemas import RetrieveRequest  # noqa: E402
from services.rag.app.retriever import Retriever, guess_language, resolve_index_dir, ticket_text  # noqa: E402

TEST_CSV = ROOT / "data" / "test.csv"
NEAR_DUPS = ROOT / "data" / "test_near_dup_ids.csv"
OUT = ROOT / "eval" / "results" / "retrieval_metrics.json"
K = 5
LABELS = ("queue", "type", "priority")


def macro_f1(y_true, y_pred) -> float:
    from sklearn.metrics import f1_score

    return round(float(f1_score(y_true, y_pred, average="macro", zero_division=0)), 4)


def block(df: pd.DataFrame, gate: dict) -> dict:
    out = {"n": int(len(df))}
    for f in LABELS:
        out[f] = {
            "top1_agreement": round(float((df[f"{f}_top1"] == df[f"{f}_true"]).mean()), 4),
            "precision@5": round(float(df[f"{f}_p@5"].mean()), 4),
            "knn_vote_accuracy": round(float((df[f"{f}_vote"] == df[f"{f}_true"]).mean()), 4),
            "knn_vote_macro_f1": macro_f1(df[f"{f}_true"], df[f"{f}_vote"]),
        }
    out["top1_same_language_rate"] = round(float(df["top1_same_lang"].mean()), 4)
    out["any_cross_lingual_hit_rate"] = round(float(df["cross_lingual"].mean()), 4)
    for name, t in gate.items():
        out[f"below_{name}_rate"] = round(float((df["top1_score"] < t).mean()), 4)
    out["top1_score_percentiles"] = {
        f"p{p}": round(float(np.percentile(df["top1_score"], p)), 4) for p in (5, 25, 50, 75, 95)
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="evaluate a random subset (0 = full holdout)")
    ap.add_argument("--latency-n", type=int, default=200)
    args = ap.parse_args()

    test = pd.read_csv(TEST_CSV, usecols=["ticket_id", "subject", "body", *LABELS])  # no `answer`
    if args.sample:
        test = test.sample(n=min(args.sample, len(test)), random_state=0)
    test = test.reset_index(drop=True)

    index_dir = resolve_index_dir()
    if not index_dir:
        raise SystemExit("No index found. Run: python research/rag/build_index.py")
    r = Retriever()
    r._load_dense(Path(index_dir))
    meta = r._meta
    cal_path = Path(index_dir) / "calibration.json"
    gate = json.loads(cal_path.read_text(encoding="utf-8"))["recommended_env"] if cal_path.exists() else {}

    texts = [ticket_text(s, b) for s, b in zip(test["subject"], test["body"])]
    qlang = [guess_language(t) or "?" for t in texts]  # like the gateway: language from the text
    t0 = time.time()
    qv = r._enc.encode(texts, batch_size=128, show_progress=True)
    all_hits = r.search_vectors(qv, K)
    batch_secs = time.time() - t0

    near_dup_ids = set(pd.read_csv(NEAR_DUPS)["ticket_id"]) if NEAR_DUPS.exists() else set()
    rows = []
    for (_, q), hits, lang in zip(test.iterrows(), all_hits, qlang):
        if not hits:
            continue
        row = {"near_dup": q["ticket_id"] in near_dup_ids, "top1_score": hits[0]["score"],
               "top1_same_lang": hits[0]["language"] == lang,
               "cross_lingual": any(h["language"] != lang for h in hits)}
        for f in LABELS:
            vals = [h[f] for h in hits]
            row[f"{f}_true"] = q[f]
            row[f"{f}_top1"] = vals[0]
            row[f"{f}_vote"] = max(set(vals), key=lambda v: (vals.count(v), -vals.index(v)))
            row[f"{f}_p@5"] = float(np.mean([v == q[f] for v in vals]))
        rows.append(row)
    res = pd.DataFrame(rows)

    # Cross-lingual: search ONLY the other language's precedents (language detected from text).
    kb_vecs = r._index.reconstruct_n(0, r._index.ntotal)
    qlang_arr = np.array(qlang)
    cross = {}
    for src, tgt in (("de", "en"), ("en", "de")):
        qmask, tmask = qlang_arr == src, (meta["language"] == tgt).to_numpy()
        if not qmask.any() or not tmask.any():
            continue
        sims = qv[qmask] @ kb_vecs[tmask].T
        best = sims.argmax(1)
        tgt_meta, q = meta[tmask].reset_index(drop=True), test[qmask].reset_index(drop=True)
        cross[f"{src}_query_to_{tgt}_kb_only"] = {
            "n": int(qmask.sum()),
            "queue_top1_agreement": round(float((tgt_meta.loc[best, "queue"].to_numpy() == q["queue"].to_numpy()).mean()), 4),
            "type_top1_agreement": round(float((tgt_meta.loc[best, "type"].to_numpy() == q["type"].to_numpy()).mean()), 4),
            "median_top1_score": round(float(np.median(sims.max(1))), 4),
        }

    # Single-request latency through the service's retrieve() (encode + search + response model).
    lat = []
    for s, b in zip(test["subject"][: args.latency_n], test["body"][: args.latency_n]):
        req = RetrieveRequest(subject="" if pd.isna(s) else str(s), body=str(b), k=K)
        t = time.perf_counter()
        r.retrieve(req)
        lat.append((time.perf_counter() - t) * 1000)

    metrics = {
        "index": r.info,
        "k": K,
        "gate_thresholds": gate,
        "holdout_all": block(res, gate),
        "holdout_excluding_near_dups": block(res[~res["near_dup"]], gate),
        "cross_lingual": cross,
        "latency_ms_single_query": {"p50": round(float(np.percentile(lat, 50)), 1),
                                    "p95": round(float(np.percentile(lat, 95)), 1),
                                    "n": len(lat), "device": r._enc.device},
        "batch_throughput_qps": round(len(texts) / batch_secs, 1),
        "notes": "top1_agreement / kNN vote = label agreement of retrieved precedents with the holdout "
                 "ticket. Languages (query and precedent) are detected from text, because the dataset's "
                 "language column is wrong for ~27% of rows labelled 'de'.",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in metrics.items() if k != "index"}, indent=2))


if __name__ == "__main__":
    main()
