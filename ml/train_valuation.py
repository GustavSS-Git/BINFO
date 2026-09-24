"""Task 4c: trains and evaluates the Binfo valuation model.

Reproducible entrypoint. Run with:
    ml/.venv/bin/python ml/train_valuation.py

v2 (2026-09-24 follow-up) changes, on top of v1:
  - uses the fixed (OSM + GeoNames) postnummer->omrade mapping (task 4b v2)
  - additionally trains/evaluates a RESTRICTED feature set matching exactly what the
    product can supply at inference (no building_storeys, no month/time feature --
    see "Inputs available at inference" in the model card) and ships THAT model
  - recalibrates the prediction interval time- and area-aware (train Jan-May,
    calibrate Jun, test Jul-Aug) instead of a random holdout
  - exports the chosen model to a portable JSON (ml/artifacts/valuation-v2/model.json
    via LightGBM's own Booster.dump_model()) plus an encoding manifest, for a
    from-scratch TypeScript evaluator (not written here) to implement against
  - writes parity_fixtures.json: ~50 rows with exact Python predictions/intervals

Pipeline:
  1. load + clean (ml/cleaning.py) data/raw/Transaction data for valuation.xlsx
  2. join data/derived/postnummer_omrade.csv (task 4b v2) for the `omrade` feature
  3. build features (never including utgangspris -- it is not even in this file)
  4. compare log vs level target; evaluate 4 model families x {FULL, RESTRICTED}
     feature sets with 5-fold CV and a time-based split (train Jan-Jun, test
     Jul-Aug), report MAE/MAPE on TOTAL price overall and per area
  5. pick the simplest model within 1 percentage point MAPE of the best, separately
     for FULL (reporting/comparison only) and RESTRICTED (what we actually ship)
  6. fit a time+area-aware split-conformal prediction interval on the RESTRICTED
     chosen model, report empirical coverage on the Jul-Aug held-out period, overall
     and per area
  7. fit an interpretable (unregularised, statsmodels) OLS on the FULL features for
     the effects table (unchanged methodology from v1)
  8. write ml/artifacts/valuation-v1/ (refreshed FULL-feature numbers, fixed mapping)
     and ml/artifacts/valuation-v2/ (RESTRICTED-feature production model: model.json,
     encoding manifest, metadata.json, parity_fixtures.json) plus both MODEL_CARD.md

Seeded (RANDOM_STATE) throughout for reproducibility.
"""

from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import statsmodels.api as sm
from lightgbm import LGBMRegressor
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cleaning import clean_dataframe  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RAW_XLSX = ROOT / "data" / "raw" / "Transaction data for valuation.xlsx"
POSTNUMMER_OMRADE_CSV = ROOT / "data" / "derived" / "postnummer_omrade.csv"
ARTIFACT_DIR_V1 = ROOT / "ml" / "artifacts" / "valuation-v1"
ARTIFACT_DIR_V2 = ROOT / "ml" / "artifacts" / "valuation-v2"

RANDOM_STATE = 42
N_SPLITS = 5
MAPE_MARGIN_PP = 1.0  # "within 1 percentage point MAPE of the best" -> owner choice
AREA_EFFECT_MIN_N = 100
AREA_EFFECT_MAX_CI_HALFWIDTH_LOG = 0.05  # ~ +/-5 percentage points on the effect
CONFORMAL_COVERAGE_TARGET = 0.90
AREA_CALIB_MIN_N = 30  # below this, an area falls back to the overall (pooled) q

# ---- FULL feature set (everything we cleaned, used for the v1 comparison table and
# the interpretable OLS effects table -- NOT what is shipped for inference) ----
FULL_NUMERIC_FEATURES = [
    "living_area",
    "number_of_rooms",
    "apartment_floor_clean",
    "building_storeys_clean",
    "build_year_clean",
    "monthly_fee_clean",
    "fee_per_sqm",
    "month_num",
]
FULL_MISSING_INDICATOR_FEATURES = [
    "apartment_floor_missing",
    "building_storeys_missing",
    "build_year_missing",
    "monthly_fee_missing",
]

# ---- RESTRICTED feature set: exactly what the product can supply at inference.
# Per the follow-up brief, the product has: postnummer, boarea, antalRum,
# manadsavgift, vaning (optional), byggar (optional), hiss (ja/nej/okant), balkong
# (ja/nej/okant). It has NO building_storeys and supplies no transaction/valuation
# date, so month_num (the time feature) is dropped too -- there is no defined "today"
# encoding the product could pass, and keeping it would require extrapolating beyond
# the 8 months of training data indefinitely into the future, which we chose not to
# do implicitly. This IS what is shipped in ml/artifacts/valuation-v2/. ----
RESTRICTED_NUMERIC_FEATURES = [
    "living_area",
    "number_of_rooms",
    "apartment_floor_clean",
    "build_year_clean",
    "monthly_fee_clean",
    "fee_per_sqm",
]
RESTRICTED_MISSING_INDICATOR_FEATURES = [
    "apartment_floor_missing",
    "build_year_missing",
    "monthly_fee_missing",
]

CATEGORICAL_FEATURES = ["omrade", "elevator_clean", "balcony_clean"]

DATA_PERIOD = "2026-01-01 to 2026-08-31 (8 months)"
TODAY_REFERENCE_MONTH = 8  # August 2026 = latest month in the data = "today"


def all_features(numeric: list[str], missing: list[str]) -> list[str]:
    return numeric + missing + CATEGORICAL_FEATURES


# ---------------------------------------------------------------------------
# data loading / feature building
# ---------------------------------------------------------------------------
def load_data() -> tuple[pd.DataFrame, dict]:
    df_raw = pd.read_excel(RAW_XLSX, sheet_name="Sheet1", header=1)
    cleaned, report = clean_dataframe(df_raw)

    mapping = pd.read_csv(POSTNUMMER_OMRADE_CSV, dtype={"postnummer": str})
    mapping = mapping.rename(columns={"postnummer": "postal_code_clean"})
    cleaned = cleaned.merge(
        mapping[["postal_code_clean", "omrade", "andel_i_omrade", "n_adresser", "metod"]],
        on="postal_code_clean",
        how="left",
    )
    n_unmapped = int(cleaned["omrade"].isna().sum())
    cleaned["omrade"] = cleaned["omrade"].fillna("Okänt (postnummer ej kartlagt)")

    cleaned["contract_date"] = pd.to_datetime(cleaned["contract_date"])
    cleaned["month_num"] = cleaned["contract_date"].dt.month

    cleaned["fee_per_sqm"] = cleaned["monthly_fee_clean"] / cleaned["living_area"]

    for col, src in [
        ("apartment_floor_missing", "apartment_floor_clean"),
        ("building_storeys_missing", "building_storeys_clean"),
        ("build_year_missing", "build_year_clean"),
        ("monthly_fee_missing", "monthly_fee_clean"),
    ]:
        cleaned[col] = cleaned[src].isna().astype(int)

    before = len(cleaned)
    cleaned = cleaned[cleaned["living_area"].notna()].copy()
    n_dropped_missing_living_area = before - len(cleaned)

    cleaned["total_price"] = cleaned["price_per_sq_meter"] * cleaned["living_area"]
    cleaned["log_price_per_sqm"] = np.log(cleaned["price_per_sq_meter"])

    meta = {
        "cleaning_report": report.as_dict(),
        "n_unmapped_omrade": n_unmapped,
        "n_dropped_missing_living_area": n_dropped_missing_living_area,
        "n_final_rows": len(cleaned),
    }
    return cleaned, meta


