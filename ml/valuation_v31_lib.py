"""Building blocks for valuation-v3.1 (ml/train_valuation_v31.py).

v3.1 changes ONE thing relative to v3 (ml/valuation_v3_lib.py, untouched): how the
`postcode_delta` feature is computed. Everything else (features, LightGBM, tuning protocol,
smearing, conformal method, effects, general model) is re-used from v3.

v3 encoding:   delta[p] = sum_{i in p} v_i / (n_p + k),  k = 0.5   (a single sale moves its postcode
               by 2/3 of its deviation from the omrade mean).
v3.1 encoding: PcSpec(k, n_min, prior, k_group, unseen):
  - `prior = "omrade"`: shrink toward 0 (= the omrade mean), as v3, but with k and n_min configurable;
  - `prior = "p3" | "p4"`: hierarchical. group delta g = sum_{i in prefix} v_i / (n_group + k_group)
    (shrunk toward the omrade mean), postcode delta = g + sum_{i in p} (v_i - g) / (n_p + k);
  - `n_min`: a postcode with fewer than n_min training sales gets its group delta (0 for prior "omrade");
  - `unseen = "prefix"`: a postcode with no training sale gets its group delta instead of 0.
Pure functions here are unit-tested in ml/tests/test_valuation_v31.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

import train_valuation as t
import valuation_v3_lib as L

RANDOM_STATE = L.RANDOM_STATE
N_SPLITS = L.N_SPLITS
PC_FEATURE = L.PC_FEATURE


@dataclass(frozen=True)
class PcSpec:
    k: float = 0.5
    n_min: int = 0
    prior: str = "omrade"  # "omrade" | "p3" | "p4"
    k_group: float = 5.0
    unseen: str = "zero"  # "zero" | "prefix"

    @property
    def group_len(self) -> int | None:
        return {"omrade": None, "p3": 3, "p4": 4}[self.prior]

    def label(self) -> str:
        s = f"k={self.k:g}"
        if self.n_min:
            s += f",nmin={self.n_min}"
        if self.prior != "omrade":
            s += f",{self.prior}(kg={self.k_group:g})"
            if self.unseen == "prefix":
                s += ",unseen->prefix"
        return s


V3_SPEC = PcSpec(k=0.5)


def prefixes(pcs: pd.Series, length: int) -> pd.Series:
    return pcs.str[:length]


@dataclass
class Encoder:
    spec: PcSpec
    n_pc: dict[str, int]
    sum_pc: dict[str, float]
    group: dict[str, float]  # prefix -> group delta (empty for prior "omrade")

    def group_delta(self, pc: str | None) -> float:
        if self.spec.group_len is None or not isinstance(pc, str):
            return 0.0
        return self.group.get(pc[: self.spec.group_len], 0.0)

    def delta_one(self, pc: str | None) -> float:
        if not isinstance(pc, str):
            return 0.0
        n = self.n_pc.get(pc, 0)
        g = self.group_delta(pc)
        if n == 0:
            return g if self.spec.unseen == "prefix" else 0.0
        if n < self.spec.n_min:
            return g
        return g + (self.sum_pc[pc] - n * g) / (n + self.spec.k)

    def delta(self, pcs: pd.Series) -> np.ndarray:
        return np.array([self.delta_one(p) for p in pcs.to_numpy()], dtype=float)

    def table(self) -> dict[str, float]:
        """postnummer -> delta for every postnummer seen in training (what ships)."""
        return {p: self.delta_one(p) for p in self.n_pc}


def fit_encoder(df: pd.DataFrame, values: np.ndarray, spec: PcSpec) -> Encoder:
    s = pd.DataFrame({"pc": df["postal_code_clean"].values, "v": values}).dropna(subset=["pc"])
    g = s.groupby("pc")["v"].agg(["sum", "count"])
    n_pc = {p: int(c) for p, c in g["count"].items()}
    sum_pc = {p: float(x) for p, x in g["sum"].items()}
    group: dict[str, float] = {}
    if spec.group_len is not None:
        s["g"] = s["pc"].str[: spec.group_len]
        gg = s.groupby("g")["v"].agg(["sum", "count"])
        group = {p: float(r["sum"] / (r["count"] + spec.k_group)) for p, r in gg.iterrows()}
    return Encoder(spec, n_pc, sum_pc, group)


def encode_train_and_encoder(train: pd.DataFrame, spec: PcSpec, inner_splits: int = 5) -> tuple[np.ndarray, Encoder]:
    """(out-of-fold deltas for the training rows, full-train encoder). Same inner folds as v3."""
    from sklearn.model_selection import KFold

    values = L.centred_log_price(train)
    enc = fit_encoder(train, values, spec)
    oof = np.zeros(len(train))
    kf = KFold(n_splits=inner_splits, shuffle=True, random_state=RANDOM_STATE + 2)
    for tr, va in kf.split(train):
        e = fit_encoder(train.iloc[tr], values[tr], spec)
        oof[va] = e.delta(train.iloc[va]["postal_code_clean"])
    return oof, enc


# ---------------------------------------------------------------------------
@dataclass
class Fitted31:
    pipe: object
    cfg: L.Cfg
    smear: float
    enc: Encoder | None

    def predict_log(self, df: pd.DataFrame, delta: np.ndarray | None = None) -> np.ndarray:
        d = df
        if self.cfg.pc:
            d = df.copy()
            d[PC_FEATURE] = self.enc.delta(df["postal_code_clean"]) if delta is None else delta
        return self.pipe.predict(d[self.cfg.feature_cols])


def fit31(train: pd.DataFrame, spec: PcSpec | None, params: dict | None = None) -> Fitted31:
    cfg = L.Cfg(params=dict(params or L.DEFAULT_LGBM), pc=("raw", spec.k) if spec else None)
    d, enc = train, None
    if spec:
        d = train.copy()
        d[PC_FEATURE], enc = encode_train_and_encoder(train, spec)
    pipe = L.make_pipe(cfg)
    y = d[cfg.target].to_numpy()
    pipe.fit(d[cfg.feature_cols], y)
    smear = float(np.mean(np.exp(y - pipe.predict(d[cfg.feature_cols]))))
    return Fitted31(pipe, cfg, smear, enc)


def predict_total31(f: Fitted31, df: pd.DataFrame, delta: np.ndarray | None = None) -> np.ndarray:
    return np.exp(f.predict_log(df, delta)) * f.smear * df["living_area"].to_numpy()


def n_train_of(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    vc = train["postal_code_clean"].value_counts()
    return test["postal_code_clean"].map(vc).fillna(0).to_numpy(dtype=int)


STRATA = [("0", 0, 0), ("1", 1, 1), ("2", 2, 2), ("3-5", 3, 5), ("6+", 6, 10**9)]


def stratum_masks(n: np.ndarray) -> dict[str, np.ndarray]:
    return {name: (n >= lo) & (n <= hi) for name, lo, hi in STRATA}


def ape(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.abs(p - y) / y


def simulate_sparse(
    f: Fitted31,
    train: pd.DataFrame,
    test: pd.DataFrame,
    m: int,
    min_n_train: int,
    seeds: int = 5,
) -> dict:
    """Simulate a buyer in a postcode with only `m` training sales: for test rows whose postcode has
    >= min_n_train training sales, re-derive the delta from only m randomly chosen training sales of
    that postcode (the group/prefix delta is recomputed WITHOUT the postcode's other sales) and predict
    with the same fitted model. Returns per-draw averaged errors plus the same rows with the full-n
    delta and with delta=0 for reference."""
    spec = f.enc.spec
    values = L.centred_log_price(train)
    pc = train["postal_code_clean"].to_numpy()
    cnt = train["postal_code_clean"].value_counts()
    rows = test[test["postal_code_clean"].map(cnt).fillna(0) >= min_n_train]
    if len(rows) == 0:
        return {"n_rows": 0}
    y = rows["total_price"].to_numpy()
    full = predict_total31(f, rows)
    zero = predict_total31(f, rows, np.zeros(len(rows)))
    la = rows["living_area"].to_numpy()
    apes, signed, deltas = [], [], []
    for s in range(seeds):
        rng = np.random.default_rng(RANDOM_STATE + 1000 * m + s)
        d_sim = {}
        for p in rows["postal_code_clean"].unique():
            idx = np.where(pc == p)[0]
            pick = rng.choice(idx, size=m, replace=False)
            keep = np.where(pc != p)[0]
            sub = np.concatenate([keep, pick])
            e = fit_encoder(train.iloc[sub], values[sub], spec)
            d_sim[p] = e.delta_one(p)
        dvec = rows["postal_code_clean"].map(d_sim).to_numpy(dtype=float)
        pred = np.exp(f.predict_log(rows, dvec)) * f.smear * la
        apes.append(ape(y, pred))
        signed.append(np.log(pred / y))
        deltas.append(np.abs(dvec))
    return {
        "n_rows": int(len(rows)),
        "n_postcodes": int(rows["postal_code_clean"].nunique()),
        "mape_sim": float(np.mean(apes) * 100),
        "mape_full_delta": float(ape(y, full).mean() * 100),
        "mape_zero_delta": float(ape(y, zero).mean() * 100),
        "mean_abs_log_err_sim": float(np.mean(np.abs(signed))),
        "mean_abs_delta_sim": float(np.mean(deltas)),
        "mean_abs_delta_full": float(np.abs(f.enc.delta(rows["postal_code_clean"])).mean()),
    }


# ---------------------------------------------------------------------------
# evaluation helpers (shared by the candidate grid and the final evaluation)
# ---------------------------------------------------------------------------
from sklearn.model_selection import GroupKFold, KFold  # noqa: E402


def _folds(df: pd.DataFrame, group: bool):
    if group:
        return list(GroupKFold(n_splits=N_SPLITS).split(df, groups=df["postal_code_clean"].fillna("NA")))
    return list(KFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_STATE).split(df))


def eval_split(train: pd.DataFrame, test: pd.DataFrame, spec: PcSpec | None, params: dict, sims: bool, min_n_sim: int = 6, sim_seeds: int = 3) -> dict:
    f = fit31(train, spec, params)
    out = {
        "idx": test.index.to_numpy(),
        "pred": predict_total31(f, test),
        "y": test["total_price"].to_numpy(),
        "ntr": n_train_of(train, test),
        "omrade": test["omrade"].to_numpy(),
    }
    if spec is not None and sims:
        out["sim1"] = simulate_sparse(f, train, test, 1, min_n_sim, seeds=sim_seeds)
        out["sim2"] = simulate_sparse(f, train, test, 2, min_n_sim, seeds=sim_seeds)
    return out


def cv_parts(df: pd.DataFrame, spec: PcSpec | None, params: dict, sims: bool = False, group: bool = False) -> list[dict]:
    return [eval_split(df.iloc[a], df.iloc[b], spec, params, sims) for a, b in _folds(df, group)]


def summarise(parts: list[dict]) -> dict:
    y = np.concatenate([p["y"] for p in parts])
    pr = np.concatenate([p["pred"] for p in parts])
    n = np.concatenate([p["ntr"] for p in parts])
    om = np.concatenate([p["omrade"] for p in parts])
    res: dict = {
        "n": int(len(y)),
        "mape": t.mape(y, pr),
        "mae": t.mae(y, pr),
        "per_area": t.per_area_metrics(y, pr, om),
        "strata_by_training_n": {},
    }
    for name, m in stratum_masks(n).items():
        res["strata_by_training_n"][name] = {"n": int(m.sum()), "mape": t.mape(y[m], pr[m]) if m.any() else None}
    for key in ("sim1", "sim2"):
        if key in parts[0]:
            ps = [p[key] for p in parts if p[key].get("n_rows")]
            w = np.array([p["n_rows"] for p in ps], float)
            res[key] = {k: float(np.average([p[k] for p in ps], weights=w)) for k in ("mape_sim", "mape_full_delta", "mape_zero_delta", "mean_abs_delta_sim", "mean_abs_delta_full")}
            res[key]["n_rows"] = int(w.sum())
    return res


def conformal31(df: pd.DataFrame, spec: PcSpec | None, params: dict) -> dict:
    """Same method as v3 `conformal_v3` (train Jan-May, calibrate q per area on June, test Jul-Aug)
    for a PcSpec model; adds coverage by training-n stratum of the test row's postnummer."""
    train, calib, test = df[df["month_num"] <= 5], df[df["month_num"] == 6], df[df["month_num"] >= 7]
    f = fit31(train, spec, params)
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
    y, la = test["total_price"].to_numpy(), test["living_area"].to_numpy()
    lo = np.exp(pred_log - q_used) * f.smear * la
    hi = np.exp(pred_log + q_used) * f.smear * la
    cov = (y >= lo) & (y <= hi)
    per_area = {}
    for area in sorted(set(test["omrade"])):
        m = test["omrade"].to_numpy() == area
        per_area[area] = {"n_test": int(m.sum()), "empirical_coverage": float(cov[m].mean()), "q_log": float(q_used[m][0]), "q_source": q_area.get(area, {"used": "pooled_fallback"})["used"]}
    ntr = n_train_of(train, test)
    by_stratum = {name: {"n": int(m.sum()), "coverage": float(cov[m].mean()) if m.any() else None} for name, m in stratum_masks(ntr).items()}
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
        "coverage_by_training_n_stratum": by_stratum,
        "per_area": per_area,
        "q_per_area_log": {a: v["q_log"] for a, v in q_area.items()},
        "q_per_area_source": {a: v["used"] for a, v in q_area.items()},
    }


def shipped_delta(pc: str | None, table: dict[str, float], prefix_table: dict[str, float], prefix_len: int) -> float:
    """The inference rule the TypeScript side implements from postcode_encoding.json:
    seen postnummer -> table[pc]; else prefix_table[pc[:prefix_len]]; else 0.0."""
    if not isinstance(pc, str):
        return 0.0
    if pc in table:
        return table[pc]
    return prefix_table.get(pc[:prefix_len], 0.0)
