"""Dataset text normalisation (CSV has literal "\\n" sequences and wrapping quotes)."""
from __future__ import annotations


def clean(text: object) -> str:
    if text is None or (isinstance(text, float) and text != text):  # None / NaN
        return ""
    s = str(text).replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", " ").strip()
    if len(s) >= 2 and s[0] == s[-1] == '"':
        s = s[1:-1].strip()
    return s