# ---------------------------------------------------------------------------
# model building (parametrised by feature set + whether to scale numeric features:
# tree models don't need scaling, and NOT scaling keeps the exported LightGBM JSON
# artifact simple -- no scaler mean/std to also serialise for the TS evaluator)
# ---------------------------------------------------------------------------
def make_preprocessor(numeric: list[str], missing: list[str], scale_numeric: bool) -> ColumnTransformer:
    numeric_steps = [("impute", SimpleImputer(strategy="median"))]
    if scale_numeric:
        numeric_steps.append(("scale", StandardScaler()))
    numeric_pipeline = Pipeline(steps=numeric_steps)
    categorical_pipeline = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )
    ct = ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, numeric),
            ("ind", "passthrough", missing),
            ("cat", categorical_pipeline, CATEGORICAL_FEATURES),
        ]
    )
    ct.set_output(transform="pandas")
    return ct


def make_models(numeric: list[str], missing: list[str]) -> dict:
    return {
        "log_linear_ridge": Pipeline(
            steps=[
                ("prep", make_preprocessor(numeric, missing, scale_numeric=True)),
                ("model", RidgeCV(alphas=np.logspace(-3, 3, 25))),
            ]
        ),
        "random_forest": Pipeline(
            steps=[
                ("prep", make_preprocessor(numeric, missing, scale_numeric=False)),
                (
                    "model",
                    RandomForestRegressor(
                        n_estimators=400,
                        max_depth=12,
                        min_samples_leaf=3,
                        random_state=RANDOM_STATE,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
        "lightgbm": Pipeline(
            steps=[
                ("prep", make_preprocessor(numeric, missing, scale_numeric=False)),
                (
                    "model",
                    LGBMRegressor(
                        n_estimators=400,
                        num_leaves=31,
                        learning_rate=0.05,
                        random_state=RANDOM_STATE,
                        verbosity=-1,
                    ),
                ),
            ]
        ),
        "xgboost": Pipeline(
            steps=[
                ("prep", make_preprocessor(numeric, missing, scale_numeric=False)),
                (
                    "model",
                    XGBRegressor(
                        n_estimators=400,
                        max_depth=5,
                        learning_rate=0.05,
                        random_state=RANDOM_STATE,
                        verbosity=0,
                    ),
                ),
            ]
        ),
    }


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------
def total_price_from_log_pred(log_pred: np.ndarray, living_area: np.ndarray, resid_log: np.ndarray) -> np.ndarray:
    """Back-transforms a log(price_per_sqm) prediction to total price, applying a
    Duan (1983) smearing correction (mean of exp(residual) on the fold the model
    was fit on) instead of the naive exp(pred), which is biased downward for a
    right-skewed target."""
    smear = float(np.mean(np.exp(resid_log)))
    return np.exp(log_pred) * smear * living_area


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred)))


def mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs((y_true - y_pred) / y_true)) * 100)


def per_area_metrics(y_true: np.ndarray, y_pred: np.ndarray, area: np.ndarray) -> dict:
    out = {}
    for a in sorted(set(area)):
        mask = area == a
        n = int(mask.sum())
        if n == 0:
            continue
        out[a] = {"n": n, "mae": mae(y_true[mask], y_pred[mask]), "mape": mape(y_true[mask], y_pred[mask])}
    return out


# ---------------------------------------------------------------------------
# evaluation: 5-fold CV and time-based split, parametrised by feature list
# ---------------------------------------------------------------------------
def evaluate_cv(df: pd.DataFrame, models: dict, features: list[str]) -> dict:
    kf = KFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_STATE)
    X = df[features]
    y_log = df["log_price_per_sqm"].values
    total_price = df["total_price"].values
    living_area = df["living_area"].values
    area = df["omrade"].values

    results = {}
    for name, pipe in models.items():
        fold_preds = np.zeros(len(df))
        for train_idx, test_idx in kf.split(X):
            pipe_fold = clone(pipe)
            pipe_fold.fit(X.iloc[train_idx], y_log[train_idx])
            log_pred = pipe_fold.predict(X.iloc[test_idx])
            resid_log_train = y_log[train_idx] - pipe_fold.predict(X.iloc[train_idx])
            fold_preds[test_idx] = total_price_from_log_pred(log_pred, living_area[test_idx], resid_log_train)
        results[name] = {
            "overall": {"mae": mae(total_price, fold_preds), "mape": mape(total_price, fold_preds), "n": len(df)},
            "per_area": per_area_metrics(total_price, fold_preds, area),
        }
    return results


def evaluate_time_split(df: pd.DataFrame, models: dict, features: list[str]) -> tuple[dict, dict]:
    train_mask = df["month_num"] <= 6
    test_mask = df["month_num"] >= 7
    train, test = df[train_mask], df[test_mask]

    X_train, X_test = train[features], test[features]
    y_train_log = train["log_price_per_sqm"].values
    total_price_test = test["total_price"].values
    living_area_test = test["living_area"].values
    area_test = test["omrade"].values

    results = {}
    fitted = {}
    for name, pipe in models.items():
        pipe_fit = clone(pipe)
        pipe_fit.fit(X_train, y_train_log)
        log_pred = pipe_fit.predict(X_test)
        resid_log_train = y_train_log - pipe_fit.predict(X_train)
        pred_total = total_price_from_log_pred(log_pred, living_area_test, resid_log_train)
        results[name] = {
            "overall": {
                "mae": mae(total_price_test, pred_total),
                "mape": mape(total_price_test, pred_total),
                "n_train": len(train),
                "n_test": len(test),
            },
            "per_area": per_area_metrics(total_price_test, pred_total, area_test),
        }
        fitted[name] = pipe_fit
    return results, fitted


