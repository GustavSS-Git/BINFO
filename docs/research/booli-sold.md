# Research: Booli REST API sold data (earlier sales, comparables, training data)

Written 2026-10-31 on branch `booli-api` (plan: `docs/plans/booli-api.md` §5). Research only, no
app code. All numbers come from signed calls with the student key on 2026-10-31. Keys are masked
as `<CALLER>` / `<HASH>`. The throwaway scripts and raw JSON live in the session scratchpad and are
not in the repo.

**API calls used: 250 of 250.** 88 returned 200, 2 were deliberate error tests (400), and **160
were wasted**: a pagination loop sent an empty `areaId` and kept going until the script's
budget guard stopped it (all 160 got `400 MISSING_REQUIRED_SEARCH_ARGUMENTS`). The good side
effect is that ~160 calls in under two minutes were never throttled. A few planned checks were
dropped because of this. They are marked "not verified" below.

## Summary

1. **Filters that work on `sold`:** `areaId`, `q` (resolves to ONE area), `center`+`dim`, `bbox`
   (lat,lng,lat,lng), `minSoldDate`/`maxSoldDate` (inclusive; `YYYYMMDD` and `YYYY-MM-DD` both
   work), `minPublished`, `objectType`, `minRooms`/`maxRooms`, `minLivingArea`/`maxLivingArea`,
   `sort`+`direction`, `limit` (**max 1000**, larger values are capped silently) and `offset`.
   Unknown params are ignored. Bad values give `400 INVALID_SEARCH_ARGUMENTS`.
2. **`q` is not an address search.** `q=Norrbackagatan 16` resolves to the whole street
   (`areaId 90911`, 834 sales), so the house number is ignored. `q=11341` (a postnummer) gives 0.
   To get one address you query the street (or a ~40 m box around the building) and filter
   `streetAddress` on our side.
3. **Same flat** = same `streetAddress` + same `apartmentNumber` (4-digit lägenhetsnummer, present
   on 75 % of rows) + `livingArea` within 1 m². Do not use `rooms`: it changes between sales of
   the same flat. Sankt Eriksgatan 31A lgh 1301 (54 m²) was sold 2020-01-29 for 5 220 000 kr and
   2026-10-30 for 6 025 000 kr. This is the same sale the website's GraphQL showed.
4. **Same building:** full history back to 2012, with no 12-row cap (the website's
   `comparableSales` stops at 12). Sandelsgatan 35 has 48 sales since 2012, and 9 of its flats
   were sold more than once.
5. **Same BRF:** no field identifies the förening (no orgnr, name or fastighetsbeteckning). The
   only route is the BRF's cited addresses from our register (`forening_adress`, `kalla='rapport'`)
   → one street query per street → filter by house number.
6. **Comparables nearby are plentiful in the inner city.** For flats sold Mar–Aug 2026 within
   ±0.5 rum and ±20 % boarea, a 500 m radius gives 59–191 per test address (Vasastan,
   Kungsholmen, Östermalm, Södermalm).
7. **History starts in August 2012** (Vasastan: 212 sales in 2012, 1 345–3 101 per full year
   after that, 0 before 2012).
8. **Coverage is about 3.2× our training data.** For Stockholms kommun, flats, Jan–Aug 2026,
   Booli has 15 815 sales and our Mäklarstatistik extract has 4 973 rows, a constant ~31 % in
   every month. 82 % of the extract's rows have a Booli match, and in 77 % of rows kr/m² agrees
   within 1 %.
9. **No rate-limit headers and no throttling were seen.** Responses took 100–390 ms. `sold/{id}`
   returns the same object as the search row and nothing more.
10. **Proposal:** a "Sålt i huset" list plus a "Sålt i närheten" median with n, shown in the
    Priskoll result, the report's "Priset" section and the PDF, as a reference beside the
    valuation (never an input to it). Cache per street/box. Feature flag for key expiry.
    One-off training pull only after the terms are confirmed in writing. Risks: key expiry
    (~3 months), `bid`/`bobot` price sources, duplicate records, old prices not indexed.

## 1. Parameters

Baseline: `GET /sold?q=vasastan&limit=1` → `totalCount 30964`, echoed
`"searchParams":{"areaId":115349}`. The API echoes every filter it parsed in `searchParams`,
which is the best evidence that a filter was applied.

