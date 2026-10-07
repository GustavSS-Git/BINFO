"""Shared building blocks for valuation-v3 (ml/train_valuation_v3.py).

Kept separate from ml/train_valuation.py so the v2 pipeline stays reproducible
byte-for-byte. Re-uses its data loading, metrics and tree-export helpers.
Pure functions here are unit-tested in ml/tests/test_valuation_v3.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

import train_valuation as t

RANDOM_STATE = t.RANDOM_STATE
N_SPLITS = t.N_SPLITS

# v3 RESTRICTED: monthly_fee_clean dropped (collinear with fee_per_sqm * living_area);
# fee_per_sqm + monthly_fee_missing kept.
V3_NUMERIC = ["living_area", "number_of_rooms", "apartment_floor_clean", "build_year_clean", "fee_per_sqm"]
V3_MISSING = ["apartment_floor_missing", "build_year_missing", "monthly_fee_missing"]
V3_CATEGORICAL = ["omrade", "elevator_clean", "balcony_clean"]
PC_FEATURE = "postcode_delta"

# General (no-location) model: same minus omrade
GEN_NUMERIC = V3_NUMERIC
GEN_MISSING = V3_MISSING
GEN_CATEGORICAL = ["elevator_clean", "balcony_clean"]

DEFAULT_LGBM = dict(n_estimators=300, num_leaves=31, learning_rate=0.05)


@dataclass
class Cfg:
    """One model configuration."""

    numeric: list[str] = field(default_factory=lambda: list(V3_NUMERIC))
    missing: list[str] = field(default_factory=lambda: list(V3_MISSING))
    categorical: list[str] = field(default_factory=lambda: list(V3_CATEGORICAL))
    params: dict = field(default_factory=lambda: dict(DEFAULT_LGBM))
    pc: tuple[str, float] | None = None  # (mode 'raw'|'resid', shrinkage k) or None
    target: str = "log_price_per_sqm"
    # monotone constraints by OUTPUT column name, e.g. {"cat__elevator_clean_nej": -1}
    monotone: dict = field(default_factory=dict)

    @property
    def all_numeric(self) -> list[str]:
        return self.numeric + ([PC_FEATURE] if self.pc else [])

    @property
    def feature_cols(self) -> list[str]:
        return self.all_numeric + self.missing + self.categorical


def make_pipe(cfg: Cfg) -> Pipeline:
    num = Pipeline([("impute", SimpleImputer(strategy="median"))])
    cat = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )
    transformers = [("num", num, cfg.all_numeric), ("ind", "passthrough", cfg.missing)]
    if cfg.categorical:
        transformers.append(("cat", cat, cfg.categorical))
    ct = ColumnTransformer(transformers)
    ct.set_output(transform="pandas")
    params = {**cfg.params}
    model = LGBMRegressor(random_state=RANDOM_STATE, verbosity=-1, **params)
    return Pipeline([("prep", ct), ("model", model)])


# ---------------------------------------------------------------------------
# postcode target encoding (shrunk, out-of-fold for training rows)
# ---------------------------------------------------------------------------
def postcode_table(df: pd.DataFrame, values: np.ndarray, k: float) -> dict[str, float]:
    """postnummer -> n/(n+k) * mean(values over rows with that postnummer).
    `values` is already centred (area-mean-subtracted log price, or model residual), so
    shrinking toward 0 is shrinking toward the omrade level. Null postnummer ignored."""
    s = pd.DataFrame({"pc": df["postal_code_clean"].values, "v": values}).dropna(subset=["pc"])
    g = s.groupby("pc")["v"].agg(["sum", "count"])
    return {pc: float(r["sum"] / (r["count"] + k)) for pc, r in g.iterrows()}  # == n/(n+k)*mean


def apply_table(df: pd.DataFrame, table: dict[str, float]) -> np.ndarray:
    return df["postal_code_clean"].map(table).fillna(0.0).to_numpy(dtype=float)


def centred_log_price(train: pd.DataFrame) -> np.ndarray:
    """log ppsm minus the training mean log ppsm of the row's omrade."""
    m = train.groupby("omrade")["log_price_per_sqm"].transform("mean")
    return (train["log_price_per_sqm"] - m).to_numpy()


def base_cfg_without_pc(cfg: Cfg) -> Cfg:
    return Cfg(cfg.numeric, cfg.missing, cfg.categorical, dict(cfg.params), None, cfg.target, dict(cfg.monotone))


