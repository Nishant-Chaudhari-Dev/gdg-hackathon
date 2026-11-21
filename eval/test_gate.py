from src.escalation import decide

def cls(type_, priority, conf):
    return {"type": type_, "queue": "Technical Support", "priority": priority, "confidence": conf}

def hit(score, answer):
    return [{"ticket_id": "TKT-00001", "score": score, "answer": answer}]

RESET = "Please use the password reset link on the login page and follow the steps."

CASES = [
    ("VPN outage, hospital",   cls("Incident", "high", 0.95), hit(0.80, RESET),
     "Our VPN is down and the hospital EMR integration is cut off. Urgent.", "escalate"),
    ("Password reset (EN)",    cls("Request", "low", 0.90), hit(0.80, RESET),
     "I forgot my password and need to reset it for my account.", "auto_draft"),
    ("Password reset (DE)",    cls("Request", "low", 0.90), hit(0.80, RESET),
     "Ich habe mein Passwort vergessen und muss es zurücksetzen.", "auto_draft"),
    ("Refund demand (EN)",     cls("Request", "medium", 0.90), hit(0.80, RESET),
     "Promise me a full refund and compensation for the downtime.", "escalate"),
    ("Refund demand (DE)",     cls("Request", "medium", 0.90), hit(0.80, RESET),
     "Ich möchte eine vollständige Rückerstattung und eine Entschädigung.", "escalate"),
    ("Refund supported",       cls("Request", "medium", 0.90),
     hit(0.80, "We processed your refund to the original payment method."),
     "Can I get a refund for my last invoice?", "auto_draft"),
    ("Gibberish",              cls("Request", "low", 0.30), hit(0.20, RESET),
     "asdf qwer zxcv lorem blah blah", "escalate"),
    ("Empty body",             cls("Request", "low", 0.90), hit(0.80, RESET), "", "escalate"),
    ("Low confidence",         cls("Request", "low", 0.40), hit(0.80, RESET),
     "I need help changing my notification settings please.", "escalate"),
    ("No precedent found",     cls("Request", "low", 0.90), [],
     "How do I connect my account to a brand new integration?", "escalate"),
]

if __name__ == "__main__":
    failed = 0
    for name, c, hits, body, expected in CASES:
        r = decide(c, hits, body)
        ok = r["action"] == expected
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:22} -> {r['action']:10} ({r['reason']})")
    print(f"\n{len(CASES) - failed}/{len(CASES)} passed")