Example request shape (masked):

```
GET https://api.booli.se/sold?areaId=115349&minSoldDate=20260101&maxSoldDate=20260831&limit=1
    &callerId=<CALLER>&time=<UNIX_SECONDS>&unique=<16 HEX>&hash=<HASH>
Accept: application/vnd.booli-v2+json
```

| Parameter                                                    | Result                          | Evidence (totalCount vs 30 964 unless stated)      |
| ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------- |
| `q=vasastan`                                                 | works, resolves to one area     | echo `areaId 115349`                               |
| `q=Norrbackagatan 16` / `…, Stockholm` / `Norrbackagatan`    | **street only, number ignored** | all three → `areaId 90911`, 834                    |
| `q=11341` (postnummer)                                       | **0 hits**                      | echo `areaId "11341"` (used literally)             |
| `q=Brf Pontonjären`                                          | 0 hits                          | no BRF search                                      |
| `areaId=115349`                                              | works                           | 30 964 (same as `q`)                               |
| `areaId=1` (Stockholms kommun), `2` (län)                    | works                           | Jan–Aug 2026 flats: 15 815 / 27 103                |
| `areaId=<Street>` (from `areas?q=`)                          | works                           | Baltzar von Platens gata `97266` → 270             |
| `areaId=<Postnummer>` (from `areas?lat&lng`)                 | **not verified** (budget)       | `860838` = 11341 exists                            |
| `center=lat,lng&dim=200,200`                                 | works                           | 525 around Norrbackagatan 16                       |
| `center=…&dim=50,50`                                         | works                           | 99                                                 |
| `center` without `dim`                                       | works with a default box        | 114 (default size unknown)                         |
| `bbox=59.3380,18.0310,59.3398,18.0340` (latS,lngW,latN,lngE) | works                           | 509                                                |
| `bbox` in lng,lat order                                      | silently 0                      | 0                                                  |
| `minSoldDate=20260101` or `=2026-01-01`                      | works, same                     | 2 668 (echo `"2026-01-01 00:00:00"`)               |
| `maxSoldDate=20260831`                                       | works, **inclusive**            | 30 308; min=max=20260831 → 18 sales on 31 Aug      |
| min + max Jan–Aug 2026                                       | works                           | 2 012                                              |
| `minPublished=20260101`                                      | works                           | 2 489                                              |
| `objectType=Lägenhet` / `Villa`                              | works                           | 30 956 / 1 (echo lower-cased array)                |
| `minRooms=3` / `maxRooms=1`                                  | works                           | 10 496 / 5 089                                     |
| `minLivingArea=100` / `maxLivingArea=30`                     | works                           | 3 053 / 2 782                                      |
| `sort=soldDate`                                              | works, **ascending** by default | echo `direction "ASC"`, first row 2012-08-24       |
| `sort=soldDate&direction=desc`                               | works                           | first rows 2026-10-30                              |
| `sort=published`, `sort=soldPrice`                           | work                            | echoed                                             |
| `sort=-soldDate`, `orderBy=…&order=…`                        | ignored                         | default order                                      |
| no `sort`                                                    | **not date-ordered**            | first 1 000 rows mix 2019–2026; always pass `sort` |
| `limit=500` / `1000` / `2000`                                | max **1000**                    | 2000 → `"limit":1000`, 1 000 rows                  |
| `offset=30960&limit=5`                                       | works                           | 4 rows (the tail)                                  |
| `minRooms=abc`                                               | `400`                           | body `INVALID_SEARCH_ARGUMENTS` (plain text)       |
| no area/geo param at all                                     | `400`                           | body `MISSING_REQUIRED_SEARCH_ARGUMENTS`           |
| `foo=bar`                                                    | ignored                         | 30 964                                             |

**`listings`** shares the search engine (one call, budget): `listings?center=…&dim=1000,1000&
minRooms=3&maxLivingArea=90&objectType=Lägenhet&sort=published&direction=desc&limit=3` → 200,
`totalCount 19`, all filters echoed plus a default `"upcomingSale":0`. The listing-only params
were not tested separately.

