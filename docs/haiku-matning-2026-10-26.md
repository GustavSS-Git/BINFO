# Haiku 5.5 vs Sonnet 5.5 for analysis and parsing (measured 2026-10-26)

Question (owner): can Haiku replace Sonnet 5.5 for "the analysis and parsing"?
Prices used: USD→SEK 9.7 (`costGuard.ts`); Sonnet 5.5 $2/$10 per MTok; Claude
Haiku 5.5 $0.10/$0.50 per MTok for prompts up to 100K tokens and $0.50/$2.50
above (from the owner's brief, NOT verified against the platform pricing page;
whether the high tier applies to the whole request, output included, is also
assumed). Spend: ≈ 23.3 kr of the 40 kr budget (`docs/api-test-log.md` rows 125–133).
Everything is n = 1 per report and configuration: flake rates are not measured.

## Short answer

Keep Sonnet 5.5 as the default for now. Haiku 5.5 works end to end (citations on
PDFs and on custom-content transcriptions, scans, effort, no refusals) and is
4–14x cheaper, but on this answer-key set it is measurably less accurate
(about 94 % vs 98 % of scored fields), it silently returns `null` for a figure the
report prints (in 4 of 13 reports), it is 1.5–2x slower, and its extraction
overruns the production output cap in 4 of 13 reports. Haiku 4.5 is ruled out.

## Haiku 4.5

`ANTHROPIC_MODEL=claude-haiku-4-5` → HTTP 400 "This model does not support the
effort parameter" on the first grounding call (0 kr). Together with the 100-page
PDF limit, 200K context and the 2026-10-09 transcription rejection (wrong page
markers) it is out without more measurement.

## What was built (CLI only, production untouched)

- `costGuard.ts`: `claude-haiku-5-5` with a tiered `ModelPricing.hogNiva`. Actual
  cost: tier chosen per call from the real prompt size (input + cache write +
  cache read > 100K → high tier for the whole call). Pre-flight reservations
  (`estimateCostSek`) always use the high tier (conservative).
  `estimateCostBothTiersSek` prices a call both ways. Tests in `costGuard.test.ts`.
- `modellPerSteg.ts` (+ test): `ANTHROPIC_MODEL_BEDOMNING` (judging + motivation
  rewrite) in `cli.ts`; `ANTHROPIC_MAX_TOKENS_EXTRACTION` (extraction `max_tokens`)
  in `cli.ts` and `verifyAnswerKey.ts` via `korExtraktion`'s new option. The SDK
  refuses non-streaming requests with `max_tokens` above ≈ 21 333, so 21000 is the
  highest usable value; the production code never streams.
- `verify-extraction` does not judge, so the judging comparisons use `npm run extract`.

## Extraction accuracy (answer keys, `verify-extraction`)

Haiku 5.5, all stages, effort medium. "Verified" = fixtures with owner-verified keys
(nyckeltal + övrig info); loans and maintenance keys are UTKAST.

| Report                    | Haiku 5.5                            | Sonnet 5.5 (same reports) | Haiku misses                                                                                       |
| ------------------------- | ------------------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------- |
| Volontären 12             | 11/14, then 14/14 on a second sample | 13/14                     | 1st sample: sparande tecken/status ("neg neg neg" read as no sign); antalLokaler null (Sonnet too) |
| Torsborgen 3              | 31/33 (+ loans 9/9, åtgärder 4/4)    | 33/33                     | skuldsättning/m² totalyta null (printed: 2 039)                                                    |
| Beckasinen 14             | 35/38 (loans 12/12)                  | –                         | skuldsättning/m² totalyta null; fasad 2018 åtgärd (Sonnet misses it too, rows 115–120)             |
| Albohem                   | 24/24                                | –                         |                                                                                                    |
| Göken 29                  | 17/17                                | 17/17                     |                                                                                                    |
| Granen 10-11              | 46/46 (loans 18/18)                  | –                         |                                                                                                    |
| Hökensgata 1              | 24/27                                | –                         | antalLokaler 2 vs 4 and two källa pages (pre-existing misses in Sonnet runs)                       |
| Näcken 2                  | 13/15                                | –                         | skuldsättning/m² totalyta null (printed: 11 100)                                                   |
| Startfältet (scan)        | 15/15                                | –                         |                                                                                                    |
| Zederslundshus (scan)     | 14/15 (needed one extraction retry)  | –                         | lanebok.totalSkuld 7 581 085 vs 7 706 397                                                          |
| Helsingborgshus 17        | 65/67 (loans 33/33, åtgärder 5/5)    | –                         | skuldsättning/m² totalyta null (printed: 2 941)                                                    |
| Ängsknarren (scan)        | 15/15                                | –                         |                                                                                                    |
| Barsbro Parken            | 25/25                                | –                         |                                                                                                    |
| Pontonjären 3 (draft key) | loans 18/18, åtgärder 2/9            | (row 121: 9 åtgärder)     | 7 of 9 genomförda åtgärder missing                                                                 |

