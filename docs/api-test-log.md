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

Per-call raw records for W1-EVAL: `docs/api-runs/2026-10-09-scan-eval-calls.jsonl`. C1 per-call table: rows above, one per report run (calls summed).

**Running total: 166.93 SEK**