**`dim`** appears to be the full box width/height in metres, not a radius. With `dim=40,40`
around Sankt Eriksgatan 31A, the building next door at 31B (~27 m away) was not returned. This
is weak evidence from one case.

**`areas`:** `areas?q=<street>` returns at most 9 areas. Same-name streets in other kommuner
come back too (Norrbackagatan exists in 9 kommuner), so filter on
`parentName`/`parentBooliId`. `areas?q=11354` → 0, so a postnummer is not searchable by name.
`areas?lat&lng` returns 14 areas for one point, with these types: `Kommun`, `Län`, `Land`,
`Postnummer` (parent `Postort`), named districts with type `"undefined"` (Vasastan,
Vasastan/Norrmalm, Birkastan, Sankt Eriksplan, Rörstrand, Stockholms innerstad, Innanför
tullarna), `Indexområde` (Storstockholm), `Elområde` (SE3) and `deso` (SCB DeSO code
`0180C4660`).

## 2. Matching

### (a) Same flat

- `apartmentNumber` is the 4-digit lägenhetsnummer ("1301" = plan 3) on 74.6 % of rows (11 798
  of 15 815). Its floor code agrees with `floor` on 74 % of rows. `floor` can be 1.5 and is
  sometimes counted differently (entresol/souterrain), so do not demand agreement.
- **Rule:** normalised `streetAddress` equal AND `apartmentNumber` equal AND `|livingArea Δ| ≤ 1`.
  Never require `rooms`. Baltzar von Platens gata 7C lgh 1306 (55.5 m²) is listed as 2 rum in
  2025 and 3 rum in 2026, and gata 4 lgh 1401 is 84 m² in 2018 and 83 m² in 2026.
- Without `apartmentNumber` (25 % of rows), floor + livingArea at the same address is only
  "possibly the same flat". Do not present it as the same flat.
- **Duplicates:** 13 cases in Jan–Aug 2026 of the same address + lgh + date under two `booliId`s
  (the flat was re-listed, e.g. Idungatan 5 lgh 1504, 4 650 000 twice; Björnsonsgatan 138 lgh 1502,
  3 660 000 vs 3 650 000). Dedupe on address + lgh + soldDate, keeping the `maklare` row.

Examples (all real API rows):

| Address                                  | lgh         | Sales                                                              |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------ |
| Sankt Eriksgatan 31A (Kungsholmen)       | 1301, 54 m² | 2020-01-29 5 220 000 · 2026-10-30 6 025 000                        |
| Sandelsgatan 35 (Östermalm)              | 1402, 70 m² | 2014-04-03 4 525 000 · 2016-10-21 7 250 000 · 2020-11-19 7 900 000 |
| Sandelsgatan 35                          | 1504, 84 m² | 2021-08-26 10 350 000 · 2026-04-20 13 100 000                      |
| Baltzar von Platens gata 5 (Kungsholmen) | 1406, 39 m² | 2015-10-19 3 570 000 · 2021-02-17 4 500 000 · 2026-03-20 5 200 000 |
| Baltzar von Platens gata 6               | 1303, 38 m² | 2018-05-09 3 635 000 · 2026-04-27 4 500 000                        |

Share of flats with a repeat sale since 2012: Baltzar von Platens gata 29 of 117 (lgh known), and
Sandelsgatan 35 9 flats. In Stockholms kommun, 47 flats were sold twice within Jan–Aug 2026 alone.

### (b) Same building / address

Two routes, both followed by a client-side filter on `streetAddress`:

1. **Street:** `areas?q=<street>` → the `Street` area whose parent is the right kommun →
   `sold?areaId=<street>&sort=soldDate&direction=desc&limit=1000`. One call for most streets
   (Baltzar von Platens gata: 270 sales over 9 house numbers). Long streets need paging
   (Norrbackagatan: 834 sales; Sankt Eriksgatan is longer).
2. **Box around the building** (when we have coordinates, i.e. from a Booli listing):
   `sold?center=<lat>,<lng>&dim=40,40&sort=soldDate&direction=desc&limit=1000` → one call, a
   few dozen rows. Sankt Eriksgatan 31A → 45 rows ("Sankt Eriksgatan 31" 23, "31A" 12, "29" 10).
   Sandelsgatan 35 → 59 rows (48 for no. 35, 10 for no. 37, 1 with no number).

