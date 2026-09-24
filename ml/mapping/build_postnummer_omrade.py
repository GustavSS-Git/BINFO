"""Builds data/derived/postnummer_omrade.csv: postnummer (5-digit string) -> omrade
(one of the 13 Binfo/Svensk-Maklarstatistik-named areas), the method that decided the
row, the share of matched evidence in the winning area, and the amount of evidence
behind the decision.

v3 (2026-09-24, second follow-up): v2 (OSM address points + GeoNames fallback) left
44 of the ~650 training postcodes unmapped, all in prefixes GeoNames itself cannot
resolve (its SE dump collapses onto a generic "Stockholm" centroid for most of
100xx-129xx, and has an empty admin2/municipality field so it cannot tell us kommun
membership at all). This version adds a third tier: for a postcode whose 3-digit
prefix is confirmed (from data, not memory) to be Stockholm-kommun-only, and which
tier 1/2 could not resolve, assign the area of the *numerically nearest already-
mapped postcode with the same prefix*. A postcode whose prefix is NOT confirmed
Stockholm-only stays unmapped (correctly -- the product falls back to the
Stockholm-wide model for it).

Method (three tiers, in order; a postcode is resolved by the first tier that
succeeds)
------------------------------------------------------------------------------
Tier 1/2 prefix gate (bug fix, 2026-09-24 third follow-up / independent review):
  BEFORE either tier 1 or tier 2 is attempted for a postnummer, its 3-digit prefix
  must clear MIN_PREFIX_SHARE_FOR_TIER12 (50%) in-kommun share (see the constant's
  docstring). Without this gate, a single stray/mis-tagged OSM point, or a GeoNames
  coordinate that happens to fall just inside the kommun boundary, was enough to
  produce a false Stockholm-area assignment for a prefix that is, per our own
  lan-wide analysis, essentially 0% Stockholm (concrete bug found by review:
  postnummer 13155/13171 (prefix 131, 0.04% in-kommun), 17164 (171, 0.3%), 18132
  (181, 0.07%), 19234 (192, 0.01%) were each mapped off a single OSM point despite
  their prefix being overwhelmingly a different municipality's). A prefix that
  fails this gate is never attempted by tier 1 or 2 -- left unmapped with the
  reason logged, regardless of how much (or little) individual point evidence
  exists for a specific postnummer within it.

Tier 1 -- OSM address-point majority: every OSM node/way tagged `addr:postcode`
  inside Stockholms kommun is point-in-polygon'd against the 117 stadsdel polygons;
  for a postnummer whose prefix passes the gate above, a majority vote is used once
  enough points are matched -- >=1 point for a "Stockholm-only" (>=99% in-kommun)
  prefix, >=2 points for a prefix that passes the 50% gate but is not Stockholm-only
  (the borderline 106/123/164 case -- see tier1_min_n_required()). `metod=osm_address_majority`.

Tier 2 -- GeoNames point-in-polygon fallback: for a postnummer whose prefix passes
  the gate above but tier 1 could not resolve, look it up in GeoNames' SE
  postal-code dump and point-in-polygon its (lat, lon), but only if that coordinate
  is not one of the handful of low-precision, nationally-collided city centroids
  (see ml/mapping/README.md for the verification). GeoNames' own SE rows have an
  empty admin2 (municipality) field, so GeoNames alone cannot tell us kommun
  membership -- this is exactly why the prefix gate (and tier 3) exist.
  `metod=geonames_point_in_polygon`.

Tier 3 -- same-prefix nearest neighbour (new in v3): for a postnummer tier 1/2 could
  not resolve, if its 3-digit prefix is a **Stockholm-only prefix** (see below), find
  the numerically nearest postnummer with the same prefix that tier 1 or tier 2 DID
  resolve (not other tier-3 results, to avoid chaining uncertainty), and use its
  omrade. If both a "below" and "above" same-prefix neighbour exist, pick whichever
  is numerically closer; on an exact tie, pick the lower number (documented tie
  rule). If the two neighbours disagree on omrade, the postnummer is flagged as a
  boundary case (`granne_konflikt=True`) but still assigned (to the closer
  neighbour's area, or the lower one on a tie) -- flagged, not left unmapped, per the
  brief. `metod=prefix_granne`.

Stockholm-only prefixes -- decided from data, not memory
----------------------------------------------------------
We queried OSM (Overpass) for every `addr:postcode`-tagged address point in the
whole of **Stockholms län** (OSM relation 54391, 140,051 points with a valid 5-digit
postcode -- see `ml/mapping/sources/raw/osm_addr_postcode_lan_raw.json`), then, for
every distinct 3-digit prefix in [100, 199], computed the share of that prefix's
address points that fall inside the Stockholms **kommun** polygon (the same 117
stadsdel union used everywhere else in this mapping). A prefix is "Stockholm-only"
if that share is **>= 99%**.

The data separates extremely cleanly: every prefix in our county-wide sample is
either ~0% inside the kommun (a different municipality's prefix entirely -- Nacka,
Sollentuna, Huddinge, etc., e.g. prefix 131: 2/4,966 points in-kommun, prefix 187:
0/7,810) or >=99.3% inside it (prefix 111: 998/1000 rounded; prefix 165: 100%), with
only two prefixes falling in between due to small samples (106: 21/22 = 95.5%, n=22;
123: 1,079/1,111 = 97.1%, n=1,111 -- 123 is a real, larger-sample case of a
genuinely-split prefix, not sampling noise, and correctly does not qualify). 99%
was chosen (rather than e.g. 95%) specifically so that a prefix with a real,
non-trivial share of its addresses outside the kommun (like 123, with 32 points
confirmed outside on a sample of 1,111) is excluded, while still being permissive
enough that any prefix with even a handful of near-boundary or mis-geocoded points
(anywhere up to 1% of its sample) still qualifies -- with this data, the exact
threshold barely matters between roughly 2% and 95%, since real prefixes cluster at
the extremes; 99% is the conservative end of that range. Every prefix's share (100
to 199) is reported in the coverage output and in ml/mapping/README.md.

Stockholm-only prefixes found: 100, 101, 102, 103, 104, 107, 111, 112, 113, 114,
115, 116, 117, 118, 120, 121, 122, 124, 125, 126, 127, 128, 129, 158, 161, 162, 163,
164, 165, 167, 168. (105, 108, 109, 110, 119 never appeared in the county-wide OSM
sample at all, so we have zero evidence for them either way -- NOT included, per
"decided from data, not memory": a postnummer with one of those prefixes is not
eligible for tier 3.)

Candidate universe (v3)
------------------------
For tier 1/2 (unchanged from v2): every postnummer OSM found >=1 point for inside
Stockholms kommun, union every postal code in Binfo's two raw transaction workbooks.
For tier 3 (new, broader, per the brief): every postnummer that appears *anywhere*
in the county-wide OSM sample, in GeoNames' SE dump, or in either transaction
workbook, whose 3-digit prefix is Stockholm-only.

Unmapped postnummer (three possible reasons, all logged)
-----------------------------------------------------------
1. Prefix is not confirmed Stockholm-only (below the 99% bar, or no evidence at
   all) -- correctly stays unmapped; the product's Stockholm-wide fallback applies.
2. Prefix is Stockholm-only but tier 1/2 never resolved *any* postnummer with that
   prefix, so tier 3 has no neighbour to borrow from (did not occur in this run, but
   handled).
3. (Should not occur for training postnummer after this change, other than
   genuinely-outside-kommun GeoNames data errors already caught by tier 2's own
   point-in-polygon check.)

Output columns: postnummer, omrade, andel_i_omrade, n_adresser, metod, kalla,
granne_konflikt.
  - metod: "osm_address_majority" | "geonames_point_in_polygon" | "prefix_granne"
  - granne_konflikt: True only for prefix_granne rows where the nearest-below and
    nearest-above same-prefix neighbours disagreed on omrade (boundary case, still
    assigned per the tie rule above). Empty/False for tier 1/2 rows.
"""

