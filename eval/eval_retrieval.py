"""Retrieval (RAG precedent search) metrics on the 20% holdout.

Owner: RAG team (Nishant).   Run:  python eval/eval_retrieval.py [--sample N]

Leakage rules followed here:
  * Queries use ONLY the holdout subject + body.
  * The holdout `answer` column is never loaded (usecols excludes it).
  * Holdout type/queue/priority are read only to SCORE results after retrieval.
  * The index contains only data/kb_train.csv tickets (see src/retrieval.py).

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

from src.retrieval import (  # noqa: E402
    _dedup_key,
    _get_retriever,
    embed,
    no_precedent_threshold,
    retrieve,
    ticket_text,
)

TEST_CSV = ROOT / "data" / "test.csv"
OUT = ROOT / "eval" / "results" / "retrieval_metrics.json"
K = 5


def macro_f1(y_true, y_pred) -> float:
    from sklearn.metrics import f1_score

    return round(float(f1_score(y_true, y_pred, average="macro", zero_division=0)), 4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="evaluate a random subset (0 = full holdout)")
    ap.add_argument("--latency-n", type=int, default=200)
    args = ap.parse_args()

    cols = ["ticket_id", "subject", "body", "type", "queue", "priority", "language"]
    test = pd.read_csv(TEST_CSV, usecols=cols)  # NOTE: no `answer` column is loaded
    if args.sample:
        test = test.sample(n=min(args.sample, len(test)), random_state=0)
    test = test.reset_index(drop=True)

    r = _get_retriever()
    meta = r.meta
    thr = no_precedent_threshold()

    # ---- batched retrieval for the whole holdout -------------------------------------
    texts = [ticket_text(s, b) for s, b in zip(test["subject"], test["body"])]
    t0 = time.time()
    qv = embed(texts, batch_size=128, show_progress=True)
    scores, ids = r.index.search(qv, K * 4)
    batch_secs = time.time() - t0

    top_hits = []
    for sc, ix in zip(scores, ids):
        top_hits.append(r._hits_from(sc, ix, K))

    kb_keys = set(meta["dedup_key"])
    seen_in_kb = np.array([_dedup_key(t) in kb_keys for t in texts])
    near_dup_file = ROOT / "data" / "test_near_dup_ids.csv"  # from src/data_split.py
    near_dup_ids = set(pd.read_csv(near_dup_file)["ticket_id"]) if near_dup_file.exists() else set()

    rows = []
    for (_, q), hits, seen in zip(test.iterrows(), top_hits, seen_in_kb):
        if not hits:
            continue
        top = hits[0]
        row = {"seen": bool(seen), "near_dup": q["ticket_id"] in near_dup_ids,
               "lang": q["language"], "top1_score": top["score"],
               "top1_same_lang": top["language"] == q["language"]}
        for f in ("queue", "type", "priority"):
            true = q[f]
            vals = [h[f] for h in hits]
            row[f"{f}_true"] = true
            row[f"{f}_top1"] = top[f]
            row[f"{f}_vote"] = max(set(vals), key=lambda v: (vals.count(v), -vals.index(v)))
            row[f"{f}_p@5"] = float(np.mean([v == true for v in vals])) if pd.notna(true) else np.nan
        rows.append(row)
    res = pd.DataFrame(rows)

    def block(df: pd.DataFrame) -> dict:
        out = {"n": int(len(df))}
        for f in ("queue", "type", "priority"):
            d = df[df[f"{f}_true"].notna()]
            out[f] = {
                "top1_agreement": round(float((d[f"{f}_top1"] == d[f"{f}_true"]).mean()), 4),
                "precision@5": round(float(d[f"{f}_p@5"].mean()), 4),
                "knn_vote_accuracy": round(float((d[f"{f}_vote"] == d[f"{f}_true"]).mean()), 4),
                "knn_vote_macro_f1": macro_f1(d[f"{f}_true"], d[f"{f}_vote"]),
            }
        out["top1_same_language_rate"] = round(float(df["top1_same_lang"].mean()), 4)
        out["below_no_precedent_threshold_rate"] = round(float((df["top1_score"] < thr).mean()), 4)
        out["top1_score_percentiles"] = {
            f"p{p}": round(float(np.percentile(df["top1_score"], p)), 4) for p in (5, 25, 50, 75, 95)
        }
        return out

    # ---- cross-lingual: search only the OTHER language's precedents -----------------
    kb_vecs = r.index.reconstruct_n(0, r.index.ntotal)
    cross = {}
    for src_lang, tgt_lang in (("de", "en"), ("en", "de")):
        qmask = (test["language"] == src_lang).to_numpy()
        tmask = (meta["language"] == tgt_lang).to_numpy()
        if qmask.sum() == 0 or tmask.sum() == 0:
            continue
        sims = qv[qmask] @ kb_vecs[tmask].T
        best = sims.argmax(1)
        tgt_meta = meta[tmask].reset_index(drop=True)
        q = test[qmask].reset_index(drop=True)
        cross[f"{src_lang}_query_to_{tgt_lang}_kb"] = {
            "n": int(qmask.sum()),
            "queue_top1_agreement": round(float((tgt_meta.loc[best, "queue"].to_numpy() == q["queue"].to_numpy()).mean()), 4),
            "type_top1_agreement": round(float((tgt_meta.loc[best, "type"].to_numpy() == q["type"].to_numpy()).mean()), 4),
            "median_top1_score": round(float(np.median(sims.max(1))), 4),
        }

    # ---- single-query latency (what a live demo user feels) -------------------------
    lat = []
    for s, b in zip(test["subject"][: args.latency_n], test["body"][: args.latency_n]):
        t = time.perf_counter()
        retrieve(s, b, k=K)
        lat.append((time.perf_counter() - t) * 1000)

    # Rows whose labels can occur in the index at all. The German-normalised source rows
    # carry 42 extra queues and critical/very_low priorities but no answers, so they are
    # never indexed and their labels can never be matched by a precedent.
    in_space = (
        res["queue_true"].isin(set(meta["queue"]))
        & res["priority_true"].isin(set(meta["priority"]))
        & res["type_true"].notna()
    )

    metrics = {
        "index": r.info,
        "k": K,
        "no_precedent_threshold": thr,
        "holdout_in_kb_label_space": block(res[in_space]),
        "holdout_all": block(res),
        "holdout_excluding_near_dups": block(res[~res["near_dup"]]),
        "holdout_unseen_text_only": block(res[~res["seen"]]),
        "holdout_exact_text_also_in_kb_rate": round(float(res["seen"].mean()), 4),
        "cross_lingual": cross,
        "latency_ms_single_query": {
            "p50": round(float(np.percentile(lat, 50)), 1),
            "p95": round(float(np.percentile(lat, 95)), 1),
            "n": len(lat),
        },
        "batch_throughput_qps": round(len(texts) / batch_secs, 1),
        "notes": "queue/type/priority 'top1_agreement' and kNN vote are label agreement of retrieved "
                 "precedents with the holdout ticket; type is NaN for ~21% of rows (German-normalised "
                 "source) and those rows are excluded from type metrics.",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(metrics, indent=2))
    print(json.dumps({k: v for k, v in metrics.items() if k != "index"}, indent=2))


if __name__ == "__main__":
    main()
