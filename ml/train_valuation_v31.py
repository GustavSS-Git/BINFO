"""valuation-v3.1: re-evaluates the postnummer encoding of valuation-v3 and exports the winner.

What changes vs v3 (ml/train_valuation_v3.py, untouched): ONLY how `postcode_delta` is computed
(see ml/valuation_v31_lib.py). Features, LightGBM, tuning protocol (40-config seeded random search,
selection on Jan-Jun 5-fold CV, adopt if Jul-Aug improves), smearing, conformal method and effects are
v3's. The general (non-Stockholm) model does not use the postnummer and is copied unchanged from v3.

Run: ml/.venv/bin/python ml/train_valuation_v31.py        (about 25-30 minutes on 8 cores)
Writes ml/artifacts/valuation-v3.1/ only. Seeded (RANDOM_STATE=42); LightGBM n_jobs=1 everywhere.

Candidate selection rule (fixed before the final numbers, uses Jan-Jun data only):
  1. keep candidates whose Jan-Jun 5-fold CV MAPE is within SELECT_CV_TOL_PP of the best candidate;
  2. among those, take the lowest Jan-Jun postnummer-grouped CV MAPE (all sales of a postnummer held
     out together = a postnummer the model has never seen);
  Jul-Aug, the full-data CV and the simulations are reported, not used for the choice.
"""

from __future__ import annotations

import json
import shutil
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train_valuation as t  # noqa: E402
import train_valuation_v3 as T3  # noqa: E402  (export helpers only; its main() is not run)
import valuation_v3_lib as L  # noqa: E402
import valuation_v31_lib as V  # noqa: E402
from valuation_v31_lib import PcSpec  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "ml" / "artifacts" / "valuation-v3"
OUT = ROOT / "ml" / "artifacts" / "valuation-v3.1"
VERSION = "valuation-v3.1"
RAND = L.RANDOM_STATE
N_JOBS = 8
N_SEARCH = 40
SELECT_CV_TOL_PP = 0.10
PREFIX_LEN = 4
SIZE_LIMIT_MAIN = 3_500_000
THREAD = {"n_jobs": 1}  # LightGBM threads inside each fit (parallelism is across fits)


def P(params: dict | None = None) -> dict:
    return {**(params or L.DEFAULT_LGBM), **THREAD}


def clean(params: dict) -> dict:
    return {k: v for k, v in params.items() if k != "n_jobs"}


def candidates() -> list[PcSpec | None]:
    c: list[PcSpec | None] = [None, V.V3_SPEC]
    for k in [2, 5, 10, 20]:
        c.append(PcSpec(k=k))
    for nm in [2, 3, 5]:
        for k in [0.5, 2, 5]:
            c.append(PcSpec(k=k, n_min=nm))
    for kg in [5, 20]:
        for k in [2, 5, 10]:
            c.append(PcSpec(k=k, prior="p3", k_group=kg, unseen="prefix"))
    for k in [0.5, 1, 2, 3, 5]:
        for kg in [5, 20, 50]:
            c.append(PcSpec(k=k, prior="p4", k_group=kg, unseen="prefix"))
    for k in [2, 5]:  # the hierarchy alone, without the prefix fallback for unseen postnummer
        c.append(PcSpec(k=k, prior="p4", k_group=5, unseen="zero"))
    for nm in [2, 3]:
        c.append(PcSpec(k=5, n_min=nm, prior="p4", k_group=5, unseen="prefix"))
    return c


def spec_dict(s: PcSpec | None) -> dict | None:
    return None if s is None else {"k": s.k, "n_min": s.n_min, "prior": s.prior, "k_group": s.k_group, "unseen": s.unseen}


def label(s: PcSpec | None) -> str:
    return "no postcode feature" if s is None else s.label()


def evaluate_candidate(spec: PcSpec | None) -> dict:
    """All views for one candidate at v3's DEFAULT LightGBM params (as v3 did for its k selection)."""
    warnings.filterwarnings("ignore")
    df, _ = t.load_data()
    jj = df[df["month_num"] <= 6]
    tr, te = jj, df[df["month_num"] >= 7]
    p = P()
    r = {
        "spec": spec_dict(spec),
        "label": label(spec),
        "janjun_cv": V.summarise(V.cv_parts(jj, spec, p, sims=True)),
        "janjun_group_cv": V.summarise(V.cv_parts(jj, spec, p, group=True)),
        "full_cv": V.summarise(V.cv_parts(df, spec, p, sims=True)),
        "full_group_cv": V.summarise(V.cv_parts(df, spec, p, group=True)),
        "time_split": V.summarise([V.eval_split(tr, te, spec, p, sims=True)]),
    }
    r["conformal"] = V.conformal31(df, spec, p)
    return r


