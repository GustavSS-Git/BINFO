"""valuation-v3: pure helpers (postcode encoding, r(x) normalisation) and consistency of
the exported artefacts in ml/artifacts/valuation-v3 (skipped if not generated)."""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

import train_valuation as t  # noqa: E402
import valuation_v3_lib as L  # noqa: E402

ART = ML / "artifacts" / "valuation-v3"


# ---------------------------------------------------------------- pure helpers
def _df():
    return pd.DataFrame(
        {
            "postal_code_clean": ["A", "A", "B", None, "C"],
            "omrade": ["X", "X", "X", "Y", "Y"],
            "log_price_per_sqm": [1.0, 3.0, 2.0, 5.0, 5.0],
            "price_per_sq_meter": [100.0, 300.0, 200.0, 500.0, 500.0],
        }
    )


def test_postcode_table_is_shrunk_mean():
    d = _df()
    v = np.array([0.2, 0.4, -0.3, 0.0, 0.1])
    tab = L.postcode_table(d, v, k=2.0)
    assert tab["A"] == pytest.approx((0.2 + 0.4) / (2 + 2.0))  # n/(n+k) * mean
    assert tab["B"] == pytest.approx(-0.3 / (1 + 2.0))
    assert None not in tab and len(tab) == 3


def test_apply_table_falls_back_to_zero():
    d = _df()
    out = L.apply_table(d, {"A": 0.5})
    assert out.tolist() == [0.5, 0.5, 0.0, 0.0, 0.0]


def test_centred_log_price_zero_mean_per_area():
    d = _df()
    c = L.centred_log_price(d)
    assert pd.Series(c).groupby(d["omrade"].values).mean().abs().max() < 1e-12


def test_oof_encoding_never_uses_own_fold():
    """A postnummer that appears in exactly one row must get delta 0 out-of-fold (its
    only evidence is the row itself)."""
    rng = np.random.default_rng(0)
    n = 200
    d = pd.DataFrame(
        {
            "postal_code_clean": [f"P{i}" for i in range(n)],  # all singletons
            "omrade": rng.choice(["X", "Y"], n),
            "log_price_per_sqm": rng.normal(10, 1, n),
        }
    )
    cfg = L.Cfg(pc=("raw", 0.5))
    oof, table = L.encode_train_and_table(d, cfg)
    assert np.all(oof == 0.0)
    assert len(table) == n  # full table (inference) does know them


def test_r_from_log_normalisation_and_clip():
    r = L.r_from_log(np.log(np.array([0.5, 1.0, 2.0])), smear=1.02, normaliser=1.0)
    assert r == pytest.approx([0.51, 1.02, 2.04])
    rc = L.r_from_log(np.log(np.array([0.1, 1.0, 9.0])), 1.0, 1.0, lo=0.5, hi=1.5)
    assert rc.tolist() == pytest.approx([0.5, 1.0, 1.5])
    # pooled-variant normaliser: dividing by the observed mean makes an average sale r ~ 1
    assert L.r_from_log(np.log(np.array([90000.0])), 1.0, 90000.0)[0] == pytest.approx(1.0)


def test_area_relative_target_has_unit_mean_and_drops_small_and_okant():
    rows = []
    for area, n, base in [("Big", 40, 100.0), ("Small", 5, 300.0), ("Okänt (postnummer ej kartlagt)", 40, 50.0)]:
        for i in range(n):
            rows.append({"omrade": area, "price_per_sq_meter": base * (1 + 0.01 * i)})
    d = L.area_relative_target(pd.DataFrame(rows))
    assert set(d["omrade"]) == {"Big"}
    assert np.exp(d["rel_log"]).mean() == pytest.approx(1.0)


def test_sample_configs_seeded_unique_and_in_space():
    a, b = L.sample_configs(40), L.sample_configs(40)
    assert a == b and len({json.dumps(c, sort_keys=True) for c in a}) == 40
    assert all(c["num_leaves"] in L.SEARCH_SPACE["num_leaves"] for c in a)


# ---------------------------------------------------------------- exported artefacts
pytestmark_art = pytest.mark.skipif(not (ART / "model.json").exists(), reason="valuation-v3 not generated")


def _tree(node, x):
    while "leaf_value" not in node:
        node = node["left_child"] if x[node["split_feature"]] <= node["threshold"] else node["right_child"]
    return node["leaf_value"]


def _booster(booster, x):
    return sum(_tree(tr["tree_structure"], x) for tr in booster["tree_info"])


def _vector(manifest, inp, delta=None):
    """Reference implementation of the inference recipe the TS side must follow."""
    fee = inp["manadsavgift"]
    vals = {
        "living_area": inp["boarea"],
        "number_of_rooms": inp["antalRum"],
        "apartment_floor_clean": inp["vaning"],
        "build_year_clean": inp["byggar"],
        "fee_per_sqm": None if fee is None else fee / inp["boarea"],
        "postcode_delta": delta,
    }
    ind = {
        "apartment_floor_missing": inp["vaning"] is None,
        "build_year_missing": inp["byggar"] is None,
        "monthly_fee_missing": fee is None,
    }
    cats = {"omrade": inp.get("omrade"), "elevator_clean": inp["hiss"], "balcony_clean": inp["balkong"]}
    x = []
    for name in manifest["feature_order_out"]:
        kind, rest = name.split("__", 1)
        if kind == "num":
            v = vals[rest]
            x.append(manifest["numeric_medians_for_imputation"][rest] if v is None else float(v))
        elif kind == "ind":
            x.append(1.0 if ind[rest] else 0.0)
        else:
            feat = next(f for f in manifest["categorical_features"] if rest.startswith(f + "_"))
            cat = rest[len(feat) + 1 :]
            val = cats[feat] if cats[feat] is not None else manifest["categorical_fill_value_for_imputation"][feat]
            x.append(1.0 if val == cat else 0.0)
    return x


