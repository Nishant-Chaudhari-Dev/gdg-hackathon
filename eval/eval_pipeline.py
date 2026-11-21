"""End-to-end accuracy of the LIVE pipeline (gateway -> Pub/Sub -> orchestrator -> ML + RAG + Gemini -> gate).

Sends holdout tickets (subject + body ONLY, from data/test_inputs.csv) to a running gateway, then scores the
results against data/test.csv labels. Labels are used for scoring only and never sent to the system.

    python eval/eval_pipeline.py --gateway https://gateway-xxx.run.app --n 150
Writes eval/results/pipeline_latest.json.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pct(v: list[float], q: float) -> float:
    v = sorted(v)
    return round(v[min(int(q * (len(v) - 1)), len(v) - 1)], 1) if v else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gateway", required=True)
    ap.add_argument("--n", type=int, default=150)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(ROOT, "eval", "results", "pipeline_latest.json"))
    a = ap.parse_args()

    inputs = pd.read_csv(os.path.join(ROOT, "data", "test_inputs.csv"))
    labels = pd.read_csv(os.path.join(ROOT, "data", "test.csv")).set_index("ticket_id")
    sample = inputs.sample(n=min(a.n, len(inputs)), random_state=a.seed).reset_index(drop=True)
    client = httpx.Client(base_url=a.gateway.rstrip("/"), timeout=90)

    def run(row) -> dict:
        body = {"subject": "" if pd.isna(row.subject) else str(row.subject), "body": str(row.body), "source": "eval"}
        t0 = time.perf_counter()
        try:
            r = client.post("/api/tickets", params={"wait": "true"}, json=body)
            r.raise_for_status()
            return {"tid": row.ticket_id, "rec": r.json(), "wall_ms": (time.perf_counter() - t0) * 1000}
        except Exception as e:  # noqa: BLE001
            return {"tid": row.ticket_id, "rec": None, "error": repr(e)[:200]}

    t_start = time.time()
    with ThreadPoolExecutor(a.workers) as ex:
        results = list(ex.map(run, [r for r in sample.itertuples()]))
    done = [r for r in results if r["rec"] and r["rec"].get("status") == "done" and r["rec"].get("classification")]
    print(f"processed {len(done)}/{len(results)} in {time.time() - t_start:.0f}s")

    rows = []
    for r in done:
        rec, lab = r["rec"], labels.loc[r["tid"]]
        c, d, dr = rec["classification"], rec["decision"], rec.get("draft") or {}
        rows.append({
            "type_t": lab["type"], "type_p": c["type"]["label"], "queue_t": lab["queue"], "queue_p": c["queue"]["label"],
            "prio_t": lab["priority"], "prio_p": c["priority"]["label"], "conf": c["confidence"],
            "esc": d["action"] == "escalate", "reasons": [x["code"] for x in d["reasons"] if x["severity"] != "info"],
            "hpi_t": lab["priority"] == "high" and lab["type"] == "Incident",
            "has_draft": bool(dr.get("reply")), "cites": len(dr.get("cited_ticket_ids") or []),
            "grounded": dr.get("grounded"), "gscore": dr.get("groundedness_score"), "lang": rec["language"],
            "draft_lang_ok": (dr.get("language") == rec["language"]) if dr.get("reply") else None,
            "max_score": (rec.get("retrieval") or {}).get("max_score"), "latency": rec.get("latency_ms"),
            "paged": (rec.get("paging") or {}).get("state"), "outage": bool(rec.get("outage_id")),
        })
    df = pd.DataFrame(rows)

    def head(t, p):
        return {"accuracy": round(accuracy_score(df[t], df[p]), 3),
                "macro_f1": round(f1_score(df[t], df[p], average="macro", zero_division=0), 3)}

    hpi = df[df.hpi_t]
    auto = df[~df.esc]
    reason_counts = pd.Series([c for rs in df.reasons for c in set(rs)]).value_counts().to_dict()
    drafts = df[df.has_draft]
    lat = [x for x in df.latency if x is not None]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "gateway": a.gateway, "n_sent": len(results),
        "n_scored": len(df), "errors": len(results) - len(done),
        "classification": {"type": head("type_t", "type_p"), "queue": head("queue_t", "queue_p"),
                           "priority": head("prio_t", "prio_p")},
        "escalation": {
            "rate": round(df.esc.mean(), 3),
            "true_hp_incidents": int(len(hpi)),
            "hp_incident_escalation_recall": round(hpi.esc.mean(), 3) if len(hpi) else None,
            "hp_incidents_auto_drafted (misses)": int((~hpi.esc).sum()),
            "auto_drafted": int(len(auto)),
            "auto_drafted_that_were_true_high_priority": int((auto.prio_t == "high").sum()),
            "reasons_present": reason_counts,
        },
        "drafts": {
            "with_draft": int(len(drafts)), "language_match": round(drafts.draft_lang_ok.mean(), 3) if len(drafts) else None,
            "mean_citations": round(drafts.cites.mean(), 2) if len(drafts) else None,
            "grounded_rate": round(drafts.grounded.mean(), 3) if len(drafts) else None,
            "mean_groundedness": round(drafts.gscore.dropna().mean(), 3) if len(drafts) else None,
        },
        "retrieval_max_score": {"p5": pct(list(df.max_score.dropna()), .05), "median": pct(list(df.max_score.dropna()), .5)},
        "latency_ms": {"p50": pct(lat, .5), "p95": pct(lat, .95), "mean": round(statistics.mean(lat), 1) if lat else 0},
        "paging": df.paged.value_counts().to_dict(), "tickets_in_outage": int(df.outage.sum()),
        "languages": df.lang.value_counts().to_dict(),
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
