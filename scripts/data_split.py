"""Canonical 80/20 split. EVERY team member must use this exact split (seed 42) so metrics are comparable.

Outputs (gitignored):
  data/kb_train.csv     80%  -> classifier training + RAG index (answers allowed)
  data/test.csv         20%  -> holdout WITH labels, used ONLY by eval/evaluate.py for scoring
  data/test_inputs.csv  20%  -> holdout inputs only (ticket_id, subject, body) for simulators/demos

    python scripts/data_split.py
"""
import os

import pandas as pd
from datasets import load_dataset


def make_split() -> None:
    # Logic identical to the problem statement's quick-start snippet (do not change seed/order).
    ds = load_dataset("Tobi-Bueck/customer-support-tickets")
    df = ds["train"].to_pandas()
    df = df.sample(frac=1.0, random_state=42).reset_index(drop=True)
    df["ticket_id"] = [f"TKT-{i:05d}" for i in range(len(df))]
    split_idx = int(len(df) * 0.8)
    os.makedirs("data", exist_ok=True)
    kb, test = df.iloc[:split_idx], df.iloc[split_idx:]
    kb.to_csv("data/kb_train.csv", index=False)
    test.to_csv("data/test.csv", index=False)
    test[["ticket_id", "subject", "body"]].to_csv("data/test_inputs.csv", index=False)
    print(f"kb_train={len(kb)} test={len(test)} columns={list(df.columns)}")


def load_kb() -> pd.DataFrame:
    return pd.read_csv("data/kb_train.csv")


def load_test() -> pd.DataFrame:
    return pd.read_csv("data/test.csv")


if __name__ == "__main__":
    make_split()
