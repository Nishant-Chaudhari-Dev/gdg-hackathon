"""PII guardrail: mask emails, phones, IPs, IBANs, card and account numbers before any LLM call."""
from __future__ import annotations

import re
from collections import Counter

# Order matters: more specific patterns first.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("URL_TOKEN", re.compile(r"\b(?:api[_-]?key|token|secret|password|passwort)\s*[:=]\s*\S+", re.I)),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("IPV4", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")),
    ("IPV6", re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}\b")),
    ("PHONE", re.compile(r"(?<!\w)(?:\+|00)?\d{1,3}?[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,5}(?!\w)")),
    ("ACCOUNT_ID", re.compile(r"\b(?:acct|account|konto|kundennummer|customer\s*id|order|bestellung)[#:\s-]*[A-Z0-9-]{5,}\b", re.I)),
]

# Dataset ships with placeholders like <name>, <acc_num>; keep them as-is.


def mask(text: str | None) -> tuple[str, dict[str, int]]:
    """Return (masked_text, counts_by_type). Safe on None/empty."""
    if not text:
        return "", {}
    counts: Counter[str] = Counter()
    out = text
    for label, pat in _PATTERNS:
        def _sub(m: re.Match[str], label: str = label) -> str:
            # Don't treat short numeric runs (years, versions) as phones/cards.
            digits = sum(c.isdigit() for c in m.group(0))
            if label in ("PHONE",) and digits < 8:
                return m.group(0)
            counts[label] += 1
            return f"[{label}]"

        out = pat.sub(_sub, out)
    return out, dict(counts)
