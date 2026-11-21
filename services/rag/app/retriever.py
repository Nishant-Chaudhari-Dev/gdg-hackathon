"""
=====================  RAG TEAM: THIS IS YOUR FILE (1/2)  =====================
Owner: Nishant.   Contract: docs/CONTRACT.md §3.

Multilingual dense retrieval: intfloat/multilingual-e5-small embeddings + FAISS IndexFlatIP.
Vectors are L2-normalised, so `score` is cosine similarity in [0, 1] and comparable across
queries. A German ticket can retrieve English precedents and vice versa (cross_lingual flag).

Index: built offline from data/kb_train.csv ONLY (never test.csv) by
    python research/rag/build_index.py
and loaded at startup from INDEX_URI (local dir, or gs://bucket/.../index/ on Cloud Run).
Two formats are accepted:
  * full dir (local dev, gitignored): research/rag/artifacts/index/ with kb.faiss,
    kb_meta.parquet, kb_info.json and the bundled embedding model in model/;
  * single deploy file (committed): research/rag/index/kb_index.pkl.gz with fp16 vectors,
    metadata and calibration (~25 MB). infra/deploy.sh uploads research/rag/index/ to
    gs://<bucket>/index/, which is the INDEX_URI the RAG service is deployed with. The
    embedding model is then loaded by name from the Hugging Face Hub at startup.
Without INDEX_URI the full dir is preferred, then the deploy file.

If no index is found, the service falls back to TF-IDF over data/kb_train.csv (or the tiny
fixture) so the stack keeps running; retriever_version then ends in "-fallback".

Gate thresholds calibrated for this model are in <index>/calibration.json
(GATE_NO_PRECEDENT, GATE_MIN_RETRIEVAL); send them to the app owner.
================================================================================
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

import numpy as np

from sentinel_core.artifacts import ensure_local, exists
from sentinel_core.schemas import RetrievedTicket, RetrieveRequest, RetrieveResponse
from sentinel_core.text import clean

try:  # use the OS certificate store (needed on networks that re-sign TLS)
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

FIXTURE = Path(__file__).parent / "fixture_kb.json"
DEFAULT_INDEX_RELS = ("research/rag/artifacts/index", "research/rag/index")  # full dir first
PICKLE_NAME = "kb_index.pkl.gz"
PICKLE_FORMAT = "sentineldesk-rag-index-v1"
EMBED_MODEL = os.getenv("EMBED_MODEL", "intfloat/multilingual-e5-small")
MAX_SEQ_LEN = 256
FETCH_FACTOR = 4  # over-fetch, then drop near-identical precedents


# ------------------------------------------------------------------ shared helpers
def ticket_text(subject, body) -> str:
    """Text that gets embedded: cleaned subject (if any) + body, whitespace collapsed."""
    s, b = clean(subject), clean(body)
    text = f"{s}\n{b}" if s else b
    return re.sub(r"\s+", " ", text).strip()[:4000]


def dedup_key(text: str) -> str:
    """Same key for tickets that differ only in punctuation/whitespace/case."""
    return hashlib.md5(re.sub(r"\W+", "", text.lower())[:500].encode("utf-8")).hexdigest()


_DE_WORDS = set("der die das und ist nicht wir sie ich mit für auf eine einen ein dem den des bitte "
                "vielen dank unser unsere zu von sich haben wird werden können".split())
_EN_WORDS = set("the and is not we you i with for on a an to of please thank our your have will be "
                "can this that are".split())


def guess_language(text: str) -> str | None:
    """'de' / 'en' from stopword counts, None if unclear.

    The dataset's `language` column is wrong for ~27% of KB tickets labelled 'de' (they are
    English), so precedent language is taken from the text at build time.
    """
    words = re.findall(r"[a-zäöüß]+", text.lower())
    de = sum(w in _DE_WORDS for w in words)
    en = sum(w in _EN_WORDS for w in words)
    return "de" if de > en else "en" if en > de else None


def _e5_prefix(model_name: str) -> str:
    # e5 expects a task prefix; ticket-to-ticket similarity is symmetric, so the model card
    # says to use "query: " on both sides.
    return "query: " if "e5" in model_name.lower() else ""


class Encoder:
    """Sentence-transformer wrapper used both here and by research/rag/build_index.py."""

    def __init__(self, model_path: str, model_name: str | None = None, device: str | None = None):
        import torch
        from sentence_transformers import SentenceTransformer

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = SentenceTransformer(model_path, device=self.device)
        self.model.max_seq_length = MAX_SEQ_LEN
        self.prefix = _e5_prefix(model_name or model_path)
        dim_fn = getattr(self.model, "get_embedding_dimension", None) or self.model.get_sentence_embedding_dimension
        self.dim = int(dim_fn())

    def encode(self, texts: list[str], batch_size: int = 64, show_progress: bool = False) -> np.ndarray:
        vecs = self.model.encode(
            [self.prefix + t for t in texts],
            batch_size=batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=show_progress,
        )
        return np.asarray(vecs, dtype="float32")


def _has_index(d: Path) -> bool:
    return (d / "kb.faiss").exists() or (d / PICKLE_NAME).exists()


def resolve_index_dir() -> str | None:
    """INDEX_URI if set (gs:// dirs are downloaded once), else the default local paths."""
    uri = os.getenv("INDEX_URI", "").strip()
    if uri:
        if uri.startswith("gs://") and not uri.endswith("/"):
            uri += "/"
        return ensure_local(uri)
    for rel in DEFAULT_INDEX_RELS:
        for base in (Path.cwd(), *Path(__file__).resolve().parents):
            if _has_index(base / rel):
                return str(base / rel)
    return None


def save_pickle(path: Path, vectors: np.ndarray, meta, info: dict, calibration: dict | None) -> Path:
    """Write the single-file deploy index. Only bytes/lists/dicts are pickled, so loading it
    does not depend on pandas/numpy/faiss versions."""
    import gzip
    import pickle

    vec16 = np.ascontiguousarray(vectors, dtype="float16")
    blob = {
        "format": PICKLE_FORMAT,
        "info": {**info, "storage": "pickle-gzip-fp16"},
        "calibration": calibration or {},
        "vectors": vec16.tobytes(),
        "shape": list(vec16.shape),
        "meta": {c: [None if v is None else str(v) for v in meta[c].tolist()] for c in meta.columns},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=6) as f:
        pickle.dump(blob, f, protocol=4)
    return path


def _load_pickle(path: Path):
    """-> (info, faiss index, metadata DataFrame) from a save_pickle() file."""
    import gzip
    import pickle

    import faiss
    import pandas as pd

    with gzip.open(path, "rb") as f:
        blob = pickle.load(f)  # our own committed artifact, never user-supplied
    if blob.get("format") != PICKLE_FORMAT:
        raise ValueError(f"{path} is not a {PICKLE_FORMAT} file")
    vecs = np.frombuffer(blob["vectors"], dtype="float16").reshape(blob["shape"]).astype("float32")
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True).clip(min=1e-12)  # re-normalise after fp16
    index = faiss.IndexFlatIP(vecs.shape[1])
    index.add(vecs)
    info = {**blob["info"], "calibration": blob.get("calibration", {})}
    return info, index, pd.DataFrame(blob["meta"])


