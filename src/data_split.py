"""
Deterministic, leakage-safe split for SentinelDesk.
    python -m src.data_split

Rules:
  1. One pinned source file (no silent merging of dataset versions).
  2. Drop rows with no body or no labels.
  3. De-duplicate bodies BEFORE splitting (prevents test->KB leakage).
  4. 80/20 split, seed 42, stratified on type|priority.
  5. 10% of KB marked split="val" for threshold tuning (never tune on test).
  6. test_inputs.csv = ticket_id, subject, body only (what inference may see).
"""
import hashlib, json, os, re
import pandas as pd
from sklearn.model_selection import train_test_split

REPO_ID = "Tobi-Bueck/customer-support-tickets"
SOURCE_FILE = os.getenv("TICKETS_CSV", "aa_dataset-tickets-multi-lang-5-2-50-version.csv")
SEED = 42
TARGETS = ["type", "queue", "priority"]
DATA_DIR = "data"


def _norm(s):
    return re.sub(r"\s+", " ", str(s).lower()).strip()


def _strat(d):
    return d["type"].astype(str) + "|" + d["priority"].astype(str)


def load_raw():
    from huggingface_hub import hf_hub_download
    return pd.read_csv(hf_hub_download(REPO_ID, SOURCE_FILE, repo_type="dataset"))


def make_split():
    raw = load_raw()
    df = raw.dropna(subset=["body"] + TARGETS).copy()
    df = df[df["body"].astype(str).str.strip() != ""]
    n_clean = len(df)

    df["_norm"] = df["body"].map(_norm)
    df = df.drop_duplicates("_norm", keep="first")
    n_dedup = len(df)

    df = df.sample(frac=1.0, random_state=SEED).reset_index(drop=True)
    df["ticket_id"] = [f"TKT-{i:05d}" for i in range(len(df))]

    kb, test = train_test_split(df, test_size=0.2, random_state=SEED, stratify=_strat(df))
    val_idx = train_test_split(kb.index, test_size=0.1, random_state=SEED, stratify=_strat(kb))[1]
    kb["split"] = "train"
    kb.loc[val_idx, "split"] = "val"

    kb = kb.drop(columns="_norm").sort_values("ticket_id")
    test = test.drop(columns="_norm").sort_values("ticket_id")

    os.makedirs(DATA_DIR, exist_ok=True)
    kb.to_csv(f"{DATA_DIR}/kb_train.csv", index=False)
    test.to_csv(f"{DATA_DIR}/test.csv", index=False)
    test[["ticket_id", "subject", "body"]].to_csv(f"{DATA_DIR}/test_inputs.csv", index=False)

    manifest = {
        "source_file": SOURCE_FILE, "seed": SEED,
        "rows_raw": len(raw), "rows_after_dropna": n_clean, "rows_after_dedup": n_dedup,
        "kb": len(kb), "kb_train": int((kb.split == "train").sum()), "kb_val": int((kb.split == "val").sum()),
        "test": len(test),
        "test_ids_sha1": hashlib.sha1(",".join(test.ticket_id).encode()).hexdigest()[:12],
        "label_share": {t: {"kb": kb[t].value_counts(normalize=True).round(4).to_dict(),
                            "test": test[t].value_counts(normalize=True).round(4).to_dict()} for t in TARGETS},
    }
    with open(f"{DATA_DIR}/split_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(json.dumps({k: v for k, v in manifest.items() if k != "label_share"}, indent=2))


def load_kb():
    """Full knowledge base (train + val). RAG indexes ALL of this."""
    return pd.read_csv(f"{DATA_DIR}/kb_train.csv")


def load_train_val():
    """Classifier training: fit on train, tune thresholds on val."""
    kb = load_kb()
    return kb[kb.split == "train"].copy(), kb[kb.split == "val"].copy()


def load_test():
    """Holdout WITH labels. Only eval/evaluate.py should call this."""
    return pd.read_csv(f"{DATA_DIR}/test.csv")


def load_test_inputs():
    """Holdout WITHOUT labels/answers. Safe for inference."""
    return pd.read_csv(f"{DATA_DIR}/test_inputs.csv")


if __name__ == "__main__":
    make_split()
