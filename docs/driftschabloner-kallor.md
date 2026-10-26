# Driftschabloner: candidate sources (research 2026-10-26)

Status: **decided 2026-10-26 (supervisor, owner delegated); values in code since `REGELVERSION` "2026-10-26b".**
Chosen values (`src/lib/kalkyl/regler.ts` is the single source, `calc/schabloner.ts` reads it):

- Hushållsel: Konsumentverket 2026 by persons, 400 / 530 / 700 / 870 / 1 010 / 1 150 / 1 280 kr/mån (1–7), no per-m² part. More than 7 persons uses the 7-person value (Binfo's assumption, stated in the basis text).
- Värme (only when "Ingår ej"): 21 kr per m² boarea and month, no fixed part (Nils Holgersson 2026 Bilaga 1a: 250,32 kr/m²·år ÷ 12 ≈ 20,9).
- Vatten (only when "Ingår ej"): 6 kr per m² boarea and month (Nils Holgersson 2026: VA Stockholm 71,08 kr/m²·år ÷ 12 ≈ 5,9). Replaces the per-person formula.
- Hemförsäkring: Konsumentverket 2026 by persons, 150 / 170 / 200 / 250 / 300 / 340 / 350 kr/mån; a hyresrätt policy, the bostadsrättstillägg is NOT included.
- Bredband: 349 kr, still "Binfos uppskattning" (no published source for broadband alone).
- Skuldkvot 5×: unchanged, Binfos antagande; the note adds FI context (7,1 % of buyers 2025 above 4,5×, 1,8 % above 5,5×).
- Värme and vatten exist only in /bolanekalkyl (default "Ingår" = 0 kr). The analysis and its report never ask about, count or show them.

Original research status below (candidates as researched).

| Item                   | Today            | Best source (primary)                           | Verified figure                                                                                      | Converted (inferred)                                                                           |
| ---------------------- | ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Hushållsel             | 250 + 8 kr/m²    | Konsumentverket _Hushållskostnader 2026_        | 400 / 530 / 700 / 870 kr/mån for 1–4 persons (excl. heating/ventilation el)                          | per person, not per m²                                                                         |
|                        |                  | Nils Holgersson 2026 (Bilaga 4)                 | lägenhet 2 300 kWh/år; SE3 94,0 öre/kWh (SCB), energiskatt 36,0 öre, Ellevio nät 105 öre incl. moms  | ≈ 2,675 kr/kWh → ≈ 513 kr/mån for 67 m² (≈ 7,7 kr/m²); today's formula gives 786 (≈ 50 % high) |
| Värme (not in the fee) | 180 + 14 kr/m²   | Nils Holgersson 2026 Bilaga 1a                  | fjärrvärme Stockholms kommun 250,32 kr/m² lägenhetsyta·år incl. moms (nat. 246,56; incl. varmvatten) | 20,9 kr/m²/mån, no fixed part                                                                  |
|                        |                  | Energimyndigheten EN0101_10 (2025)              | Stockholms län 130,8 kWh/m² (heated area, temp.-corrected)                                           | × 1,30 kr/kWh ÷ 12 ≈ 14,2 kr/m² (≈ 16,5 on boarea; basis inferred)                             |
| Vatten                 | 120 kr/person    | Konsumentverket 2026                            | VA 220 / 440 / 650 / 880 kr/mån for 1–4 persons (national)                                           | ≈ 220 kr/person                                                                                |
|                        |                  | Nils Holgersson 2026                            | VA Stockholm 71,08 kr/m²·år (nat. 116,16)                                                            | Stockholm ≈ 135 kr/person (scaled; inferred)                                                   |
| Bredband               | 349 kr           | Konsumentverket 2026                            | "Internet- och mobilabonnemang" 1 000–1 690 kr (not separable)                                       | no clean broadband-only source; PTS prisrapport 2024 median 399 kr (snippet only, unverified)  |
| Hemförsäkring          | 120 + 3 kr/m²    | Konsumentverket 2026                            | 150 / 170 / 200 / 250 kr/mån for 1–4 persons (hyresrätt, no bostadsrättstillägg)                     | per person; tillägg has no public source                                                       |
| Skuldkvot 5×           | Binfos antagande | FI promemoria "Svenska bolån 2025" (2026-05-21) | purchases 2025: mean 295 %; 451–550 % = 5,3 %; > 550 % = 1,8 %                                       | 7,1 % of buyers above 4,5×; no published bank cap — 5× stays an assumption                     |

Notes

- Konsumentverket's 2026 household costs already include hushållsel, VA, hemförsäkring, internet+mobil;
  KALP should add only heating (and a bostadsrättstillägg) from Binfo's schablons, as the code does.
- In a bostadsrätt, värme and vatten are normally in the månadsavgift (owner 2026-10-26: default 0 kr,
  added only when not included). Building-level figures apply only to individually metered flats.
- No source supports the fixed parts (250 / 180 / 120 kr).

Suggested replacements (owner decision pending): el by household size (Konsumentverket) or 7,7 kr/m²;
värme 15–21 kr/m² without a fixed part; vatten 220 kr/person (≈ 135 in Stockholm); försäkring by household
size + tillägg as "Antagande"; bredband stays "Binfos uppskattning" until PTS is verified.

Sources

- Konsumentverket 2026: https://publikationer.konsumentverket.se/downloads/kostnadsberakningar-hushallskostnader-2026-sv-kov_tga_32d.pdf
- Nils Holgersson 2026: https://nilsholgersson.nu/wp-content/uploads/2026/10/Nils-Holgersson-2026-Slutrapport-Bilaga-1-4.pdf
- Energimyndigheten statistikdatabas (EN0101_10, EN0101_8): https://pxexternal.energimyndigheten.se/pxweb/sv/Energimyndighetens_statistikdatabas/
- Sveby Brukarindata bostäder 2.0 (2024-11-11): 21 kWh/m² Atemp hushållsel
- FI "Svenska bolån 2025 – statistik, tidsserier": https://fi.se/contentassets/575c373535fd43fda657cd17552488be/svenska-bolan-2025--statistik-tidsserier.pdf
- FI "Den svenska bolånemarknaden" 2025: https://www.fi.se/contentassets/324ca6f343e64a088c62e075b0edb8ef/den-svenska-bolanemarknaden_.pdf