Address normalisation matters:

- The same entrance appears as "Sankt Eriksgatan 31" and "Sankt Eriksgatan 31A".
- Booli writes "Baltzar von platens gata" (area name) while the Pontonjären årsredovisning writes
  "Baltzer von Platens Gata".
- 16 rows in Jan–Aug 2026 have no house number at all ("Adress saknas", "Villagatan",
  "Högt Läge På Engelbrektsgatan").
- `position.isApproximate: true` on 22.6 % of rows, so the box route can miss or add buildings.

Compared with the website's GraphQL (`docs/booli.md`): `comparableSales` showed 12 sales for
Sandelsgatan 35 (2023-03-27 – 2026-04-20). The API has 48 (2012-12-01 – 2026-10-27). The 12
was a cap, not the real count.

### (c) Same BRF

No förening field exists on `sold`, `sold/{id}` or `listings`. The full key list is in §3:
no orgnr, BRF name, fastighetsbeteckning or building id. `q=Brf Pontonjären` → 0. Proposed
route:

1. Take the BRF's addresses from the register: `forening_adress` rows with `kalla='rapport'`.
   These are cited from the årsredovisning (`forening.adresser`, verified excerpts). Never use
   the buyer's own address alone as "the BRF".
2. Expand ranges ("Sandelsgatan 35–37", "7A–C") into house numbers, then normalise (case,
   "gata"/"gatan", ligatures, A/B letters, a number with no letter = the whole number).
3. Run one street query per distinct street (cache it), and keep the rows whose house number is
   in the set.
4. Label the result "Försäljningar på föreningens adresser enligt årsredovisningen". Do not
   claim every row is the förening: a house number can hold two föreningar or a hyresrätt turned
   bostadsrätt, and the BRF can own buildings not named in the report.

The example BRF (Pontonjären 3) has no cited addresses in `sampleAnalysis.ts`, so step 1 would
return nothing for it today. The approach depends on v3 address extraction having worked for that
report.

### (d) Similar flats nearby

From the Jan–Aug 2026 kommun pull, offline: sold 2026-03-01 or later, `|rooms Δ| ≤ 0.5`,
`|livingArea Δ| ≤ 20 %`, haversine radius.

| Test flat                                              | 300 m | 500 m | 1 000 m | median kr/m² (500 m), IQR |
| ------------------------------------------------------ | ----- | ----- | ------- | ------------------------- |
| Norrbackagatan 16, Vasastan (72 m², 2.5 rum)           | 64    | 191   | 402     | 132 576 (121 667–143 443) |
| Baltzar von Platens gata 6, Kungsholmen (55 m², 2 rum) | 45    | 74    | 227     | 121 023 (109 783–133 333) |
| Sandelsgatan 35, Östermalm (51 m², 2 rum)              | 34    | 59    | 151     | 123 256 (113 953–130 175) |
| Tjärhovsgatan 22, Södermalm (45 m², 2 rum)             | 34    | 84    | 289     | 121 462 (111 667–134 125) |

API form: `sold?center=<lat>,<lng>&dim=1000,1000&minSoldDate=<today−6 mån>&objectType=Lägenhet&
minRooms=<r−0.5>&maxRooms=<r+0.5>&minLivingArea=<0.8a>&maxLivingArea=<1.2a>&sort=soldDate&
direction=desc&limit=1000`, then a radius filter on our side. The Priskoll has no coordinates, so
the centre would have to come from the postnummer (`bbox` of the postnummer is not exposed) or
from the street route.

## 3. Fields

All keys seen on 15 815 sold rows (Stockholms kommun, flats, Jan–Aug 2026). **Missing values
are absent keys, not `null`.**

