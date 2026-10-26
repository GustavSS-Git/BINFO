# Benchmark thresholds 

Display control

All seven figures are still extracted — they're statutory disclosures and other calculations (e.g. citations, future features) may depend on having them. The "Visas i huvudanalys" field per figure below controls only whether it appears in the main "Föreningens ekonomi" view the buyer sees. A figure set to Nej is still in the data, just not surfaced as a headline card. Change either value at any time — this is the only place that decision lives.

Current defaults, reasoning below:

KPI 2 (årsavgift andel av rörelseintäkter): Nej. Direction is ambiguous without context — a low share can mean healthy commercial income or fragile reliance on member fees. Not something a buyer can act on directly.

---

## 1. Årsavgift per m² bostadsrättsyta (kr/m²/år)

| Status | Range |
|---|---|
| God | < 500 kr/m²/år |
| Acceptabel | 500 – 1000 kr/m²/år |
| Svag | 1000 – 1500 kr/m²/år |
| Kritisk | > 1500 kr/m²/år|

Reference point seen in research: Stockholm average ~833 kr/m²/år (HSB
Bostadsrättsbarometer 2025, 762 föreningar, FY2024). Not a threshold by
itself — decide what counts as high/low relative to this.

---

## 2. Årsavgifternas andel av totala rörelseintäkter (%)
My comment. Don't show, not relevant


Note: a *lower* share can mean healthy commercial/rental income, or can mean
heavy reliance on unstable non-fee income — decide whether direction alone is
meaningful or whether this needs a qualitative flag instead of a pure
threshold.

---

## 3. Skuldsättning per m² totalyta (kr/m²)

| Status | Range |
|---|---|
| God | < 2000 |
| Acceptabel | 2000  – 5000 |
| Svag | 5000 – 10000 |
| Kritisk | > 10000 |

---

## 4. Skuldsättning per m² bostadsrättsyta (kr/m²)

| Status | Range |
|---|---|
| God | < 2000 |
| Acceptabel | 2000  – 5000 |
| Svag | 5000 – 10000 |
| Kritisk | > 10000 |

Reference point seen in research: national average ~7,117 kr/m² (2023,
Nabo/SCB-derived). Decide your own thresholds relative to this — a flat
national average is not itself a god/acceptabel/svag/kritisk boundary.

---

## 5. Sparande per m² totalyta (kr/m²/år)



| Status | Range |
|---|---|
| God | > 300 |
| Acceptabel | 0 – 300 (exakt 0 och exakt 300 är acceptabel) |
| Svag |  < 0 |

Note: negative sparande is common and not automatically kritisk if it's a
planned, disclosed drawdown for renovation — pipeline should cross-check
against `vasentligaHandelser` / underhållsplan before flagging red, not use this threshold in isolation, but with commentary.

---

## 6. Räntekänslighet (%)

| Status | Range |
|---|---|
| God | < 2 % |
| Acceptabel | 2 – 5 % |
| Svag | 5 – 15 % |
| Kritisk | > 15 % |

Reference point seen in research: national average ~10.3% (2023, Nabo) — i.e.
fees would need to rise ~10% to absorb a 1-point rate increase, nationally on
average. This is the single most important figure in the product; spend the
most care getting these thresholds right.

---

## 7. Energikostnad per m² totalyta (kr/m²/år)

| Status | Range |
|---|---|
| God | < 100 |
| Acceptabel | 100 – 250 |
| Svag | 250 – 500 |
| Kritisk | > 500 |

Reference point seen in research: ~203 kr/m²/år national average (2023,
SCB/Nabo). Pre-1960s buildings typically run materially higher — decide
whether thresholds should be adjusted by building age (`byggar`) or kept flat.

My comment: Add comment that older houses usually jave a higher energy cost, especially re-1960s buildings
---


