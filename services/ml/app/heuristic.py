"""Keyword heuristic used only when no trained model is available (keeps the demo alive)."""
from __future__ import annotations

from sentinel_core.schemas import Classification, HeadPrediction

_QUEUE_KW = {
    "Billing and Payments": ["invoice", "billing", "charge", "refund", "payment", "rechnung", "zahlung", "abbuchung"],
    "IT Support": ["vpn", "password", "login", "laptop", "passwort", "anmeldung", "account locked", "printer"],
    "Technical Support": ["error", "crash", "outage", "down", "server", "api", "fehler", "ausfall", "integration"],
    "Sales and Pre-Sales": ["pricing", "quote", "demo", "license", "angebot", "preis", "purchase"],
    "Product Support": ["feature", "how do i", "configure", "setting", "funktion", "einstellung"],
    "Customer Service": ["complaint", "cancel", "delivery", "beschwerde", "kündigung"],
}
_HIGH = ["urgent", "outage", "down", "critical", "asap", "emergency", "dringend", "ausfall", "hospital", "patients", "cannot access"]
_INCIDENT = ["error", "down", "not working", "failed", "outage", "crash", "funktioniert nicht", "fehler", "ausfall"]
_CHANGE = ["change", "upgrade", "migrate", "update our", "änderung", "migration"]
_REQUEST = ["request", "could you", "please provide", "would like", "information", "anfrage", "bitte um"]


def _head(scores: dict[str, float]) -> HeadPrediction:
    sharp = {k: v ** 3 for k, v in scores.items()}  # sharpen so clear keyword hits look confident
    total = sum(sharp.values()) or 1.0
    probs = {k: round(v / total, 4) for k, v in sharp.items()}
    label = max(probs, key=probs.get)  # type: ignore[arg-type]
    return HeadPrediction(label=label, confidence=probs[label], probs=probs)


def heuristic_predict(subject: str, body: str, version: str) -> Classification:
    t = f"{subject} {body}".lower()
    hit = lambda kws: sum(k in t for k in kws)  # noqa: E731

    q = {k: 0.5 + 2 * hit(v) for k, v in _QUEUE_KW.items()}
    pr = {"high": 0.5 + 2 * hit(_HIGH), "medium": 1.2, "low": 0.6}
    ty = {
        "Incident": 0.6 + 2 * hit(_INCIDENT),
        "Request": 0.6 + 2 * hit(_REQUEST),
        "Change": 0.3 + 2 * hit(_CHANGE),
        "Problem": 0.5,
    }
    th, qh, ph = _head(ty), _head(q), _head(pr)
    return Classification(type=th, queue=qh, priority=ph, confidence=round((th.confidence * qh.confidence * ph.confidence) ** (1 / 3), 4), model_version=version)