| Field                                         | Present | Notes                                                                                                                                                                                                                                               |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booliId`, `url`                              | 100 %   | `url` = `https://www.booli.se/annons/<booliId>`                                                                                                                                                                                                     |
| `soldPrice`, `soldDate` (`YYYY-MM-DD`)        | 100 %   |                                                                                                                                                                                                                                                     |
| `soldPriceSource`                             | 100 %   | `maklare` 56 %, `bobot` 40.6 %, `bid` 3.4 %, `kopare`/`saljare`/`ovrig` ≈ 0. Meaning not documented: `bid` is probably "sista bud" (cf. GraphQL `soldPriceType` Slutpris / Sista bud), `bobot` probably Booli's own collection. Confirm with Booli. |
| `listPrice`                                   | 77.6 %  | asking price at sale                                                                                                                                                                                                                                |
| `firstPrice`                                  | 79.6 %  | first asking price; ≠ `listPrice` on 1 632 rows                                                                                                                                                                                                     |
| `published` (`YYYY-MM-DD HH:MM:SS`)           | 98.3 %  | median 14 days published → sold; 80 rows sold before "published"                                                                                                                                                                                    |
| `rent`                                        | 99.1 %  | monthly fee; `0` on 40 rows (= unknown; Sankt Eriksgatan 31A has 0 on most rows)                                                                                                                                                                    |
| `livingArea`                                  | 99.9 %  | one decimal                                                                                                                                                                                                                                         |
| `additionalArea`                              | 1.9 %   | biarea                                                                                                                                                                                                                                              |
| `rooms`                                       | 99.8 %  | can be 1.5, 2.5                                                                                                                                                                                                                                     |
| `floor`                                       | 94.3 %  | 0 on 545 rows, half floors on 774                                                                                                                                                                                                                   |
| `apartmentNumber`                             | 74.6 %  | always 4 digits when present                                                                                                                                                                                                                        |
| `constructionYear`                            | 87.7 %  |                                                                                                                                                                                                                                                     |
| `buildingHasElevator`                         | 91.5 %  | 0/1                                                                                                                                                                                                                                                 |
| `hasBalcony`, `hasPatio`                      | 97.7 %  | 0/1                                                                                                                                                                                                                                                 |
| `hasFireplace`                                | 89.2 %  | 0/1                                                                                                                                                                                                                                                 |
| `heating`                                     | 46.0 %  | comma list: `district`, `heating-pump-ground`, `electricity-direct`, `fossile`, …                                                                                                                                                                   |
| `isNewConstruction`                           | 0.2 %   | 1 when present                                                                                                                                                                                                                                      |
| `objectType`                                  | 100 %   | `Lägenhet`                                                                                                                                                                                                                                          |
| `location.address.streetAddress`              | 100 %   | can be junk (see §2b)                                                                                                                                                                                                                               |
| `location.address.postCode`                   | 99.96 % | number (`11341`); 6 rows without                                                                                                                                                                                                                    |
| `location.position.latitude/longitude`        | 100 %   |                                                                                                                                                                                                                                                     |
| `location.position.isApproximate`             | 22.6 %  | `true` when present                                                                                                                                                                                                                                 |
| `location.region.municipalityName/countyName` | 100 %   |                                                                                                                                                                                                                                                     |
| `location.namedAreas`                         | 98.3 %  | e.g. `["Vasastan"]`                                                                                                                                                                                                                                 |
| `location.distance.ocean`                     | 34.3 %  | metres                                                                                                                                                                                                                                              |
| `source.{id,name,url,type}`                   | 100 %   | the broker firm; `type` `Broker` (15 800) or `Abandoned` (15)                                                                                                                                                                                       |

**Not present on sold rows:** BRF/förening, orgnr, fastighetsbeteckning, description, Booli's
estimate, biarea on most rows, storeys of the building, energy class, buyer/seller.

**`sold/{booliId}`** (`sold/6263932`) → `{"sold":[ … ]}` with exactly the same object as the
search row, and no `totalCount`. There is nothing extra to fetch per sale.

**Active `listings`** have in addition: `biddingOpen`, `hasSolarPanels`, `sourcesOfficeId`,
`enableStreetView`, `enableEnergyDataInfo`. They have no `postCode` (see the plan).

Trimmed example row:

