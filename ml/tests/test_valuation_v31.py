"""valuation-v3.1: pure helpers of the hierarchical postnummer encoding and consistency of the
exported artefacts in ml/artifacts/valuation-v3.1 (artefact tests are skipped if not generated)."""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

import valuation_v3_lib as L  # noqa: E402
import valuation_v31_lib as V  # noqa: E402
from test_valuation_v3 import _booster, _vector  # noqa: E402
from valuation_v31_lib import PcSpec  # noqa: E402

ART = ML / "artifacts" / "valuation-v3.1"
V3 = ML / "artifacts" / "valuation-v3"


def _df():
    return pd.DataFrame(
        {
            "postal_code_clean": ["11122", "11120", "11120", "11346", None, "11199"],
            "omrade": ["X", "X", "X", "X", "X", "X"],
            "log_price_per_sqm": [1.0, 2.0, 4.0, 3.0, 5.0, 2.0],
        }
    )


# ---------------------------------------------------------------- pure helpers
def test_omrade_prior_matches_v3_postcode_table():
    d = _df()
    v = np.array([0.2, 0.4, -0.3, 0.0, 0.1, 0.5])
    enc = V.fit_encoder(d, v, PcSpec(k=2.0))
    ref = L.postcode_table(d, v, k=2.0)
    assert enc.table() == pytest.approx(ref)
    assert enc.delta(d["postal_code_clean"]).tolist() == pytest.approx(L.apply_table(d, ref).tolist())


def test_single_sale_moves_postcode_by_n_over_n_plus_k():
    d = _df()
    v = np.zeros(len(d))
    v[0] = 0.3
    assert V.fit_encoder(d, v, PcSpec(k=0.5)).delta_one("11122") == pytest.approx(0.3 / 1.5)  # v3: 2/3 of the deviation
    assert V.fit_encoder(d, v, PcSpec(k=5.0)).delta_one("11122") == pytest.approx(0.3 / 6.0)


def test_hierarchical_prior_shrinks_toward_prefix_and_fills_unseen():
    d = _df()
    v = np.array([-0.3, 0.1, 0.1, 0.0, 9.9, 0.5])  # the row without postnummer must be ignored
    spec = PcSpec(k=1.0, prior="p4", k_group=2.0, unseen="prefix")
    enc = V.fit_encoder(d, v, spec)
    # prefix 1112 holds 11122 (v=-0.3) and 11120 (v=0.1, twice): group delta = -0.1/(3+2)
    g = -0.1 / 5
    assert enc.group["1112"] == pytest.approx(g)
    assert enc.delta_one("11122") == pytest.approx(g + (-0.3 - g) / (1 + 1.0))
    # an unseen postnummer with a known prefix gets the prefix delta; unseen prefix / missing -> 0
    assert enc.delta_one("11123") == pytest.approx(g)
    assert enc.delta_one("99999") == 0.0 and enc.delta_one(None) == 0.0
    # the same spec with unseen='zero' keeps 0
    assert V.fit_encoder(d, v, PcSpec(k=1.0, prior="p4", k_group=2.0, unseen="zero")).delta_one("11123") == 0.0
    # p3 groups 11122, 11120 (x2) and 11199 under "111" (11346 is "113"; the row without postnummer is ignored)
    e3 = V.fit_encoder(d, v, PcSpec(k=1.0, prior="p3", k_group=2.0, unseen="prefix"))
    assert e3.group["111"] == pytest.approx((-0.3 + 0.1 + 0.1 + 0.5) / (4 + 2.0))


def test_n_min_falls_back_to_group_or_zero():
    d = _df()
    v = np.array([0.4, 0.1, 0.1, 0.2, 0.0, 0.3])
    assert V.fit_encoder(d, v, PcSpec(k=0.5, n_min=2)).delta_one("11122") == 0.0
    assert V.fit_encoder(d, v, PcSpec(k=0.5, n_min=2)).delta_one("11120") != 0.0
    e = V.fit_encoder(d, v, PcSpec(k=0.5, n_min=2, prior="p4", k_group=2.0))
    assert e.delta_one("11122") == pytest.approx(e.group["1112"])


def test_oof_encoding_never_uses_own_fold_hierarchical():
    """With the 'omrade' prior a postnummer with a single sale has out-of-fold delta 0 (its only evidence is itself)."""
    rng = np.random.default_rng(0)
    n = 200
    d = pd.DataFrame(
        {
            "postal_code_clean": [f"P{i:04d}" for i in range(n)],
            "omrade": rng.choice(["X", "Y"], n),
            "log_price_per_sqm": rng.normal(10, 1, n),
        }
    )
    oof, enc = V.encode_train_and_encoder(d, PcSpec(k=0.5))
    assert np.all(oof == 0.0) and len(enc.table()) == n


def test_shipped_delta_rule():
    table, prefix = {"11122": -0.1}, {"1112": -0.03}
    assert V.shipped_delta("11122", table, prefix, 4) == -0.1
    assert V.shipped_delta("11123", table, prefix, 4) == -0.03
    assert V.shipped_delta("99999", table, prefix, 4) == 0.0
    assert V.shipped_delta(None, table, prefix, 4) == 0.0
    assert V.shipped_delta(float("nan"), table, prefix, 4) == 0.0


def test_strata_partition_rows():
    n = np.array([0, 1, 2, 3, 5, 6, 40])
    masks = V.stratum_masks(n)
    assert sum(int(m.sum()) for m in masks.values()) == len(n)
    assert masks["3-5"].tolist() == [False, False, False, True, True, False, False]


