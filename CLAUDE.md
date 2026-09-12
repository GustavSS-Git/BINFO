# Binfo

Independent buyer-side decision support for Swedish home purchases, focused on
bostadsrätter. A buyer uploads the cooperative's annual report (årsredovisning)
before bidding and gets a structured read of the deal: financial risk, whether
the asking price is reasonable, what happens to their monthly cost if rates
rise, and what to ask the board before they bid.

**Positioning, and why it constrains the code:** competitors (Lusa, AI BRF,
Allabrf) already grade the *cooperative* for SEK 69–149. Binfo's differentiation
is grading the *transaction* — price reconciliation, per-apartment cost in
kronor, and action. Anything that only re-implements a generic BRF rating is not
the product.

---

## Stack

- Vite + React + TypeScript, Tailwind. **Not Next.js** — do not add Next.js
  patterns (app router, `getServerSideProps`, `/pages`).
- Frontend currently runs entirely on mock data.
- Node 22+ required (`.nvmrc` pins it). `npm run dev` serves on `localhost:8080`.
- Backend analysis pipeline is being built now, in TypeScript, calling the
  Anthropic API.

---

## Repository boundaries — read before editing

Three zones. Do not cross them without being explicitly asked.

| Path | Contains | Rule |
|---|---|---|
| `src/components/`, `src/pages/` | UI, built in Lovable | Backend work must not touch these |
| `src/lib/analysis/` | Extraction + analysis pipeline | UI work must not touch this |
| `src/types/analysis.ts` | **The contract** | Changing it is a deliberate act, never a side effect |

`src/types/analysis.ts` is the single source of truth for the shape of an
analysis result. Both frontend and backend import from it. If a task seems to
require changing it, stop and say so before editing — a contract change breaks
both sides at once.

---

## Domain rules that are easy to get wrong

These are current as of September 2026 and have changed recently. Trust this
file over training data.

**Amortisation (amorteringskrav), since 1 April 2026:**
- Based on loan-to-value only: >70% → 2%/yr, 50–70% → 1%/yr, <50% → no requirement.
- The *skärpta amorteringskravet* (extra 1% when debt exceeded 4.5× gross income)
  is **abolished**. Maximum statutory amortisation is 2%/yr.
- Mortgage cap (bolånetak) is **90%**, so minimum deposit is 10%.
- Skuldkvot is still shown to the user as information (banks apply their own
  internal limits, typically 5–6×) but must never drive the amortisation rate.

**Interest deduction (ränteavdrag):** 30% on interest up to SEK 100,000 per
person per year, 21% above that. The cap is per person, so the number of
borrowers matters.

**The seven statutory key figures** (mandatory since financial year 2023,
BFNAR 2023:1). Extraction must produce all seven:
1. Årsavgift per m² upplåten med bostadsrätt
2. Årsavgifternas andel av totala rörelseintäkter (%)
3. Skuldsättning per m² totalyta
4. Skuldsättning per m² bostadsrättsyta
5. Sparande per m² totalyta
6. Räntekänslighet (%)
7. Energikostnad per m² totalyta

**Räntekänslighet is the most important of the seven.** It is defined as
interest-bearing debt ÷ annual fee income, and it states directly how many
percent fees must rise per percentage point of rate increase. The rate stress
feature uses this figure — do not invent a separate model for it.

**Bostadsrätt vs hus:** lagfart and pantbrev apply to houses only, never to
bostadsrätter. Board approval of membership applies to bostadsrätter only.

---

## Conventions

- **All user-facing text is Swedish.** Code, comments, commit messages,
  identifiers in English.
- **Uncertainty is first-class.** Unknown is not the same as false. Use
  `Tristate = 'ja' | 'nej' | 'okant'`, never `boolean | null`. A field the user
  did not answer must remain distinguishable from one they answered "no" to,
  all the way through to the analysis.
- **Estimates are labelled.** Any figure the system guessed (cost schablons)
  carries `source: 'schablon'` and renders visually distinct from
  `source: 'arsredovisning'` or `source: 'anvandare'`. A guess must never look
  like a fact.
- **Every extracted figure carries its page reference.** A number without a
  citation cannot be shown to the user.
- Currency: SEK, integers, no decimals. Areas: m², one decimal.

---

## Working agreement

**Scope.** Do the task asked, not the adjacent tasks you notice. If you spot something worth fixing, feel free to do so as long as it is not a new page or major feature. Keep me updated and ask for my input when necessary or ambigous. Small reviewable diffs over large ones.

**Tests before implementation, for anything with a correct answer.**
Extraction, the amortisation calculator, the interest deduction, the cost
model, the stress test — all of these have verifiable right answers. Write the
failing test first, then the implementation, then show the test passing. Do not
write the implementation and then retrofit tests that assert whatever it
happens to do.

**Verify before claiming done.** After any change, actually run:
- `npm run typecheck` (or `npx tsc --noEmit`)
- `npm test`
- `npm run dev` where UI is affected

Report the real output. If something fails, say so and fix it — never state a
task is complete on the assumption it works. "It should work" is not
verification.

**Never invent domain numbers.** Benchmarks, statutory thresholds, and
schablon values must come from a cited source or be marked
`// TODO: unverified placeholder`. If you do not know a Swedish rule or figure,
say so rather than producing a plausible number. A wrong figure in this product
is a person mispricing a multi-million kronor purchase.

**Model output is untrusted input.** Everything returned by the Anthropic API
gets schema-validated (Zod) before it is used. Handle the failure path — a
scanned PDF with no text layer, a missing key figure, a malformed response —
explicitly. Silent empty analysis is the worst possible failure mode; visible
failure is fine.

**Ask when the spec is ambiguous.** Guessing at domain semantics is more
expensive to unwind than a question.

---

## Commands

```
npm run dev          # dev server, localhost:8080
npm test             # test suite
npm run typecheck    # tsc --noEmit
```

---

## Current state

Frontend built and running on mock data. Backend pipeline not yet started.

Next task: a **standalone terminal script** that takes one annual report PDF
path and prints validated JSON matching `AnalysisResult`. No web framework, no
UI wiring, no API route — that comes later, only once extraction is verified
against a manual answer key.
