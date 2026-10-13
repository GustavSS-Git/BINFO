"""Builds the postnummer -> stadsdel (and -> register area) tables for the BRF register
(PLAN-v3 2.2, step "postnummer -> stadsdel majority table").

Outputs (both new; `data/derived/postnummer_omrade.csv` is not touched):

  data/derived/postnummer_stadsdel.csv
      postnummer, stadsdel, share, n_points, method, registeromrade, registeromrade_share, flagga
  data/derived/postnummer_stockholm_ovriga.csv
      postnummer, kommun_metod, flaggor   (postnummer that postnummer_kommun.csv places in
      Stockholms kommun (0180) but that have no stadsdel here -> register area "ovriga-stockholm")

Method. This re-uses, unchanged, the functions of `build_postnummer_omrade.py` (same OSM
points, same GeoNames table, same prefix gate, same Stockholm-only prefixes, same tier-3
neighbour rule) and applies them one level finer:

  * osm_address_majority         tier 1: the stadsdel holding most of the postnummer's
                                 OSM addr:postcode points; share = its share of the n points.
  * geonames_point_in_polygon    tier 2: stadsdel containing the GeoNames coordinate.
  * prefix_granne                tier 3: the stadsdel of the numerically nearest same-prefix
                                 postnummer resolved by tier 1/2 (tie -> lower number).
                                 share/n_points are empty. WEAK: a postnummer can span
                                 several stadsdelar; flagga=granne_konflikt when the
                                 below/above neighbours disagree on register area.

`registeromrade` / `registeromrade_share` apply the same rule on the register area
(stadsdel_registeromrade.csv) directly, because the stadsdel -> area crosswalk is many to
one: a postnummer straddling two stadsdelar of the same area is not a boundary case for the
register. Consumers should use `registeromrade`, not re-derive it from `stadsdel`.

flagga (';'-joined): `kommun_avviker_<kod>` = postnummer_kommun.csv places the postnummer in
another kommun (kept and flagged; treat the area as unreliable); `grans` = tier 1 and the winning register area holds < 80 % of the points
(STRADDLE_THRESHOLD, the same threshold as postnummer_omrade); `granne_konflikt` = tier 3
and the neighbours disagree on register area. Empty otherwise.

Consistency check at the end: the set of postnummer and the method per postnummer must
equal `postnummer_omrade.csv`; the script exits non-zero otherwise.
"""

import bisect
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_postnummer_omrade as bpo  # noqa: E402

ROOT = bpo.ROOT
HERE = Path(__file__).resolve().parent
REGISTER_CROSSWALK = HERE / "stadsdel_registeromrade.csv"
OUT_STADSDEL = ROOT / "data" / "derived" / "postnummer_stadsdel.csv"
OUT_OVRIGA = ROOT / "data" / "derived" / "postnummer_stockholm_ovriga.csv"
OMRADE_CSV = ROOT / "data" / "derived" / "postnummer_omrade.csv"
KOMMUN_CSV = ROOT / "data" / "derived" / "postnummer_kommun.csv"
STOCKHOLM_KOMMUN = "0180"

FIELDS = ["postnummer", "stadsdel", "share", "n_points", "method", "registeromrade", "registeromrade_share", "flagga"]


def load_register_crosswalk() -> dict[str, str]:
    with REGISTER_CROSSWALK.open(encoding="utf-8") as f:
        return {r["stadsdel"].strip().upper(): r["slug"].strip() for r in csv.DictReader(f)}


def majority(counter: Counter) -> tuple[str, int]:
    """Most common key; ties broken alphabetically so reruns are deterministic."""
    top = max(counter.values())
    key = sorted(k for k, v in counter.items() if v == top)[0]
    return key, top


