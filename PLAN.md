# Binfo — current plan

**Latest: sustainable fee + longer refinancing horizon (2026-10-24c, in progress), below. Before it: report → price via the expected fee rise (2026-10-24b). Before it: Booli prefill (2026-10-24). Before it: "Spara analysen" (2026-10-24, committed a73af11). Before it: round 3 of 2026-10-23 (no re-runs on read, register summary, grade bands, fixed figures, motivation check, CLI input check), below.** Background plan: [`docs/PLAN-v3.md`](docs/PLAN-v3.md)
(v3, deployed 2026-10-14). Decisions: `docs/DECISIONS.md`.

Earlier plans (done, kept for history): the UI copy + new `/exempel` plan further below
(2026-10-12), and `docs/PLAN-v2.md` (2026-10-09).

---

# Plan: sustainable fee (A) + longer refinancing horizon (B) (round 2026-10-24c)

Status: **APPROVED 2026-10-24, in progress.** Budget max 40 kr API. No deploy without the
owner's OK. One commit per task. Follows point 4 ("the förening's finances barely move the
price"). Owner decision: build A and B; C (räntekänslighet) stays out of the price.

## Step zero (done)

- `docs/underhall-referens.md` (research subagent, shown to the owner 2026-10-24, approved "A ok"):
  - 300 kr/m² totalyta/year as the no-plan default is sourced: HSB Bostadsrättsbarometern 2026
    ("schabloniserat sparande på 300 kr/kvm/år" when a plan is missing) and Riksbyggen 2025
    (305). Range across sources 250–350.
  - No source gives savings need by building age. Component lifetimes are medium-sourced (FAR
    2025, SIB M84:10). Per-component costs per m² are weak or missing. So the default is NOT
    built from component costs; components only move it within 250–350.
  - HSB-style reports state "investeringsbehov per m²" (50-year plan average): the best target
    when present.
  - Side finding, not changed: BENCHMARKS.md grades sparande "God" above 0, far more lenient
    than every external scale (HSB: < 120 mycket lågt).

## Owner answers (2026-10-24)

1. Colours apply in the summary, "Så har vi räknat" and the price section of the full report.
2. Fee pressure: green < 2 %, yellow 2–10 %, red > 10 % of today's fee (per step and total).
3. The range isn't shown any more (best guess only). A schablon-based target counts 50 % of the
   gap.
4. A surplus may RAISE the price (good economy, saves more than needed).
5. B weights: months 25–36 × 0.75, 37–48 × 0.5, 49–60 × 0.25; ≤ 24 months × 1.
6. PROMPT_VERSION 10 (deploys together with the undeployed v9); `/exempel` may be regenerated.
7. Savings = the statutory sparande per m² totalyta; the target is per m² totalyta too.
8. Labels: baseline "Vad jämförbara lägenheter säljs för"; adjusted "Värde med hänsyn till
   föreningens ekonomi". Charts in plain HTML/CSS (no recharts: Worker bundle).

## Design

### A. Sparandegap (replaces `spargap`)

Gap (kr/m² totalyta/year) = target − sparande; BRF kr/year = gap × totalyta; flat kr/month =
× andel ÷ 12 as today. Negative gap (surplus) lowers the expected fee and raises the price.

Target, first available:

