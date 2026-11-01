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

## Postnummer -> kommun (added 2026-10-07, `build_postnummer_kommun.py`)

Output: `data/derived/postnummer_kommun.csv` (16,365 postnummer; columns postnummer, kommun_kod,
kommun_namn, lan_kod, metod, kalla, n_osm, andel_osm, kommun_kod_geonames, konflikt_geonames,
flaggor) plus `postnummer_kommun_coverage.json` (coverage, unmapped list, name checks) and
`postnummer_omrade_kommun_konflikter.csv` (cross-check against `postnummer_omrade.csv`;
**that file is not modified**).

Sources: GeoNames SE admin2 (CC BY 4.0, 2026-09-24); OSM address points in Stockholms län
(ODbL, 2026-09-24); **OSM admin_level=7 kommun boundaries for Stockholms län, 26 relations
with SCB code in tag `KNKOD`** (ODbL, Overpass, retrieved 2026-10-07, see
`sources/kommun_boundaries/SOURCE.md`). Method precedence and thresholds are documented in the
script docstring (`osm_majority` for blank/contradicting GeoNames when >= 3 OSM points and >= 80 %
agree; else `geonames_admin2`; else weak OSM; else GeoNames coordinate point-in-polygon unless the
coordinate is a generic centroid shared by > 200 postnummer). Outside Stockholms län there is no
boundary source: blank GeoNames kommun stays unmapped (2,317 postnummer).
Stockholms län: 3,613 of 3,856 known postnummer mapped (geonames_admin2 3,071; osm_majority 218;
osm_majority_svag 64; geonames_koordinat 260 = approximate); 243 unmapped, mostly the generic
"Stockholm" centroid prefixes 109xx (100) and 110xx (71). 7 straddling postnummer are flagged `grans`.
Kommun names of Sigtuna, Sollentuna, Upplands Väsby, Upplands-Bro (absent from GeoNames' filled
rows) come from the Mäklarstatistik xlsx, matched to the OSM relation by exact name.

## Register areas for the public BRF register (added 2026-10-13, PLAN-v3 2.2)

A **separate display layer**. It does not touch the valuation model, its 13 areas
(`stadsdel_omrade_crosswalk.csv`, `postnummer_omrade.csv`) or `src/lib/vardering`. Nothing
above in this README changed; every existing output is byte-identical.

### Files

| File | What |
|---|---|
| `registeromraden.csv` | The 19 register areas: slug (ascii, lowercase, hyphens), namn, grupp, ordning, motivering. |
| `stadsdel_registeromrade.csv` | All 117 SBK stadsdel polygons (names exactly as in `stadsdelar_fullsize.geo.json`, upper case) -> one area, with `motivering` and `kalla` per row and a `flagga` column for the two special rows. |
| `sources/basomradeslistan_2026_stadsdelar.csv` | Small tracked excerpt of the cited source: for each of the 117 polygons its Nyko-5 code, stadsdelsområde (SDO), SDN-del and PDF page in Stockholms stad's Basområdeslistan 2026. |
| `build_registeromrade.py` | Writes the two CSVs above from the PLAN-v3 2.2 allocation. **Fails** on an unmapped or double-assigned polygon, on an area that contradicts the polygon's SDO/SDN-del in the source, and on a group that contradicts its Nyko-2 stadsområde. |
| `tools/parse_basomradeslistan.py` | Regenerates the excerpt from the PDF text (the 48 MB PDF is not stored; how to extract the text is in the script docstring). |
| `build_postnummer_stadsdel.py` | Writes `data/derived/postnummer_stadsdel.csv` and `data/derived/postnummer_stockholm_ovriga.csv`. Reuses the functions of `build_postnummer_omrade.py` unchanged (same OSM points, prefix gate, Stockholm-only prefixes, tier-3 rule), one level finer. Exits non-zero if its postnummer set or methods differ from `postnummer_omrade.csv`. About 55 s. |
| `geokoda_adress.py` | Offline address -> stadsdel -> area geocoder (Nominatim + point-in-polygon). |
| `../../scripts/buildRegisterData.ts` | Generates `src/lib/register/data/postnummerStadsdel.data.ts` (6.4 KB raw, 2.3 KB gzip) from the CSVs. |

### Source and resolution of the taxonomy

Source for every row: Stockholms stad, **Basområdeslistan 2026** (Årsrapport, published 2026-06-02, by
Sweco for Stadsledningskontoret), https://start.stockholm/globalassets/start/om-stockholms-stad/utredningar-statistik-och-fakta/statistik/befolkning/basomradeslistan-2026.pdf,
retrieved 2026-10-13. Tabell 1 (PDF p.8) gives the stadsområden, Tabell 2 (PDF p.9-29) the stadsdelsområden
(SDO), SDN-delar, Nyko-5 stadsdelar and basområden. 103 of the 117 polygons match a Nyko-5 stadsdel by
exact name; the other 14 (inner-city polygons cut differently from Nyko-5, plus Hansta; Riddarholmen is not in
the source at all) are written by hand in `tools/parse_basomradeslistan.py`, each citing its Tabell 2 line.