# ------------------------------------------------------------------ retriever
class Retriever:
    version = "uninitialised"

    def __init__(self) -> None:
        self._index = None
        self._meta = None
        self._enc: Encoder | None = None
        self._fallback: _TfidfRetriever | None = None
        self.info: dict = {}

    def load(self) -> None:
        index_dir = resolve_index_dir()
        try:
            if not index_dir or not _has_index(Path(index_dir)):
                raise FileNotFoundError(f"no RAG index at {index_dir or ' or '.join(DEFAULT_INDEX_RELS)}")
            self._load_dense(Path(index_dir))
        except Exception as exc:  # never take the service down: degrade to TF-IDF
            print(f"[rag] dense index unavailable ({exc}); falling back to TF-IDF", flush=True)
            self._fallback = _TfidfRetriever()
            self._fallback.load()
            self.version = f"{self._fallback.version}-fallback"

    def _load_dense(self, d: Path) -> None:
        import faiss
        import pandas as pd

        if (d / "kb.faiss").exists():  # full dir (local dev)
            info = json.loads((d / "kb_info.json").read_text(encoding="utf-8"))
            self._index = faiss.read_index(str(d / "kb.faiss"))
            self._meta = pd.read_parquet(d / "kb_meta.parquet")
        else:  # single deploy file
            info, self._index, self._meta = _load_pickle(d / PICKLE_NAME)
        if self._index.ntotal != len(self._meta):
            raise RuntimeError("index vectors and metadata are out of sync; rebuild the index")
        model_dir = d / "model"
        self._enc = Encoder(str(model_dir) if model_dir.exists() else info["embed_model"],
                            model_name=info["embed_model"])
        self.info = info
        self.version = info.get("version", "mE5-small+faiss-flatip")
        self._enc.encode(["warmup"])  # the first encode is slow; pay it at startup

    # -- low-level search, also used by build-time calibration and eval -------------
    def search_vectors(self, qv: np.ndarray, k: int, exclude_ids=(), exclude_keys=()) -> list[list[dict]]:
        scores, ids = self._index.search(qv, k * FETCH_FACTOR)
        return [self._rows(s, i, k, set(exclude_ids), set(exclude_keys)) for s, i in zip(scores, ids)]

    def _rows(self, scores, ids, k, exclude_ids, exclude_keys) -> list[dict]:
        out, seen = [], set(exclude_keys)
        for score, i in zip(scores, ids):
            if i < 0:
                continue
            row = self._meta.iloc[int(i)]
            if row["ticket_id"] in exclude_ids or row["dedup_key"] in seen:
                continue
            seen.add(row["dedup_key"])
            out.append({**row.to_dict(), "score": float(min(max(score, 0.0), 1.0))})
            if len(out) == k:
                break
        return out

    def retrieve(self, req: RetrieveRequest) -> RetrieveResponse:
        if self._fallback is not None:
            return self._fallback.retrieve(req)
        text = ticket_text(req.subject, req.body)
        if not text:
            return RetrieveResponse(hits=[], max_score=0.0, cross_lingual=False, retriever_version=self.version)
        rows = self.search_vectors(self._enc.encode([text]), req.k)[0]
        hits = [
            RetrievedTicket(
                ticket_id=r["ticket_id"],
                score=round(r["score"], 4),
                subject=r["subject"][:300],
                body=r["body"][:600],
                answer=r["answer"][:1200],
                language=r["language"] or None,
                type=r["type"] or None,
                queue=r["queue"] or None,
                priority=r["priority"] or None,
                tags=[t for t in str(r["tags"]).split("|") if t],
            )
            for r in rows
        ]
        cross = bool(req.language) and any(h.language and h.language != req.language for h in hits)
        return RetrieveResponse(hits=hits, max_score=hits[0].score if hits else 0.0,
                                cross_lingual=cross, retriever_version=self.version)