# ---------------------------------------------------------------- exported artefacts
pytestmark_art = pytest.mark.skipif(not (ART / "model.json").exists(), reason="valuation-v3.1 not generated")


@pytestmark_art
class TestStockholmArtefact31:
    @pytest.fixture()
    def parts(self):
        rd = lambda n: json.loads((ART / n).read_text(encoding="utf-8"))  # noqa: E731
        return rd("model.json"), rd("parity_fixtures.json"), rd("postcode_encoding.json"), rd("metadata.json")

    def test_version_and_features(self, parts):
        m, _, _, meta = parts
        assert meta["version"] == "valuation-v3.1"
        assert "postcode_delta" in m["numeric_features"]
        assert not any("monthly_fee_clean" in n or "utgangspris" in n.lower() for n in m["feature_order_out"])

    def test_same_feature_manifest_as_v3(self, parts):
        m, *_ = parts
        m3 = json.loads((V3 / "model.json").read_text(encoding="utf-8"))
        for key in ["feature_order_out", "numeric_features", "missing_indicator_features", "categorical_features", "categorical_onehot_categories", "categorical_fill_value_for_imputation"]:
            assert m[key] == m3[key], key

    def test_fixtures_reproduced_by_reference_recipe(self, parts):
        m, fx, pc, meta = parts
        smear = meta["production_model"]["smearing_factor"]
        assert len(fx) >= 50
        for f in fx:
            i = f["input"]
            delta = V.shipped_delta(i["postnummer"], pc["table"], pc["prefix_table"], pc["prefix_length"])
            assert delta == pytest.approx(f["expected_output"]["postcode_delta"], abs=1e-9)
            x = _vector(m, i, delta)
            lg = _booster(m["lightgbm_booster"], x)
            assert lg == pytest.approx(f["expected_output"]["predicted_log_price_per_sqm"], abs=1e-9)
            tot = np.exp(lg) * smear * i["boarea"]
            assert tot == pytest.approx(f["expected_output"]["predicted_total_price_sek"], rel=1e-9)
            q = f["expected_output"]["q_log_used"]
            assert f["expected_output"]["interval_lower_sek"] == pytest.approx(np.exp(lg - q) * smear * i["boarea"], rel=1e-9)

    def test_unseen_fixtures_cover_prefix_fallback_zero_fallback_and_missing(self, parts):
        _, fx, pc, _ = parts
        notes = [f for f in fx if f.get("note", "").startswith("synthetic")]
        assert len(notes) == 3
        by = {f["input"]["postnummer"]: f["expected_output"]["postcode_delta"] for f in notes}
        assert by["99999"] == 0.0 and by[None] == 0.0
        prefix_hit = next(f for f in notes if f["input"]["postnummer"] not in (None, "99999"))
        assert prefix_hit["input"]["postnummer"] not in pc["table"]
        assert prefix_hit["expected_output"]["postcode_delta"] == pytest.approx(pc["prefix_table"][prefix_hit["input"]["postnummer"][:4]])
        assert prefix_hit["expected_output"]["postcode_delta"] != 0.0

    def test_encoding_file_shape(self, parts):
        _, _, pc, _ = parts
        assert pc["fallback_for_unseen_or_missing_postnummer"] == 0.0
        assert pc["prefix_length"] == 4 and all(len(k) == 4 for k in pc["prefix_table"])
        assert pc["n_postnummer"] == len(pc["table"]) and pc["n_prefix"] == len(pc["prefix_table"])
        v3 = json.loads((V3 / "postcode_encoding.json").read_text(encoding="utf-8"))
        assert set(pc["table"]) == set(v3["table"])  # keys stay exactly the training postnummer (build script relies on this)

    def test_shrinkage_reduces_extremes_relative_to_v3(self, parts):
        _, _, pc, _ = parts
        v3 = json.loads((V3 / "postcode_encoding.json").read_text(encoding="utf-8"))["table"]
        assert max(abs(v) for v in pc["table"].values()) < max(abs(v) for v in v3.values())

    def test_size_budget(self):
        assert (ART / "model.json").stat().st_size <= 3_500_000
        total = sum((ART / n).stat().st_size for n in ["model.json", "general_model.json", "postcode_encoding.json"])
        assert total <= 4_500_000

    def test_general_model_and_fixtures_unchanged_from_v3(self):
        for n in ["general_model.json", "general_model_nofee.json", "general_parity_fixtures.json"]:
            assert (ART / n).read_bytes() == (V3 / n).read_bytes(), n

    def test_effects_schema_and_values_match_v3(self):
        v3 = json.loads((V3 / "effects.json").read_text(encoding="utf-8"))
        v31 = json.loads((ART / "effects.json").read_text(encoding="utf-8"))
        assert sorted(v3) == sorted(v31) and v31["version"] == "valuation-v3.1"
        assert {**v31, "version": None, "generated_at": None} == {**v3, "version": None, "generated_at": None}  # the OLS effects do not depend on the postnummer encoding

    def test_metadata_has_what_the_build_script_reads(self, parts):
        *_, meta = parts
        assert meta["final_model"]["cv"]["mape"] > 0 and meta["final_model"]["cv"]["per_area"]
        assert 0.85 < meta["conformal_interval_evaluation"]["empirical_coverage_overall"] < 0.95
        assert meta["regional_method"]["q_regional_log"] > 0
        assert meta["production_model"]["smearing_factor"] > 0

    def test_selection_rule_recorded_and_hierarchy_chosen(self, parts):
        *_, meta = parts
        assert "rule" in meta["selection"] and meta["selection"]["chosen"]["prior"] in ("omrade", "p3", "p4")
        assert len(meta["candidate_grid"]) >= 30