The 19-area allocation is the PLAN-v3 2.2 table. The rows the plan marked uncertain, resolved from the source:

| Polygon | Resolved to | Basis |
|---|---|---|
| Beckomberga | Bromma (**not** Hässelby-Vällingby) | Nyko 22102, SDO 6 Bromma, SDN-del 06.1 Centrala Bromma (p.12) |
| Åkeshov, Bällsta, Norra/Södra Ängby | Bromma | Nyko 22113, 22105, 22108, 22111, SDN-del 06.1 (p.12) |
| Mariehäll, Ulvsunda Industriomr, Ulvsunda | Bromma | Nyko 22107, 22112, 22209, SDN-del 06.2 Alvik-Mariehäll (p.13) |
| Höglandet, Olovslund, Smedslätten, Nockebyhov | Bromma | Nyko 22202, 22205, 22206, 22204, SDN-del 06.3 Södra Västerled (p.13) |
| Hansta | Kista & Järva | not a Nyko-5 stadsdel: basområde 2260160 "Norra Akalla (inkl Hansta)" under 22601 Akalla, SDO Järva (p.9) |
| Liseberg, Långsjö | Älvsjö | Nyko 21203, 21205, SDN-del 21.1 Älvsjö (p.26) |
| Norra Djurgården | Djurgården & Gärdet | Tabell 2 footnote 1 to 12302 Djurgården: "här ingår de boende på Norra Djurgården" (p.18) |
| Långholmen, Reimersholme | Södermalm | basområden 1420410/1420420 under 14204 Reimersholme-Långholmen, SDO Södermalm (p.19) |
| Skeppsholmen | Gamla stan | basområde 1010360 under 10103 Jakob; Nyko prefix 101 = stadsområde 10 "Gamla stan - City-området" (p.15, p.8) |
| Riddarholmen | Gamla stan | **Not listed anywhere in the Basområdeslistan.** sv.wikipedia.org/wiki/Riddarholmen (retrieved 2026-10-13): "ingår tillsammans med Gamla stan i Södermalms stadsdelsområde". The polygon touches four other polygons, so geometry cannot decide it. Flagged `ej_i_kalla`. |
| Hammarbyhöjden | Skarpnäck | **Boundary case, flagged `grans`.** Footnotes 3-4 (p.22-23): the basområde Blåsut (1 746 of about 10 700 inhabitants, 2025-12-31) lies in the polygon but is counted in Enskede-Årsta-Vantör; the rest (8 955) is Skarpnäck. |

Other facts worth knowing: Essingeöarna is a product split of SDO Kungsholmen (Tabell 1 lists distrikt 133
"Essinge" separately); Hammarby sjöstad = polygon Södra Hammarbyhamnen (Nyko 14403, SDN-del 13.2 Sofia),
a product decision from the plan; Norrmalm = SDN-del 09.1 Södra Norrmalm.

**Grouping (`grupp`).** Stockholms stad's own Nyko-2 stadsområden (Tabell 1): 10-14 = "Inre staden" (we
write **Innerstaden**), 21 = **Söderort**, 22 = **Västerort**. There is no official "Norr" group in the source,
so none is defined: Norrmalm/Vasastan are Innerstaden and Kista/Järva/Hässelby are Västerort. Hammarby
sjöstad and Essingeöarna are Innerstaden because their Nyko codes are 14xxx and 133xx.

### Postnummer -> stadsdel (`data/derived/postnummer_stadsdel.csv`)

