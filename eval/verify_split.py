"""
Verify the data split. Run from repo root:
    python -m src.data_split        # regenerate (deterministic)
    python eval/verify_split.py     # all checks should PASS
"""
import hashlib, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pandas as pd
from src.data_split import load_kb, load_train_val, load_test, load_test_inputs, TARGETS

norm = lambda s: re.sub(r"\s+", " ", str(s).lower()).strip()

kb, test = load_kb(), load_test()
tr, va = load_train_val()
ti = load_test_inputs()
m = json.load(open("data/split_manifest.json"))

checks = {
    "sizes match manifest": (len(tr), len(va), len(test)) == (m["kb_train"], m["kb_val"], m["test"]),
    "test ID hash matches manifest": hashlib.sha1(",".join(test.ticket_id).encode()).hexdigest()[:12] == m["test_ids_sha1"],
    "no ticket_id overlap KB/test": len(set(kb.ticket_id) & set(test.ticket_id)) == 0,
    "no body overlap KB/test": not test.body.map(norm).isin(set(kb.body.map(norm))).any(),
    "no duplicate bodies anywhere": not pd.concat([kb.body, test.body]).map(norm).duplicated().any(),
    "no missing labels": int(kb[TARGETS].isna().sum().sum() + test[TARGETS].isna().sum().sum()) == 0,
    "test_inputs has only id/subject/body": list(ti.columns) == ["ticket_id", "subject", "body"],
    "test_inputs IDs == test IDs": list(ti.ticket_id) == list(test.ticket_id),
}

print(f"source: {m['source_file']} | seed {m['seed']} | train {len(tr)} / val {len(va)} / test {len(test)}\n")
for name, ok in checks.items():
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")

for t in TARGETS:
    comp = pd.concat([tr[t].value_counts(normalize=True), va[t].value_counts(normalize=True),
                      test[t].value_counts(normalize=True)], axis=1, keys=["train", "val", "test"]).mul(100).round(1)
    print(f"\n{t} (%):\n{comp}")

hpi = lambda d: ((d.priority == "high") & (d.type == "Incident")).mean() * 100
print(f"\nhigh-priority incidents: train {hpi(tr):.1f}% | val {hpi(va):.1f}% | test {hpi(test):.1f}%")

if not all(checks.values()):
    sys.exit(1)
print("\nAll checks passed.")
