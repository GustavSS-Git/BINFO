# Binfo — current plan

**Current plan: [`docs/PLAN-v3.md`](docs/PLAN-v3.md)** (accounts, public BRF register,
bulk analysis via the Batch API, bolånekalkyl PDF/Excel export). Decisions: `docs/DECISIONS.md`.

Earlier plans (done, kept for history): the UI copy + new `/exempel` plan below
(2026-10-12), and `docs/PLAN-v2.md` (2026-10-09).

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

| Workstream | Agent | Files owned (exclusive) | Runs |
|---|---|---|---|
| A (1 + 4) | frontend-state | `AnalysStatus.tsx`, `analysStatusCopy.ts` (comment only), `routes/vardering.tsx`, `components/Prisrimlighet.test.tsx` | parallel with B |
| B (2 + 3) | frontend-state | `AnalysRapport.tsx`, `lib/analysisView.ts` + test, `lib/vardering/drivare.ts` + test, `pdf/viewModel.ts` + test, `pdf/AnalysPdfDocument.tsx` (+ test), new `components/PrisrimlighetKalla.test.tsx` | parallel with A |
| E (5) | pdf-pipeline | `data/sampleAnalysis.ts`, `routes/exempel.tsx`, `docs/api-test-log.md`, `docs/api-runs/` | after A+B accepted |
| Verify | supervisor + reviewer | — | last |

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