```json
{
  "booliId": 6263932,
  "url": "https://www.booli.se/annons/6263932",
  "soldDate": "2026-09-24",
  "soldPrice": 8650000,
  "soldPriceSource": "bobot",
  "listPrice": 6700000,
  "firstPrice": 6700000,
  "published": "2026-09-12 10:06:30",
  "rent": 4767,
  "livingArea": 72,
  "rooms": 2.5,
  "floor": 1.5,
  "apartmentNumber": "1104",
  "constructionYear": 1927,
  "buildingHasElevator": 1,
  "hasBalcony": 0,
  "hasPatio": 0,
  "hasFireplace": 0,
  "heating": "district",
  "objectType": "Lägenhet",
  "location": {
    "address": { "streetAddress": "Norrbackagatan 16", "postCode": 11341 },
    "position": { "latitude": 59.33890291, "longitude": 18.03237355 },
    "region": { "municipalityName": "Stockholm", "countyName": "Stockholms län" },
    "namedAreas": ["Vasastan"]
  },
  "source": {
    "id": 130,
    "type": "Broker",
    "name": "Tradition Fastighetsmäkleri AB",
    "url": "https://tradition.se/"
  }
}
```

## 4. How far back, and coverage

**Oldest sale:** Vasastan's oldest row is 2012-08-24 (`sort=soldDate` ascending), and
`maxSoldDate=20111231` → 0. Baltzar von Platens gata and Sandelsgatan 35 also start in 2012.

Vasastan (`areaId 115349`), all object types, sales per calendar year:

| 2012 | 2013  | 2014  | 2015  | 2016  | 2017  | 2018  | 2019  | 2020  | 2021  | 2022  | 2023  | 2024  | 2025  | 2026 (to 30 Oct) |
| ---- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ---------------- |
| 212  | 1 345 | 1 507 | 1 621 | 1 593 | 1 769 | 1 939 | 2 373 | 2 884 | 3 101 | 2 304 | 2 221 | 2 685 | 2 742 | 2 668            |

The rising count to 2021 is probably growing Booli coverage, not more sales. Do not read it as
market volume.

**Booli vs our Mäklarstatistik extract** (`data/raw/Transaction data for valuation.xlsx`, Jan–Aug
2026, read-only):

| Month 2026                      | 1     | 2     | 3     | 4     | 5     | 6     | 7    | 8     | Total  |
| ------------------------------- | ----- | ----- | ----- | ----- | ----- | ----- | ---- | ----- | ------ |
| Booli, Stockholms kommun, flats | 1 758 | 2 050 | 2 436 | 2 296 | 2 447 | 2 064 | 873  | 1 891 | 15 815 |
| Mäklarstatistik extract         | 565   | 642   | 766   | 737   | 742   | 659   | 277  | 612   | 5 000  |
| Ratio                           | 32 %  | 31 %  | 31 %  | 32 %  | 30 %  | 32 %  | 32 % | 32 %  | 32 %   |

The constant ratio means our extract is very likely a ~5 000-row sample or cap of the market,
not the full population. The model card's n = 4 991 is that sample.

Per postnummer (Jan–Aug 2026; Booli counted by `postCode`):

| Postnummer           | Booli n | MS n | Booli median kr/m² | MS median kr/m² |
| -------------------- | ------- | ---- | ------------------ | --------------- |
| 113 41 (Vasastan)    | 36      | 8    | 129 965            | 131 192         |
| 113 39 (Vasastan)    | 53      | 16   | 142 857            | 141 403         |
| 113 54               | 81      | 22   | 131 428            | 132 230         |
| 112 17 (Kungsholmen) | 78      | 31   | 93 877             | 82 143          |
| 112 49 (Kungsholmen) | 66      | 24   | 111 361            | 109 248         |
| 118 53 (Södermalm)   | 48      | 17   | 122 828            | 123 333         |
| 115 30               | 51      | 27   | 123 333            | 125 676         |
| 115 48               | 29      | 34   | 109 195            | 114 748         |

115 48 is the one postnummer where Booli has fewer sales than the extract. A likely cause is
postCode assignment differences. This was not investigated further.

**Row matching.** A Mäklarstatistik row counts as found when there is a Booli row with the same
postnummer and rooms, area ±1 m², fee ±2 %, and date ±31 days. That holds for 4 081 of 4 968
rows (**82.1 %**). For 77.0 % of rows the best match also agrees on kr/m² within 1 %, and the
sale date is identical in 88 % of matches. The rest are off-market sales, postcode or attribute
differences, or my strict rules.

## 5. Limits and errors

- No `X-RateLimit-*` or similar headers. Response headers: `server: Apache`, `x-powered-by: PHP`,
  `x-controller: sold`, `x-action: index`.
