"""Precedent retrieval (the "R" in RAG) over the 80% historical knowledge base.

Owners: RAG team (Nishant, Chitta).

Build the index once (after `python -m src.data_split`):
    python -m src.retrieval --build
Tune the "no precedent" escalation threshold (uses KB tickets only, never the holdout):
    python -m src.retrieval --calibrate
Try a query from the terminal:
    python -m src.retrieval --query "VPN keeps disconnecting since this morning"

Used by the pipeline:
    from src.retrieval import retrieve
    hits = retrieve(subject, body, k=5)   # list of dicts, best match first

Leakage rule: the index is built ONLY from data/kb_train.csv. This module never reads
data/test.csv, so holdout answers and labels cannot end up in the index.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

try:  # Use the Windows/macOS certificate store (needed on networks that re-sign TLS).
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent.parent
KB_CSV = ROOT / "data" / "kb_train.csv"
ART_DIR = ROOT / "artifacts"
INDEX_PATH = ART_DIR / "kb.faiss"
META_PATH = ART_DIR / "kb_meta.parquet"
INFO_PATH = ART_DIR / "kb_info.json"
CALIB_PATH = ART_DIR / "retrieval_calibration.json"

# Multilingual model: an English precedent can match a German ticket and vice versa.
EMBED_MODEL = os.getenv("EMBED_MODEL", "intfloat/multilingual-e5-small")
MAX_SEQ_LEN = 256
# e5 models expect a task prefix. Ticket-to-ticket similarity is a symmetric task, so the
# e5 model card says to use "query: " on both sides.
PREFIX = "query: " if "e5" in EMBED_MODEL.lower() else ""

# Used only until `--calibrate` has written artifacts/retrieval_calibration.json.
# Value from the 2026-11-21 calibration on Tanish's split with multilingual-e5-small:
# catches 16/16 off-topic requests and flags 1/18 hand-written real tickets.
FALLBACK_NO_PRECEDENT_THRESHOLD = 0.87

META_COLS = ["ticket_id", "subject", "body", "answer", "type", "queue", "priority", "language", "split"]


# --------------------------------------------------------------------------- text utils
def _clean(value) -> str:
    """None / NaN / non-string -> '' ; otherwise stripped string. Handles null subjects."""
    if value is None:
        return ""
    if isinstance(value, float) and np.isnan(value):
        return ""
    return str(value).strip()


def ticket_text(subject, body) -> str:
    """Single string used for embedding: subject (if any) + body, whitespace collapsed."""
    s, b = _clean(subject), _clean(body)
    text = f"{s}\n{b}" if s else b
    return re.sub(r"\s+", " ", text).strip()[:4000]


def _dedup_key(text: str) -> str:
    return hashlib.md5(text.lower().encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- embeddings
@lru_cache(maxsize=1)
def _model():
    import torch
    from sentence_transformers import SentenceTransformer

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(EMBED_MODEL, device=device)
    model.max_seq_length = MAX_SEQ_LEN
    return model


def embed(texts: list[str], batch_size: int = 64, show_progress: bool = False) -> np.ndarray:
    """L2-normalised float32 embeddings (cosine similarity == dot product).

    Reusable outside retrieval, e.g. for outage/burst detection in the app.
    """
    vecs = _model().encode(
        [PREFIX + t for t in texts],
        batch_size=batch_size,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=show_progress,
    )
    return np.asarray(vecs, dtype="float32")


# --------------------------------------------------------------------------- build
def build_index(kb_csv: Path = KB_CSV) -> dict:
    import faiss

    kb_csv = Path(kb_csv)
    if "test" in kb_csv.name.lower():
        raise ValueError("Refusing to index a holdout/test file. Index data/kb_train.csv only.")
    if not kb_csv.exists() or kb_csv.stat().st_size < 1000:
        raise FileNotFoundError(f"{kb_csv} is missing or a placeholder. Run: python -m src.data_split")

    df = pd.read_csv(kb_csv)
    subjects = df["subject"] if "subject" in df.columns else [""] * len(df)
    texts = [ticket_text(s, b) for s, b in zip(subjects, df["body"])]
    answers = df["answer"].map(_clean) if "answer" in df.columns else pd.Series([""] * len(df))
    # A precedent is only useful if it has a historical resolution to ground the reply on
    # (~21% of rows, from the German-normalised source file, have no answer).
    keep = [i for i, t in enumerate(texts) if t and answers.iloc[i]]
    df = df.iloc[keep].reset_index(drop=True)
    texts = [texts[i] for i in keep]

    t0 = time.time()
    vecs = embed(texts, batch_size=128, show_progress=True)
    embed_secs = time.time() - t0

    index = faiss.IndexFlatIP(vecs.shape[1])
    index.add(vecs)
    ART_DIR.mkdir(exist_ok=True)
    faiss.write_index(index, str(INDEX_PATH))

    meta = pd.DataFrame({c: df[c] if c in df.columns else "" for c in META_COLS})
    for c in META_COLS:
        meta[c] = meta[c].map(_clean)
    tag_cols = sorted(c for c in df.columns if c.lower().startswith("tag"))
    meta["tags"] = (
        df[tag_cols].apply(lambda r: "|".join(_clean(t) for t in r if _clean(t)), axis=1)
        if tag_cols
        else ""
    )
    meta["dedup_key"] = [_dedup_key(t) for t in texts]
    meta.to_parquet(META_PATH, index=False)

    info = {
        "embed_model": EMBED_MODEL,
        "dim": int(vecs.shape[1]),
        "n_indexed": int(index.ntotal),
        "n_unique_texts": int(meta["dedup_key"].nunique()),
        "source": str(kb_csv.relative_to(ROOT)) if kb_csv.is_relative_to(ROOT) else str(kb_csv),
        "embed_seconds": round(embed_secs, 1),
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    INFO_PATH.write_text(json.dumps(info, indent=2))
    _get_retriever.cache_clear()
    return info


# --------------------------------------------------------------------------- search
class Retriever:
    def __init__(self):
        import faiss

        if not INDEX_PATH.exists() or not META_PATH.exists():
            raise FileNotFoundError(
                "Retrieval index not found. Run: python -m src.data_split && python -m src.retrieval --build"
            )
        info = json.loads(INFO_PATH.read_text())
        if info.get("embed_model") != EMBED_MODEL:
            raise RuntimeError(
                f"Index was built with {info.get('embed_model')} but EMBED_MODEL={EMBED_MODEL}. Rebuild it."
            )
        self.index = faiss.read_index(str(INDEX_PATH))
        self.meta = pd.read_parquet(META_PATH)
        self.info = info

    def _hits_from(self, scores, ids, k, exclude_ids=(), exclude_keys=()) -> list[dict]:
        hits, seen = [], set(exclude_keys)
        for score, i in zip(scores, ids):
            if i < 0:
                continue
            row = self.meta.iloc[int(i)]
            if row["ticket_id"] in exclude_ids or row["dedup_key"] in seen:
                continue  # skip self-matches and verbatim duplicate tickets
            seen.add(row["dedup_key"])
            hits.append(
                {
                    "rank": len(hits) + 1,
                    "ticket_id": row["ticket_id"],
                    "score": round(float(score), 4),
                    "subject": row["subject"],
                    "body": row["body"],
                    "answer": row["answer"],
                    "type": row["type"],
                    "queue": row["queue"],
                    "priority": row["priority"],
                    "language": row["language"],
                    "tags": [t for t in str(row["tags"]).split("|") if t],
                }
            )
            if len(hits) == k:
                break
        return hits

    def search(self, subject, body, k: int = 5, exclude_ids=()) -> list[dict]:
        text = ticket_text(subject, body)
        if not text:
            return []
        q = embed([text])
        scores, ids = self.index.search(q, k * 4)  # over-fetch, then drop duplicates
        return self._hits_from(scores[0], ids[0], k, exclude_ids=set(exclude_ids))


@lru_cache(maxsize=1)
def _get_retriever() -> Retriever:
    return Retriever()


def warmup() -> None:
    """Load the model and index ahead of the first query (call once at app start)."""
    _get_retriever()
    embed(["warmup"])


def retrieve(subject, body, k: int = 5) -> list[dict]:
    """Top-k most similar historical KB tickets, best first.

    Each hit: rank, ticket_id, score (cosine similarity, higher = closer), subject, body,
    answer (historical resolution), type, queue, priority, language, tags.
    """
    return _get_retriever().search(subject, body, k=k)


def no_precedent_threshold() -> float:
    """Top-1 similarity below this means "no historical precedent" -> escalate."""
    try:
        return float(json.loads(CALIB_PATH.read_text())["threshold"])
    except (FileNotFoundError, KeyError, ValueError):
        return FALLBACK_NO_PRECEDENT_THRESHOLD


# --------------------------------------------------------------------------- calibration
# Out-of-scope requests a helpdesk has no precedent for (English + German).
OUT_OF_SCOPE = [
    ("", "What is a good recipe for vegan lasagna for six people?"),
    ("Poem", "Write me a poem about the ocean at sunset."),
    ("", "Who won the football match between Bayern and Dortmund yesterday?"),
    ("Homework", "Can you solve this integral for my calculus homework: x^2 * sin(x) dx"),
    ("", "What will the weather be like in Boston this weekend?"),
    ("Travel", "Recommend three cheap hotels in Lisbon near the old town."),
    ("", "Tell me a joke about cats."),
    ("Dating advice", "How do I ask my coworker out on a date without it being awkward?"),
    ("", "Was ist das beste Rezept für Apfelstrudel?"),
    ("Gedicht", "Schreib mir ein Gedicht über den Herbst im Schwarzwald."),
    ("", "Wer hat die Fußball-Weltmeisterschaft 2014 gewonnen?"),
    ("Hausaufgaben", "Kannst du meine Mathe-Hausaufgaben lösen? 3x + 7 = 22"),
    ("", "Wie wird das Wetter morgen in Berlin?"),
    ("Urlaub", "Welche Sehenswürdigkeiten sollte ich in Rom besuchen?"),
    ("", "Erzähl mir einen Witz über Hunde."),
    ("Medical", "I have a headache and a fever, which medicine should I take?"),
]


# Realistic in-scope tickets written the way a judge would type them (short, fresh wording).
# KB leave-one-out alone over-estimates similarity because the synthetic data has many
# near-paraphrases, so these drive the threshold.
IN_SCOPE_HANDWRITTEN = [
    ("VPN down", "Since this morning nobody in our office can connect to the VPN. Remote staff are locked out."),
    ("", "How do I reset my password for the customer portal? The reset email never arrives."),
    ("Charged twice", "I was billed twice for my monthly subscription this month. Please fix it."),
    ("Refund request", "The headphones I ordered arrived broken. I'd like to return them and get my money back."),
    ("", "Does your project management software integrate with Slack and Google Calendar?"),
    ("Laptop won't boot", "My work laptop shows a black screen after the latest Windows update."),
    ("Server outage", "Our production database server is unreachable and the website returns 500 errors."),
    ("Pricing question", "We are a team of 40 people. Which plan would you recommend for us?"),
    ("", "Can you add two new employees to our HR system and give them email accounts?"),
    ("Suspicious login", "I received an alert about a login to my account from another country. Was I hacked?"),
    ("Drucker", "Unser Netzwerkdrucker im zweiten Stock druckt seit gestern nicht mehr."),
    ("", "Ich kann mich nicht mehr in mein Kundenkonto einloggen, das Passwort wird nicht akzeptiert."),
    ("Rechnung falsch", "Auf meiner letzten Rechnung wurde ein Betrag berechnet, den ich nicht bestellt habe."),
    ("VPN Problem", "Unser VPN verbindet sich nicht mehr, alle Mitarbeiter im Homeoffice sind betroffen."),
    ("Rücksendung", "Ich möchte das bestellte Smartphone zurückschicken, es entspricht nicht der Beschreibung."),
    ("", "Bietet Ihre Software eine Schnittstelle zu SAP an? Wir planen eine Integration."),
    ("Systemausfall", "Seit 8 Uhr ist unser CRM-System komplett ausgefallen, der Vertrieb kann nicht arbeiten."),
    ("Software installieren", "Bitte installieren Sie Adobe Acrobat auf meinem Arbeitsrechner."),
]


def calibrate(n: int = 3000, seed: int = 0) -> dict:
    """Pick the no-precedent threshold without touching the holdout.

    Threshold = midpoint of the gap between the hand-written off-topic requests (should
    escalate) and the hand-written in-scope tickets (should not). If the two overlap, it
    falls back to the value maximising (off-topic caught) - (in-scope wrongly flagged).
    Leave-one-out scores on the KB "val" rows (each queried against the index without
    itself or verbatim duplicates) are reported for reference.
    """
    r = _get_retriever()
    is_val = r.meta["split"] == "val"
    pool = r.meta[is_val] if is_val.any() else r.meta
    sample = pool.sample(n=min(n, len(pool)), random_state=seed)
    texts = [ticket_text(s, b) for s, b in zip(sample["subject"], sample["body"])]
    vecs = embed(texts, batch_size=128)
    scores, ids = r.index.search(vecs, 20)
    in_scope = []
    for (_, row), sc, ix in zip(sample.iterrows(), scores, ids):
        hits = r._hits_from(sc, ix, 1, exclude_ids={row["ticket_id"]}, exclude_keys={row["dedup_key"]})
        if hits:
            in_scope.append(hits[0]["score"])
    in_scope = np.array(in_scope)

    def top1(queries):
        out = []
        for s, b in queries:
            hits = r.search(s, b, k=1)
            out.append(hits[0]["score"] if hits else 0.0)
        return np.array(out)

    ood = top1(OUT_OF_SCOPE)
    hand = top1(IN_SCOPE_HANDWRITTEN)

    if ood.max() < hand.min():
        best_t = round(float((ood.max() + hand.min()) / 2), 4)
        method = "midpoint of gap between hand-written off-topic and in-scope tickets"
    else:
        grid = np.round(np.arange(0.50, 0.99, 0.0025), 4)
        best_t, best_j = float(grid[0]), -1.0
        for t in grid:
            j = float((ood < t).mean() - (hand < t).mean())
            if j > best_j + 1e-9:
                best_t, best_j = float(t), j
        method = "overlap: maximise off-topic caught - hand-written in-scope flagged"

    def label(s, b):
        return f"{s} | {b}"[:70]

    result = {
        "threshold": best_t,
        "embed_model": EMBED_MODEL,
        "method": method,
        "gap": {"max_off_topic": round(float(ood.max()), 4), "min_in_scope_handwritten": round(float(hand.min()), 4)},
        "off_topic_caught_rate": round(float((ood < best_t).mean()), 4),
        "handwritten_in_scope_flagged_rate": round(float((hand < best_t).mean()), 4),
        "leave_one_out_pool": "kb val split" if is_val.any() else "whole kb",
        "leave_one_out_n": int(len(in_scope)),
        "leave_one_out_flagged_rate": round(float((in_scope < best_t).mean()), 4),
        "leave_one_out_percentiles": {
            f"p{p}": round(float(np.percentile(in_scope, p)), 4) for p in (1, 5, 10, 25, 50)
        },
        "off_topic_scores": {label(s, b): round(float(x), 4) for (s, b), x in zip(OUT_OF_SCOPE, ood)},
        "handwritten_in_scope_scores": {label(s, b): round(float(x), 4) for (s, b), x in zip(IN_SCOPE_HANDWRITTEN, hand)},
    }
    ART_DIR.mkdir(exist_ok=True)
    CALIB_PATH.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    return result


# --------------------------------------------------------------------------- CLI
def _main():
    ap = argparse.ArgumentParser(description="SentinelDesk precedent retrieval")
    ap.add_argument("--build", action="store_true", help="embed data/kb_train.csv into a FAISS index")
    ap.add_argument("--calibrate", action="store_true", help="tune the no-precedent threshold")
    ap.add_argument("--query", help="ticket body to search for")
    ap.add_argument("--subject", default="", help="optional subject for --query")
    ap.add_argument("-k", type=int, default=5)
    args = ap.parse_args()

    if args.build:
        print(json.dumps(build_index(), indent=2))
    if args.calibrate:
        print(json.dumps(calibrate(), indent=2, ensure_ascii=False))
    if args.query:
        t0 = time.time()
        hits = retrieve(args.subject, args.query, k=args.k)
        print(f"{len(hits)} hits in {time.time() - t0:.3f}s (threshold {no_precedent_threshold():.3f})")
        for h in hits:
            print(f"\n#{h['rank']} {h['ticket_id']}  score={h['score']:.3f}  [{h['language']}] "
                  f"{h['type']} / {h['queue']} / {h['priority']}")
            print(f"  ticket: {(h['subject'] + ' | ' if h['subject'] else '') + h['body'][:160]!r}")
            print(f"  answer: {h['answer'][:200]!r}")


if __name__ == "__main__":
    _main()
