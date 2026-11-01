"""Tests for the BRF register area taxonomy (PLAN-v3 2.2): the 117 stadsdel polygons ->
19 register areas crosswalk, the postnummer -> stadsdel table, and the offline address
geocoder. No network: Nominatim responses are replayed from a recorded fixture."""

import csv
import json
import re
import sys
from pathlib import Path

import pytest

MAPPING = Path(__file__).resolve().parents[1] / "mapping"
sys.path.insert(0, str(MAPPING))

import build_registeromrade as brm  # noqa: E402
import geokoda_adress as gk  # noqa: E402

ROOT = MAPPING.parents[1]
GEOJSON = MAPPING / "sources" / "stadsdelar_fullsize.geo.json"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "nominatim_responses.json"

PLAN_AREAS = [
    "Gamla stan", "Norrmalm", "Vasastan", "Östermalm", "Djurgården & Gärdet", "Kungsholmen", "Essingeöarna",
    "Södermalm", "Hammarby sjöstad", "Liljeholmen & Hägersten", "Älvsjö", "Årsta & Johanneshov", "Enskede",
    "Skarpnäck", "Farsta", "Skärholmen", "Bromma", "Hässelby-Vällingby", "Kista & Järva",
]


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def polygon_names() -> list[str]:
    data = json.loads(GEOJSON.read_text(encoding="utf-8"))
    return [f["properties"]["name"] for f in data["features"]]


@pytest.fixture(scope="module")
def crosswalk() -> list[dict]:
    return read_csv(MAPPING / "stadsdel_registeromrade.csv")


@pytest.fixture(scope="module")
def areas() -> list[dict]:
    return read_csv(MAPPING / "registeromraden.csv")


class TestAreas:
    def test_exactly_the_19_plan_areas_in_plan_order(self, areas):
        assert [a["namn"] for a in areas] == PLAN_AREAS

    def test_slugs_are_ascii_lowercase_hyphenated_and_unique(self, areas):
        slugs = [a["slug"] for a in areas]
        assert len(set(slugs)) == 19
        for s in slugs:
            assert re.fullmatch(r"[a-z]+(-[a-z]+)*", s), s

    def test_ovriga_stockholm_is_not_one_of_the_19(self, areas):
        assert "ovriga-stockholm" not in {a["slug"] for a in areas}

    def test_groups_are_the_official_stadsomraden_and_ordered_contiguously(self, areas):
        grupper = [a["grupp"] for a in areas]
        assert set(grupper) == {"Innerstaden", "Söderort", "Västerort"}
        # no "Norr": the Basomradeslistan has no such group
        assert [g for i, g in enumerate(grupper) if i == 0 or g != grupper[i - 1]] == ["Innerstaden", "Söderort", "Västerort"]
        assert [int(a["ordning"]) for a in areas] == list(range(1, 20))

    def test_every_area_has_a_motivering_with_a_source(self, areas):
        for a in areas:
            assert len(a["motivering"]) > 30, a["slug"]