@pytestmark_art
class TestStockholmArtefact:
    @pytest.fixture()
    def parts(self):
        m = json.loads((ART / "model.json").read_text(encoding="utf-8"))
        fx = json.loads((ART / "parity_fixtures.json").read_text(encoding="utf-8"))
        pc = json.loads((ART / "postcode_encoding.json").read_text(encoding="utf-8"))
        meta = json.loads((ART / "metadata.json").read_text(encoding="utf-8"))
        return m, fx, pc, meta

    def test_monthly_fee_not_a_feature(self, parts):
        m, *_ = parts
        assert "monthly_fee_clean" not in m["numeric_features"]
        assert not any("monthly_fee_clean" in n for n in m["feature_order_out"])
        assert "monthly_fee_missing" in m["missing_indicator_features"]
        assert "postcode_delta" in m["numeric_features"]

    def test_no_utgangspris(self, parts):
        m, *_ = parts
        assert not any("utgangspris" in n.lower() for n in m["feature_order_out"])

    def test_fixtures_reproduced_by_reference_recipe(self, parts):
        m, fx, pc, meta = parts
        smear = meta["production_model"]["smearing_factor"]
        assert len(fx) >= 50
        for f in fx:
            i = f["input"]
            delta = pc["table"].get(i["postnummer"], pc["fallback_for_unseen_or_missing_postnummer"]) if i["postnummer"] else 0.0
            assert delta == pytest.approx(f["expected_output"]["postcode_delta"], abs=1e-9)
            x = _vector(m, i, delta)
            lg = _booster(m["lightgbm_booster"], x)
            assert lg == pytest.approx(f["expected_output"]["predicted_log_price_per_sqm"], abs=1e-9)
            tot = np.exp(lg) * smear * i["boarea"]
            assert tot == pytest.approx(f["expected_output"]["predicted_total_price_sek"], rel=1e-9)
            q = f["expected_output"]["q_log_used"]
            assert f["expected_output"]["interval_lower_sek"] == pytest.approx(np.exp(lg - q) * smear * i["boarea"], rel=1e-9)

    def test_unseen_postnummer_fixture_present(self, parts):
        _, fx, pc, _ = parts
        syn = [f for f in fx if f.get("note", "").startswith("synthetic unseen")]
        assert syn and all(f["expected_output"]["postcode_delta"] == 0.0 for f in syn)

    def test_size_budget(self, parts):
        assert (ART / "model.json").stat().st_size <= 3_500_000
        total = sum((ART / n).stat().st_size for n in ["model.json", "general_model.json", "postcode_encoding.json"])
        assert total <= 4_500_000

    def test_effects_schema_matches_v2(self):
        v2 = json.loads((ML / "artifacts" / "valuation-v2" / "effects.json").read_text(encoding="utf-8"))
        v3 = json.loads((ART / "effects.json").read_text(encoding="utf-8"))
        assert sorted(v2) == sorted(v3)
        assert sorted(v2["effects"][0]) == sorted(v3["effects"][0])
        ids = {e["id"] for e in v3["effects"]}
        assert "fee_per_sqm+10" in ids and "fee_per_sqm+100" not in ids


@pytestmark_art
class TestGeneralArtefact:
    @pytest.fixture()
    def parts(self):
        g = json.loads((ART / "general_model.json").read_text(encoding="utf-8"))
        fx = json.loads((ART / "general_parity_fixtures.json").read_text(encoding="utf-8"))
        return g, fx

    def test_no_location_features(self, parts):
        g, _ = parts
        assert not any("omrade" in n or "postcode" in n or "postal" in n for n in g["feature_order_out"])
        assert "fee_per_sqm" in g["numeric_features"]

    def test_normalisation_metadata(self, parts):
        g, _ = parts
        info = g["r_inference"]
        assert info["normaliser"] == 1.0  # area-relative target: average sale in its omrade is 1 by construction
        assert 0.98 < info["mean_r_training_rows"] < 1.02
        assert 0 < info["clip_min"] < 1 < info["clip_max"]

    def test_fixtures_reproduced(self, parts):
        g, fx = parts
        info = g["r_inference"]
        for f in fx:
            i = dict(f["input"])
            i["omrade"] = None
            x = _vector(g, i)
            lg = _booster(g["lightgbm_booster"], x)
            ru = np.exp(lg) * info["smearing_factor"] / info["normaliser"]
            assert lg == pytest.approx(f["expected_output"]["log_g"], abs=1e-9)
            assert ru == pytest.approx(f["expected_output"]["r_unclipped"], rel=1e-9)
            assert min(max(ru, info["clip_min"]), info["clip_max"]) == pytest.approx(f["expected_output"]["r"], rel=1e-9)

    def test_fixture_r_mean_near_one(self, parts):
        _, fx = parts
        r = [f["expected_output"]["r"] for f in fx if "note" not in f]
        assert 0.85 < float(np.mean(r)) < 1.15

    def test_hiss_not_a_negative_premium(self):
        """Obvious-direction guard: 'no lift' must not raise r(x)."""
        meta = json.loads((ART / "metadata.json").read_text(encoding="utf-8"))
        assert meta["regional_method"]["marginal_effects_on_r_with_fee"]["elevator_clean: nej vs ja"] <= 1e-9
        assert meta["regional_method"]["marginal_effects_on_r_with_fee"]["balcony_clean: nej vs ja"] <= 1e-9