def oof_values_for_pc(train: pd.DataFrame, cfg: Cfg, inner_splits: int = 5) -> np.ndarray:
    """The per-row value that gets target-encoded: 'raw' = area-centred log price;
    'resid' = out-of-fold residual of the same model WITHOUT the postcode feature."""
    mode, _ = cfg.pc
    if mode == "raw":
        return centred_log_price(train)
    base = base_cfg_without_pc(cfg)
    y = train["log_price_per_sqm"].to_numpy()
    oof = np.zeros(len(train))
    kf = KFold(n_splits=inner_splits, shuffle=True, random_state=RANDOM_STATE + 1)
    for tr, va in kf.split(train):
        p = make_pipe(base)
        p.fit(train.iloc[tr][base.feature_cols], y[tr])
        oof[va] = p.predict(train.iloc[va][base.feature_cols])
    return y - oof


def encode_train_and_table(train: pd.DataFrame, cfg: Cfg, inner_splits: int = 5) -> tuple[np.ndarray, dict[str, float]]:
    """(out-of-fold deltas for the training rows, full-train lookup table for inference)."""
    _, k = cfg.pc
    values = oof_values_for_pc(train, cfg, inner_splits)
    table = postcode_table(train, values, k)
    oof = np.zeros(len(train))
    kf = KFold(n_splits=inner_splits, shuffle=True, random_state=RANDOM_STATE + 2)
    for tr, va in kf.split(train):
        tab = postcode_table(train.iloc[tr], values[tr], k)
        oof[va] = apply_table(train.iloc[va], tab)
    return oof, table


# ---------------------------------------------------------------------------
# fit / predict
# ---------------------------------------------------------------------------
@dataclass
class Fitted:
    pipe: Pipeline
    cfg: Cfg
    smear: float
    pc_table: dict[str, float] | None

    def predict_log(self, df: pd.DataFrame) -> np.ndarray:
        d = df
        if self.cfg.pc:
            d = df.copy()
            d[PC_FEATURE] = apply_table(df, self.pc_table)
        return self.pipe.predict(d[self.cfg.feature_cols])


def fit(train: pd.DataFrame, cfg: Cfg) -> Fitted:
    d = train
    table = None
    if cfg.pc:
        d = train.copy()
        d[PC_FEATURE], table = encode_train_and_table(train, cfg)
    pipe = make_pipe(cfg)
    y = d[cfg.target].to_numpy()
    if cfg.monotone:
        prep, model = pipe.named_steps["prep"], pipe.named_steps["model"]
        Xt = prep.fit_transform(d[cfg.feature_cols])
        names = list(Xt.columns)
        unknown = set(cfg.monotone) - set(names)
        if unknown:
            raise ValueError(f"monotone constraint on unknown columns: {unknown}")
        model.set_params(monotone_constraints=[int(cfg.monotone.get(n, 0)) for n in names], monotone_constraints_method="basic")
        model.fit(Xt, y)
    else:
        pipe.fit(d[cfg.feature_cols], y)
    smear = float(np.mean(np.exp(y - pipe.predict(d[cfg.feature_cols]))))
    return Fitted(pipe, cfg, smear, table)


def predict_total(f: Fitted, df: pd.DataFrame) -> np.ndarray:
    return np.exp(f.predict_log(df)) * f.smear * df["living_area"].to_numpy()


def cv_predictions(df: pd.DataFrame, cfg: Cfg) -> np.ndarray:
    kf = KFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_STATE)
    out = np.zeros(len(df))
    for tr, te in kf.split(df):
        f = fit(df.iloc[tr], cfg)
        out[te] = predict_total(f, df.iloc[te])
    return out


def score(df: pd.DataFrame, pred_total: np.ndarray) -> dict:
    y = df["total_price"].to_numpy()
    return {
        "n": int(len(df)),
        "mae": t.mae(y, pred_total),
        "mape": t.mape(y, pred_total),
        "per_area": t.per_area_metrics(y, pred_total, df["omrade"].to_numpy()),
    }


def cv_score(df: pd.DataFrame, cfg: Cfg) -> dict:
    return score(df, cv_predictions(df, cfg))


def time_split_score(df: pd.DataFrame, cfg: Cfg, train_max_month: int = 6) -> dict:
    train, test = df[df["month_num"] <= train_max_month], df[df["month_num"] > train_max_month]
    f = fit(train, cfg)
    s = score(test, predict_total(f, test))
    s["n_train"] = int(len(train))
    return s


