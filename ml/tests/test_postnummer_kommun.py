"""Tests for ml/mapping/build_postnummer_kommun.py: pure decision rule, name
matching, point-in-polygon assignment, and invariants of the generated CSV."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mapping"))

import build_postnummer_kommun as b  # noqa: E402

CSV = Path(__file__).resolve().parents[2] / "data" / "derived" / "postnummer_kommun.csv"


class TestNormalise:
    def test_spaces_removed(self):
        assert b.normalise_postcode("196 40") == "19640"

    @pytest.mark.parametrize("bad", [None, "", "1964", "196400", "19a40", "19640;19641"])
    def test_invalid(self, bad):
        assert b.normalise_postcode(bad) is None


class TestNameMatching:
    PLAIN = ["Stockholm", "Upplands Väsby", "Upplands-Bro", "Salem", "Sollentuna", "Danderyd"]

    @pytest.mark.parametrize(
        "osm,expected",
        [
            ("Stockholms kommun", "Stockholm"),
            ("Upplands Väsby kommun", "Upplands Väsby"),
            ("Upplands-Bro kommun", "Upplands-Bro"),
            ("Salems kommun", "Salem"),
            ("Danderyds kommun", "Danderyd"),
            ("Sollentuna kommun", "Sollentuna"),
        ],
    )
    def test_match(self, osm, expected):
        assert b.match_osm_name_to_plain(osm, self.PLAIN) == expected

    def test_no_match_is_none(self):
        assert b.match_osm_name_to_plain("Atlantis kommun", self.PLAIN) is None

    def test_ambiguous_is_none(self):
        assert b.match_osm_name_to_plain("Sala kommun", ["Sala", "Sala"]) is None


class TestPolygons:
    def test_smallest_polygon_wins_overlap(self):
        polys = {"A": box(0, 0, 10, 10), "B": box(4, 4, 6, 6)}
        res = b.assign_points(np.array([5.0, 1.0, 20.0]), np.array([5.0, 1.0, 20.0]), polys)
        assert res == ["B", "A", None]


class TestDecide:
    def test_blank_geonames_uses_strong_osm(self):
        r = b.decide(None, {"0184": 9, "0180": 1}, None, False)
        assert r["kommun"] == "0184" and r["metod"] == "osm_majority" and not r["konflikt_geonames"]

    def test_strong_osm_overrides_conflicting_geonames_and_flags(self):
        r = b.decide("0187", {"0120": 535, "0187": 5}, None, False)
        assert r["kommun"] == "0120" and r["konflikt_geonames"] is True

    def test_weak_osm_does_not_override_geonames(self):
        r = b.decide("0180", {"0126": 2}, None, False)
        assert r["kommun"] == "0180" and r["metod"] == "geonames_admin2" and "osm_oenig_svag" in r["flags"]

    def test_geonames_kept_when_agree(self):
        r = b.decide("0180", {"0180": 20}, None, False)
        assert r["metod"] == "geonames_admin2"

    def test_few_osm_points_blank_geonames_is_weak(self):
        r = b.decide(None, {"0163": 1}, "0114", False)
        assert r["kommun"] == "0163" and r["metod"] == "osm_majority_svag"

    def test_coordinate_fallback_only_if_not_generic(self):
        assert b.decide(None, None, "0180", True) is None
        r = b.decide(None, None, "0180", False)
        assert r["metod"] == "geonames_koordinat" and "approximativ_koordinat" in r["flags"]

    def test_unmappable(self):
        assert b.decide(None, None, None, False) is None

    def test_straddle_flag(self):
        r = b.decide("0182", {"0182": 5, "0180": 5}, None, False)
        assert "grans" in r["flags"]

    def test_majority_tie_deterministic(self):
        assert b.majority({"0182": 5, "0180": 5})[0] == "0180"


@pytest.fixture(scope="module")
def df():
    return pd.read_csv(CSV, dtype=str, keep_default_na=False)


@pytest.mark.skipif(not CSV.exists(), reason="postnummer_kommun.csv not generated")
class TestGeneratedCsv:

    def test_columns(self, df):
        for c in ["postnummer", "kommun_kod", "kommun_namn", "lan_kod", "metod", "kalla"]:
            assert c in df.columns

    def test_formats_and_uniqueness(self, df):
        assert df["postnummer"].str.fullmatch(r"\d{5}").all()
        assert df["kommun_kod"].str.fullmatch(r"\d{4}").all()
        assert df["postnummer"].is_unique
        assert (df["lan_kod"] == df["kommun_kod"].str[:2]).all()
        assert (df["kommun_namn"] != "").all()

    def test_geonames_rows_equal_geonames_code(self, df):
        g = df[df["metod"] == "geonames_admin2"]
        assert (g["kommun_kod"] == g["kommun_kod_geonames"]).all()

    def test_overrides_are_flagged_conflicts(self, df):
        o = df[df["konflikt_geonames"] == "True"]
        assert (o["metod"] == "osm_majority").all()
        assert (o["kommun_kod"] != o["kommun_kod_geonames"]).all()

    def test_the_four_gap_kommuner_present(self, df):
        names = set(df["kommun_namn"])
        assert {"Sigtuna", "Sollentuna", "Upplands Väsby", "Upplands-Bro"} <= names
