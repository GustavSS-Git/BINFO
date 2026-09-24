# Postnummer -> omrade mapping (task 4b)

Builds `data/derived/postnummer_omrade.csv`: for every Stockholm postnummer we could
resolve, the Binfo-defined area it belongs to (`omrade`), how confident that
assignment is (`andel_i_omrade`, tier 1 only), how much evidence backs it
(`n_adresser`, tier 1 only), **which method decided it** (`metod`), its source
(`kalla`), and whether it is a flagged boundary case (`granne_konflikt`, tier 3
only).

This is **Binfo's own approximation**, built independently from cited, openly
licensed sources. It is not guaranteed to match Svensk Maklarstatistik's own
(unpublished) postnummer-level boundaries; see "Known limitations" below.

> **v3.1 (2026-09-24, third follow-up / independent review).** Review found a real
> bug: tier 1 (and tier 2) had no cross-check against a prefix's overall in-kommun
> share, so a single stray/mis-tagged OSM point (or an imprecise GeoNames
> coordinate) could produce a false Stockholm-area assignment for a prefix that is,
> per our own lan-wide analysis, essentially 0% Stockholm. Concretely: postnummer
> **13155, 13171** (prefix 131, 0.04% in-kommun), **17164** (171, 0.3%), **18132**
> (181, 0.07%) and **19234** (192, 0.01%) had each been mapped to a Stockholm area
> off a single OSM point. Fixed by gating tier 1/2 on the prefix's in-kommun share
> (>=50%, see "Tier 1/2 prefix gate" below) and additionally requiring >=2 OSM
> points for tier 1 on prefixes that pass that gate but are not "Stockholm-only"
> (the borderline 106/123/164 prefixes). **Verified: zero training postnummer
> changed area as a result of this fix** (the bug only affected the broader
> general-product-mapping table, via prefixes no training postcode happens to use)
> -- 10 postnummer that were previously mapped are now correctly left unmapped
> (1,450 -> 1,440 total mapped); no postnummer's *area* changed. Model retraining
> was therefore not required for this fix (see `ml/artifacts/valuation-v2/MODEL_CARD.md`).
> New unit tests added in `ml/tests/test_mapping.py` (prefix gate, tier-1 min-n
> rule, tier-3 nearest-neighbour tie-break/conflict logic).

> **v3 (2026-09-24, second follow-up).** v2 left 44-45 of the ~650-651 training
> postcodes unmapped, all in prefixes GeoNames itself cannot resolve (its SE dump
> collapses onto one generic "Stockholm" centroid for most of 100xx-129xx, and its
> rows have an **empty admin2/municipality field**, so GeoNames alone cannot tell us
> kommun membership at all -- this is exactly why a third tier was needed). v3 adds a
> **third tier**: for a postcode whose 3-digit prefix is confirmed, from data, to be
> Stockholm-kommun-only, and which tiers 1-2 could not resolve, assign the area of
> the **numerically nearest already-mapped postcode with the same prefix**. Training
> coverage: **92.5% -> 99.9%** (file 1: 4,967/4,973 rows, 1 unique postcode
> unmapped; file 2: 4,966/4,973 rows, 2 unique postcodes unmapped). See "Coverage
> (v3)" below for exactly which postcodes remain unmapped and why (both are
> legitimate "stays unmapped" cases per the owner's own rule, not gaps).

## Licensing / attribution (read this before using the output elsewhere)

- **OpenStreetMap data is (c) OpenStreetMap contributors, licensed ODbL 1.0.**
  Attribution is required wherever this mapping (or anything visibly derived from
  it) is used or displayed: **"(c) OpenStreetMap contributors"**, with a link to
  https://www.openstreetmap.org/copyright. v3 adds a second OSM query (Stockholms
  **län**, not just kommun -- see "Stockholm-only prefixes" below); same licence,
  same attribution requirement.