Columns: `postnummer, stadsdel, share, n_points, method, registeromrade, registeromrade_share, flagga`.
`method` is the same tier as in `postnummer_omrade.csv` (`osm_address_majority`, `geonames_point_in_polygon`,
`prefix_granne`); `share`/`n_points` are empty for `prefix_granne` (a neighbour's stadsdel, a weak call).
`registeromrade` is decided on the area level directly (the crosswalk is many to one), so a postnummer
straddling two stadsdelar of one area is not a boundary case; use it rather than re-deriving from `stadsdel`.

Coverage of Stockholms kommun (`postnummer_kommun.csv`, kommun_kod 0180: **1 576 postnummer**; run of 2026-10-13
with the 2026-09-24 OSM/GeoNames snapshots):

| | n |
|---|---:|
| postnummer with a stadsdel (= exactly the 1 440 rows of `postnummer_omrade.csv`) | 1 440 |
| of which `osm_address_majority` | 738 |
| of which `geonames_point_in_polygon` | 44 |
| of which `prefix_granne` | 658 |
| of the 1 440: kommun 0180 per `postnummer_kommun.csv` | 1 394 |
| of the 1 440: absent from `postnummer_kommun.csv` (all tier 3) | 42 |
| of the 1 440: placed in another kommun by `postnummer_kommun.csv` (12352, 12404, 12755, 12784, all Huddinge) | 4 |
| kommun-0180 postnummer **without** a stadsdel -> `postnummer_stockholm_ovriga.csv` | 182 |
| of those, no kommun flag (shipped as "Övriga Stockholm") | 152 |
| of those, flagged (23 approximate GeoNames coordinate, 7 weak OSM evidence; not shipped) | 30 |

Most of the 182 are in the 105xx, 106xx, 164xx, 173xx and 123xx prefixes (155 of them), which are not
"Stockholm-only" or never appeared in the OSM sample; they keep their kommun-level answer only.

Flags (`flagga`, `;`-joined): `granne_konflikt` 87 (tier 3, neighbours disagree on **area**), `grans` 9 (tier 1,
winning area < 80 % of the points), `kommun_avviker_0126` 4. In tier 1, 46 of 738 postnummer have a winning
**stadsdel** below 80 % (only 9 on the area level). `src/lib/register` does not ship the 4
`kommun_avviker` postnummer (they resolve to "unknown") and marks the 96 `grans`/`granne_konflikt` ones as
`osakert`. Postnummer per area (all 1 440): Östermalm 154, Norrmalm 149, Södermalm 122, Bromma 114,
Liljeholmen & Hägersten 112, Kungsholmen 94, Djurgården & Gärdet 92, Hässelby-Vällingby 81, Vasastan 78,
Kista & Järva 74, Enskede 71, Skarpnäck 59, Hammarby sjöstad 53, Älvsjö 50, Farsta 47, Skärholmen 40,
Årsta & Johanneshov 36, Essingeöarna 8, Gamla stan 6.

Known weakness: `prefix_granne` (658 of 1 440, 46 %) takes a neighbour's stadsdel and area; it is not
evidence about the postnummer itself. 11145/11146 still disagree with the workbook's Östermalm list (see the
Östermalm cross-check above); here 11145 resolves to Norrmalm.

### Address geocoding (`geokoda_adress.py`, offline only)

`street (+ postnummer, + ort)` -> Nominatim structured search -> lat/lon -> point-in-polygon against the 117
polygons -> stadsdel -> register area. Never call it from the Worker or a request path. Behaviour:

- User-Agent `Binfo/1.0 (contactbinfohere@gmail.com)` (Binfo's contact address), `countrycodes=se`, at most one
  request per 1.1 s, single-threaded, every response (hit or miss) cached on disk in
  `sources/raw/nominatim_cache.json` (gitignored) and never re-requested.
- Order: street+postnummer(+ort), then street+ort (flag `fallback_utan_postnummer`). A hit outside every
  polygon is `utanfor_stockholms_kommun`, never forced into an area. A hit that is not an address-level object
  (e.g. only the street was found) is flagged `osm_traff_ar_inte_adress`; a geocoded area that differs from the
  postnummer table's is flagged `avviker_fran_postnummer` (the geocode wins, review manually).
- Tested live 2026-10-13 (6 requests; recorded as `ml/tests/fixtures/nominatim_responses.json`, replayed in
  `ml/tests/test_registeromrade.py`, no network in the tests):
  Baltzar von Platens gata 6 (Brf Pontonjären 3, per the owner's listing, 112 42) -> KUNGSHOLMEN -> Kungsholmen;
  Tomtebogatan 31 (Bf Volontären 12 u.p.a, stated in its årsredovisning 2023) -> VASASTADEN -> Vasastan;
  Sockengatan 14 Helsingborg and Lyktvägen 79 Umeå (addresses from other test reports) -> outside Stockholms kommun.
  OSM gives Baltzar von Platens gata 6 the postcode 112 35, the owner's listing says 112 42 (same area either way).
- Nominatim policy (https://operations.osmfoundation.org/policies/nominatim/, read 2026-10-13): absolute max
  1 request/s, identifying User-Agent, attribution, results must be cached; "bulk geocoding of larger amounts
  of data is not encouraged"; scripts running longer than a day or at regular intervals are limited to 4
  requests/minute. A one-off importer run over a few hundred BRFs at <= 1 req/s fits; thousands of addresses or
  a recurring job need another geocoder (self-hosted Nominatim or a commercial service). **Decide before
  scaling up.**

### Licensing of the register layer (working interpretation, flagged for the owner)

- Stadsdel polygons: CC0 (Stockholms stad via github.com/krasch/stockholm-stadsdelar).
- OSM address points (postnummer tables) and Nominatim results: ODbL 1.0, (c) OpenStreetMap contributors. The
  working interpretation is that Binfo **publishes only one area name per BRF** (a produced work), not the derived
  datasets: `postnummer_stadsdel.csv` and the geocoder cache stay internal; the 6 KB generated
  `postnummerStadsdel.data.ts` ships area indexes per postnummer, no coordinates or addresses. **This is
  not legal advice and not signed off**; it is the same open question as for `postnummer_omrade.csv` above.
  Attribution "(c) OpenStreetMap contributors" belongs in the footer of the register pages (PLAN-v3 2.2).
- GeoNames (tier 2): CC BY 4.0, attribution "GeoNames".
- Basområdeslistan 2026: published by Stockholms stad; its licence was not checked. Only the factual excerpt
  (names, codes, SDO) is stored (`sources/basomradeslistan_2026_stadsdelar.csv`); the PDF is not committed.