def build() -> tuple[list[dict], list[dict], dict]:
    reg = load_register_crosswalk()
    polys = bpo.load_stadsdel_polygons()
    osm_points = bpo.load_osm_lan_points()
    geonames = bpo.load_geonames()
    geo_collisions = Counter((lat, lon) for _p, lat, lon in geonames.values())

    per_pc_stadsdel: dict[str, Counter] = defaultdict(Counter)
    per_pc_area: dict[str, Counter] = defaultdict(Counter)
    prefix_total: Counter = Counter()
    prefix_in: Counter = Counter()
    all_osm_pcs: set[str] = set()
    for pc, lat, lon in osm_points:
        all_osm_pcs.add(pc)
        prefix_total[pc[:3]] += 1
        sd = bpo.assign_stadsdel(lat, lon, polys)
        if sd is None:
            continue
        prefix_in[pc[:3]] += 1
        per_pc_stadsdel[pc][sd] += 1
        per_pc_area[pc][reg[sd]] += 1

    prefix_share = {p: prefix_in[p] / prefix_total[p] for p in prefix_total}
    sthlm_only = {p for p, s in prefix_share.items() if s >= bpo.STOCKHOLM_ONLY_PREFIX_THRESHOLD}
    training = bpo.load_candidate_postcodes()

    mapped: dict[str, dict] = {}
    for pc in sorted(set(per_pc_stadsdel) | training):
        prefix = pc[:3]
        if not bpo.prefix_passes_tier12_gate(prefix, prefix_share):
            continue
        sd_counts = per_pc_stadsdel.get(pc, Counter())
        n_osm = sum(sd_counts.values())
        if n_osm >= bpo.tier1_min_n_required(prefix, sthlm_only):
            sd, n_sd = majority(sd_counts)
            area, n_area = majority(per_pc_area[pc])
            a_share = n_area / n_osm
            mapped[pc] = {
                "postnummer": pc,
                "stadsdel": sd,
                "share": round(n_sd / n_osm, 4),
                "n_points": n_osm,
                "method": "osm_address_majority",
                "registeromrade": area,
                "registeromrade_share": round(a_share, 4),
                "flagga": "grans" if a_share < bpo.STRADDLE_THRESHOLD else "",
            }
            continue
        geo = geonames.get(pc)
        if geo is None:
            continue
        _place, lat, lon = geo
        if geo_collisions[(lat, lon)] > bpo.GEONAMES_COLLISION_THRESHOLD:
            continue
        sd = bpo.assign_stadsdel(lat, lon, polys)
        if sd is None:
            continue
        mapped[pc] = {
            "postnummer": pc,
            "stadsdel": sd,
            "share": 1.0,
            "n_points": n_osm,
            "method": "geonames_point_in_polygon",
            "registeromrade": reg[sd],
            "registeromrade_share": 1.0,
            "flagga": "",
        }

    tier3 = {pc for pc in (all_osm_pcs | set(geonames) | training) if pc[:3] in sthlm_only} - set(mapped)
    refs: dict[str, list[int]] = defaultdict(list)
    for pc in mapped:
        refs[pc[:3]].append(int(pc))
    for p in refs:
        refs[p].sort()
    for pc in sorted(tier3):
        r = refs.get(pc[:3], [])
        if not r:
            continue
        t = int(pc)
        i = bisect.bisect_left(r, t)
        below = r[i - 1] if i > 0 else None
        above = r[i] if i < len(r) else None
        sd_b = mapped[str(below).zfill(5)]["stadsdel"] if below is not None else None
        sd_a = mapped[str(above).zfill(5)]["stadsdel"] if above is not None else None
        sd, ref, _sd_conflict = bpo.choose_tier3_neighbor(t, below, above, sd_b, sd_a)
        ar_b = mapped[str(below).zfill(5)]["registeromrade"] if below is not None else None
        ar_a = mapped[str(above).zfill(5)]["registeromrade"] if above is not None else None
        # same neighbour, same tie rule, on the register area
        area, ref_a, area_conflict = bpo.choose_tier3_neighbor(t, below, above, ar_b, ar_a)
        assert ref == ref_a
        mapped[pc] = {
            "postnummer": pc,
            "stadsdel": sd,
            "share": "",
            "n_points": "",
            "method": "prefix_granne",
            "registeromrade": area,
            "registeromrade_share": "",
            "flagga": "granne_konflikt" if area_conflict else "",
        }

    rows = [mapped[pc] for pc in sorted(mapped)]

    # postnummer in Stockholms kommun per postnummer_kommun.csv that have no stadsdel here
    ovriga = []
    n_kommun = 0
    kommun_of: dict[str, str] = {}
    with KOMMUN_CSV.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            kommun_of[r["postnummer"]] = r["kommun_kod"]
            if r["kommun_kod"] != STOCKHOLM_KOMMUN:
                continue
            n_kommun += 1
            if r["postnummer"] not in mapped:
                ovriga.append({"postnummer": r["postnummer"], "kommun_metod": r["metod"], "flaggor": r["flaggor"]})
    ovriga.sort(key=lambda r: r["postnummer"])
    # A postnummer that postnummer_kommun.csv places in ANOTHER kommun is flagged, not dropped:
    # the stadsdel evidence (OSM points inside Stockholm polygons) and the kommun table disagree.
    n_other_kommun = 0
    n_absent = 0
    for r in rows:
        kod = kommun_of.get(r["postnummer"])
        if kod is None:
            n_absent += 1
        elif kod != STOCKHOLM_KOMMUN:
            n_other_kommun += 1
            r["flagga"] = ";".join(x for x in (r["flagga"], f"kommun_avviker_{kod}") if x)
    stats = {
        "n_kommun_0180": n_kommun,
        "n_stadsdel": len(rows),
        "n_ovriga": len(ovriga),
        "n_mapped_other_kommun": n_other_kommun,
        "n_mapped_absent_from_kommun_csv": n_absent,
    }
    return rows, ovriga, stats


