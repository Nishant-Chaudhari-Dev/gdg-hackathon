import os
import pandas as pd
from datasets import load_dataset

# Uses hackathon problem statement
def make_split():
    ds = load_dataset("Tobi-Bueck/customer-support-tickets")
    df = ds["train"].to_pandas()
    df = df.sample(frac=1.0, random_state=42).reset_index(drop=True)
    df["ticket_id"] = [f"TKT-{i:05d}" for i in range(len(df))]
    split_idx = int(len(df) * 0.8)
    os.makedirs("data", exist_ok=True)
    df.iloc[:split_idx].to_csv("data/kb_train.csv", index=False)
    df.iloc[split_idx:].to_csv("data/test.csv", index=False)

def load_kb():
    return pd.read_csv("data/kb_train.csv")

def load_test():
    return pd.read_csv("data/test.csv")

if __name__ == "__main__":
    make_split()