import bisect
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
from shapely.geometry import Point, shape
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[2]
SOURCES = Path(__file__).parent / "sources"
RAW = SOURCES / "raw"
CROSSWALK_CSV = Path(__file__).parent / "stadsdel_omrade_crosswalk.csv"
STADSDELAR_GEOJSON = SOURCES / "stadsdelar_fullsize.geo.json"
OSM_LAN_RAW = RAW / "osm_addr_postcode_lan_raw.json"  # Stockholms lan (superset of kommun), see module docstring
GEONAMES_RAW = RAW / "geonames_SE_postal_codes.txt"
OUT_CSV = ROOT / "data" / "derived" / "postnummer_omrade.csv"

VALUATION_XLSX = ROOT / "data" / "raw" / "Transaction data for valuation.xlsx"
BID_DIFF_XLSX = ROOT / "data" / "raw" / "Transaction data for bid and contract price difference.xlsx"

STRADDLE_THRESHOLD = 0.80
OSM_MIN_N = 1  # any real, individually-tagged OSM address point is trusted over the
# coarser GeoNames place-name-matched fallback: with no minimum at all, only 5 of
# 753 OSM-mapped postnummer (0.66%) straddled below the 80% majority threshold in
# earlier profiling, so low-n OSM evidence was already empirically reliable here --
# PROVIDED the prefix itself is actually a Stockholm one (see MIN_PREFIX_SHARE_FOR_TIER12
# below; that 0.66% profiling was on postnummer whose prefix was already known-good).
GEONAMES_COLLISION_THRESHOLD = 200  # see ml/mapping/README.md "GeoNames precision"
STOCKHOLM_ONLY_PREFIX_THRESHOLD = 0.99  # see module docstring

