"""Automatic language detection from raw text (required at demo time)."""
from __future__ import annotations

from langdetect import DetectorFactory, detect_langs

DetectorFactory.seed = 0  # deterministic

SUPPORTED = {"en", "de"}
_DE_HINTS = {"bitte", "nicht", "ich", "und", "der", "die", "das", "wir", "ist", "mit", "unser", "können", "danke"}


def detect_language(text: str, default: str = "en") -> str:
    text = (text or "").strip()
    if not text:
        return default
    try:
        cands = detect_langs(text)
        for c in cands:
            if c.lang in SUPPORTED and c.prob >= 0.5:
                return c.lang
    except Exception:
        pass
    words = {w.strip(".,!?;:").lower() for w in text.split()}
    return "de" if len(words & _DE_HINTS) >= 2 else default