1. `underhallsplan.investeringsbehovPerM2` (report's nyckeltal) — källa "underhållsplan".
2. `underhallsplan.rekommenderadAvsattning` (kr/year the plan says should be set aside) ÷ totalyta.
3. Planned costs with amounts over the plan period ÷ years ÷ totalyta (`planeradeKostnader` with
   fran/till, or a stated plan total over N years), EXCLUDING projects already counted by the
   remaining `underhall` component (avoids double counting).
4. Schablon 300 kr/m² (config, cited), moved by the building parts within [250, 350]:
   - For each tracked part (stambyte, tak, fasad, fönster, ventilation, el, hiss — config with
     lifetime ranges from the reference doc): `nyligen` (done less than half its lower lifetime
     ago), `ok`, `eftersatt` (last done, or byggår if never mentioned, longer ago than its upper
     lifetime) or `okant` (no byggår and no renovation year).
   - score = (#eftersatt − #nyligen) ÷ #assessed (okant excluded) ∈ [−1, 1];
     target = 300 + 50 × score.
   - Only 50 % of the gap counts (owner); `beraknad` with `dampning: 0.5`.

Debt from recent work is not penalised (debt only enters via refinancing). Missing sparande →
`saknar_underlag` as today. A planned, financed withdrawal keeps today's exception only when
the target comes from the plan (the plan already contains the withdrawal).

**`underhall` component**: when the target comes from the plan (1–3), it keeps only projects
within the 24-month horizon not covered by the fund (spread over 10 years as today); with the
schablon target there are no plan amounts, so it stays `saknar_underlag` as today.

### B. Refinancing, two phases

- ≤ 24 months: as today, both directions (weight 1).
- 25–60 months (`HORISONT_LANG_MANADER` 60): only loans whose current rate < the assumed new rate
  (SSVX + 0.58); every cheaper loan counts; weight by maturity band (0.75 / 0.5 / 0.25). Never
  prices a cut that far ahead.
- Today's rate level throughout. Per-loan rows in the result (date, amount, rate → new rate,
  weight, kr/year) for the UI. The 50 % assumption for undated debt applies to the 24-month
  phase only (no assumed later phase).

### C. Räntekänslighet

Not in the price. The rate table stays; one line in "Så har vi räknat".

### Fee pressure colour

`tryck: 'gron' | 'gul' | 'rod'` per component and total from |kr/month| ÷ today's fee: green
< 2 % (or any decrease), yellow 2–10 %, red > 10 %. Mapped to the existing status tones
(god/svag/kritisk) in web, summary and PDF.

### Contract (optional additions only; old data parses)

- `Forening.genomfordaAtgarder?: Array<{ byggdel: Byggdel; ar: number; text; ref }>` (cited).
- `underhallsplan.investeringsbehovPerM2?: Figure`, `rekommenderadAvsattning?: Figure`,
  `planTotal?: { belopp: Figure; ar: number }` (stated total over N years).
- `AvgiftsKomponentId` gains `sparandegap` (replaces `spargap`; prognoses are assembled per read,
  only the `/exempel` snapshot changes).
- `AvgiftsKomponent.tryck?`, `Avgiftsprognos.tryck?`, `sparbehov?` (target, källa, sparande,
  gap, dampning, building parts with status/last year/lifetime/ref) and
  `refinansiering.lan?` (per-loan rows with phase and weight).

## Tasks

- **T0 (supervisor):** commit `docs/underhall-referens.md`; config in `prognosantaganden.ts`
  (schablon 300 + range + source, 50 % dampening, part lifetimes with sources, long horizon +
  weights, pressure thresholds); contract + Zod + schema tests.
- **T1 extraction v10 (agent pdf-pipeline):** `prompts.ts`, `slutfor.ts`, `sidreferenser.ts`,
  goldens, `__fixtures__`: genomförda åtgärder with year (förvaltningsberättelse, notes,
  "tidigare åtgärder" tables), investeringsbehov per m², the plan's recommended allocation, plan
  total; PROMPT_VERSION 10; drafted answer keys (UTKAST) for ~4 reports.
- **T2 calc (agent pdf-pipeline #2, tests first):** new `calc/sparbehov.ts` (target selection,
  building-part status, score), `avgiftsprognos.ts` (sparandegap, two-phase refinancing,
  narrowed underhåll, pressure colour). Hand-computed unit tests: each target source, surplus,
  dampening, part statuses incl. never-mentioned + old byggår, the 250/350 clamp, weights per
  band, cheaper-only rule, both directions within 24 months, old p8/p9 extractions.
- **T3 assembly (supervisor):** `prisjustering.ts` (positive adjustments, no range talk),
  `sammanfattning.ts` (colour word + shorter text), `assemble.ts`.
- **T4 UI + PDF (agent frontend-state, after T0 types):** `AnalysRapport.tsx`,
  `analysisView.ts`, PDF. Price section: the two labelled prices + a small waterfall bar
  (baseline → each component's contribution → adjusted). "Så har vi räknat" rebuilt visual-first:
  per step a headline, one large number, one line, a small source tag ("Årsredovisning s. 5",
  "Underhållsplan", "Schablon"/"Uppskattning"), and "Visa mer" for details. Chains:
  behov → sparande → glapp → avgift → pris; loans list (maturity, amount, rate → new rate,
  weight, effect); building parts table ("Stambyte · senast 1978 · normalt 40–60 år · eftersatt").
  The C line. Colours from `tryck`. Existing kit only; "For Lovable to polish" list.
- **T5 verification (supervisor + reviewer):** `verify-extraction` on ~5 reports (≈ 18 kr),
  one fix iteration (≈ 7 kr), regenerate `/exempel` (≈ 3.5 kr); worked examples: the fictional
  cases + two real reports; screenshots of "Så har vi räknat" (Playwright on the cached
  Chromium, SSR of the report with the built CSS); reviewer pass; typecheck/test/lint/build;
  CLAUDE.md, PLAN.md, `docs/avgiftsprognos.md`, DECISIONS.

T1 ∥ T2 after T0; T3 after T2; T4 can start after T0 on fixture data; T5 last.

## Risks

- One year's sparande can be unusually high or low; a surplus now raises the price. Mitigation:
  the 30 % guard works both ways (marked osäker), and a schablon target counts only 50 %.
- Many reports don't mention past renovations; "never mentioned + old byggår" then reads as
  eftersatt and pulls the target to 350. Bounded by the range and the 50 % dampening.
- The plan-based target depends on correctly reading plan totals (30- vs 50-year totals,
  inflation-indexed plans). Per-item citations + the guard.
- PROMPT_VERSION 10: the web app and Edge must deploy together (with v9 and both migrations).
- Overlap between sparandegap and underhåll remains for horizon projects (owner spec);
  documented.

---

# Plan: report → price through the expected fee rise (round 2026-10-24b)

Status: **DONE 2026-10-24, committed on `main`, not pushed, not deployed.** API spend this round:
54.28 kr of 60 (rows 109–114 in `docs/api-test-log.md`).

## Result (2026-10-24)

- **Done:** T0–T7. Contract (optional fields), extraction v9 (per-loan rows, räntekostnader,
  maintenance amounts, lokaler, energy, balansdag, brf-yta), fee prognosis + price adjustment +
  fee table + report-vs-input comparison + closing summary on every read, Riksbank reference
  rate with a daily cache (migration `20261025120000_referensranta.sql`), UI + PDF, new `/exempel`
  snapshot from a real v9 run.
- **Checks:** typecheck 0; 136 files / 2824 tests pass; build OK; lint: 0 errors in this round's
  files (14 prettier errors remain in Lovable-edited files outside the diff: `AnalysStatus.tsx`,
  `SparadKalkylExport.tsx`, `ui/*`, `routes/index.tsx` — fix with `npx eslint --fix` when Lovable
  is idle); `npm run dev`: `/exempel`, `/analysera`, `/forhandsvisning/<id>` 200, "Så har vi
  räknat" collapsed in SSR.
- **Paid verification:** nyckeltal 144/159 on the first v9 wording (Granen dropped all 7: the
  longer grounding prompt skipped the flerårsöversikt; Albohem later the same). Fix: nyckeltal
  FIRST in the grounding prompt. Shipped wording: Albohem 24/24 ×2, Granen 27/27; loans 42/42 +
  19/19 + 10/10 on the UTKAST loan keys; Helsingborgshus 10/10 loans exactly.
- **Review** (independent agent): 0 critical; fixed: stale reports (> 18 months) no longer price
  refinancing, undated/uncovered debt gets the 50 % assumption + range, byggår filters tightened
  (false positives), Riksbank back-off after a failed fetch, the uncertain-byggår alternative
  price now carries the fee adjustment.

## Left for the owner

1. **Deploy together** (PROMPT_VERSION 9): `db push` (`20261024120000_annons.sql` if not yet,
   then `20261025120000_referensranta.sql`), `deploy:edge`, Lovable publish. Existing register
   reports are served as "older version" with year-only maturities until re-uploaded.
2. Verify the loan answer keys (`fixtures/answer-key-lan/*.json`, all `UTKAST`).
3. Review the placeholder assumptions in `src/lib/analysis/calc/prognosantaganden.ts` (50 %,
   10 years, 50 % lokal rent, 3 % widening, 30 % guard, 18-month staleness).
4. Lovable polish: "Så har vi räknat" layout, component rows, the fee table (narrow screens),
   the Byggår badge in the summary card (smaller badge or icon; full-width PDF cell), the "Sammanfattning" card, the second price row,
   the PDF sections.
5. Optional: a deterministic re-run of grounding when all seven nyckeltal come back null on a
   text report (the drop-out was seen twice on intermediate wordings, 0/3 on the shipped one).
   Budget: max 60 kr API. No deploy without the owner's OK. One commit per task.

## Context

Step 1 (Priskoll) prices the flat from the form. Step 2 (årsredovisning) grades the BRF, but nothing
from the report reaches the price. Goal: the report affects the price through **one channel**, the
expected rise in månadsavgift over the next ~24 months. The model already prices today's fee, so we
only add what isn't visible yet. The grade never moves the price. Previous sales in the förening
are out of scope, but the price is built as a list of adjustments so one can be added later.
Round 2 (Booli) is not touched.

## Step zero: findings (read-only, done 2026-10-24)

1. **Månadsavgift is a model feature**, as `fee_per_sqm` = avgift ÷ boarea, in the LightGBM model
   on log(kr/m²) (`src/lib/vardering/features.ts:65`). The trees have no single coefficient and are
   not monotone in the fee. Finite differences measured −1 278 … +170 kr per kr/mån, signs flipping.
   The OLS companion (`ml/artifacts/valuation-v3.1/metadata.json` `effects_fee_per_sqm`) gives
   **β = −0.0024471 per kr/m²/mån** (CI −0.00280 … −0.00210, p = 1.9e-42, n = 4 991).
   - In kronor: price change ≈ β × rise(kr/mån) × the flat's kr/m².
   - Examples: ≈ 300 kr per kr/mån at Kungsholmen (122 000 kr/m²), ≈ 125 kr in Farsta.
   - **Owner: use the OLS β, flat-specific.** Caveat to keep visible: it is an association; the fee
     level partly proxies debt and building condition.
2. **No price adjustment exists** for debt deviation or the riskbetyg, so there is nothing to
   remove. The debt share (`andelAvForeningensSkuld`) stays a comment line, never applied.
3. **Extraction audit** (what's missing vs the brief):
   - **Fee share is extracted already** (13/13 answer keys). It is ungraded (`status` always
     `okant`) and hidden in the report by the owner (`BENCHMARKS.md`).
   - Missing: the full villkorsändringsdag (only the year is kept); fixed vs rörlig; lender;
     räntekostnader; planned withdrawal and its financing; underhållsplan amounts, fund balance and
     financing; lokal rent and lease end dates; energy projects.
   - **brf-yta is extracted but dropped** (it lives in `kontrollsummor`, which is not in
     `AnalysisResult`).
   - The prompt example mixes totalyta and brf-yta.
   - Byggår is sometimes read from "Värdeår".
4. **The byggår-missing bug** comes from model-written text: the extraction's
   `extraktionKonfidens.skal` and the judging. Neither sees the buyer's input; no code merges the two.
5. **STIBOR:**
   - The Riksbank API stopped publishing it in July 2020.
   - swfbf.se blocks servers (Vercel bot checkpoint, HTTP 429).
   - Its terms require a paid licence for commercial use.
   - **Owner: use the 3-month T-bill (SSVX, Riksbank `SETB3MBENCH`) behind a reference-rate
     interface that STIBOR can replace later.**
6. **BRF margin.** Loans counted as variable: explicitly "rörlig", or a villkorsändringsdag within
   3 months of the balance-sheet date, since the reports rarely label the type.

   | BRF (balance date)              | Loan, rate, reset date                                    | SSVX that day | Margin             |
   | ------------------------------- | --------------------------------------------------------- | ------------- | ------------------ |
   | Volontären (2023-12-31)         | 4.85 % 2024-01-02 / 5.70 % 2024-03-07 / 5.05 % 2024-03-01 | 3.984         | 0.87 / 1.72 / 1.07 |
   | Beckasinen 14 (2024-12-31)      | 3.54 % 2025-01-20                                         | 2.422         | 1.12               |
   | Helsingborgshus 17 (2025-08-31) | 2.61 % 2025-09-28                                         | 2.026         | 0.58               |
   | Torsborgen 3 (2025-12-31)       | 2.43 % 2026-01-28 / 2.32 % 2026-03-28                     | 1.948         | 0.48 / 0.37        |
   | Pontonjären 3 (2025-12-31)      | 2.53 % 2026-03-28                                         | 1.948         | 0.58               |
   - Median per loan 0.73; **median per BRF 0.58 → default margin 0.58 pp**.
   - No qualifying loan: Granen, Hökensgata, Albohem, Näcken. Göken is debt-free.
   - test_rapport's loan table is garbled.
   - The 3 scans (Zederslundshus, Ängsknarren, Startfältet) are read visually in T0 (free) and added
     if they qualify.

## Owner decisions this round (2026-10-24)

- **Assumptions (moderate set, all `TODO: unverified placeholder` in one config file):**
  - horizon 24 months
  - 50 % of debt refinances when maturities are missing
  - maintenance spread over 10 years
  - 50 % of lokal rent at risk
  - each missing input widens only the **low** end of the price range by 3 %
  - the refinancing range runs from 0 to 100 % of debt when maturities are missing
- **No separate recommendation.** Instead:
  - "Så har vi räknat" explains where the price comes from: the model AND the report (fee rise,
    energy).
  - "Sammanvägt riskbetyg" stays as it is.
  - A **new closing summary section** at the end of the report, before the save options, covers:
    - the grade + a comment
    - the estimated (adjusted) price
    - the deviation from utgångspris, if one was given, and whether it looks attractive given how
      far above utgångspris flats in the area tend to sell (budpremie)
    - the potential fee rise + a comment
    - a short closing line
  - Buyer-level, so it is **deterministic** (no API; assembled on every read).

## Design decisions I'm taking (change any at approval)

- **Apartment share** = (avgift × 12) ÷ the BRF's årsavgifter (`kontrollsummor.arsavgifter`).
  - Fallback: boarea ÷ brf-yta.
  - Fallback: årsavgifter derived as debt ÷ räntekänslighet.
  - (`andelstal` is always 0 in the form, so it is never used.)
- **Horizon** counts from the day of the read. A loan whose reset date fell between the balance
  date and today counts as repricing: its new rate isn't in the report. Rörlig loans always count.
  An old extraction with only a maturity year gets a 1 July date.
- **Computed on every read** with today's cached rate (reads stay free). The rate value, date and
  source are shown. `/exempel` is a frozen snapshot.
- **Per-field confidence** is derived, not asked of the model:
  - hög = report source + verified citation, no `osaker` mark, not a scan, extraction confidence not
    `lag`
  - medel = a scan or a computed value
  - låg = an `osaker` mark
- **Byggår:**
  - At hög confidence the report's byggår replaces the user's in the **valuation input**, so the
    full analysis can differ from the Priskoll; this is explained in "Så har vi räknat".
  - Within ±1 year counts as a match.
  - **Osäkert:** the valuation is re-run with the other value and the range is extended to cover it.
- **Deviation from utgångspris** in the full report is measured against the **adjusted** price.
  This uses a new field; the shared core and the Priskoll are unchanged.
- **Sanity guard:** a total rise above 30 % of today's fee (placeholder) still applies, but is
  marked osäker and adds a question to the styrelse. This guards against misreading a 30-year
  maintenance total as unfinanced.
- **Rate table** replaces the web slider (owner request). `rantestress.scenarier` stays for the
  calculator link and old data.

## The calculation (pure, `src/lib/analysis/calc/avgiftsprognos.ts`)

All amounts are BRF kr/year, converted to the flat's kr/month with `× andel ÷ 12`. Each component
has a status: `beraknad` | `saknar_underlag` (→ widens the range) | `ej_aktuell`.

1. **Spargap:**
   - sparande/m² totalyta × totalyta when that is negative.
   - `ej_aktuell` if a planned withdrawal is reported as financed.
   - Value null with sign "neg" → `saknar_underlag`.
2. **Refinansiering:**
   - Σ over loans resetting within the horizon (plus rörlig loans) of belopp × (ny − nuvarande) ÷ 100.
   - Can be negative.
   - The current rate is the loan's rate; fallback snittränta; fallback räntekostnader ÷ total debt.
   - Ny = SSVX + margin.
   - No maturities → 50 % × total debt (range 0–100 %).
   - Debt-free → 0.
3. **Underhåll:**
   - Planned costs within the window that are not financed by a loan, the fund or a decision,
     minus the fund balance, minus planned yearly savings × years.
   - When positive, spread ÷ 10 years.
   - Plan amounts missing → `saknar_underlag`.
4. **Lokaler:**
   - Rent of leases ending within the horizon × 50 %.
   - A lease end date without its rent: total lokal rent × (ending leases ÷ all leases).
   - Otherwise `saknar_underlag`.
5. **Energi:**
   - Unfinanced energy projects with an amount, ÷ 10 years.
   - Financing unknown → `saknar_underlag`.
   - Energikostnad itself is already in today's fee, so it is explained in the text but never added.

Price adjustments (`src/lib/analysis/prisjustering.ts`):

- The structure is `justeringar: Prisjustering[]`; today the list holds one entry,
  `forvantad_avgiftshojning`.
- Price effect = −rise × (−β × baseline kr/m²).
- Adjusted price = baseline + Σ effects.
- Range = the baseline range shifted by the same amount, then the low end widened 3 % per
  `saknar_underlag` component, and for osäkert byggår.

Rate table rows:

1. idag
2. förväntad = fee + rise
3. +1 pp
4. +2 pp

Rows 3–4 add only on debt that reprices within the horizon (repricing debt R × pp ÷ 100 × andel ÷
12). Each row shows kr/month and the change from today.

## Tasks (order; owner of each; files)

### T0 — step-zero record (supervisor)

- Read the 3 scans' loan notes visually; finalise the margin.
- `docs/avgiftsprognos.md` gets: step-zero findings, the β derivation, the margin table, the STIBOR
  finding, the formulas, known overlaps.
- `docs/DECISIONS.md` gets an entry; `PLAN.md` gets this plan.

### T1 — contract + Zod (supervisor; stop-and-flag file, approved via this plan)

All additions are **optional**, so every stored result still parses.

`src/types/analysis.ts` + `src/lib/analysis/schema.ts`:

- `Forening`:
  - `bostadsrattsyta?: Figure`
  - `balansdag?: string`
  - `lanebok.lan?: Lan[]`, where `Lan = {kreditgivare?, belopp: Figure, ranta?: Figure, villkorsandringsdag?: string, rantetyp: 'rorlig'|'bunden'|'okant', ref}`
  - `lanebok.rantekostnader?: Figure`
  - `sparandeUttag?: {planerat: Tristate, finansierat: Tristate, text?, ref?}`
  - `underhallsplan.{planeradeKostnader?: [{fran?, till?, belopp: Figure, text?, finansiering: 'lan'|'fond'|'beslutad'|'ofinansierad'|'okant', ref?}], underhallsfond?: Figure, arligAvsattning?: Figure}`
  - `lokaler?: {hyresintakter?: Figure, kontrakt?: [{arshyra?: Figure, slutdatum?: string, ref}]}`
  - `energiprojekt?: [{text, belopp?: Figure, finansierat: Tristate, ref?}]`
- `AnalysisResult` (assembled):
  - `avgiftsprognos?`: components, total, andel + method, the refinancing inputs (maturing amount,
    current rate, new rate, reference rate {name, series, date, %}, margin), missing inputs
  - `uppgiftsjamforelse?`: per field {user value, report value, status
    `bekraftat|avviker|manuellt|osakert|endast_rapport`, value used, text, ref}
  - `sammanfattning?`: {betyg, pris, avgift, slutsats} text blocks
- `Prisanalys`: `justeringar?`, `justeradVardering?`, `avvikelseMotJusteradVardering?`
- `Rantestress`: `prognosTabell?`
- `Forhandsvisning` is not widened. `PrisuppskattningResultat` is unchanged.
- Schema tests: old sample and old fixtures still parse; unknown nested keys are rejected.
- Config file `src/lib/analysis/calc/prognosantaganden.ts` holds all assumptions + β + margin +
  fallback rate, each with its source/date or a TODO.
- A sync test checks β against `metadata.json`.

### T2 — extraction (agent `pdf-pipeline`)

Owns: `prompts.ts`, `slutfor.ts`, `sidreferenser.ts`, `rimlighet.ts`, `tolkaVarde.ts` if needed,
`__fixtures__/extraktion.ts`, `__golden__/*`, `answerKey.ts` / `verifyAnswerKey.ts`, new
`fixtures/answer-key-lan/*.json`.

- Grounding + extraction prompts for the new fields; **PROMPT_VERSION 9**.
- Fix the totalyta/brf-yta example.
- Byggår ≠ värdeår (take värdeår only when nothing else is given, and say so in the excerpt).
- Never write "byggår saknas" type notes into `skal`.
- Every new item is cited; uncited items are dropped (slutfor).
- ISO date validation.
- `forfalloprofil` is derived deterministically from `lan` (one source; the judging and
  `fastaVarden` keep working).
- `rantetyp` heuristic in code: label first, else reset date ≤ 3 months after the balance date →
  rörlig.
- New excerpts are verified by `sidreferenser`.
- Sanity checks: Σ lan ≈ totalSkuld; räntekostnader ÷ debt within 0–10 %.
- Loan answer keys drafted by me from the PDF text for ~5 reports, marked `UTKAST` for the owner to
  verify; `verify-extraction` scores them.

### T3 — calculation + price + merge (agent `pdf-pipeline` #2; pure, new files only, tests first)

- `calc/avgiftsprognos.ts` (+ test)
- `prisjustering.ts` (+ test)
- `uppgiftsjamforelse.ts` (+ test)
- `calc/rantestress.ts` gets `prognosTabell` (+ test)
- Hand-computed cases: each component, negative refinancing, debt-free, missing maturities (0/50/100
  %), old extraction with years only, missing andel fallbacks, lease inside/outside the horizon, the
  30 % guard, widening counts, byggår statuses (bekräftat / avviker / manuellt / osäkert,
  medium-confidence match).

### T4 — reference rate (supervisor)

- `src/server/referensranta.ts`, server-only, behind an interface.
- Riksbank SWEA `SETB3MBENCH` latest observation; 5 s timeout.
- Cached daily in a new table `referensranta` (migration `20261025120000_referensranta.sql`, RLS on,
  zero policies, plus a rollback script).
- Fetch fails → the last cached value, with its date. Nothing cached → the config fallback, labelled.
- New `Databas` methods go in `portar.ts`, `supabase.ts`, `__fakes__/lager.ts` and the Edge
  `index.ts` (enforced by a test).
- `assembleraAnalys` takes the rate as an optional input. The Edge dry assembly passes the fallback
  and never fetches.
- Fetched in `monteraResultat` (`src/server/analys.ts`).
- Tests use a fake fetch (timeout, stale cache, bad JSON).

### T5 — assembly + summary + byggår fix (supervisor)

- `assemble.ts`:
  - merge → valuation input (byggår)
  - `avgiftsprognos`
  - adjustments
  - rate table
  - question for the 30 % guard
  - filtering of model text claiming byggår is missing when the user or report has it
- New `sammanfattning.ts`: deterministic Swedish texts from the result; no causal wording; no "köp /
  köp inte".
- Tests with the extraction fixture and with an old (p8) extraction.

### T6 — UI + PDF (agent `frontend-state`; after T1/T3 types are fixed)

Owns: `AnalysRapport.tsx`, `PropertySummary.tsx`, `analysisView.ts`, `pdf/viewModel.ts`,
`pdf/AnalysPdfDocument.tsx`, `src/data/sampleAnalysis.ts` and the tests that follow it.

- **Price section:**
  - a "Binfos värdering (modell)" line + a "Justerat för väntad avgiftshöjning" line
  - the deviation against the adjusted price
  - **"Så har vi räknat"** as a native `<details>`, collapsed (the `bolanekalkyl` pattern):
    1. what drives the baseline, with directions; the factor list moves here (the Priskoll too)
    2. "Baserat på årsredovisningen väntar vi oss att avgiften höjs med ca X kr/mån…": the
       components, the price effect, the energy note
    3. the refinancing inputs
  - No riskbetyg mention.
- **Räntekänslighet:** a 4-row table instead of the slider.
- **"Dina uppgifter mot årsredovisningen"** rows with statuses.
- **Closing summary** before the save card.
- **PDF mirrors all of it.**
- Existing components only, minimal styling; a "For Lovable to polish" list.

### T7 — paid verification + worked examples + review (supervisor + agent `reviewer`)

- `verify-extraction` on the ~9 text answer-key PDFs (≈ 27 kr) and one fix iteration (≈ 10 kr).
- `npm run extract` on two reports for the worked examples, Pontonjären 3 and Helsingborgshus 17
  (≈ 7 kr). The Pontonjären run regenerates `/exempel` after checking the judging against the PDF.
- Planned ≈ 45 kr; every run logged in `docs/api-test-log.md`; a warning at 50 kr.
- Independent `reviewer` pass on the full diff; then `typecheck`, `test`, `lint`, `build`, `dev`
  (browser check of `/analysera` + a report page).
- CLAUDE.md / PLAN.md updated.

Parallel: T2 ∥ T3 ∥ T4 after T1; T5 after T3/T4; T6 after T1/T3 (it can start on the fixture); T7
last. No two agents share a file. Agents never commit; I review every diff, re-run the checks and
commit per task.

## Risks

- **PROMPT_VERSION 9** → the web app and the Edge Function must deploy together. Existing register
  reports are served as the older version with year-only maturities. Their prognosis then rests on
  years and assumptions, with wider ranges, until someone uploads the report again (reads never
  re-run).
- **New migration** (`referensranta`) must be applied before the Lovable publish. The Riksbank API
  from Cloudflare egress is unverified; the fallback chain covers it.
- **Underhållsplan amounts are often missing**, so many reports will show a widened range rather
  than a maintenance amount. Model misreads could create large rises; the 30 % guard and per-item
  citations are the mitigation.
- **β is an association**, and the defaults (50 %, 10 years, 3 %) are placeholders. Both are
  labelled in the UI and docs.
- **The full-analysis baseline can differ from the Priskoll** when the report's byggår wins. This
  is explained in "Så har vi räknat".
- **Contract change touches both sides.** All additions are optional and the schema tests cover old
  data.
- **`/exempel` regeneration may need two runs** (judging text checked against the PDF).

## Verification

- Unit tests for the fee-rise maths, the adjustments, the merge statuses and the rate table
  (hand-computed numbers in the test names).
- A schema test for old stored results.
- An assembly test on p8 and p9 extractions.
- A UI SSR test: `<details>` closed by default, the table has 4 rows, the summary sits before the
  save card.
- PDF view-model tests.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm run dev` with a browser
  check.
- Two worked examples (Pontonjären 3, Helsingborgshus 17) shown in the final summary: each
  component, andel, refinancing inputs, rise, coefficient, baseline → adjusted price, rate table.

---

# Plan: Booli link → prefill on /analysera (round 2026-10-24)

Status: **DONE 2026-10-24, committed on `main` (905b711…c4289f3), not pushed, not deployed.**
Findings: `docs/booli.md`. API spend this round: 0 kr (see "Not done").

## Result (2026-10-24)

- **Done:** T0 fixtures + docs, T1 contract (`PropertyInput.kalla`), T2a URL check + parser,
  T2b service (cache, quota, entitlement, kill switch, Nominatim fallback, Haiku fallback behind a
  flag, migration), T2c UI, T3 verification and an independent review (0 critical; 1 major + 4
  minor fixed: stale values on a second fetch, schema-unsafe broker link, edits lost during a fetch,
  model values labelled as Booli facts, geocoding guessing Stockholm).
- **Checks:** typecheck 0; 124 files / 2610 tests pass; lint 0 errors (8 baseline warnings);
  build OK (Worker 1.74 MB gz); `npm run dev` on local env: no import-protection overlay.
- **E2E on the built Worker** (`wrangler dev`, local Supabase, live Booli): all 6 URLs fill every
  field as in the fixtures, missing fields highlighted, one server call per paste and none other,
  edit → "Ändrat manuellt", non-Booli/non-listing/empty messages, kill switch message, second
  fetch clears stale values, submit via the register path stores `property_input.kalla` with the
  right `oandradeFalt`, report renders. Screenshots at 390/1280 px.
- **Decisions:** server function instead of `/api/listing/fetch`; ort = kommun; only successes
  cached (24 h); quota 20/device + 60/IP per hour (not refunded on a failed fetch); a cache hit is
  free and is served before the entitlement check; overwrite only found fields (first fetch);
  geocoding only when the postcode is missing, reverse first, no town guess; `behorighet` error
  code; geocoded postcode labelled with OSM attribution.
- **Not done:** the real LLM-fallback run (reading `.env.local` was denied in this session; the
  fallback is off by default and unit-tested with a fake client). Earlier sales (owner: round 3).
  The production check of Cloudflare blocking (needs deploy).

## Left for the owner

1. Deploy: `npx supabase@2.117.0 db push` (migration `20261024120000_annons.sql`), then the
   Lovable publish. No Edge Function change needed. Then paste one live Booli link in production;
   if it's blocked, set `ANNONS_HAMTNING=off` in Lovable Secrets.
2. Booli's terms of use / database rights (unchecked).
3. `/integritet`: mention the Booli fetch, the stored listing URL (12 months) and Nominatim
   (address sent to OpenStreetMap when the postcode is missing). Proposed text in the final
   summary; not published.
4. Lovable polish: the Booli card layout, the `framhav` highlight, the hiss/balkong provenance text,
   the förening hint under the dropzone.

## Context

Buyers retype listing data that is already on Booli. Goal: paste a Booli listing URL on
`/analysera`, press "Hämta uppgifter", and the form fills itself from the page's embedded
structured data. **Zero LLM tokens** on the normal path. The paste never starts anything; only the
existing buttons do. The source URL is stored with the analysis.

Owner answers (2026-10-24):

- Fetch route: server fetch with a normal browser header set, behind a flag, graceful fallback.
  Verify from the deployed Worker before announcing.
- Earlier sales: **leave out this round**. Document the endpoints for round 3.
- Description: Booli has none, so **store the broker link only** (don't fetch it).
- Storage: optional `kalla` on `PropertyInput` (contract change), with a retention migration.

## Step zero findings (probed read-only 2026-10-24)

**Cloudflare bot check**

- curl's default UA, or a Chrome UA without `br` in `Accept-Encoding`, gets `403` +
  `cf-mitigated: challenge`.
- A full Chrome-like header set from the owner's Mac gets `200` on 6/6 URLs.
- Booli's internal `/graphql` is challenged even with the full header set.
- Untested: requests from the Cloudflare Worker (CF egress IPs, `CF-Worker` header, workerd TLS).

**Where the data sits (raw HTML, Next.js app router)**

- The `Listing` object (`__typename:"Listing"`) is in the RSC stream: concatenate the
  `self.__next_f.push([1,"…"])` strings, then JSON-parse from `"object":{"__typename":"Listing"`.
- JSON-LD gives the postcode (`Place.address.postalCode`) and the förening (last item in
  `BreadcrumbList`).

| Field                   | Path                                                             | Fixtures                  |
| ----------------------- | ---------------------------------------------------------------- | ------------------------- |
| adress                  | `streetAddress`                                                  | 6/6                       |
| postnummer              | JSON-LD `postalCode` / `areas[type=postcode].name`               | 6/6                       |
| coords                  | `latitude`, `longitude`                                          | 6/6                       |
| ort (kommun) / stadsdel | `areas[type=municipality].name` / `descriptiveAreaName`          | 6/6                       |
| utgångspris             | `listPrice.raw`                                                  | 5/6                       |
| månadsavgift            | `rent.raw` (`0` → missing)                                       | 5/6                       |
| boarea                  | `livingArea.raw`                                                 | 6/6                       |
| rum                     | `rooms.raw` (2.5 possible)                                       | 6/6                       |
| våning                  | `floor.raw`                                                      | 6/6                       |
| byggår                  | `constructionYear`                                               | 6/6                       |
| hiss / balkong          | `amenities[].key` `elevator` / `balcony` (only listed when true) | 6/6                       |
| förening                | JSON-LD breadcrumb "BRF …"                                       | 6/6 in the saved fixtures |
| broker link             | `listingUrl`                                                     | 6/6                       |
| description             | none on Booli                                                    | 0/6                       |

**Earlier sales**

- Not in the HTML; only `salesOfResidence` IDs are there.
- They are loaded by JS from `GET /graphql?operationName=salesOfProperty` (`residenceId`, `booliId`)
  and `comparableSales` (`objectType`, `postcodeId`, `addressId`). These are Apollo persisted
  queries.
- Fields: soldPrice, soldDate, livingArea, rooms, soldPriceType. No floor or fee. Max 12 per
  query, and "same address" means same street number, not same förening.
- Counts: same address 12/12/11/12/12/9; same flat 0/0/1/0/0/0.
- There is no historic area price index in the repo; one would need building for round 3.

## Tasks (in order; one commit each; `git pull` first)

### T0: fixtures + findings doc (supervisor)

- Save the raw HTML of the 6 URLs with the header set above to `fixtures/booli/<typ>-<id>.html`.
- Also save one challenge page to `fixtures/booli/cloudflare-challenge.html`.
- Script `scripts/hamtaBooliFixtures.mjs`: re-fetch, then run the parser and print per-field status.
  This shows when Booli's layout changes.
- `docs/booli.md`: the findings above (field map, blocking, GraphQL endpoints, earlier-sales table,
  round-3 notes).
- `docs/DECISIONS.md`: entry for the owner answers.

### T1: shared contract (supervisor, before the parallel work)

- `src/types/analysis.ts`: `PropertyInput.kalla?: AnnonsKalla`, where
  `AnnonsKalla = { typ: "booli"; url: string; maklarUrl?: string; forening?: string; hamtad: string; oandradeFalt: AnnonsFalt[] }`.
- `src/lib/analysis/schema.ts`: strict Zod mirror, `.optional()`. Stored rows parse unchanged;
  `lasPropertyInputFranRad` already strips.
- New client-safe `src/lib/annons/typer.ts`:
  - `AnnonsFalt` = adress, postnummer, ort, utgangspris, manadsavgift, boarea, antalRum, vaning,
    byggar, hiss, balkong.
  - `AnnonsUppgifter` holds the normalised values plus `stadsdel`, `forening`, `maklarUrl`,
    `koordinater`.
  - `AnnonsSvar` is either:
    - `{ok:true, kalla:"booli", url, uppgifter, status: Record<AnnonsFalt,"hittad"|"saknas">, postnummerKalla?: "annons"|"geokodning", tolkning: "struktur"|"llm", hamtad}`, or
    - `{ok:false, errorCode: "fel_doman"|"ogiltig_url"|"blockerad"|"hittades_inte"|"tolkning"|"natverk"|"kvot"|"avstangd", errorMessage}`.
- Parser signature stub `tolkaBooli(html, url): BooliTolkning` in `src/server/annons/booli.ts`, so
  T2a and T2b can run in parallel.
- Schema tests: with/without `kalla`; an unknown nested key is rejected.

### T2a: URL check + parser (agent `pdf-pipeline`; owns `src/lib/annons/url.ts`, `src/server/annons/booli.ts` + tests)

- **`url.ts`** (pure, shared with the client):
  - https only; host `booli.se` | `www.booli.se` exactly; no userinfo/port.
  - Path `/bostad/<digits>` or `/annons/<digits>`.
  - Canonicalises to `https://www.booli.se/<typ>/<id>` (the cache key).
  - Separates "not Booli" from "Booli but not a listing".
- **`booli.ts`**:
  - Parse the RSC `Listing` object and JSON-LD; never the visible HTML.
  - Normalise:
    - integers for kr
    - m² to one decimal
    - våning integer
    - rum may be .5
    - avgift is already kr/mån
    - `rent 0` / `listPrice null` → missing
    - hiss/balkong `ja` when listed, else missing (never `nej`: unknown ≠ false)
    - ort = kommun name
  - Recognise the challenge page (→ `blockerad`) and a missing Listing object (→ `tolkning`, with
    whatever JSON-LD gave).
- **Tests:** every fixture × every field, the challenge fixture, truncated/garbled HTML, and URL
  cases (`booli.se.evil.com`, `http:`, `user@`, ports, other paths).

### T2b: service (agent `pdf-pipeline`, second instance)

Owns `src/server/annons/{hamta,geokod,llmFallback}.ts` + tests, plus `kvot.ts`, `behorighet.ts`,
`kontoPortar.ts`, `supabaseKonto.ts`, `__fakes__/konto.ts`, `env.ts`, the `analysFn.ts` handler
and the migration.

- **`hamtaAnnonsFn`** (POST server function in `analysFn.ts`, same pattern as
  `hamtaPrisuppskattningFn`, no module-scope values). It runs, in order:
  1. Kill switch `ANNONS_HAMTNING` (`off` → `avstangd`; default on).
  2. URL check, then the 24 h cache (a hit is free).
  3. Entitlement `hamta_annons` (granted to all).
  4. Quota: new `KvotHandling "annonshamtning"`, 20/device and 60/IP per hour (product limits, via
     `ta_kvot`; no migration).
  5. One fetch: header set, 10 s `AbortController`, `redirect:"manual"` (a redirect is followed once
     only if it passes the URL check), 3 MB body cap, no retry.
  6. Parse, then the postcode fallback, then cache the success.
- **Logging:** `console.warn("[annons] …", {url, orsak})` on blocked, parse failure, a missing core
  field, and when the LLM fallback triggers.
- **`geokod.ts`:** Nominatim, used only when the postcode is missing.
  - Reverse geocode from coordinates; else search "street, kommun"; 5 s timeout.
  - Identifying User-Agent per the Nominatim policy.
  - Failure → postcode stays missing. Tests use recorded responses.
- **`llmFallback.ts`:** off unless `ANNONS_LLM_FALLBACK=on`. Only when structured parsing fails on a
  non-challenge page.
  - Input: stripped page text (≤ 20k chars). Model: Haiku 4.5 (`identitetModell` default).
  - Zod-validated; behind the daily spend cap.
  - Result marked `tolkning:"llm"`; logged.
  - Load the `claude-api` skill before writing it.
- **Migration** `supabase/migrations/20261024120000_annons.sql`:
  - Table `annons_cache (url text pk, svar jsonb, hamtad timestamptz)` with RLS on and no policies.
  - Redefine `binfo-retention`: keep today's lines, also drop `property_input->'kalla'` after 12
    months (the URL identifies the address), and purge `annons_cache` older than 2 days.
  - Matching `supabase/rollback/` script.
- **Tests:** fake fetch for timeout, a redirect to another host refused, the size cap, a cache hit
  skipping fetch and quota, quota refusal, kill switch, geocode only when needed, LLM flag off/on,
  and logs. Also `kvot.test.ts`, `behorighet.test.ts`, `analysFn.test.ts`.

### T2c: frontend (agent `frontend-state`; owns `src/routes/analysera.tsx`, new `src/lib/annons/formular.ts` + tests, `analyseraForm.ts`, `analysera.test.tsx`)

- **Above Steg 1:** `Field` "Klistra in länk från Booli" + `Button` "Hämta uppgifter", which shows
  "Hämtar…" while loading.
- **Client-side URL check first:**
  - another domain → "Endast Booli-länkar stöds just nu"
  - any failure → "Vi kunde inte hämta uppgifterna, fyll i manuellt"
  - quota/kill-switch errors show the server's message
- **Pure `formular.ts`:**
  - `tillampaAnnons(form, uppgifter, svar)` → new form, Tristates and per-field provenance
    (`booli` | `manuellt` | `saknas`).
  - It overwrites only fields that were found and never touches the other fields.
  - `markeraAndrad` flips `booli` → `manuellt` on edit.
- **Labels and highlighting:**
  - Field `hint` shows "Hämtat från Booli" or "Ändrat manuellt".
  - Missing and empty fields get the hint "Fanns inte i annonsen, fyll i själv" plus a highlight.
    This is a small optional `framhav` prop on `Field` using the existing `warning` token; the owner
    asked for highlighting, and it goes on the Lovable polish list.
  - Hiss/balkong get the same text beside their label.
- **Step 2:** a one-line hint "Booli anger föreningen: …" to help pick the right årsredovisning.
- `buildPropertyInput` adds `kalla` (with `oandradeFalt`) when a fetch happened.
- **The paste never calls `hamtaPrisuppskattningFn`, `skapaAnalysFn` or `skapaAnalysFranRegisterFn`.**
  A test asserts this.

### T3: integrate + verify (supervisor; `reviewer` agent on the full diff)

- Run `npm run typecheck`, `npm test`, `npm run lint` and `npm run build`, and report the real
  output.
- `npm run dev` on the **local stack** (`./scripts/v2-lokalt.sh`, migration applied, not
  production):
  - Playwright from the scratchpad: paste each of the 6 URLs live, then check the filled values,
    labels, edit → "Ändrat manuellt", and the highlighted missing fields.
  - Check the messages for a non-Booli URL and for the kill switch.
  - Check that nothing starts until a button is pressed.
  - Submit via the register path (0 kr) and check that `property_input.kalla` is in the local DB.
- **Workerd check:** `npm run build` + `npx wrangler dev`, calling the function, to see whether
  Booli accepts workerd's TLS. This is a data point only; the real test is after deploy.
- One real LLM-fallback run on a stripped fixture (≈ 0.05 kr), logged in `docs/api-test-log.md`.
  Expected spend this round < 1 kr (cap 30 kr).
- Update CLAUDE.md (new modules, flags, migration, deploy note), PLAN.md (this plan + status) and
  `docs/booli.md`.

## Parallelism

T0 → T1 (supervisor), then T2a ∥ T2b ∥ T2c on disjoint files, then T3. Agents don't commit; the
supervisor reviews each diff and commits per task.

## Deploy (owner, later)

1. `db push` (new migration).
2. Lovable publish. No Edge Function change: the worker only strips `kalla`, and there is no
   `PROMPT_VERSION` bump.
3. Right after publishing, paste one live Booli link in production. If it's blocked, set
   `ANNONS_HAMTNING=off` in Lovable Secrets.

## Risks

- Production fetch is blocked by Cloudflare (likely). The flag and the "fyll i manuellt" fallback
  limit the damage.
- Booli changes its RSC/GraphQL layout. Mitigation: parse-failure logs and the re-fetch script.
- Booli's terms and database rights are unchecked (owner).
- `/integritet` doesn't mention Booli fetching or Nominatim. I'll propose text but won't publish
  legal copy myself.
- `oandradeFalt` in `kalla` and the förening hint are small scope additions; drop them if unwanted.

## Decisions I'll make myself (noted in the final summary)

- Server function instead of a raw `/api/listing/fetch` route (consistent CSRF/kontext handling).
- The quota numbers, cache-only-successes, and overwriting only found fields.
- ort = kommun.
- The Priskoll doesn't auto-run after a fetch.

---

# Plan: "Spara analysen" for logged-out users (2026-10-24)

Status: **done, committed (a73af11), not deployed.** No migration, no API spend.

- Button on `/forhandsvisning/$id` and `/analys/$id` (under the grade, plus a card at the end) for
  a logged-out owner (analysis on this browser's device principal); logged-in owner sees "Sparad i
  din profil"; someone else's analysis shows nothing. Reuses `SparaKnapp`/`useAterstallUtkast`
  (`?spara=analys`, draft type `analys`; `SparaKnapp.skrivUtkast` became `forbered`).
- Password login: already saved by the existing device merge. New account via e-mail link: a
  signed 7-day marker `binfo_spara` (set by `forberedSparaAnalysFn` after the device check) lets
  `sparaAnalysFn` move exactly that `analys` row (compare-and-set). Tests:
  `src/server/sparaAnalys.test.ts`, `analysFn.sparaAnalys.test.ts`,
  `src/components/konto/SparaAnalys.test.tsx`.

---

# Plan: round 3 (2026-10-23) — before deploying round 2

Status: **DONE and committed on `main` 2026-10-23, not pushed, not deployed** (owner: "Do not
deploy until I confirm").

1. **No re-runs on read.** Status/result reads never queue anything; an older-version report is
   served exactly as stored (grade included) with the "tidigare version" note. A new run on the
   current version only on a user's upload or register request when the report exists only at an
   older version (spend cap + strict quota); the result then replaces it for every reader. Version
   stamp = existing `rapport.pipeline_version` / `analys.prompt_version` (no migration).
2. **Public register summary only.** `/brf/$slug` JSON = identity + per year: grade, existing
   nyckeltal with status (`RegisterArsSammanfattning`) + `BETYG_FORKLARING`. Full stored analysis
   on `/brf/$slug/analys/$ar` (`hamtaRegisterAnalysFn`, `no-store`, `noindex`), gated by the
   `se_registeranalys` entitlement (granted to all; one policy line to gate it).
3. **Grade bands** (`tillatnaBetyg`): 0/0 → A–C, 1 svag → B–C, ≥ 2 svag → C, any kritisk → C–E.
   BETYGSSKALA's E line aligned (E needs a kritisk figure). Only new analyses.
4. **Fixed figures** (`fastaVarden.ts`) in the judging prompt; number check
   (`siffrorKontroll.ts`) on the motivation.
5. **Motivation rewrite** (`motivering.ts`) on a clamp or a number mismatch: one small call, then a
   deterministic fallback. Never fails the stage.
6. **extract CLI** checks the input file before any paid call (`inputFil.ts`); optional fields warn.

Real run #108 (Pontonjären 3, 3.51 kr): motivation correct (74 %), no clamp, no rewrite needed.

**Deploy (owner, still pending):** `npm run deploy:edge` and the Lovable publish close together
(PROMPT_VERSION 8). No migration. Existing register reports are NOT re-run by the deploy.

---

# Plan: round 2 (2026-10-23) — full analysis at once, Priskoll in Analysera, question context, reproducible grade

Status: **DONE and committed 2026-10-23 (097e35d…6c394ad), not deployed.** Base: `main` @ c167e0d.

1. **Full analysis immediately.** `/forhandsvisning/$id` renders `AnalysRapport` inline when done
   (no redirect to `/analys`: that would loop on a done-but-unreadable result). Removed the preview
   projection (`hamtaForhandsvisning`, `hamtaForhandsvisningFn`, `Forhandsvisning` type), the
   locked cards and the CTA. Grade card got the "Sammanvägt riskbetyg" label. `gratisSektioner`
   stays (stored rows, strict schema). Payment hook documented on `ladda_upp_analys`.
2. **Priskoll merged into `/analysera`** (steg 1 Priskoll, steg 2 BRF-analys valfritt; shared form
   state; `/vardering` → 301 with `sparad`/`spara`; nav, landing links, /integritet, /konto, sitemap).
3. **Question context.** `Fraga.svarssignal?` (contract + Zod; blank = absent in the judging
   schema), prompt asks for a finding+number `varfor`; UI "Varför:" grey italic + signal line; PDF
   too; deterministic questions say how the answer affects the buyer. `PROMPT_VERSION` 7 → 8.
4. **Grade clamp** in `slutforBedomning` (`tillatnaBetyg`/`klampaBetyg`, logged), unit tests.

**Deploy (owner):** PROMPT_VERSION 8 → `pipeline_version` `p8.i1.s1`: `npm run deploy:edge` and the
Lovable publish close together. No migration. (The lazy re-run on read described here originally
was removed in round 3: stored reports are only re-run on a user's request.)

Checks: typecheck 0, 107 files / 2174 tests pass, lint 0 errors (8 baseline warnings), build OK,
browser check of `/analysera` + `/exempel` (no console errors), one real v8 run (#107, 3.62 kr).

---

# Plan: four changes (Exempel tab, hide recent analyses, Köpguide, optional utgångspris)

Status: **DONE 2026-10-23** (approved by owner 2026-10-23; all four committed on `main`, not pushed; deploy pending: `deploy:edge`, then Lovable publish). Base: `main` @ 59f968b. Commits go
directly to `main`, local only; no push, no deploy without the owner's OK.

## Owner answers (Phase 1, 2026-10-23)

1. Tab fix: square off the card's top-left corner. Nobody is editing in Lovable.
2. Hide "Dina senaste analyser" for everyone behind one constant; logic and storage untouched.
3. Rename to Köpguide; URL change to `/kopguide` is fine if easy (it is: done with a 301).
4. OK to make `PropertyInput.utgangspris` optional in the contract.
5. Without a price: /vardering's validation (a), the existing no-price price check on web
   and PDF (b), hide the summary row (c), calculator link uses the valuation or no price (d),
   no new missing-data question (e).
6. Deploy order documented (Edge first, then Lovable publish); owner deploys.
7. Commit to `main`. 8. Local E2E incl. one ~3 kr real upload is OK.

## 1. Exempel tab on the landing page

- **Cause:** `.dossier` has `border-radius: 1.25rem 1.25rem 0 0`; the tab
  (`.dossier-tab`, `left: -1px`, `bottom: 100%`) stands on the curve of the
  top-left corner, leaving a notch between the tab and the card edge.
- **Change:** `src/styles.css` only: `.dossier` top-left radius 0 (a folder
  tab), so the tab's left border continues straight into the card's left
  border. Nothing else visual changes.
- **Verify:** Playwright screenshots of `.dossier-wrap` at 390, 820, 1440 px,
  before/after.

## 2. Hide "Dina senaste analyser" on /analysera

- **Fact:** the box is browser localStorage (`src/lib/senasteAnalyser.ts`, max 5,
  12 months), not IP-based. Account history (`/konto` → Analyser,
  `lista_mina_analyser`) is a separate component and stays unchanged.
- **Change:** `src/routes/analysera.tsx`: one exported module constant
  `VISA_SENASTE_ANALYSER = false` (with a comment on how to restore);
  `SenasteAnalyserSektion` stays and renders nothing while it is false.
  `sparaAnalys` calls (analysera, förhandsvisning, analys) keep writing.
  The privacy page text about local storage stays true (storage continues).
- **Layout:** the section was a `Card mb-6` between the "Bara priskoll?" line
  and the upload card; returning `null` leaves no wrapper, so no gap.
- **CLAUDE.md:** note that browser-side recent-analyses storage (and server-side
  device-cookie linkage) is still active in the background; open question.
- **Verify:** test that the section renders nothing even with stored entries;
  browser check of /analysera spacing.

## 3. Guide → Köpguide

- **Route:** `git mv src/routes/guide.tsx src/routes/kopguide.tsx`
  (`createFileRoute("/kopguide")`); new `src/routes/guide.tsx` that only
  `throw redirect({ to: "/kopguide", statusCode: 301 })` in `beforeLoad`
  (same pattern as `brf.$slug.tsx`). `routeTree.gen.ts` regenerates (not hand-edited).
- **Text:** nav label "Köpguide" (`SiteNav.tsx`); title/og:title
  "Köpguide: hela bostadsköpet steg för steg — Binfo"; eyebrow "Köpguide";
  links on `/` → `/kopguide` (running text already says "köpguiden");
  `sitemap.ts` `/guide` → `/kopguide`; `propertyType.ts` comment; CLAUDE.md
  route list. CSS class names `guide-progress`/`guide-rubrik` stay (not user-visible).
- **Verify:** `grep` for remaining user-visible "Guide"/`"/guide"`;
  `curl -I /guide` → 301 to `/kopguide`; sitemap test; browser check.

## 4. Utgångspris optional on /analysera

- **Contract** (`src/types/analysis.ts`, `src/lib/analysis/schema.ts`):
  `PropertyInput.utgangspris?: number`; `AnalysisResult.prisanalys` takes the
  no-price shape (`utgangspris?`/`prisPerM2?`, i.e. `Prisanalys` with those two
  optional). Stored rows all carry a price, so reads stay compatible. The
  schema field becomes `z.number().optional()`: only `.optional()` is added, so
  every stored row parses exactly as before; the form is what rejects 0/text.
- **Form** (`analyseraForm.ts`, `analysera.tsx`): `/vardering`'s rule and
  message; `Field optional`; `buildPropertyInput` omits the key when empty.
- **Assembly** (`assemble.ts`): `tillPrisInput` conditional spread;
  `byggPrisanalys` spreads price figures only when present (the core
  `byggPrisanalysUtanForening` already omits comparison/avvikelse and writes
  "Inget utgångspris har angetts…"). Fall-C `byggSlutsats` gets a no-price
  sentence so no path talks about a missing price.
- **UI:** `PropertySummary` hides the row; `AnalysRapport` calculator link
  falls back valuation → nothing (`?.`, no crash); `Prisrimlighet` needs no
  change. **PDF:** `viewModel.ts` summary omits the row; `PdfPrisanalys`
  price fields optional; `AnalysPdfDocument` uses the no-price title/rows like
  the web. `bolanekalkyl.ts` `buildMinimalPropertyInput` drops the dummy 0.
- **Not changed:** judging/prompts (never see buyer data → no `PROMPT_VERSION`
  bump), calc/, account lists (already null-safe), `/exempel` data.
- **Deploy (owner):** `npm run deploy:edge` first (new worker accepts old and
  new rows), then Lovable publish. Reverse order would fail new price-less
  analyses in the old worker's strict input parse. No migration.
- **Tests first:** form (empty ok, "0"/text error, key omitted), schema
  (optional), assemble (full analysis without price: no utgangspris/prisPerM2,
  no avvikelse, slutsats text), PropertySummary, PDF view model + document
  render without price, report link without price/valuation.
- **E2E (local Supabase stack, `./scripts/v2-lokalt.sh`):** one analysis without
  price via the register path (0 kr) and one real upload without price (~3 kr,
  logged in `docs/api-test-log.md`); open preview, full report, PDF export.

## Checks before done

`npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, dev-server
browser pass over `/`, `/analysera`, `/kopguide`, `/guide`, report; report the
real output.

## Decisions log (made during execution)

- Change 2: no DOM test environment exists (no jsdom/testing-library) and the box
  never renders during SSR (storage is read in an effect), so it was verified in
  a real browser: seeded entry → box absent, storage intact; control run with the
  flag `true` → box present.
- Change 3: CSS class names `guide-progress`/`guide-rubrik` kept (not user-visible).
  `/guide` keeps a tiny redirect route rather than being deleted.
- Change 1: only the card corner changed; the tab's own radius untouched.
- Change 4: `PrisanalysUtanForening` simplified to `Omit<Prisanalys, "andelAvForeningensSkuld">`
  (same shape as before). One shared `valideraValfrittUtgangspris` serves /analysera and
  /vardering. Fallback (non-model) conclusion and confidence texts got no-price wording.
  `PropertySummary` switches to 4 columns when the price row is hidden (only styling
  touch; for Lovable to review). PDF price section title comes from the view model.
  `DemoPrisdatakalla` (dev only) gets `utgangspris ?? 0`.
- Lint: `src/routes/index.tsx` had 15 prettier errors from the Lovable edit (59f968b);
  fixed with `eslint --fix` in its own commit (owner confirmed nobody edits in Lovable).
- E2E (local stack): fresh upload without price 111 s, 3.09 kr (log #105); register path
  0 kr; with-price control 0 kr. Report/PDF/calculator link as planned, 0 console errors.
- Found, not fixed (pre-existing, out of scope): in the PDF the price section heading can
  be left alone at the bottom of a page while its card moves to the next (same with
  and without a price).

---

# Binfo — plan: UI copy changes + new example analysis

Status: **DONE 2026-10-12** (approved by owner 2026-10-12; branch `ui-copy-exempel`, merged into `main`). Base: `main` @ 42e8d7c.
Previous plan: `docs/PLAN-v2.md` (v2, done; archived, kept for history).

## Owner answers (Phase 1, 2026-10-12)

- Example BRF: owner uploaded a Kungsholmen report →
  `annual reports examples/exemple_analysis_report/Årsredovisning 2025 (1).pdf`
  = **Brf Pontonjären 3**, 716420-0599, FY2025, 24 pages, text layer, värdeår 1931.
- Apartment: a real listing (owner screenshot in the same folder): Baltzar von
  Platens gata 6, 112 42, ort "Kungsholmen", utgångspris 4 995 000 kr, 48 m²,
  2 rum, våning 4, månadsavgift 3 503 kr, byggår 1931, hiss ja, balkong nej.
- PDF export: changes 2 and 3 apply to the PDF too.
- Delivery: work on branch `ui-copy-exempel`, then merge into `main` and push
  once every check passes (owner OK given 2026-10-12).

## Findings that shape the plan

- **Why Kungsholmen:** it has the best coverage in the training data. It has
  644 sales across 50 postnummer (≈13 per postnummer, the densest) and the
  lowest CV MAPE of any area (7.64 %). Vasastan-Norrmalm: 643 / 7.84 %.
  Östermalm: 521 / 8.75 %. 112 42 maps to Kungsholmen
  (`data/derived/postnummer_omrade.csv`).
- **Balcony effect:** `balcony=nej` is −2.65 % [95 % CI −14.4, +10.7], with
  only n = 10 "nej" sales out of 4 991 and 45 % unknown. It is not significant,
  so per the brief **no balcony row is shown**. The LightGBM model's response
  (ja→nej −2.5 % mean) is extrapolated from those 10 rows and is not evidence.
  The existing selection logic (`drivare.ts`) already shows "Ingen balkong"
  automatically if a future model makes it significant, so no code change is
  needed for that.
- **Data period:** it is not computed from the data. `DATA_PERIOD` is a
  constant in `ml/train_valuation.py`, but it flows through the generated data
  into the UI as `{fran, till}` and is formatted at render time. It stays
  dynamic; a new long-month formatter renders "januari–augusti 2026".
- **Scanned flow:** it shows the same paragraph plus ", för en skannad
  årsredovisning **några minuter extra**" (only when `textlager === 'saknas'`).
  That is genuinely different information, so it is kept (see change 1).
- The current `/exempel` is Brf Granen 10-11 (a Malmö report with an invented
  Stockholm address) and still uses the old valuation-v2 output.

## Changes

### 1. Waiting text ("Din analys pågår") — workstream A

- File: `src/components/AnalysStatus.tsx` (`Pagar`).
- Normal: "Det här tar normalt **3–5 minuter**. Vi går igenom hela
  årsredovisningen, granskar nyckeltalen och tar fram potentiella
  varningsflaggor. Du kan gärna låta fliken vara öppen, sidan uppdateras
  automatiskt så snart analysen är klar."
- Scan (`textlager === 'saknas'`): "Det här tar normalt **3–5 minuter**, för en
  skannad årsredovisning **några minuter extra**. Vi går igenom …" (same tail).
  This keeps the extra-time notice; nothing else differs today.
- Fix the stale "195–326 sekunder" comments in `AnalysStatus.tsx` and
  `analysStatusCopy.ts` (comment only).
- Tests: `src/components/Prisrimlighet.test.tsx` ("Pagar — väntskärmen")
  asserts the full new paragraph (flattened) for normal and scan, and that the
  old string is gone.

### 2. Source/data disclaimer — workstream B

- Web (`Prisrimlighet` in `src/components/AnalysRapport.tsx`): replace the two
  lines ("Bygger på försäljningar …" + `OMRADESINDELNING_ATTRIBUTION`) with one
  `<p>`: "Modellen är tränad på bostadsrättsförsäljningar i Stockholm under
  perioden {januari–augusti 2026}, baserade på data från Svensk
  Mäklarstatistik. Områdesindelningen bygger på data från ©
  OpenStreetMap-bidragsgivare (ODbL), Stockholms stad och GeoNames (CC BY
  4.0)." The tier text for `lan` stays as its own line after it.
- `src/lib/analysisView.ts`:
  - add `formatDataperiodLang` (full month names, same rules as
    `formatDataperiod`) and a builder for the paragraph;
  - remove `OMRADESINDELNING_ATTRIBUTION`;
  - fix the misplaced doc comment.
    The short formatter stays for server texts (`prisdata.ts`, `assemble.ts`).
- PDF (`src/components/pdf/viewModel.ts` + `AnalysPdfDocument.tsx`): the same
  paragraph, with the metadata kept on its own line ("4 991 försäljningar ·
  typiskt fel ±X % · modell valuation-v3.1").
- Tests: `analysisView.test.ts` (long formatter: same year, cross-year, same
  month, bad input), `viewModel.test.ts` (new text), and a web render test for
  the paragraph.

### 3. "Vad påverkar värderingen" — workstream B (same owner as 2, shared files)

- Heading → "Exempel på faktorer som påverkar värderingen utöver område:",
  dropping the `uppercase tracking-wide` classes so it renders in sentence case.
  The PDF gets the same heading above its driver rows (it has none today).
- Hide the boarea row at the selection step: add `boarea+10` to
  `EXCLUDED_EFFECT_IDS` in `src/lib/vardering/drivare.ts` (same mechanism as
  the 2026-10-08 `build_year+10` decision).
  - Display only: the model, its features, `effects.json` and the valuation are
    untouched.
  - It applies consistently to the web, PDF, `/vardering` and old analyses
    (reads re-assemble).
- Balcony: no row, see Findings. Report the number.
- Tests: `drivare.test.ts` (boarea never selected; others unchanged), a render
  test for the heading text and that it has no `uppercase` class.

### 4. Priskoll: remove disclaimer — workstream A

- `src/routes/vardering.tsx`: delete the whole
  `<div className="mb-6"><Callout … "Uppskattning utan årsredovisning">…</div>`
  so no empty margin remains, and drop the `Callout` import if it becomes
  unused.

### 5. New example analysis — workstream E (after A–D are merged)

1. Write `input.json` (scratchpad) from the listing, with the
   `/analysera` form defaults for fields the form doesn't ask for (andelstal,
   avgiftInkluderar, antalPersoner, `orgnr` from the report), matching what a
   user submitting this form produces.
2. Run
   `ANTHROPIC_MODEL=claude-sonnet-5-5 npm run -s extract -- "<pdf>" input.json > out.json`.
   This is a real pipeline run (grounding → extraction → judging → assembly
   with the v3.1 valuation and the new driver selection). Expected cost ≈ 2–4 kr.
3. Check the output against the PDF: all seven nyckeltal with page references
   vs the flerårsöversikt, the grade/flags/questions sensible, and the
   Kungsholmen area model used (tackning `stockholm`, area Kungsholmen). Re-run
   once if something is wrong, then investigate rather than hand-edit.
4. Replace `src/data/sampleAnalysis.ts` with the output, keeping the header
   comment updated (source, date, command, model). Update the BRF name in
   `src/routes/exempel.tsx` (copy unchanged apart from the name).
5. Log the run in `docs/api-test-log.md` (+ raw record in `docs/api-runs/`).

## Ownership and parallelism

| Workstream | Agent                 | Files owned (exclusive)                                                                                                                                                                             | Runs               |
| ---------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| A (1 + 4)  | frontend-state        | `AnalysStatus.tsx`, `analysStatusCopy.ts` (comment only), `routes/vardering.tsx`, `components/Prisrimlighet.test.tsx`                                                                               | parallel with B    |
| B (2 + 3)  | frontend-state        | `AnalysRapport.tsx`, `lib/analysisView.ts` + test, `lib/vardering/drivare.ts` + test, `pdf/viewModel.ts` + test, `pdf/AnalysPdfDocument.tsx` (+ test), new `components/PrisrimlighetKalla.test.tsx` | parallel with A    |
| E (5)      | pdf-pipeline          | `data/sampleAnalysis.ts`, `routes/exempel.tsx`, `docs/api-test-log.md`, `docs/api-runs/`                                                                                                            | after A+B accepted |
| Verify     | supervisor + reviewer | —                                                                                                                                                                                                   | last               |

A and B share no files. Workstream B's new web render test goes in its own new
file so it doesn't collide with A's edits to `Prisrimlighet.test.tsx`. The
supervisor reviews every diff (exact copy check character by character, no
unrelated changes) and re-runs the checks before accepting it.

## Verification

1. Run `npm run typecheck`, `npm test`, `npm run lint` (baseline 0 errors / 7
   warnings), `npm run build`, and `npm run dev` (open pages, no
   import-protection overlay).
2. Grep the repo (excluding `node_modules`, `.output`) for every old string:
   - "Det här tar normalt" + "vi läser hela årsredovisningen"
   - "Bygger på försäljningar" / "Bygger på ${"
   - "Områdesindelning: Binfos egen"
   - "Vad påverkar värderingen"
   - "10 kvm större boarea" in UI/sample
   - "Uppskattning utan årsredovisning"
   - "Vi har inte läst föreningens"

   Exceptions: historical records in `docs/api-runs/`, `docs/api-test-log.md`,
   and the ML artifact label in `effects.json`/`effects.data.ts` (model data,
   not display), which are listed in the report rather than rewritten.

3. Visual check with Playwright from the scratchpad (no project dependency;
   cached Chromium), desktop 1280 px and mobile 390 px:
   - Waiting screen, normal and scanned: real runs on the local Supabase stack
     (`./scripts/v2-lokalt.sh --nollstall`, Docker). Its obsolete "branch must
     be `v2`" guard is relaxed, since v2 is merged. Use one text PDF and one
     scan from `annual reports examples/` (≈ 3–7 kr), with screenshots during
     the run.
   - Finished preview and full report `/analys/<id>` (price section: new
     paragraph, heading, no boarea row).
   - `/vardering` result (no disclaimer, no gap).
   - `/exempel` (new example, all changes visible).
   - PDF export: download from the full report and check the text/pages.
4. Update CLAUDE.md (example now Pontonjären 3, drivers, copy locations) and
   this file's status log; final summary to the owner.

**Budget:** ≈ 15 kr total (example 2–4 kr, local-stack runs 3–7 kr, one
re-run margin). Every run is logged.

## Status log

- 2026-10-12: Phase 1 done. Repo read (4 parallel agents), CLAUDE.md updated,
  owner questions answered, plan drafted.
- 2026-10-12: Execution done.
  - A (waiting text, Priskoll callout) and B (source paragraph, heading,
    boarea row hidden, PDF) were done in parallel and reviewed.
  - E (example): run 1 was rejected (judging wrote "nästan 90 %" vs 74 % in
    the report); run 2 was accepted (grade B).
  - Verification:
    - Checks: typecheck clean; 71 files / 1602 tests passing; lint 0 errors /
      7 warnings; build OK.
    - Local Supabase E2E: text report (Beckasinen 14) and scan (Startfältet).
    - Playwright screenshots at 1280/390 px of the waiting screen (normal +
      scan), preview, full report, `/vardering`, `/exempel`, and the PDF
      exports' text.
    - Repo grep: old strings remain only in negative test assertions, this
      plan, and the ML label data (model untouched).
  - Spend: 3.52 + 3.51 (example) + 2.66 + 4.47 (local E2E) = 14.16 kr;
    running total 191.81 kr.
  - Open: example judging text says "femårsserien" for a four-year energy
    series (figures correct; not re-run).