# --- tier 1/2 prefix gate (bug fix, 2026-09-24 third follow-up / independent review) ---
# Without this gate, a single stray or mis-tagged OSM address point (e.g. an
# out-of-kommun address that got tagged with the wrong postcode, or a point right on
# the kommun boundary) was enough to produce a false Stockholm-area assignment for a
# prefix that is, per our own lan-wide analysis, essentially 0% Stockholm (e.g.
# prefix 131: 2/4,966 = 0.04% in-kommun; a lone in-kommun point there is almost
# certainly a data error, not evidence the postcode is really in Stockholm). A
# prefix must clear this bar before tier 1 or tier 2 will assign it ANY Stockholm
# area at all. 50% is chosen as a wide, safe margin, not a tuned value: the data
# separates cleanly into an ~0% cluster (every non-Stockholm prefix we found, all
# <=3%) and a ~95-100% cluster (every real Stockholm prefix, all >=95.5%) -- see
# ml/mapping/README.md's per-prefix share table. Anything between roughly 3% and
# 95% would work equally well as the cutoff with this data; 50% is the midpoint.
MIN_PREFIX_SHARE_FOR_TIER12 = 0.50

# For a prefix that clears the 50% gate but is NOT "Stockholm-only" (>=99%, e.g. the
# borderline 106/123/164 prefixes -- genuinely mixed, not just noise), require at
# least 2 independent OSM points before trusting tier 1's majority vote; a single
# point in a demonstrably-mixed prefix is weaker evidence than a single point in an
# established >=99%-Stockholm prefix.
TIER1_MIN_N_FOR_NON_STOCKHOLM_ONLY_PREFIX = 2


def prefix_passes_tier12_gate(prefix: str, prefix_share: dict[str, float], min_share: float = MIN_PREFIX_SHARE_FOR_TIER12) -> bool:
    """Whether a 3-digit prefix has enough in-kommun evidence to be eligible for a
    tier 1 (OSM) or tier 2 (GeoNames) Stockholm-area assignment at all. A prefix
    with no evidence at all (not in prefix_share) fails the gate (0.0 < min_share)."""
    return prefix_share.get(prefix, 0.0) >= min_share


def tier1_min_n_required(prefix: str, stockholm_only_prefixes: set[str]) -> int:
    """Minimum OSM address-point count required to trust tier 1's majority vote for
    this prefix. See TIER1_MIN_N_FOR_NON_STOCKHOLM_ONLY_PREFIX / OSM_MIN_N above."""
    if prefix in stockholm_only_prefixes:
        return OSM_MIN_N
    return TIER1_MIN_N_FOR_NON_STOCKHOLM_ONLY_PREFIX


def choose_tier3_neighbor(
    target: int,
    below: int | None,
    above: int | None,
    omrade_below: str | None,
    omrade_above: str | None,
) -> tuple[str, int, bool]:
    """Tier-3 same-prefix nearest-neighbour rule, extracted as a pure function so it
    is unit-testable independent of the postnummer/OSM/GeoNames data.

    Returns (chosen_omrade, chosen_reference_postcode, conflict). `below`/`above`
    are the nearest same-prefix reference postcodes (as ints) numerically below/
    above `target` respectively, or None if no such reference exists on that side;
    at least one of them must be given. Tie rule (equal distance on both sides):
    the LOWER number wins (`below`). `conflict` is True iff both neighbours exist
    and disagree on omrade -- this does not change which one is chosen, it is only
    a flag for the caller to record (`granne_konflikt` in the output CSV).
    """
    if below is None and above is None:
        raise ValueError("choose_tier3_neighbor: at least one of below/above must be given")
    if below is not None and above is not None:
        conflict = omrade_below != omrade_above
        dist_below = target - below
        dist_above = above - target
        if dist_below <= dist_above:  # tie -> lower number (below) wins
            return omrade_below, below, conflict
        return omrade_above, above, conflict
    if below is not None:
        return omrade_below, below, False
    return omrade_above, above, False