def compare_log_vs_level(df: pd.DataFrame, features: list[str]) -> dict:
    """Quick log-vs-level comparison using the ridge baseline only (5-fold CV,
    MAPE on total price), to justify the target transform used for every model."""
    kf = KFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_STATE)
    X = df[features]
    total_price = df["total_price"].values
    living_area = df["living_area"].values

    numeric_only = [f for f in features if f not in CATEGORICAL_FEATURES and not f.endswith("_missing")]
    missing_only = [f for f in features if f.endswith("_missing")]
    base_pipe = Pipeline(
        steps=[
            ("prep", make_preprocessor(numeric_only, missing_only, scale_numeric=True)),
            ("model", RidgeCV(alphas=np.logspace(-3, 3, 25))),
        ]
    )

    y_log = df["log_price_per_sqm"].values
    preds_log = np.zeros(len(df))
    for train_idx, test_idx in kf.split(X):
        p = clone(base_pipe)
        p.fit(X.iloc[train_idx], y_log[train_idx])
        pred = p.predict(X.iloc[test_idx])
        resid = y_log[train_idx] - p.predict(X.iloc[train_idx])
        preds_log[test_idx] = total_price_from_log_pred(pred, living_area[test_idx], resid)

    y_level = df["price_per_sq_meter"].values
    preds_level = np.zeros(len(df))
    for train_idx, test_idx in kf.split(X):
        p = clone(base_pipe)
        p.fit(X.iloc[train_idx], y_level[train_idx])
        pred_per_sqm = p.predict(X.iloc[test_idx])
        preds_level[test_idx] = pred_per_sqm * living_area[test_idx]

    return {
        "log_target": {"mae": mae(total_price, preds_log), "mape": mape(total_price, preds_log)},
        "level_target": {"mae": mae(total_price, preds_level), "mape": mape(total_price, preds_level)},
    }


GENERAL_SIMPLICITY_ORDER = ["log_linear_ridge", "random_forest", "lightgbm", "xgboost"]
# For the model we actually ship (RESTRICTED/production selection), "simplicity"
# means serving simplicity, not model-class simplicity: LightGBM has a standard,
# officially-documented, portable JSON export (Booster.dump_model()) purpose-built
# for cross-language reimplementation, which is exactly what item 5 (TS serving, no
# Python at runtime) needs. A RandomForestRegressor has no equivalent standard
# export -- shipping it would mean hand-rolling and maintaining a bespoke exporter
# with no reference implementation to check a TS port against. LightGBM is therefore
# treated as "simpler to serve" than random_forest here, even though it is a more
# complex model class -- documented, deliberate divergence from GENERAL_SIMPLICITY_ORDER.
SERVING_SIMPLICITY_ORDER = ["log_linear_ridge", "lightgbm", "random_forest", "xgboost"]


def pick_model(cv_results: dict, simplicity_order: list[str] = GENERAL_SIMPLICITY_ORDER) -> tuple[str, float]:
    best_name = min(cv_results, key=lambda n: cv_results[n]["overall"]["mape"])
    best_mape = cv_results[best_name]["overall"]["mape"]
    candidates = [n for n in simplicity_order if cv_results[n]["overall"]["mape"] <= best_mape + MAPE_MARGIN_PP]
    return candidates[0], best_mape


# ---------------------------------------------------------------------------
# time + area aware split-conformal prediction interval
# ---------------------------------------------------------------------------
def conformal_interval_v2(df: pd.DataFrame, model_factory, features: list[str]) -> dict:
    """Train on Jan-May, calibrate q (per area + overall, on the LOG scale so the
    interval is a percentage width rather than a flat SEK amount) on June, evaluate
    empirical coverage on the held-out, genuinely-later Jul-Aug period -- both
    overall and per area. Time-aware (calibration month is immediately before the
    test period, not a random shuffle) and area-aware (each area with enough June
    data gets its own q; smaller areas fall back to the pooled q)."""
    train = df[df["month_num"] <= 5]
    calib = df[df["month_num"] == 6]
    test = df[df["month_num"] >= 7]

    pipe = clone(model_factory())
    pipe.fit(train[features], train["log_price_per_sqm"].values)

    calib_pred_log = pipe.predict(calib[features])
    calib_resid_log = calib["log_price_per_sqm"].values - calib_pred_log
    alpha = 1 - CONFORMAL_COVERAGE_TARGET

    q_overall = float(np.quantile(np.abs(calib_resid_log), 1 - alpha))
    q_per_area: dict[str, dict] = {}
    for area, grp in calib.groupby("omrade"):
        n = len(grp)
        resid = calib["log_price_per_sqm"].values[calib["omrade"].values == area] - calib_pred_log[calib["omrade"].values == area]
        if n >= AREA_CALIB_MIN_N:
            q_per_area[area] = {"q_log": float(np.quantile(np.abs(resid), 1 - alpha)), "n_calib": n, "used": "area_specific"}
        else:
            q_per_area[area] = {"q_log": q_overall, "n_calib": n, "used": "pooled_fallback"}

    resid_train_log = train["log_price_per_sqm"].values - pipe.predict(train[features])
    smear = float(np.mean(np.exp(resid_train_log)))

    test_pred_log = pipe.predict(test[features])
    test_omrade = test["omrade"].values
    q_used = np.array([q_per_area.get(a, {"q_log": q_overall})["q_log"] for a in test_omrade])

    lower = np.exp(test_pred_log - q_used) * smear * test["living_area"].values
    upper = np.exp(test_pred_log + q_used) * smear * test["living_area"].values
    true_total = test["total_price"].values
    covered = (true_total >= lower) & (true_total <= upper)

    per_area_coverage = {}
    for area in sorted(set(test_omrade)):
        mask = test_omrade == area
        n = int(mask.sum())
        if n == 0:
            continue
        per_area_coverage[area] = {
            "n_test": n,
            "empirical_coverage": float(np.mean(covered[mask])),
            "q_log": float(q_used[mask][0]),
            "q_source": q_per_area.get(area, {"used": "pooled_fallback"})["used"],
            "median_interval_width_pct_of_pred": float(
                np.median((upper[mask] - lower[mask]) / (np.exp(test_pred_log[mask]) * smear * test["living_area"].values[mask])) * 100
            ),
        }

    return {
        "method": (
            "time+area-aware split conformal on log(price_per_sqm) (percentage-width "
            "interval): train Jan-May, calibrate q per area on June (>=30 calib rows) "
            "else pooled June q, evaluate coverage on held-out Jul-Aug"
        ),
        "target_coverage": CONFORMAL_COVERAGE_TARGET,
        "n_train": len(train),
        "n_calib": len(calib),
        "n_test": len(test),
        "q_overall_log": q_overall,
        "smearing_factor": smear,
        "empirical_coverage_overall": float(np.mean(covered)),
        "per_area": per_area_coverage,
        "q_per_area_log": {a: v["q_log"] for a, v in q_per_area.items()},
        "q_per_area_source": {a: v["used"] for a, v in q_per_area.items()},
    }


