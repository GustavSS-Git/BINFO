# Binfo — current plan

**Current task: round 3 of 2026-10-23 (no re-runs on read, register summary, grade bands, fixed figures, motivation check, CLI input check), below.** Background plan: [`docs/PLAN-v3.md`](docs/PLAN-v3.md)
(v3, deployed 2026-10-14). Decisions: `docs/DECISIONS.md`.

Earlier plans (done, kept for history): the UI copy + new `/exempel` plan further below
(2026-10-12), and `docs/PLAN-v2.md` (2026-10-09).

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
