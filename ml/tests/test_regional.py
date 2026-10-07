"""Regional price level data: xlsx parsing, kommun-name matching and the generated
data/derived/regional_prisniva.json (Svensk Maklarstatistik averages, owner-supplied)."""

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ML = Path(__file__).resolve().parents[1]
ROOT = ML.parent
sys.path.insert(0, str(ML))

import build_regional_prisniva as b  # noqa: E402

JSON = ROOT / "data" / "derived" / "regional_prisniva.json"
RIKET = ROOT / "data" / "raw" / "riket_prisniva.csv"


def test_parse_xlsx_shape():
    rows = b.parse_xlsx()
    assert len(rows) == 27  # län + 26 kommuner
    assert all(isinstance(r["kr_per_m2_12man"], int) and r["kr_per_m2_12man"] > 0 for r in rows)
    by = {r["namn"]: r for r in rows}
    assert by["Stockholms län"]["kr_per_m2_12man"] == 70164
    assert by["Stockholm"]["kr_per_m2_12man"] == 90017
    assert by["Stockholm"]["kr_per_m2_3man"] == 90920


def test_match_names_exact_and_ambiguity():
    rows = [{"namn": "Upplands Väsby", "kr_per_m2_3man": 1, "kr_per_m2_12man": 2}, {"namn": "Nowhere", "kr_per_m2_3man": 1, "kr_per_m2_12man": 2}]
    m, problems = b.match_names(rows, {"0114": "Upplands Väsby", "0001": "Sala", "0002": "Sala"})
    assert [x["kod"] for x in m] == ["0114"] and len(problems) == 1
    m, problems = b.match_names([{"namn": "Sala", "kr_per_m2_3man": 1, "kr_per_m2_12man": 2}], {"0001": "Sala", "0002": "Sala"})
    assert not m and "2 matches" in problems[0]


@pytest.mark.skipif(not JSON.exists(), reason="regional_prisniva.json not generated")
class TestGenerated:
    @pytest.fixture()
    def doc(self):
        return json.loads(JSON.read_text(encoding="utf-8"))

    def test_all_26_kommuner_with_codes(self, doc):
        ks = doc["kommuner"]
        assert len(ks) == 26
        assert all(len(k["kod"]) == 4 and k["kod"].startswith("01") for k in ks)
        assert len({k["kod"] for k in ks}) == 26

    def test_values_and_period(self, doc):
        sth = doc["stockholmReferens"]
        assert sth["kod"] == "0180" and sth["krPerM2"] == 90017
        assert all(k["period"]["fran"] == "2025-09" and k["period"]["till"] == "2026-08" for k in doc["kommuner"])
        assert doc["lan"]["krPerM2"] == 70164
        assert doc["riket"]["krPerM2"] == 46317

    def test_states_average_and_unknown_n(self, doc):
        assert "medelvärde" in doc["statistik"] and doc["n"] is None
        assert "uppgift från ägaren 2026-10-07" in doc["riket"]["proveniens"]


def test_riket_csv_one_row():
    df = pd.read_csv(RIKET)
    assert len(df) == 1
    assert df.loc[0, "region"] == "Riket" and df.loc[0, "kr_per_m2"] == 46317
    assert "ägaren 2026-10-07" in df.loc[0, "proveniens"]