# ---------------------------------------------------------------------------
# conformal (same method as v2: train Jan-May, calibrate per area on June, test Jul-Aug)
# ---------------------------------------------------------------------------
def conformal_v3(df: pd.DataFrame, cfg: Cfg) -> dict:
    train, calib, test = df[df["month_num"] <= 5], df[df["month_num"] == 6], df[df["month_num"] >= 7]
    f = fit(train, cfg)
    alpha = 1 - t.CONFORMAL_COVERAGE_TARGET
    calib_res = calib["log_price_per_sqm"].to_numpy() - f.predict_log(calib)
    q_overall = float(np.quantile(np.abs(calib_res), 1 - alpha))
    q_area: dict[str, dict] = {}
    for area in sorted(calib["omrade"].unique()):
        mask = calib["omrade"].to_numpy() == area
        n = int(mask.sum())
        if n >= t.AREA_CALIB_MIN_N:
            q_area[area] = {"q_log": float(np.quantile(np.abs(calib_res[mask]), 1 - alpha)), "n_calib": n, "used": "area_specific"}
        else:
            q_area[area] = {"q_log": q_overall, "n_calib": n, "used": "pooled_fallback"}
    pred_log = f.predict_log(test)
    q_used = np.array([q_area.get(a, {"q_log": q_overall})["q_log"] for a in test["omrade"]])
    y = test["total_price"].to_numpy()
    la = test["living_area"].to_numpy()
    lo = np.exp(pred_log - q_used) * f.smear * la
    hi = np.exp(pred_log + q_used) * f.smear * la
    cov = (y >= lo) & (y <= hi)
    per_area = {}
    for area in sorted(set(test["omrade"])):
        m = test["omrade"].to_numpy() == area
        per_area[area] = {
            "n_test": int(m.sum()),
            "empirical_coverage": float(cov[m].mean()),
            "q_log": float(q_used[m][0]),
            "q_source": q_area.get(area, {"used": "pooled_fallback"})["used"],
        }
    return {
        "method": "time+area-aware split conformal on log(price_per_sqm): train Jan-May, calibrate q per area on June (>=30 rows) else pooled June q, coverage on held-out Jul-Aug",
        "target_coverage": t.CONFORMAL_COVERAGE_TARGET,
        "n_train": int(len(train)),
        "n_calib": int(len(calib)),
        "n_test": int(len(test)),
        "q_overall_log": q_overall,
        "smearing_factor_jan_may_model": f.smear,
        "empirical_coverage_overall": float(cov.mean()),
        "mape_jul_aug_jan_may_model": t.mape(y, np.exp(pred_log) * f.smear * la),
        "per_area": per_area,
        "q_per_area_log": {a: v["q_log"] for a, v in q_area.items()},
        "q_per_area_source": {a: v["used"] for a, v in q_area.items()},
    }


# ---------------------------------------------------------------------------
# random search (seeded)
# ---------------------------------------------------------------------------
SEARCH_SPACE = {
    "num_leaves": [8, 12, 16, 24, 31],
    "min_child_samples": [5, 10, 20, 30, 50],
    "learning_rate": [0.03, 0.05, 0.08, 0.1],
    "n_estimators": [150, 200, 250, 300],
    "reg_lambda": [0.0, 1.0, 5.0, 10.0, 30.0],
    "colsample_bytree": [0.6, 0.8, 1.0],
    "subsample": [0.7, 0.85, 1.0],
    "max_depth": [-1, 4, 6, 8],
}


def sample_configs(n: int, seed: int = RANDOM_STATE) -> list[dict]:
    rng = np.random.default_rng(seed)
    out, seen = [], set()
    while len(out) < n:
        c = {k: (v[int(rng.integers(len(v)))]) for k, v in SEARCH_SPACE.items()}
        c = {k: (float(x) if isinstance(x, (np.floating, float)) else int(x)) for k, x in c.items()}
        if c["subsample"] < 1.0:
            c["subsample_freq"] = 1
        key = tuple(sorted(c.items()))
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


# ---------------------------------------------------------------------------
# general (no-location) relationships model: r(x)
# ---------------------------------------------------------------------------
def area_relative_target(train: pd.DataFrame, min_n: int = t.AREA_CALIB_MIN_N) -> pd.DataFrame:
    """Adds `rel_log` = log(ppsm / mean ppsm of the row's omrade) computed on `train`
    (arithmetic mean of ppsm per omrade, matching a published 'average'). Rows in
    omrade 'Okänt' or with fewer than min_n rows in `train` are dropped."""
    d = train[~train["omrade"].str.startswith("Okänt")].copy()
    cnt = d.groupby("omrade")["omrade"].transform("size")
    d = d[cnt >= min_n].copy()
    mean_ppsm = d.groupby("omrade")["price_per_sq_meter"].transform("mean")
    d["rel_log"] = np.log(d["price_per_sq_meter"] / mean_ppsm)
    return d


def r_from_log(log_g: np.ndarray, smear: float, normaliser: float, lo: float | None = None, hi: float | None = None) -> np.ndarray:
    """r(x) = exp(g) * smear / normaliser, optionally clipped to [lo, hi]."""
    r = np.exp(log_g) * smear / normaliser
    if lo is not None and hi is not None:
        r = np.clip(r, lo, hi)
    return r