- No throttling over 250 calls, including ~160 back-to-back calls in under two minutes. Booli's
  actual quota for the student key is unknown, so do not rely on this.
- Latency 100–160 ms for small pages and 280–390 ms for 1 000 rows (~300 KB uncompressed).
- `limit` above 1000 is capped to 1000 without an error.
- Errors are plain-text bodies, not JSON: `400 INVALID_SEARCH_ARGUMENTS` (bad value),
  `400 MISSING_REQUIRED_SEARCH_ARGUMENTS` (no area/geo), `403 FAILURE_MISSING_PARAM …` (unsigned,
  from the plan). A misspelt filter or a wrong `bbox` order gives a silent 0 or is ignored, so
  always check `searchParams` in tests.

## 6. How it fits with the model and Mäklarstatistik

**Sanity check of the valuation (measured offline, free).** I ran `vardera()` (model v3.1, the
same TypeScript code as production) on Booli sales using only fields the buyer would type:
fee from `rent`, floor truncated, hiss/balkong from 0/1.

| Set                                                                | n      | MAPE  | median APE | median (model ÷ sold − 1) | sold within ±10 % of model |
| ------------------------------------------------------------------ | ------ | ----- | ---------- | ------------------------- | -------------------------- |
| Vasastan, sold 2026-09-01 – 10-30 (**after** the training period)  | 653    | 8.3 % | 6.4 %      | **−3.2 %**                | 67 %                       |
| Stockholms kommun, Jan–Aug 2026 (≈ 26 % of rows are training rows) | 15 768 | 8.9 % | 6.6 %      | +1.0 %                    | 68 %                       |
| Vasastan, Jan–Aug 2026                                             | 1 911  | 8.1 % | 6.2 %      | +1.6 %                    | 72 %                       |

- The error level matches the model card (CV MAPE 9.6 % for the area model).
- After August the model sits ~3 % below sale prices in Vasastan. That is a market or season
  shift the model cannot see, because it has no time feature. Booli data could monitor this
  drift every month.
- Caveat: `bobot`/`bid` rows may not be contract prices.

**Comparables display.** Booli gives what Mäklarstatistik cannot: per-address and per-flat
history, and recent sales in a radius with dates, kr, m², floor and broker. The Binfo model gives
one number from the ±10 % span; the comparables show the buyer the evidence around it. They must
stay separate: comparables are a reference, never an input that moves the valuation, and their
wording must not imply causation.

**Extra training data.** For the same months there are 3.2× as many rows, with lägenhetsnummer,
coordinates, broker, list/first price and `published`, so days on market and bid premium can be
computed. Measured median premium over `listPrice`: `maklare` 6.2 %, `bobot` 5.3 %, `bid` 5.6 %.
History back to 2012 would allow a **repeat-sales price index** per area, which Binfo lacks
today. The many repeat-sold flats per building make that feasible.

Pull sizes: Stockholms kommun Jan–Aug 2026 took 16 calls (1 000 rows each). The whole kommun
since 2012 is likely ~150–250k rows, so ~150–250 calls. That is cheap in calls but needs a
separate budget.

Before any training use:

- **confirm the terms in writing.** The owner says Booli's representative OK'd use, but
  `booli.se/api/tou/` could not be read, the key is a student key and expires in ~3 months, and
  a model trained on Booli data keeps that data's value after the key expires.
- decide whether `bobot`/`bid` rows are acceptable labels, deduplicate re-listings, and
  re-validate against the Mäklarstatistik rows.

A **one-off pull** (snapshot + model card note) is lower-risk than ongoing training. Ongoing
display needs a live key, so it ends with the key unless Booli extends it.

## 7. Proposal for a future implementation (no code)

### Use cases → calls

