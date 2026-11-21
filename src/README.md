# DEPRECATED: moved to services/

This folder is the original prototype layout, kept until everyone has migrated. Nothing imports it anymore.

| old | new |
|---|---|
| src/classifier.py | services/ml/app/model.py (ML team) |
| src/retrieval.py  | services/rag/app/retriever.py (RAG team) |
| src/generation.py | services/rag/app/generator.py (RAG team) |
| src/escalation.py | services/orchestrator/app/gate.py |
| src/pipeline.py   | services/orchestrator/app/pipeline.py |
| src/data_split.py | scripts/data_split.py |
| app/app.py (Streamlit) | web/ (Next.js console) |

See docs/CONTRACT.md.
