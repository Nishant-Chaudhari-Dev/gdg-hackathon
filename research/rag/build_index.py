"""Build the RAG precedent index from data/kb_train.csv ONLY (never test.csv).

Owner: RAG team (Nishant).   Run from the repo root:
    python research/rag/build_index.py                  # full build + deploy file
    python research/rag/build_index.py --export-only    # just re-export the deploy file
    python research/rag/build_index.py --out DIR --no-bundle-model --skip-calibration

Deploy file (commit it with `git add -f`, it is under a gitignored path):
    research/rag/index/kb_index.pkl.gz   fp16 vectors + metadata + calibration (~25 MB).
    infra/deploy.sh uploads research/rag/index/ to gs://<bucket>/index/, which is the
    INDEX_URI the RAG service is deployed with. The model loads from the HF Hub at startup.

Full local dir (gitignored; also usable as INDEX_URI):
    kb.faiss          FAISS IndexFlatIP over L2-normalised multilingual-e5-small embeddings
    kb_meta.parquet   ticket_id, subject, body, answer, type, queue, priority, language (detected
                      from text), language_label (original column), tags, split, dedup_key
    kb_info.json      model name, version, counts, source hash, build time
    model/            the embedding model itself (Cloud Run never needs the Hugging Face Hub)
    calibration.json  recommended GATE_NO_PRECEDENT / GATE_MIN_RETRIEVAL for the orchestrator gate

Calibration never touches the holdout. It uses:
    * the KB "val" rows, each queried against the index without itself (leave-one-out),
    * hand-written realistic in-scope tickets (how judges will type), and
    * hand-written off-topic requests (recipes, poems, homework...) that must escalate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sentinel_core.text import clean  # noqa: E402
from services.rag.app.retriever import (  # noqa: E402
    EMBED_MODEL,
    Encoder,
    PICKLE_NAME,
    Retriever,
    dedup_key,
    guess_language,
    save_pickle,
    ticket_text,
)

DEFAULT_KB = ROOT / "data" / "kb_train.csv"
DEFAULT_OUT = ROOT / "research" / "rag" / "artifacts" / "index"
DEFAULT_PICKLE = ROOT / "research" / "rag" / "index" / PICKLE_NAME
VERSION = "mE5-small+faiss-flatip-v1"
META_COLS = ["ticket_id", "subject", "body", "answer", "type", "queue", "priority", "language", "split"]

OFF_TOPIC = [
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

IN_SCOPE = [
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


def build(kb_csv: Path, out: Path, bundle_model: bool, batch_size: int) -> dict:
    import faiss

    if "test" in kb_csv.name.lower():
        raise SystemExit("Refusing to index a holdout/test file. Index data/kb_train.csv only.")
    df = pd.read_csv(kb_csv)
    for c in META_COLS:
        df[c] = df[c].map(clean) if c in df.columns else ""
    texts = [ticket_text(s, b) for s, b in zip(df["subject"], df["body"])]
    keep = [i for i, t in enumerate(texts) if t and df["answer"].iloc[i]]  # need a resolution to ground on
    df = df.iloc[keep].reset_index(drop=True)
    texts = [texts[i] for i in keep]

    enc = Encoder(EMBED_MODEL, model_name=EMBED_MODEL)
    t0 = time.time()
    vecs = enc.encode(texts, batch_size=batch_size, show_progress=True)
    embed_secs = time.time() - t0

    out.mkdir(parents=True, exist_ok=True)
    index = faiss.IndexFlatIP(vecs.shape[1])
    index.add(vecs)
    faiss.write_index(index, str(out / "kb.faiss"))

    meta = df[META_COLS].copy()
    # The dataset's language label is wrong for ~27% of 'de' rows (English text): use the text.
    meta["language_label"] = meta["language"]
    meta["language"] = [guess_language(t) or lbl for t, lbl in zip(texts, meta["language_label"])]
    tag_cols = sorted(c for c in df.columns if c.lower().startswith("tag"))
    meta["tags"] = df[tag_cols].apply(lambda r: "|".join(clean(t) for t in r if clean(t)), axis=1) if tag_cols else ""
    meta["dedup_key"] = [dedup_key(t) for t in texts]
    meta.to_parquet(out / "kb_meta.parquet", index=False)

    if bundle_model:
        enc.model.save(str(out / "model"))

    info = {
        "version": VERSION,
        "embed_model": EMBED_MODEL,
        "dim": int(vecs.shape[1]),
        "n_indexed": int(index.ntotal),
        "n_unique_texts": int(meta["dedup_key"].nunique()),
        "language_label_corrected": int((meta["language"] != meta["language_label"]).sum()),
        "source": kb_csv.name,
        "source_sha1": hashlib.sha1(kb_csv.read_bytes()).hexdigest()[:12],
        "model_bundled": bundle_model,
        "embed_device": enc.device,
        "embed_seconds": round(embed_secs, 1),
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (out / "kb_info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    return info


def _top1(r: Retriever, queries) -> np.ndarray:
    qv = r._enc.encode([ticket_text(s, b) for s, b in queries])
    return np.array([rows[0]["score"] if rows else 0.0 for rows in r.search_vectors(qv, 1)])


def calibrate(r: Retriever, out: Path) -> dict:
    meta = r._meta
    pool = meta[meta["split"] == "val"]
    if pool.empty:
        pool = meta.sample(n=min(3000, len(meta)), random_state=0)
    qv = r._enc.encode([ticket_text(s, b) for s, b in zip(pool["subject"], pool["body"])], batch_size=128)
    scores, ids = r._index.search(qv, 20)
    loo = []
    for j, (tid, key) in enumerate(zip(pool["ticket_id"], pool["dedup_key"])):
        rows = r._rows(scores[j], ids[j], 1, {tid}, {key})
        if rows:
            loo.append(rows[0]["score"])
    loo = np.array(loo)
    off, hand = _top1(r, OFF_TOPIC), _top1(r, IN_SCOPE)

    # GATE_MIN_RETRIEVAL: below this -> escalate for human review.
    if off.max() < hand.min():
        min_retrieval = round(float((off.max() + hand.min()) / 2), 3)
        method = "midpoint of the gap between off-topic and hand-written in-scope tickets"
    else:
        grid = np.round(np.arange(0.50, 0.99, 0.0025), 4)
        j_scores = [(off < t).mean() - (hand < t).mean() for t in grid]
        min_retrieval = round(float(grid[int(np.argmax(j_scores))]), 3)
        method = "scores overlap: maximise (off-topic caught) - (in-scope flagged)"
    # GATE_NO_PRECEDENT: below this the ticket is clearly off-topic -> no draft at all.
    no_precedent = round(float(min(min_retrieval - 0.01, (np.median(off) + hand.min()) / 2)), 3)

    def rate(x, t):
        return round(float((x < t).mean()), 4)

    result = {
        "recommended_env": {"GATE_MIN_RETRIEVAL": min_retrieval, "GATE_NO_PRECEDENT": no_precedent},
        "embed_model": r.info.get("embed_model"),
        "index_version": r.version,
        "method": method,
        "off_topic": {"n": len(off), "caught_by_min_retrieval": rate(off, min_retrieval),
                      "caught_by_no_precedent": rate(off, no_precedent),
                      "min": round(float(off.min()), 4), "median": round(float(np.median(off)), 4),
                      "max": round(float(off.max()), 4)},
        "handwritten_in_scope": {"n": len(hand), "flagged_by_min_retrieval": rate(hand, min_retrieval),
                                 "flagged_by_no_precedent": rate(hand, no_precedent),
                                 "min": round(float(hand.min()), 4), "median": round(float(np.median(hand)), 4)},
        "kb_val_leave_one_out": {"n": len(loo), "flagged_by_min_retrieval": rate(loo, min_retrieval),
                                 "p1": round(float(np.percentile(loo, 1)), 4),
                                 "p5": round(float(np.percentile(loo, 5)), 4),
                                 "p50": round(float(np.percentile(loo, 50)), 4)},
        "off_topic_scores": {f"{s} | {b}"[:70]: round(float(x), 4) for (s, b), x in zip(OFF_TOPIC, off)},
        "in_scope_scores": {f"{s} | {b}"[:70]: round(float(x), 4) for (s, b), x in zip(IN_SCOPE, hand)},
    }
    (out / "calibration.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def export_pickle(index_dir: Path, pickle_path: Path) -> dict:
    """Pack a full index dir into the single deploy file (no re-embedding)."""
    import faiss

    index = faiss.read_index(str(index_dir / "kb.faiss"))
    meta = pd.read_parquet(index_dir / "kb_meta.parquet")
    info = json.loads((index_dir / "kb_info.json").read_text(encoding="utf-8"))
    cal_path = index_dir / "calibration.json"
    cal = json.loads(cal_path.read_text(encoding="utf-8")) if cal_path.exists() else {}
    cal = {k: v for k, v in cal.items() if not k.endswith("_scores")}  # keep the deploy file lean
    save_pickle(pickle_path, index.reconstruct_n(0, index.ntotal), meta, info, cal)
    return {"deploy_file": str(pickle_path.relative_to(ROOT)) if pickle_path.is_relative_to(ROOT) else str(pickle_path),
            "size_mb": round(pickle_path.stat().st_size / 1e6, 1), "n_vectors": int(index.ntotal)}


def main():
    ap = argparse.ArgumentParser(description="Build the SentinelDesk RAG index (KB only)")
    ap.add_argument("--kb", type=Path, default=DEFAULT_KB)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--pickle", type=Path, default=DEFAULT_PICKLE, help="single-file deploy index path")
    ap.add_argument("--no-pickle", action="store_true", help="don't write the deploy file")
    ap.add_argument("--export-only", action="store_true", help="only re-export the deploy file from --out")
    ap.add_argument("--no-bundle-model", action="store_true", help="don't copy the embedding model into the index dir")
    ap.add_argument("--skip-calibration", action="store_true")
    ap.add_argument("--batch-size", type=int, default=128)
    args = ap.parse_args()

    if not args.export_only:
        info = build(args.kb, args.out, not args.no_bundle_model, args.batch_size)
        print(json.dumps(info, indent=2))

        r = Retriever()
        r._load_dense(args.out)  # also proves the saved dir loads exactly like the service will
        if not args.skip_calibration:
            cal = calibrate(r, args.out)
            print(json.dumps({k: v for k, v in cal.items() if not k.endswith("_scores")}, indent=2, ensure_ascii=False))
            env = cal["recommended_env"]
            print(f"\nSend to the app owner:  GATE_MIN_RETRIEVAL={env['GATE_MIN_RETRIEVAL']}  "
                  f"GATE_NO_PRECEDENT={env['GATE_NO_PRECEDENT']}")

    if not args.no_pickle:
        print(json.dumps(export_pickle(args.out, args.pickle), indent=2))


if __name__ == "__main__":
    main()
