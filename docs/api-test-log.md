# Claude API test log (v2 session)

Ceiling for this session: **300 SEK** (owner, 2026-10-09). Prices: USD→SEK 9.7 (`costGuard.ts`).
Sonnet 5 / Sonnet 5.5: $2 in / $10 out per MTok; cache write 1.25×, cache read 0.1× input. Haiku 4.5: $1 / $5.
`countTokens` calls are free and not logged as spend.

| # | Date | Agent / who | Purpose | Model | Input tok | Output tok | Cache write | Cache read | Cost SEK | Running total SEK |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-09 | W3b identity | identity pages 1–3: Årsredovisning bild 2 (scan) | claude-haiku-4-5 | 5046 | 43 | 0 | 0 | 0.0510 | 0.05 |
| 2 | 2026-10-09 | W3b identity | identity pages 1–3: Årsredovisning_2025_bild (scan) | claude-haiku-4-5 | 5046 | 47 | 0 | 0 | 0.0512 | 0.10 |
| 3 | 2026-10-09 | W3b identity | identity pages 1–3: SBC 2 (scan) | claude-haiku-4-5 | 5046 | 45 | 0 | 0 | 0.0511 | 0.15 |
| 4 | 2026-10-09 | W3b identity | identity pages 1–3: Nabo (text) | claude-haiku-4-5 | 8421 | 45 | 0 | 0 | 0.0839 | 0.24 |
| 5 | 2026-10-09 | W3b identity | identity pages 1–3: Riksbyggen 2025 (text) | claude-haiku-4-5 | 5367 | 67 | 0 | 0 | 0.0553 | 0.29 |
| 6 | 2026-10-09 | W3b identity | identity re-run after prompt tweak: Årsredovisning_2025_bild | claude-haiku-4-5 | 5067 | 47 | 0 | 0 | 0.0514 | 0.34 |
| 7 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline A Nabo (3 calls) | claude-sonnet-5 | 127151 | 14367 | 0 | 0 | 3.86 | 4.20 |
| 8 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline A SBC (3 calls) | claude-sonnet-5 | 114554 | 11788 | 0 | 0 | 3.37 | 7.57 |
| 9 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline A Volontären (3 calls) | claude-sonnet-5 | 55048 | 14959 | 0 | 0 | 2.52 | 10.09 |
| 10 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline B Nabo (cache on) (3 calls) | claude-sonnet-5 | 103376 | 14529 | 23719 | 0 | 3.99 | 14.08 |
| 11 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline B SBC (cache on, incl. 1 retry) (4 calls) | claude-sonnet-5 | 85652 | 15863 | 28988 | 18073 | 3.94 | 18.02 |
| 12 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline B Volontären (cache on) (3 calls) | claude-sonnet-5 | 30580 | 15090 | 14924 | 9597 | 2.44 | 20.45 |
| 13 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline C Nabo (3 calls) | claude-sonnet-5-5 | 103465 | 13471 | 27553 | 0 | 3.98 | 24.43 |
| 14 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline C SBC (3 calls) | claude-sonnet-5-5 | 85739 | 8514 | 18031 | 9597 | 2.94 | 27.38 |
| 15 | 2026-10-09 | C1/W5 cache+model A/B | full pipeline C Volontären (3 calls) | claude-sonnet-5-5 | 30669 | 10260 | 13087 | 9597 | 1.93 | 29.30 |
| 16 | 2026-10-09 | W1-EVAL scans | V1-bild2 (1 calls) | claude-sonnet-5 | 37429 | 346 | 0 | 0 | 0.76 | 30.06 |
| 17 | 2026-10-09 | W1-EVAL scans | V1-bild2025 (1 calls) | claude-sonnet-5 | 54743 | 417 | 0 | 0 | 1.10 | 31.17 |
| 18 | 2026-10-09 | W1-EVAL scans | V1-sbc2 (1 calls) | claude-sonnet-5 | 26411 | 1029 | 0 | 0 | 0.61 | 31.78 |
| 19 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-bild2 (5 calls) | claude-sonnet-5 | 39432 | 17822 | 0 | 0 | 2.49 | 34.27 |
| 20 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-bild2 (1 calls) | claude-sonnet-5 | 20684 | 2804 | 0 | 0 | 0.67 | 34.95 |
| 21 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-bild2#1 (1 calls) | claude-sonnet-5 | 31714 | 6194 | 0 | 0 | 1.22 | 36.16 |
| 22 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-bild2025 (13 calls) | claude-sonnet-5 | 168946 | 75609 | 0 | 0 | 10.61 | 46.77 |
| 23 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-bild2025 (1 calls) | claude-sonnet-5 | 28173 | 2952 | 0 | 0 | 0.83 | 47.61 |
| 24 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-bild2025#1 (1 calls) | claude-sonnet-5 | 38052 | 6388 | 0 | 0 | 1.36 | 48.96 |
| 25 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-sbc2 (4 calls) | claude-sonnet-5 | 27756 | 12308 | 0 | 0 | 1.73 | 50.70 |
| 26 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-sbc2 (1 calls) | claude-sonnet-5 | 15150 | 2863 | 0 | 0 | 0.57 | 51.27 |
| 27 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-sbc2#1 (1 calls) | claude-sonnet-5 | 29669 | 5690 | 0 | 0 | 1.13 | 52.40 |
| 28 | 2026-10-09 | W1-EVAL scans | T-claude-haiku-4-5-bild2 (5 calls) | claude-haiku-4-5 | 38699 | 16221 | 0 | 0 | 1.16 | 53.56 |
| 29 | 2026-10-09 | W1-EVAL scans | G-V2-haiku-4-5-bild2 (1 calls) | claude-sonnet-5 | 20624 | 2688 | 0 | 0 | 0.66 | 54.22 |
| 30 | 2026-10-09 | W1-EVAL scans | E-V2-haiku-4-5-bild2#1 (1 calls) | claude-sonnet-5 | 40350 | 5638 | 0 | 0 | 1.33 | 55.55 |
| 31 | 2026-10-09 | W1-EVAL scans | T-claude-haiku-4-5-bild2025 (12 calls) | claude-haiku-4-5 | 97282 | 33043 | 0 | 0 | 2.55 | 58.10 |
| 32 | 2026-10-09 | W1-EVAL scans | T-claude-haiku-4-5-sbc2 (4 calls) | claude-haiku-4-5 | 27175 | 12108 | 0 | 0 | 0.85 | 58.95 |
| 33 | 2026-10-09 | W1-EVAL scans | G-V2-haiku-4-5-sbc2 (1 calls) | claude-sonnet-5 | 14967 | 2896 | 0 | 0 | 0.57 | 59.52 |
| 34 | 2026-10-09 | W1-EVAL scans | E-V2-haiku-4-5-sbc2#1 (1 calls) | claude-sonnet-5 | 34763 | 7221 | 0 | 0 | 1.37 | 60.89 |
| 35 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-5-bild2 (5 calls) | claude-sonnet-5-5 | 39442 | 17503 | 0 | 0 | 2.46 | 63.35 |
| 36 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-5-bild2 (1 calls) | claude-sonnet-5 | 20365 | 2606 | 0 | 0 | 0.65 | 64.00 |
| 37 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-5-bild2#1 (1 calls) | claude-sonnet-5 | 45430 | 7125 | 0 | 0 | 1.57 | 65.58 |
| 38 | 2026-10-09 | W1-EVAL scans | G-V2-haiku-4-5-bild2025 (1 calls) | claude-sonnet-5 | 27832 | 3001 | 0 | 0 | 0.83 | 66.41 |
| 39 | 2026-10-09 | W1-EVAL scans | E-V2-haiku-4-5-bild2025#1 (1 calls) | claude-sonnet-5 | 39322 | 5653 | 0 | 0 | 1.31 | 67.72 |
| 40 | 2026-10-09 | W1-EVAL scans | G-V3-ocr-bild2 (1 calls) | claude-sonnet-5 | 20020 | 2463 | 0 | 0 | 0.63 | 68.34 |
| 41 | 2026-10-09 | W1-EVAL scans | E-V3-ocr-bild2#1 (1 calls) | claude-sonnet-5 | 36618 | 5377 | 0 | 0 | 1.23 | 69.58 |
| 42 | 2026-10-09 | W1-EVAL scans | G-V3-ocr-bild2025 (1 calls) | claude-sonnet-5 | 26347 | 3464 | 0 | 0 | 0.85 | 70.42 |
| 43 | 2026-10-09 | W1-EVAL scans | E-V3-ocr-bild2025#1 (1 calls) | claude-sonnet-5 | 31834 | 7136 | 0 | 0 | 1.31 | 71.73 |
| 44 | 2026-10-09 | W1-EVAL scans | G-V3-ocr-sbc2 (1 calls) | claude-sonnet-5 | 14622 | 2832 | 0 | 0 | 0.56 | 72.29 |
| 45 | 2026-10-09 | W1-EVAL scans | E-V3-ocr-sbc2#1 (1 calls) | claude-sonnet-5 | 26401 | 7860 | 0 | 0 | 1.27 | 73.57 |
| 46 | 2026-10-09 | W1-EVAL scans | G-V2b-sonnet-5-bild2 (1 calls) | claude-sonnet-5 | 27627 | 2402 | 0 | 0 | 0.77 | 74.34 |
| 47 | 2026-10-09 | W1-EVAL scans | E-V2b-sonnet-5-bild2#1 (1 calls) | claude-sonnet-5 | 8824 | 5813 | 0 | 0 | 0.74 | 75.07 |
| 48 | 2026-10-09 | W1-EVAL scans | G-V2b-sonnet-5-bild2025 (1 calls) | claude-sonnet-5 | 38603 | 3308 | 0 | 0 | 1.07 | 76.14 |
| 49 | 2026-10-09 | W1-EVAL scans | E-V2b-sonnet-5-bild2025#1 (1 calls) | claude-sonnet-5 | 10764 | 7107 | 0 | 0 | 0.90 | 77.04 |
| 50 | 2026-10-09 | W1-EVAL scans | G-V2b-sonnet-5-sbc2 (1 calls) | claude-sonnet-5 | 19316 | 2787 | 0 | 0 | 0.65 | 77.68 |
| 51 | 2026-10-09 | W1-EVAL scans | E-V2b-sonnet-5-sbc2#1 (1 calls) | claude-sonnet-5 | 12503 | 6556 | 0 | 0 | 0.88 | 78.56 |
| 52 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-5-sbc2 (4 calls) | claude-sonnet-5-5 | 27764 | 12273 | 0 | 0 | 1.73 | 80.29 |
| 53 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-5-sbc2 (1 calls) | claude-sonnet-5 | 15115 | 2628 | 0 | 0 | 0.55 | 80.84 |
| 54 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-5-sbc2#1 (1 calls) | claude-sonnet-5 | 24392 | 5775 | 0 | 0 | 1.03 | 81.87 |
| 55 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-5-bild2025 (7 calls) | claude-sonnet-5-5 | 58052 | 25151 | 0 | 0 | 3.57 | 85.44 |
| 56 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-5-bild2025 (1 calls) | claude-sonnet-5 | 28044 | 3536 | 0 | 0 | 0.89 | 86.33 |
| 57 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-5-bild2025#1 (1 calls) | claude-sonnet-5 | 39210 | 5960 | 0 | 0 | 1.34 | 87.66 |
| 58 | 2026-10-09 | W1-EVAL scans | G-CUR-testrapport#1 (1 calls) | claude-sonnet-5 | 95163 | 3074 | 0 | 0 | 2.14 | 89.81 |
| 59 | 2026-10-09 | W1-EVAL scans | E-CUR-testrapport#1 (1 calls) | claude-sonnet-5 | 16752 | 5574 | 0 | 0 | 0.87 | 90.67 |
| 60 | 2026-10-09 | W1-EVAL scans | T-claude-haiku-4-5-testrapport (5 calls) | claude-haiku-4-5 | 60026 | 20227 | 0 | 0 | 1.56 | 92.24 |
| 61 | 2026-10-09 | W1-EVAL scans | G-V2-haiku-4-5-testrapport (1 calls) | claude-sonnet-5 | 25872 | 3386 | 0 | 0 | 0.83 | 93.07 |
| 62 | 2026-10-09 | W1-EVAL scans | E-V2-haiku-4-5-testrapport#1 (1 calls) | claude-sonnet-5 | 50745 | 8121 | 0 | 0 | 1.77 | 94.84 |
| 63 | 2026-10-09 | W1-EVAL scans | T-claude-sonnet-5-testrapport (10 calls) | claude-sonnet-5 | 127062 | 42064 | 0 | 0 | 6.55 | 101.39 |
| 64 | 2026-10-09 | W1-EVAL scans | G-V2-sonnet-5-testrapport (1 calls) | claude-sonnet-5 | 25429 | 2683 | 0 | 0 | 0.75 | 102.14 |
| 65 | 2026-10-09 | W1-EVAL scans | E-V2-sonnet-5-testrapport#1 (1 calls) | claude-sonnet-5 | 35800 | 9242 | 0 | 0 | 1.59 | 103.73 |
| 66 | 2026-10-09 | W1-EVAL scans | GARBLED-i-pdf-ignore-textlayer (1 calls) | claude-sonnet-5 | 12645 | 3345 | 0 | 0 | 0.57 | 104.30 |
| 67 | 2026-10-09 | W1-EVAL scans | GARBLED-ii-png150-images (1 calls) | claude-sonnet-5 | 14810 | 3349 | 0 | 0 | 0.61 | 104.91 |
| 68 | 2026-10-09 | W1-EVAL scans | G-V2n-sonnet-5-testrapport (1 calls) | claude-sonnet-5 | 22365 | 2603 | 0 | 0 | 0.69 | 105.60 |
| 69 | 2026-10-09 | W1-EVAL scans | E-V2n-sonnet-5-testrapport#1 (1 calls) | claude-sonnet-5 | 28185 | 6196 | 0 | 0 | 1.15 | 106.75 |
| 70 | 2026-10-09 | W1-IMPL scans | bild2 full pipeline on claude-sonnet-5 by mistake (8 calls) | claude-sonnet-5 | 88980 | 31841 | 0 | 0 | 4.85 | 111.60 |
| 71 | 2026-10-09 | W1-IMPL scans | bild2 first 5.5 attempt, extraction failed validation twice (not logged per call) | claude-sonnet-5-5 | — | — | 0 | 0 | 4.58 | 116.18 |
| 72 | 2026-10-09 | W1-IMPL scans | bild2 debug re-run grounding+extraction (not logged per call) | claude-sonnet-5-5 | — | — | 0 | 0 | 1.52 | 117.70 |
| 73 | 2026-10-09 | W1-IMPL scans | bild2 final full pipeline (8 calls) | claude-sonnet-5-5 | 87428 | 27454 | 0 | 0 | 4.38 | 122.08 |
| 74 | 2026-10-09 | W1-IMPL scans | bild2025 full pipeline (11 calls, 1 extraction retry) | claude-sonnet-5-5 | 130070 | 40355 | 0 | 0 | 6.49 | 128.57 |
| 75 | 2026-10-09 | W1-IMPL scans | sbc2 full pipeline (8 calls, 1 extraction retry) | claude-sonnet-5-5 | 93591 | 24920 | 0 | 0 | 4.07 | 132.64 |
| 76 | 2026-10-09 | W1-IMPL scans | sbc2 debug re-run grounding+extraction (not logged per call) | claude-sonnet-5-5 | — | — | 0 | 0 | 1.90 | 134.54 |
| 77 | 2026-10-09 | W1-IMPL scans | Granen/Nabo text regression v6 (3 calls) | claude-sonnet-5-5 | 139625 | 11426 | 0 | 0 | 3.82 | 138.36 |
| 78 | 2026-10-09 | W1-IMPL scans | Albohem/SBC text regression v6 (3 calls) | claude-sonnet-5-5 | 113757 | 8468 | 0 | 0 | 3.03 | 141.39 |
| 79 | 2026-10-09 | W1-IMPL scans | Volontären text regression v6 (3 calls) | claude-sonnet-5-5 | 56071 | 9200 | 0 | 0 | 1.98 | 143.37 |
| 80 | 2026-10-09 | W1-IMPL scans | sbc2 re-run with cached transcript (3 calls) | claude-sonnet-5-5 | 43541 | 10051 | 0 | 0 | 1.82 | 145.19 |
| 81 | 2026-10-09 | W1-wire E2E | E2E state machine: 34-p scan, identifiering (Haiku) | claude-haiku-4-5 | 5067 | 47 | 0 | 0 | 0.05 | 145.24 |
| 82 | 2026-10-09 | W1-wire E2E | E2E state machine: 34-p scan, transkribering 7 parallel chunks | claude-sonnet-5-5 | 58794 | 25113 | 0 | 0 | 3.58 | 148.82 |
| 83 | 2026-10-09 | W1-wire E2E | E2E state machine: 34-p scan, grundning+extraktion+bedömning | claude-sonnet-5-5 | 61477 | 11494 | 0 | 0 | 2.31 | 151.12 |
| 84 | 2026-10-09 | W1-wire E2E | E2E state machine: SBC text report, 3 stages | claude-sonnet-5-5 | 116517 | 8460 | 0 | 0 | 3.08 | 154.21 |
| 85 | 2026-10-10 | Local integration | Local Supabase E2E (cron + Deno edge): SBC text report, 3 stages | claude-sonnet-5-5 | 115012 | 9167 | 0 | 0 | 3.12 | 157.33 |
| 86 | 2026-10-10 | Local integration | Local Supabase E2E: 34-p scan, identifiering | claude-haiku-4-5 | 5067 | 48 | 0 | 0 | 0.05 | 157.38 |
| 87 | 2026-10-10 | Local integration | Local Supabase E2E: 34-p scan, transkribering 7 chunks + grundning + extraktion + bedömning | claude-sonnet-5-5 | 118762 | 35103 | 0 | 0 | 5.75 | 163.13 |
| 88 | 2026-10-10 | Local integration | Local Supabase E2E: Nabo text report with reinvoke fix, 3 stages | claude-sonnet-5-5 | 133039 | 12556 | 0 | 0 | 3.80 | 166.93 |
| 89 | 2026-10-10 | Local integration 2 | Local Supabase E2E after reinvoke fix: SBC text report (per-call tokens not logged by the Edge Function) | claude-sonnet-5-5 | — | — | 0 | 0 | 3.02 | 169.95 |
| 90 | 2026-10-10 | Local integration 2 | Local Supabase E2E after reinvoke fix: 34-p scan incl. Haiku identity (per-call tokens not logged) | claude-sonnet-5-5 + haiku-4-5 | — | — | 0 | 0 | 6.13 | 176.08 |
| 91 | 2026-10-10 | Local integration 2 | Local CPU experiment: one 3-chunk transcription invocation | claude-sonnet-5-5 | — | — | 0 | 0 | 1.57 | 177.65 |
| 92 | 2026-10-12 | E new /exempel example | Brf Pontonjären 3 (716420-0599) FY2025, run 1 of 2, REJECTED: judging wrote "nästan 90 %" of loans maturing in 2026 vs 74 % in the report (3 calls: grundning 2.263, extraktion 0.760, bedömning 0.493 kr) | claude-sonnet-5-5 | 123372 | 11572 | 0 | 0 | 3.52 | 181.17 |
| 93 | 2026-10-12 | E new /exempel example | Brf Pontonjären 3 (716420-0599) FY2025, run 2 of 2, ACCEPTED, now `src/data/sampleAnalysis.ts` (3 calls: grundning 2.177, extraktion 0.725, bedömning 0.607 kr) | claude-sonnet-5-5 | 121623 | 11850 | 0 | 0 | 3.51 | 184.68 |
| 94 | 2026-10-12 | Supervisor (UI copy verification) | Local Supabase E2E: text report Brf Beckasinen 14 (716421-9722) to screenshot the new waiting text, report and PDF (per-call tokens not logged) | claude-sonnet-5-5 | — | — | 0 | 0 | 2.66 | 187.34 |
| 95 | 2026-10-12 | Supervisor (UI copy verification) | Local Supabase E2E: scanned report Brf Startfältet (Årsredovisning bild 2.pdf) incl. Haiku identity, to screenshot the scan waiting text (per-call tokens not logged) | claude-sonnet-5-5 + haiku-4-5 | — | — | 0 | 0 | 4.47 | 191.81 |
| 96 | 2026-10-13 | W3 pipeline | `verify-extraction` over all 13 answer-key PDFs, PROMPT_VERSION 7 (first wording: long address paragraph in the middle of the grounding prompt), 42 calls, 4 scans incl. | claude-sonnet-5-5 | — | — | 0 | 0 | 40.20 | 232.01 |
| 97 | 2026-10-13 | W3 pipeline | Albohem (`SBC årsredovisning.pdf`) x2, v7 first wording, extraction only (per-call tokens not logged; CLI cost line) | claude-sonnet-5-5 | — | — | 0 | 0 | 5.19 | 237.20 |
| 98 | 2026-10-13 | W3 pipeline | Albohem x3, PROMPT_VERSION 6 control (prompts.ts temporarily restored from HEAD) | claude-sonnet-5-5 | — | — | 0 | 0 | 7.94 | 245.14 |
| 99 | 2026-10-13 | W3 pipeline | Albohem x2, v7 with the address paragraph moved to the end of the grounding prompt | claude-sonnet-5-5 | — | — | 0 | 0 | 5.06 | 250.20 |
| 100 | 2026-10-13 | W3 pipeline | Albohem x3, v7 with a SHORTER address paragraph at the end (the shipped wording) | claude-sonnet-5-5 | — | — | 0 | 0 | 8.04 | 258.24 |
| 101 | 2026-10-13 | v3 supervisor | Albohem x3 regression check on the shipped v7 wording (`verify-extraction`, 3 parallel runs): 24/24 fields in all 3 (2.71 + 2.72 + 2.60 kr) | claude-sonnet-5-5 | — | — | 0 | 0 | 8.03 | 266.27 |
| 102 | 2026-10-13 | v3 supervisor | PRODUCTION test upload (owner-approved) after the owner rotated ANTHROPIC_API_KEY in Supabase Edge secrets: Pontonjären 3 done in ~90 s, grade C (earlier uploads failed at grundning with the expired key, 0 kr). Cost not read from the DB; estimate from identical runs | claude-sonnet-5-5 | — | — | 0 | 0 | ≈3.5 (est.) | ≈269.8 |
| 103 | 2026-10-13 | v3 supervisor | LOCAL Supabase E2E of pipeline v7 through the Deno Edge worker: Beckasinen 14 (20 p, text) → done in 135 s, p7.i1.s1, register area kungsholmen (buyer postnummer; report has no street address), summary row written. CPU: "soft limit reached" once (isolate recycled), no stage killed; pdf.js page parse measured 200–430 ms CPU on the test PDFs | claude-sonnet-5-5 | — | — | 0 | 0 | 2.88 | ≈272.7 |
| 104 | 2026-10-14 | v3 deploy | PRODUCTION re-run of the two pre-v3 register reports after the v3 deploy (`register -- rerun --to-current`): Startfältet (scan) + Pontonjären 3, both done and listed on /brf within ~150 s. Cost not read from the DB; estimate from earlier identical runs (scan ≈5 kr, text ≈3.5 kr) | claude-sonnet-5-5 | — | — | 0 | 0 | ≈8.5 (est.) | ≈281.2 |
| 105 | 2026-10-23 | optional utgångspris | LOCAL Supabase stack (`v2-lokalt.sh`), E2E of an analysis WITHOUT utgångspris: fresh upload `Årsredovisning_2025_Riksbyggen.pdf` (Helsingborgshus nr 17, text), 111 s upload→done; report, PDF and calculator link checked. Two further runs were register hits (Pontonjären 3, 0 kr). Cost from local `spend_day` | claude-sonnet-5-5 | — | — | 0 | 0 | 3.09 | ≈284.3 |
| 106 | 2026-10-23 | Question context (PROMPT_VERSION 8) | `npm run extract`, Pontonjären 3 FY2025: FAILED after grundning + extraktion because the input file lacked `andelstal`/`orgnr` (the CLI validates the input only before assembly, after the paid steps) | claude-sonnet-5-5 | — | — | 0 | 0 | 3.00 | ≈287.3 |
| 107 | 2026-10-23 | Question context (PROMPT_VERSION 8) | `npm run extract`, Pontonjären 3 FY2025 + the /exempel listing: v8 judging valid on first try, 5 analysis questions all with a finding+number "varfor", 4 with `svarssignal`; grade C. Judging motivation misstated the 2026 maturities (87 %, report: 74 %), questions correct (3 calls: grundning 2.276, extraktion 0.840, bedömning 0.505 kr; 72.2 s) | claude-sonnet-5-5 | 126780 | 11976 | 0 | 0 | 3.62 | ≈290.9 |
| 108 | 2026-10-23 | Fixed figures + motivation check (v8, grade bands) | `npm run extract`, Pontonjären 3 FY2025 + the /exempel listing: grade B (0 svag, 0 kritisk; no clamp), motivation states "74 % av skulden förfaller under 2026" (correct; the fixed figures give 5 759 091 of 7 759 091 kr); the number check found nothing in the motivation, flags or questions, so no rewrite call (3 calls: grundning 2.222, extraktion 0.772, bedömning 0.514 kr; 67.1 s) | claude-sonnet-5-5 | 125852 | 10991 | 0 | 0 | 3.51 | ≈294.4 |
| 109 | 2026-10-24 | Fee prognosis (PROMPT_VERSION 9) | `npm run extract`, Pontonjären 3 FY2025 + the /exempel listing, first v9 wording: 5 loans with dates/rates, balansdag, räntekostnader, areas; 56/56 page refs; judging checked against the PDF (22 % fee rise, fund 1 780 895 → 294 000) → new `/exempel` snapshot (3 calls: grundning 2.378, extraktion 1.064, bedömning 0.534 kr; 81.8 s) | claude-sonnet-5-5 | 137444 | 13502 | 0 | 0 | 3.98 | ≈298.4 |
| 110 | 2026-10-24 | Fee prognosis (PROMPT_VERSION 9) | `verify-extraction` (`VERIFY_ONLY`) on 8 text reports, first v9 wording: 144/159 verified fields, loans 42/42 (UTKAST keys). Granen lost all 7 nyckeltal (grounding skipped the flerårsöversikt); Volontären antalLokaler (pre-existing), Hökensgata antalLokaler 2 vs 4 (16 calls) | claude-sonnet-5-5 | — | — | 0 | 0 | 23.16 | ≈321.6 |
| 111 | 2026-10-24 | Fee prognosis (PROMPT_VERSION 9) | `npm run extract`, Helsingborgshus 17 FY2024/25 + a hypothetical flat (worked example 2), first v9 wording (3 calls: grundning 1.974, extraktion 1.467, bedömning 0.487 kr; 98.4 s) | claude-sonnet-5-5 | 129226 | 14648 | 0 | 0 | 3.93 | ≈325.5 |
| 112 | 2026-10-24 | Fee prognosis (PROMPT_VERSION 9) | `verify-extraction` Granen + Hökensgata after moving the new grounding paragraphs to the end: 54/54, loans 19/19 (4 calls) | claude-sonnet-5-5 | — | — | 0 | 0 | 7.57 | ≈333.1 |
| 113 | 2026-10-24 | Fee prognosis (PROMPT_VERSION 9) | `verify-extraction` Albohem + Torsborgen, same wording: Albohem lost all 7 nyckeltal (flake), Torsborgen + loans 10/10 OK (4 calls) | claude-sonnet-5-5 | — | — | 0 | 0 | 5.35 | ≈338.4 |
| 114 | 2026-10-24 | Fee prognosis (PROMPT_VERSION 9) | `verify-extraction` on the SHIPPED wording (nyckeltal first in the grounding prompt): Albohem ×2 24/24 each, Granen 27/27 + loans 19/19 (6 calls, two parallel runs: 6.99 + 3.30 kr) | claude-sonnet-5-5 | — | — | 0 | 0 | 10.29 | ≈348.7 |
| 115 | 2026-10-24 | Maintenance extraction (PROMPT_VERSION 10, T1) | `verify-extraction` (`VERIFY_ONLY`, `VERIFY_SAVE_RESULTS`) Beckasinen 14: 7 nyckeltal 14/14, loans 7/7 (UTKAST key), genomförda åtgärder 2 of 3 (missed fasad 2018 in the long 2018 row), no hallucinated investeringsbehov/plantotal (2 calls: grundning 1.714, extraktion 0.970 kr; 58.3 s) | claude-sonnet-5-5 | 87413 | 10184 | 0 | 0 | 2.68 | ≈351.4 |
| 116 | 2026-10-24 | Maintenance extraction (PROMPT_VERSION 10, T1) | same run, Torsborgen 3: 7 nyckeltal 14/14, loans OK, åtgärder 2/2 (hiss 2020, stambyte 2000) + 2 allowed extras, nothing invented (2 calls: grundning 1.808, extraktion 1.280 kr; 69.1 s) | claude-sonnet-5-5 | 104769 | 10885 | 0 | 0 | 3.09 | ≈354.5 |
| 117 | 2026-10-24 | Maintenance extraction (PROMPT_VERSION 10, T1) | same run, Helsingborgshus 17: 7 nyckeltal 14/14, loans OK; åtgärder 2/3 (missed fönster 2008 "Delar av beståndet"), rekommenderadAvsattning (777 tkr/år "underhållsbehov") not extracted; `lanebok.snittranta` null vs key 2.6757 (2 calls: grundning 2.058, extraktion 1.602 kr; 78.1 s) | claude-sonnet-5-5 | 121545 | 13432 | 0 | 0 | 3.66 | ≈358.1 |
| 118 | 2026-10-24 | Maintenance extraction (PROMPT_VERSION 10, tweak 1: several parts per row, plan's yearly need) | `verify-extraction` Beckasinen 14: nyckeltal 13/14 (skuldsättning/m² totalyta null — the report's ambiguous "Skuldsättning, kr/kvm" row; 14/14 in rows 115 and 120), loans OK, åtgärder 2/3 (fasad 2018 still missed), hiss 2023 "byte av styrskor" wrongly counted (2 calls: 1.670 + 1.066 kr; 59.4 s) | claude-sonnet-5-5 | 89485 | 10318 | 0 | 0 | 2.74 | ≈360.8 |
| 119 | 2026-10-24 | same | same run, Helsingborgshus 17: nyckeltal 14/14, loans OK, åtgärder 3/3 (fönster 2008 "delar av beståndet" now found), rekommenderadAvsattning 777 000 found; snittränta null vs 2.6757 again (2 calls: 1.925 + 1.467 kr; 72.4 s) | claude-sonnet-5-5 | 113366 | 12301 | 0 | 0 | 3.39 | ≈364.2 |
| 120 | 2026-10-24 | Maintenance extraction (PROMPT_VERSION 10, tweak 2: read the whole year paragraph, no minor repairs) | `verify-extraction` Beckasinen 14: verified 18/18 (nyckeltal complete), åtgärder 2/3 (fasad 2018 in the 4th line of the 2018 paragraph still missed), styrskor no longer counted (2 calls: 1.738 + 1.213 kr; 60.8 s) | claude-sonnet-5-5 | 98707 | 10683 | 0 | 0 | 2.95 | ≈367.1 |

Per-call raw records for W1-EVAL: `docs/api-runs/2026-10-09-scan-eval-calls.jsonl`. C1 per-call table: rows above, one per report run (calls summed).

Per-call raw records for entries 92-93 (E, new /exempel example): `docs/api-runs/2026-10-12-exempel-pontonjaren-calls.jsonl` (from the CLI log tables; no t_start/t_end). Wall clock: run 1 70.1 s, run 2 75.7 s.

Per-call raw records for entry 96 (W3 full run): `docs/api-runs/2026-10-13-w3-v7-verify-calls.jsonl`. Entries 97-100 are single `npm run extract` runs (extraction only); only the CLI cost line was kept.

**Running total: ≈367.1 SEK** (rows 102, 104 estimated). Round 2026-10-24b (rows 109–114): 54.28 kr of the 60 kr budget. Round 2026-10-24c (rows 115–120): 18.51 kr of the 40 kr budget.
