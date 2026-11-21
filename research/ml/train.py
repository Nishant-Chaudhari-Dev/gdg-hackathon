"""
SentinelDesk ML: triage model (type / queue / priority) with calibrated probabilities.
    python research/ml/train.py            # FORCE_SAVE=1 to overwrite even if not better

Per head, tries LR / LinearSVC / SGD and their ensembles, picks the best on split==val
(a bigger ensemble must beat a simpler option by MIN_GAIN). Then calibrates (temperature + bias)
and tunes the priority=high threshold on split==val. Never reads test.csv.

Champion check: the artifact is only overwritten if the new mean val macro-F1 beats the saved model's
and HP-incident recall >= MIN_HPI; otherwise the run is saved as model_challenger.joblib.
"""
import json, os, time
import joblib, numpy as np, pandas as pd
from scipy.optimize import minimize
from scipy.special import softmax, log_softmax
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import f1_score, recall_score, precision_score
from sentinel_core.text import clean

KB = os.getenv("KB_PATH", "data/kb_train.csv")
OUT = os.getenv("MODEL_OUT", "research/ml/artifacts/model.joblib")
ART_DIR = os.path.dirname(OUT)
HEADS = ["type", "queue", "priority"]
WEIGHTS = {"type": 1.0, "queue": 1.0, "priority": 2.0}
TARGET_HIGH_RECALL = float(os.getenv("TARGET_HIGH_RECALL", "0.80"))
MIN_HPI = float(os.getenv("MIN_HPI", "0.78"))
MIN_GAIN = float(os.getenv("MIN_GAIN", "0.005"))
FORCE_SAVE = os.getenv("FORCE_SAVE", "0") == "1"

CANDIDATES = {
    "lr":  lambda: LogisticRegression(C=4.0, max_iter=2000, class_weight="balanced"),
    "svc": lambda: CalibratedClassifierCV(LinearSVC(C=0.5, class_weight="balanced"), method="sigmoid", cv=3),
    "sgd": lambda: CalibratedClassifierCV(SGDClassifier(loss="modified_huber", alpha=2e-5, class_weight="balanced",
                                                        max_iter=50, random_state=42), method="sigmoid", cv=3),
}
OPTIONS = {"lr": ["lr"], "svc": ["svc"], "sgd": ["sgd"],
           "lr+svc": ["lr", "svc"], "lr+sgd": ["lr", "sgd"], "lr+svc+sgd": ["lr", "svc", "sgd"]}


def build_text(subject, body):  # MUST match services/ml/app/model.py
    s, b = clean(subject), clean(body)
    return f"{s}\n{s}\n{b}" if s else b


def fit_calibrator(P, y):
    L = np.log(np.clip(P, 1e-9, 1.0))
    def nll(p):
        Z = L / np.exp(p[0]) + p[1:]
        return -log_softmax(Z, axis=1)[np.arange(len(y)), y].mean()
    r = minimize(nll, np.zeros(P.shape[1] + 1), method="L-BFGS-B")
    return float(np.exp(r.x[0])), r.x[1:].astype(np.float64)


def apply_cal(P, T, b):
    return softmax(np.log(np.clip(P, 1e-9, 1.0)) / T + b, axis=1)


