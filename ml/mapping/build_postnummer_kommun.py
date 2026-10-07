"""Builds data/derived/postnummer_kommun.csv: postnummer -> kommun (4-digit SCB code).

Sources (all cited in ml/mapping/README.md and ml/mapping/sources/kommun_boundaries/SOURCE.md):
  A. GeoNames SE dump (CC BY 4.0), columns admin2 name/code (kommun). Filled for most of
     the country but EMPTY for 734 Stockholms län rows (and a few hundred elsewhere).
  B. OSM address points with addr:postcode in Stockholms län (ODbL), point-in-polygon
     against C.
  C. OSM admin_level=7 kommun boundaries for Stockholms län (ODbL), retrieved 2026-10-07.

Decision per postnummer (first match wins):
  1. `osm_majority`        OSM points exist (>= OSM_MIN_N_OVERRIDE and majority share >=
                           OSM_MIN_SHARE_OVERRIDE) and either GeoNames kommun is blank or it
                           DISAGREES (then `konflikt_geonames` is set and the GeoNames code kept
                           in `kommun_kod_geonames`). OSM wins a disagreement because it is
                           address-point evidence while the GeoNames admin2 is algorithmic.
  2. `geonames_admin2`    GeoNames kommun filled (and not overridden by 1).
  3. `osm_majority_svag`  OSM points exist but fewer than OSM_MIN_N_OVERRIDE (or share too low),
                          GeoNames blank: majority kommun of the few points, flagged weak.
  4. `geonames_koordinat` GeoNames blank, no OSM points, GeoNames coordinate is NOT a generic
                          shared centroid (<= GEONAMES_COLLISION_THRESHOLD postcodes share it):
                          point-in-polygon of that coordinate. Approximate, flagged.
  5. unmapped             (not written to the CSV; listed in the coverage JSON).

Outside Stockholms län there are no boundaries, so blank GeoNames kommun stays unmapped.
Postcodes whose OSM points straddle kommuner (majority share < STRADDLE_SHARE with >= 2 points)
are flagged `grans`.

Run: ml/.venv/bin/python -I ml/mapping/build_postnummer_kommun.py
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pandas as pd
import shapely
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "ml" / "mapping" / "sources" / "raw"
GEONAMES_TXT = RAW / "geonames_SE_postal_codes.txt"
OSM_POINTS_JSON = RAW / "osm_addr_postcode_lan_raw.json"
KOMMUN_BOUNDARIES_JSON = ROOT / "ml" / "mapping" / "sources" / "kommun_boundaries" / "osm_kommun_admin7_stockholms_lan.json"
MAKLARSTATISTIK_XLSX = ROOT / "data" / "raw" / "maklarstatistik_stockholms_lan.xlsx"
OMRADE_CSV = ROOT / "data" / "derived" / "postnummer_omrade.csv"
OUT_CSV = ROOT / "data" / "derived" / "postnummer_kommun.csv"
OUT_COVERAGE_JSON = ROOT / "data" / "derived" / "postnummer_kommun_coverage.json"
OUT_OMRADE_CONFLICTS_CSV = ROOT / "data" / "derived" / "postnummer_omrade_kommun_konflikter.csv"

STOCKHOLMS_LAN_NAME = "Stockholm"  # GeoNames admin1 name for the county
GEONAMES_COLLISION_THRESHOLD = 200  # same threshold as build_postnummer_omrade.py
OSM_MIN_N_OVERRIDE = 3
OSM_MIN_SHARE_OVERRIDE = 0.8
STRADDLE_SHARE = 0.8
STOCKHOLM_KOMMUN = "0180"

KALLA = {
    "osm_majority": "OSM adresspunkter x OSM kommungranser (ODbL, 2026-10-07)",
    "osm_majority_svag": "OSM adresspunkter (fa) x OSM kommungranser (ODbL, 2026-10-07)",
    "geonames_admin2": "GeoNames SE admin2 (CC BY 4.0, 2026-09-24)",
    "geonames_koordinat": "GeoNames SE koordinat x OSM kommungranser (approx., 2026-10-07)",
}


# ---------------------------------------------------------------------------
# pure helpers (unit-tested in ml/tests/test_postnummer_kommun.py)
# ---------------------------------------------------------------------------
def normalise_postcode(raw: str | None) -> str | None:
    """'196 40' / '19640' -> '19640'; anything that is not exactly 5 digits -> None."""
    if raw is None:
        return None
    s = str(raw).replace(" ", "").replace(" ", "")
    return s if re.fullmatch(r"\d{5}", s) else None


def kommun_name_key(name: str) -> str:
    """Normalises a kommun name for matching OSM / GeoNames / Mäklarstatistik names:
    lower case, drop a trailing ' kommun', unify spaces/hyphens. Genitive -s is NOT
    stripped here (see match_osm_name_to_plain)."""
    n = name.strip().lower()
    n = re.sub(r"\s+kommun$", "", n)
    return re.sub(r"[\s\-]+", " ", n)


def match_osm_name_to_plain(osm_name: str, plain_names: list[str]) -> str | None:
    """OSM names are e.g. 'Stockholms kommun', 'Upplands Väsby kommun'; the plain names
    ('Stockholm', 'Upplands Väsby'). Exact key match first, then plain+'s' (genitive).
    Returns None unless EXACTLY ONE plain name matches."""
    key = kommun_name_key(osm_name)
    exact = [p for p in plain_names if kommun_name_key(p) == key]
    if len(exact) == 1:
        return exact[0]
    if exact:
        return None
    gen = [p for p in plain_names if kommun_name_key(p) + "s" == key]
    return gen[0] if len(gen) == 1 else None


def majority(counts: dict[str, int]) -> tuple[str, int, float]:
    """(winning key, total n, share). Ties broken by lowest key for determinism."""
    total = sum(counts.values())
    best = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
    return best[0], total, best[1] / total


def decide(
    geonames_kommun: str | None,
    osm_counts: dict[str, int] | None,
    geonames_coord_kommun: str | None,
    coord_is_generic: bool,
) -> dict | None:
    """Pure decision rule, see module docstring. Returns None when unmappable."""
    gk = geonames_kommun or None
    osm_kommun = osm_n = osm_share = None
    if osm_counts:
        osm_kommun, osm_n, osm_share = majority(osm_counts)
    strong = osm_n is not None and osm_n >= OSM_MIN_N_OVERRIDE and osm_share >= OSM_MIN_SHARE_OVERRIDE
    flags: list[str] = []
    if osm_n is not None and osm_n >= 2 and osm_share < STRADDLE_SHARE:
        flags.append("grans")

    if strong and (gk is None or gk != osm_kommun):
        conflict = gk is not None
        return dict(kommun=osm_kommun, metod="osm_majority", konflikt_geonames=conflict, flags=flags, n_osm=osm_n, andel_osm=osm_share)
    if gk is not None:
        conflict = osm_kommun is not None and osm_kommun != gk
        if conflict:
            flags.append("osm_oenig_svag")
        return dict(kommun=gk, metod="geonames_admin2", konflikt_geonames=False, flags=flags, n_osm=osm_n, andel_osm=osm_share)
    if osm_kommun is not None:
        flags.append("svag_evidens")
        return dict(kommun=osm_kommun, metod="osm_majority_svag", konflikt_geonames=False, flags=flags, n_osm=osm_n, andel_osm=osm_share)
    if geonames_coord_kommun is not None and not coord_is_generic:
        flags.append("approximativ_koordinat")
        return dict(kommun=geonames_coord_kommun, metod="geonames_koordinat", konflikt_geonames=False, flags=flags, n_osm=None, andel_osm=None)
    return None


# ---------------------------------------------------------------------------
# data loading
# ---------------------------------------------------------------------------
def load_kommun_polygons(path: Path = KOMMUN_BOUNDARIES_JSON):
    data = json.loads(path.read_text(encoding="utf-8"))
    polys, names = {}, {}
    for e in data["elements"]:
        code = e["tags"]["KNKOD"]
        lines = [
            LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
            for m in e["members"]
            if m["type"] == "way" and m["role"] == "outer" and m.get("geometry")
        ]
        faces = list(polygonize(unary_union(lines)))
        if not faces:
            raise ValueError(f"no polygon could be assembled for {code}")
        polys[code] = unary_union(faces)
        names[code] = e["tags"]["name"]
    return polys, names, data["osm3s"]["timestamp_osm_base"]


def assign_points(lon, lat, polys: dict) -> list[str | None]:
    """Point-in-polygon; where polygons overlap the SMALLEST polygon wins (enclaves)."""
    out = pd.Series([None] * len(lon), dtype=object)
    for code in sorted(polys, key=lambda c: -polys[c].area):  # largest first, smaller overwrite
        m = shapely.contains_xy(polys[code], lon, lat)
        out[m] = code
    return out.tolist()


def load_geonames() -> pd.DataFrame:
    g = pd.read_csv(GEONAMES_TXT, sep="\t", header=None, dtype=str, keep_default_na=False)
    g.columns = ["cc", "pc", "place", "lan", "lancode", "kom", "komkod", "a3", "a3k", "lat", "lon", "acc"]
    g["postnummer"] = g["pc"].map(normalise_postcode)
    g = g[g["postnummer"].notna()].drop_duplicates("postnummer")
    return g.set_index("postnummer")


def load_osm_points() -> pd.DataFrame:
    els = json.loads(OSM_POINTS_JSON.read_text(encoding="utf-8"))["elements"]
    rows = []
    for e in els:
        pc = normalise_postcode(e.get("tags", {}).get("addr:postcode"))
        if pc is None:
            continue
        if "lat" in e:
            rows.append((pc, e["lat"], e["lon"]))
        elif "center" in e:
            rows.append((pc, e["center"]["lat"], e["center"]["lon"]))
    return pd.DataFrame(rows, columns=["postnummer", "lat", "lon"])


def load_maklarstatistik_names() -> list[str]:
    df = pd.read_excel(MAKLARSTATISTIK_XLSX, sheet_name="Bostadsrätter", header=None)
    names = [str(x) for x in df.iloc[6:, 0].dropna()]
    return [n for n in names if n != "Stockholms län"]


# ---------------------------------------------------------------------------
def main() -> None:
    polys, osm_names, osm_ts = load_kommun_polygons()
    g = load_geonames()
    pts = load_osm_points()
    pts["kommun"] = assign_points(pts["lon"].values, pts["lat"].values, polys)
    n_outside = int(pts["kommun"].isna().sum())
    osm_counts = {pc: grp.value_counts().to_dict() for pc, grp in pts.dropna(subset=["kommun"]).groupby("postnummer")["kommun"]}

    # ---- kommun code -> name; cross-check codes/names across the three sources ----
    gn_names = {}
    for code, grp in g[g["komkod"] != ""].groupby("komkod"):
        gn_names[code] = grp["kom"].mode().iloc[0]
    mk_names = load_maklarstatistik_names()
    code_to_name: dict[str, str] = dict(gn_names)
    mismatches = []
    for code, osm_name in osm_names.items():
        plain = match_osm_name_to_plain(osm_name, mk_names)
        if plain is None:
            mismatches.append({"kod": code, "osm_namn": osm_name, "problem": "ingen entydig match mot Mäklarstatistik-namn"})
            continue
        if code in gn_names and kommun_name_key(gn_names[code]) != kommun_name_key(plain):
            mismatches.append({"kod": code, "geonames": gn_names[code], "maklarstatistik": plain, "problem": "namn skiljer"})
        code_to_name.setdefault(code, plain)
        code_to_name[code] = gn_names.get(code, plain)
    not_in_geonames = sorted(c for c in osm_names if c not in gn_names)

    # ---- län code from kommun code prefix (data-derived), name from GeoNames admin1 ----
    g["lan_from_kommun"] = g["komkod"].str[:2]

    # coordinate collision (generic centroid) counts
    coord_counts = g.groupby(["lat", "lon"]).size()
    g["coord_n"] = [coord_counts[(a, b)] for a, b in zip(g["lat"], g["lon"])]

    # point-in-polygon of GeoNames coordinates (used only for blank-kommun rows in the län)
    blank_lan = g[(g["komkod"] == "") & (g["lan"] == STOCKHOLMS_LAN_NAME)]
    coord_kommun = {}
    if len(blank_lan):
        res = assign_points(blank_lan["lon"].astype(float).values, blank_lan["lat"].astype(float).values, polys)
        coord_kommun = dict(zip(blank_lan.index, res))

    all_pcs = sorted(set(g.index) | set(osm_counts))
    out_rows, unmapped = [], []
    for pc in all_pcs:
        row = g.loc[pc] if pc in g.index else None
        gk = (row["komkod"] or None) if row is not None else None
        res = decide(
            gk,
            osm_counts.get(pc),
            coord_kommun.get(pc),
            coord_is_generic=bool(row is not None and row["coord_n"] > GEONAMES_COLLISION_THRESHOLD),
        )
        if res is None:
            unmapped.append({
                "postnummer": pc,
                "geonames_lan": None if row is None else row["lan"],
                "geonames_plats": None if row is None else row["place"],
                "orsak": "ingen kommunuppgift, inga OSM-punkter, "
                + ("GeoNames-koordinat generisk eller utanför Stockholms län" if row is not None else "finns inte i GeoNames"),
            })
            continue
        kod = res["kommun"]
        lan_kod = kod[:2]
        out_rows.append({
            "postnummer": pc,
            "kommun_kod": kod,
            "kommun_namn": code_to_name.get(kod, ""),
            "lan_kod": lan_kod,
            "metod": res["metod"],
            "kalla": KALLA[res["metod"]],
            "n_osm": "" if res["n_osm"] is None else res["n_osm"],
            "andel_osm": "" if res["andel_osm"] is None else round(res["andel_osm"], 3),
            "kommun_kod_geonames": gk or "",
            "konflikt_geonames": bool(res["konflikt_geonames"]),
            "flaggor": ";".join(res["flags"]),
        })
    out = pd.DataFrame(out_rows)
    out.to_csv(OUT_CSV, index=False, encoding="utf-8")

    # ---- coverage: Stockholms län ----
    lan_pcs = set(g.index[g["lan"] == STOCKHOLMS_LAN_NAME]) | {pc for pc in out["postnummer"] if out.set_index("postnummer").loc[pc, "lan_kod"] == "01"}
    sthlm = out[out["postnummer"].isin(lan_pcs)]
    unm_lan = [u for u in unmapped if u["geonames_lan"] == STOCKHOLMS_LAN_NAME]
    outside_unm = [u for u in unmapped if u["geonames_lan"] != STOCKHOLMS_LAN_NAME]

    conflicts_geonames = out[out["konflikt_geonames"]][["postnummer", "kommun_kod", "kommun_namn", "kommun_kod_geonames", "n_osm", "andel_osm"]]

    # ---- cross-check vs postnummer_omrade.csv ----
    om = pd.read_csv(OMRADE_CSV, dtype={"postnummer": str})
    j = om.merge(out, on="postnummer", how="left", suffixes=("_omrade", "_kommun"))
    not_in_kommun_table = j[j["kommun_kod"].isna()]
    conf = j[j["kommun_kod"].notna() & (j["kommun_kod"] != STOCKHOLM_KOMMUN)].copy()
    conf["rekommendation"] = "ta bort fran postnummer_omrade.csv (postnumret ligger i annan kommun an Stockholm)"
    conf_cols = ["postnummer", "omrade", "metod_omrade", "kalla_omrade", "granne_konflikt", "kommun_kod", "kommun_namn", "metod_kommun", "n_osm", "andel_osm", "kommun_kod_geonames", "flaggor", "rekommendation"]
    conf[conf_cols].to_csv(OUT_OMRADE_CONFLICTS_CSV, index=False, encoding="utf-8")

    coverage = {
        "generated_for": "postnummer_kommun.csv",
        "osm_boundaries_timestamp": osm_ts,
        "n_osm_points_with_valid_postcode": int(len(pts)),
        "n_osm_points_outside_all_polygons": n_outside,
        "n_postnummer_total_mapped": int(len(out)),
        "by_metod_all": out["metod"].value_counts().to_dict(),
        "stockholms_lan": {
            "n_postnummer_known": len(lan_pcs),
            "n_mapped": int(len(sthlm)),
            "n_unmapped": len(unm_lan),
            "by_metod": sthlm["metod"].value_counts().to_dict(),
            "by_kommun": sthlm.groupby(["kommun_kod", "kommun_namn"]).size().reset_index(name="n").to_dict("records"),
            "n_straddling_flagged": int(sthlm["flaggor"].str.contains("grans").sum()),
            "unmapped": unm_lan,
        },
        "outside_stockholms_lan": {
            "n_mapped": int((~out["postnummer"].isin(lan_pcs)).sum()),
            "n_unmapped_no_kommun_in_geonames": len(outside_unm),
            "note": "no boundary source outside Stockholms lan; blank GeoNames kommun stays unmapped",
        },
        "geonames_vs_osm_conflicts_resolved_to_osm": conflicts_geonames.to_dict("records"),
        "kommun_name_mismatches": mismatches,
        "kommun_codes_absent_from_geonames_filled_rows": [{"kod": c, "namn": code_to_name.get(c)} for c in not_in_geonames],
        "omrade_cross_check": {
            "n_omrade_postnummer": int(len(om)),
            "n_not_in_kommun_table": int(len(not_in_kommun_table)),
            "n_in_kommun_0180": int((j["kommun_kod"] == STOCKHOLM_KOMMUN).sum()),
            "n_conflicts_other_kommun": int(len(conf)),
            "conflicts_by_kommun": conf.groupby(["kommun_kod", "kommun_namn"]).size().reset_index(name="n").to_dict("records"),
            "conflicts_by_omrade_metod": conf["metod_omrade"].value_counts().to_dict(),
            "conflicts_file": str(OUT_OMRADE_CONFLICTS_CSV.relative_to(ROOT)),
        },
    }
    OUT_COVERAGE_JSON.write_text(json.dumps(coverage, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(json.dumps({k: v for k, v in coverage.items() if k not in ("geonames_vs_osm_conflicts_resolved_to_osm",)}, indent=2, ensure_ascii=False, default=str)[:6000])
    print("conflicts resolved to OSM:", len(conflicts_geonames))


if __name__ == "__main__":
    main()
