import time
from src.classifier import classify
from src.retrieval import retrieve
from src.escalation import decide
from src.generation import detect_language, draft

def triage(subject: str | None, body: str) -> dict:
    t0 = time.time()
    subject = subject or ""          # handles null subjects
    cls = classify(subject, body)
    hits = retrieve(subject, body, k=5)
    decision = decide(cls, hits, body)
    lang = detect_language(f"{subject} {body}")
    reply = None
    if decision["action"] == "auto_draft":
        reply = draft(subject, body, lang, hits)
    return {"classification": cls, "decision": decision, "language": lang,
            "hits": hits, "reply": reply,
            "latency_s": round(time.time() - t0, 2
