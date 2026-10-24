# Booli listing pages: what the raw HTML contains

Investigated 2026-10-24 (round "Booli prefill", see `PLAN.md`). Fixtures: `fixtures/booli/`
(raw HTML as served to a server, not a browser save). Re-fetch and re-check them with
`node --import tsx scripts/hamtaBooliFixtures.ts` (`--spara` overwrites the fixtures).

## Blocking (Cloudflare bot management)

www.booli.se is behind Cloudflare. The verdict depends on the client's fingerprint, not just headers:

| Client                                                                                                | Result                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| curl, default UA                                                                                      | `403`, `cf-mitigated: challenge` ("Just a moment…") |
| curl, Chrome UA, no `br` in `Accept-Encoding`                                                         | `403` challenge                                     |
| curl, full Chrome-like header set (`Accept-Encoding: gzip, deflate, br`, `sec-ch-ua*`, `Sec-Fetch-*`) | `200`, real page (HTTP/2 and HTTP/1.1)              |
| Node 22 `fetch` (undici), same full header set                                                        | `403` challenge (TLS fingerprint)                   |
| Local workerd (`wrangler dev`), Chrome-like headers, no `Accept-Encoding`                             | `200`, real page                                    |
| Booli GraphQL (`/graphql`) from curl, full header set                                                 | `403` challenge                                     |
| Production Worker (Cloudflare egress, `CF-Worker` header)                                             | **untested**; verify right after deploy             |

Binfo sends one request with a normal browser header set and never tries to solve or bypass a
challenge. A challenge is reported as `blockerad`, and the buyer fills in the form manually. The
kill switch is `ANNONS_HAMTNING=off`.

`robots.txt` disallows only `/auth/`, `/save/`, `/user/`, `/redirect`, `/embed*` etc. for `*`.
Listing pages are not disallowed. Booli's terms of use have not been checked (owner).

## Where the fields are

The page is a Next.js app-router page. The listing is a GraphQL-shaped `Listing` object inside the
RSC stream:

1. Concatenate every `self.__next_f.push([1,"…"])` string (each is a JSON string literal).
2. JSON-parse the object that starts at `"object":{"__typename":"Listing"`.

JSON-LD (`<script type="application/ld+json">`) adds `Place` (postal address), `Product` (price)
and `BreadcrumbList` (ending in the BRF name).

| Field             | Path                                                                                                                                         | In the 6 fixtures |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Address           | `Listing.streetAddress` (= JSON-LD `Place.address.streetAddress`)                                                                            | 6/6               |
| Postcode          | JSON-LD `Place.address.postalCode`; `Listing.areas[type=postcode].name`                                                                      | 6/6               |
| Coordinates       | `Listing.latitude`, `Listing.longitude`                                                                                                      | 6/6               |
| Kommun / stadsdel | `areas[type=municipality].name` / `descriptiveAreaName`, `primaryArea.name`                                                                  | 6/6               |
| Utgångspris       | `listPrice.raw` (null before the sale starts)                                                                                                | 5/6               |
| Avgift            | `rent.raw`, unit "kr/mån"; `0` when the broker gave none                                                                                     | 5/6 (one is `0`)  |
| Boarea            | `livingArea.raw` (decimal)                                                                                                                   | 6/6               |
| Rum               | `rooms.raw` (2.5 possible)                                                                                                                   | 6/6               |
| Våning            | `floor.raw`; `buildingFloors` sometimes                                                                                                      | 6/6               |
| Byggår            | `constructionYear`                                                                                                                           | 6/6               |
| Hiss / balkong    | `amenities[].key` `elevator` / `balcony`, listed only when present                                                                           | 6/6 both          |
| Förening          | last JSON-LD breadcrumb (`/bostadsrattsforening/<id>`); `housingCoop.id` always                                                              | 6/6               |
| Broker page       | `listingUrl` ("Läs mer hos mäklaren")                                                                                                        | 6/6               |
| Description       | **not on Booli**                                                                                                                             | 0/6               |
| Other             | `operatingCost` (drift kr/mån), `heating`, `apartmentNumber`, `phase`, `published`, `estimate` (Booli's own valuation; never shown by Binfo) | varies            |

Listings change while they are live. The counts above are for the saved fixtures (fetched
2026-10-24 01:53). Twenty minutes earlier, Kastellgatan 9 had no price yet, its förening read
"BRF Banéret i Malmö" (saved: "BRF Banéret"), and Sandelsgatan 12 had no förening breadcrumb (saved:
"HSB BRF Dragonen I Stockholm").

Header order matters for curl too: with `sec-ch-ua*` placed right after `Accept-Encoding`, curl was
challenged. `scripts/hamtaBooliFixtures.ts` documents the order that passes.

A missing amenity is unknown, not "no": hiss/balkong are only ever set to `ja` from Booli.

The "Föreningen" tab is lazy. It calls `propertyInfoSectionContent {sectionKey:"housingCoopInfo"}`,
which returns the name, type, unit count, land ownership and total loan. The nyckeltal there need a
Booli login.

## Earlier sales (not used yet; round 3)

Not in the raw HTML; `Listing.salesOfResidence` holds only `{id, booliId}`. The page loads them
from Booli's GraphQL with Apollo persisted queries (`GET /graphql?operationName=…&variables=…&extensions={persistedQuery:{sha256Hash}}`).
The hashes change when Booli redeploys. Server requests are challenged.

| Query                       | Variables                                                                                 | Returns                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| `salesOfProperty`           | `residenceId` (URL id of `/bostad/`), `booliId` (Listing id)                              | earlier sales of this flat               |
| `comparableSales`           | `objectType`, `postcodeId` (`areas[type=postcode].id`), `addressId` (`Listing.addressId`) | sales at the same street address, max 12 |
| `listingHistoryByListingId` | `listingId`                                                                               | price changes of this listing            |

Fields per sale: `soldPrice.raw`, `soldDate`, `livingArea.raw`, `rooms.raw`, `soldPriceType`
(Slutpris / Sista bud), `streetAddress`, `url`. **No floor, no fee.** "Same address" is the same
street number, not the same förening.

Captured with a headless browser 2026-10-24:

| Fixture                                    | Same flat                           | Same address | Date range              |
| ------------------------------------------ | ----------------------------------- | ------------ | ----------------------- |
| bostad/719044 Sandelsgatan 35              | 0                                   | 12           | 2023-03-27 – 2026-04-20 |
| bostad/69268 Sandelsgatan 12               | 0                                   | 12           | 2015-05-12 – 2025-10-27 |
| bostad/720821 Sankt Eriksgatan 31A         | 1 (2020-01-29, 5 220 000 kr, 54 m²) | 11           | 2016-02-18 – 2026-07-01 |
| bostad/4036850 Wennerbergsgatan 2          | 0                                   | 12           | 2022-08-11 – 2026-09-17 |
| annons/6279984 Torsvikssvängen 39, Lidingö | 0                                   | 12           | 2021-02-01 – 2026-02-06 |
| annons/6323511 Kastellgatan 9, Malmö       | 0                                   | 9            | 2017-08-12 – 2023-08-25 |

Indexing those prices to today would need an area price index over time. None exists in the repo:
the valuation data covers jan–aug 2026 only, and `month_num` is not a model feature.
