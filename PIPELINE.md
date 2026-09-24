# Extraction & analysis pipeline

Design notes for `src/lib/analysis/`. Read `CLAUDE.md` first for the
boundaries and the working agreement.

> Reference doc. When it disagrees with the code, the code wins — fix this file.

---

## Two passes, deliberately separate

A single prompt that reads the PDF and writes the finished report is faster to
build and impossible to test. Split it:

**Pass 1 — extraction.** PDF in, `ExtractionResult` out. Strictly factual: the
seven statutory key figures, the loan book, the maintenance plan, material
events. No judgement, no grading, no advice. Every figure carries a `PageRef`.

**Pass 2 — analysis.** `ExtractionResult` + `PropertyInput` + benchmarks in,
the judgement layers out: grade, red flags, price reconciliation, stress test,
questions.

Why it matters: pass 1 has verifiable right answers and can be scored against a
manual answer key. Pass 2 does not. Keeping them apart means that when the
report is wrong you can tell which half failed. Merged, you can only guess.

---

## Build order

1. **Contract exists** — `src/types/analysis.ts`. Done.
2. **Zod schema mirroring it** — `src/lib/analysis/schema.ts`. Model output is
   untrusted input; it gets validated before anything touches it.
3. **PDF text extraction** — text layer out, plus detection of a *missing*
   text layer (scanned document). A scanned PDF must fail loudly. A confident
   empty analysis is the worst failure mode this product has.
4. **Pass 1 prompt** — iterate in the terminal against real annual reports
   until the output is something you would pay for. No UI during this phase.
5. **Answer key + harness** — see below. Do this before pass 2.
6. **Pass 2 prompt** — judgement layers.
7. **Cost model** — pure functions, no model involved. Fully unit-testable.
8. **Only then** the API route and the UI wiring.

---

## The answer key

Non-negotiable, and the step most likely to get skipped.

Work out the seven key figures **by hand** for at least five cooperatives, from
five different management companies (HSB, Riksbyggen, SBC, Nabo, an independent
bookkeeper) because the templates differ substantially. Store as
`fixtures/answer-key/<orgnr>.json`.

The harness runs pass 1 against all of them and reports every deviation, field
by field. Tolerance: exact match for figures stated verbatim in the report;
±1% for anything derived.

Without this you do not know the extraction works. You hope it does, until a
paying customer finds a debt figure that is wrong by seven digits.

---

## Pure functions — test these first, they need no model

These have unambiguous right answers and belong in `src/lib/analysis/calc/`
with unit tests written before the implementation.

**Amortisation** (rules in force since 1 April 2026):
- LTV > 70% → 2%/yr; 50–70% → 1%/yr; < 50% → 0.
- The skuldkvot-based extra 1% is abolished. **The function must never return 3.**
- Write the regression test explicitly: loan 4,500,000 on gross income 800,000
  (skuldkvot 5.6) at 80% LTV must return **2**, not 3. This is the exact case
  where a model working from older training data gets it wrong.

**Interest deduction:** 30% on interest up to SEK 100,000 per person per year,
21% above. Cap is per person — test the one-borrower and two-borrower cases
separately.

**Rate stress:** consumes `rantekanslighet` from the statutory key figures
directly. That figure is defined as interest-bearing debt ÷ annual fee income
and states how many percent fees rise per percentage point. Do not build a
separate model for this.

**Cost schablons:** placeholder values until replaced with sourced data
(SCB, Energimyndigheten). Every schablon carries `source: 'schablon'` and a
`schablonBasis` string. Mark unsourced constants
`// TODO: unverified placeholder`.

**Range logic:** when any `FeeInclusion` field is `okant`, the total renders as
a span — low assumes the fee covers it, high assumes it does not. Test that the
span collapses to a point when every field is known.

---

## Failure modes to handle explicitly

| Case | Required behaviour |
|---|---|
| Scanned PDF, no text layer | Fail visibly, refund path, never an empty analysis |
| A key figure genuinely absent from the report | `value: null`, listed in `saknadeFalt`, confidence reduced |
| Model returns malformed JSON | Schema validation fails, one retry, then surface the error |
| Report is several years old | Flag it, lower confidence, say so in the output |
| Figures internally inconsistent | Flag rather than silently pick one |

---

## Cost

Measured cold runs (September 2026) cost 3,58–4,25 kr across three runs, i.e. roughly
SEK 3.6–4.3 per report; a cache hit costs nothing. Against a SEK 249 price this is
irrelevant — which means there is no reason to compromise output quality to
save tokens. Do not cut the prompt short to economise.

Cap spend per run in development via `MAX_COST_PER_ANALYSIS_SEK`.
