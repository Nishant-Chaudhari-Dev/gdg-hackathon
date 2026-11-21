import re

# Starting values. Tune on a validation split of kb_train.csv, never on test.csv.
CONF_THRESHOLD = 0.60   # classifier confidence below this -> escalate
SIM_THRESHOLD = 0.50    # best retrieval similarity below this -> escalate
MIN_BODY_CHARS = 10     # too little text to judge safely

# Each topic: patterns for English and German. If the ticket asks about a topic
# and none of the retrieved past answers mention it, the request is unsupported.
RISKY_TOPICS = {
    "refund": [r"refund", r"reimburs", r"money back", r"erstattung", r"rückzahlung", r"geld zurück"],
    "compensation": [r"compensat", r"entschädig"],
    "pricing": [r"pric(e|ing)", r"discount", r"preis", r"rabatt"],
    "guarantee/SLA": [r"guarantee", r"warrant(y|ies)", r"garantie", r"gewährleist", r"\bsla\b"],
    "legal": [r"legal", r"lawsuit", r"lawyer", r"attorney", r"anwalt", r"klage"],
    "cancellation": [r"cancel", r"kündig"],
}


def _mentions(text, patterns):
    text = (text or "").lower()
    return any(re.search(p, text) for p in patterns)


def unsupported_topics(body, hits):
    """Risky topics the ticket asks about that no retrieved answer covers."""
    answers = " ".join((h.get("answer") or "") for h in hits)
    return [
        topic for topic, pats in RISKY_TOPICS.items()
        if _mentions(body, pats) and not _mentions(answers, pats)
    ]


def _confidence(cls):
    c = cls.get("confidence")
    if isinstance(c, dict):          # separate scores per target: use the lowest
        c = min(c.values()) if c else 0.0
    return 0.0 if c is None else float(c)


def decide(cls, hits, body, conf_threshold=None, sim_threshold=None):
    conf_threshold = CONF_THRESHOLD if conf_threshold is None else conf_threshold
    sim_threshold = SIM_THRESHOLD if sim_threshold is None else sim_threshold
    reasons = []
    body = body or ""

    if len(body.strip()) < MIN_BODY_CHARS:
        reasons.append("Ticket text too short to assess")
    if str(cls.get("priority", "")).lower() == "high" and str(cls.get("type", "")).lower() == "incident":
        reasons.append("High-priority incident")
    if _confidence(cls) < conf_threshold:
        reasons.append("Low classifier confidence")
    if not hits or hits[0]["score"] < sim_threshold:
        reasons.append("No close historical precedent")
    topics = unsupported_topics(body, hits)
    if topics:
        reasons.append("Requests unsupported by past resolutions: " + ", ".join(topics))

    if reasons:
        return {"action": "escalate", "reasons": reasons, "reason": "; ".join(reasons)}
    return {"action": "auto_draft", "reasons": [], "reason": "Confident and grounded in precedent"}