def pick(results: list[dict]) -> dict:
    best = min(r["janjun_cv"]["mape"] for r in results)
    ok = [r for r in results if r["janjun_cv"]["mape"] <= best + SELECT_CV_TOL_PP]
    return min(ok, key=lambda r: r["janjun_group_cv"]["mape"])


def slim(r: dict) -> dict:
    """Drop the bulky per-area tables from the grid rows (final models keep them)."""
    out = {k: v for k, v in r.items() if k not in ("conformal",)}
    for key in ("janjun_cv", "janjun_group_cv", "full_cv", "full_group_cv", "time_split"):
        out[key] = {k: v for k, v in r[key].items() if k != "per_area"}
    c = r["conformal"]
    out["conformal"] = {k: c[k] for k in ("empirical_coverage_overall", "q_overall_log", "n_test", "mape_jul_aug_jan_may_model", "coverage_by_training_n_stratum")}
    return out


def tune(spec: PcSpec, jan_jun: pd.DataFrame) -> list[dict]:
    configs = L.sample_configs(N_SEARCH)

    def one(i_p):
        i, p = i_p
        warnings.filterwarnings("ignore")
        parts = V.cv_parts(jan_jun, spec, P(p))
        return {"i": i, "params": p, "janjun_cv_mape": V.summarise(parts)["mape"]}

    rows = Parallel(n_jobs=N_JOBS)(delayed(one)(x) for x in enumerate(configs))
    return sorted(rows, key=lambda r: r["janjun_cv_mape"])


def full_view(df: pd.DataFrame, spec: PcSpec | None, params: dict) -> dict:
    p = P(params)
    tr, te = df[df["month_num"] <= 6], df[df["month_num"] >= 7]
    return {
        "cv": V.summarise(V.cv_parts(df, spec, p, sims=True)),
        "group_cv": V.summarise(V.cv_parts(df, spec, p, group=True)),
        "time_split": V.summarise([V.eval_split(tr, te, spec, p, sims=True)]),
        "conformal": V.conformal31(df, spec, p),
    }


def custom_predict_log(model_json: dict, f: V.Fitted31, df: pd.DataFrame, delta: np.ndarray) -> np.ndarray:
    d = df.copy()
    d[V.PC_FEATURE] = delta
    X = f.pipe.named_steps["prep"].transform(d[f.cfg.feature_cols]).to_numpy(dtype=float)
    return t._predict_custom(model_json["lightgbm_booster"], X)