# ------------------------------------------------------------------ fallback (original stub)
class _TfidfRetriever:
    version = "fixture-0"

    def __init__(self) -> None:
        self._df = None
        self._vec = None
        self._X = None

    def load(self) -> None:
        import pandas as pd
        from sklearn.feature_extraction.text import TfidfVectorizer

        kb_path = ensure_local(os.getenv("KB_URI", "data/kb_train.csv"))
        if exists(kb_path):
            df = pd.read_csv(kb_path)
            limit = int(os.getenv("KB_LIMIT", "0"))
            if limit:
                df = df.head(limit)
            self.version = f"tfidf-{len(df)}"
        else:
            df = pd.DataFrame(json.loads(FIXTURE.read_text()))
            self.version = "fixture-0"
        df = df.fillna("")
        for col in ("subject", "body", "answer"):
            df[col] = df[col].map(clean)
        df = df[df["answer"] != ""]
        self._df = df.reset_index(drop=True)
        self._vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1, max_features=300_000)
        self._X = self._vec.fit_transform((df["subject"] + "\n" + df["body"]).tolist())

    def retrieve(self, req: RetrieveRequest) -> RetrieveResponse:
        q = self._vec.transform([f"{req.subject}\n{req.body}"])
        sims = (self._X @ q.T).toarray().ravel()
        hits = []
        for i in sims.argsort()[::-1][: req.k]:
            r = self._df.iloc[int(i)]
            tags = [str(r.get(f"tag_{n}", "")) for n in range(1, 9) if str(r.get(f"tag_{n}", ""))]
            hits.append(RetrievedTicket(
                ticket_id=str(r["ticket_id"]),
                score=round(float(min(max(sims[i], 0.0), 1.0)) ** 0.5, 4),
                subject=str(r["subject"])[:300], body=str(r["body"])[:600], answer=str(r["answer"])[:1200],
                language=str(r.get("language", "")) or None, type=str(r.get("type", "")) or None,
                queue=str(r.get("queue", "")) or None, priority=str(r.get("priority", "")) or None, tags=tags,
            ))
        cross = any(h.language and req.language and h.language != req.language for h in hits)
        return RetrieveResponse(hits=hits, max_score=hits[0].score if hits else 0.0,
                                cross_lingual=cross, retriever_version=self.version)