Totals: verified fields 240/255 (94 %) for Haiku; on the three shared reports
Haiku 59/64 (92 %) vs Sonnet 47/48 (98 %) [Haiku's first Volontären sample]. Loans:
90/90 fields on the five loan keys (matches Sonnet's 42/42 earlier). The
sample is small and Sonnet's own earlier full runs had flakes too (row 110: 144/159),
so the gap is "visible", not statistically established.

Key failure: the model returns `skuldsättning_per_m2_totalyta = null` (source
`berakning`, no excerpt, no reason) in 4 of 13 reports where the figure is printed;
Sonnet read it in Torsborgen. With effort low it was still null. That breaks "missing
values are null with a reason" and, downstream, the judging model then writes a
false red flag ("Skuldsättning per m² totalyta saknas", Torsborgen mix run).

## Page citations (`sidreferenser`)

|                        | Haiku 5.5                                                                                                                                  | Sonnet 5.5          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Stämde / kontrollerade | 42/42, 45/51 (6 corrected; 10 of 43 on the effort-low sample), 44/45, 42/43, 48/48, 66/66, 50/50, 42/42, 48/48, 40/42, 71/75, 65/65, 57/57 | 40/40, 42/42, 42/42 |
| Osäkra (not found)     | 8 over 14 reports                                                                                                                          | 0                   |

Citations work on native PDFs and on the custom-content transcription document.
Haiku's page numbers are wrong more often (the verifier corrects them), consistent
with the 2026-10-09 finding for Haiku 4.5. Barsbro (garbled layer) is not
checkable (0/0). For the three scans the check runs against Haiku's own
transcription, so it says nothing about transcription accuracy; the scanned
reports scored 15/15, 15/15 and 14/15 (one number off).

## Robustness, retries, refusals

- 4 of 13 extractions were cut off at the production cap `max_tokens` 16000
  (`ModelTruncatedError`, a visible failure; SBC 2, Ängsknarren, Barsbro,
  Pontonjären). Haiku 5.5's extraction output is 10–18K tokens (13.5–15.5K typical;
  18.4K max) against Sonnet's 4–6K, because adaptive thinking counts as output
  and the answer is long. With cap 21000 all five failed reports completed.
  Effort low cuts the output to ≈ 10K but not the figure misses.
- 1 Zod/validation retry (Zederslundshus). 1 `Connection error` (sandbox/network,
  Helsingborgshus) and 2 EPIPE on the CLI (also network); none repeated.
- Refusals: none. All `stop_reason`s of finished calls: `end_turn`.
- Scan transcription (Haiku 5.5, 5-page chunks): worked on all three scans, no
  page-marker errors raised; 0.15–0.23 kr for the transcription (0.31–0.42 kr per
  whole report) vs 4.1–6.5 kr per report on Sonnet (2026-10-09).

## Time and cost per report (API wall clock, sequential)

|                                                            | Haiku 5.5    | Sonnet 5.5              |
| ---------------------------------------------------------- | ------------ | ----------------------- |
| Grounding                                                  | 35–53 s      | 29–39 s                 |
| Extraction                                                 | 51–69 s      | 20–35 s                 |
| Text report, ground + extract                              | 80–112 s     | 51–74 s                 |
| Cost, prompt ≤ 100K (Volontären, Torsborgen, …)            | 0.17–0.27 kr | 2.2–2.8 kr              |
| Cost, grounding prompt > 100K (Göken 0.84, Granen 0.83 kr) | 0.83–0.84 kr | 3.9 kr (Göken)          |
| Cost, scans                                                | 0.31–0.42 kr | 4.1–6.5 kr (2026-10-09) |
| Mean over the 14 Haiku reports                             | 0.34 kr      | ≈ 3.2 kr                |

The same Haiku calls priced at the low tier only: 2.07 kr (vs 3.23 actual); at the
high tier only: 10.33 kr. The high tier matters: reports with ≥ 100K grounding
tokens (Göken, Granen) cost 4–5x more than the others, and the grounding prompt
sits just above/below the line for many reports (Granen 105 790 tokens). Prompt token
counts are the same as Sonnet's in these runs (e.g. Torsborgen grounding 60 657 vs
60 740 tokens), so the "~30 % more tokens" tokenizer note did not show up for PDF input.

