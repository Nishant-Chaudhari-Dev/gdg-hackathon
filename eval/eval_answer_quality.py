"""Answer quality of grounded drafts against REAL historical resolutions (KB val split).

Owner: RAG team (Nishant).   Run from the repo root (needs GEMINI_API_KEY or Vertex auth):
    python eval/eval_answer_quality.py [--n 25] [--seed 3] [--sleep 4.5] [--no-judge]

Why the val split: the holdout's `answer` column must never be read, but KB val tickets are
part of the knowledge base, so their real agent answers can be used as references. Each val
ticket is queried against the index WITHOUT itself (and without verbatim duplicates), drafted
by the production Generator path, and the draft is compared with the real answer:
  * semantic similarity draft -> real answer (multilingual-e5, same model as retrieval),
    against two baselines: the top precedent's answer copied verbatim, and a generic holding reply;
  * optional LLM judge: does the draft cover the key resolution of the real answer
    (full / partial / none), and does it contradict it?

Writes eval/results/answer_quality_metrics.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import services.rag.app.generator as gen  # noqa: E402
from services.rag.app.retriever import Retriever, guess_language, ticket_text  # noqa: E402

OUT = ROOT / "eval" / "results" / "answer_quality_metrics.json"
GENERIC = {
    "en": "Thank you for contacting us. We have received your request and a specialist will review it and get back to you shortly.",
    "de": "Vielen Dank für Ihre Nachricht. Wir haben Ihre Anfrage erhalten und ein Spezialist wird sich in Kürze bei Ihnen melden.",
}
JUDGE_PROMPT = """You compare a DRAFT support reply with the REFERENCE reply a human agent actually sent.
Answer in JSON. "coverage": does the draft cover the key resolution/next steps of the reference?
"full" = same key steps, "partial" = some, "none" = misses them. "contradicts": true if the draft says
something that conflicts with the reference. Judge meaning, not wording; languages may differ.

TICKET:
<ticket>{ticket}</ticket>

REFERENCE (human agent):
<reference>{reference}</reference>

DRAFT (system):
<draft>{draft}</draft>
"""


def judge(client, ticket: str, reference: str, draft: str) -> dict | None:
    from google.genai import types

    schema = {"type": "object", "properties": {
        "coverage": {"type": "string", "enum": ["full", "partial", "none"]},
        "contradicts": {"type": "boolean"}, "why": {"type": "string"}},
        "required": ["coverage", "contradicts", "why"]}
    for model in ("gemini-3.5-flash-lite", "gemini-2.5-flash"):
        try:
            r = client.models.generate_content(
                model=model, contents=JUDGE_PROMPT.format(ticket=ticket[:1500], reference=reference[:1500], draft=draft[:1500]),
                config=types.GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=schema))
            return {**json.loads(r.text), "judge_model": model}
        except Exception:  # noqa: BLE001 - rate limits / unavailable model -> next
            time.sleep(6)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=25)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--sleep", type=float, default=4.5, help="seconds between tickets (free tier: 15 req/min)")
    ap.add_argument("--no-judge", action="store_true")
    args = ap.parse_args()

    r = Retriever()
    r.load()
    meta = r._meta
    val = meta[meta["split"] == "val"].sample(n=args.n, random_state=args.seed)
    client = None
    if not args.no_judge:
        from google import genai

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("LLM_API_KEY"))

    rows = []
    for i, t in enumerate(val.itertuples(), 1):
        text = ticket_text(t.subject, t.body)
        lang = guess_language(text) or "en"
        qv = r._enc.encode([text])
        hits, _ = r.rank(qv, text, args.k, lang, exclude_ids={t.ticket_id}, exclude_keys={t.dedup_key})
        d = gen.draft_full(t.subject, t.body, lang, hits)
        reply = gen._CITE.sub(" ", d["reply"])
        ref = t.answer
        v = r._enc.encode([ref, reply, hits[0]["answer"] if hits else "", GENERIC[lang]])
        sim = {"draft": float(v[0] @ v[1]), "top_precedent_copy": float(v[0] @ v[2]), "generic": float(v[0] @ v[3])}
        row = {"ticket_id": t.ticket_id, "lang": lang, "model": d["source"], "groundedness": d["groundedness_score"],
               "sim": {k_: round(x, 4) for k_, x in sim.items()}}
        if client is not None and d["source"] != "fallback":
            row["judge"] = judge(client, text, ref, d["reply"])
        rows.append(row)
        j = (row.get("judge") or {})
        print(f"[{i:>2}/{args.n}] {t.ticket_id} {lang} {d['source']:22s} sim draft {sim['draft']:.3f} | "
              f"copy {sim['top_precedent_copy']:.3f} | generic {sim['generic']:.3f} | judge {j.get('coverage')}"
              f"{' CONTRADICTS' if j.get('contradicts') else ''}", flush=True)
        time.sleep(args.sleep)

    def mean(key):
        return round(float(np.mean([x["sim"][key] for x in rows])), 4)

    judged = [x["judge"] for x in rows if x.get("judge")]
    report = {
        "n": len(rows), "split": "kb val (leave-one-out: each ticket and its duplicates excluded from the index)",
        "served_by": {m: sum(x["model"] == m for x in rows) for m in {x["model"] for x in rows}},
        "mean_similarity_to_real_answer": {"draft": mean("draft"), "top_precedent_copy": mean("top_precedent_copy"),
                                           "generic_reply": mean("generic")},
        "draft_beats_generic_rate": round(float(np.mean([x["sim"]["draft"] > x["sim"]["generic"] for x in rows])), 3),
        "draft_vs_copy_win_rate": round(float(np.mean([x["sim"]["draft"] >= x["sim"]["top_precedent_copy"] for x in rows])), 3),
        "mean_groundedness": round(float(np.mean([x["groundedness"] for x in rows])), 3),
    }
    if judged:
        report["judge"] = {
            "n": len(judged),
            "coverage_full": round(sum(j["coverage"] == "full" for j in judged) / len(judged), 3),
            "coverage_full_or_partial": round(sum(j["coverage"] in ("full", "partial") for j in judged) / len(judged), 3),
            "contradiction_rate": round(sum(bool(j["contradicts"]) for j in judged) / len(judged), 3),
            "judge_models": {m: sum(j["judge_model"] == m for j in judged) for m in {j["judge_model"] for j in judged}},
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"report": report, "rows": rows}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
