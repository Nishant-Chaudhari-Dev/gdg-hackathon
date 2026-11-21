"""PII guardrail: mask emails, phones, IPs, IBANs, card and account numbers before any LLM call.

Placeholders: [EMAIL] [URL_TOKEN] [IBAN] [CARD] [IPV4] [IPV6] [PHONE] [ACCOUNT_ID].
Precision matters as much as recall: dates, versions, error codes, prices, ports and TKT-ids must survive,
because the drafter verifies every number in a reply against the ticket and the evidence.
Benchmark (RAG team): 22/22 PII cases masked, 16/16 look-alikes preserved; on the 5,715 holdout tickets
exactly one entity is masked (a real phone number), i.e. no over-masking of normal ticket text.
Idempotent: masking already-masked text changes nothing.
"""
from __future__ import annotations

import re
from collections import Counter

_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
_SECRET = re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwort|kennwort)\s*[:=]\s*\S+")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b")
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_IPV4 = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
_IPV6 = re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}\b")
_PHONE = re.compile(r"(?<![\w-])(?:\+|00)?\(?\d[\d \-/().]{6,}\d(?![\w-])")
_ACCOUNT = re.compile(
    r"(?i)\b(account|acct|customer|client|kunden|konto|contract|vertrag|order|bestell|invoice|rechnung|"
    r"member|mitglieds|policy|police|vorgang)"
    r"(?:[\s-]*(?:no\.?|number|nr\.?|nummer|num|id|#))?[\s:#-]*([A-Z]{0,4}-?\d[A-Z0-9-]{4,})"
)
_DATE = re.compile(r"\d{1,4}[./-]\d{1,2}[./-]\d{1,4}")


def _digits(v: str) -> int:
    return sum(c.isdigit() for c in v)


def _luhn(v: str) -> bool:
    ds = [int(c) for c in v if c.isdigit()][::-1]
    return sum(d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2) for i, d in enumerate(ds)) % 10 == 0


# (label, pattern, validator, group). Order matters: more specific patterns first.
_RULES = [
    ("EMAIL", _EMAIL, None, 0),
    ("URL_TOKEN", _SECRET, None, 0),
    ("IBAN", _IBAN, lambda v: _digits(v) >= 10, 0),
    ("IPV4", _IPV4, None, 0),
    ("IPV6", _IPV6, lambda v: any(c.isalpha() for c in v) or v.count(":") >= 5, 0),
    ("CARD", _CARD, lambda v: 13 <= _digits(v) <= 19 and _luhn(v), 0),
    ("ACCOUNT_ID", _ACCOUNT, lambda v: _digits(v) >= 4 and not re.fullmatch(r"TKT-\d{5}", v), 2),
    ("PHONE", _PHONE, lambda v: 8 <= _digits(v) <= 15 and not _DATE.fullmatch(v.strip())
     and not re.fullmatch(r"\d{4}\s*[-/]\s*\d{4}", v.strip()), 0),
]

# Dataset ships with placeholders like <name>, <acc_num>; they are left as-is.


def mask(text: str | None) -> tuple[str, dict[str, int]]:
    """Return (masked_text, counts_by_type). Safe on None/empty."""
    if not text:
        return "", {}
    counts: Counter[str] = Counter()
    out = text
    for label, pat, validate, group in _RULES:
        def _sub(m: re.Match[str], label=label, validate=validate, group=group) -> str:
            val = m.group(group)
            if validate and not validate(val):
                return m.group(0)
            counts[label] += 1
            return m.group(0).replace(val, f"[{label}]")

        out = pat.sub(_sub, out)
    return out, dict(counts)