def check_consistency(rows: list[dict]) -> None:
    with OMRADE_CSV.open(encoding="utf-8") as f:
        old = {r["postnummer"]: r["metod"] for r in csv.DictReader(f)}
    new = {r["postnummer"]: r["method"] for r in rows}
    if old != new:
        only_old = sorted(set(old) - set(new))[:10]
        only_new = sorted(set(new) - set(old))[:10]
        diff = sorted(pc for pc in set(old) & set(new) if old[pc] != new[pc])[:10]
        raise SystemExit(f"postnummer_stadsdel disagrees with postnummer_omrade: only_old={only_old} only_new={only_new} method_diff={diff}")


def main() -> None:
    rows, ovriga, stats = build()
    check_consistency(rows)
    OUT_STADSDEL.parent.mkdir(parents=True, exist_ok=True)
    with OUT_STADSDEL.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    with OUT_OVRIGA.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["postnummer", "kommun_metod", "flaggor"], lineterminator="\n")
        w.writeheader()
        w.writerows(ovriga)

    # report
    by_method = Counter(r["method"] for r in rows)
    by_area = Counter(r["registeromrade"] for r in rows)
    flagged = Counter(f for r in rows for f in r["flagga"].split(";") if f)
    # stadsdel-level and register-area-level disagreement with the 13-area table is expected
    print(f"postnummer in kommun 0180 (postnummer_kommun.csv): {stats['n_kommun_0180']}")
    print(f"with a stadsdel: {stats['n_stadsdel']}  -> by method {dict(by_method)}")
    print(f"without (-> ovriga-stockholm): {stats['n_ovriga']}")
    print(
        f"with a stadsdel but postnummer_kommun.csv says another kommun: {stats['n_mapped_other_kommun']}; "
        f"absent from postnummer_kommun.csv: {stats['n_mapped_absent_from_kommun_csv']}"
    )
    print(f"flags: {dict(flagged)}")
    print("per register area:")
    for a, n in sorted(by_area.items()):
        print(f"  {a:26s} {n}")
    t1 = [r for r in rows if r["method"] == "osm_address_majority"]
    split_sd = [r for r in t1 if r["share"] < 0.8]
    print(f"tier 1 postnummer where the winning stadsdel holds < 80 % of the points: {len(split_sd)} of {len(t1)}")
    print(f"tier 1 postnummer where the winning register area holds < 80 %: {sum(1 for r in t1 if r['flagga'] == 'grans')}")


if __name__ == "__main__":
    main()
