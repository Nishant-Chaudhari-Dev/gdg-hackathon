def classify(subject: str, body: str) -> dict:
    # To-Do: real model. Must return confidence in [0, 1].
    return {"type": "Incident", "queue": "Technical Support",
            "priority": "high", "confidence": 0.90}
