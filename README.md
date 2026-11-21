# GDG Hackathon

Our project for the GDG Hackathon.

## Getting started

_Setup instructions coming soon._

# SentinelDesk
Multilingual incident triage, escalation, and grounded reply copilot.

## Setup
pip install -r requirements.txt
cp .env.example .env   # add your API key
python -m src.data_split

## Run
streamlit run app/app.py

## Evaluate
python eval/evaluate.py

## How it works
(Classifier, retrieval, escalation gate, grounded drafting. Fill in at the end.)
