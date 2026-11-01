# Plan (draft): earlier sales of the flat ("Tidigare försäljningar")

Written 2026-11-01. Status: **draft, not approved**. Background: `docs/research/booli-sold.md` §7
(use case A), `docs/booli.md` (`residenceId`).

## 1. Why it is cheap now

- A `/bostad/<id>` link is the flat itself. `sold?residenceId=<id>&sort=soldDate&direction=desc`
  returns exactly that flat's sales. No matching on address + `apartmentNumber` + boarea (the hard
  part of use case A in the research) is needed. Example: Sankt Eriksgatan 31A lgh 1301 → 2020 and 2026.
- The prefill already makes this call when the flat has no active listing. For a listed flat it
  is **one extra call** (1–4 today → 2–5).
- An `/annons/<id>` link has no residence id in the API answer. Those links get no history (v1).

## 2. Scope v1

- **In:** the flat's own sales, shown on `/analysera` after "Hämta uppgifter" and in the full report
  ("Priset") and PDF, only for `/bostad/` links.
- **Out:** sales in the same building, on the förening's addresses or nearby (research use cases
  B–D), the register page, a price index, and any use as a valuation input.

## 3. What is shown (owner 2026-11-01)

A simple table. The heading carries the address, since every row is the same flat:

```
Tidigare försäljningar av Sankt Eriksgatan 31A
Såld       Pris          kr/m²     Storlek        Avgift
okt 2026   5 950 000 kr  110 200   54 m², 2 rum   —
jan 2020   4 200 000 kr   77 800   54 m², 2 rum   2 950 kr
Äldre priser är inte justerade för prisutvecklingen. Uppgifter från Booli.
```

- **Columns:** Såld (month + year), Pris, kr/m² (soldPrice ÷ livingArea), Storlek (boarea + rum),
  Avgift ("—" when `rent` is 0 or missing). No "mot utgångspris" column in v1 (missing on ≈ 1 in 5
  sales).
- **Rows:** at most 5, newest first. The sale/listing being looked at (same `booliId`) is excluded.
  Empty → the block is not shown (no "inga försäljningar": Booli's coverage can't support it).
- **Phone (390 px):** each sale becomes two lines: date + price, then kr/m², size and avgift.
  The PDF gets the same table, the attribution and the unadjusted-price line.
- **Never:** `apartmentNumber`, Booli's `estimate`, the price source codes (`bobot`/`bid`).
- **Not an input:** the valuation is never called "bekräftad" by these sales and never moves
  (owner 2026-11-01: show only, not in the model).
- **Placement** (owner: both pages, after the valuation): as its own card AFTER the valuation's
  explanation, so the valuation and its explanation stay together and the sales don't read as part
  of the calculation:
  - full report, "Priset": after the price card ("Rimligt prisspann" …) and after
    `Details "Så har vi räknat"` (`src/components/rapport/RapportPris.tsx`); web and PDF;
  - `/analysera`, the Priskoll result: after `Details "Vad värderingen bygger på"`
    (`src/components/analysera/PriskollResultat.tsx`), i.e. after the valuation is presented.
    Shown only when the form was filled from a `/bostad/` link.

## 4. Design

- **API:** `hamtaBostadFranBooliApi` also returns `forsaljningar` (mapped by a pure function in
  `booliApiTolkning.ts`, tested on `fixtures/booli-api/bostad-720821-sold.json`). For a listed flat it
  makes the extra `sold?residenceId` call. A failure here never fails the prefill: just no history.
- **Prefill answer:** `AnnonsSvar` (`src/lib/annons/typer.ts`, not the shared contract) gets an
  optional `forsaljningar`. It is cached 24 h in `annons_cache` as now (old rows still parse).
- **Report and PDF:** two options, decision **H1**:
  - **(a) Store it with the analysis:** `PropertyInput.kalla` carries the list. This changes
    `src/types/analysis.ts` (stop-and-flag file) and puts sales data into buyer data kept for
    12 months.
  - **(b) Fetch it on read (recommended):** a server function by analysis id. It reads the
    residence id from `kalla.url` and calls Booli through a small cache (7 days per residence id,
    `annons_cache` pattern, purged by `binfo-retention`). The client loads it after the report, so
    a Booli failure never blocks the report. No contract change. Once the 12-month retention
    blanks `kalla`, the block is gone too.
- Behind the existing flags (`BOOLI_API=off`, `ANNONS_HAMTNING=off`). An expired key hides the
  block silently and logs `booli-api nyckel avvisad`.

## 5. Privacy and terms

- Date and price of one specific flat are public on Booli's own page, but together with the
  address they point to a seller (Lantmäteriet). Binfo shows them only to the buyer who pasted the
  link and doesn't store them beyond the cache. `/integritet` gets a sentence about it.
- **H2:** confirm in writing with Booli that showing sold prices (and caching them for 7 days) is
  covered by the key's terms. This also matters because the key expires around 2027-01-31.

## 6. Tests and work

- Unit: the mapping (sort order, at most 5, the excluded current sale, `rent 0`, kr/m²), the extra
  call never failing the prefill, the cache, and that the server function returns nothing without a
  `/bostad/` source.
- UI: render tests for the block (web + PDF view model). The text matches the numbers.
- Live: the four saved residences + 798609 (≈ 10 Booli calls).
- Size: about one day. Server (API + cache + server function) and frontend (block on `/analysera`,
  report, PDF) can run as two parallel agents once the answer shape is fixed.
- Deploy: if (b) adds a cache table, that's one migration (`db push`) before the Lovable publish.
  No Edge Function change, no `PROMPT_VERSION` bump.

## 7. Decisions needed

- **H1** Report data: (b) fetch on read (recommended) or (a) store with the analysis.
- **H2** Booli's written OK for showing and caching sold prices.
- ~~H3~~ Decided (owner 2026-11-01): both the report and `/analysera`, after the valuation (§3).