def load_crosswalk() -> dict[str, str]:
    cw = {}
    with CROSSWALK_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cw[row["stadsdel"].strip().upper()] = row["omrade"].strip()
    return cw


def load_stadsdel_polygons():
    data = json.loads(STADSDELAR_GEOJSON.read_text(encoding="utf-8"))
    polys = []
    for feat in data["features"]:
        name = feat["properties"]["name"].strip().upper()
        geom = shape(feat["geometry"])
        polys.append((name, geom, prep(geom)))
    return polys


def load_osm_lan_points() -> list[tuple[str, float, float]]:
    """Every OSM addr:postcode point in the whole of Stockholms lan (superset of
    the kommun-scoped v1/v2 query) -- used both for tier 1 (filtered to in-kommun
    points) and for the Stockholm-only-prefix analysis (all points)."""
    data = json.loads(OSM_LAN_RAW.read_text(encoding="utf-8"))
    points = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        postcode = tags.get("addr:postcode")
        if not postcode:
            continue
        postcode = "".join(ch for ch in postcode if ch.isdigit())
        if len(postcode) != 5:
            continue
        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            center = el.get("center")
            if not center:
                continue
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        points.append((postcode, lat, lon))
    return points


def load_geonames() -> dict[str, tuple[str, float, float]]:
    entries = {}
    with GEONAMES_RAW.open(encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 11:
                continue
            postcode = parts[1].replace(" ", "")
            place = parts[2]
            lat_s, lon_s = parts[9], parts[10]
            if not lat_s or not lon_s:
                continue
            entries[postcode] = (place, float(lat_s), float(lon_s))
    return entries


def load_candidate_postcodes() -> set[str]:
    """Postal codes appearing in Binfo's own transaction data (see v2 docstring in
    ml/mapping/README.md for why this is the honest candidate universe rather than
    all of Sweden)."""
    codes: set[str] = set()
    for path, sheet in [(VALUATION_XLSX, "Sheet1"), (BID_DIFF_XLSX, "Data")]:
        header = 1 if sheet == "Sheet1" else 0
        df = pd.read_excel(path, sheet_name=sheet, header=header)
        for raw in df["postal_code"].dropna():
            try:
                codes.add(str(int(float(raw))).zfill(5))
            except (ValueError, TypeError):
                continue
    return codes


def assign_stadsdel(lat: float, lon: float, polys) -> str | None:
    pt = Point(lon, lat)
    for name, geom, prepared in polys:
        if prepared.contains(pt):
            return name
    for name, geom, prepared in polys:
        if geom.intersects(pt):
            return name
    return None


def main() -> None:
    crosswalk = load_crosswalk()
    polys = load_stadsdel_polygons()
    osm_lan_points = load_osm_lan_points()
    geonames = load_geonames()

    geonames_collision_count = Counter((lat, lon) for _place, lat, lon in geonames.values())

    # ---- classify every lan-wide OSM point: in-kommun (for tier 1) + prefix stats ----
    per_postcode_osm: dict[str, Counter] = defaultdict(Counter)
    osm_unmatched_points = 0
    osm_stadsdel_not_in_crosswalk = Counter()
    prefix_total: Counter[str] = Counter()
    prefix_in_kommun: Counter[str] = Counter()
    osm_lan_all_postcodes: set[str] = set()

    for postcode, lat, lon in osm_lan_points:
        osm_lan_all_postcodes.add(postcode)
        prefix = postcode[:3]
        prefix_total[prefix] += 1
        stadsdel = assign_stadsdel(lat, lon, polys)
        if stadsdel is None:
            osm_unmatched_points += 1
            continue
        prefix_in_kommun[prefix] += 1
        omrade = crosswalk.get(stadsdel)
        if omrade is None:
            osm_stadsdel_not_in_crosswalk[stadsdel] += 1
            continue
        per_postcode_osm[postcode][omrade] += 1

    prefix_share = {
        p: (prefix_in_kommun[p] / prefix_total[p] if prefix_total[p] else 0.0) for p in sorted(prefix_total)
    }
    stockholm_only_prefixes = {p for p, share in prefix_share.items() if share >= STOCKHOLM_ONLY_PREFIX_THRESHOLD}

    training_postcodes = load_candidate_postcodes()

    # ---- tier 1 + tier 2 ----
    tier12_universe = set(per_postcode_osm) | training_postcodes
    mapped: dict[str, dict] = {}  # postcode -> row dict (final)
    straddlers = []
    unmapped_reasons: dict[str, str] = {}

    n_gate_blocked = 0
    n_tier1_blocked_by_min_n = 0
    for postcode in sorted(tier12_universe):
        prefix = postcode[:3]
        if not prefix_passes_tier12_gate(prefix, prefix_share):
            unmapped_reasons[postcode] = (
                f"tier1/2 gate: prefix {prefix} in-kommun share "
                f"{prefix_share.get(prefix, 0.0):.4f} < {MIN_PREFIX_SHARE_FOR_TIER12} gate "
                "-- not attempted (this prefix is overwhelmingly not in Stockholms kommun; "
                "any individual matched point is treated as a data error, not evidence)"
            )
            n_gate_blocked += 1
            continue

        osm_counts = per_postcode_osm.get(postcode, Counter())
        n_osm = sum(osm_counts.values())
        min_n_required = tier1_min_n_required(prefix, stockholm_only_prefixes)
        if 0 < n_osm < min_n_required:
            n_tier1_blocked_by_min_n += 1

        if n_osm >= min_n_required:
            omrade, n_win = osm_counts.most_common(1)[0]
            andel = n_win / n_osm
            mapped[postcode] = {
                "postnummer": postcode,
                "omrade": omrade,
                "andel_i_omrade": round(andel, 4),
                "n_adresser": n_osm,
                "metod": "osm_address_majority",
                "kalla": "OpenStreetMap addr:postcode (Overpass API, Stockholms lan query), ODbL",
                "granne_konflikt": "",
            }
            if andel < STRADDLE_THRESHOLD:
                straddlers.append((postcode, omrade, andel, n_osm, dict(osm_counts)))
            continue

        geo = geonames.get(postcode)
        if geo is None:
            unmapped_reasons[postcode] = f"tier1/2: no OSM evidence (n={n_osm}) and postcode not in GeoNames SE dump"
            continue
        place, lat, lon = geo
        collisions = geonames_collision_count[(lat, lon)]
        if collisions > GEONAMES_COLLISION_THRESHOLD:
            unmapped_reasons[postcode] = (
                f"tier1/2: no/insufficient OSM evidence (n={n_osm}) and GeoNames coordinate "
                f"for '{place}' is a low-precision city-level centroid shared by "
                f"{collisions} postcodes nationally (> {GEONAMES_COLLISION_THRESHOLD} threshold)"
            )
            continue
        stadsdel = assign_stadsdel(lat, lon, polys)
        if stadsdel is None:
            unmapped_reasons[postcode] = (
                f"tier1/2: no/insufficient OSM evidence (n={n_osm}) and GeoNames coordinate "
                f"for '{place}' ({lat},{lon}) falls outside every Stockholms kommun "
                "stadsdel polygon (i.e. outside Stockholms kommun -- correctly left unmapped)"
            )
            continue
        omrade = crosswalk.get(stadsdel)
        if omrade is None:
            unmapped_reasons[postcode] = f"GeoNames point falls in stadsdel '{stadsdel}' which is missing from the crosswalk"
            continue
        mapped[postcode] = {
            "postnummer": postcode,
            "omrade": omrade,
            "andel_i_omrade": 1.0,
            "n_adresser": n_osm,
            "metod": "geonames_point_in_polygon",
            "kalla": f"GeoNames SE postal code dump (CC BY 4.0), place='{place}'",
            "granne_konflikt": "",
        }

    n_tier1 = sum(1 for r in mapped.values() if r["metod"] == "osm_address_majority")
    n_tier2 = sum(1 for r in mapped.values() if r["metod"] == "geonames_point_in_polygon")

    # ---- tier 3: same-prefix nearest neighbour, Stockholm-only prefixes ----
    tier3_universe = {
        pc for pc in (osm_lan_all_postcodes | set(geonames.keys()) | training_postcodes) if pc[:3] in stockholm_only_prefixes
    }
    tier3_universe -= set(mapped)  # only postcodes tier 1/2 did not already resolve

    # reference points: tier1/2-mapped postcodes only (not other tier3 results),
    # grouped by prefix, sorted numerically
    by_prefix_refs: dict[str, list[int]] = defaultdict(list)
    for pc, row in mapped.items():
        by_prefix_refs[pc[:3]].append(int(pc))
    for p in by_prefix_refs:
        by_prefix_refs[p].sort()

    n_tier3 = 0
    n_tier3_conflict = 0
    for postcode in sorted(tier3_universe):
        prefix = postcode[:3]
        refs = by_prefix_refs.get(prefix, [])
        if not refs:
            unmapped_reasons[postcode] = (
                f"tier3: prefix {prefix} is Stockholm-only (share={prefix_share.get(prefix, 0):.3f}) "
                "but no postnummer with this prefix has been resolved by tier 1/2 yet -- no neighbour to borrow from"
            )
            continue
        target = int(postcode)
        idx = bisect.bisect_left(refs, target)
        below = refs[idx - 1] if idx > 0 else None
        above = refs[idx] if idx < len(refs) else None

        omrade_below = mapped[str(below).zfill(5)]["omrade"] if below is not None else None
        omrade_above = mapped[str(above).zfill(5)]["omrade"] if above is not None else None

        chosen_omrade, chosen_ref, conflict = choose_tier3_neighbor(target, below, above, omrade_below, omrade_above)
        chosen_dist = abs(target - chosen_ref)

        if conflict:
            n_tier3_conflict += 1

        mapped[postcode] = {
            "postnummer": postcode,
            "omrade": chosen_omrade,
            "andel_i_omrade": "",
            "n_adresser": "",
            "metod": "prefix_granne",
            "kalla": (
                f"nearest same-prefix mapped postnummer {str(chosen_ref).zfill(5)} "
                f"(distance {chosen_dist}); below={str(below).zfill(5) if below else None} ({omrade_below}), "
                f"above={str(above).zfill(5) if above else None} ({omrade_above})"
            ),
            "granne_konflikt": conflict,
        }
        n_tier3 += 1

    # tier 3 can resolve a postcode whose tier1/2 attempt failed (left a stale
    # reason in unmapped_reasons) -- drop any reason for a postcode that ended up
    # mapped by any tier.
    unmapped_reasons = {pc: reason for pc, reason in unmapped_reasons.items() if pc not in mapped}

    rows = [mapped[pc] for pc in sorted(mapped)]

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f, fieldnames=["postnummer", "omrade", "andel_i_omrade", "n_adresser", "metod", "kalla", "granne_konflikt"]
        )
        w.writeheader()
        w.writerows(rows)

    print(f"OSM lan-wide address points loaded: {len(osm_lan_points)}")
    print(f"OSM points with no stadsdel match (outside every polygon, i.e. outside kommun): {osm_unmatched_points}")
    print(f"GeoNames SE postcodes loaded: {len(geonames)}")
    print("\nPrefix Stockholm-only shares (100-199):")
    for p in sorted(prefix_total):
        print(f"  {p}: {prefix_in_kommun[p]}/{prefix_total[p]} = {prefix_share[p]:.3f}" + (" *** Stockholm-only ***" if p in stockholm_only_prefixes else ""))
    print(f"\nStockholm-only prefixes ({len(stockholm_only_prefixes)}): {sorted(stockholm_only_prefixes)}")

    print(f"\npostnummer blocked by the tier1/2 prefix gate (share < {MIN_PREFIX_SHARE_FOR_TIER12}): {n_gate_blocked}")
    print(f"postnummer with 1 OSM point but blocked by the borderline-prefix min-n={TIER1_MIN_N_FOR_NON_STOCKHOLM_ONLY_PREFIX} rule: {n_tier1_blocked_by_min_n}")
    print(f"\ntier1 (osm_address_majority): {n_tier1}")
    print(f"tier2 (geonames_point_in_polygon): {n_tier2}")
    print(f"tier3 (prefix_granne): {n_tier3} (of which neighbour conflict: {n_tier3_conflict})")
    print(f"total mapped: {len(mapped)}")
    print(f"total unmapped: {len(unmapped_reasons)}")
    print(f"straddling postnummer (tier1, <{STRADDLE_THRESHOLD:.0%} in winning omrade): {len(straddlers)}")
    for postcode, omrade, andel, total, counts in straddlers:
        print(f"  {postcode}: winner={omrade} ({andel:.0%}, n={total}) breakdown={counts}")
    print("\nunmapped postnummer and reasons:")
    for postcode, reason in sorted(unmapped_reasons.items()):
        print(f"  {postcode}: {reason}")


if __name__ == "__main__":
    main()
