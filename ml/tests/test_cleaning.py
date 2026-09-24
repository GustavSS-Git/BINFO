import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cleaning import (  # noqa: E402
    clean_apartment_floor,
    clean_build_year,
    clean_building_storeys,
    clean_dataframe,
    clean_postal_code,
    clean_tristate,
    flag_implausible_monthly_fee,
)


def is_nan(x) -> bool:
    return isinstance(x, float) and math.isnan(x)


class TestApartmentFloor:
    def test_plain_numbers(self):
        assert clean_apartment_floor("2") == 2.0
        assert clean_apartment_floor("-1") == -1.0
        assert clean_apartment_floor("0") == 0.0
        assert clean_apartment_floor(4.0) == 4.0

    def test_half_floors(self):
        assert clean_apartment_floor("0.5") == 0.5
        assert clean_apartment_floor("1.5") == 1.5
        assert clean_apartment_floor("½") == 0.5
        assert clean_apartment_floor("1, 5") == 1.5

    def test_bv_and_ep(self):
        for v in ["BV", "Bv", "bv", "EP", "Entréplan"]:
            assert clean_apartment_floor(v) == 0.0

    def test_tr_suffix(self):
        assert clean_apartment_floor("1 tr") == 1.0
        assert clean_apartment_floor("2tr") == 2.0
        assert clean_apartment_floor("2 trappor") == 2.0

    def test_tr_ned(self):
        assert clean_apartment_floor("1tr ned") == 0.0

    def test_ranges_take_lower(self):
        assert clean_apartment_floor("1-2") == 1.0
        assert clean_apartment_floor("1-3") == 1.0
        assert clean_apartment_floor("3-4") == 3.0
        assert clean_apartment_floor("12+13") == 12.0
        assert clean_apartment_floor("1+2") == 1.0
        assert clean_apartment_floor("1&2") == 1.0
        assert clean_apartment_floor("1/2") == 1.0
        assert clean_apartment_floor("1/BV") == 0.0

    def test_parenthetical_tr_wins(self):
        assert clean_apartment_floor("1 (0,5 tr)") == 0.5
        assert clean_apartment_floor("5 ( 4tr )") == 4.0
        assert clean_apartment_floor("2 (3 tr)") == 3.0
        assert clean_apartment_floor("7 (5 trappor)") == 5.0

    def test_ambiguous_codes_are_nan(self):
        assert is_nan(clean_apartment_floor("MP"))
        assert is_nan(clean_apartment_floor("NB"))
        assert is_nan(clean_apartment_floor("Vind"))

    def test_implausible_high_floor_is_nan(self):
        assert is_nan(clean_apartment_floor("28"))
        assert clean_apartment_floor("25") == 25.0  # at the cap, not over it

    def test_missing(self):
        assert is_nan(clean_apartment_floor(None))
        assert is_nan(clean_apartment_floor(np.nan))
        assert is_nan(clean_apartment_floor(float("nan")))


class TestBuildYear:
    def test_plain_year(self):
        assert clean_build_year("1978") == 1978.0
        assert clean_build_year(1978) == 1978.0

    def test_ranges_take_first_year(self):
        assert clean_build_year("1929-1932") == 1929.0
        assert clean_build_year("1975/76") == 1975.0
        assert clean_build_year("1884 - 2019") == 1884.0
        assert clean_build_year("1938–1943") == 1938.0
        assert clean_build_year("1932 / 2007") == 1932.0
        assert clean_build_year("1700 och 1762") == 1700.0

    def test_soft_hyphen(self):
        assert clean_build_year("1931-\xad1933") == 1931.0

    def test_century_notation(self):
        assert clean_build_year("1600-tal") == 1600.0

    def test_circa(self):
        assert clean_build_year("ca 1880") == 1880.0

    def test_punctuation(self):
        assert clean_build_year("2019§") == 2019.0
        assert clean_build_year("2004,") == 2004.0

    def test_renovation_annotation_ignored(self):
        assert clean_build_year("1913 (Värdeår: 1929)") == 1913.0
        assert clean_build_year("1926 (OB:1994-1995)") == 1926.0

    def test_missing(self):
        assert is_nan(clean_build_year(None))
        assert is_nan(clean_build_year(float("nan")))
        assert is_nan(clean_build_year("nan"))


class TestBuildingStoreys:
    def test_normal(self):
        assert clean_building_storeys(5) == 5.0
        assert clean_building_storeys(30) == 30.0

    def test_implausible(self):
        assert is_nan(clean_building_storeys(34))
        assert is_nan(clean_building_storeys(36))

    def test_missing(self):
        assert is_nan(clean_building_storeys(np.nan))


class TestPostalCode:
    def test_zero_pads(self):
        assert clean_postal_code(11650.0) == "11650"
        assert clean_postal_code(9999) == "09999"

    def test_missing(self):
        assert is_nan(clean_postal_code(np.nan))


class TestTristate:
    def test_values(self):
        assert clean_tristate(True) == "ja"
        assert clean_tristate(False) == "nej"
        assert clean_tristate(np.nan) == "okant"
        assert clean_tristate(None) == "okant"


class TestMonthlyFeeImplausibility:
    def test_flags_extreme_fee_per_sqm(self):
        fee = pd.Series([23587.0, 3294.0, 49398.0])
        area = pd.Series([21.0, 45.0, 55.0])
        flags = flag_implausible_monthly_fee(fee, area)
        assert flags.tolist() == [True, False, True]


class TestCleanDataframe:
    def _raw_row(self, **overrides):
        base = {
            "contract_date": "2026-03-09",
            "price_per_sq_meter": 36667.0,
            "monthly_fee": 3294.0,
            "number_of_rooms": 2.0,
            "living_area": 45.0,
            "elevator": True,
            "balcony": np.nan,
            "apartment_floor": "4",
            "building_storeys": 4.0,
            "build_year": "1978",
            "postal_code": 16441.0,
        }
        base.update(overrides)
        return base

    def test_drops_missing_target_and_reports(self):
        df = pd.DataFrame(
            [
                self._raw_row(),
                self._raw_row(price_per_sq_meter=np.nan),
            ]
        )
        cleaned, report = clean_dataframe(df)
        assert report.missing_target_rows_dropped == 1
        assert len(cleaned) == 1

    def test_drops_exact_duplicates(self):
        row = self._raw_row()
        df = pd.DataFrame([row, dict(row)])
        cleaned, report = clean_dataframe(df)
        assert report.duplicate_rows_dropped == 1
        assert len(cleaned) == 1

    def test_nulls_implausible_fee(self):
        df = pd.DataFrame(
            [self._raw_row(monthly_fee=23587.0, living_area=21.0, postal_code=12634.0)]
        )
        cleaned, report = clean_dataframe(df)
        assert report.monthly_fee_implausible_nulled == 1
        assert is_nan(cleaned["monthly_fee_clean"].iloc[0])