| Use case                             | Calls                                                                                                                                                                              | Rule                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A. Earlier sales of this flat        | from B                                                                                                                                                                             | address + `apartmentNumber` + `livingArea ±1`; needs lgh (buyer input or listing)           |
| B. Sales in the same building        | listing with coordinates: `sold?center=lat,lng&dim=60,60&sort=soldDate&direction=desc&limit=1000`; no coordinates: `areas?q=<street>` (kommun-filtered) + `sold?areaId=<street>&…` | filter on normalised street + number (letter-insensitive option); dedupe address+lgh+date   |
| C. Sales on the förening's addresses | one street query per street in `forening_adress kalla='rapport'`                                                                                                                   | house-number set from the cited addresses; label as such; only when addresses exist         |
| D. Similar flats nearby              | `sold?center=…&dim=1000,1000&minSoldDate=−6 mån&objectType=Lägenhet&minRooms/maxRooms ±0.5&minLivingArea/maxLivingArea ±20 %&sort=soldDate&direction=desc&limit=1000`              | radius 500 m, widen to 1 000 m if n < 15, else say "för få försäljningar"; median + IQR + n |
| E. Model drift monitor (internal)    | monthly `sold?areaId=1&minSoldDate=…&limit=1000` pages                                                                                                                             | MAPE / median signed error per area; an alert, not UI                                       |

### Caching

- Cache the street/box responses (B, C) in a table keyed by the canonical query string for
  ~7 days. Sales arrive slowly and history never changes; the TTL could be shorter for the newest
  month.
- Cache D for 24 h keyed by rounded centre (~100 m grid) + room/area band.
- Store only the fields we show.
- Mirror the existing `annons_cache` pattern: RLS on, zero policies, purged by `binfo-retention`.
- One Priskoll would then cost 0–2 Booli calls. Keep the Priskoll quota (60/IP/h) as the cap and
  add a daily Booli call ceiling with a kill switch (`BOOLI_API=off` already planned).

### What to show

- Date, price, kr/m², boarea, rum, våning and the price source ("slutpris" vs "sista bud" once
  Booli confirms the codes) for each sale. Fee only when `rent > 0`.
- Never show `apartmentNumber`. Lgh + date + price identifies a person via Lantmäteriet. Use it
  only for matching. `/integritet` must then mention Booli sold data.
- **Old prices are not indexed.** Show the date prominently, sort newest first, and add a fixed
  line: "Äldre priser är inte justerade för prisutvecklingen". No "worth X today" until a price
  index exists.
- Comparables summary as a separate line under the valuation: "N lägenheter med X–Y rum,
  sålda inom 500 m de senaste 6 månaderna: median Z kr/m²". Wording follows the numbers. Do not
  call the valuation "bekräftad" by it, and do not move it.
- Attribution "Uppgifter från Booli" with a link next to every Booli list (already decided for
  the prefill).

### UX placement

- **/analysera Priskoll result** (`PriskollResultat`): a compact "Sålt i närheten" card (median,
  n, period) and, when a street + number is known, a collapsed "Tidigare försäljningar på
  <adress>" (max 5 rows, "Visa fler").
- **Full report, "Priset" section:** the same two blocks plus "Den här lägenheten såldes senast
  <datum> för <kr>" when (A) matches with lgh, and "Försäljningar på föreningens adresser" (C)
  when the report has cited addresses. All of this is buyer-level, assembled per read like
  `prisanalys` and never stored on the shareable `rapport`.
- **PDF:** a short table (max 5 building sales + the comparables line) in the price section,
  with the attribution and the no-index line.
- **Register `/brf/$slug`:** possible later (C per BRF). The page is cacheable and must not set
  cookies. Booli display terms for public pages need confirming first.

### Risks

- **Key expiry (~3 months, student key).** Everything behind the flag; on `401/403` hide the
  blocks silently and log `booli-api nyckel avvisad`. Do not build a flow that breaks without
  them.
- **Terms not read.** Confirm in writing: display of sold data, caching duration, public pages,
  training use, attribution form.
- **Price-source quality:** 41 % `bobot` and 3 % `bid`; meanings unconfirmed.
- **Duplicates** and **junk addresses** (§2) need dedupe and normalisation tests.
- **Approximate coordinates** (23 %) make the box route miss or add buildings.
- **Coverage:** Booli lists broker-published sales. Off-market and some broker sales are
  missing (18 % of our Mäklarstatistik rows had no Booli match). Coverage before ~2019 is
  visibly lower.
- **No price index:** older prices mislead without the date caveat. A repeat-sales index from
  Booli history is possible but is a model project with its own terms question.
- **Same BRF ≠ same address:** only claim the förening when the address set is cited, and say so.
