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