## Judging (`npm run extract`, a hypothetical flat, no rewrite call in any run)

| Run                                           | Cost    | Wall    | Grade | Observations                                                                                       |
| --------------------------------------------- | ------- | ------- | ----- | -------------------------------------------------------------------------------------------------- |
| Torsborgen, Sonnet all                        | 3.48 kr | 84.8 s  | B     | 3 flags, specific motivation with 6 numbers                                                        |
| Torsborgen, Haiku extraction + Sonnet judging | 0.71 kr | 116.5 s | B     | good; but flags "Skuldsättning per m² totalyta saknas" (Haiku's extraction miss)                   |
| Torsborgen, Haiku all                         | 0.26 kr | 139.7 s | B     | shorter motivation, meta-comment about "underlagets kvalitet", good extra flag (all debt floating) |
| Granen, Haiku extraction + Sonnet judging     | 1.49 kr | 129.8 s | C     | 5 svag; 6 flags, concrete                                                                          |
| Granen, Haiku all                             | 0.90 kr | 129.3 s | C     | same grade, 5 flags, thinner motivation, "Underlaget i sig är inte tunt" filler                    |
| Volontären, Haiku extraction + Sonnet judging | 0.77 kr | 121.6 s | C     | 7 flags incl. lokal rent, 6 questions                                                              |

Grades agree; the motivation number check passed first time in all six (no
rewrite call). Haiku's judging text is shorter and has meta-filler, but is not
wrong. It saves only ≈ 0.45 kr per report and the judging text is what the buyer
reads, so judging is the stage to keep on Sonnet if anything is.

## Recommendation

1. Keep Sonnet 5.5 for all stages in production today. The saving (≈ 2.3 kr per
   uncached report with the mix, ≈ 3 kr with Haiku everywhere) is small next to the
   register reuse, and the accuracy gap shows up as silent `null`s that become false
   flags.
2. If cost becomes a concern: "Haiku first, Sonnet on a gap". Run grounding +
   extraction on Haiku 5.5, judge on Sonnet 5.5, and re-run the report on Sonnet when
   a deterministic completeness check fails (any of the seven nyckeltal null while
   the grounding contains the label, no loans, a `ModelTruncatedError`). 4 of 13
   reports would have fallen back, so the expected cost is ≈ 1.9 kr instead of
   3.3 kr (≈ 40 % less), at the price of more complexity and a slower median.
   Needs first: a larger sample (flake rate), confirmed tier rule and prices, a
   completeness check, and a fix for the output cap.
3. Do not use Haiku 5.5 alone for judging in production without more samples; do
   not use Haiku 4.5.
4. Scan transcription on Haiku 5.5 is the most attractive single swap (≈ 0.2 vs
   4–6 kr per scan) but only 3 scans were run and nothing compares the
   transcription itself with the page images; it needs its own measurement.

## What a production mix would need

- `steg.ts` and the Edge glue take ONE model from the job row (`rad.model`); a per-stage
  model needs either a second column on `rapport`/`analys` (migration; migrations
  are applied-only) or per-stage env in the web app/Edge secrets, plus the
  mirrored `Databas`/Edge glue changes and tests.
- `maxOutputTokensExtraction` 16000 is too low for Haiku 5.5 (4 of 13 runs); more than
  ≈ 21 000 needs streaming (`messages.stream`) in `runExtraction.ts`, and the 150 s
  Edge wall clock leaves little room (Haiku extraction already takes up to 69 s).
- `costGuard` pricing is ready (tiered, high tier for reservations); the daily spend
  reservation per stage should use the same function.
- `PIPELINE_VERSION` does not include the model, so a model switch keeps serving
  existing results.

## Risks that remain

- Prices and the whole-request tier rule come from the brief, not from Anthropic's page.
- n = 1 per cell; Haiku flakes (Volontären sparande) and Sonnet flakes are not separated.
- Pontonjären maintenance (2/9) and four silent nyckeltal nulls show Haiku misses
  items under a long, dense output; more fields since PROMPT_VERSION 9–12 make this worse.
- The rejected-earlier page-marker problem was not seen with Haiku 5.5 transcription,
  but only three scans were tested and not against ground truth.
