# Bolagsverket as a source of BRF årsredovisningar (research spike, 2026-10-13)

Question: can Binfo get the FY2025 årsredovisning PDFs of Stockholm bostadsrättsföreningar from
Bolagsverket, programmatically and for free or cheaply, to pre-populate the public register?

Legend: **[V]** = verified today against an official page, spec or file (source and date in
[Sources](#sources)). **[I]** = inference or unverified. No credentials were used and nothing was
ordered. All probes went to public, unauthenticated endpoints.

## Summary / recommendation

- **The free route does not work for BRFs, and won't any time soon.**
  - **[V]** The free "värdefulla datamängder" (VDM) API and the weekly bulk zips only contain
    *digitally filed* årsredovisningar in iXBRL.
  - **[V]** Only aktiebolag can file digitally (K2, K3, K3 koncern, ESEF).
  - **[V]** Bolagsverket's own FAQ says it outright: *"Kan jag hämta årsredovisningar för
    bostadsrättsföreningar gratis? Nej, i dagsläget kan bostadsrättsföreningar inte lämna in sin
    årsredovisning i formatet iXBRL."* (updated 2026-05-06).
  - **[V]** I checked this myself. I listed every 2026 weekly bulk zip (weeks 1–41, about 420,000
    filings, central directories read via HTTP range requests). Every entry is a `55xxxxxxxx`
    orgnr (aktiebolag). There are zero BRF orgnr (`7xxxxxxxxx`), including the July peak when
    calendar-year BRFs had to file.
- **[V]** **BRFs file on paper.** From FY2025 (räkenskapsår starting after 2024-12-31) every BRF
  must file its årsredovisning and revisionsberättelse within 7 months of year end (31 July 2026
  for calendar-year BRFs). Associations can't file digitally, so the reports go by post to
  "Bolagsverket, Årsredovisningar, 851 98 Sundsvall".
- **The realistic Bolagsverket route is the paid "Dokument" API.** It is part of "API för att
  hämta företagsinformation", released 2026-04-24.
  - **[V]** It has `POST /dokumentlista` with document groups including `ARSREDOVISNING-DOKGRP`
    and the BRF-specific `EKONOMISK_PLAN-DOKGRP`, and `GET /dokument/{id}` returning
    `application/octet-stream`.
  - **[V]** Listing is free. Only downloads count against the document quota.
  - **[V]** Price: 5,000 kr connection fee, plus at least 1,000 kr/month for transactions, plus
    4,000 kr/month for 100 documents (≈40 kr/doc), all ex moms.
  - **[I]** That paper-filed BRF årsredovisningar are scanned and served there as PDFs is a strong
    inference but **not verified**. The FAQ talks about "inskannade årsredovisningar i pdf-format"
    as something not available *for free*, and the API has a BRF-only document group. Verify in
    the test environment, or with Bolagsverket, before signing anything.
- **Listing Stockholm BRFs is free.** Use SCB's free företagsregister API (API key, free). It has
  `jurform` (53 = bostadsrättsförening) and `kommunSate` (säteskommun; Stockholm = 0180). The free
  Bolagsverket bulk file has legal form but **no säte**, only a postal address. That address is
  often the förvaltare's (HSB Solna, Nabo Sundsvall…), so it is a poor proxy.
- **Recommendation.**
  1. Enumerate Stockholm BRFs via the SCB API.
  2. Sign the paid Bolagsverket API agreement at the lowest transaction level plus 100
     documents/month.
  3. Confirm in test/production that BRF FY2025 reports are downloadable PDFs.
  4. Pull about 100/month, prioritising BRFs Binfo users actually ask about.
  5. Cancel when done. The agreement can be cancelled at any time and ends at the next månadsskifte.

  **[I]** Expected cost for about 300 reports over 3 months: about 20,000 kr ex moms (25,000 incl.)
  to Bolagsverket, plus about 1,200–2,000 kr of Claude spend. Most are scans: 4.1–6.5 kr each on
  the scan path, per CLAUDE.md measurements.

  A one-month burst would need the 1,000-document tier (40,000 kr/month) and is not worth it.

## API facts

### Free: API för värdefulla datamängder (VDM)

| Item | Fact |
|---|---|
| Base URL | **[V]** `https://gw.api.bolagsverket.se/vardefulla-datamangder/v1` (OpenAPI 3.0.3, public in the WSO2 devportal, API id `ff8f9a91-1fdd-4705-8836-c1906581162f`, created 2025-01-28) |
| Endpoints | **[V]** `GET /isalive`; `POST /organisationer` (body `{identitetsbeteckning}`); `POST /dokumentlista` (body `{identitetsbeteckning}` → `[{dokumentId, filformat, rapporteringsperiodTom, registreringstidpunkt}]`); `GET /dokument/{dokumentId}` → `application/zip` |
| Auth | **[V]** OAuth2 client credentials (scope `vardefulla-datamangder:read`; token URL given as relative `/oauth2/token` in the spec, **[I]** i.e. `https://portal.api.bolagsverket.se/oauth2/token` as used by community clients). `client_id`/`client_secret` for test and prod are sent by e-mail + SMS after a web "kundanmälan" (e-mail + mobile number required; no-reply addresses refused). |
| Cost / contract | **[V]** Free, no contract ("Det kostar ingenting och det krävs inga avtal"). Support is currently backlogged ("Hög belastning på API-supporten", 2026-05-13). |
| Rate limit | **[V]** 60 requests/minute per user. |
| Licence | **[V]** Bolagsverket: free commercial and non-commercial reuse, may be modified/combined, subject to data protection and secrecy law; attribution may be required. **[I]** EU 2023/138 requires CC BY 4.0 or equivalent for high-value datasets. |
| Org forms covered by `/organisationer` | **[V]** All, including **BRF (Bolagsverket form `BRF`, SCB juridisk form 53)** and EK (51). Fields: name(s), organisationsform, juridisk form, postadress, registration dates, SNI, verksamhetsbeskrivning, avregistrering, ongoing liquidation/konkurs. **No säte/kommun.** |
| Documents | **[V]** Only digitally filed årsredovisningar: AB K2, AB K3, K3 koncern, ESEF. iXBRL inside a zip. From 2020 onwards. |
| Bulk equivalents | **[V]** Weekly zips of the previous week's iXBRL filings: `https://vardefulla-datamangder.bolagsverket.se/arsredovisningar-bulkfiler/arsredovisningar/<year>/<week>_<n>.zip` (index: S3/MinIO listing at `.../arsredovisningar-bulkfiler?prefix=arsredovisningar/`; inner files named `<orgnr>_<period-end>.zip`). |

### Paid: API för att hämta företagsinformation (incl. the Dokument API)

- **[V]** Gateway APIs (public devportal listing `portal.api.bolagsverket.se/api/am/devportal/v3/apis`):
  - `https://gw.api.bolagsverket.se/foretagsinformation/v4`: `/organisationer` (includes
    `sate`/`hemvistkommun`), `/finansiella-rapporter` (period, arrival and registration date of
    each årsredovisning; v4.7, 2026-03-24), `/arenden` and others.
  - `https://gw.api.bolagsverket.se/dokument/v1`:
    - `POST /dokumentlista`: `identitetsbeteckning`, optional `dokumentgrupper` ∈
      {BOLAGSORDNING, EKONOMISK_PLAN, RAPPORT, STADGAR, ARSREDOVISNING, UTSKICK}-DOKGRP,
      `fromdatum`/`tomdatum`.
    - The response per document has `dokumentId, filformat, filnamn, handlingstyp,
      rapporteringsperiodTom, registreringstidpunkt, stammodatum, kvittensnummer…`.
    - `GET /dokument/{dokumentId}` returns octet-stream.
- **[V]** Auth: OAuth2 client credentials. Signed paper agreement first, test keys, then
  production keys.
- **[V]** Rate limit: 20 calls per second.
- **[V]** Pricing (ex moms; incl. moms in brackets), page updated 2026-09-22:
  - Connection fee: 5,000 (6,250).
  - Transactions per month: 500 = 1,000; 3,000 = 5,000; 8,000 = 13,000; 15,000 = 24,000.
  - Documents per month: 100 = 4,000 (5,000); 1,000 = 40,000 (50,000); 5,000 = 200,000.
  - Unused quota does not roll over.
  - Listing documents does not count as a document download.
  - VDM calls are free under the same keys.
  - Billing starts at production access, at the latest 3 months after signing.
- **[V]** Agreement terms (avtal för företag och privatpersoner):
  - Data may only be fetched for the purposes declared in *Bilaga A – Ändamålsbeskrivning*.
  - Personal data must be processed lawfully.
  - Changes of purpose must be reported; Bolagsverket can terminate if it doesn't approve.
  - Either party can terminate at any time, effective at the next månadsskifte.
  - There is no explicit redistribution clause in the main text.
  - **[I]** Publishing the PDFs or derived analyses must be described in Bilaga A.

## Coverage of BRFs

- **[V]** Obligation: all ekonomiska föreningar, including every BRF regardless of size.
  - Applies to räkenskapsår starting after 2024-12-31.
  - Deadline: 7 months after year end.
  - Late fee: 7,500 kr, then more.
  - So calendar-year FY2025 reports were due by **31 July 2026**.
  - BRFs with a broken fiscal year (e.g. ending 2026-06-30) file their first report in early 2027.
- **[V]** Filing method: paper only, to Bolagsverket, Årsredovisningar, 851 98 Sundsvall.
  - "Idag kan endast aktiebolag lämna in sin årsredovisning digitalt" (Bolagsverket, updated
    2026-07-02).
  - FAR (2026-03-17) describes paper submission only.
- **[V]** Free channel: none.
  - The FAQ (above) says no.
  - My scan of all 2026 weekly bulk files found 0 BRF filings among about 419,500.
- **[I]** Paid channel: FY2025 BRF reports should appear in `/finansiella-rapporter` and
  `dokument/v1 /dokumentlista` once registered. They are most likely scanned image PDFs (Binfo's
  `textlager = saknas` path, ≤ 60 pages).
  - Unknowns: registration backlog after the first-year paper wave, and whether the scans are
    exposed through the API (versus only via the web shop).
  - Lusa's guide (Oct 2026) says it "kommer ta tid innan alla föreningar finns i registret".
- **[I]** Earlier years (FY2024 and older) mostly don't exist at Bolagsverket. Before 2025 only
  larger ekonomiska föreningar had to file.

## Alternatives & costs

| Route | Covers BRF FY2025? | Cost for ~300 | Effort | Notes |
|---|---|---|---|---|
| VDM API / weekly bulk (free) | **No** [V] | 0 | — | AB iXBRL only |
| Paid Dokument API | Probably [I] | ≈ 20,000 kr ex moms over 3 months at 100 docs/month (5,000 + 3×1,000 + 3×4,000) [V prices] | Agreement by post, test env, small client (OAuth + 2 endpoints) | Listing is free, so you can check availability before spending quota |
| Web shop "Sök företagsinformation" | Probably [I] | Per-document price is shown only inside the e-service (bot-protected; not checked). "Ärendebevis årsredovisning" 75 kr [V] | Manual, one at a time; scraping not allowed | Fine for spot checks |
| Copy of allmän handling by request | Yes once registered [I] | "Kopia av handling" 2.50 kr/page [V] ⇒ ~25 pages × 300 ≈ 19,000 kr [I] | Manual e-mail requests, slow | Offentlighetsprincipen; no API |
| BRF websites / förvaltare portals / the BRF itself | Varies | 0 | Manual or crawl | Copyright/ToS per site [I]; not a Bolagsverket source |

Downstream Claude spend is independent of the route. Most reports will be scans: 4.1–6.5 kr each
(CLAUDE.md, measured 2026-10-09), so about 1,200–2,000 kr for 300.

## How to list Stockholm BRFs

1. **Best (free, needs API key): SCB allmänna företagsregister API.**
   - **[V]** Free since 2025-06-26. Base `https://apiafr.scb.se/v1/…`, header `X-API-Key`.
     Register at `registreraafr.scb.se`. Max 5 calls/s and 5,000 rows per call (cursor
     pagination). OpenAPI at `https://apiafr.scb.se/swagger/v1/swagger.json`.
   - **[V]** `GET /v1/juridiskaenheter/juridiskform/53` returns all BRFs. Records include
     `KommunSate` (säteskommun, 4-digit; Stockholm = `0180`) and `LanSate`.
   - **[I]** Filtering client-side to `0180` gives the Stockholms kommun list in about 7 paged
     calls (≈33,700 active BRFs nationally).
2. **Free, no sign-up, weaker: Bolagsverket bulk file**
   (`https://vardefulla-datamangder.bolagsverket.se/bolagsverket/bolagsverket_bulkfil.zip`,
   251 MB zip / 989 MB txt, weekly, `;`-separated, `organisationsform = BRF-ORGFO`).
   - **[V]** Downloaded 2026-10-13: 43,339 BRF rows, 33,748 not avregistrerade.
   - **[V]** There is no säte field, only a postal address. The top postorter are SUNDSVALL 4,830
     (Nabo), STOCKHOLM 3,827, then SOLNA 1,025 (HSB).
   - **[V]** Of the 3,827 with postort STOCKHOLM, 2,508 have a c/o or Box address; 1,319 use a
     plain street address (almost all postnummer 11x).
   - **[I]** Usable as a lower bound, or for cross-checks with Binfo's
     `data/derived/postnummer_omrade.csv`. Not usable as the authoritative list.
   - **[V]** The SCB bulk file (`scb_bulkfil.zip`) has juridisk form + postal address but also
     no säte.
3. **Paid Bolagsverket `/organisationer`.** It returns `sate`/`hemvistkommun` per orgnr, but each
   call is a paid transaction. Not needed if SCB works.

## Owner actions

1. **Register for the SCB AFR API key** (registreraafr.scb.se; accept terms). Free. Gives the
   authoritative Stockholm BRF list.
2. **Ask Bolagsverket before signing** (api@bolagsverket.se or the contact form):
   - Are FY2025 BRF årsredovisningar that were filed on paper downloadable via `dokument/v1`, and
     in what format?
   - How far behind is registration?
   - Is the planned use (pre-populating a public BRF analysis register, possibly showing the PDF)
     acceptable under Bilaga A?
3. **If yes, sign the "Avtal om tjänst för företagsinformation via API"** (företag; signed by
   firmatecknare and returned by post).
   - Choose 500 transactions plus 100 documents/month.
   - Write the purpose in Bilaga A.
   - Budget about 25,000 kr incl. moms for 3 months.
   - Plan to cancel afterwards.
4. **Optional, free: request VDM keys** (kundanmälan; e-mail + mobile). Only useful for AB data,
   not BRF reports. Skip unless needed elsewhere.
5. **Legal/privacy:**
   - Årsredovisningar name and are signed by board members. CLAUDE.md already flags that the
     privacy text needs a stated basis for keeping PDFs that name board members.
   - Decide whether Binfo stores the PDFs only (as today) or also displays them.
   - **[I]** Copyright in a BRF's årsredovisning is likely thin. Republishing the full PDF is a
     different question from publishing derived nyckeltal; get advice before displaying PDFs
     publicly.
6. Log all paid pipeline runs in `docs/api-test-log.md` as usual.

## Sources

All fetched 2026-10-13. Page "Uppdaterad" dates are given where shown.

- Bolagsverket, API för värdefulla datamängder (updated 2026-06-30): https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/vardefulladatamangder/apiforvardefulladatamangder.5513.html
- Bolagsverket, Värdefulla datamängder (updated 2025-11-21): https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/vardefulladatamangder.5294.html
- Bolagsverket, Kundanmälan till API för värdefulla datamängder (updated 2026-07-07): https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/vardefulladatamangder/kundanmalantillapiforvardefulladatamangder.5528.html
- Bolagsverket, Nedladdningsbara filer (updated 2026-08-20): https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/nedladdningsbarafiler.2517.html
- Bolagsverket, Frågor och svar om API:erna (updated 2026-05-06): https://bolagsverket.se/apierochoppnadata/driftochsupport/fragorochsvaromapierna.4611.html
- Bolagsverket, API för att hämta företagsinformation, incl. prices (updated 2026-09-22): https://bolagsverket.se/apierochoppnadata/hamtaforetagsinformation/apiforatthamtaforetagsinformation.3988.html
- Bolagsverket, Avtal om tjänst för företagsinformation via API (PDF): https://bolagsverket.se/download/18.37b754ba19ceb00666a562d5/1788438045725/avtal-om-tjanst-for-foretagsinformation-via-api-foretag-privat.pdf
- Bolagsverket release notes: v4.7 finansiella rapporter (2026-03-24) https://bolagsverket.se/apierochoppnadata/nyheterochreleaser/2026/nyinformationiapiforatthamtaforetagsinformationversion47.5920.html ; Dokument och handlingar (2026-04-24) https://bolagsverket.se/apierochoppnadata/nyheterochreleaser/2026/nyinformationochnyfunktionitjanstenapiforatthamtaforetagsinformation.5962.html
- Bolagsverket devportal (public, no login): API list https://portal.api.bolagsverket.se/api/am/devportal/v3/apis ; VDM spec `/api/am/devportal/v3/apis/ff8f9a91-1fdd-4705-8836-c1906581162f/swagger` ; Dokument spec `/api/am/devportal/v3/apis/d88314fc-83e3-476b-9cd7-6e568518b84f/swagger` ; Företagsinformation v4 spec `/api/am/devportal/v3/apis/3e90ead0-d992-49cc-a02d-7984c27c2164/swagger`
- Bolagsverket, API för digital inlämning av årsredovisning ("Idag kan endast aktiebolag…", updated 2026-07-02): https://bolagsverket.se/apierochoppnadata/lamnaforetagsinformation/apifordigitalinlamningavarsredovisningochrevisionsberattelse.5935.html
- Bolagsverket, Priser för handlingar och tjänster (updated 2026-09-01): https://bolagsverket.se/sokforetagsinformation/priserforhandlingarochtjanster.2043.html
- Bolagsverket bulk data (downloaded/listed 2026-10-13): https://vardefulla-datamangder.bolagsverket.se/bolagsverket/bolagsverket_bulkfil.zip (Last-Modified 2026-10-12), https://vardefulla-datamangder.bolagsverket.se/scb/scb_bulkfil.zip, https://vardefulla-datamangder.bolagsverket.se/arsredovisningar/
- FAR, "Alla ekonomiska föreningar ska lämna in handlingar till Bolagsverket" (2026-03-17): https://www.far.se/aktuellt/nyheter/2026/mars/alla-ekonomiska-foreningar-ska-lamna-in-handlingar-till-bolagsverket/
- Bostadsrätterna, "Årsredovisningar för 2025 och framåt ska registreras" (2024-12-18): https://www.bostadsratterna.se/nyheter/artiklar/2026/aarsredovisningar-for-2025-och-framat-ska-registreras
- Lusa, "Årsredovisning BRF: var hitta" (Oct 2026): https://lusa.se/guide/arsredovisning-brf-var-hitta
- SCB, API:et för SCB:s allmänna företagsregister: https://www.scb.se/vara-tjanster/bestall-data-och-statistik/foretagsregistret/avgiftsfria-uppgifter-i-foretagsregistret/ ; postbeskrivning JE (KommunSate, Jurform): https://www.scb.se/contentassets/8a8eb5c3d45f461ea93482f8e8d4de4f/postbeskrivning-je.pdf ; variabelbeskrivning: https://www.scb.se/contentassets/8a8eb5c3d45f461ea93482f8e8d4de4f/variabelbeskrivning-api.pdf ; OpenAPI: https://apiafr.scb.se/swagger/v1/swagger.json