- **ODbL share-alike note (flagging for the owner, not resolving it here):**
  `data/derived/postnummer_omrade.csv` is built substantially from ODbL-licensed OSM
  data (753 of 1,450 mapped rows are direct OSM evidence, `metod=osm_address_majority`;
  the 658 `prefix_granne` rows are also indirectly derived from OSM reference points)
  and is arguably a "produced work" / "derivative database" under ODbL section 4.
  ODbL's share-alike clause may require that if this CSV (or a database substantially
  built from it) is itself redistributed as data, it be offered under ODbL too --
  this does **not** clearly extend to the Binfo product's price valuations themselves
  (a "produced work" under ODbL's own carve-out), but the mapping CSV as a standalone
  dataset is the part to get legal sign-off on before, e.g., selling it or shipping
  it verbatim to a third party. **Flagging this for the owner to raise -- not
  resolved in this change.**
- GeoNames data is CC BY 4.0: attribution required ("GeoNames", link to
  https://www.geonames.org).
- Stockholm stad's stadsdel boundaries are CC0 (no attribution legally required, but
  cited below anyway for provenance).

## Sources

| # | What | Publisher | Licence | URL | Retrieved |
|---|---|---|---|---|---|
| 1 | Stadsdelar (117 Stockholm neighbourhood boundaries), "Stadskarta" dataset (last updated 2021-04-13), redistributed as ready-to-use GeoJSON | Stockholm stad (Stadsbyggnadskontoret), redistributed by github.com/krasch | CC0 1.0 | https://github.com/krasch/stockholm-stadsdelar (original: https://dataportalen.stockholm.se/) | 2026-09-24 |
| 2 | Address points tagged `addr:postcode` inside OSM relation 398021 ("Stockholms kommun") -- used for tier 1 | OpenStreetMap contributors, via the official Overpass API | ODbL 1.0 (attribution required) | https://overpass-api.de/api/interpreter | 2026-09-24 |
| 3 | **New in v3**: address points tagged `addr:postcode` inside OSM relation 54391 ("Stockholms lan", the whole county, superset of kommun) -- used for the Stockholm-only-prefix analysis and as the tier-3 candidate universe | OpenStreetMap contributors, via the official Overpass API | ODbL 1.0 (attribution required) | https://overpass-api.de/api/interpreter | 2026-09-24 |
| 4 | Stockholms kommun / lan boundary (OSM relation ids, used only to scope the two Overpass queries above) | OpenStreetMap contributors, via Nominatim | ODbL 1.0 | https://nominatim.openstreetmap.org/search | 2026-09-24 |
| 5 | SE postal-code dump (postcode, place name, lat/lon, accuracy) for all ~18,900 Swedish postal codes | GeoNames | CC BY 4.0 (attribution required) | https://download.geonames.org/export/zip/SE.zip | 2026-09-24 |
| 6 | Stadsdelsnamnd/stadsdelsomrade composition, used only to build the stadsdel -> omrade crosswalk | Swedish Wikipedia, itself citing Stockholms stad's official district division | CC BY-SA (used as a pointer, not redistributed as data) | sv.wikipedia.org, various pages, see `build_crosswalk.py` | 2026-09-24 |
| 7 | Svensk Maklarstatistik's own use of "Centrala Stockholm" as a rollup label (cited to explain why our usage diverges) | Svensk Maklarstatistik | n/a (referenced only) | https://www.maklarstatistik.se/om-statistiken/geografisk-indelning/ | 2026-09-24 |
| 8 | 43-postcode Östermalm cross-check list | Provided in `data/raw/Transaction data for valuation.xlsx`, sheet "Postal code mapping" | n/a (given input data) | — | — |

Raw downloads are kept at `ml/mapping/sources/raw/` (**gitignored** -- confirmed
added to `.gitignore` by the supervisor) for local reproducibility:
`osm_addr_postcode_raw.json` (kommun-scoped, 11 MB), `osm_addr_postcode_lan_raw.json`
(**new in v3**, lan-scoped superset, 43 MB), `geonames_SE_postal_codes.txt` (1.2 MB),
`geonames_SE_readme.txt`. The stadsdel boundaries (`stadsdelar_fullsize.geo.json`,
720 KB, CC0) and their licence file stay directly under `ml/mapping/sources/` and are
small enough to track in git.

## Method (three tiers, in order; a postcode is resolved by the first tier that succeeds)

**Tier 1/2 prefix gate** (new in v3.1, bug fix): before either tier 1 or tier 2 is
attempted for a postnummer, its 3-digit prefix must clear **50% in-kommun share**
(computed the same way as the Stockholm-only-prefix analysis below, from the
county-wide OSM sample). A prefix below this bar is never attempted by tier 1 or 2
at all -- left unmapped with the reason logged, regardless of how much individual
point evidence a specific postnummer within it happens to have. Without this gate,
a single stray/mis-tagged OSM point was enough to produce a false Stockholm-area
assignment for a prefix that is, per the same lan-wide data, essentially 0%
Stockholm -- see the v3.1 changelog note above for the concrete postnummer this
affected. 50% is a wide, safe margin (not tuned): every prefix we found is either
<=3% or >=95.5% in-kommun, so anything between roughly 3% and 95% would work
identically with this data. Additionally, a prefix that clears the 50% gate but is
**not** "Stockholm-only" (>=99%, see below) -- i.e. the genuinely-mixed
106/123/164 prefixes -- requires **>=2** OSM points (not 1) before tier 1 trusts
its majority vote, since a single point in a demonstrably-mixed prefix is weaker
evidence than a single point in an established >=99%-Stockholm prefix.

**Tier 1 -- OSM address-point majority**: every OSM node/way tagged `addr:postcode`
inside Stockholms kommun (source #2) is point-in-polygon'd against the 117 stadsdel
polygons (crosswalked to one of the 13 areas via `stadsdel_omrade_crosswalk.csv`).
For a postnummer whose prefix passes the gate above, the majority-vote omrade is
used once the minimum point count for that prefix (1 or 2, see above) is met.
`metod=osm_address_majority`. 738 postnummer resolved this way (was 753 before the
gate fix -- see "Coverage" below for exactly what changed).

**Tier 2 -- GeoNames point-in-polygon fallback**: for a postnummer whose prefix
passes the gate above but tier 1 could not resolve, look it up in GeoNames' SE
dump (source #5) and point-in-polygon its (lat, lon), but only if that coordinate
is not one of the handful of low-precision, nationally-collided city centroids --
see "GeoNames precision" below. `metod=geonames_point_in_polygon`. 44 postnummer
resolved this way (was 39). **Note: GeoNames' SE rows have an empty admin2
(municipality) field, so GeoNames alone cannot tell us kommun membership at all**
-- this is exactly the gap tier 3 closes (and part of why the prefix gate above
was needed too).

**Tier 3 -- same-prefix nearest neighbour** (new in v3): for a postnummer tiers 1-2
could not resolve, if its 3-digit prefix is a **Stockholm-only prefix** (see below),
find the numerically nearest postnummer with the same prefix that tier 1 **or** tier
2 resolved (deliberately not other tier-3 results, so uncertainty does not chain),
and use its omrade. If both a "below" and "above" same-prefix neighbour exist, pick
whichever is numerically closer; **on an exact tie, pick the lower number** (the
tie rule the brief asked for, or "say what you do instead" -- this is what we do).
If the two neighbours disagree on omrade, the postnummer is flagged
(`granne_konflikt=True`) but still assigned (to the closer, or lower-numbered on a
tie) -- flagged as a boundary case, not left unmapped. `metod=prefix_granne`. **658
postnummer resolved this way, of which 58 (8.8%) are flagged neighbour conflicts.**

### Stockholm-only prefixes -- decided from data, not memory

We queried OSM for every `addr:postcode` point in the **whole of Stockholms lan**
(source #3, 140,051 points with a valid 5-digit postcode), then, for every distinct
3-digit prefix in [100, 199] (plus whatever else appeared), computed the share of
that prefix's points that fall inside the Stockholms **kommun** polygon. A prefix is
"Stockholm-only" if that share is **>= 99%**.

The data separates extremely cleanly into two clusters: prefixes that are ~0%
inside the kommun (a different municipality entirely -- e.g. 131: 2/4,966 = 0.0%,
187: 0/7,810 = 0.0%) and prefixes that are >=98.9% inside it, with only three
borderline cases, all explained by sample size or a genuinely split prefix:

| Prefix | In-kommun share | n | Stockholm-only (>=99%)? | Note |
|---|---:|---:|---|---|
| 106 | 95.5% | 22 | No | small sample (1 of 22 points outside) -- likely noise, but the rule is mechanical and does not special-case it |
| 123 | 97.1% | 1,111 | No | large sample, 32 points genuinely outside the kommun -- a real split prefix (product falls back to the Stockholm-wide model here, correctly) |
| 164 | 98.9% | 352 | No, by 0.1 point | 4 of 352 points outside -- just misses the bar |

Every other prefix in [100, 199] is either exactly 0.000 or >=99.3%. 99% was chosen
(rather than e.g. 95%) specifically so a prefix with a real, non-trivial out-of-kommun
share (like 123) is excluded, while remaining permissive enough that a prefix with
only a couple of near-boundary or mis-geocoded points still qualifies -- with data
this cleanly separated, the exact cutoff barely matters between roughly 2% and 95%;
99% is the conservative end of that range, and every prefix's share (100-199, plus
the handful of out-of-range codes the lan query also picked up: 551, 619, 760-764,
all 0%) is in `build_postnummer_omrade.py`'s output and reproducible by re-running it.

**Stockholm-only prefixes found (30):** 100, 101, 102, 103, 104, 107, 111, 112, 113,
114, 115, 116, 117, 118, 120, 121, 122, 124, 125, 126, 127, 128, 129, 158, 161, 162,
163, 165, 167, 168.

**Not included, per "decided from data, not memory":** 105, 108, 109, 110, 119 never
appeared anywhere in the county-wide OSM sample, so we have zero evidence for them
either way -- a postnummer with one of those prefixes is not eligible for tier 3 and
stays unmapped if tiers 1-2 also fail (did not occur for any training postcode in
this run).

### GeoNames precision (tier 2, unchanged reasoning from v2)

GeoNames' own readme states lat/lng are "determined with an algorithm that searches
place names ... using administrative divisions and numerical vicinity" -- i.e. not
always address-level, and (new finding, v3) **the admin2 (municipality) column is
empty for every SE row**, so GeoNames cannot itself answer "is this postcode in
Stockholms kommun". Of 18,887 SE postal codes, only 1,613 distinct coordinates exist;
the worst offender is 1,141 different postcodes (essentially the whole 100xx-129xx
central-Stockholm block) all resolving to one point labelled just "Stockholm". We
only trust a GeoNames coordinate shared nationally by **<=200 postnummer**
(`GEONAMES_COLLISION_THRESHOLD`), chosen to sit in the clean gap between genuinely
area-distinguishing neighbourhood names (highest: Bromma, 111 postcodes) and the ~19
unusable big-city centroids (all >120, topped by Stockholm's 1,141).

## Candidate universe

- **Tier 1/2** (unchanged since v2): every postnummer OSM found >=1 point for inside
  Stockholms kommun, union every postal code in Binfo's two raw transaction
  workbooks.
- **Tier 3** (broader, per the brief): every postnummer that appears *anywhere*
  in the county-wide OSM sample, in GeoNames' SE dump, or in either transaction
  workbook, **whose 3-digit prefix is Stockholm-only**. This is intentionally wider
  than "just the training postcodes" -- it produces a much more complete general
  product-level table for the whole Stockholm-only prefix range, not just the ones
  our training data happens to use.

## Coverage (v3.1, after the prefix-gate bug fix)

- **1,440 unique postnummer mapped** (738 tier 1 + 44 tier 2 + 658 tier 3), down
  from 1,450 pre-fix (792 in v2) -- the drop is entirely the 10 postnummer the gate
  fix correctly un-mapped (see v3.1 changelog note above); no postnummer's *area*
  changed, and **zero training postnummer were affected either way** (verified by
  diffing the pre-fix and post-fix CSVs against both raw workbooks' postal_code
  columns).
- **Training file 1**: 4,973 rows have a postal_code; **4,967 (99.88%)** map
  (unchanged by the gate fix). 650 unique postcodes appear; **1 remains unmapped:
  12364** (prefix 123 -- confirmed *not* Stockholm-only, see table above; correctly
  falls back to the Stockholm-wide model per the brief's own rule for this case).
- **Training file 2**: 4,973 rows have a postal_code; **4,966 (99.86%)** map
  (unchanged by the gate fix); 651 unique postcodes, **2 unmapped: 12364** (as
  above) and **61071** (prefix 610 -- zero evidence anywhere of being a Stockholm
  postcode at all; its GeoNames entry, "Vagnhärad", is a real place ~70 km south of
  Stockholm, correctly outside every kommun polygon). Both remaining cases are
  exactly the kind of "stays unmapped, falls back to the Stockholm-wide model" case
  the brief describes as correct -- not a residual gap.
- **Per-area postnummer counts** (all 1,440 mapped postnummer):

  | Omrade | Postnummer mapped |
  |---|---:|
  | Östermalm | 246 |
  | Vasastan-Norrmalm | 227 |
  | Södermalm | 175 |
  | Hägersten-Liljeholmen | 162 |
  | Enskede-Skarpnäck | 122 |
  | Bromma-Västerled | 114 |
  | Kungsholmen | 94 |
  | Farsta-Vantör | 91 |
  | Hässelby-Vällingby | 81 |
  | Spånga-Kista | 74 |
  | Brännkyrka-Skärholmen | 40 |
  | Essingen | 8 |
  | Centrala Stockholm | 6 |

- **Per-tier counts**: `osm_address_majority` 753, `geonames_point_in_polygon` 39,
  `prefix_granne` 658 (of which 58, 8.8%, flagged `granne_konflikt=True`).

## Straddling postnummer (tier 1, <80% of matched addresses in the winning area)

Unchanged from v2 (tier 3 does not touch already-tier-1-mapped postcodes):

| Postnummer | Winning area | Share | n | Breakdown |
|---|---|---:|---:|---|
| 11358 | Ostermalm | 60% | 5 | Vasastan-Norrmalm: 2, Ostermalm: 3 |
| 11427 | Ostermalm | 67% | 3 | Centrala Stockholm: 1, Ostermalm: 2 |
| 11550 | Ostermalm | 75% | 4 | Vasastan-Norrmalm: 1, Ostermalm: 3 |
| 12542 | Farsta-Vantor | 68% | 158 | Hagersten-Liljeholmen: 51, Farsta-Vantor: 107 |
| 12557 | Farsta-Vantor | 52% | 21 | Hagersten-Liljeholmen: 10, Farsta-Vantor: 11 |

## Tier-3 neighbour-conflict boundary cases

658 postnummer were resolved via tier 3; **58 (8.8%)** had disagreeing below/above
neighbours (`granne_konflikt=True` in the CSV) -- these sit right on an area
boundary within a Stockholm-only prefix, most visibly in the low 100xx range (e.g.
postnummer 10028-10040 alternate between Kungsholmen/Vasastan-Norrmalm/Ostermalm
block by block; 10329-10335 sit between Vasastan-Norrmalm and Ostermalm). Every
conflict row still gets an assignment (nearest, tie->lower), but a consumer that
cares about boundary precision should treat `granne_konflikt=True` rows as
lower-confidence than tier 1/2 rows or non-conflicting tier-3 rows.

## Ostermalm cross-check (43 postcodes from the workbook's "Postal code mapping" sheet)

Re-run against v3: **41 of 43 (95%) agree** (up from 37/43 in v1/v2; the 4
previously-unmapped codes, including 10451, are now all mapped via tier 2/3).

- **11145, 11146**: unchanged from v1/v2 -- our mapping puts these in
  **Vasastan-Norrmalm** (100% of matched OSM addresses, tier 1, n=12 and n=10), not
  Ostermalm. Still flagged, not resolved (geographically the 111xx range is centred
  on Norrmalm/Vasastan, so this looks more likely to be an inaccuracy in the
  workbook's own reference sheet, but we cannot rule out we are wrong instead).
- Every other previously-disagreeing or missing code now agrees, including
  **11441, 11450, 11453** (now tier-3-resolved to Ostermalm, agreeing with the
  sheet) and **10451** (now tier-3-resolved, also Ostermalm, agreeing).

## Known limitations

- **2 postcodes (1 in training file 1, 2 in file 2) remain genuinely unmapped**,
  both for principled, documented reasons (prefix not confirmed Stockholm-only;
  postcode confirmed outside the kommun entirely) -- this is the honest, data-backed
  limit, not guesswork.
- The Stockholm-only-prefix rule is necessarily prefix-level (3 digits), not
  postcode-level: a prefix just under the 99% bar (like 123, or 164 at 98.9%) is
  entirely excluded from tier 3 even though the large majority of its own postcodes
  probably are genuinely in Stockholm -- we chose not to override the mechanical
  rule for individual postcodes within a failing prefix, to keep the method
  reproducible and free of manual judgement calls.
- Tier 3 is a neighbour heuristic, not direct evidence -- `andel_i_omrade` and
  `n_adresser` are not meaningful for `prefix_granne` rows (left blank in the CSV);
  `granne_konflikt` is the closest signal to a confidence flag for those rows.
- The tier 1/2 prefix gate (50%) and the borderline-prefix min-n=2 rule are both
  mechanical, prefix-level thresholds, same trade-off as the Stockholm-only-prefix
  rule above: a genuinely-Stockholm postnummer whose prefix happens to be
  overwhelmingly non-Stockholm in the OSM sample (extremely unlikely given how
  cleanly the data separates, but not logically impossible) would incorrectly stay
  unmapped rather than being rescued by manual override -- deliberate, for
  reproducibility.
- OSM address tagging in Sweden is incomplete and uneven; `n_adresser` for
  `osm_address_majority` rows is the number of *OSM-tagged* points, not the true
  address count.
- The stadsdel -> omrade crosswalk is Binfo's own product decision (see
  `build_crosswalk.py`), not independently verifiable against a single published
  Maklarstatistik source, beyond the 43-postcode Ostermalm cross-check above.
- "Centrala Stockholm" in our output does **not** match Svensk Maklarstatistik's own
  use of that label (see source #7) -- ours is a small, disjoint set of 3 stadsdelar
  (Gamla Stan, Riddarholmen, Skeppsholmen, 6 postnummer); theirs is a rollup of 5
  other areas.
- Reproducibility: re-running `build_postnummer_omrade.py` against freshly
  downloaded OSM/GeoNames snapshots will not be byte-identical (both sources change
  over time); the raw snapshots used for this deliverable are preserved locally in
  `ml/mapping/sources/raw/` (gitignored).
- **Licensing**: see "Licensing / attribution" at the top of this file.

## Files

- `ml/mapping/build_crosswalk.py` — generates `stadsdel_omrade_crosswalk.csv` (unchanged since v1).
- `ml/mapping/stadsdel_omrade_crosswalk.csv` — 117 rows: stadsdel, omrade, motivering.
- `ml/mapping/build_postnummer_omrade.py` — generates `data/derived/postnummer_omrade.csv` (tier 1/2 prefix gate + tier 1 OSM kommun + tier 2 GeoNames + tier 3 same-prefix neighbour, v3.1).
- `ml/tests/test_mapping.py` — unit tests for the pure decision functions (`prefix_passes_tier12_gate`, `tier1_min_n_required`, `choose_tier3_neighbor`).
- `ml/mapping/sources/` — small, tracked files: `stadsdelar_fullsize.geo.json` (CC0), `stadsdelar_LICENSE.txt`.
- `ml/mapping/sources/raw/` — large, gitignored, re-fetchable raw downloads: `osm_addr_postcode_raw.json` (kommun), `osm_addr_postcode_lan_raw.json` (lan, new in v3), `geonames_SE_postal_codes.txt`, `geonames_SE_readme.txt`.
- `data/derived/postnummer_omrade.csv` — final output: postnummer, omrade, andel_i_omrade, n_adresser, metod, kalla, granne_konflikt.
