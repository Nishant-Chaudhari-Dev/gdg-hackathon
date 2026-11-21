# DEPRECATED: moved to services/

This folder is the original prototype layout. **Exception: `src/data_split.py` is canonical and stays here** (run `python -m src.data_split`, verify with `python eval/verify_split.py`). The other files are superseded:

| old | new |
|---|---|
| src/classifier.py | services/ml/app/model.py (ML team) |
| src/retrieval.py  | services/rag/app/retriever.py (RAG team) |
| src/generation.py | services/rag/app/generator.py (RAG team) |
| src/escalation.py | services/orchestrator/app/gate.py |
| src/pipeline.py   | services/orchestrator/app/pipeline.py |
| app/app.py (Streamlit) | web/ (Next.js console) |

See docs/CONTRACT.md.
