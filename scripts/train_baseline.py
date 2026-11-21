"""Reference baseline: TF-IDF + logistic regression, one head per target.

Produces research/ml/artifacts/model.joblib in the exact bundle format services/ml/app/model.py loads.
ML team: beat this, then either keep this bundle format or rewrite model.py for your model.

    python scripts/train_baseline.py            # trains on data/kb_train.csv (80% split ONLY)
"""
from __future__ import annotations

import os
import sys
import time

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

KB = os.getenv("KB_PATH", "data/kb_train.csv")
OUT = os.getenv("MODEL_OUT", "research/ml/artifacts/model.joblib")


def main() -> None:
    if not os.path.exists(KB):
        sys.exit(f"{KB} not found. Run: python scripts/data_split.py")
    df = pd.read_csv(KB)
    df = df.dropna(subset=["body", "type", "queue", "priority"])
    text = (df["subject"].fillna("") + "\n" + df["body"].fillna("")).tolist()
    t0 = time.time()
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=200_000, sublinear_tf=True)
    X = vec.fit_transform(text)
    heads = {}
    for head in ("type", "queue", "priority"):
        clf = LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced", n_jobs=-1)
        clf.fit(X, df[head].astype(str))
        heads[head] = clf
        print(f"trained {head}: {len(clf.classes_)} classes")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    joblib.dump({"version": f"tfidf-lr-{int(time.time())}", "vectorizer": vec, "heads": heads}, OUT)
    print(f"saved {OUT} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
