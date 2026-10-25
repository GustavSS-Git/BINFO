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
4. **Lokaler**: a cited loss signal counts 100 % of its rent; a lease ending within the horizon with no stated renewal counts 50 % (see round 2026-10-25).
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

## Round 2026-10-25: lokal rent (signal 100 %, ending lease 50 %), decided fee raises

Owner feedback on Bf Volontären 12 (FY2023): a lokal lease with "Löptid t.o.m 2024-12-31" made the
`lokaler` component subtract 50 % of the rent, although nothing says the tenant leaves. First fix:
count only loss signals. Refined the same day into the compromise below.

**Lokaler (component 4; first version 2026-10-25, refined the same day: a compromise).** Sources
of risk, all from cited fields (code: `calc/lokalrisk.ts` classifies, `avgiftsprognos.ts` prices):

1. **Loss signal** (`forening.lokaler.forlustsignaler`: uppsagt hyresavtal, hyresgästen har sagt upp /
   flyttar, lokalen står tom/vakant, hyresgäst i konkurs eller obestånd, hyrestvist, hyresnedsättning
   / omförhandling till lägre hyra): the report says the rent WILL fall away → **100 %** of the rent
   (`LOKALHYRA_ANDEL_VID_FORLUSTSIGNAL`, owner 2026-10-25).
2. **Lease ending soon**: `kontrakt[].slutdatum` in [balansdag, idag + `HORISONT_MANADER`], both
   ends inclusive (so also a lease that ended after the balance date: the report is old and does not
   tell us what happened), and the report says nothing about renewal → **50 %**
   (`LOKALHYRA_RISKANDEL`, now meaning "50 % probability that the income disappears").
3. **Not at risk**: a lease with `fornyelse` (new optional field on each kontrakt, PROMPT_VERSION 12:
   `{ text, nyttSlutdatum?, ref }`, the report says the lease is extended/renewed or a new tenant has
   signed; automatic extension counts only if the report says so for that lease), a lease ending
   outside the window, a lease that ended before the balance date. Neither a signal nor an ending
   lease → `ej_aktuell`, 0 kr, text "Föreningen hyr ut lokaler (X kr per år). Inget i årsredovisningen
   tyder på att hyresintäkterna faller bort, så vi räknar inte med något bortfall." (a renewed lease
   adds a sentence naming it before that). The "no lokaler" and "cited zero rent" branches are kept.

Rent per lease: its `arshyra`, else `hyresintakter ÷ max(antal kontrakt, antalLokaler, 1)` (the same
share a signal without rent gets). Any at-risk item with no rent figure at all → `saknar_underlag`
(the text still names the lease and says the rent is missing).

**No double counting (choice).** Signals first: their rents are summed and, when `hyresintakter` is
known and > 0, scaled proportionally down to it. Ending unrenewed leases are then capped at the rent
the signals did not cover (`hyresintakter` − signal rent), again scaled proportionally; if nothing is
left the lease is named as "redan inräknad ovan". A lease whose own `arshyra` equals a signal's
`arshyra` is taken to be that same rent and is counted by the signal only (two different leases with
an identical rent would be under-counted: the cautious side, and there is no other link between a signal
and a lease). Each item's amount is rounded on its own and the component is their sum, so the
amounts in the explanation always add up to `foreningKrPerAr`.

Hand-computed example (Volontären-like: one lease, no `arshyra`, `hyresintakter` 244 380, slutdatum
2024-12-31, balansdag 2023-12-31, today 2026-10-25): 244 380 × 50 % = 122 190 kr/year; flat share at
fee/årsavgifter = 1 % → 122 190 ÷ 1 200 = 102 kr/month. Explanation: "Hyresavtalet för kontoret
(130,5 kvm) löpte ut 31 december 2024 och årsredovisningen säger inget om förlängning eller ny
hyresgäst. Vi räknar med 50 % sannolikhet att hyran faller bort, cirka 122 190 kr per år för
föreningen." A signal: "Årsredovisningen nämner: ”…”. Vi räknar med att hela hyran, X kr per år,
faller bort." Several items → one sentence each plus "Sammanlagt räknar vi med cirka X kr per år
för föreningen." The lease name is the lease's `text` when it is a short noun phrase (≤ 60 characters,
not mentioning "avtal"/"löper", as older extractions sometimes do), else "lokalen". No causal claim:
the text says what the report says and which assumption we make.

