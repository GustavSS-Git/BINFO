# Valuation outside Stockholm — design (task 4e, not built)

Status: **superseded — built differently in valuation-v3 (2026-10-08).** The shipped method is
`kr/m² = kommun 12-month average (Svensk Mäklarstatistik) × r(x)` inside Stockholms län and the national
average × r(x) outside it, where r(x) comes from a no-location model trained on within-area relative prices
— not the ratio-to-Stockholm scaling below. See `ml/artifacts/valuation-v3/MODEL_CARD.md` section 6 and
`src/lib/vardering/tackning.ts`. Kept for the reasoning only.

## Problem

The valuation model (`ml/artifacts/valuation-v2`) is trained only on Stockholm
transactions. Today the product values only postcodes whose 3-digit prefix
occurs in Binfo's Stockholm area mapping. Every other postcode gets no
valuation. The aim is a simple, clearly labelled, lower-confidence estimate
elsewhere, without new transaction-level data.

## Method: scale the Stockholm model by the regional price level

For an apartment in region R:

```
V_R = V_Sthlm(x) × (P_R / P_Sthlm)
```

- `V_Sthlm(x)` is the Stockholm model's prediction for the apartment's own
  features, with `omrade = null`: the Stockholm-wide level, not an inner-city
  area.
- `P_R` and `P_Sthlm` are the median price per m² for bostadsrätter, taken
  from **the same aggregate publication of Svensk Mäklarstatistik, for the
  same period**. Using one source for both makes the ratio consistent. The
  period should match the model's data period (Jan–Aug 2026) or be the
  closest available one, and the period used must be stated.
- The interval is `V_R × exp(±q_R)`, where `q_R = q_overall + q_region`.
  `q_region` is an extra log half-width that accounts for the uncertainty of
  the ratio and of transferring Stockholm's feature effects. Start with a
  documented, conservative constant (TODO: unverified placeholder). Calibrate
  it once transaction data from at least one other region exists.
- Konfidens is always `'lag'`. The `skal` text: "Uppskattad genom att skala
  Binfos Stockholmsmodell med regionens prisnivå enligt Svensk
  Mäklarstatistik, inte tränad på försäljningar i regionen."

**Known bias.** The model assumes the feature effects (rooms, floor, lift,
build year) are the same as in Stockholm. That is plausible in direction
but not in size. The Stockholm-wide base level also assumes that the mix of
apartments within the region resembles Stockholm's. The UI shows these
estimates with the same "uppskattning" labelling and a sentence about the
method.

## Region resolution

1. **Postnummer → region.** Use län first: the GeoNames SE dump that is
   already fetched has the admin1 (län) name and code for every Swedish
   postcode. The GeoNames dump has no kommun field, so kommun-level regions
   need an address-point join (OSM or Lantmäteriet) like the Stockholm
   mapping. Kommun is a later step.
2. **Minimum sample.** Use the region only if its median is based on at
   least n ≥ 50 sales in the period (the same threshold as task 5).
   Otherwise, go up a level (kommun → län). If there is still no valid
   level, give no valuation.
3. Stockholm postcodes never use this path.

## Interface (TypeScript, for `src/lib/vardering/` when built)

```ts
import type { Dataperiod } from "@/types/analysis";

/** One region's price level from an aggregate statistic. */
export interface RegionalPrisniva {
  /** "lan:01" or "kommun:0180". */
  regionId: string;
  regionNamn: string;
  niva: "kommun" | "lan";
  medianKrPerM2: number;
  /** Number of sales behind the median. */
  n: number;
  period: Dataperiod;
  /** Citation: publisher, publication/table, retrieval date. */
  kalla: string;
}

export interface RegionalPrisnivaKalla {
  /** The finest region level with n ≥ 50 for this postcode, else null. */
  forPostnummer(postnummer: string): RegionalPrisniva | null;
  /** Stockholm's level from the SAME publication and period. */
  stockholmReferens(): RegionalPrisniva;
}
```

The result reuses the existing contract without changes:
- `externVardering` gets source `'schablon'`, `range` set to the interval,
  and a `schablonBasis` that names the method.
- `varderingsunderlag.omrade` is `null`. A regional field (`region?: string`)
  would be a small additive contract change when this is built.

## Data the owner supplies

A table from Svensk Mäklarstatistik's published aggregate statistics
(no scraping), with these columns:

`region_niva` (lan/kommun), `region_kod`, `region_namn`,
`median_kr_per_m2`, `n`, `period_fran`, `period_till`,
`kalla` (publication + retrieval date).

The table must also include Stockholms kommun (or Stockholms län) as the
reference. Store it as `data/raw/regional_prisniva.csv`. A build step turns
it into `src/lib/vardering/data/`, like the other generated data.

## Tests when built

- The ratio arithmetic.
- The fallback chain: kommun → län → none.
- Konfidens is always `'lag'`.
- Stockholm postcodes never use this path.
- A postcode with no region gives no valuation.
