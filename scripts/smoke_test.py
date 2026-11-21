"""End-to-end smoke test against a running gateway (local or Cloud Run).

    python scripts/smoke_test.py                       # http://localhost:8080
    python scripts/smoke_test.py https://gateway-xxx.run.app
Exits non-zero if any service is down or any sample fails to complete.
"""
from __future__ import annotations

import sys
import time

import httpx

base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080").rstrip("/")
c = httpx.Client(base_url=base, timeout=90)
ok = True

sysinfo = c.get("/api/system").json()
print(f"mode={sysinfo['mode']} store={sysinfo['store']} bus={sysinfo['bus']}")
for s in sysinfo["services"]:
    ver = (s.get("info") or {}).get("version", "")
    print(f"  {'✅' if s['ok'] else '❌'} {s['name']:13} {s.get('latency_ms')} ms {ver} {s.get('error') or ''}")
    ok &= s["ok"]

print("\nsamples:")
for s in c.get("/api/samples").json()["items"]:
    t0 = time.time()
    r = c.post("/api/tickets", params={"wait": "true"}, json={"subject": s["subject"], "body": s["body"], "source": "smoke"}).json()
    done = r["status"] == "done"
    ok &= done
    cls = r.get("classification") or {}
    dec = r.get("decision") or {}
    print(f"  {'✅' if done else '❌'} {s['id']:13} {r['language']} "
          f"{cls.get('type', {}).get('label', '-'):8} {cls.get('priority', {}).get('label', '-'):6} "
          f"conf={cls.get('confidence', 0):.2f} → {dec.get('action', '-'):10} "
          f"{','.join(x['code'] for x in dec.get('reasons', []))[:70]:70} {time.time() - t0:.2f}s"
          f"   (expect: {s['expect']})")

m = c.get("/api/metrics").json()
print(f"\nmetrics: tickets={m['window_tickets']} escalation_rate={m['escalation_rate']} "
      f"p50={m['latency_ms']['p50']}ms p95={m['latency_ms']['p95']}ms outages={m['active_outages']}")
sys.exit(0 if ok else 1)