**Questions to the styrelse** (`lokalfragor.ts`, buyer-level, assembled on every read in
`assemble.ts`, ursprung `analys`, riktadTill `styrelsen`): one per cited loss signal ("Hur planerar
föreningen att ersätta lokalhyran som enligt årsredovisningen faller bort, och när kan lokalen vara
uthyrd igen?") and one per lease ending in the window without `fornyelse` and not covered by a signal
("Vad händer med hyresavtalet för kontoret (130,5 kvm) som löpte ut 31 december 2024? Har föreningen
och hyresgästen kommit överens om att förlänga, eller finns en ny hyresgäst?"). `varfor` uses only
numbers that exist (the year's lokal rent, the lease's rent, the share of årsavgifter only when
årsavgifter is known). All are skipped when any of the model's (or earlier deterministic) questions
mention lokal / hyresavtal / hyresgäst in `fraga` or `varfor`.

**Decided fee raises (new component 6, id `beslutad_hojning`, "Beslutad avgiftshöjning som inte har
trätt i kraft").** PROMPT_VERSION 11 extracts `forening.avgiftsandringar`: decided ("beslutad") or
planned ("planerad") changes of the bostäder's årsavgift (older föreningar write "hyra" for it; not
lokal rents, not IMD/el), with `procent` (signed Figure), `fran` (YYYY-MM-DD, optional), status and a
citation. Volontären 12 p. 3: "föreningen har beslutat om en hyreshöjning med 25% från 1 maj 2024".

The report is older than the buyer's fee, so the raise may already be in it. An **internal check**
(`prognos.avgiftsandringKontroll`, never shown on the web or in the PDF) decides, per relevant change:

- Relevant = procent > 0 and (`fran` absent or after the balance date). A change on or before the
  balance date is already in the accounts; a decrease is ignored (we never price a decided cut). A
  procent marked `osaker` is not used.
- `datum`: `fran` ≤ today → `passerat`, later → `framtida`, absent → `okant`.
- Fee estimate: key figure `arsavgift_per_m2_brf_yta` × boarea ÷ 12 = `uppskattadAvgiftFore`;
  × (1 + %) = `uppskattadAvgiftEfter`. Changes are sorted by `fran` (undated last) and **compound**:
  the "före" of a later change is the "efter" of the previous one. `avgift` = the estimate the
  buyer's månadsavgift is closer to (absolute difference; a tie or a missing key figure → `okant`).
  Caveat: the key figure is a per-m² average, so a small raise cannot be told apart from the spread
  between flats; for such changes the result is weak.
- `slutsats`: a known date decides (passerat → `i_kraft`, framtida → `ej_i_kraft`); `konflikt` when
  the fee points the other way. Without a date the fee decides; both unknown → `okant`.

**Component.** No relevant change → `ej_aktuell`, 0 kr, plain text. Any change with slutsats `okant` →
`saknar_underlag` (adds nothing, widens the low end of the price range like other missing data). All
in effect → `ej_aktuell` with "Den beslutade höjningen på 25 % från 1 maj 2024 ingår redan i din
avgift." Otherwise `beraknad`: kr/month = Σ månadsavgift × % over the changes not yet in effect (simple
sum, no compounding); BRF kr/year = that × 12 ÷ andel (the förening's fee revenue × %), so the
component's kr/month comes back to the same number.

**Offset against the savings gap (prevents double counting).** A raise is the förening's own answer to
its savings gap, so the yearly revenue of EVERY relevant raise (in effect, not yet, or unknown) is
subtracted from the `spargap` component's BRF amount (floor 0; only when spargap is `beraknad` and
positive; other components are not offset). Revenue = månadsavgift × 12 ÷ andel × %, except for a raise
already in the buyer's fee, where the fee contains the raise and the revenue is fee × % ÷ (1 + %). The
spargap explanation gets a sentence ("Den beslutade höjningen av årsavgiften på X % ger föreningen
cirka Y kr mer per år och täcker Z kr av glappet"). `sparbehov` (the target/gap in kr/m²) is NOT
changed; only the component's BRF amount is. Without `andel` nothing is offset.

### Share after a raise in effect (2026-10-25)

The report's årsavgifter (and the fee income derived from räntekänslighet) predate a stated raise that the check finds in effect, while the buyer's fee includes it. The fee-based share therefore divides by årsavgifter × Π(1 + p) of the in-effect raises (`raknaAndel`), and the raise's yearly revenue in the savings-gap offset becomes årsavgifter × p. The fee-deviation question (`avgiftsavvikelseFraga`) compares the buyer's fee with the raised level and names both levels. Volontären 12 (fee 2 104, +25 % from 2024-05-01): share 0,0445 → 0,0356, lokaler 453 → 363 kr/mån, and no deviation question (2 104 = 1 683 × 1,25).
