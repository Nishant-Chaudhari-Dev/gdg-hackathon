"""Grounded drafting API (prototype layout).

The implementation lives in services/rag/app/generator.py so the RAG service (live console) and this
module run the exact same code. See that file for details.

    detect_language(text)                  -> "en" | "de"
    mask_pii(text)                         -> masked text
    draft(subject, body, lang, hits)       -> reply string citing [TKT-xxxxx]
    draft_full(subject, body, lang, hits)  -> dict with citations, grounding report, model used, ...
    request_supported(body, hits)          -> dict for the escalation gate
"""
from services.rag.app.generator import (  # noqa: F401
    MODELS,
    check_grounding,
    detect_language,
    draft,
    draft_full,
    fallback_reply,
    mask_pii,
    mask_pii_report,
    request_supported,
)
