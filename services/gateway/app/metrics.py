"""Live operational metrics computed from recent tickets."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sentinel_core.schemas import Outage, TicketRecord


def _pct(values: list[float]) -> dict:
    if not values:
        return {"p50": 0.0, "p95": 0.0, "mean": 0.0, "n": 0}
    v = sorted(values)
    pick = lambda q: v[min(int(round(q * (len(v) - 1))), len(v) - 1)]  # noqa: E731
    return {"p50": round(pick(0.5), 1), "p95": round(pick(0.95), 1), "mean": round(sum(v) / len(v), 1), "n": len(v)}


def compute(tickets: list[TicketRecord], outages: list[Outage]) -> dict:
    done = [t for t in tickets if t.status == "done"]
    by_decision = Counter(t.decision.action for t in done if t.decision)
    reasons = Counter(r.code for t in done if t.decision for r in t.decision.reasons)
    stages: dict[str, list[float]] = defaultdict(list)
    for t in done:
        for k, v in t.timings_ms.items():
            stages[k].append(v)
    per_min = Counter(t.created_at.replace(second=0, microsecond=0).isoformat() for t in tickets)
    return {
        "window_tickets": len(tickets),
        "by_status": dict(Counter(t.status for t in tickets)),
        "by_decision": dict(by_decision),
        "escalation_rate": round(by_decision.get("escalate", 0) / len(done), 4) if done else 0.0,
        "by_reason": dict(reasons),
        "by_priority": dict(Counter(t.classification.priority.label for t in done if t.classification)),
        "by_queue": dict(Counter(t.classification.queue.label for t in done if t.classification)),
        "by_type": dict(Counter(t.classification.type.label for t in done if t.classification)),
        "by_language": dict(Counter(t.language for t in tickets)),
        "by_human_state": dict(Counter(t.human.state for t in done)),
        "latency_ms": _pct([t.latency_ms for t in done if t.latency_ms is not None]),
        "stage_latency_ms": {k: _pct(v) for k, v in stages.items()},
        "throughput": _throughput(per_min),
        "pii_masked_tickets": sum(1 for t in tickets if t.pii_entities),
        "active_outages": sum(1 for o in outages if o.status == "active"),
    }


def _throughput(per_min: Counter, minutes: int = 30) -> list[dict]:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    keys = [(now - timedelta(minutes=i)).isoformat() for i in range(minutes - 1, -1, -1)]
    return [{"minute": k, "count": per_min.get(k, 0)} for k in keys]
