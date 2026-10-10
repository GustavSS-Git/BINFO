# Handoff: valuation v3.2 (attribute-adjusted postcode effect)

Written 2026-10-10 by the previous session (context full). Read `CLAUDE.md`,
`ml/artifacts/valuation-v3/MODEL_CARD.md` and `ml/artifacts/valuation-v3.1/MODEL_CARD.md` first.

## State
- **Production runs valuation v3** (Stockholms kommun: LightGBM on log kr/m², features = område,
  apartment attributes, and a per-postnummer target encoding `postcode_delta`).
- **Branch `valuation-v3.1`** (local only, NOT pushed, NOT merged, NOT deployed; commit 1ba7040):
  hierarchical postcode delta — postnummer → 4-digit prefix → område, k=5 / k_group=5, unseen
  postnummer take their prefix's delta. Measured vs v3 (paired cluster bootstrap by postnummer):
  unseen-postnummer MAPE 14.43 → 11.69 % (CI −3.5…−2.0 pp); overall CV 9.76 → 9.64 %, Jul–Aug
  10.10 → 9.83 % (within noise); coverage 88.5 → 89.0 %. Full candidate grid in
  `ml/artifacts/valuation-v3.1/metadata.json` (`candidate_grid`). Code: `ml/valuation_v31_lib.py`,
  `ml/train_valuation_v31.py` (~25–30 min on 8 cores), `ml/tests/test_valuation_v31.py`.
- The owner has NOT decided v3 vs v3.1 yet; they want v3.2 tested first.

## The problem v3.2 should solve
`postcode_delta` is computed from RAW prices: v_i = log(kr/m²_i) − mean log kr/m² of the row's
område. A postnummer's delta therefore absorbs differences in the *kind* of apartments sold there
(build year, fee, size…), which the booster also models from the buyer's own attributes →
partial double counting, worst with few sales.

Owner's example: postnummer 111 22 (Vasastan-Norrmalm) has ONE training sale (2026-08-11, 48 m²,
1.5 rum, byggår 1989, avgift 4 027 kr/mån, 85 417 kr/m²). Test apartment: 44 m², 2 rum, avgift
3 000, våning 2, byggår 1945, hiss ja, balkong ja. Same apartment without postcode effect
≈ 114 000 kr/m²; v3 gives 78 015 (delta −0.288); v3.1 gives 100 997 (delta −0.095). The owner
says 111 22 genuinely is cheaper than the rest of Vasastan-Norrmalm (office-dominated), so a real
local discount must survive — just not one inflated by that sale's own 1989/high-fee attributes.

## Task (owner-approved idea, 2026-10-10)
1. Compute the postcode effect from **residuals**: r_i = log(kr/m²_i) − prediction of a model
   WITHOUT the postcode feature (out-of-fold, so a row never sees itself), then shrink per
   postnummer (keep the v3.1 hierarchy postnummer → 4-digit prefix → område, re-tune k / k_group)
   and use that as the `postcode_delta` input (OOF for training rows, full table at inference).
   Optionally also try: residual delta applied as a post-hoc multiplicative correction instead of
   a booster input.
2. Evaluate EXACTLY like v3.1 (same protocol and tables): 5-fold CV, Jul–Aug time split,
   postnummer-grouped CV (unseen), MAPE by training-n stratum (0/1/2/3–5/6+), the simulated
   1-sale and 2-sale scenarios, conformal coverage, paired cluster bootstrap vs v3 AND vs v3.1.
   Fix the selection rule before looking at final numbers (Jan–Jun only).
3. Report 111 22 and the neighbours 11120, 11121, 11143, 11346, 11359 for the test apartment
   (v3 / v3.1 / v3.2), plus 5–10 other sparse postnummer with big v3 deltas
   (e.g. 11521, 11750, 12573, 16765) — before/after and n.
4. If v3.2 is clearly better (or equal on accuracy and more sensible on sparse postcodes), build
   `ml/artifacts/valuation-v3.2/` + wire it like v3.1 did (scripts/buildVarderingData.ts,
   src/lib/vardering, regenerate data, parity/dataSync tests, modellVersion) on a new branch
   `valuation-v3.2` based on `valuation-v3.1`. Otherwise recommend v3.1 or v3 with evidence.
5. Gates before reporting: `cd ml && .venv/bin/pytest`, `npm run typecheck`, `npm test`,
   `npm run lint`, `npm run build`, `npm run build:edge`.

## Rules / gotchas
- No Anthropic API calls needed. Never deploy; never push to `main` without the owner's OK.
  Going live later = merge to `main` + push, then `npm run deploy:edge` AND a Lovable publish
  (the valuation runs in both the website and the Edge Function).
- Never present an association as causation (CLAUDE.md). Effects/drivers (`effects.json`,
  `drivare.ts`) must not flip sign without the domain rule being applied.
- Known caveat in v3 and v3.1: the 90 % interval under-covers for postnummer with 0–2 sales
  (≈ 68–83 %); the range is hidden in the UI — keep it that way unless fixed.
- Owner decision of 2026-10-07 ("unseen postcodes: do nothing special") is changed by v3.1/v3.2;
  the owner must confirm when choosing.

## Other open items (not part of this task)
- Privacy text: legal basis for keeping PDFs that name board members (owner, later).
- "For Lovable to polish" list from the v2 work (see docs/PLAN-v2.md / the v2 final report).
