"""
Fit calibration + decision settings for the ML service and store them INSIDE the model bundle.

Run from the repo root, after `python scripts/train_baseline.py` (or once your own bundle exists):
    python research/ml/fit_postprocess.py                    # dry run: prints the report only
    python research/ml/fit_postprocess.py --write            # saves bundle["post"] into the model file
    python research/ml/fit_postprocess.py --high-threshold 0.2 --write

Fits on split==val ONLY (never test.csv). For an honest report it fits on half A of val and scores on half B,
then refits on all of val for the saved numbers. Works with the baseline bundle format
{"vectorizer", "heads"}; for another model, produce val probabilities per head and reuse fit_T / temp_scale.
"""
import argparse
import os

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar

HEADS = ("type", "queue", "priority")
GATE_CONF = float(os.getenv("GATE_MIN_CONFIDENCE", "0.55"))


def temp_scale(p, T):
    z = np.log(np.clip(p, 1e-9, 1)) / T
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_T(p, y_idx):
    nll = lambda T: -np.log(np.clip(temp_scale(p, T)[np.arange(len(y_idx)), y_idx], 1e-9, 1)).mean()
    return float(minimize_scalar(nll, bounds=(0.2, 5.0), method="bounded").x)


def ece(conf, correct, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    return sum(((conf > lo) & (conf <= hi)).mean() * abs(conf[(conf > lo) & (conf <= hi)].mean()
               - correct[(conf > lo) & (conf <= hi)].mean())
               for lo, hi in zip(edges[:-1], edges[1:]) if ((conf > lo) & (conf <= hi)).any())


def overall(probs):
    """Overall confidence = geometric mean of each head's top probability."""
    return np.exp(sum(np.log(np.clip(probs[h].max(1), 1e-9, 1)) for h in HEADS) / len(HEADS))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.getenv("MODEL_PATH", "research/ml/artifacts/model.joblib"))
    ap.add_argument("--kb", default=os.getenv("KB_PATH", "data/kb_train.csv"))
    ap.add_argument("--high-threshold", type=float, default=0.2,
                    help="label a ticket priority=high when calibrated P(high) >= this")
    ap.add_argument("--write", action="store_true", help="save the settings into the model file")
    a = ap.parse_args()

    bundle = joblib.load(a.model)
    df = pd.read_csv(a.kb).dropna(subset=["body", *HEADS])
    va = df[df.split == "val"].reset_index(drop=True)
    text = (va["subject"].fillna("") + "\n" + va["body"].fillna("")).tolist()
    X = bundle["vectorizer"].transform(text)
    P = {h: bundle["heads"][h].predict_proba(X) for h in HEADS}
    labels = {h: list(bundle["heads"][h].classes_) for h in HEADS}
    y = {h: va[h].astype(str).values for h in HEADS}
    y_idx = {h: np.array([labels[h].index(v) for v in y[h]]) for h in HEADS}
    print(f"model {bundle.get('version')} | val tickets {len(va)}")

    # --- honest check: fit on half A, report on half B ---
    perm = np.random.RandomState(42).permutation(len(va))
    A, B = perm[: len(va) // 2], perm[len(va) // 2:]
    Pb = {}
    print("\nCalibration (ECE on half B, lower is better):")
    for h in HEADS:
        T = fit_T(P[h][A], y_idx[h][A])
        Pb[h] = temp_scale(P[h][B], T)
        ok = P[h][B].argmax(1) == y_idx[h][B]
        print(f"  {h:9} raw {ece(P[h][B].max(1), ok):.3f} -> scaled {ece(Pb[h].max(1), ok):.3f}  (T={T:.2f})")

    hi, inc = labels["priority"].index("high"), labels["type"].index("Incident")
    true_hpi = (y["priority"][B] == "high") & (y["type"][B] == "Incident")
    low_conf = overall(Pb) < GATE_CONF
    pred_inc = Pb["type"].argmax(1) == inc
    print(f"\nGate rules 1+2 on half B ({true_hpi.sum()} real high-priority incidents of {len(B)}), "
          f"confidence threshold {GATE_CONF}:")
    print(f"  {'priority=high when':22} {'escalate':>9} {'HPI recall':>11}")
    for t in (None, 0.4, 0.3, 0.2):
        flag = (Pb["priority"].argmax(1) == hi) if t is None else (Pb["priority"][:, hi] >= t)
        esc = (flag & pred_inc) | low_conf
        print(f"  {('top guess' if t is None else f'P(high) >= {t}'):22} {esc.mean():9.1%} {esc[true_hpi].mean():11.1%}")

    # --- final fit on all of val ---
    post = {"version": 1, "temps": {h: fit_T(P[h], y_idx[h]) for h in HEADS}, "high_threshold": a.high_threshold}
    print(f"\nSettings to save: {post}")
    if a.write:
        bundle["post"] = post
        joblib.dump(bundle, a.model)
        print(f"Saved into {a.model} as bundle['post']. Upload the model file to GCS as usual.")
    else:
        print("Dry run. Add --write to save.")


if __name__ == "__main__":
    main()