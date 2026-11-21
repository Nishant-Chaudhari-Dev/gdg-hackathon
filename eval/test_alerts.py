"""Tests for on-call paging: orchestrator trigger (alerts.py) + notifier rate limiting and message.
    python -m pytest eval/test_alerts.py -q
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "shared"))
from sentinel_core.schemas import AlertEvent, EscalationDecision  # noqa: E402

os.environ.setdefault("STORE", "remote")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# both services name their package `app`, so load the two modules by file path
alerts = _load("orch_alerts", "services/orchestrator/app/alerts.py")
notifier = _load("notifier_main", "services/notifier/app/main.py")

ESC, AUTO = EscalationDecision(action="escalate"), EscalationDecision(action="auto_draft")


def test_critical_wording_pages_when_escalated():
    assert alerts.should_page(ESC, "Our production system crashed overnight") == ["system crash"]
    assert "page down" in alerts.should_page(ESC, "The checkout page is down for all customers")
    assert alerts.should_page(ESC, "Systemabsturz in der Produktion") == ["Systemabsturz"]
    assert alerts.should_page(ESC, "Die Webseite ist nicht mehr erreichbar") == ["Seite nicht erreichbar"]


def test_auto_drafted_tickets_never_page():
    assert alerts.should_page(AUTO, "Our production system crashed overnight") == []


def test_normal_tickets_do_not_page():
    for text in ["Where can I download my invoices as PDF?", "The crash course schedule changed",
                 "Please update our billing address"]:
        assert alerts.should_page(ESC, text) == []


def test_rate_limit_one_per_cooldown_and_daily_cap():
    rl = notifier.RateLimiter(cooldown_s=300, daily_cap=2)
    t0 = 1_800_000_000.0
    assert rl.check(t0) == "ok"
    rl.record_sent(t0)
    assert rl.check(t0 + 10) == "cooldown"
    rl.record_suppressed()
    rl.record_suppressed()
    assert rl.check(t0 + 301) == "ok"
    assert rl.record_sent(t0 + 301) == 2  # two alerts were held back
    assert rl.check(t0 + 1000) == "daily_cap"
    assert rl.check(t0 + 86_400) == "ok"  # next UTC day resets the cap


def test_push_message_mentions_ticket_and_held_back_count():
    ev = AlertEvent(ticket_id="LIVE-1", subject="Checkout down", snippet="The checkout page is down.",
                    keywords=["page down"], priority="high", queue="IT Support")
    push = notifier.build_push(ev, held_back=3)
    assert "page down" in push["title"] and push["priority"] == 5
    assert "LIVE-1" in push["message"] and "+3 more" in push["message"]


def test_email_is_built_with_subject_link_and_both_parts():
    notifier.EMAIL_FROM, notifier.EMAIL_TO = "pager@example.com", ["oncall@example.com"]
    push = {"title": "🚨 SentinelDesk on-call: system crash", "message": "LIVE-1 · high\nCheckout down",
            "click": "https://console.example/queue?ticket=LIVE-1"}
    msg = notifier.build_email(push)
    assert msg["Subject"] == push["title"] and msg["To"] == "oncall@example.com"
    parts = {p.get_content_type(): p.get_content() for p in msg.iter_parts()}
    assert "Open ticket: https://console.example/queue?ticket=LIVE-1" in parts["text/plain"]
    assert "Open ticket in SentinelDesk" in parts["text/html"] and "LIVE-1" in parts["text/html"]


def test_delivery_succeeds_if_any_channel_works(monkeypatch):
    import asyncio
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self, context=None): pass
        def login(self, u, p): assert u == "pager@example.com" and p == "apppassword"
        def send_message(self, m): sent.append(m["Subject"])

    async def ntfy_down(*a, **k):
        raise RuntimeError("429 Too Many Requests")

    monkeypatch.setattr(notifier.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(notifier._http, "post", ntfy_down)
    monkeypatch.setattr(notifier, "DRY_RUN", False)
    monkeypatch.setattr(notifier, "SMTP_USER", "pager@example.com")
    monkeypatch.setattr(notifier, "SMTP_PASSWORD", "apppassword")
    monkeypatch.setattr(notifier, "EMAIL_TO", ["oncall@example.com"])
    monkeypatch.setattr(notifier, "EMAIL_FROM", "pager@example.com")
    monkeypatch.setattr(notifier, "NTFY_TOPIC", "t")
    ok = asyncio.run(notifier._send({"title": "t", "message": "m"}))
    assert ok == ["email"] and sent == ["t"]


def test_delivery_fails_when_every_channel_fails(monkeypatch):
    import asyncio
    import pytest

    async def ntfy_down(*a, **k):
        raise RuntimeError("429")

    monkeypatch.setattr(notifier, "DRY_RUN", False)
    monkeypatch.setattr(notifier, "SMTP_PASSWORD", "")
    monkeypatch.setattr(notifier, "NTFY_TOPIC", "t")
    monkeypatch.setattr(notifier._http, "post", ntfy_down)
    with pytest.raises(RuntimeError):
        asyncio.run(notifier._send({"title": "t", "message": "m"}))