def ece(P, y, bins=15):
    conf, acc, e = P.max(1), P.argmax(1) == y, 0.0
    edges = np.linspace(0, 1, bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs(acc[m].mean() - conf[m].mean())
    return float(e)


def pick_option(scores):
    """Best val macro-F1, but prefer fewer models unless the bigger one wins by MIN_GAIN."""
    best = max(scores.values())
    close = [o for o, s in scores.items() if s >= best - MIN_GAIN]
    return min(close, key=lambda o: (len(OPTIONS[o]), -scores[o]))


def main():
    t0 = time.time()
    kb = pd.read_csv(KB).dropna(subset=["body"] + HEADS)
    tr, va = kb[kb.split == "train"], kb[kb.split == "val"]
    feat = FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=200_000, sublinear_tf=True)),
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=3, max_features=200_000, sublinear_tf=True)),
    ])
    Xtr = feat.fit_transform([build_text(s, b) for s, b in zip(tr.subject, tr.body)])
    Xva = feat.transform([build_text(s, b) for s, b in zip(va.subject, va.body)])
    print(f"train {len(tr)} | val {len(va)} | features {Xtr.shape[1]:,} | {time.time()-t0:.0f}s", flush=True)

    heads, cal, dec, labels, raw_va, cal_va, yva, report, selection = {}, {}, {}, {}, {}, {}, {}, {}, {}
    for h in HEADS:
        fitted, P = {}, {}
        for name, make in CANDIDATES.items():
            fitted[name] = make().fit(Xtr, tr[h].astype(str))
            P[name] = fitted[name].predict_proba(Xva)
        labs = [str(c) for c in fitted["lr"].classes_]
        assert all([str(c) for c in m.classes_] == labs for m in fitted.values())
        y = np.array([labs.index(v) for v in va[h].astype(str)])
        scores = {o: round(f1_score(y, np.mean([P[m] for m in mem], axis=0).argmax(1), average="macro"), 4)
                  for o, mem in OPTIONS.items()}
        chosen = pick_option(scores)
        selection[h] = {"chosen": chosen, "val_macro_f1_by_option": scores}
        print(f"{h:9} options {scores} -> chosen: {chosen} | {time.time()-t0:.0f}s", flush=True)

        members = [fitted[m] for m in OPTIONS[chosen]]
        Pch = np.mean([P[m] for m in OPTIONS[chosen]], axis=0)
        T, b = fit_calibrator(Pch, y)
        Pc = apply_cal(Pch, T, b)
        f_raw = f1_score(y, Pch.argmax(1), average="macro")
        f_cal = f1_score(y, Pc.argmax(1), average="macro")
        dec[h] = "cal" if f_cal > f_raw else "raw"
        heads[h], cal[h], labels[h], raw_va[h], cal_va[h], yva[h] = members, (T, b), labs, Pch, Pc, y
        report[h] = {"chosen": chosen, "val_macro_f1_raw": round(f_raw, 4), "val_macro_f1_cal": round(f_cal, 4),
                     "decision": dec[h], "temperature": round(T, 3), "ece_raw": round(ece(Pch, y), 4), "ece_cal": round(ece(Pc, y), 4)}

    # ---- priority: threshold on calibrated P(high) for recall
    pl = labels["priority"]; hi = pl.index("high")
    base = (cal_va["priority"] if dec["priority"] == "cal" else raw_va["priority"]).argmax(1)
    tl = np.array(labels["type"])
    type_pred = tl[(cal_va["type"] if dec["type"] == "cal" else raw_va["type"]).argmax(1)]
    yp, yh = yva["priority"], yva["priority"] == hi
    true_hpi = yh & (va.type.astype(str).values == "Incident")
    rows = []
    for t in np.round(np.arange(0.20, 0.72, 0.02), 2):
        idx = np.where(cal_va["priority"][:, hi] >= t, hi, base)
        ph = idx == hi
        rows.append({"thr": t, "high_recall": recall_score(yh, ph), "high_precision": precision_score(yh, ph, zero_division=0),
                     "macro_f1": f1_score(yp, idx, average="macro"),
                     "hpi_recall": (ph & (type_pred == "Incident"))[true_hpi].mean()})
    tab = pd.DataFrame(rows).round(4)
    ok = tab[tab.high_recall >= TARGET_HIGH_RECALL]
    thr = float(ok.sort_values("macro_f1").iloc[-1].thr) if len(ok) else float(tab.thr.min())
    print(f"chosen high threshold = {thr} (target high recall {TARGET_HIGH_RECALL})", flush=True)

    # ---- final val predictions + overall confidence + gate table
    fidx = {}
    for h in HEADS:
        idx = (cal_va[h] if dec[h] == "cal" else raw_va[h]).argmax(1)
        if h == "priority":
            idx = np.where(cal_va[h][:, hi] >= thr, hi, idx)
        fidx[h] = idx
    conf = {h: cal_va[h][np.arange(len(va)), fidx[h]] for h in HEADS}
    overall = np.exp(sum(WEIGHTS[h] * np.log(np.clip(conf[h], 1e-6, 1)) for h in HEADS) / sum(WEIGHTS.values()))
    correct = {h: fidx[h] == yva[h] for h in HEADS}
    hp_rule = (np.array(pl)[fidx["priority"]] == "high") & (tl[fidx["type"]] == "Incident")
    final = {h: round(f1_score(yva[h], fidx[h], average="macro"), 4) for h in HEADS}
    final["hpi_recall"] = round(float(hp_rule[true_hpi].mean()), 4)
    score = round(float(np.mean([final[h] for h in HEADS])), 4)
    print("final val metrics:", final, "| mean macro-F1:", score)

    grows = []
    for g in [0.45, 0.50, 0.55, 0.60, 0.65]:
        auto = (overall >= g) & ~hp_rule
        grows.append({"gate": g, "auto_draft_%": round(auto.mean() * 100, 1),
                      "type+prio_correct_in_auto_%": round((correct["type"] & correct["priority"])[auto].mean() * 100, 1) if auto.any() else None,
                      "true_HPI_escalated_%": round((~auto)[true_hpi].mean() * 100, 1)})
    gate_tab = pd.DataFrame(grows)
    print("gate table (val):\n", gate_tab.to_string(index=False))

    version = f"tfidf-wc-auto-{time.strftime('%m%d%H%M')}"
    bundle = {"version": version, "featurizer": feat, "heads": heads, "calibration": cal, "decision": dec,
              "high_thr": thr, "weights": WEIGHTS, "selection": {h: selection[h]["chosen"] for h in HEADS},
              "text_format": "subject\\nsubject\\nbody (clean) v1"}
    rep = {"version": version, "score_mean_val_macro_f1": score, "heads": report, "selection": selection,
           "high_thr": thr, "final_val": final, "priority_table": tab.to_dict("records"), "gate_table": gate_tab.to_dict("records")}

    # ---- champion check
    os.makedirs(ART_DIR, exist_ok=True)
    rep_path = os.path.join(ART_DIR, "train_report.json")
    prev_score, prev_version = None, None
    if os.path.exists(OUT) and os.path.exists(rep_path):
        prev = json.load(open(rep_path))
        prev_version = prev.get("version")
        prev_score = prev.get("score_mean_val_macro_f1") or round(float(np.mean([prev["final_val"][h] for h in HEADS])), 4)
    better = prev_score is None or (score > prev_score and final["hpi_recall"] >= MIN_HPI)
    if FORCE_SAVE or better:
        joblib.dump(bundle, OUT, compress=3)
        json.dump(rep, open(rep_path, "w"), indent=2, default=float)
        print(f"\nCHAMPION saved {OUT} ({os.path.getsize(OUT)/1e6:.0f} MB) | {version} | score {score} vs previous {prev_score} ({prev_version})")
    else:
        ch = os.path.join(ART_DIR, "model_challenger.joblib")
        joblib.dump(bundle, ch, compress=3)
        json.dump(rep, open(os.path.join(ART_DIR, "train_report_challenger.json"), "w"), indent=2, default=float)
        print(f"\nKEPT existing model {prev_version} (score {prev_score}); new run scored {score}, "
              f"hpi {final['hpi_recall']} -> saved as {ch}")
    print(f"total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