class TestStadsdelCrosswalk:
    def test_117_of_117_polygons_mapped_exactly_once(self, crosswalk, polygon_names):
        assert len(polygon_names) == 117
        assert len(crosswalk) == 117
        assert sorted(r["stadsdel"] for r in crosswalk) == sorted(polygon_names)
        assert len({r["stadsdel"] for r in crosswalk}) == 117

    def test_each_row_has_exactly_one_valid_area(self, crosswalk, areas):
        valid = {a["slug"]: a for a in areas}
        for r in crosswalk:
            assert r["slug"] in valid, r["stadsdel"]
            assert r["registeromrade"] == valid[r["slug"]]["namn"]
            assert r["grupp"] == valid[r["slug"]]["grupp"]

    def test_every_area_has_at_least_one_stadsdel(self, crosswalk, areas):
        used = {r["slug"] for r in crosswalk}
        assert used == {a["slug"] for a in areas}

    def test_every_row_cites_a_source_and_a_retrieval_date(self, crosswalk):
        for r in crosswalk:
            assert "Basområdeslistan 2026" in r["motivering"], r["stadsdel"]
            assert "basomradeslistan-2026.pdf" in r["kalla"]
            assert "2026-10-13" in r["kalla"]

    def test_plan_rows_that_were_uncertain_are_resolved_as_the_source_says(self, crosswalk):
        by = {r["stadsdel"]: r["slug"] for r in crosswalk}
        # Basomradeslistan 2026 Tabell 2: all of these are in stadsdelsomrade Bromma ...
        for n in ["BECKOMBERGA", "ÅKESHOV", "MARIEHÄLL", "ULVSUNDA INDUSTRIOMR", "HÖGLANDET", "OLOVSLUND", "SMEDSLÄTTEN",
                  "NOCKEBYHOV", "SÖDRA ÄNGBY", "NORRA ÄNGBY", "BÄLLSTA"]:
            assert by[n] == "bromma", n
        # ... Hansta is a basomrade inside Akalla (Jarva) ...
        assert by["HANSTA"] == "kista-jarva"
        # ... Liseberg and Langsjo are in SDN-del 21.1 Alvsjo
        assert by["LISEBERG"] == "alvsjo" and by["LÅNGSJÖ"] == "alvsjo"

    def test_the_two_boundary_and_missing_rows_are_flagged(self, crosswalk):
        by = {r["stadsdel"]: r for r in crosswalk}
        assert "Blasut" in by["HAMMARBYHÖJDEN"]["flagga"]
        assert by["RIDDARHOLMEN"]["flagga"].startswith("ej_i_kalla")
        assert sum(1 for r in crosswalk if r["flagga"]) == 2

    def test_committed_files_equal_a_fresh_build(self, crosswalk, areas):
        rows, area_rows = brm.build()
        assert [{k: str(v) for k, v in r.items()} for r in rows] == crosswalk
        assert [{k: str(v) for k, v in r.items()} for r in area_rows] == areas

    def test_group_is_consistent_with_the_official_nyko2_stadsomrade(self, crosswalk):
        excerpt = {r["stadsdel"]: r for r in read_csv(MAPPING / "sources" / "basomradeslistan_2026_stadsdelar.csv")}
        assert len(excerpt) == 117
        for r in crosswalk:
            nyko2 = excerpt[r["stadsdel"]]["stadsomrade_nyko2"]
            if nyko2:
                assert brm.GRUPP_FRAN_NYKO2[nyko2] == r["grupp"], r["stadsdel"]

    def test_build_rejects_an_unmapped_or_double_assigned_polygon(self, monkeypatch):
        broken = {k: list(v) for k, v in brm.ALLOCATION.items()}
        broken["bromma"].remove("ALVIK")
        monkeypatch.setattr(brm, "ALLOCATION", broken)
        with pytest.raises(SystemExit, match="unmapped"):
            brm.build()
        double = {k: list(v) for k, v in brm.ALLOCATION.items()}
        double["farsta"].append("FARSTA")  # already in farsta
        double["skarholmen"].append("FARSTA")
        monkeypatch.setattr(brm, "ALLOCATION", double)
        with pytest.raises(SystemExit, match="twice"):
            brm.build()

    def test_build_rejects_an_area_that_contradicts_the_basomradeslistan(self, monkeypatch):
        moved = {k: list(v) for k, v in brm.ALLOCATION.items()}
        moved["bromma"].remove("BECKOMBERGA")
        moved["hasselby-vallingby"].append("BECKOMBERGA")  # the plan's old guess
        monkeypatch.setattr(brm, "ALLOCATION", moved)
        with pytest.raises(SystemExit):
            brm.build()


class TestPostnummerStadsdel:
    @pytest.fixture(scope="module")
    def rows(self):
        return read_csv(ROOT / "data" / "derived" / "postnummer_stadsdel.csv")

    def test_same_postnummer_and_method_as_postnummer_omrade(self, rows):
        old = {r["postnummer"]: r["metod"] for r in read_csv(ROOT / "data" / "derived" / "postnummer_omrade.csv")}
        assert {r["postnummer"]: r["method"] for r in rows} == old

    def test_every_row_has_a_valid_stadsdel_and_area(self, rows, polygon_names, areas):
        slugs = {a["slug"] for a in areas}
        for r in rows:
            assert r["stadsdel"] in polygon_names, r["postnummer"]
            assert r["registeromrade"] in slugs, r["postnummer"]
            assert re.fullmatch(r"\d{5}", r["postnummer"])

    def test_geonames_rows_agree_with_the_crosswalk(self, rows, crosswalk):
        cw = {r["stadsdel"]: r["slug"] for r in crosswalk}
        for r in rows:
            if r["method"] == "geonames_point_in_polygon":
                assert cw[r["stadsdel"]] == r["registeromrade"]

    def test_tier1_rows_carry_evidence_and_tier3_rows_do_not(self, rows):
        for r in rows:
            if r["method"] == "osm_address_majority":
                assert int(r["n_points"]) >= 1 and 0 < float(r["share"]) <= 1
            elif r["method"] == "prefix_granne":
                assert r["n_points"] == "" and r["share"] == ""

    def test_straddlers_and_foreign_kommun_postnummer_are_flagged_not_dropped(self, rows):
        by = {r["postnummer"]: r for r in rows}
        assert "grans" in by["11358"]["flagga"]  # 60 % Ostermalm, n=5
        assert "kommun_avviker_0126" in by["12352"]["flagga"]  # Huddinge per postnummer_kommun.csv
        assert by["11242"]["registeromrade"] == "kungsholmen"

    def test_ovriga_postnummer_are_kommun_0180_without_a_stadsdel(self, rows):
        mapped = {r["postnummer"] for r in rows}
        kommun = {r["postnummer"]: r["kommun_kod"] for r in read_csv(ROOT / "data" / "derived" / "postnummer_kommun.csv")}
        ovriga = read_csv(ROOT / "data" / "derived" / "postnummer_stockholm_ovriga.csv")
        assert ovriga
        for r in ovriga:
            assert kommun[r["postnummer"]] == "0180"
            assert r["postnummer"] not in mapped