def main() -> None:
    warnings.filterwarnings("ignore")
    OUT.mkdir(parents=True, exist_ok=True)
    df, load_meta = t.load_data()
    jan_jun = df[df["month_num"] <= 6]
    v3meta = json.loads((SRC / "metadata.json").read_text(encoding="utf-8"))
    meta: dict = {
        "version": VERSION,
        "derived_from": "valuation-v3 (only the postcode_delta encoding differs; general model, effects method and conformal method are v3's)",
        "trained_at": pd.Timestamp.now().isoformat(),
        "data_period": t.DATA_PERIOD,
        "n_rows": int(len(df)),
        "months": {int(k): int(v) for k, v in df["month_num"].value_counts().sort_index().items()},
        "random_state": RAND,
        "cleaning_report": load_meta["cleaning_report"],
        "n_unmapped_omrade": load_meta["n_unmapped_omrade"],
        "excluded_features": ["utgangspris (not present in this file; would be leakage if it were)"],
    }

    # ---------------- 0. how thin is the postnummer evidence? ----------------
    vc = df["postal_code_clean"].value_counts()
    v3_table = json.loads((SRC / "postcode_encoding.json").read_text(encoding="utf-8"))["table"]
    dtab = pd.DataFrame({"delta": pd.Series(v3_table), "n": vc})
    dtab["abs"] = dtab["delta"].abs()
    dtab["bin"] = pd.cut(dtab["n"], [0, 1, 2, 3, 5, 10, 20, 10_000], labels=["1", "2", "3", "4-5", "6-10", "11-20", "21+"])
    meta["postcode_evidence"] = {
        "n_postnummer": int(len(vc)),
        "n_rows_with_postnummer": int(vc.sum()),
        "n_rows_without_postnummer": int(df["postal_code_clean"].isna().sum()),
        "n_per_postnummer_quantiles": {str(q): float(vc.quantile(q)) for q in [0, 0.25, 0.5, 0.75, 1]},
        "postnummer_with_n_le": {str(m): {"postnummer": int((vc <= m).sum()), "rows": int(vc[vc <= m].sum())} for m in [1, 2, 3, 5, 10]},
        "v3_abs_delta_by_n": {str(b): {"postnummer": int(g["abs"].count()), "mean": float(g["abs"].mean()), "median": float(g["abs"].median()), "max": float(g["abs"].max())} for b, g in dtab.groupby("bin", observed=True)},
        "v3_largest_abs_deltas": [{"postnummer": str(i), "delta": float(r["delta"]), "n": int(r["n"])} for i, r in dtab.sort_values("abs", ascending=False).head(15).iterrows()],
    }

    # ---------------- 1. candidate grid (default LightGBM params) ----------------
    print("[1] candidate grid: Jan-Jun CV, Jan-Jun grouped CV, full CV, full grouped CV, Jul-Aug, conformal, simulated 1-/2-sale")
    cands = candidates()
    results = Parallel(n_jobs=N_JOBS, verbose=3)(delayed(evaluate_candidate)(c) for c in cands)
    meta["candidate_grid"] = [slim(r) for r in results]
    chosen = pick([r for r in results if r["spec"] is not None])
    spec = PcSpec(**chosen["spec"])
    meta["selection"] = {
        "rule": f"candidates within {SELECT_CV_TOL_PP} pp of the best Jan-Jun 5-fold CV MAPE; among them the lowest Jan-Jun postnummer-grouped CV MAPE",
        "chosen": spec_dict(spec),
        "chosen_label": spec.label(),
        "best_janjun_cv_mape": min(r["janjun_cv"]["mape"] for r in results if r["spec"] is not None),
        "v3_janjun_cv_mape": next(r["janjun_cv"]["mape"] for r in results if r["spec"] == spec_dict(V.V3_SPEC)),
    }
    print("  chosen:", spec.label())

    # ---------------- 2. tuning (v3 protocol) ----------------
    print("[2] random search, 40 configs, selection on Jan-Jun CV")
    rows = tune(spec, jan_jun)
    best = rows[0]
    tr, te = df[df["month_num"] <= 6], df[df["month_num"] >= 7]
    d_ts = V.summarise([V.eval_split(tr, te, spec, P(), sims=False)])["mape"]
    t_ts = V.summarise([V.eval_split(tr, te, spec, P(best["params"]), sims=False)])["mape"]
    adopt = t_ts < d_ts
    params = best["params"] if adopt else dict(L.DEFAULT_LGBM)
    meta["tuning"] = {
        "n_configs": N_SEARCH,
        "seed": RAND,
        "search_space": L.SEARCH_SPACE,
        "default_params": L.DEFAULT_LGBM,
        "best_params": best["params"],
        "best_janjun_cv_mape": best["janjun_cv_mape"],
        "top5": rows[:5],
        "jul_aug": {"default": d_ts, "tuned": t_ts, "n_test": int(len(te))},
        "adopted": bool(adopt),
        "v3_params_for_reference": v3meta["tuning"]["final_feature_set"]["best_params"],
    }
    print(f"  Jul-Aug default {d_ts:.3f} / tuned {t_ts:.3f}, adopt={adopt}")

    # ---------------- 3. final evaluation: v3.1 vs v3 (both with their tuned params) ----------------
    print("[3] final evaluation")
    v3_params = v3meta["tuning"]["final_feature_set"]["best_params"] if v3meta["tuning"]["final_feature_set"]["adopted"] else dict(L.DEFAULT_LGBM)
    fin = full_view(df, spec, params)
    ref = full_view(df, V.V3_SPEC, v3_params)
    meta["final_model"] = {"params": params, "postcode_encoding": spec_dict(spec), **{k: fin[k] for k in ("cv", "group_cv", "time_split")}}
    meta["v3_reference_same_protocol"] = {"params": v3_params, "postcode_encoding": spec_dict(V.V3_SPEC), **{k: ref[k] for k in ("cv", "group_cv", "time_split")}}
    meta["conformal_interval_evaluation"] = fin["conformal"]
    meta["v3_reference_conformal"] = {k: ref["conformal"][k] for k in ("empirical_coverage_overall", "q_overall_log", "n_test", "mape_jul_aug_jan_may_model", "coverage_by_training_n_stratum")}
    meta["v2_per_area_cv"] = v3meta["v2_per_area_cv"]
    print(f"  v3.1: CV {fin['cv']['mape']:.3f}, Jul-Aug {fin['time_split']['mape']:.3f}, grouped CV {fin['group_cv']['mape']:.3f}, coverage {fin['conformal']['empirical_coverage_overall']:.3f}")
    print(f"  v3  : CV {ref['cv']['mape']:.3f}, Jul-Aug {ref['time_split']['mape']:.3f}, grouped CV {ref['group_cv']['mape']:.3f}, coverage {ref['conformal']['empirical_coverage_overall']:.3f}")

    # ---------------- 4. production fit + export ----------------
    print("[4] production fit + export")
    pparams = P(params)
    prod = V.fit31(df, spec, pparams)
    table = {k: round(v, 6) for k, v in sorted(prod.enc.table().items())}
    prefix_table = {k: round(v, 6) for k, v in sorted(prod.enc.group.items())}
    model_json = T3.export_model_json(prod, df)
    d_oof, _ = V.encode_train_and_encoder(df, spec)
    d_tr = df.copy()
    d_tr[V.PC_FEATURE] = d_oof
    X_tr = prod.pipe.named_steps["prep"].transform(d_tr[prod.cfg.feature_cols]).to_numpy(dtype=float)
    smear = float(np.mean(np.exp(df["log_price_per_sqm"].to_numpy() - t._predict_custom(model_json["lightgbm_booster"], X_tr))))
    model_bytes = len(json.dumps(model_json, default=str))
    assert model_bytes <= SIZE_LIMIT_MAIN, f"model.json {model_bytes} > {SIZE_LIMIT_MAIN}"
    (OUT / "model.json").write_text(json.dumps(model_json, default=str), encoding="utf-8")
    pc_json = {
        "feature": V.PC_FEATURE,
        "mode": "raw",
        "k_shrinkage": spec.k,
        "k_group_shrinkage": spec.k_group,
        "prefix_length": PREFIX_LEN,
        "fallback_for_unseen_or_missing_postnummer": 0.0,
        "definition": (
            "v_i = log(price_per_sqm_i) - mean log(price_per_sqm) of the row's omrade. "
            "prefix_table[q] = sum(v_i over training rows whose postnummer starts with the 4 digits q) / (n_q + k_group_shrinkage). "
            "table[p] (postnummer with >= 1 training sale) = g + sum(v_i - g over sales in p) / (n_p + k_shrinkage), g = prefix_table[p[:4]]. "
            "Inference: table[p] if p is in table; else prefix_table[p[:4]] if present; else fallback (0.0), which also applies to a missing postnummer. "
            "The booster was trained on OUT-OF-FOLD deltas (5 inner folds); inference uses these full-data tables."
        ),
        "n_postnummer": len(table),
        "n_prefix": len(prefix_table),
        "prefix_table": prefix_table,
        "table": table,
    }
    (OUT / "postcode_encoding.json").write_text(json.dumps(pc_json, ensure_ascii=False), encoding="utf-8")

    # fixtures (Stockholm): 50 rows + synthetic: unseen postnummer with a known 4-digit prefix, unseen prefix, missing postnummer
    q_area, q_overall = fin["conformal"]["q_per_area_log"], fin["conformal"]["q_overall_log"]
    sample = df.loc[T3.pick_fixture_rows(df)].copy()
    sample["_note"] = None
    syn_rows = []
    seen_row = sample[sample["postal_code_clean"].isin(table)].iloc[0]
    known_prefix = seen_row["postal_code_clean"][:PREFIX_LEN]
    unseen_same_prefix = next(f"{known_prefix}{d}" for d in "0123456789" if f"{known_prefix}{d}" not in table)
    for pcv, note in [
        (unseen_same_prefix, f"synthetic unseen postnummer {unseen_same_prefix}: not in table, prefix {known_prefix} in prefix_table -> postcode_delta = prefix_table[{known_prefix}]"),
        ("99999", "synthetic unseen postnummer 99999: neither in table nor prefix_table -> postcode_delta must fall back to 0"),
        (None, "synthetic missing postnummer -> postcode_delta must fall back to 0"),
    ]:
        r = sample.iloc[len(syn_rows) % 2].copy()
        r["postal_code_clean"], r["_note"] = pcv, note
        syn_rows.append(r)
    sample = pd.concat([sample, pd.DataFrame(syn_rows)])
    deltas = np.array([V.shipped_delta(p, table, prefix_table, PREFIX_LEN) for p in sample["postal_code_clean"]])
    pred_log = custom_predict_log(model_json, prod, sample, deltas)
    fixtures = []
    for i, (_, row) in enumerate(sample.iterrows()):
        q = q_area.get(row["omrade"], q_overall)
        la = float(row["living_area"])
        fx = {
            "input": T3.fixture_input(row),
            "expected_output": {
                "postcode_delta": float(deltas[i]),
                "predicted_log_price_per_sqm": float(pred_log[i]),
                "predicted_total_price_sek": float(np.exp(pred_log[i]) * smear * la),
                "interval_lower_sek": float(np.exp(pred_log[i] - q) * smear * la),
                "interval_upper_sek": float(np.exp(pred_log[i] + q) * smear * la),
                "q_log_used": float(q),
            },
        }
        if row["_note"]:
            fx["note"] = row["_note"]
        fixtures.append(fx)
    (OUT / "parity_fixtures.json").write_text(json.dumps(fixtures, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    head = df.head(200)
    nat = prod.predict_log(head)
    exp = custom_predict_log(model_json, prod, head, prod.enc.delta(head["postal_code_clean"]))
    meta["production_model"] = {
        "file": "model.json",
        "postcode_encoding_file": "postcode_encoding.json",
        "n_trees": len(model_json["lightgbm_booster"]["tree_info"]),
        "round_sig_figs": T3.PROD_ROUND_SIG,
        "json_bytes": model_bytes,
        "postcode_encoding_json_bytes": len(json.dumps(pc_json, ensure_ascii=False)),
        "smearing_factor": smear,
        "max_abs_diff_native_vs_exported_log_pred_first_200_rows": float(np.max(np.abs(nat - exp))),
        "back_transform": "predicted_total_price = exp(model_log_pred) * smearing_factor * living_area",
        "interval": "bounds = exp(model_log_pred +/- q_log_for_area) * smearing_factor * living_area; q from conformal_interval_evaluation.q_per_area_log, fallback q_overall_log",
        "inputs_to_booster_in_order": model_json["feature_order_out"],
    }
    print(f"  model.json {model_bytes:,} B; postcode_encoding.json {meta['production_model']['postcode_encoding_json_bytes']:,} B; max |native - exported| = {meta['production_model']['max_abs_diff_native_vs_exported_log_pred_first_200_rows']:.2e}")

    # the owner's example: 11122 and its neighbours, before (v3) and after (v3.1)
    v3_pc = json.loads((SRC / "postcode_encoding.json").read_text(encoding="utf-8"))["table"]
    probe = ["11122", "11120", "11121", "11143", "11346", "11359"]
    meta["probe_postnummer_delta"] = {
        p: {"n_training_sales": int(vc.get(p, 0)), "v3_delta": v3_pc.get(p, 0.0), "v31_delta": V.shipped_delta(p, table, prefix_table, PREFIX_LEN), "v31_source": "table" if p in table else ("prefix_table" if p[:PREFIX_LEN] in prefix_table else "fallback")}
        for p in probe
    }

    # ---------------- 5. effects (OLS, independent of the postcode encoding) ----------------
    print("[5] effects")
    effects, fee_stats = T3.build_effects_v3(df)
    effects["version"] = VERSION
    (OUT / "effects.json").write_text(json.dumps(effects, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    meta["effects_fee_per_sqm"] = fee_stats
    v3_eff = json.loads((SRC / "effects.json").read_text(encoding="utf-8"))
    meta["effects_vs_v3"] = {"identical_except_version_and_timestamp": {**effects, "version": None, "generated_at": None} == {**v3_eff, "version": None, "generated_at": None}}

    # ---------------- 6. general model: unchanged, copied byte for byte ----------------
    for name in ["general_model.json", "general_model_nofee.json", "general_parity_fixtures.json"]:
        shutil.copyfile(SRC / name, OUT / name)
    meta["regional_method"] = v3meta["regional_method"]
    meta["regional_method_note"] = "copied unchanged from valuation-v3/metadata.json; general_model*.json and general_parity_fixtures.json are byte-identical copies (the general model uses no postnummer)"
    meta["sizes_bytes"] = {
        "model.json": model_bytes,
        "postcode_encoding.json": meta["production_model"]["postcode_encoding_json_bytes"],
        "general_model.json": (OUT / "general_model.json").stat().st_size,
        "general_model_nofee.json": (OUT / "general_model_nofee.json").stat().st_size,
    }
    meta["sizes_bytes"]["model_plus_general_plus_postcode"] = model_bytes + meta["sizes_bytes"]["general_model.json"] + meta["sizes_bytes"]["postcode_encoding.json"]
    (OUT / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
