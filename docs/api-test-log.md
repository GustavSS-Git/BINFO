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

**Running total: 0.34 SEK**