# ---------------------------------------------------------------------------
# effects table (statsmodels OLS on log(price_per_sqm), unregularised, FULL features)
# ---------------------------------------------------------------------------
def build_ols_design(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    X = df[FULL_NUMERIC_FEATURES + FULL_MISSING_INDICATOR_FEATURES].copy()
    for col in FULL_NUMERIC_FEATURES:
        X[col] = X[col].fillna(X[col].median())

    area_dummies = pd.get_dummies(df["omrade"], prefix="omrade", drop_first=True, dtype=float)
    elevator_dummies = pd.get_dummies(df["elevator_clean"], prefix="hiss", drop_first=True, dtype=float)
    balcony_dummies = pd.get_dummies(df["balcony_clean"], prefix="balkong", drop_first=True, dtype=float)

    design = pd.concat([X, area_dummies, elevator_dummies, balcony_dummies], axis=1)
    design = design.astype(float)
    feature_names = list(design.columns)
    return design, feature_names


def fit_ols(df: pd.DataFrame):
    design, feature_names = build_ols_design(df)
    y = df["log_price_per_sqm"].values
    X_sm = sm.add_constant(design, has_constant="add")
    model = sm.OLS(y, X_sm).fit()
    return model, X_sm.columns.tolist()


def effects_table(model, columns: list[str]) -> list[dict]:
    ci = model.conf_int(alpha=0.05)
    rows = []
    for name in columns:
        if name == "const":
            continue
        beta = model.params[name]
        lo, hi = ci.loc[name]
        rows.append(
            {
                "feature": name,
                "pct_effect": round((float(np.exp(beta)) - 1) * 100, 2),
                "pct_effect_ci_low": round((float(np.exp(lo)) - 1) * 100, 2),
                "pct_effect_ci_high": round((float(np.exp(hi)) - 1) * 100, 2),
                "p_value": round(float(model.pvalues[name]), 4),
            }
        )
    return rows


def area_specific_amenity_effects(df: pd.DataFrame, amenity_col: str, amenity_label: str) -> dict:
    out = {}
    for area, group in df.groupby("omrade"):
        sub = group[group[amenity_col].isin(["ja", "nej"])]
        n = len(sub)
        if n < AREA_EFFECT_MIN_N or sub[amenity_col].nunique() < 2:
            out[area] = {"n": n, "used": "city_wide", "reason": f"n={n} < {AREA_EFFECT_MIN_N} or single category"}
            continue
        X = sub[FULL_NUMERIC_FEATURES].copy()
        for col in FULL_NUMERIC_FEATURES:
            X[col] = X[col].fillna(X[col].median())
        X["amenity_ja"] = (sub[amenity_col] == "ja").astype(float)
        X = sm.add_constant(X.astype(float), has_constant="add")
        y = sub["log_price_per_sqm"].values
        m = sm.OLS(y, X).fit()
        beta = m.params["amenity_ja"]
        lo, hi = m.conf_int(alpha=0.05).loc["amenity_ja"]
        half_width = (hi - lo) / 2
        if half_width < AREA_EFFECT_MAX_CI_HALFWIDTH_LOG:
            out[area] = {
                "n": n,
                "used": "area_specific",
                "pct_effect": round((float(np.exp(beta)) - 1) * 100, 2),
                "pct_effect_ci_low": round((float(np.exp(lo)) - 1) * 100, 2),
                "pct_effect_ci_high": round((float(np.exp(hi)) - 1) * 100, 2),
                # raw log-scale beta/CI for the "ja" (has-amenity) direction, kept so
                # effects.json can precisely derive the "nej" (no-amenity) direction
                # (exp(-beta)-1) without re-deriving from rounded percentages.
                "beta_log_ja_direction": float(beta),
                "ci_low_log_ja_direction": float(lo),
                "ci_high_log_ja_direction": float(hi),
            }
        else:
            out[area] = {
                "n": n,
                "used": "city_wide",
                "reason": f"CI half-width {half_width:.3f} >= {AREA_EFFECT_MAX_CI_HALFWIDTH_LOG}",
            }
    return out


# ---------------------------------------------------------------------------
# task 4d driver effects, machine-readable (product "main drivers" display)
# ---------------------------------------------------------------------------
DRIVER_REFERENCE_CATEGORIES = {
    "elevator_clean": "ja",  # "has elevator" (alphabetically-first category, dropped by get_dummies)
    "balcony_clean": "ja",  # "has balcony"
}

# continuous-feature drivers: (effects_table feature name, driver id, sv label,
# multiplier -- i.e. the effect is reported per this many units of the raw feature,
# not per 1 unit, to keep the % magnitude interpretable)
_CONTINUOUS_DRIVERS = [
    ("number_of_rooms", "rooms+1", "Ett rum till", 1),
    ("apartment_floor_clean", "floor+1", "En våning högre", 1),
    ("build_year_clean", "build_year+10", "10 år nyare byggnad", 10),
    ("fee_per_sqm", "fee_per_sqm+100", "100 kr/m² högre avgift", 100),
    ("living_area", "boarea+10", "10 kvm större boarea", 10),
]

_CATEGORICAL_DRIVERS = [
    ("elevator_clean", "nej", "elevator=nej", "Ingen hiss"),
    ("elevator_clean", "okant", "elevator=okant", "Hiss okänt"),
    ("balcony_clean", "nej", "balcony=nej", "Ingen balkong"),
    ("balcony_clean", "okant", "balcony=okant", "Balkong okänt"),
]


def _scaled_pct_effect(beta: float, lo: float, hi: float, multiplier: float) -> tuple[float, float, float]:
    """Scales a per-1-unit log-scale coefficient (and its 95% CI) to a per-`multiplier`-
    unit % effect. Valid because the OLS is linear in the raw feature on the log
    scale, so beta*multiplier is exactly the coefficient for a `multiplier`-unit
    change, and the CI scales the same way (multiplier > 0 preserves ordering)."""
    eff = (np.exp(beta * multiplier) - 1) * 100
    ci_lo = (np.exp(lo * multiplier) - 1) * 100
    ci_hi = (np.exp(hi * multiplier) - 1) * 100
    return round(float(eff), 2), round(float(ci_lo), 2), round(float(ci_hi), 2)


def build_driver_effects(df: pd.DataFrame, ols_model, balcony_area_effects: dict, elevator_area_effects: dict) -> dict:
    """Task 4d, machine-readable: the product-facing "main drivers" list. Restricted
    to inputs the product actually supplies (hiss, balkong, rooms, floor, build
    year, avgift/avgift per m², boarea) -- area itself is deliberately excluded from
    the drivers list (it's the location, not a driver a buyer can act on/compare;
    area-level price differences are shown elsewhere in the product, not here)."""
    ci = ols_model.conf_int(alpha=0.05)
    effects: list[dict] = []

    # continuous drivers (city-wide only -- no area-specific breakdown was computed
    # for these, only for the binary amenities below)
    for feature, driver_id, label_sv, multiplier in _CONTINUOUS_DRIVERS:
        beta = ols_model.params[feature]
        lo, hi = ci.loc[feature]
        eff, ci_lo, ci_hi = _scaled_pct_effect(beta, lo, hi, multiplier)
        n = int(df[feature].notna().sum())
        effects.append(
            {
                "id": driver_id,
                "label_sv": label_sv,
                "effekt_procent": eff,
                "ci_low_procent": ci_lo,
                "ci_high_procent": ci_hi,
                "niva": "stad",
                "omrade": None,
                "n": n,
                "signifikant": bool(ci_lo > 0 or ci_hi < 0),
            }
        )

    # categorical (binary/tristate) drivers: city-wide, framed relative to the "ja"
    # reference category (has elevator / has balcony), i.e. id="elevator=nej" means
    # "no elevator vs has elevator".
    for col, level, driver_id, label_sv in _CATEGORICAL_DRIVERS:
        param_name = f"{'hiss' if col == 'elevator_clean' else 'balkong'}_{level}"
        beta = ols_model.params[param_name]
        lo, hi = ci.loc[param_name]
        eff, ci_lo, ci_hi = _scaled_pct_effect(beta, lo, hi, 1)
        n = int((df[col] == level).sum())
        effects.append(
            {
                "id": driver_id,
                "label_sv": label_sv,
                "effekt_procent": eff,
                "ci_low_procent": ci_lo,
                "ci_high_procent": ci_hi,
                "niva": "stad",
                "omrade": None,
                "n": n,
                "signifikant": bool(ci_lo > 0 or ci_hi < 0),
            }
        )

    # area-specific amenity effects that meet the n>=100 / CI-width rule (only
    # "nej" is a meaningful driver level -- "ja" is the reference/baseline, not a
    # driver in itself). Convert from the stored "ja-direction" beta (log scale,
    # effect of HAVING the amenity) to the "nej-direction" (effect of NOT having
    # it, matching the city-wide id convention): if beta is the ja-vs-nej log
    # coefficient, the nej-vs-ja coefficient is exactly -beta, so its 95% CI is
    # [-hi, -lo].
    for area_dict, driver_id, label_sv in [
        (elevator_area_effects, "elevator=nej", "Ingen hiss"),
        (balcony_area_effects, "balcony=nej", "Ingen balkong"),
    ]:
        for area, entry in area_dict.items():
            if entry.get("used") != "area_specific":
                continue
            beta_ja = entry["beta_log_ja_direction"]
            lo_ja, hi_ja = entry["ci_low_log_ja_direction"], entry["ci_high_log_ja_direction"]
            beta_nej, lo_nej, hi_nej = -beta_ja, -hi_ja, -lo_ja
            eff, ci_lo, ci_hi = _scaled_pct_effect(beta_nej, lo_nej, hi_nej, 1)
            effects.append(
                {
                    "id": driver_id,
                    "label_sv": label_sv,
                    "effekt_procent": eff,
                    "ci_low_procent": ci_lo,
                    "ci_high_procent": ci_hi,
                    "niva": "omrade",
                    "omrade": area,
                    "n": entry["n"],
                    "signifikant": bool(ci_lo > 0 or ci_hi < 0),
                }
            )

    return {
        "version": "valuation-v2",
        "generated_at": pd.Timestamp.now().isoformat(),
        "method": (
            "Unregularised OLS on log(price_per_sqm), FULL feature set (statsmodels) "
            "-- an interpretability companion to the LightGBM production model in "
            "model.json, not used for point predictions. See "
            "ml/artifacts/valuation-v1/MODEL_CARD.md 'Two models, one purpose'."
        ),
        "data_period": DATA_PERIOD,
        "reference_categories": {
            "hiss": "ja (har hiss)",
            "balkong": "ja (har balkong)",
        },
        "area_specific_rule": {
            "min_n": AREA_EFFECT_MIN_N,
            "max_ci_halfwidth_log": AREA_EFFECT_MAX_CI_HALFWIDTH_LOG,
            "note": "endast hiss/balkong har omrädesspecifika effekter beräknade; övriga drivrutiner är stadsövergripande",
        },
        "caveat_sv": (
            "Det här är genomsnittliga effekter för Stockholm (eller angivet område), "
            "inte en beräkning för just din lägenhet."
        ),
        "excluded_note": (
            "Area-vs-area-effekter (skillnaden mellan Stockholmsområden) visas inte "
            "här -- området är lägenhetens läge, inte en drivrutin köparen kan jämföra."
        ),
        "effects": effects,
    }


# ---------------------------------------------------------------------------
# LightGBM JSON export + parity fixtures (task item 5: TS serving, no Python at runtime)
# ---------------------------------------------------------------------------
def export_lightgbm_json(pipe: Pipeline, numeric: list[str], missing: list[str]) -> dict:
    """Everything a from-scratch TS evaluator needs to reproduce pipe.predict(): the
    fitted preprocessing (median imputer values, one-hot category lists, in the exact
    output column order sklearn's ColumnTransformer produces) and the LightGBM
    booster's own portable JSON dump (from Booster.dump_model(), the format LightGBM
    itself documents for cross-language re-implementation)."""
    prep: ColumnTransformer = pipe.named_steps["prep"]
    model: LGBMRegressor = pipe.named_steps["model"]

    num_imputer = prep.named_transformers_["num"].named_steps["impute"]
    numeric_medians = {feat: float(val) for feat, val in zip(numeric, num_imputer.statistics_)}

    cat_imputer = prep.named_transformers_["cat"].named_steps["impute"]
    cat_fill_values = {feat: str(val) for feat, val in zip(CATEGORICAL_FEATURES, cat_imputer.statistics_)}
    onehot: OneHotEncoder = prep.named_transformers_["cat"].named_steps["onehot"]
    categorical_categories = {
        feat: [str(c) for c in cats] for feat, cats in zip(CATEGORICAL_FEATURES, onehot.categories_)
    }

    feature_order_out = list(prep.get_feature_names_out())

    booster_dump = model.booster_.dump_model()

    return {
        "feature_order_out": feature_order_out,
        "numeric_features": numeric,
        "missing_indicator_features": missing,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_medians_for_imputation": numeric_medians,
        "categorical_fill_value_for_imputation": cat_fill_values,
        "categorical_onehot_categories": categorical_categories,
        "lightgbm_booster": booster_dump,
    }


def build_parity_fixtures(predict_fn, df: pd.DataFrame, features: list[str], q_per_area_log: dict, q_overall_log: float, smear: float, n_fixtures: int = 50) -> list[dict]:
    """~50 rows: every area at least once, rows with missing apartment_floor/
    build_year/monthly_fee, and the 'Okänt' (unmapped postnummer) case. Exact Python
    predictions + intervals, for a TS evaluator to be tested against."""
    rng = np.random.default_rng(RANDOM_STATE)
    picks = []

    for area, grp in df.groupby("omrade"):
        picks.append(grp.sample(1, random_state=RANDOM_STATE).index[0])

    for col in ["apartment_floor_clean", "build_year_clean", "monthly_fee_clean"]:
        missing_rows = df[df[col].isna()]
        if len(missing_rows):
            picks.append(missing_rows.sample(1, random_state=RANDOM_STATE).index[0])

    remaining = [i for i in df.index if i not in picks]
    n_more = max(0, n_fixtures - len(picks))
    if n_more and remaining:
        extra = rng.choice(remaining, size=min(n_more, len(remaining)), replace=False)
        picks.extend(extra.tolist())

    picks = list(dict.fromkeys(picks))  # dedupe, preserve order
    sample = df.loc[picks]

    X = sample[features]
    pred_log = predict_fn(X)
    pred_total = np.exp(pred_log) * smear * sample["living_area"].values

    fixtures = []
    for i, (idx, row) in enumerate(sample.iterrows()):
        area = row["omrade"]
        q_log = q_per_area_log.get(area, q_overall_log)
        lower = float(np.exp(pred_log[i] - q_log) * smear * row["living_area"])
        upper = float(np.exp(pred_log[i] + q_log) * smear * row["living_area"])
        fixtures.append(
            {
                "input": {
                    "postnummer": row["postal_code_clean"],
                    "omrade": area,
                    "boarea": float(row["living_area"]),
                    "antalRum": None if pd.isna(row["number_of_rooms"]) else float(row["number_of_rooms"]),
                    "manadsavgift": None if pd.isna(row["monthly_fee_clean"]) else float(row["monthly_fee_clean"]),
                    "vaning": None if pd.isna(row["apartment_floor_clean"]) else float(row["apartment_floor_clean"]),
                    "byggar": None if pd.isna(row["build_year_clean"]) else float(row["build_year_clean"]),
                    "hiss": row["elevator_clean"],
                    "balkong": row["balcony_clean"],
                },
                "expected_output": {
                    "predicted_total_price_sek": float(pred_total[i]),
                    "predicted_log_price_per_sqm": float(pred_log[i]),
                    "interval_lower_sek": lower,
                    "interval_upper_sek": upper,
                    "q_log_used": float(q_log),
                },
            }
        )
    return fixtures


# ---------------------------------------------------------------------------
# model-size experiment (task item 6): round leaf/threshold values to 6 significant
# digits and/or cap the number of trees, measure the MAPE cost of each, on an
# honest held-out set (the Jan-Jun-trained, Jul-Aug-tested time-split model -- NOT
# the all-data production model, so this is a fair, non-overfit comparison).
# ---------------------------------------------------------------------------
def _round_sig(x: float, sig: int = 6) -> float:
    if x == 0:
        return 0.0
    from math import floor, log10

    d = sig - int(floor(log10(abs(x)))) - 1
    return round(x, d)


def _round_tree_json(node: dict, sig: int) -> dict:
    node = dict(node)
    if "leaf_value" in node:
        node["leaf_value"] = _round_sig(node["leaf_value"], sig)
        return node
    node["threshold"] = _round_sig(node["threshold"], sig)
    node["left_child"] = _round_tree_json(node["left_child"], sig)
    node["right_child"] = _round_tree_json(node["right_child"], sig)
    return node


def _eval_tree(node: dict, x_row: np.ndarray) -> float:
    if "leaf_value" in node:
        return node["leaf_value"]
    val = x_row[node["split_feature"]]
    if val <= node["threshold"]:
        return _eval_tree(node["left_child"], x_row)
    return _eval_tree(node["right_child"], x_row)


def _predict_custom(booster_dump: dict, X: np.ndarray, max_trees: int | None = None) -> np.ndarray:
    trees = booster_dump["tree_info"]
    if max_trees is not None:
        trees = trees[:max_trees]
    preds = np.zeros(len(X))
    for t in trees:
        root = t["tree_structure"]
        preds += np.array([_eval_tree(root, x_row) for x_row in X])
    return preds


def run_model_size_experiment(pipe: Pipeline, test_df: pd.DataFrame, features: list[str], resid_train_log: np.ndarray) -> dict:
    prep: ColumnTransformer = pipe.named_steps["prep"]
    model: LGBMRegressor = pipe.named_steps["model"]
    booster_dump = model.booster_.dump_model()
    n_trees_full = len(booster_dump["tree_info"])

    X_test_df = prep.transform(test_df[features])
    X_test = X_test_df.to_numpy(dtype=float)
    living_area = test_df["living_area"].values
    total_price_true = test_df["total_price"].values
    smear = float(np.mean(np.exp(resid_train_log)))

    native_pred = pipe.predict(test_df[features])
    baseline_pred = _predict_custom(booster_dump, X_test)
    sanity_max_abs_diff = float(np.max(np.abs(native_pred - baseline_pred)))

    def score(pred_log: np.ndarray) -> dict:
        pred_total = total_price_from_log_pred(pred_log, living_area, resid_train_log)
        return {"mae": mae(total_price_true, pred_total), "mape": mape(total_price_true, pred_total)}

    variants = {}
    baseline_size = len(json.dumps(booster_dump))
    variants["baseline_full_precision_400_trees"] = {**score(baseline_pred), "n_trees": n_trees_full, "json_bytes": baseline_size}

    rounded_dump = {**booster_dump, "tree_info": [{**t, "tree_structure": _round_tree_json(t["tree_structure"], 6)} for t in booster_dump["tree_info"]]}
    rounded_pred = _predict_custom(rounded_dump, X_test)
    variants["rounded_6sigfig_400_trees"] = {**score(rounded_pred), "n_trees": n_trees_full, "json_bytes": len(json.dumps(rounded_dump))}

    for cap in (200, 300):
        capped_pred = _predict_custom(booster_dump, X_test, max_trees=cap)
        capped_dump = {**booster_dump, "tree_info": booster_dump["tree_info"][:cap]}
        variants[f"full_precision_{cap}_trees"] = {**score(capped_pred), "n_trees": cap, "json_bytes": len(json.dumps(capped_dump))}

        rounded_capped_dump = {**rounded_dump, "tree_info": rounded_dump["tree_info"][:cap]}
        rounded_capped_pred = _predict_custom(rounded_dump, X_test, max_trees=cap)
        variants[f"rounded_6sigfig_{cap}_trees"] = {**score(rounded_capped_pred), "n_trees": cap, "json_bytes": len(json.dumps(rounded_capped_dump))}

    baseline_mape = variants["baseline_full_precision_400_trees"]["mape"]
    for name, v in variants.items():
        v["mape_delta_pp_vs_baseline"] = round(v["mape"] - baseline_mape, 4)
        v["json_size_reduction_pct"] = round((1 - v["json_bytes"] / baseline_size) * 100, 1)

    return {
        "sanity_check_custom_evaluator_vs_native_max_abs_diff": sanity_max_abs_diff,
        "note": "evaluated on the honest Jan-Jun-trained / Jul-Aug-tested time-split model, not the all-data production model",
        "variants": variants,
    }


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> None:
    warnings.filterwarnings("ignore")
    print("Loading and cleaning data (fixed v2 mapping)...")
    df, load_meta = load_data()
    print(json.dumps(load_meta, indent=2, default=str))

    full_features = all_features(FULL_NUMERIC_FEATURES, FULL_MISSING_INDICATOR_FEATURES)
    restricted_features = all_features(RESTRICTED_NUMERIC_FEATURES, RESTRICTED_MISSING_INDICATOR_FEATURES)

    print("\n[[ FULL feature set (item 3: retrain with fixed mapping) ]]")
    log_vs_level = compare_log_vs_level(df, full_features)
    print(json.dumps(log_vs_level, indent=2))

    full_models = make_models(FULL_NUMERIC_FEATURES, FULL_MISSING_INDICATOR_FEATURES)
    full_cv = evaluate_cv(df, full_models, full_features)
    for name, res in full_cv.items():
        print(f"  FULL {name}: CV MAE={res['overall']['mae']:.0f} MAPE={res['overall']['mape']:.2f}%")
    full_time, _ = evaluate_time_split(df, full_models, full_features)
    for name, res in full_time.items():
        print(f"  FULL {name}: time-split MAE={res['overall']['mae']:.0f} MAPE={res['overall']['mape']:.2f}%")
    full_chosen, full_best_mape = pick_model(full_cv)
    print(f"  FULL chosen: {full_chosen} (best CV MAPE {full_best_mape:.2f}%)")

    print("\n[[ RESTRICTED feature set (item 6: matches actual product inputs) ]]")
    restricted_models = make_models(RESTRICTED_NUMERIC_FEATURES, RESTRICTED_MISSING_INDICATOR_FEATURES)
    restricted_cv = evaluate_cv(df, restricted_models, restricted_features)
    for name, res in restricted_cv.items():
        print(f"  RESTRICTED {name}: CV MAE={res['overall']['mae']:.0f} MAPE={res['overall']['mape']:.2f}%")
    restricted_time, restricted_fitted = evaluate_time_split(df, restricted_models, restricted_features)
    for name, res in restricted_time.items():
        print(f"  RESTRICTED {name}: time-split MAE={res['overall']['mae']:.0f} MAPE={res['overall']['mape']:.2f}%")
    restricted_chosen, restricted_best_mape = pick_model(restricted_cv, SERVING_SIMPLICITY_ORDER)
    print(f"  RESTRICTED chosen: {restricted_chosen} (best CV MAPE {restricted_best_mape:.2f}%)")

    mape_gap = restricted_cv[restricted_chosen]["overall"]["mape"] - full_cv[full_chosen]["overall"]["mape"]
    print(f"\nMAPE gap (restricted best - full best), CV: {mape_gap:+.2f} percentage points")

    size_experiment = None
    if restricted_chosen == "lightgbm":
        print("\nRunning model-size experiment (rounding + tree-count capping) on the time-split model...")
        train_part = df[df["month_num"] <= 6]
        test_part = df[df["month_num"] >= 7]
        lgbm_time_pipe = restricted_fitted["lightgbm"]
        resid_train_log_for_size = train_part["log_price_per_sqm"].values - lgbm_time_pipe.predict(train_part[restricted_features])
        size_experiment = run_model_size_experiment(lgbm_time_pipe, test_part, restricted_features, resid_train_log_for_size)
        print(f"  sanity check (custom evaluator vs native predict, max abs diff): {size_experiment['sanity_check_custom_evaluator_vs_native_max_abs_diff']:.2e}")
        for name, v in size_experiment["variants"].items():
            print(f"  {name}: MAPE={v['mape']:.2f}% (delta {v['mape_delta_pp_vs_baseline']:+.3f}pp) json_bytes={v['json_bytes']:,} (-{v['json_size_reduction_pct']:.0f}%)")

    print("\nFitting time+area-aware conformal interval on the RESTRICTED chosen model...")
    restricted_factory = lambda: make_models(RESTRICTED_NUMERIC_FEATURES, RESTRICTED_MISSING_INDICATOR_FEATURES)[restricted_chosen]  # noqa: E731
    conformal = conformal_interval_v2(df, restricted_factory, restricted_features)
    print(f"  empirical_coverage_overall: {conformal['empirical_coverage_overall']:.3f} (target {CONFORMAL_COVERAGE_TARGET})")
    for area, cov in conformal["per_area"].items():
        print(f"    {area}: n={cov['n_test']} coverage={cov['empirical_coverage']:.3f} ({cov['q_source']})")

    print("\nFitting interpretable OLS for effects table (FULL features)...")
    ols_model, ols_columns = fit_ols(df)
    effects = effects_table(ols_model, ols_columns)
    balcony_area_effects = area_specific_amenity_effects(df, "balcony_clean", "balkong")
    elevator_area_effects = area_specific_amenity_effects(df, "elevator_clean", "hiss")

    # ---- v1 artefact: refreshed FULL-feature numbers on the fixed mapping ----
    ARTIFACT_DIR_V1.mkdir(parents=True, exist_ok=True)
    metadata_v1 = {
        "version": "valuation-v1",
        "superseded_by": "valuation-v2 (restricted feature set matching actual product inputs; see MODEL_CARD.md)",
        "trained_at": pd.Timestamp.now().isoformat(),
        "data_period": DATA_PERIOD,
        "n_rows_used_for_training": load_meta["n_final_rows"],
        "cleaning_report": load_meta["cleaning_report"],
        "n_unmapped_omrade": load_meta["n_unmapped_omrade"],
        "log_vs_level_comparison": log_vs_level,
        "cv_results": full_cv,
        "time_split_results": full_time,
        "chosen_model": full_chosen,
        "features": {"numeric": FULL_NUMERIC_FEATURES, "missing_indicators": FULL_MISSING_INDICATOR_FEATURES, "categorical": CATEGORICAL_FEATURES},
    }
    (ARTIFACT_DIR_V1 / "metadata.json").write_text(json.dumps(metadata_v1, indent=2, default=str), encoding="utf-8")
    coefficients_v1 = {
        "target": "log(price_per_sq_meter)",
        "effects_pct_all_else_equal": effects,
        "area_specific_balcony_effect": balcony_area_effects,
        "area_specific_elevator_effect": elevator_area_effects,
    }
    (ARTIFACT_DIR_V1 / "coefficients.json").write_text(json.dumps(coefficients_v1, indent=2, default=str), encoding="utf-8")

    # ---- v2 artefact: RESTRICTED production model, exported for TS serving ----
    ARTIFACT_DIR_V2.mkdir(parents=True, exist_ok=True)
    production_pipe = clone(make_models(RESTRICTED_NUMERIC_FEATURES, RESTRICTED_MISSING_INDICATOR_FEATURES)[restricted_chosen])
    production_pipe.fit(df[restricted_features], df["log_price_per_sqm"].values)

    # Model-size experiment (item 6) showed rounding to 6 significant digits costs
    # 0.000pp MAPE and capping at 300 trees costs +0.018pp (both far under the 0.1pp
    # bar), for a combined -30% JSON size. Per the brief's rule ("keep the shipped
    # artefact accuracy-first unless the loss is under 0.1pp"), we therefore ship
    # the compressed (300 trees, 6-sig-fig-rounded) model, not the full 400-tree
    # one -- see run_model_size_experiment() output / MODEL_CARD.md for the measured
    # cost on the independent time-split model (the production model is fit on all
    # 8 months, so its own compression cost cannot be measured out-of-sample the
    # same way; we rely on the time-split measurement as the best available evidence
    # that the cost is negligible, and document this explicitly).
    PRODUCTION_N_TREES = 300
    PRODUCTION_ROUND_SIG_FIGS = 6

    production_smear = None
    if restricted_chosen == "lightgbm":
        full_model_json = export_lightgbm_json(production_pipe, RESTRICTED_NUMERIC_FEATURES, RESTRICTED_MISSING_INDICATOR_FEATURES)
        full_booster = full_model_json["lightgbm_booster"]
        compressed_booster = {
            **full_booster,
            "tree_info": [
                {**t, "tree_structure": _round_tree_json(t["tree_structure"], PRODUCTION_ROUND_SIG_FIGS)}
                for t in full_booster["tree_info"][:PRODUCTION_N_TREES]
            ],
        }
        model_json = {**full_model_json, "lightgbm_booster": compressed_booster}
        full_json_bytes = len(json.dumps(full_model_json))
        compressed_json_bytes = len(json.dumps(model_json))
        (ARTIFACT_DIR_V2 / "model.json").write_text(json.dumps(model_json, default=str), encoding="utf-8")
        print(
            f"\nExported LightGBM model JSON to {ARTIFACT_DIR_V2 / 'model.json'} "
            f"({PRODUCTION_N_TREES} trees, {PRODUCTION_ROUND_SIG_FIGS} sig figs, "
            f"{compressed_json_bytes:,} bytes, was {full_json_bytes:,} bytes uncompressed = "
            f"-{(1 - compressed_json_bytes / full_json_bytes) * 100:.0f}%)"
        )

        prep = production_pipe.named_steps["prep"]

        def predict_fn(X: pd.DataFrame) -> np.ndarray:
            X_t = prep.transform(X).to_numpy(dtype=float)
            return _predict_custom(compressed_booster, X_t)

        resid_all_log = df["log_price_per_sqm"].values - predict_fn(df[restricted_features])
        production_smear = float(np.mean(np.exp(resid_all_log)))
    else:
        joblib.dump(production_pipe, ARTIFACT_DIR_V2 / "model.joblib")
        print(f"\nChosen model ({restricted_chosen}) is not LightGBM; saved joblib pipeline instead (no portable JSON exporter implemented for this family).")
        predict_fn = production_pipe.predict
        resid_all_log = df["log_price_per_sqm"].values - production_pipe.predict(df[restricted_features])
        production_smear = float(np.mean(np.exp(resid_all_log)))
        full_json_bytes = compressed_json_bytes = None

    fixtures = build_parity_fixtures(
        predict_fn, df, restricted_features, conformal["q_per_area_log"], conformal["q_overall_log"], production_smear
    )
    (ARTIFACT_DIR_V2 / "parity_fixtures.json").write_text(json.dumps(fixtures, indent=2, default=str, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(fixtures)} parity fixtures to {ARTIFACT_DIR_V2 / 'parity_fixtures.json'}")

    print("\nBuilding task 4d driver effects (product-facing, product-input-restricted)...")
    driver_effects = build_driver_effects(df, ols_model, balcony_area_effects, elevator_area_effects)
    (ARTIFACT_DIR_V2 / "effects.json").write_text(json.dumps(driver_effects, indent=2, default=str, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(driver_effects['effects'])} driver effects to {ARTIFACT_DIR_V2 / 'effects.json'}")
    for e in driver_effects["effects"]:
        area_note = f" [{e['omrade']}]" if e["omrade"] else ""
        print(f"  {e['id']}{area_note}: {e['effekt_procent']:+.2f}% (CI [{e['ci_low_procent']:+.2f}%, {e['ci_high_procent']:+.2f}%]) n={e['n']} sig={e['signifikant']}")

    metadata_v2 = {
        "version": "valuation-v2",
        "trained_at": pd.Timestamp.now().isoformat(),
        "data_period": DATA_PERIOD,
        "today_reference": "not used -- month/time feature dropped from the restricted feature set (product supplies no date at inference); model has no time dependence",
        "n_rows_used_for_training": load_meta["n_final_rows"],
        "n_unmapped_omrade": load_meta["n_unmapped_omrade"],
        "chosen_model": restricted_chosen,
        "mape_margin_pp": MAPE_MARGIN_PP,
        "cv_results": restricted_cv,
        "time_split_results": restricted_time,
        "full_vs_restricted_mape_gap_pp_cv": mape_gap,
        "full_feature_set_cv_for_comparison": {full_chosen: full_cv[full_chosen]},
        "model_size_experiment": size_experiment,
        "conformal_interval_evaluation": conformal,
        "production_model": {
            "file": "model.json" if restricted_chosen == "lightgbm" else "model.joblib",
            "smearing_factor": production_smear,
            "back_transform": "predicted_total_price = exp(model_log_pred) * smearing_factor * living_area",
            "interval": "predicted_total_price bounds = exp(model_log_pred +/- q_log_for_area) * smearing_factor * living_area; q_log_for_area from conformal_interval_evaluation.q_per_area_log, falling back to q_overall_log for areas/unmapped postnummer not in that table",
            "compression": {
                "applied": restricted_chosen == "lightgbm",
                "n_trees": PRODUCTION_N_TREES if restricted_chosen == "lightgbm" else None,
                "n_trees_full": 400,
                "round_sig_figs": PRODUCTION_ROUND_SIG_FIGS if restricted_chosen == "lightgbm" else None,
                "json_bytes_compressed": compressed_json_bytes,
                "json_bytes_uncompressed": full_json_bytes,
                "measured_mape_cost_pp": size_experiment["variants"]["rounded_6sigfig_300_trees"]["mape_delta_pp_vs_baseline"] if size_experiment else None,
                "measured_on": "the independent Jan-Jun-trained/Jul-Aug-tested time-split model (see model_size_experiment above), not this exact all-data production model -- see MODEL_CARD.md for why",
            },
        },
        "features": {
            "numeric": RESTRICTED_NUMERIC_FEATURES,
            "missing_indicators": RESTRICTED_MISSING_INDICATOR_FEATURES,
            "categorical": CATEGORICAL_FEATURES,
            "dropped_vs_full": ["building_storeys_clean", "building_storeys_missing", "month_num"],
            "dropped_reason": "product cannot supply building_storeys or a transaction/valuation date at inference (see brief item 6)",
        },
        "excluded_features": ["utgangspris (not present in this file; would be leakage if it were)"],
        "random_state": RANDOM_STATE,
    }
    (ARTIFACT_DIR_V2 / "metadata.json").write_text(json.dumps(metadata_v2, indent=2, default=str), encoding="utf-8")

    print(f"\nv1 artefact (refreshed) written to {ARTIFACT_DIR_V1}")
    print(f"v2 artefact (production, restricted features) written to {ARTIFACT_DIR_V2}")


if __name__ == "__main__":
    main()