@pytest.fixture(scope="module")
def recorded() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["responses"]


@pytest.fixture(scope="module")
def stadsdelar() -> gk.Stadsdelar:
    return gk.Stadsdelar()


def no_network(params):  # pragma: no cover - only runs if a test forgets the fixture
    raise AssertionError(f"unexpected network call: {params}")


class TestGeokoda:
    def run(self, recorded, stadsdelar, street, pn=None, ort=None):
        return gk.geokoda(street, pn, ort, cache=dict(recorded), fetch=no_network, stadsdelar=stadsdelar,
                          postnummer_area={"11242": "kungsholmen"})

    def test_pontonjaren_3_address_lands_in_kungsholmen(self, recorded, stadsdelar):
        r = self.run(recorded, stadsdelar, "Baltzar von Platens gata 6", "11242", "Stockholm")
        assert r["status"] == "ok"
        assert (r["stadsdel"], r["registeromrade"], r["grupp"]) == ("KUNGSHOLMEN", "kungsholmen", "Innerstaden")
        assert r["flagga"] == ""

    def test_works_without_postnummer(self, recorded, stadsdelar):
        r = self.run(recorded, stadsdelar, "Baltzar von Platens gata 6", None, "Stockholm")
        assert r["registeromrade"] == "kungsholmen"

    def test_volontaren_12_address_in_vasastan(self, recorded, stadsdelar):
        r = self.run(recorded, stadsdelar, "Tomtebogatan 31", None, "Stockholm")
        assert (r["stadsdel"], r["registeromrade"]) == ("VASASTADEN", "vasastan")

    def test_addresses_outside_stockholms_kommun_are_not_forced_into_an_area(self, recorded, stadsdelar):
        for street, ort in [("Sockengatan 14", "Helsingborg"), ("Lyktvägen 79", "Umeå")]:
            r = self.run(recorded, stadsdelar, street, None, ort)
            assert r["status"] == "utanfor_stockholms_kommun"
            assert r["registeromrade"] == "" and r["stadsdel"] == ""

    def test_street_only_hit_and_postnummer_conflict_are_flagged(self, recorded, stadsdelar):
        r = self.run(recorded, stadsdelar, "Storgatan 999999", "11242", "Stockholm")
        assert r["status"] == "ok" and r["registeromrade"] == "ostermalm"
        assert "osm_traff_ar_inte_adress" in r["flagga"]
        assert "avviker_fran_postnummer" in r["flagga"]

    def test_no_hit_is_reported(self, stadsdelar):
        r = gk.geokoda("Nonexistent 1", None, "Stockholm", cache={}, fetch=lambda p: [], stadsdelar=stadsdelar)
        assert r["status"] == "ingen_traff" and r["registeromrade"] == ""

    def test_falls_back_to_street_plus_city_when_postnummer_gives_nothing(self, stadsdelar, recorded):
        calls = []
        hit = recorded["baltzar von platens gata 6||stockholm"]

        def fetch(params):
            calls.append(params)
            return [] if "postalcode" in params else hit

        r = gk.geokoda("Baltzar von Platens gata 6", "99999", "Stockholm", cache={}, fetch=fetch, stadsdelar=stadsdelar)
        assert r["registeromrade"] == "kungsholmen" and "fallback_utan_postnummer" in r["flagga"]
        assert len(calls) == 2

    def test_each_query_is_requested_once(self, stadsdelar, recorded):
        calls = []
        cache: dict = {}

        def fetch(params):
            calls.append(params)
            return recorded["tomtebogatan 31||stockholm"]

        for _ in range(3):
            gk.geokoda("Tomtebogatan 31", None, "Stockholm", cache=cache, fetch=fetch, stadsdelar=stadsdelar)
        assert len(calls) == 1

    def test_query_parameters_follow_the_nominatim_structured_form(self):
        p = gk.build_params(" Baltzar von Platens gata 6 ", "112 42", "Stockholm")
        assert p == {"street": "Baltzar von Platens gata 6", "countrycodes": "se", "format": "jsonv2", "limit": "3",
                     "addressdetails": "1", "postalcode": "11242", "city": "Stockholm"}
        assert "postalcode" not in gk.build_params("X 1", None, None)

    def test_cache_key_is_normalised(self):
        assert gk.cache_key("Tomtebogatan  31", "113 42", " Stockholm ") == gk.cache_key("tomtebogatan 31", "11342", "stockholm")

    def test_user_agent_and_rate_limit_follow_the_usage_policy(self):
        assert gk.USER_AGENT == "Binfo/1.0 (contactbinfohere@gmail.com)"
        assert gk.MIN_INTERVAL_S >= 1.0

    def test_unusable_coordinates_are_skipped(self):
        assert gk.pick_hit([{"lat": "x", "lon": "1"}, {"lat": "59.3", "lon": "18.0"}]) == {"lat": "59.3", "lon": "18.0"}
        assert gk.pick_hit([{"foo": 1}]) is None
        assert gk.pick_hit([]) is None
