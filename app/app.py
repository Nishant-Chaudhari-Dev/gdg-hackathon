import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import streamlit as st
from src.pipeline import triage

st.title("SentinelDesk")
subject = st.text_input("Subject (optional)")
body = st.text_area("Ticket body", height=160)

if st.button("Triage") and body.strip():
    r = triage(subject, body)
    c = r["classification"]
    st.write(f"**Type:** {c['type']} | **Queue:** {c['queue']} | "
             f"**Priority:** {c['priority']} | **Confidence:** {c['confidence']:.2f} | "
             f"**Latency:** {r['latency_s']}s | **Language:** {r['language']}")
    if r["decision"]["action"] == "escalate":
        st.error(f"Escalate to On-Call Engineer: {r['decision']['reason']}")
    else:
        st.success("Auto-Draft Ready")
    st.subheader("Retrieved tickets")
    for h in r["hits"]:
        st.write(f"**{h['ticket_id']}** (score {h['score']:.2f}): {h['answer'][:200]}")
    if r["reply"]:
        st.subheader("Draft reply")
        st.write(r["reply"])
