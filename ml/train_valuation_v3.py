"""valuation-v3: trains, evaluates and exports
  (1) the Stockholm-municipality model (restricted features without monthly_fee_clean,
      tuned LightGBM, optional postcode target encoding if it clears the adoption bar),
  (2) the general "relationships" model g(x) used outside Stockholm municipality:
      price per m2 = regional average (Svensk Maklarstatistik) * r(x).

Run: ml/.venv/bin/python ml/train_valuation_v3.py
Writes ml/artifacts/valuation-v3/ only. v1/v2 artefacts are not touched
(ml/train_valuation.py is unchanged and still regenerates v1/v2).
Seeded (RANDOM_STATE=42) throughout.
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import KFold

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_valuation as t  # noqa: E402
import valuation_v3_lib as L  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ml" / "artifacts" / "valuation-v3"
RAND = L.RANDOM_STATE

PC_ADOPT_MIN_GAIN_PP = 0.3
PC_GRID_K = [0.5, 1, 2, 3, 5, 10, 30]
PC_MODES = ["raw", "resid"]
N_SEARCH = 40
PROD_ROUND_SIG = 6
GENERAL_PARAMS = dict(n_estimators=150, num_leaves=15, learning_rate=0.05)  # chosen on size/MAPE, see model card
SIZE_LIMIT_MAIN = 3_500_000
DATA_PERIOD = t.DATA_PERIOD


# ---------------------------------------------------------------------------
def compress(booster_dump: dict, n_trees: int | None = None) -> dict:
    trees = booster_dump["tree_info"][: n_trees or len(booster_dump["tree_info"])]
    return {**booster_dump, "tree_info": [{**tr, "tree_structure": t._round_tree_json(tr["tree_structure"], PROD_ROUND_SIG)} for tr in trees]}


def export_model_json(f: L.Fitted, train_for_encoding: pd.DataFrame) -> dict:
    cfg = f.cfg
    prep = f.pipe.named_steps["prep"]
    model = f.pipe.named_steps["model"]
    num_imp = prep.named_transformers_["num"].named_steps["impute"]
    out = {
        "feature_order_out": list(prep.get_feature_names_out()),
        "numeric_features": cfg.all_numeric,
        "missing_indicator_features": cfg.missing,
        "categorical_features": cfg.categorical,
        "numeric_medians_for_imputation": {k: float(v) for k, v in zip(cfg.all_numeric, num_imp.statistics_)},
    }
    if cfg.categorical:
        cat = prep.named_transformers_["cat"]
        out["categorical_fill_value_for_imputation"] = {k: str(v) for k, v in zip(cfg.categorical, cat.named_steps["impute"].statistics_)}
        out["categorical_onehot_categories"] = {k: [str(c) for c in cs] for k, cs in zip(cfg.categorical, cat.named_steps["onehot"].categories_)}
    else:
        out["categorical_fill_value_for_imputation"] = {}
        out["categorical_onehot_categories"] = {}
    out["lightgbm_booster"] = compress(model.booster_.dump_model())
    return out


def custom_predict_log(model_json: dict, f: L.Fitted, df: pd.DataFrame) -> np.ndarray:
    """Pure-python evaluation of the EXPORTED (compressed) booster: what a TS port computes."""
    d = df
    if f.cfg.pc:
        d = df.copy()
        d[L.PC_FEATURE] = L.apply_table(df, f.pc_table)
    X = f.pipe.named_steps["prep"].transform(d[f.cfg.feature_cols]).to_numpy(dtype=float)
    return t._predict_custom(model_json["lightgbm_booster"], X)


def pick_fixture_rows(df: pd.DataFrame, n: int = 50) -> list:
    rng = np.random.default_rng(RAND)
    picks = [grp.sample(1, random_state=RAND).index[0] for _, grp in df.groupby("omrade")]
    for col in ["apartment_floor_clean", "build_year_clean", "monthly_fee_clean"]:
        miss = df[df[col].isna()]
        if len(miss):
            picks.append(miss.sample(1, random_state=RAND).index[0])
    rest = [i for i in df.index if i not in picks]
    picks.extend(rng.choice(rest, size=max(0, n - len(picks)), replace=False).tolist())
    return list(dict.fromkeys(picks))


def fixture_input(row: pd.Series, **over) -> dict:
    def num(c):
        return None if pd.isna(row[c]) else float(row[c])

    d = {
        "postnummer": row["postal_code_clean"] if isinstance(row["postal_code_clean"], str) else None,
        "omrade": row["omrade"],
        "boarea": float(row["living_area"]),
        "antalRum": num("number_of_rooms"),
        "manadsavgift": num("monthly_fee_clean"),
        "vaning": num("apartment_floor_clean"),
        "byggar": num("build_year_clean"),
        "hiss": row["elevator_clean"],
        "balkong": row["balcony_clean"],
    }
    d.update(over)
    return d


def build_fixtures_stockholm(f: L.Fitted, model_json: dict, df: pd.DataFrame, q_area: dict, q_overall: float, smear: float) -> list[dict]:
    sample = df.loc[pick_fixture_rows(df)].copy()
    # two synthetic rows exercising the unseen-postnummer fallback (delta = 0)
    syn = sample.iloc[:2].copy()
    syn["postal_code_clean"] = "99999"
    syn["_synthetic"] = True
    sample["_synthetic"] = False
    sample = pd.concat([sample, syn])
    pred_log = custom_predict_log(model_json, f, sample)
    deltas = L.apply_table(sample, f.pc_table) if f.cfg.pc else np.zeros(len(sample))
    fixtures = []
    for i, (_, row) in enumerate(sample.iterrows()):
        q = q_area.get(row["omrade"], q_overall)
        la = float(row["living_area"])
        fx = {
            "input": fixture_input(row),
            "expected_output": {
                "postcode_delta": float(deltas[i]),
                "predicted_log_price_per_sqm": float(pred_log[i]),
                "predicted_total_price_sek": float(np.exp(pred_log[i]) * smear * la),
                "interval_lower_sek": float(np.exp(pred_log[i] - q) * smear * la),
                "interval_upper_sek": float(np.exp(pred_log[i] + q) * smear * la),
                "q_log_used": float(q),
            },
        }
        if bool(row["_synthetic"]):
            fx["note"] = "synthetic unseen postnummer 99999: postcode_delta must fall back to 0"
        fixtures.append(fx)
    return fixtures


# ---------------------------------------------------------------------------
# effects (OLS) without monthly_fee_clean
# ---------------------------------------------------------------------------
V3_FULL_NUMERIC = [c for c in t.FULL_NUMERIC_FEATURES if c != "monthly_fee_clean"]
V3_CONTINUOUS_DRIVERS = [
    ("number_of_rooms", "rooms+1", "Ett rum till", 1),
    ("apartment_floor_clean", "floor+1", "En våning högre", 1),
    ("build_year_clean", "build_year+10", "10 år nyare byggnad", 10),
    ("fee_per_sqm", "fee_per_sqm+10", "10 kr/m² högre månadsavgift", 10),
    ("living_area", "boarea+10", "10 kvm större boarea (pris per kvm)", 10),
]


def build_effects_v3(df: pd.DataFrame) -> tuple[dict, dict]:
    old_full, old_drv = t.FULL_NUMERIC_FEATURES, t._CONTINUOUS_DRIVERS
    t.FULL_NUMERIC_FEATURES, t._CONTINUOUS_DRIVERS = V3_FULL_NUMERIC, V3_CONTINUOUS_DRIVERS
    try:
        ols, cols = t.fit_ols(df)
        bal = t.area_specific_amenity_effects(df, "balcony_clean", "balkong")
        ele = t.area_specific_amenity_effects(df, "elevator_clean", "hiss")
        eff = t.build_driver_effects(df, ols, bal, ele)
    finally:
        t.FULL_NUMERIC_FEATURES, t._CONTINUOUS_DRIVERS = old_full, old_drv
    eff["version"] = "valuation-v3"
    eff["method"] = (
        "Unregularised OLS on log(price_per_sqm), FULL feature set WITHOUT monthly_fee_clean "
        "(statsmodels; fee enters only as fee_per_sqm + monthly_fee_missing, so the fee driver is "
        "no longer an artefact of collinearity with monthly_fee_clean and living_area). "
        "Interpretability companion to the LightGBM model, not used for predictions."
    )
    stats = {}
    ci = ols.conf_int(alpha=0.05)
    b = ols.params["fee_per_sqm"]
    stats["fee_per_sqm_per_kr_beta_log"] = float(b)
    stats["fee_per_sqm_p_value"] = float(ols.pvalues["fee_per_sqm"])
    stats["fee_per_sqm_ci_log"] = [float(ci.loc["fee_per_sqm"][0]), float(ci.loc["fee_per_sqm"][1])]
    stats["n_ols"] = int(ols.nobs)
    return eff, stats


# ---------------------------------------------------------------------------
# general model + simulated regional method
# ---------------------------------------------------------------------------
# Obvious-direction guard (CLAUDE.md: never ship an effect whose sign contradicts the obvious
# direction): without it the unconstrained g(x) gave "no lift" +3.0 % on r(x) (a confounding
# artefact). With these constraints the Jul-Aug simulated MAPE is unchanged (14.48 vs 14.55 %).
GENERAL_MONOTONE = {"cat__elevator_clean_ja": 1, "cat__elevator_clean_nej": -1, "cat__balcony_clean_ja": 1, "cat__balcony_clean_nej": -1}


def gen_cfg(target: str, drop_fee: bool = False, params: dict | None = None) -> L.Cfg:
    c = L.Cfg(numeric=list(L.GEN_NUMERIC), missing=list(L.GEN_MISSING), categorical=list(L.GEN_CATEGORICAL), params=dict(params or GENERAL_PARAMS), target=target, monotone=dict(GENERAL_MONOTONE))
    if drop_fee:
        c.numeric = [x for x in c.numeric if x != "fee_per_sqm"]
    return c


class GeneralFit:
    def __init__(self, train: pd.DataFrame, variant: str = "area_relative", drop_fee: bool = False, params: dict | None = None):
        self.variant = variant
        self.train = L.area_relative_target(train)
        self.area_mean = self.train.groupby("omrade")["price_per_sq_meter"].mean()
        if variant == "area_relative":
            self.cfg = gen_cfg("rel_log", drop_fee, params)
            self.normaliser = 1.0
        else:  # "pooled": the naive design, kept as a documented comparison
            self.cfg = gen_cfg("log_price_per_sqm", drop_fee, params)
            self.normaliser = float(self.train["price_per_sq_meter"].mean())
        self.f = L.fit(self.train, self.cfg)
        r_tr = self.r_raw(self.train)
        self.clip_lo, self.clip_hi = float(r_tr.min()), float(r_tr.max())
        self.mean_r_train = float(r_tr.mean())

    def r_raw(self, df: pd.DataFrame) -> np.ndarray:
        return L.r_from_log(self.f.predict_log(df), self.f.smear, self.normaliser)

    def r(self, df: pd.DataFrame, clip: bool = True) -> np.ndarray:
        r = self.r_raw(df)
        return np.clip(r, self.clip_lo, self.clip_hi) if clip else r

    def predict_ppsm(self, df: pd.DataFrame, clip: bool = True) -> np.ndarray:
        return df["omrade"].map(self.area_mean).to_numpy(dtype=float) * self.r(df, clip)


def sim_eval(train: pd.DataFrame, test: pd.DataFrame, **kw) -> tuple[pd.DataFrame, np.ndarray, GeneralFit]:
    g = GeneralFit(train, **kw)
    te = test[test["omrade"].isin(set(g.area_mean.index))]
    return te, g.predict_ppsm(te), g


def sim_mape(te: pd.DataFrame, ppsm: np.ndarray) -> float:
    y = te["total_price"].to_numpy()
    return t.mape(y, ppsm * te["living_area"].to_numpy())


def sim_cv(df: pd.DataFrame, **kw) -> dict:
    kf = KFold(n_splits=L.N_SPLITS, shuffle=True, random_state=RAND)
    parts = []
    for a, b in kf.split(df):
        te, p, _ = sim_eval(df.iloc[a], df.iloc[b], **kw)
        parts.append(te.assign(_pred=p * te["living_area"].to_numpy()))
    allp = pd.concat(parts)
    y = allp["total_price"].to_numpy()
    return {
        "n": int(len(allp)),
        "mae": t.mae(y, allp["_pred"].to_numpy()),
        "mape": t.mape(y, allp["_pred"].to_numpy()),
        "per_area": t.per_area_metrics(y, allp["_pred"].to_numpy(), allp["omrade"].to_numpy()),
    }


def sim_conformal(df: pd.DataFrame, **kw) -> dict:
    """Train g + omrade averages on Jan-May, calibrate ONE pooled q on June, evaluate on Jul-Aug."""
    train, calib, test = df[df["month_num"] <= 5], df[df["month_num"] == 6], df[df["month_num"] >= 7]
    te_c, p_c, g = sim_eval(train, calib, **kw)
    err_c = np.abs(np.log(te_c["price_per_sq_meter"].to_numpy() / p_c))
    q = float(np.quantile(err_c, 1 - (1 - t.CONFORMAL_COVERAGE_TARGET)))
    te, p, _ = sim_eval(train, test, **kw)
    err = np.abs(np.log(te["price_per_sq_meter"].to_numpy() / p))
    cov = err <= q
    per_area = {}
    for a in sorted(set(te["omrade"])):
        m = te["omrade"].to_numpy() == a
        y = te["total_price"].to_numpy()[m]
        per_area[a] = {"n": int(m.sum()), "coverage": float(cov[m].mean()), "mape": t.mape(y, (p * te["living_area"].to_numpy())[m])}
    return {
        "q_regional_log": q,
        "n_train": int(len(g.train)),
        "n_calib": int(len(te_c)),
        "n_test": int(len(te)),
        "coverage_overall": float(cov.mean()),
        "mape_jul_aug_jan_may_model": sim_mape(te, p),
        "mape_jul_aug_unclipped": sim_mape(te, g.predict_ppsm(te, clip=False)),
        "median_abs_log_error": float(np.median(err)),
        "per_area": per_area,
        "n_excluded_okant_or_small_area": int(len(test) - len(te)),
    }


def partial_effects(g: GeneralFit, df: pd.DataFrame) -> dict:
    """Marginal mean change in r when ONE input is set to a value for all rows
    (a descriptive partial-dependence summary, not a causal claim)."""
    base = df.copy()
    out = {}

    def mean_r(d):
        return float(np.mean(g.r_raw(d)))

    for col, a, b_ in [("elevator_clean", "ja", "nej"), ("balcony_clean", "ja", "nej")]:
        da, db = base.copy(), base.copy()
        da[col], db[col] = a, b_
        out[f"{col}: {b_} vs {a}"] = mean_r(db) / mean_r(da) - 1
    for lo, hi in [(1900, 1930), (1930, 1960), (1960, 1990), (1990, 2010), (2010, 2025)]:
        d = base.copy()
        d["build_year_clean"] = (lo + hi) / 2
        d["build_year_missing"] = 0
        out[f"byggar {(lo + hi) / 2:.0f}"] = mean_r(d)
    for fee in [30, 45, 60, 75, 90]:
        d = base.copy()
        d["fee_per_sqm"] = fee
        d["monthly_fee_missing"] = 0
        out[f"avgift {fee} kr/m2/man"] = mean_r(d)
    return out


# ---------------------------------------------------------------------------
def main() -> None:
    warnings.filterwarnings("ignore")
    OUT.mkdir(parents=True, exist_ok=True)
    df, load_meta = t.load_data()
    n_all = len(df)
    meta: dict = {
        "version": "valuation-v3",
        "trained_at": pd.Timestamp.now().isoformat(),
        "data_period": DATA_PERIOD,
        "n_rows": n_all,
        "months": {int(k): int(v) for k, v in df["month_num"].value_counts().sort_index().items()},
        "random_state": RAND,
        "cleaning_report": load_meta["cleaning_report"],
        "n_unmapped_omrade": load_meta["n_unmapped_omrade"],
        "excluded_features": ["utgangspris (not present in this file; would be leakage if it were)"],
    }
    jan_jun = df[df["month_num"] <= 6]

    # ---------------- 1. baselines ----------------
    print("[1] baselines")
    v2cfg = L.Cfg(numeric=L.V3_NUMERIC + ["monthly_fee_clean"], params=dict(n_estimators=400, num_leaves=31, learning_rate=0.05))
    v2cfg300 = L.Cfg(numeric=L.V3_NUMERIC + ["monthly_fee_clean"])
    v3def = L.Cfg()
    baselines = {}
    for name, c in [("v2_restricted_400_trees", v2cfg), ("v2_restricted_300_trees_shipped", v2cfg300), ("v3_features_default_300_trees", v3def)]:
        baselines[name] = {"cv": L.cv_score(df, c), "time_split": L.time_split_score(df, c)}
        print(f"  {name}: CV {baselines[name]['cv']['mape']:.3f}  Jul-Aug {baselines[name]['time_split']['mape']:.3f}")
    meta["baselines"] = baselines

    # ---------------- 2. postcode experiment ----------------
    print("[2] postcode target encoding (selection on Jan-Jun 5-fold CV)")
    pc_rows = []
    for mode in PC_MODES:
        for k in PC_GRID_K:
            c = L.Cfg(pc=(mode, k))
            r = {"mode": mode, "k": k, "janjun_cv_mape": L.cv_score(jan_jun, c)["mape"]}
            pc_rows.append(r)
            print(f"  {mode} k={k}: Jan-Jun CV {r['janjun_cv_mape']:.3f}")
    best_pc = min(pc_rows, key=lambda r: r["janjun_cv_mape"])
    pc_cfg = (best_pc["mode"], best_pc["k"])
    base_jj = L.cv_score(jan_jun, v3def)["mape"]
    base_ts = baselines["v3_features_default_300_trees"]["time_split"]
    pc_ts = L.time_split_score(df, L.Cfg(pc=pc_cfg))
    gain = base_ts["mape"] - pc_ts["mape"]
    adopt_pc = gain >= PC_ADOPT_MIN_GAIN_PP
    # unseen-postcode diagnostics on the time split
    tr_, te_ = df[df["month_num"] <= 6], df[df["month_num"] >= 7]
    f_pc = L.fit(tr_, L.Cfg(pc=pc_cfg))
    seen = te_["postal_code_clean"].isin(set(f_pc.pc_table)).to_numpy()
    y_te = te_["total_price"].to_numpy()
    ape_pc = np.abs(L.predict_total(f_pc, te_) - y_te) / y_te
    f_b = L.fit(tr_, v3def)
    ape_b = np.abs(L.predict_total(f_b, te_) - y_te) / y_te
    meta["postcode_experiment"] = {
        "grid": pc_rows,
        "selected": {"mode": pc_cfg[0], "k": pc_cfg[1], "selection_metric": "Jan-Jun 5-fold CV MAPE (default LightGBM params)"},
        "baseline_no_postcode": {"janjun_cv_mape": base_jj, "jul_aug_mape": base_ts["mape"], "n_test": base_ts["n"]},
        "selected_result": {"jul_aug_mape": pc_ts["mape"], "mae": pc_ts["mae"], "n_test": pc_ts["n"], "n_train": pc_ts["n_train"]},
        "gain_pp_jul_aug": gain,
        "adoption_threshold_pp": PC_ADOPT_MIN_GAIN_PP,
        "adopted": bool(adopt_pc),
        "jul_aug_rows_with_postnummer_in_table": {"n_seen": int(seen.sum()), "n_unseen": int((~seen).sum()), "mape_seen_with_pc": float(ape_pc[seen].mean() * 100), "mape_unseen_with_pc": float(ape_pc[~seen].mean() * 100), "mape_seen_without_pc": float(ape_b[seen].mean() * 100), "mape_unseen_without_pc": float(ape_b[~seen].mean() * 100)},
        "table_size_jan_jun": len(f_pc.pc_table),
    }
    print(f"  selected {pc_cfg}: Jul-Aug {pc_ts['mape']:.3f} vs {base_ts['mape']:.3f} -> gain {gain:.3f}pp, adopt={adopt_pc}")
    final_pc = pc_cfg if adopt_pc else None

    # ---------------- 3. tuning ----------------
    print("[3] random search (seeded), selection on Jan-Jun 5-fold CV")
    tuning = {}
    for label, pc in [("final_feature_set", final_pc), ("without_postcode_for_reference", None)] if final_pc else [("final_feature_set", None)]:
        rows = []
        for i, p in enumerate(L.sample_configs(N_SEARCH)):
            rows.append({"i": i, "params": p, "janjun_cv_mape": L.cv_score(jan_jun, L.Cfg(params=p, pc=pc))["mape"]})
        rows.sort(key=lambda r: r["janjun_cv_mape"])
        best = rows[0]
        default_c = L.Cfg(pc=pc)
        tuned_c = L.Cfg(params=best["params"], pc=pc)
        d_ts, t_ts = L.time_split_score(df, default_c), L.time_split_score(df, tuned_c)
        d_cv, t_cv = L.cv_score(df, default_c), L.cv_score(df, tuned_c)
        adopt = t_ts["mape"] < d_ts["mape"]
        tuning[label] = {
            "n_configs": N_SEARCH,
            "seed": RAND,
            "search_space": L.SEARCH_SPACE,
            "default_params": L.DEFAULT_LGBM,
            "best_params": best["params"],
            "best_janjun_cv_mape": best["janjun_cv_mape"],
            "default_janjun_cv_mape": L.cv_score(jan_jun, default_c)["mape"],
            "top5": rows[:5],
            "jul_aug": {"default": d_ts["mape"], "tuned": t_ts["mape"], "n_test": d_ts["n"]},
            "full_5fold_cv": {"default": d_cv["mape"], "tuned": t_cv["mape"], "n": d_cv["n"]},
            "adopted": bool(adopt),
        }
        print(f"  {label}: default Jul-Aug {d_ts['mape']:.3f} / tuned {t_ts['mape']:.3f}; CV {d_cv['mape']:.3f} / {t_cv['mape']:.3f}; adopt={adopt}")
    meta["tuning"] = tuning
    chosen_params = tuning["final_feature_set"]["best_params"] if tuning["final_feature_set"]["adopted"] else dict(L.DEFAULT_LGBM)
    final_cfg = L.Cfg(params=chosen_params, pc=final_pc)

    # ---------------- 4. final evaluation ----------------
    print("[4] final evaluation")
    final_cv, final_ts = L.cv_score(df, final_cfg), L.time_split_score(df, final_cfg)
    meta["final_model"] = {
        "params": chosen_params,
        "postcode_encoding": None if not final_pc else {"mode": final_pc[0], "k": final_pc[1]},
        "cv": final_cv,
        "time_split": final_ts,
    }
    print(f"  CV {final_cv['mape']:.3f} (MAE {final_cv['mae']:.0f}, n={final_cv['n']}); Jul-Aug {final_ts['mape']:.3f} (n={final_ts['n']})")

    # v2 per-area baseline (CV) for the card
    meta["v2_per_area_cv"] = baselines["v2_restricted_300_trees_shipped"]["cv"]["per_area"]

    # ---------------- 5. conformal ----------------
    print("[5] conformal")
    conformal = L.conformal_v3(df, final_cfg)
    conformal_v2_features = L.conformal_v3(df, v2cfg300)
    print(f"  coverage {conformal['empirical_coverage_overall']:.3f} (n={conformal['n_test']}), v2-config {conformal_v2_features['empirical_coverage_overall']:.3f}")
    meta["conformal_interval_evaluation"] = conformal
    meta["conformal_v2_config_same_protocol"] = {k: conformal_v2_features[k] for k in ("empirical_coverage_overall", "q_overall_log", "n_test", "mape_jul_aug_jan_may_model")}

    # ---------------- 6. production model + export ----------------
    print("[6] production fit + export")
    prod = L.fit(df, final_cfg)
    if prod.pc_table:  # the SHIPPED table is rounded to 6 d.p.; fixtures must use exactly that
        prod.pc_table = {k: round(v, 6) for k, v in prod.pc_table.items()}
    model_json = export_model_json(prod, df)
    # smearing from the COMPRESSED booster on the training matrix (OOF postcode deltas), as in v2
    d_tr = df.copy()
    if final_pc:
        d_tr[L.PC_FEATURE], _ = L.encode_train_and_table(df, final_cfg)
    X_tr = prod.pipe.named_steps["prep"].transform(d_tr[final_cfg.feature_cols]).to_numpy(dtype=float)
    resid = df["log_price_per_sqm"].to_numpy() - t._predict_custom(model_json["lightgbm_booster"], X_tr)
    smear = float(np.mean(np.exp(resid)))
    model_bytes = len(json.dumps(model_json, default=str))
    assert model_bytes <= SIZE_LIMIT_MAIN, f"model.json {model_bytes} > {SIZE_LIMIT_MAIN}"
    (OUT / "model.json").write_text(json.dumps(model_json, default=str), encoding="utf-8")
    pc_json = None
    if final_pc:
        table = dict(sorted(prod.pc_table.items()))
        pc_json = {
            "feature": L.PC_FEATURE,
            "mode": final_pc[0],
            "k_shrinkage": final_pc[1],
            "fallback_for_unseen_or_missing_postnummer": 0.0,
            "definition": "delta[postnummer] = sum(v_i) / (n + k) over training rows with that postnummer, v_i = log(price_per_sqm_i) - mean log(price_per_sqm) of the row's omrade (== n/(n+k) * (postnummer mean - omrade mean)). Training rows of the booster saw OUT-OF-FOLD deltas (5 inner folds); inference uses this full-data table.",
            "n_postnummer": len(table),
            "table": table,
        }
        (OUT / "postcode_encoding.json").write_text(json.dumps(pc_json, ensure_ascii=False), encoding="utf-8")
    fixtures = build_fixtures_stockholm(prod, model_json, df, conformal["q_per_area_log"], conformal["q_overall_log"], smear)
    (OUT / "parity_fixtures.json").write_text(json.dumps(fixtures, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    # sanity: exported booster == LightGBM native on the inference path (uncompressed vs compressed difference only)
    nat = prod.predict_log(df.head(200))
    exp = custom_predict_log(model_json, prod, df.head(200))
    meta["production_model"] = {
        "file": "model.json",
        "postcode_encoding_file": "postcode_encoding.json" if final_pc else None,
        "n_trees": len(model_json["lightgbm_booster"]["tree_info"]),
        "round_sig_figs": PROD_ROUND_SIG,
        "json_bytes": model_bytes,
        "postcode_encoding_json_bytes": len(json.dumps(pc_json, ensure_ascii=False)) if pc_json else 0,
        "smearing_factor": smear,
        "max_abs_diff_native_vs_exported_log_pred_first_200_rows": float(np.max(np.abs(nat - exp))),
        "back_transform": "predicted_total_price = exp(model_log_pred) * smearing_factor * living_area",
        "interval": "bounds = exp(model_log_pred +/- q_log_for_area) * smearing_factor * living_area; q from conformal_interval_evaluation.q_per_area_log, fallback q_overall_log",
        "inputs_to_booster_in_order": model_json["feature_order_out"],
    }
    print(f"  model.json {model_bytes:,} B; max |native - exported| = {meta['production_model']['max_abs_diff_native_vs_exported_log_pred_first_200_rows']:.2e}")

    # ---------------- 7. effects ----------------
    print("[7] effects (OLS without monthly_fee_clean)")
    effects, fee_stats = build_effects_v3(df)
    (OUT / "effects.json").write_text(json.dumps(effects, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    meta["effects_fee_per_sqm"] = fee_stats
    for e in effects["effects"]:
        if e["niva"] == "stad":
            print(f"  {e['id']}: {e['effekt_procent']:+.2f}% CI[{e['ci_low_procent']:+.2f},{e['ci_high_procent']:+.2f}] n={e['n']} sig={e['signifikant']}")
    v2_eff = json.loads((ROOT / "ml" / "artifacts" / "valuation-v2" / "effects.json").read_text(encoding="utf-8"))
    meta["effects_vs_v2"] = {
        "same_top_level_keys": sorted(effects.keys()) == sorted(v2_eff.keys()),
        "ids_only_in_v3": sorted({e["id"] for e in effects["effects"]} - {e["id"] for e in v2_eff["effects"]}),
        "ids_only_in_v2": sorted({e["id"] for e in v2_eff["effects"]} - {e["id"] for e in effects["effects"]}),
        "v2_fee_per_sqm+100": next(e for e in v2_eff["effects"] if e["id"] == "fee_per_sqm+100"),
        "v3_fee_per_sqm+10": next(e for e in effects["effects"] if e["id"] == "fee_per_sqm+10"),
        "v2_vs_v3_other_effects": {
            e["id"]: {"v2": next((x["effekt_procent"] for x in v2_eff["effects"] if x["id"] == e["id"] and x["niva"] == e["niva"] and x["omrade"] == e["omrade"]), None), "v3": e["effekt_procent"]}
            for e in effects["effects"]
            if e["niva"] == "stad"
        },
    }

    # ---------------- 8. regional / general model ----------------
    print("[8] general model r(x) and simulated regional method")
    reg: dict = {}
    reg["design_variants_jul_aug_and_cv"] = {}
    reg["monotone_constraints"] = GENERAL_MONOTONE
    c_free = gen_cfg("rel_log")
    c_free.monotone = {}
    gfree = GeneralFit.__new__(GeneralFit)  # unconstrained reference for the sign check
    gfree.variant, gfree.train = "area_relative", L.area_relative_target(df)
    gfree.area_mean = gfree.train.groupby("omrade")["price_per_sq_meter"].mean()
    gfree.cfg, gfree.normaliser = c_free, 1.0
    gfree.f = L.fit(gfree.train, c_free)
    reg["marginal_effects_on_r_UNCONSTRAINED_for_reference"] = partial_effects(gfree, df[~df["omrade"].str.startswith("Okänt")])
    for variant in ["pooled", "area_relative"]:
        for drop_fee in [False, True]:
            for label, params in [("60 trees x 15 leaves", dict(n_estimators=60, num_leaves=15, learning_rate=0.05)), ("150 trees x 15 leaves", GENERAL_PARAMS), ("300 trees x 31 leaves", dict(n_estimators=300, num_leaves=31, learning_rate=0.05))]:
                if variant == "pooled" and label != "150 trees x 15 leaves":
                    continue
                kw = dict(variant=variant, drop_fee=drop_fee, params=params)
                te, p, g = sim_eval(df[df["month_num"] <= 5], df[df["month_num"] >= 7], **kw)
                cvr = sim_cv(df, **kw)
                gj = GeneralFit(df, **kw)
                size = len(json.dumps(compress(gj.f.pipe.named_steps["model"].booster_.dump_model())))
                key = f"{variant} | fee={'no' if drop_fee else 'yes'} | {label}"
                reg["design_variants_jul_aug_and_cv"][key] = {"jul_aug_mape_train_jan_may": sim_mape(te, p), "n_test": int(len(te)), "cv_mape": cvr["mape"], "cv_n": cvr["n"], "booster_json_bytes": size}
                print(f"  {key}: Jul-Aug {sim_mape(te, p):.2f}% (n={len(te)}), CV {cvr['mape']:.2f}% (n={cvr['n']}), {size:,} B")

    main_kw = dict(variant="area_relative", drop_fee=False, params=GENERAL_PARAMS)
    nofee_kw = dict(variant="area_relative", drop_fee=True, params=GENERAL_PARAMS)
    reg["simulation"] = {"with_fee": sim_conformal(df, **main_kw), "without_fee": sim_conformal(df, **nofee_kw)}
    reg["simulation_cv_with_fee"] = sim_cv(df, **main_kw)
    reg["simulation_cv_without_fee"] = sim_cv(df, **nofee_kw)
    sim = reg["simulation"]["with_fee"]
    print(f"  simulated regional (with fee): MAPE Jul-Aug {sim['mape_jul_aug_jan_may_model']:.2f}% n={sim['n_test']}, coverage {sim['coverage_overall']:.3f}, q={sim['q_regional_log']:.4f}")

    # production general models (all data)
    def export_general(kw: dict, filename: str) -> dict:
        g = GeneralFit(df, **kw)
        mj = export_model_json(g.f, g.train)
        # smearing/clip from the compressed booster so the file is self-consistent
        d = g.train
        Xg = g.f.pipe.named_steps["prep"].transform(d[g.cfg.feature_cols]).to_numpy(dtype=float)
        log_g = t._predict_custom(mj["lightgbm_booster"], Xg)
        smear_g = float(np.mean(np.exp(d[g.cfg.target].to_numpy() - log_g)))
        r_tr = np.exp(log_g) * smear_g / g.normaliser
        info = {
            "formula": "r(x) = clip(exp(g(x)) * smearing_factor / normaliser, clip_min, clip_max); g(x) = booster output (log of price per m2 relative to the omrade average)",
            "target": "log(price_per_sq_meter / mean price_per_sq_meter of the row's omrade), no location features",
            "smearing_factor": smear_g,
            "normaliser": g.normaliser,
            "clip_min": float(r_tr.min()),
            "clip_max": float(r_tr.max()),
            "mean_r_training_rows": float(r_tr.mean()),
            "n_training_rows": int(len(d)),
            "input_ranges_training": {c: {"min": float(df[c].min()), "p01": float(df[c].quantile(0.01)), "p99": float(df[c].quantile(0.99)), "max": float(df[c].max())} for c in ["living_area", "number_of_rooms", "apartment_floor_clean", "build_year_clean", "fee_per_sqm"]},
        }
        mj["r_inference"] = info
        (OUT / filename).write_text(json.dumps(mj, default=str), encoding="utf-8")
        info["json_bytes"] = len(json.dumps(mj, default=str))
        return {"info": info, "model_json": mj, "fit": g}

    gen = export_general(main_kw, "general_model.json")
    gen_nofee = export_general(nofee_kw, "general_model_nofee.json")
    reg["production_general_model"] = gen["info"]
    reg["production_general_model_nofee"] = gen_nofee["info"]
    reg["marginal_effects_on_r_with_fee"] = partial_effects(gen["fit"], df[~df["omrade"].str.startswith("Okänt")])
    # mean observed ppsm: arithmetic mean of per-sale vs total/total
    reg["average_definition_sensitivity"] = {
        "mean_of_sale_ppsm": float(df["price_per_sq_meter"].mean()),
        "total_price_over_total_area": float(df["total_price"].sum() / df["living_area"].sum()),
        "median_ppsm": float(df["price_per_sq_meter"].median()),
        "n": n_all,
        "period": DATA_PERIOD,
    }
    # regional fixtures for r(x): 50 rows incl. missing and out-of-range inputs
    g_fit = gen["fit"]
    mj = gen["model_json"]
    info = gen["info"]
    sample = df.loc[pick_fixture_rows(df[~df["omrade"].str.startswith("Okänt")])].copy()
    X = g_fit.f.pipe.named_steps["prep"].transform(sample[g_fit.cfg.feature_cols]).to_numpy(dtype=float)
    log_g = t._predict_custom(mj["lightgbm_booster"], X)
    r_unclipped = np.exp(log_g) * info["smearing_factor"] / info["normaliser"]
    r_clipped = np.clip(r_unclipped, info["clip_min"], info["clip_max"])
    rfix = []
    for i, (_, row) in enumerate(sample.iterrows()):
        rfix.append({"input": {k: v for k, v in fixture_input(row).items() if k not in ("postnummer", "omrade")}, "expected_output": {"log_g": float(log_g[i]), "r_unclipped": float(r_unclipped[i]), "r": float(r_clipped[i])}})
    # extreme inputs to exercise the clip
    extreme = sample.iloc[:2].copy()
    extreme["fee_per_sqm"] = [400.0, 5.0]
    extreme["living_area"] = [300.0, 15.0]
    Xe = g_fit.f.pipe.named_steps["prep"].transform(extreme[g_fit.cfg.feature_cols]).to_numpy(dtype=float)
    lge = t._predict_custom(mj["lightgbm_booster"], Xe)
    for i, (_, row) in enumerate(extreme.iterrows()):
        ru = float(np.exp(lge[i]) * info["smearing_factor"] / info["normaliser"])
        inp = {k: v for k, v in fixture_input(row).items() if k not in ("postnummer", "omrade")}
        inp["boarea"] = float(row["living_area"])
        inp["manadsavgift"] = float(row["fee_per_sqm"] * row["living_area"])
        rfix.append({"input": inp, "note": "extreme boarea/avgift: tests input handling and clip", "expected_output": {"log_g": float(lge[i]), "r_unclipped": ru, "r": float(np.clip(ru, info["clip_min"], info["clip_max"]))}})
    (OUT / "general_parity_fixtures.json").write_text(json.dumps(rfix, indent=2, ensure_ascii=False), encoding="utf-8")
    reg["n_general_fixtures"] = len(rfix)
    reg["q_regional_log"] = sim["q_regional_log"]
    meta["regional_method"] = reg

    meta["sizes_bytes"] = {
        "model.json": model_bytes,
        "postcode_encoding.json": meta["production_model"]["postcode_encoding_json_bytes"],
        "general_model.json": gen["info"]["json_bytes"],
        "general_model_nofee.json": gen_nofee["info"]["json_bytes"],
    }
    meta["sizes_bytes"]["model_plus_general_plus_postcode"] = model_bytes + gen["info"]["json_bytes"] + meta["sizes_bytes"]["postcode_encoding.json"]
    print("  sizes:", meta["sizes_bytes"])

    (OUT / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
