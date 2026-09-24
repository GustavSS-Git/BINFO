"""Task 5: bid (asking) vs contract price statistics per Binfo area.

Reads `data/raw/Transaction data for bid and contract price difference.xlsx`
(sheet "Data"), joins the task-4b postnummer->omrade mapping
(`data/derived/postnummer_omrade.csv`), and writes
`data/derived/utgangspris_vs_slutpris.json`: per area, the median and mean %
increase (contract price vs asking price), n, and the data period, with a minimum-n
fallback to the overall Stockholm figure.

Run with: ml/.venv/bin/python ml/stats_bid_diff.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_XLSX = ROOT / "data" / "raw" / "Transaction data for bid and contract price difference.xlsx"
POSTNUMMER_OMRADE_CSV = ROOT / "data" / "derived" / "postnummer_omrade.csv"
OUT_JSON = ROOT / "data" / "derived" / "utgangspris_vs_slutpris.json"

MIN_N_PER_AREA = 50  # owner-approved proposal (task brief): below this, fall back
# to the overall Stockholm average rather than reporting a noisy per-area figure.


def clean_postal_code(raw: object) -> str | float:
    if raw is None or (isinstance(raw, float) and np.isnan(raw)):
        return np.nan
    try:
        return str(int(float(raw))).zfill(5)
    except (ValueError, TypeError):
        return np.nan


def compute_pct_increase(contract_price: pd.Series, asking_price: pd.Series) -> pd.Series:
    """pct_increase = (contract_price - asking_price) / asking_price * 100.
    Recomputed from the raw price columns rather than trusting the pre-rounded
    'Increase in price' string column in the source (max observed discrepancy: 0.05
    percentage points, consistent with 1-decimal rounding in the source) -- this
    keeps full precision for the median/mean."""
    return (contract_price - asking_price) / asking_price * 100


def filter_valid_asking(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Excludes rows with a missing real_estate_ad_asking_price (exactly where the
    source's 'Increase in price' column is the literal string 'na'). Returns
    (filtered_df, n_excluded)."""
    n_missing = int(df["real_estate_ad_asking_price"].isna().sum())
    return df[df["real_estate_ad_asking_price"].notna()].copy(), n_missing


def area_entry(pct_values: pd.Series, min_n: int, overall_median_pct: float, overall_mean_pct: float) -> dict:
    """Builds one area's stats entry, including the n<min_n fallback-to-overall
    rule: the area's own (possibly noisy) median/mean are always reported, but
    median_pct_used/mean_pct_used are swapped for the overall Stockholm figures
    (with fallback_reason explaining why) whenever n is below min_n."""
    n = len(pct_values)
    entry = {
        "n": int(n),
        "median_pct": round(float(pct_values.median()), 2),
        "mean_pct": round(float(pct_values.mean()), 2),
    }
    if n < min_n:
        entry["fallback_to_overall"] = True
        entry["fallback_reason"] = f"n={n} < minimum n={min_n}"
        entry["median_pct_used"] = overall_median_pct
        entry["mean_pct_used"] = overall_mean_pct
    else:
        entry["fallback_to_overall"] = False
        entry["median_pct_used"] = entry["median_pct"]
        entry["mean_pct_used"] = entry["mean_pct"]
    return entry


def main() -> None:
    df = pd.read_excel(RAW_XLSX, sheet_name="Data")
    n_total_rows = len(df)

    df["contract_date"] = pd.to_datetime(df["contract_date"])
    period_start = df["contract_date"].min().date().isoformat()
    period_end = df["contract_date"].max().date().isoformat()

    df_valid, n_missing_asking = filter_valid_asking(df)

    df_valid["pct_increase"] = compute_pct_increase(df_valid["contract_price"], df_valid["real_estate_ad_asking_price"])

    df_valid["postal_code_clean"] = df_valid["postal_code"].apply(clean_postal_code)
    mapping = pd.read_csv(POSTNUMMER_OMRADE_CSV, dtype={"postnummer": str})
    mapping = mapping.rename(columns={"postnummer": "postal_code_clean"})
    df_valid = df_valid.merge(mapping[["postal_code_clean", "omrade"]], on="postal_code_clean", how="left")
    n_unmapped = int(df_valid["omrade"].isna().sum())
    df_valid["omrade"] = df_valid["omrade"].fillna("Okänt (postnummer ej kartlagt)")

    overall = {
        "n": int(len(df_valid)),
        "median_pct": round(float(df_valid["pct_increase"].median()), 2),
        "mean_pct": round(float(df_valid["pct_increase"].mean()), 2),
    }

    areas = {
        area: area_entry(group["pct_increase"], MIN_N_PER_AREA, overall["median_pct"], overall["mean_pct"])
        for area, group in df_valid.groupby("omrade")
    }

    output = {
        "period": {"start": period_start, "end": period_end},
        "min_n_per_area": MIN_N_PER_AREA,
        "n_rows_total": n_total_rows,
        "n_rows_missing_asking_price_excluded": n_missing_asking,
        "n_rows_used": int(len(df_valid)),
        "n_rows_unmapped_area": n_unmapped,
        "overall": overall,
        "areas": areas,
        "methodology": (
            "pct_increase = (contract_price - real_estate_ad_asking_price) / "
            "real_estate_ad_asking_price * 100, recomputed from the raw price "
            "columns (not the pre-rounded 'Increase in price' string column). "
            "Rows with a missing asking price are excluded (na in the source, "
            "exactly where 'Increase in price' == 'na'). Areas with n below "
            f"{MIN_N_PER_AREA} fall back to the overall Stockholm figure "
            "(median_pct_used/mean_pct_used); their own (noisy) area-level "
            "median_pct/mean_pct are still reported for transparency."
        ),
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"period: {period_start} to {period_end}")
    print(f"rows total: {n_total_rows}, missing asking price excluded: {n_missing_asking}, used: {len(df_valid)}")
    print(f"unmapped area rows: {n_unmapped}")
    print(f"overall: n={overall['n']} median={overall['median_pct']}% mean={overall['mean_pct']}%")
    for area, entry in sorted(areas.items()):
        flag = " (FALLBACK)" if entry["fallback_to_overall"] else ""
        print(f"  {area}: n={entry['n']} median={entry['median_pct']}% mean={entry['mean_pct']}%{flag}")
    print(f"\nWrote {OUT_JSON}")


if __name__ == "__main__":
    main()
