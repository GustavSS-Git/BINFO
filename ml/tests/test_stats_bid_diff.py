import math
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from stats_bid_diff import (  # noqa: E402
    MIN_N_PER_AREA,
    area_entry,
    clean_postal_code,
    compute_pct_increase,
    filter_valid_asking,
)


def test_clean_postal_code_pads_to_five_digits():
    assert clean_postal_code(16441.0) == "16441"
    assert clean_postal_code(9999) == "09999"


def test_clean_postal_code_missing_is_nan():
    result = clean_postal_code(float("nan"))
    assert isinstance(result, float) and math.isnan(result)


class TestComputePctIncrease:
    def test_matches_source_examples(self):
        # from data/raw/Transaction data for bid and contract price difference.xlsx,
        # row 0: asking 1,695,000 -> contract 1,650,000, source string "-2.7%"
        contract = pd.Series([1650000.0])
        asking = pd.Series([1695000.0])
        result = compute_pct_increase(contract, asking)
        assert result.iloc[0] == pytest.approx(-2.65486725664, abs=1e-6)
        # matches the source's rounded "-2.7%" to 1 decimal place
        assert round(result.iloc[0], 1) == pytest.approx(-2.7)

    def test_matches_source_examples_positive(self):
        # row 1: asking 2,495,000 -> contract 3,150,000, source string "26.3%"
        contract = pd.Series([3150000.0])
        asking = pd.Series([2495000.0])
        result = compute_pct_increase(contract, asking)
        assert round(result.iloc[0], 1) == pytest.approx(26.3)

    def test_zero_change(self):
        result = compute_pct_increase(pd.Series([1000000.0]), pd.Series([1000000.0]))
        assert result.iloc[0] == pytest.approx(0.0)

    def test_vectorised_over_series(self):
        contract = pd.Series([1100.0, 900.0, 1000.0])
        asking = pd.Series([1000.0, 1000.0, 1000.0])
        result = compute_pct_increase(contract, asking)
        assert result.tolist() == pytest.approx([10.0, -10.0, 0.0])


class TestFilterValidAsking:
    def test_excludes_missing_asking_price_rows(self):
        df = pd.DataFrame(
            {
                "real_estate_ad_asking_price": [1000000.0, None, 2000000.0, float("nan")],
                "contract_price": [1050000.0, 900000.0, 1900000.0, 800000.0],
            }
        )
        filtered, n_excluded = filter_valid_asking(df)
        assert n_excluded == 2
        assert len(filtered) == 2
        assert filtered["real_estate_ad_asking_price"].notna().all()

    def test_no_missing_rows(self):
        df = pd.DataFrame({"real_estate_ad_asking_price": [1000000.0, 2000000.0], "contract_price": [1050000.0, 1900000.0]})
        filtered, n_excluded = filter_valid_asking(df)
        assert n_excluded == 0
        assert len(filtered) == 2


class TestAreaEntry:
    def test_below_min_n_falls_back_to_overall(self):
        pct_values = pd.Series([1.0, 2.0, 3.0])  # n=3, well below MIN_N_PER_AREA
        entry = area_entry(pct_values, min_n=50, overall_median_pct=4.78, overall_mean_pct=6.41)
        assert entry["n"] == 3
        assert entry["fallback_to_overall"] is True
        assert entry["fallback_reason"] == "n=3 < minimum n=50"
        assert entry["median_pct_used"] == 4.78
        assert entry["mean_pct_used"] == 6.41
        # the area's own (noisy) stats are still reported, just not used
        assert entry["median_pct"] == 2.0
        assert entry["mean_pct"] == pytest.approx(2.0)

    def test_at_or_above_min_n_uses_own_stats(self):
        pct_values = pd.Series(list(range(50)), dtype=float)  # n=50, exactly at the bar
        entry = area_entry(pct_values, min_n=50, overall_median_pct=999.0, overall_mean_pct=999.0)
        assert entry["n"] == 50
        assert entry["fallback_to_overall"] is False
        assert "fallback_reason" not in entry
        assert entry["median_pct_used"] == entry["median_pct"]
        assert entry["mean_pct_used"] == entry["mean_pct"]
        assert entry["median_pct_used"] != 999.0

    def test_default_min_n_constant_is_50(self):
        assert MIN_N_PER_AREA == 50

    def test_just_below_default_min_n(self):
        pct_values = pd.Series(list(range(49)), dtype=float)
        entry = area_entry(pct_values, min_n=MIN_N_PER_AREA, overall_median_pct=5.0, overall_mean_pct=5.0)
        assert entry["fallback_to_overall"] is True
