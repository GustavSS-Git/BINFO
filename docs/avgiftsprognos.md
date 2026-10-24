# Avgiftsprognos: from the årsredovisning to the price (2026-10-24)

The report reaches the price through one channel: the **expected rise in månadsavgift** for this
flat within a horizon (default 24 months). The valuation model already prices today's fee; the
prognosis adds only what the report shows is coming. The grade never moves the price.

Code: `src/lib/analysis/calc/avgiftsprognos.ts` (maths), `src/lib/analysis/calc/prognosantaganden.ts`
(every assumption, one file), `src/lib/analysis/prisjustering.ts` (price), `src/server/referensranta.ts`
(base rate).

## Step zero findings

### Månadsavgift in the valuation model

- Feature `fee_per_sqm` = manadsavgift ÷ boarea in the LightGBM model on log(kr/m²)
  (`src/lib/vardering/features.ts`). Stockholm model: no monotone constraint on it.
- The trees have no coefficient. Finite differences on 7 test flats (+100…+1 000 kr/mån) gave
  −1 278 … +170 kr of price per kr/mån, with sign flips: unusable as a slope.
- The OLS companion (`ml/artifacts/valuation-v3.1/metadata.json`, `effects_fee_per_sqm`):
  **β = −0.0024470683 per kr/m²/mån** on log(kr/m²), CI [−0.00280, −0.00210], p = 1.9e-42, n = 4 991.
- Flat-specific: d price / d fee(kr/mån) = β × price per m². At 122 000 kr/m² (Kungsholmen) ≈ −300 kr
  per kr/mån; at 51 000 kr/m² ≈ −125 kr. Roughly 20 years of fee capitalised.
- Caveat (model card): association, not causation; the fee level partly proxies debt and condition.

### Existing price adjustments

None for debt deviation or the grade. `andelAvForeningensSkuld` is a comment line, never applied.

### STIBOR

- The Riksbank SWEA API's STIBOR series end 2020-07-03 (`SEDP3MSTIBORDELAYC`).
- swfbf.se answers servers with a Vercel bot checkpoint (HTTP 429, `x-vercel-mitigated: challenge`).
- SFBF's terms: website data is for personal use; commercial use needs a paid licence.
- Used instead: 3-month T-bill **SSVX, `SETB3MBENCH`** (Riksbank SWEA, daily). The margin below is
  measured against the same series, so the pair is consistent.

### BRF margin over SSVX

A loan counts as variable when the report labels it "rörlig", or its villkorsändringsdag is within
3 months of the balance-sheet date (the reports almost never label the type; a 3-month variable
loan resets quarterly). Rate − SSVX 3M on the balance-sheet date.

| BRF (balance date)              | Loan (rate, reset date) | SSVX  | Margin (pp) |
| ------------------------------- | ----------------------- | ----- | ----------- |
| Volontären 12 (2023-12-31)      | 4.85 % 2024-01-02       | 3.984 | 0.87        |
|                                 | 5.70 % 2024-03-07       | 3.984 | 1.72        |
|                                 | 5.05 % 2024-03-01       | 3.984 | 1.07        |
| Beckasinen 14 (2024-12-31)      | 3.54 % 2025-01-20       | 2.422 | 1.12        |
| Helsingborgshus 17 (2025-08-31) | 2.61 % 2025-09-28       | 2.026 | 0.58        |
| Torsborgen 3 (2025-12-31)       | 2.43 % 2026-01-28       | 1.948 | 0.48        |
|                                 | 2.32 % 2026-03-28       | 1.948 | 0.37        |
| Pontonjären 3 (2025-12-31)      | 2.53 % 2026-03-28       | 1.948 | 0.58        |

- Per loan: median 0.73. Per BRF (median of each BRF's loans): 1.07, 1.12, 0.58, 0.425, 0.58 →
  **median 0.58 pp = the default**. 2025 loans alone: 0.37–0.58.
- No qualifying loan: Granen 10-11, Hökensgata 1, Albohem, Näcken 2, Zederslundshus (scan, read
  visually: fixed to 2027/2029). Göken 29 is debt-free. test_rapport's loan table is garbled.
  Ängsknarren and Startfältet (image scans) could not be read without a renderer.
- Against the policy rate the per-BRF median would be 0.78.

## The calculation

All BRF amounts are kr/year. The flat's share `andel` = (månadsavgift × 12) ÷ årsavgifter; fallback
boarea ÷ bostadsrättsyta; fallback årsavgifter = total debt ÷ räntekänslighet. A component's
kr/month for the flat = BRF kr/year × andel ÷ 12.

1. **Spargap**: sparande/m² totalyta × totalyta, when negative. Not applied when the report says a
   withdrawal is planned AND financed.
2. **Refinansiering**: Σ belopp × (new − current) ÷ 100 over loans repricing within the horizon
   (reset date ≤ today + horizon, incl. dates already passed since the balance date; rörlig loans
   always). Current rate: the loan's, else snittränta, else räntekostnader ÷ total debt. New = SSVX
   - margin. No maturities: 50 % of debt (range 0–100 %). The same 50 % (and
     range) applies to undated loan rows and to debt the rows don't cover (> 2 %).
     Can be negative: refinancing at a lower rate lowers the fee and raises the
     price. A report whose balance date is more than 18 months old is not used
     for this component (its loans have most likely been refinanced already):
     `saknar_underlag`, wider range, no price effect.
3. **Underhåll**: planned costs in the window not financed by loan/fund/decision, minus the fund
   balance, minus planned yearly savings × years; positive remainder ÷ 10 years.
4. **Lokaler**: rent of leases ending within the horizon × 50 %.
5. **Energi**: unfinanced energy projects with an amount ÷ 10 years. Energikostnad itself is already
   in today's fee and is never added.

A component without the data it needs is `saknar_underlag`: it adds nothing to the point estimate
and widens the LOW end of the price range by 3 %. Missing data never lowers the price.

**Price**: effect = β × rise × baseline kr/m² (β < 0, so a rise lowers the price); adjusted =
baseline + effect. **Rate table**: today; expected (today + rise); +1 and +2 pp on the debt that
reprices within the horizon only.

## Known overlaps and limits

- Spargap and underhåll can overlap when the year's negative sparande is itself maintenance spending.
- Most reports give no underhållsplan amounts → widened range rather than an amount.
- A total rise above 30 % of today's fee is applied but marked osäker with a question (guards
  against a misread 30-year maintenance total).
- Old extractions (PROMPT_VERSION ≤ 8) have only the maturity year: a 1 July date is assumed.

## Round 2026-10-24c: sustainable fee and refinancing years 3–5

Replaces component 1 (spargap) and extends component 2. Assumptions in `prognosantaganden.ts`,
sources in `docs/underhall-referens.md`.

**1. Sparande mot underhållsbehov** (`calc/sparbehov.ts`). Gap = target − sparande per m² totalyta;
BRF kr/year = gap × totalyta × dampning. A surplus (negative gap) lowers the expected fee.

| Target, first available                                                                                          | Dampning |
| ---------------------------------------------------------------------------------------------------------------- | -------- |
| `investeringsbehovPerM2` (report nyckeltal)                                                                      | 1        |
| `rekommenderadAvsattning` (or the plan's stated yearly need) ÷ totalyta                                          | 1        |
| `planTotal` ÷ years ÷ totalyta, else planned costs ÷ their span (≤ 30 years) ÷ totalyta, excluding horizon items | 1        |
| Schablon 300 kr/m² moved within 250–350 by building parts                                                        | 0.5      |

- Building parts (stambyte, tak, fasad, fönster, ventilation, el, hiss — hiss only when the buyer
  says the house has one): last year = latest `genomfordaAtgarder` item, else byggår. `nyligen` when
  renovated less than half the lower lifetime ago; `eftersatt` when older than the upper lifetime;
  `okant` without any year. Score = (#eftersatt − #nyligen) ÷ #assessed; target = 300 + 50 × score.
- A plan-based target below 150 kr/m² (half the schablon) is treated as a partial plan and ignored.
- Missing totalyta is derived as total debt ÷ skuldsättning per m² totalyta.
- `underhall` now counts only unfinanced plan items within the 24-month horizon (minus fund and
  allocations, over 10 years); those items are excluded from the plan-cost target.

**2. Refinancing, later phase.** Dated loans resetting in months 25–60 count only when their rate
is below SSVX + margin, weighted 0.75 (≤ 36), 0.5 (≤ 48), 0.25 (≤ 60). Per-loan rows in
`refinansiering.lan`. Never a cut that far ahead; undated debt has no later phase.

**Fee pressure** (`tryckFor`): |kr/month| ÷ today's fee < 2 % green, ≤ 10 % yellow, else red; a
decrease is green.

Worked examples (fictional flat 60 m², 3 600 kr/mån, 6 Mkr, byggår 1965, hiss; BRF totalyta 5 500,
andel 1.2 %; SSVX 2.068 %): a förening saving 150 kr/m² with no plan → target 336 (5 parts
eftersatt) → +512 kr/mån → −2.1 %; saving 400 → −176 kr/mån → +0.7 %; a 1.2 % loan resetting in
month 38 → +543 kr/mån (weight 0.5). Real: Pontonjären 3 (+372 kr/mån, −107 750 kr) and
Helsingborgshus 17 (−5 kr/mån), see the round summary in PLAN.md.

**Calibration note:** with the schablon, a typical förening (sparande 85–225 kr/m²) gets a yellow
or red savings step and roughly −1 to −3 % on the price. `SPARMAL_SCHABLON_DAMPNING` is the knob.
