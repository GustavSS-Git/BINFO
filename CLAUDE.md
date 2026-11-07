# Binfo

Independent buyer-side decision support for Swedish bostadsrätter
(https://binfo.slanesens.com). A buyer uploads the BRF's årsredovisning and gets
a BRF analysis (the seven statutory nyckeltal, grade, red flags, questions for
the styrelse), a price check against Binfo's own valuation model, a
bolånekalkyl and a köpguide. Competitors (Lusa, AI BRF, Allabrf) grade the
_cooperative_; Binfo's point is grading the _transaction_: price,
per-apartment cost in kronor, and what to do before bidding.

**State on 2026-11-01:**

- **Production (2026-10-30 deploy):** all 11 migrations applied (`migration
list --linked`), Edge Function `PIPELINE_VERSION` `p16.i1.s1`; the web app goes
  live on the owner's Lovable publish (v2 deployed 2026-10-10, v3 2026-10-14,
  redesign v4 merged 2026-10-30). A web-app publish must
  follow an Edge deploy closely: jobs created by an older web app fail with
  `versionskonflikt` until then.
- **Booli API prefill + sales at the same address** (2026-10-31/11-01, on
  `main`): live once the owner adds the `BOOLI_*` secrets in Lovable and
  publishes. No migration, no Edge change, no `PROMPT_VERSION` bump. See
  "Listing data" below and `docs/booli.md`.
- **Features and where their specs live:**
  - Fee prognosis → price (one channel: the expected rise in månadsavgift from
    spargap, refinansiering, ofinansierat underhåll, lokalhyror, energiprojekt,
    beslutade höjningar; priced with the valuation's OLS fee coefficient; the
    grade never moves the price): `docs/avgiftsprognos.md`,
    `docs/underhall-referens.md`, `docs/DECISIONS.md`.
  - Lokal risk (100 % on a cited loss signal, 50 % for a lease ending without a
    cited renewal; at most three questions): `calc/lokalrisk.ts`, `lokalfragor.ts`.
  - Consistency rules (matured loans never priced, statuses re-graded on read,
    ±10 % span decides "i linje med modellen", one `komponentPris`): "Consistency
    audit" below.
  - Redesign v4 (web app + both PDFs): `docs/PLAN-v4-redesign.md`, "Design
    system (redesign v4)" and "Redesign v4: behaviour changes" below (they win
    over older notes in this file where they conflict).
- Plan/status: `PLAN.md` (current task plan) and `docs/PLAN-v3.md`; decisions:
  `docs/DECISIONS.md`. Public overview for readers of the repo: `README.md`.

## Stack

- Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), TanStack Start/Router (file routes), TanStack
  Query, Tailwind 4. **Not Next.js**: no app router, `/pages` or `server-only`.
- `vite.config.ts` is a thin wrapper around `@lovable.dev/vite-tanstack-config`
  (Lovable-owned). `vitest.config.ts` is deliberately separate from it.
- **Hosting:**
  - The web app (SSR + server functions) is built by Lovable for Cloudflare
    Workers (nitro `cloudflare-module`). Use web APIs only on the server path: no
    `Buffer`, no native modules.
  - The background worker is one Supabase Edge Function (Deno 2), `analys-steg`.
- **Backend:** Supabase (Postgres + pg_cron + pg_net + Storage + Vault), the
  Anthropic API via `@anthropic-ai/sdk` 0.125, Zod v3 (pinned deliberately) and
  `unpdf` (pdf.js) for PDF text.
- **Offline ML:** Python in `ml/` (pandas, LightGBM, pytest; venv at `ml/.venv`).
  The exported model JSON is evaluated in TypeScript at runtime. There is no
  Python in production.
- Node 22 (`.nvmrc`). The shell default may be Node 24, so prefix commands with
  `PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH` or run `nvm use`. The dev
  server always runs on `localhost:8080` (forced by the wrapper).

## Directory map

| Path                                            | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`                                   | File routes. `routeTree.gen.ts` is generated; never edit it. (`src/routes/README.md` is Lovable's note.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/` top level                                | `router.tsx` (fresh `QueryClient` per `getRouter()`), `start.ts` (TanStack Start middleware: error page + CSRF filter on server functions), `server.ts` (SSR entry wrapping swallowed 500s into an HTML error page; set via `tanstackStart.server.entry` in `vite.config.ts`), `styles.css` (Tailwind 4 `@theme` oklch tokens; the `.dark` block is unused shadcn default), `hooks/use-mobile.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/components/`                               | `AnalysRapport` (full report; exports `Prisrimlighet`, also used by the Priskoll on `/analysera`), `AnalysStatus` (polling, waiting, `Misslyckad`, `HittadesInte`), `PropertySummary`, `SiteNav` (+ `SiteFooter`; flat link row, no mobile menu), `pdf/` (PDF export via `@react-pdf/renderer`, lazy-loaded client-only: `download.tsx` → `AnalysPdfDocument.tsx`; `viewModel.ts` is the pure data layer; `fonts.ts`, `theme.ts` (hex palette, disclaimer), `filename.ts` are reusable for other PDFs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/components/ui/binfo.tsx`                   | Binfo UI kit (Card, Button, LinkButton, Field, Badge, Callout, TristateChoice, Tag, Toggle, PageHeader…). Other `ui/*.tsx` files are shadcn primitives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/kalkyl/`                               | Bolånekalkyl (client-safe, pure): `underlag.ts` (`KalkylUnderlag`, versioned input shared by page, saved kalkyl and exports), `regler.ts` (every rule/constant with source + date, `REGELVERSION`, Konsumentverket 2026 tables), `berakna.ts` (`beraknaKalkyl`, `sammanfattaKalkyl`), `levnadskostnader.ts` (KALP), `indata.ts` (input parsing/limits), `sida.ts` (page state ↔ underlag), `xlsx.ts` (Excel export with live formulas; exceljs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/lib/register/`                             | Public register areas: `omraden.ts` (19 areas + `ovriga-stockholm`, `losRegisteromrade`), generated `data/postnummerStadsdel.data.ts` (`npm run build:register-data`; never hand-edit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/components/konto/`, `register/`, `kalkyl/` | Account UI (`SparaKnapp`, `useSparaKalkyl`, `ProfilListor`, `AuthSida`), register UI (`RegisterLista`, `ForeningSida`), `KalkylExport` (PDF/Excel buttons). `pdf/` also has `KalkylPdfDocument` + `kalkylViewModel` + `downloadKalkyl` (lazy).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/`                                      | Client-safe helpers: `session.ts` (session hook over `hamtaSessionFn`), `utkast.ts` (logged-out Spara drafts: sessionStorage + 24 h localStorage mirror), `till.ts` (`saneraTill`: same-origin redirect targets only), `kontoTyper.ts` (account server-function types), `registerVy.ts`, `sitemap.ts`, `uppgifter.ts` (in-memory store shared across routes), `analyseraForm.ts` / `varderingForm.ts` (form parsing/validation), `senasteAnalyser.ts` (localStorage "recent analyses": per browser, not per IP or account; max 5, 12 months), `analysStatusCopy.ts` (error copy; its code union is type-checked against the server's), `analysStatusVy.ts` (status texts/notices), `analysisView.ts`, `bolanekalkyl.ts` (calculator search params), `skatt2026.ts` (2026 income tax, per-person ränteavdrag), `propertyType.ts`, `utils.ts`, `error-capture.ts` / `error-page.ts` (Swedish, `lang="sv"`, "Sidan kunde inte laddas") / `lovable-error-reporting.ts`                                                                                                                                                                                                                                                                                                                     |
| `src/lib/analysis/`                             | Pipeline: `pdf.ts` + `textlager.ts` (text layer: `ok`/`saknas`/`trasigt`), `identitet.ts` (local orgnr/year/name) + `identitetModell.ts` (Haiku on pages 1–3), `transkribering.ts` + `transkriptionsblock.ts` (scans: parallel page transcription → citable custom-content document), `runExtraction.ts` (grounding on PDF or transcription + structured extraction), `rimlighet.ts` (deterministic sanity checks → `Figure.osaker`), `analyze.ts` (judging), `prompts.ts` (+ `PROMPT_VERSION`), `schema.ts` (Zod mirror of the contract), `tolkaVarde.ts`, `benchmarks.ts`, `assemble.ts` (final `AnalysisResult`; shared price core `byggPrisanalysUtanForening`), `prisdata.ts`, `costGuard.ts` (prices per model, `STANDARD_MODELL`), `callMetrics.ts`, `korExtraktion.ts` (sequential composition for the CLIs), `extract.ts` (`extractWithRetry`: blind re-roll, no error feedback), `answerKey.ts`, `calc/` (`manadskostnad`, `amortering`, `ranteavdrag`, `rantestress`, `schabloner`, `spann`), CLIs `cli.ts` and `verifyAnswerKey.ts`                                                                                                                                                                                                                                        |
| `src/lib/vardering/`                            | **Server-only** valuation engine: TS evaluator of the exported LightGBM trees, tiering (`tackning.ts`), drivers (`drivare.ts`), `budpremie.ts`, postcode/kommun maps (`postnummer.ts`, `kommunKodning.ts`), `vardera.ts` (entry), `features.ts`, `tree.ts`, `data.ts`, `types.ts`. `data/*.data.ts` is generated by `npm run build:vardering-data`; never hand-edit it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/server/`                                   | Server-only. `analysFn.ts` is the only client-importable file (server functions; **no module-scope values** — see Gotchas). `analys.ts` (create/status/result/preview), `register.ts` (register lookup, versioning, re-runs), `steg.ts` (job state machine on `rapport`), `prisuppskattning.ts` (price_estimate service), `kontext.ts` (device cookie + hashed IP + session → principal), `auth.ts` (Supabase Auth flows: register/login/logout/verify/reset/new password/delete account), `sessionCookies.ts` (`binfo_sa`/`binfo_sr`/`binfo_aterst`), `supabaseAuth.ts` (Auth adapter), `sparat.ts` (saved valuations/kalkyler, GDPR export; one ownership helper `kravAgare`), `registerPublik.ts` (public register reads: BRF-level only), `stegLogg.ts` (stage-failure logging), `lagratInput.ts`, `principal.ts`, `behorighet.ts` (entitlement policy), `kvot.ts` (rate limits), `spend.ts`, `cache.ts` (legacy caches), `fel.ts` (error → buyer-safe Swedish), `env.ts`, `portar.ts` (`Lager`/`Databas` port), `kontoPortar.ts`, `supabase.ts` / `supabaseKonto.ts` (adapters), `__fakes__/` (`lager.ts`, `konto.ts`: in-memory fakes mirroring the SQL), `cli/` (`registerCli.ts`, `kontoCli.ts`, `analysCli.ts`, `verifyRls.ts`), `edge/build.ts` (bundles `steg.ts` for Deno) |
| `src/types/analysis.ts`                         | **The contract** for an analysis result and the price check (`PrisInput`, `PrisuppskattningResultat`), shared by client and server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/data/`                                     | `sampleAnalysis.ts` (static `AnalysisResult` on `/exempel`; see "Example analysis"), `mockData.ts` (calculator defaults, fee items, the seed of the in-memory "osäkra uppgifter" store). Cost schablons live in `src/lib/analysis/calc/schabloner.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `supabase/`                                     | `migrations/` (10; the first 8 applied in production, incl. v2 `register` + `konto` and v3 `20261013120000_konto_v3.sql` + `20261013120100_register_v3.sql`, 2026-10-14; `20261024120000_annons.sql` not yet), `rollback/` (manual down-scripts, never auto-applied), Edge Function `analys-steg/` (`index.ts` is hand-written Deno glue mirroring `supabase.ts`; it imports the esbuild bundle `_bundle/steg.js`, gitignored; also `reinvoke.ts`, `effort.ts` + their two vitest files, the only tests outside `src/`). `config.toml` references a `seed.sql` that doesn't exist (harmless). No SQL test files are committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ml/`                                           | Training (`train_valuation_v31.py` + `valuation_v31_lib.py` on top of `train_valuation_v3.py` / `valuation_v3_lib.py`, `cleaning.py`), postcode/kommun mapping (`mapping/`), artifacts (`artifacts/valuation-v3.1/` = shipped, delta card to `artifacts/valuation-v3/MODEL_CARD.md`; `valuation-v3.2/` exists only on the local branch `valuation-v3.2`, rejected), pytest suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `data/raw/`                                     | Svensk Mäklarstatistik transaction xlsx (committed, not confidential); `data/derived/` holds the mapping CSVs and price levels                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/annons/`                               | Listing prefill, client-safe: `typer.ts` (`AnnonsSvar`, `AnnonsUppgifter`, `ANNONS_FALT`, `ANNONS_MEDDELANDE`), `url.ts` (`kontrolleraAnnonsUrl`: https + `booli.se`/`www.booli.se` + `/bostad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | annons/<id>`only, canonicalised; shared by client and server),`formular.ts`(click flow, applying an answer, per-field provenance booli/manuellt/saknas,`tillAnnonsKalla`) |
| `src/server/annons/`                            | `hamta.ts` (`hamtaAnnons`: kill switch → URL check → 24 h cache → entitlement `hamta_annons` → quota → source → cache), `kallor.ts` (`AnnonsLeverantor` seam), `booliApi.ts` + `booliApiTolkning.ts` (Booli REST API, default), `booliSida.ts` (page source, behind `ANNONS_SIDHAMTNING=on`), `booli.ts` (pure page parser: RSC `Listing` object + JSON-LD, never visible HTML), `geokod.ts` (Nominatim, only when the postcode is missing), `llmFallback.ts` (Haiku, off unless `ANNONS_LLM_FALLBACK=on`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Fee prognosis (2026-10-24b)                     | `src/lib/analysis/calc/prognosantaganden.ts` (EVERY assumption: horizon, refinancing share, margin 0.58 pp, maintenance years, lokal risk, 3 % widening, 30 % guard, OLS β synced to `metadata.json` by a test, reference-rate fallback), `calc/avgiftsprognos.ts` (`beraknaAvgiftsprognos`: five components → flat kr/month via andel = fee×12 ÷ årsavgifter; two-phase refinancing; `tryckFor` colours), `calc/sparbehov.ts` (savings target: plan figures or the building-part-moved schablon; derived totalyta; partial-plan floor), `prisjustering.ts` (`byggPrisjustering`: adjusted price = baseline + β × rise × kr/m²; missing data widens only the low end), `uppgiftsjamforelse.ts` (report vs input statuses; report byggår wins at high confidence and feeds the valuation), `sammanfattning.ts` (deterministic closing summary), `calc/rantestress.ts` `byggPrognosTabell`, `referensrantaHamtning.ts` (Riksbank SWEA fetch) + `src/server/referensranta.ts` (daily cache on `KontoDatabas`, never throws), `scripts/monteraOm.ts` (free re-assembly of a saved run), `fixtures/answer-key-lan/` (loan keys, UTKAST)                                                                                                                                                     |
| `fixtures/booli/`                               | Raw Booli listing HTML (6 pages + a Cloudflare challenge page, fetched with curl 2026-10-24; prettier-ignored), recorded Nominatim responses, `booli_links.txt`. Parser tests assert every field of every page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `fixtures/answer-key/`                          | Nyckeltal per test report (`<orgnr>.json`, 13 keys, all owner-verified as of 2026-10-10; "UTKAST" in `kalla.verifieradMot` would mark a draft). Pontonjären 3 has no key. `fixtures/property-input-example.json` is a sample `PropertyInput`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `annual reports examples/`                      | 14 real test PDFs (14 BRFs; only ~4–7 in Stockholms län, the rest Malmö/Helsingborg/Umeå etc.). Gitignored; never commit. `annual reports pdf as image example/` holds the two image-only reports; `SBC 2 årsredovnisng.pdf` is a raster scan; `test_rapport.pdf` has a garbled text layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/`                                         | `PLAN-v2.md` (v2 plan, archived; current plan is `/PLAN.md`), `booli.md` (Booli page structure, blocking, earlier-sales endpoints), `api-test-log.md` (every paid API test run, running total), `api-runs/` (raw per-call records)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.lovable/`                                     | Lovable-managed (`project.json`, two stale Swedish plans from September in `plan/`). Don't touch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Routes

- `/`: landing page.
- `/analysera` (since 2026-10-23 also the Priskoll; one shared form state):
  - **Steg 1: Priskoll** — the valuation without a PDF
    (`hamtaPrisuppskattningFn`), free, rate-limited. Fields: boarea, rum,
    avgift, postnummer, våning, byggår (opt.), utgångspris (opt.), hiss, balkong.
    "Spara" (account) and re-open via `?sparad=<id>`
    (`src/components/analysera/SparadVardering.tsx`: stored snapshot + "Räkna
    om med dagens modell"); `?spara=vardering` finishes a draft after login.
  - **Booli link** (above steg 1, 2026-10-24): "Klistra in länk från Booli" +
    "Hämta uppgifter" → `hamtaAnnonsFn`. Only fills the form: found fields get
    the hint "Hämtat från Booli" ("Ändrat manuellt" after an edit; a geocoded
    postcode says OpenStreetMap), missing+empty fields get "Fanns inte i
    annonsen, fyll i själv" and `Field framhav` (warning border). hiss/balkong
    only ever become "ja". It NEVER starts the Priskoll or an analysis. The
    source goes into `PropertyInput.kalla` (URL, broker link, förening, fetch
    time, `oandradeFalt`) on both analysis paths.
  - **Postnummer help** (2026-10-25): under the postnummer field, the area
    hint from the valuation tables (`hamtaPostnummerInfoFn` →
    `src/server/postnummer.ts`, pure; texts `postnummerInfoText` and the merge
    with the Booli hint `postnummerFaltVisning` in `src/lib/postnummer/`;
    client-side only, debounced) and the link "Vet du inte postnumret? Sök hos
    PostNord" (`POSTNORD_POSTNUMMER_URL`). No address geocoding: Nominatim gave
    wrong postnummer (`docs/DECISIONS.md`).
  - **Steg 2: Granska föreningen (valfritt)** — always visible; the PDF
    dropzone (or, with `?forening=<slug>` from a `/brf/$slug` CTA, "finns
    redan hos Binfo" via `skapaAnalysFranRegisterFn`: no PDF, no API call,
    loose quota only) plus adress (no ort field since 2026-10-26); everything
    else comes from step 1.
  - Required for the analysis: boarea, våning, avgift, rum, adress,
    postnummer. Utgångspris optional (shared `valideraValfrittUtgangspris`:
    empty ok, invalid/0 = error; without it the report shows the "Binfos
    värdering" variant and the summary/PDF price rows are hidden).
  - Submits PDF + `PropertyInput` JSON as FormData to `skapaAnalysFn`.
  - On success it goes to `/forhandsvisning/$analysisId`, which polls
    `hamtaStatusFn` every 5 s (status carries `textlager`, `ateranvand`,
    `vantarPaRapport`, `rapportSteg` for the notices) and then renders the
    **full report** inline (`hamtaResultatFn` + `AnalysRapport`; the free
    preview/paywall was removed 2026-10-23; a future payment belongs on the
    `ladda_upp_analys` entitlement, before the run: `behorighet.ts`).
  - `/analys/$analysisId`: the same full report (bookmarks, /konto links);
    any error, including a refused entitlement, redirects to `/forhandsvisning`.
  - **"Spara analysen"** (2026-10-24, both report pages): `useSparaAnalys` +
    `SparaAnalysVy` (`src/components/konto/`), a small row under the grade card
    (`AnalysRapport`'s `sparaSlot`) and a card at the end. Server:
    `hamtaSparstatusFn` (`sparad` | `kan_sparas` | `ingen`),
    `forberedSparaAnalysFn`, `sparaAnalysFn` (`src/server/sparat.ts`). Same
    `SparaKnapp` flow as the Priskoll (`?spara=analys`, draft type `analys`);
    someone else's analysis shows nothing. No re-run, no API call.
- `/vardering`: 301 to `/analysera` (merged 2026-10-23), carrying `sparad`
  and `spara`.
- `/konto` (profile), `/konto/{logga-in,skapa,glomt-losenord,bekrafta,nytt-losenord}`:
  accounts (all `noindex`). `/konto/bekrafta` verifies only on a button press
  (mail scanners must not burn one-time tokens). `?till=` is sanitised.
- `/brf`, `/brf/omrade/$omrade`, `/brf/$slug`: the public register (BRF-level
  data only; cacheable; must never set cookies). `/brf/$slug` is a SUMMARY
  (owner 2026-10-23): name, fiscal year, grade, the nyckeltal that exist with
  their status, `BETYG_FORKLARING`; the server function returns nothing else
  from the analysis. Its link "Se hela analysen …" goes to
  `/brf/$slug/analys/$ar` (stored full BRF-level analysis, as stored;
  `hamtaRegisterAnalysFn`, resolves kontext, `no-store`, `noindex`), gated by
  the `se_registeranalys` entitlement (`behorighet.ts`; granted to all today —
  one policy line puts it behind an account or payment). `/sitemap.xml` is a server route.
- `/exempel`: static demo report (`AnalysRapport` over `sampleAnalysis`; the
  BRF name in the intro box is hard-coded in `src/routes/exempel.tsx`).
- `/bolanekalkyl`: calculator; all math in `src/lib/kalkyl/berakna.ts` (the
  route only renders). Search params `manadsavgift`, `rantekanslighet`, `pris`,
  `boarea`, `prisUppskattning` (read once at mount), plus `sparad`/`spara` for
  saved kalkyler. Inputs are sent to the server only on an explicit "Spara" by
  a logged-in user (owner decision 2026-10-12). PDF/Excel export buttons
  (`KalkylExport`, lazy, behind an SSR guard). Layout (owner 2026-10-14): the
  main view stays simple (pre-v3 layout + Boarea); rate scenarios, KALP (with
  its household/kalkylränta inputs) and the rules list live in one collapsed
  "Fördjupning" section (`data-slot="kalkyl-fordjupning"`), opened
  automatically when KALP inputs are non-default (`kalpArAndrad`).
  - One ränteavdrag computation (per person, limited by tax) for the total and
    "Tillbaka i deklarationen"; one home for the 50/70 % thresholds
    (`calc/amortering.ts`).
  - Drift schablons (2026-10-26, `REGELVERSION` "2026-10-26b"; `regler.ts` is
    the single source, `calc/schabloner.ts` reads it; `docs/driftschabloner-kallor.md`):
    hushållsel and hemförsäkring = Konsumentverket 2026 by persons (1–7);
    värme 21 kr/m² boarea (Nils Holgersson 2026, Stockholm, incl. varmvatten);
    vatten 135 kr per person (since 2026-10-28, `REGELVERSION` "2026-10-28":
    KV 45,61 m³/person × NH Stockholm 35,54 kr/m³); värme and vatten only when
    "Ingår ej" (default "Ingår"); bredband 349 kr and the 5× bank
    skuldkvot stay "Binfos uppskattning"/"antagande" (no published source).
    Värme and vatten exist ONLY in the kalkyl: the analysis/report never asks
    about, counts or shows them (owner 2026-10-26).
- `/om-oss`: about page (2026-11-07, from the owner's "Om oss" artboard, kept locally in `about_us/` (not in git);
  team photo `public/bilder/om-oss.jpg`). Linked from the footer only, never the main nav (owner).
- `/kopguide`: Köpguide, the buying guide (checked steps in `useState` only).
  `/guide` is a 301 redirect to it (renamed 2026-10-23); nav label "Köpguide",
  running text "köpguiden".
- **SEO:** SSR on every route. Register pages have real-figure titles and
  descriptions, canonical, og:*, JSON-LD (Organization + BreadcrumbList);
  `/sitemap.xml`; `robots.txt` has a `Sitemap:` line; `public/og.png`
  (`scripts/genereraOgBild.mjs`). `/analys`, `/forhandsvisning`, `/konto*` are
  `noindex`. 404/error pages are Swedish.

## Where UI copy lives

- **Price section additions (2026-10-24b)**: second price row "Justerat för
  väntad avgiftshöjning", the collapsed "Så har vi räknat" `<details>` (part 1
  generic factor list, also on the Priskoll; the per-flat driver % rows were
  removed there 2026-10-24 (owner: "kaka på kaka"); part 2 fee rise; part 3
  refinancing inputs), the rate slider with the "Dagens avgift"/"Förväntad avgift" tabs in `Rantestress` (texts in `rantestressVy`; the PDF keeps a table), the closing
  "Sammanfattning" — all in `AnalysRapport.tsx`
  with text helpers in `src/lib/analysisView.ts`; component texts come from
  `avgiftsprognos.ts`, summary texts from `sammanfattning.ts`. PDF mirrors it.
- **Waiting screen** (`/forhandsvisning` while running): `Pagar` in
  `src/components/AnalysStatus.tsx` (heading "Din analys pågår", the time
  paragraph with a scan-only insert when `textlager === 'saknas'`, never for
  `'trasigt'`). Step texts and notices: `src/lib/analysStatusVy.ts`
  (`RAPPORTSTEG_TEXT`, `SKANNAD_UPPTACKT_TEXT`, …) and `STEG_TEXT` in
  `src/lib/analysStatusCopy.ts` (also all error copy).
- **Price check section**: `Prisrimlighet` in `src/components/AnalysRapport.tsx`
  is shared by the full report, `/exempel` and the Priskoll on `/analysera`. The source
  paragraph ("Modellen är tränad på … Svensk Mäklarstatistik. Områdesindelningen
  bygger på …") is `varderingsKallaText` (period via `formatDataperiodLang`,
  "januari–augusti 2026"); caveat/tier texts are also in
  `src/lib/analysisView.ts`.
- **Byggår vs the report**: no separate comparison section (removed
  2026-10-24, owner); `PropertySummary` shows a badge next to Byggår
  (Bekräftat / Avviker + "Årsredovisningen: X (du angav Y)" / Osäkert / Från
  årsredovisningen) from the `uppgiftsjamforelse` row `byggar`, logic in
  `byggarMarkor` (`analysisView.ts`), mirrored as a suffix in the PDF.
- **PDF export** builds its own view model in `src/components/pdf/viewModel.ts`
  (`metadataText`: n, typical error, model version; `kallaText` = the same
  source paragraph; no driver rows since 2026-10-24). Change web copy → check the PDF too.
- Priskoll (step 1) copy lives in `src/routes/analysera.tsx`.

## Listing data: how a Booli link becomes form values (2026-10-31)

- **Path:** `/analysera` "Hämta uppgifter" → `hamtaAnnonsFn` (`analysFn.ts`) →
  `hamtaAnnons` (`src/server/annons/hamta.ts`): kill switch `ANNONS_HAMTNING` →
  `kontrolleraAnnonsUrl` (`src/lib/annons/url.ts`, `/annons/<id>` and
  `/bostad/<id>`, canonical URL = cache key) → `annons_cache` (24 h, purged after
  2 days) → no source on? (`avstangd`, no quota taken)
  → entitlement `hamta_annons` → quota → the source(s) → cache.
- **Sources** (`AnnonsLeverantor` in `kallor.ts`; answer `metod: "api" | "sida"`):
  1. **Booli REST API** (default; `booliApi.ts` + pure mapping
     `booliApiTolkning.ts`): `/annons/<id>` → `listings/{id}` → on 404 `sold/{id}`;
     `/bostad/<id>` (the link buyers actually paste, owner 2026-11-01; a residence
     id, another number space, never sent as `listings/{id}`) → `listings?residenceId`
     → `listings?residenceId&upcomingSale=1` (kommande) → `sold?residenceId` (latest
     sale; older than 365 days → no utgångspris/avgift); the answer must echo
     `searchParams.residenceId` (`hamtaBostadFranBooliApi`). Then `areas?lat&lng`
     for the postcode (listings carry none). Signed per call, Web Crypto only.
     Needs `BOOLI_CALLER_ID` +
     `BOOLI_PRIVATE_KEY`; `BOOLI_API=off` disables it. Student key, ~3 months from
     2026-10-31 (use OK'd by Booli's representative, owner). An expired key logs
     `[annons] booli-api nyckel avvisad` and the buyer fills in by hand.
  2. **Listing page** (`booliSida.ts`: page fetch + `tolkaBooli` + optional Haiku
     fallback + Nominatim): only with `ANNONS_SIDHAMTNING=on` (default off; the
     production Worker is Cloudflare-challenged there, `blockerad`). Used after an
     API key/network/parse failure or with the API off.
     Details, live findings and caveats: `docs/booli.md`; plan + field map:
     `docs/plans/booli-api.md`.
- **The answer only fills the form** (`src/lib/annons/formular.ts`): it never
  starts the Priskoll or an analysis. Fields (`ANNONS_FALT`): boarea, antalRum,
  manadsavgift, postnummer, vaning, byggar, utgangspris, hiss, balkong, adress,
  ort; context: stadsdel, forening, maklarUrl, koordinater. Hiss/balkong: the
  API's explicit `0` → "nej" (owner 2026-10-31), except on a sparse listing (≥ 2
  of rent/floor/byggår/listPrice missing: it sends `0` for every amenity), where it
  stays unknown; the page only ever gives "ja". A sold listing fills
  utgångspris with its `listPrice`, never the sold price. Provenance goes into
  `PropertyInput.kalla` (`AnnonsKalla`, `typ: "booli"`, contract unchanged) and is
  blanked by the 12-month retention. Attribution "Uppgifter från Booli" (link) on
  `/analysera`, plus a line in "Källor och metod" (web `RapportSlut.tsx`, PDF
  `buildKallor`) when `kalla.typ === "booli"` (helper `booliKallaRad`).
- **What downstream needs:** the valuation (`src/lib/vardering/features.ts`)
  uses boarea, antalRum, manadsavgift (fee/m²), postnummer (area + postcode
  effect; the most important locator), vaning, byggar, hiss, balkong; missing
  vaning/byggar/avgift are model-handled ("missing" flags). The BRF analysis
  uses none of the listing values except via the buyer's `PropertyInput`
  (fee share, fee-deviation question, debt share = boarea × skuld/m²).
- **Sålda lägenheter på <adress>** (2026-11-01, `docs/plans/salt-i-huset.md`): for a `/bostad/<id>`
  link, every flat sold at the same address in the last 10 years (`sold?residenceId` for the
  flat's own, tagged "Den här lägenheten", + a 200 m `sold?center&dim` box filtered on the exact
  address; 5 rows, then "Visa alla (n)"; PDF the 5 newest) as a table after
  "Så har vi räknat" in the report (web + PDF) and after "Vad värderingen bygger på" on
  `/analysera`. Fetched when the page opens (`hamtaForsaljningarFn` → `src/server/annons/forsaljningar.ts`;
  cached 24 h in `annons_cache` under `booli-salda:v2:<id>`, same entitlement + quota as the prefill);
  view helper `src/lib/annons/forsaljningarVy.ts`, component `rapport/TidigareForsaljningar.tsx`.
  Shown only: never a valuation input (owner). No migration.
- **Earlier sales research:** `docs/research/booli-sold.md`.
  A pull of all 2026 sold flats in Stockholms län (35 756 rows, 2026-10-31) is in
  `data/raw/booli/` (gitignored: Booli's terms for keeping the data are not in writing).
  The API's `sold` has full history from 2012 and ≈ 3.2× the sales of our
  Mäklarstatistik extract for Jan–Aug 2026 (5 000 rows was Svensk Mäklarstatistik's
  export cap, not their full data; owner 2026-10-31).

## Valuation factor rows ("drivers")

- They are **not** derived from the LightGBM model. One OLS on log(kr/m²) over
  all training sales (`ml/train_valuation.py` `fit_ols` /
  `build_driver_effects`, driver list from `train_valuation_v3.py`) →
  `ml/artifacts/valuation-v3.1/effects.json` → `npm run build:vardering-data` →
  `src/lib/vardering/data/effects.data.ts`.
- `src/lib/vardering/drivare.ts` (`drivareForInput`, called from
  `prisdata.ts`) selects per apartment: only `signifikant`, never `=okant`, never
  `EXCLUDED_EFFECT_IDS` (`build_year+10`, owner 2026-10-08; `boarea+10`,
  owner 2026-10-12 — display only, the model keeps both); hiss/balkong only when the input says `nej` and tackning
  is `stockholm` (area-specific hiss effect when significant and not
  sign-contradicting). Effects are % of kr/m², one decimal.
- `balcony=nej` is not significant (n = 10 "nej" sales in training, 45 %
  `okant`; −2.65 %, 95 % CI −14.4 to +10.7), so no balcony row is shown; the
  selection would show "Ingen balkong" automatically if a future model makes it
  significant.
- The data period is a hard-coded constant `DATA_PERIOD` in
  `ml/train_valuation.py`, parsed by `scripts/buildVarderingData.ts` into the
  manifest/general-model `dataPeriod`; the UI formats it at render time
  (`formatDataperiodLang` on web/PDF, short `formatDataperiod` in server texts).
- Areas (`omrade`) are Binfo's own (`data/derived/postnummer_omrade.csv`);
  Vasastan and Norrmalm are one area, "Vasastan-Norrmalm".

## Example analysis (`/exempel`)

- `src/data/sampleAnalysis.ts` is a pasted snapshot of real CLI output, not
  regenerated automatically. Regenerated 2026-10-26 on PROMPT_VERSION 13 (fee
  prognosis frozen at 2026-10-26, SSVX 2.068 %; input without ort, värme/vatten
  "ingår"). Grounding varies run to run: 2 of 3 runs that day missed the cited
  "Värdeåret är 1931" (p. 4). Earlier example (2026-10-12): Brf Pontonjären 3 (716420-0599), årsredovisning 2025 (PDF in
  `annual reports examples/exemple_analysis_report/`, gitignored) + the owner's
  real listing Baltzar von Platens gata 6, 112 42 (Kungsholmen: best training
  coverage, 644 sales, CV MAPE 7.6 %). Valuation v3.1.
- Check the judging text against the PDF before accepting a run: the first
  2026-10-12 run wrote "nästan 90 %" where the report says 74 % and was
  rejected. Tests in `src/components/pdf/*.test.ts*` and
  `Prisrimlighet.test.tsx` assert the sample's content and must follow it.
- To regenerate: write `{ "input": PropertyInput }` (strict, unknown keys
  rejected), then
  `EXTRACT_SPARA_UNDERLAG=underlag.json ANTHROPIC_MODEL=claude-sonnet-5-5 npm run -s extract -- <pdf> input.json > out.json`
  (the saved underlag lets `node --import tsx scripts/monteraOm.ts underlag.json`
  re-assemble for free after any assembly change)
  (`-s` keeps npm's banner out of the JSON; Anthropic key only, no Supabase),
  paste as `export const sampleAnalysis: AnalysisResult = …`, update the BRF
  name in `src/routes/exempel.tsx`, log the spend.
- The price check alone can be recomputed offline and free with
  `byggPrisanalys(input, new ModellPrisdatakalla())`.

## Data flow of a full analysis (v3, deployed; v3 changes marked)

1. **`skapaAnalysFn` → `skapaAnalys`** (`src/server/analys.ts`, Worker). In order:
   1. `losKontext` (device cookie `binfo_enhet`, HMAC'd IP) — the single place
      Supabase Auth will plug in.
   2. Entitlement `ladda_upp_analys` (`behorighet.ts`, everything granted today).
   3. Validation: Zod `PropertyInput`, SHA-256, `%PDF`, ≤ 25 MB, kill switch.
   4. `extractPdfText` → `klassificeraTextlager`: `ok` | `saknas` (≥ 50 % of
      pages without text; scan path, ≤ 60 pages) | `trasigt` (garbled; normal
      path — measured better).
   5. Daily spend cap (read-only), skipped for a free register hash hit.
   6. Upload quotas: strict 5/device and 10/IP per day (refunded on exact hash
      hits) + loose 30/device and 100/IP per day (never refunded); IP only from
      `cf-connecting-ip`; `medPrincipal` → `principal_id`.
   7. Register lookup (`register.ts`): `rapport_fil` hash hit → instant reuse;
      else local identity (Luhn orgnr + fiscal year + matching BRF name) → reuse;
      else a new `rapport` (stage `identifiering`, or `grundning` if identified).
      Quota refunded when nothing new is paid for.
   8. Upload `<hash>.pdf` (private bucket `arsredovisningar`, kept indefinitely)
      and insert the per-user `analys` row linked to the `rapport`.
2. **pg_cron `binfo-tick`** (every minute, 3 POSTs) → `analys-steg` → `korNastaSteg`
   (`steg.ts`): claims a `rapport` (`claim_next_rapport_steg`, lease, ≤ 3
   attempts/stage; falls back to legacy `analys` rows), version guard on
   `pipeline_version`, advances one stage, writes only under its lease
   (`uppdateraLeasadRapport`), and reinvokes itself on success via
   `<PROJECT_URL>/functions/v1/analys-steg`
   (`supabase/functions/analys-steg/reinvoke.ts`; `req.url` is an internal
   address that refuses connections).
3. **Stages on `rapport`** (each reserves/reconciles daily spend):
   1. `identifiering`: Haiku 4.5 reads pages 1–3 → orgnr/year/name; a register
      hit marks this rapport `ersatt` and re-points its buyers (no spend after).
   2. `transkribering` (scans only): pdf-lib 5-page chunks, transcribed in
      parallel (Sonnet 5.5, ≤ 10k output tokens/chunk, 110 s deadline, at most
      3 chunks per invocation because of the 2 s CPU limit — then reinvoke),
      persisted per page in `sidtext` and reused across rapport rows of the
      same PDF while `TRANSKRIPTION_PROMPT_VERSION` is unchanged.
      Deterministic failures are terminal; hard ceiling 15 kr per report.
   3. `grundning`: citations over the PDF (`page_location`) or over the
      transcription (custom-content `content_block_location` → page map).
   4. `extraktion`: text-only call over the grounding findings (citations and
      structured output can't be combined, hence two calls); JSON, Zod, one
      blind retry; deterministic reconciliation
      (`tolkaNyckeltal` → `harledSkuldfriaNyckeltal` → `berikaNyckeltal` →
      `kontrolleraRimlighet`); scans tagged `kalla: 'skannad'`, konfidens ≤ medel.
      **v3:** `sidreferenser.ts` verifies every cited excerpt against the page
      text (pdf.js, or `sidtext` for scans; skipped for `trasigt`): wrong page →
      corrected, not found → `osaker` + question. Unverifiable addresses are
      dropped. `slutfor.ts` is the single post-model validator. v3 also extracts
      `forening.adresser`/`fastighetsbeteckningar` (cited) and, when a rapport
      is done, writes `forening_adress kalla='rapport'`, assigns the register
      area (`losRegisteromrade`) + slug, and refreshes `register_sammanfattning`.
   - **v9 (2026-10-24b):** also per-loan `lanebok.lan` (date, rate, rörlig by
     label or reset ≤ 3 months after `balansdag`; `forfalloprofil` is derived
     from it in code), `rantekostnader`, `bostadsrattsyta`, `balansdag`,
     maintenance amounts/fund/allocation, `sparandeUttag`, `lokaler`,
     `energiprojekt`. The grounding prompt lists the seven nyckeltal FIRST: the
     longer v9 prompt otherwise sometimes skipped the whole flerårsöversikt
     (Granen, Albohem; measured 2026-10-24). The judging input omits the
     per-loan rows.
   5. `bedomning`: judging over the extraction only (never sees buyer data;
      page refs must be a subset of the extraction's pages); result stored on
      the rapport; dry assembly. The prompt gets Binfo's own "Fasta värden"
      (`fastaVarden.ts`: the allowed letters, the seven nyckeltal, loan
      maturities with amounts and shares) and must not compute numbers itself.
      `kontrolleraBedomning` (slutfor.ts) clamps the grade to the band the
      status counts allow (`tillatnaBetyg`, owner 2026-10-23: 0 svag/0 kritisk
      → A–C, 1 svag → B–C, ≥ 2 svag → C, any `kritisk` → C–E), logging every
      clamp; `sakraMotivering` (motivering.ts) checks every number in
      `betygMotivering` against the extraction (`siffrorKontroll.ts`) and, on a
      clamp or a mismatch, makes ONE small rewrite call (letter fixed, effort
      low, stage `motivering`); still wrong or failed → a deterministic
      fallback motivation. Never fails the stage. Each question
      carries `varfor` (finding + number, shown "Varför:") and optional
      `svarssignal` ("Bra svar / varningssignal").
   - BRF-level (shareable) = `rapport.extraction` + `rapport.judgement`.
     Buyer-level (assembled per read) = `input`, `prisanalys`, `rantestress`,
     missing-data questions, the fee-deviation question.
   - `PIPELINE_VERSION` = `p<PROMPT_VERSION>.i<IDENTITET_PROMPT_VERSION>.s<SCHEMA_MAJOR>`
     (production since 2026-10-14: `p7.i1.s1`; `main`: `p13.i1.s1`). v3 adds `rapport.proveniens`
     (`api` default). Each stage has pure `bygg*Request`/`tolka*Svar` (golden
     tests pin the request bodies).
4. **Reads** re-assemble on every read from the rapport's extraction/judgement +
   the buyer's `property_input`; only results that parse with the current
   schemas are served (older compatible versions exactly as stored, grade
   included, with a note). **Reads never re-run anything** (owner 2026-10-23:
   API money only on a user's request). A re-run on the current version is
   queued only by an upload (`skapaAnalys`) or a register request
   (`skapaAnalysFranRegister`) when the report exists only at an older
   version — behind the spend cap and the strict quota; once done, every
   reader of that report (same orgnr + year or same bytes) gets the new one.
   **2026-10-24b:** assembly also computes `avgiftsprognos` with TODAY's
   reference rate (passed from `hamtaResultatFn`; fallback in config), the
   adjusted price (`prisanalys.justeringar/justeradVardering`), the fee table,
   `uppgiftsjamforelse` and `sammanfattning`, and drops model text claiming
   byggår is missing when it is known. Old extractions get a degraded
   prognosis (maturity year only → 1 July).
   The valuation uses only the buyer's input; the full analysis adds the
   apartment's debt share (`skuldsättning/m² bostadsrättsyta × boarea`) as a
   comment, never applied to the valuation.
5. **Retention** (`binfo-retention`, daily; owned by `20261024120000_annons.sql`
   since 2026-10-24, before that by the konto migration): blanks
   `adress`/`postnummer`/`orgnr` and drops `kalla` in `property_input` after 12 months (owner
   decision 2026-10-10; the register, PDFs and BRF analysis are never touched) and purges
   quota rows and `annons_cache` rows after 2 days. PDFs are kept (register). Production already runs
   the 12-month anonymisation via the hotfix `20261008000000` (applied 2026-10-10).

Measured 2026-10-09 (`claude-sonnet-5-5`, effort `medium`, API time; production
adds ~10 s per stage for reinvokes):

| Report                                      | API time                                                              | Cost                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Text report                                 | 51–81 s API; 77 s upload→done on a local Supabase stack (cron + Deno) | 1.98–3.82 kr, mean 3.2 (n=8). ~120k in / ~12k out tokens; grounding ≈ 62 % (native PDF ≈ 4k tokens/page) |
| Scanned report (16–34 pages)                | 80–113 s API; 185 s upload→done locally (34 p)                        | 4.1–6.5 kr (transcription ≈ 0.105 kr/page)                                                               |
| Register hit (same file or same BRF + year) | < 1 s                                                                 | 0 kr                                                                                                     |
| Identity call (scans/ambiguous)             | ~2 s                                                                  | ~0.05 kr                                                                                                 |

Prompt caching is implemented but OFF by default (an isolated report costs
slightly more with it; see PLAN-v2 §5); `ANTHROPIC_PROMPT_CACHE=system` for bursts.
`costGuard.ts` prices: Sonnet 5/5.5 $2/$10, Haiku 4.5 $1/$5 per MTok, cache read
0.1× (Anthropic's docs say 0.05× for Sonnet 5.5: conservative), USD→SEK 9.7
(unverified placeholder). The Message Batches API (50 % off, supports PDFs,
citations and effort) is not used anywhere yet.

## Database (Supabase, see `SUPABASE.md`)

- **Base** (init migrations + retention hotfix): `analys` (job rows), `extraktion_cache` /
  `analys_cache` (PK `(pdf_hash, model, prompt_version)`), `spend_day`.
- **v2 migrations (in production):**
  - register: `forening`, `rapport` (shared, versioned job + result; partial
    unique on `(orgnr, rakenskapsar, pipeline_version)` and on
    `(pdf_hash, pipeline_version)` = the concurrency locks), `rapport_fil`,
    `sidtext`, `forening_adress`, `analys.rapport_id`, RPCs
    `claim_next_rapport_steg` etc.
  - konto: `principal`, `behorighet` (empty), `kvot` + `ta_kvot`,
    `analys.principal_id`, `radera_principal`, final `binfo-retention`.
- **v3 migrations (applied in production 2026-10-14; locally `verify-rls` 97/97):**
  - konto_v3: `sparad_vardering`, `sparad_kalkyl`, `sakerstall_konto_principal`,
    `lista_mina_analyser`, `radera_min_analys`; merge + erasure cover saved items.
  - register_v3: `rapport.proveniens`, `forening.slug/registeromrade/omrade_kalla`,
    `forening_slug` (renamed-slug history), `pg_trgm` index on `namn`,
    `register_sammanfattning` (one row per BRF, maintained by
    `uppdatera_register_sammanfattning`), `satt_forening_omrade`.
- **Reference-rate migration (2026-10-24b, in production; seen 2026-10-30):**
  `20261025120000_referensranta.sql`: `referensranta` (serie pk, datum,
  procent, hamtad; RLS on, zero policies), on `KontoDatabas`
  (`lasReferensranta`/`skrivReferensranta`). Rollback in `supabase/rollback/`.
  Without the table the read falls back to the configured rate.
- **Booli migration (2026-10-24, in production; seen 2026-10-30):**
  `20261024120000_annons.sql`: `annons_cache` (url pk, svar jsonb, hamtad; RLS
  on, zero policies) and the redefined `binfo-retention` (see Retention).
  Rollback in `supabase/rollback/`. Applied and checked on the local stack.
- **Access:** RLS on with zero policies; functions `security invoker`. The v2
  functions are execute-only for `service_role`; the init-migration functions
  were never revoked from `anon` (RLS still blocks them). The browser has no
  Supabase client; every read/write goes through server functions with the
  secret key.
- **Identity (v3):** Supabase Auth, server-side only (httpOnly `binfo_sa`/
  `binfo_sr` cookies; `losKontext` validates/refreshes and maps the auth user
  to a `typ='konto'` principal; the device's anonymous principal is merged once
  on first login; logout rotates `binfo_enhet`). Without
  `PROJECT_PUBLISHABLE_KEY`, everything behaves anonymously as before. Password
  change needs a 15-min signed reset marker (`binfo_aterst`) or the current
  password; account deletion needs the password. A logged-out analysis is
  saved to the account either by the password-login merge, or (new account
  confirmed by e-mail link, which does not merge and rotates `binfo_enhet`) by
  a 7-day HMAC-signed marker `binfo_spara` {analysisId, device principal} set
  on "Spara analysen" after a device-ownership check, then a compare-and-set
  move of that one `analys` row (`flyttaAnalys`); cleared on save/logout. Saved items are filtered by
  principal in one helper (`kravAgare`). The UUID `analysisId` is still the
  read capability for analyses. Local Auth config + Swedish templates:
  `supabase/config.toml`, `docs/epostmallar/`; hosted setup: `docs/auth-setup.md`.
- **Register location data (v3):** `forening_adress` has `kalla='rapport'`
  (from the report) and `'anvandare'` (buyer postnummer); the register area is
  decided rapport address > buyer postnummer (`register.ts`).
- **Cron jobs:** `binfo-tick`, `binfo-reaper`, `binfo-retention`,
  `binfo-keep-alive`. Vault holds `project_url` and `automations_key`.
- **Valuation coverage** (`src/lib/vardering/tackning.ts`, model v3.1, card
  `ml/artifacts/valuation-v3.1/` + `valuation-v3/`): Stockholms kommun → area model (CV MAPE
  9.6 %); rest of the län → general relationships × the kommun's 12-month
  average kr/m²; outside the län → × the national average with a disclaimer
  first. Confidence never 'hog'; outside Stockholms kommun always 'lag'.
  Training data has a monthly fee but **no BRF identity and no BRF debt**.
- **Areas** (`data/derived/postnummer_omrade.csv`, built by
  `ml/mapping/build_postnummer_omrade.py` from Stockholms stad's 117 stadsdel
  polygons via `stadsdel_omrade_crosswalk.csv` + OSM/GeoNames points): 13 areas:
  Östermalm, Vasastan-Norrmalm, Södermalm, Hägersten-Liljeholmen,
  Enskede-Skarpnäck, Bromma-Västerled, Kungsholmen, Farsta-Vantör,
  Hässelby-Vällingby, Spånga-Kista, Brännkyrka-Skärholmen, Essingen, Centrala
  Stockholm (= Gamla stan, Riddarholmen, Skeppsholmen only). They are model
  features: renaming them means retraining. 182 Stockholm postnummer have no
  area (e.g. 105xx/106xx box ranges, Kista 164xx, Sjöstad 123xx) and get the
  "Okänt" category. The OSM-derived map's ODbL share-alike status is unresolved.
- **Postcode effect (v3.1, owner decision 2026-10-10):** a postnummer is shrunk
  toward its 4-digit neighbourhood (k=5, k_group=5); a postnummer with no
  training sale takes its neighbourhood's effect (replaces the 2026-10-07
  "unseen postcodes: do nothing special"). A residual-based effect (v3.2) was
  tested and rejected (worse CV, unstable on sparse postnummer).

## Commands

```
npm install
npm run dev                 # localhost:8080
npm run build               # vite build (Cloudflare Worker output in .output/)
npm run lint                # eslint . (baseline: 0 errors, 9 react-refresh warnings, 2026-10-31)
npm run typecheck           # tsc --noEmit (covers src/ + configs only; not scripts/ or supabase/functions/)
npm test                    # vitest run (2026-10-26: 149 files, ~3180 tests, all passing)
npm run format              # prettier --write . (printWidth 100)
npm run preview | build:dev # vite preview / development-mode build
npm run extract -- <pdf> [input.json]      # pipeline standalone incl. scans (REAL spend)
npm run verify-extraction -- <dir>         # score against fixtures/answer-key (+ answer-key-lan, answer-key-underhall); spend; VERIFY_SAVE_RESULTS=<dir> keeps results + underlag; VERIFY_FROM_RESULTS=<dir> = free; VERIFY_ONLY=<orgnr,…> limits the reports
npm run analys -- <pdf> <input.json>       # LIVE Supabase job + spend
npm run register -- list|inspect|invalidate|backfill-legacy|rerun   # LIVE register admin
npm run konto -- radera|exportera <principalId>                     # LIVE GDPR erasure/export
npm run verify-rls                         # LIVE: RLS with secret vs publishable key
npm run build:edge / deploy:edge           # bundle / deploy analys-steg (deploy needs owner OK)
npm run build:vardering-data               # regenerate src/lib/vardering/data from ml artifacts
npm run build:register-data                # regenerate src/lib/register/data from data/derived/postnummer_stadsdel.csv
node --import tsx scripts/hamtaBooliFixtures.ts [--spara]   # re-fetch the Booli fixtures with curl (6 live requests), print per-field status; --spara overwrites them
node --env-file=.env.local --import tsx scripts/hamtaBooliSalda.ts [fran] [till] [areaId]   # Booli sold flats → data/raw/booli/*.csv + .jsonl (gitignored); default 2026-01-01→today, areaId 2 = Stockholms län; ≈ 1 call per 1 000 sales
node --import tsx scripts/seedLokaltRegister.ts   # LOCAL stack only: seed /brf with test BRFs (refuses non-local PROJECT_URL)
./scripts/v2-lokalt.sh [--nollstall]      # whole app on a LOCAL Supabase stack (Docker): db, cron, Edge Function, dev server; real Claude cost
cd ml && .venv/bin/pytest                  # ML tests
```

- **Sandbox:** `npx tsx` fails with EPERM on its IPC pipe inside the Claude Code
  sandbox; use `node --import tsx <file.ts>`. `.env.local` is invisible in the
  sandbox. `.env.local` sets `ANTHROPIC_MODEL=claude-sonnet-5`, which overrides
  the code default — set `ANTHROPIC_MODEL=claude-sonnet-5-5` for measurements.
- **Dev check:** after touching `analysFn.ts`, run `npm run dev` and open a page
  in a browser — import-protection errors only show there, not in `npm run build`.
- **Workerd:** `npm run build`, then `npx wrangler dev` (not a dependency;
  fetched ad hoc) with a temporary `.dev.vars` in `.output/server`, to catch
  Worker-only bundling bugs. Run it as `npx wrangler dev --config wrangler.json
--compatibility-date <a date the cached workerd supports>` from
  `.output/server` (the build stamps today's date, which a cached workerd may
  not know, and a stray `.wrangler/deploy/config.json` confuses it otherwise).
  Point `.dev.vars` at the LOCAL stack only, and delete it afterwards.
- **Booli and Node:** Booli's Cloudflare challenges Node's `fetch` (undici TLS
  fingerprint) even with browser headers, so `npm run dev` (Node) can't fetch
  listings. curl (with the header ORDER in `scripts/hamtaBooliFixtures.ts`) and
  workerd (`wrangler dev`) get the real page. Test the prefill end to end on
  the built Worker. Production (Cloudflare egress) is still unverified.
- **Migrations:** no npm script. Local: `supabase db reset --local` (used by
  `v2-lokalt.sh`). Production: `npx supabase@2.117.0 db push` (owner OK only).
- **Lockfiles:** `bun.lock` + `bunfig.toml` belong to Lovable (its bot commits
  them); `package-lock.json` is the local npm lockfile and is load-bearing:
  `edge/build.ts` pins the Deno `npm:` specifiers from it. Keep both in sync
  when adding a dependency (`npm install` locally; Lovable updates `bun.lock`).

## Environment variables (names only; values live in `.env.local`, Lovable Secrets or Supabase secrets)

- **Web app** (every server function, even the Priskoll, needs the full env):
  - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (code default `claude-sonnet-5-5`),
    `MAX_COST_PER_ANALYSIS_SEK` (default 5; the `extract` CLI uses 25 for scans).
  - `PROJECT_URL`, `PROJECT_SECRET_KEY`, `PROJECT_PUBLISHABLE_KEY`,
    `MAX_DAILY_SPEND_SEK`, `ANALYSIS_KILL_SWITCH` (`on`/off).
  - Optional `ANTHROPIC_EFFORT_GROUNDING|EXTRACTION|JUDGING` (default `medium`;
    transcription uses the grounding effort).
  - `PROJECT_SECRET_KEY` also derives the IP-hash key (`binfo-ip-v1`).
  - Optional `ANNONS_HAMTNING` (`off` = Booli prefill kill switch; default on)
    and `ANNONS_LLM_FALLBACK` (`on` = Haiku fallback when parsing fails; default
    off). Web app only.
  - Booli API (2026-10-31): `BOOLI_CALLER_ID`, `BOOLI_PRIVATE_KEY` (both needed;
    absent = API skipped), `BOOLI_API` (`off` = API off; default on),
    `ANNONS_SIDHAMTNING` (`on` = page fetch as fallback; default off). Web app
    only (Lovable Secrets); never `VITE_`.
- **Edge Function:** the same, minus `ANTHROPIC_MODEL` (the model comes from the
  job row), plus `AUTOMATIONS_KEY`. These live in **Supabase** secrets, separate
  from Lovable's: rotating `ANTHROPIC_API_KEY` means updating `.env.local`,
  Lovable Secrets AND Supabase Edge Function secrets (2026-10-13 incident:
  only two were updated, so every new analysis failed at `grundning`).
- **CLI/dev only:** `SUPABASE_ACCESS_TOKEN` (Supabase CLI only),
  `ANTHROPIC_PROMPT_CACHE` (`off`/`system`/`on`), `ANTHROPIC_EFFORT` (generic
  fallback), `ANTHROPIC_EFFORT_TRANSKRIBERING`, `PRISKALLA`
  (`modell`/`tom`/`demo`), `VERIFY_FROM_RESULTS`, `TRANSKRIPTION_CACHE`.
- **Naming:** Supabase vars are named `PROJECT_*` because Lovable and Supabase
  both refuse secret names starting with `SUPABASE_`.
- Validated in `src/server/env.ts`, and inline in `analys-steg/index.ts`.
- Never `VITE_`-prefix a secret. `env.ts` throws if one is present.

## Domain rules (current as of October 2026; trust this over training data)

- **Amortisation** (since 1 April 2026): loan-to-value only. Source: Lag
  (2026:226) om begränsning av bostadskrediter §7 (a statute; FI's FFFS 2016:16,
  2016:33 and 2020:3 ceased 2026-03-31). Verified 2026-10-12.
  - LTV > 70 % → 2 %/yr; > 50 % up to and incl. 70 % → 1 %/yr; ≤ 50 % → none.
    The percentage applies to the highest credit amount since the last
    valuation. Nyproduktion: the lender may waive it for up to 5 years for the
    first buyer (§10).
  - The skärpta amorteringskravet is abolished.
  - Bolånetak 90 % (min. 10 % deposit) at purchase (§4); 80 % for an increased
    loan (§5).
  - Skuldkvot is shown as information only and never drives the amortisation
    rate. There is no statutory income cap; banks apply their own (secondary
    sources say ~5–6×).
- **Ränteavdrag** (Skatteverket, inkomstår 2026): 30 % on interest up to SEK
  100 000 per person per year, 21 % above. The cap is per person, so the number
  of borrowers matters. From 2026, unsecured loans get no deduction (mortgages
  unaffected).
- **KALP** (v3, `src/lib/kalkyl/levnadskostnader.ts`): Konsumentverket
  "Hushållskostnader 2026" living costs; kalkylränta 7 % is an editable
  assumption (bank kalkylräntor are neither public nor regulated). No double
  counting: Konsumentverket's household costs already include hushållsel,
  vatten, internet and hemförsäkring, so only värme comes from Binfo's drift
  schablons. Verdict = sign + amount, no threshold words.
- **Rules registry** (`src/lib/kalkyl/regler.ts`) is the single source for every
  calculator rule, shown in the UI, PDF and Excel with source and date. Change a
  rule there, bump `REGELVERSION`, and the Excel parity test must still pass.
- **Seven statutory nyckeltal** (BFNAR 2023:1, from FY2023). Extraction must
  produce all seven:
  - årsavgift/m² bostadsrättsyta
  - årsavgifternas andel av rörelseintäkter
  - skuldsättning/m² totalyta
  - skuldsättning/m² bostadsrättsyta
  - sparande/m² totalyta
  - räntekänslighet
  - energikostnad/m² totalyta

  In the text reports seen so far they sit on 1–2 pages (förvaltningsberättelse
  / flerårsöversikt).

- **Räntekänslighet** (interest-bearing debt ÷ annual fee income) states how
  many percent fees rise per percentage point of rate increase. The rate stress
  uses it directly; there is no separate model.
- Lagfart/pantbrev: houses only. Board approval of membership: bostadsrätter only.
- Nyckeltal thresholds are product decisions in `BENCHMARKS.md`, mirrored in
  `benchmarks.ts`. Negative sparande is graded svag, not kritisk.
- A debt-per-m² figure with an unclear basis (e.g. "Lån per kvm bostadsyta") is
  reported as skuldsättning per m² bostadsrättsyta. A number beats none here.
- **Debt-free association:** if the report shows no interest-bearing debt, cited,
  then räntekänslighet and both skuldsättning/m² = 0 (`source: 'berakning'`),
  not "missing".
- **Apartment's debt share** (full analysis only, owner decision 2026-10-09):
  skuldsättning per m² bostadsrättsyta × boarea, shown as a comment beside the
  valuation, never subtracted from it. No andelstal, no debt in the model.
- **Missing räntekänslighet:** a genuinely missing value never fails the
  analysis. Only the rate stress is disabled (`rantekanslighetProcent: null`),
  and the gap becomes a question for the visning. The `saknar_rantekanslighet`
  error code remains only for old failed jobs.
- Never present a statistical association as causation. An effect whose sign
  contradicts the obvious direction (e.g. "no lift" raising price) is replaced
  by the broader estimate or omitted.

## Conventions

- All user-facing text is in Swedish. Code, comments, identifiers and commits are
  in English. Many older pipeline/server comments are in Swedish; match the
  surrounding file.
- **Unknown ≠ false.** Use `Tristate = 'ja' | 'nej' | 'okant'`, never
  `boolean | null`.
- **Estimates are labelled.** `source: 'schablon'` renders distinct from
  `'arsredovisning'` / `'anvandare'`. A guess must never look like a fact.
- **Every extracted figure carries its page reference.** No citation, no display.
  Page numbers must come from the API (citations), never be self-reported by
  the model. For scans the citation points into Binfo's own transcription
  (block → page map), and those figures are tagged `kalla: 'skannad'`.
- SEK as integers; areas in m² with one decimal.
- **Never invent domain numbers** (thresholds, benchmarks, schablons). Cite a
  source or mark `// TODO: unverified placeholder`.
- **Model output is untrusted.** Zod-validate everything. Handle scanned PDFs,
  missing figures and malformed responses explicitly. A silent empty analysis is
  the worst failure; a visible failure is fine.
- **`PROMPT_VERSION`** (`prompts.ts`) is part of the cache key. Bump it whenever
  any prompt text changes (`prompts.test.ts` enforces this). A bump requires
  deploying the web app and the Edge Function close together, otherwise
  in-flight jobs fail with `versionskonflikt`.
- **Tests first** for anything with a correct answer (extraction, calculators,
  valuation).
- Before claiming done, run `npm run typecheck`, `npm test` and `npm run lint`
  (and `npm run dev` for UI), and report the real output.
- Every paid API run is logged in `docs/api-test-log.md`.
- Ask when a spec or domain rule is ambiguous; don't guess.

## Gotchas

- **`analysFn.ts` must have no module-scope values.** Its handler bodies are
  stripped from the client bundle, its top level is not: a module-level
  `const x = serverThing()` keeps a server-only import in the client graph and
  `npm run dev` shows an import-denied overlay (the build still passes).
- **Edge glue duplication.** `supabase/functions/analys-steg/index.ts` mirrors
  `Env`/`Databas`/row mapping by hand (Deno has no `@/` alias). Every new
  `Databas` method used by `steg.ts` goes into `index.ts`, `supabase.ts` and
  `__fakes__/lager.ts`; a test enforces that the Edge glue has every method.
- **Worker writes are leased.** Stage results go through
  `uppdateraLeasadRapport` (only while `running` under the claimed lease), so a
  slow worker never resurrects an invalidated/reaped rapport.
- **Edge limits.** Free plan: 150 s wall clock, 2 s CPU per invocation → one
  stage per invocation; transcription runs its chunks in parallel inside one
  (measured ≤ 30 s). A cut-off invocation holds its lease for 300 s.
- **pdf.js detaches buffers.** Always pass `bytes.slice()` to `extractPdfText`.
- **`PROMPT_VERSION` is part of `pipeline_version`**; the model is not. A model
  switch keeps serving existing results; a `PROMPT_VERSION` bump marks stored
  results as older (served as stored with a note; re-run only when a user
  uploads or requests that report). Deploy the web app and the Edge Function
  together.
- **Deploy order for v2** (see SUPABASE.md): kill switch on → drain → `db push`
  (register, then konto) → `deploy:edge` → Lovable publish →
  `register -- backfill-legacy` (dry-run, then real) → kill switch off.
- **Lovable publish = production deploy of the web app.** When code on `main`
  needs a new migration or Edge Function version, apply those first (`db push`,
  `deploy:edge`), then publish; a `PROMPT_VERSION` bump needs both sides
  deployed close together.
- **Lovable formats differently.** Its editor reflows code wider than the
  repo's prettier (printWidth 100), so `npm run lint` shows prettier errors
  after a Lovable edit. Fix with `npx eslint --fix <files>` in a separate
  commit, and only when Lovable isn't editing those files.
- **Permissions (`.claude/settings.json`):** deploys (`deploy:edge`, `npx supabase@… db push|functions deploy|link`) and the live CLIs (`analys`, `register`, `konto`) are in the "ask" list (tightened 2026-10-13). The paid but local `extract`/`verify-extraction` stay allowed (budget-governed).
- **Local UI without a backend.** There is no mock mode. Every server function
  needs the server env (`PROJECT_URL` etc.); without it `/forhandsvisning/<id>`
  falls back to "hittades inte". `.env.local` points at **production**, so
  `npm run dev` with it hits the real project: never create analyses that way.
  To see the waiting screens either use `./scripts/v2-lokalt.sh` (Docker, local
  Supabase; overrides every `PROJECT_*` var with local values) or
  render `Pagar` with fake props in a test.
- **Lazy client-only libraries** (`@react-pdf`, `exceljs`): reach them only via
  a dynamic `import()` guarded by `if (import.meta.env.SSR) return;` in the
  click handler. Without the guard they land in the Worker bundle (v3 measured
  2.71 → 1.70 MB gzipped with it; Cloudflare's free-plan limit is 3 MB).
- **Cacheable public pages must not set cookies.** `/brf*` and `/sitemap.xml`
  send `Cache-Control: public, s-maxage=…`; their server functions skip
  `losKontext` on purpose. Never call a session/kontext function from their
  loaders.
- **Dev server ports.** The wrapper defaults to 8080, but `npx vite dev --port
<n>` works; parallel agents should use their own port.
- **Slow checks.** Cold `npm test`, `npm run lint` and `npm run typecheck` each
  take 1–2+ minutes; use a long timeout or run them in the background.
- **Playwright** is not a project dependency; Chromium builds are cached in
  `~/Library/Caches/ms-playwright` (pass `executablePath` to the cached
  `chromium_headless_shell-*/…/chrome-headless-shell` if a newer playwright
  package expects a build that isn't downloaded).

## Known limitations (October 2026)

- **v2 is deployed** (production register live since 2026-10-10; the docs said
  otherwise until 2026-10-13).
- **Production retention was failing** (direct `delete from storage.objects`
  refused by Storage, rolling back the anonymisation). Hotfix
  `20261008000000_retention_fix.sql` (12 months, no PDF deletion) was applied to
  production on 2026-10-10 via `main`.
- Scans over 60 pages are refused (product limit, owner decision 2026-10-10).
- PDFs, the register and BRF analyses are kept (not buyer data). Only the
  buyer's address/postnummer/orgnr are anonymised, after 12 months (owner,
  2026-10-10). The privacy text still needs a stated basis for keeping PDFs
  that name board members (public documents). Delete PDFs via the Storage API, never
  with SQL (Storage refuses direct deletes).
- Accounts are live (v3, 2026-10-14). Entitlements still grant everything.
  No MFA. Pages that need login check it client-side after hydration (SSR shows
  "Laddar…"). The public register is filled only by user uploads (bulk
  pre-population cut, owner 2026-10-13). No contact address exists for "Hittar
  du ett fel?" on BRF pages (owner to supply).
- **Recent-analyses storage is still active (open question, owner 2026-10-23).**
  The "Dina senaste analyser" box on `/analysera` is hidden by
  `VISA_SENASTE_ANALYSER = false` (`src/routes/analysera.tsx`), but `sparaAnalys`
  still writes every created/opened analysis id + BRF name to the browser's
  localStorage (`binfo:senaste-analyser`, `src/lib/senasteAnalyser.ts`). It is
  per browser, not per IP (the server links anonymous analyses to the
  `binfo_enhet` device principal; hashed IPs are only used for quotas, purged
  after 2 days). Whether to keep, replace or remove this storage is undecided.
  Account history (`/konto` → Analyser) is unaffected.
- Volontären `antalLokaler` is still missed (1 vs null), pre-existing.
- Every 5 s status poll reads `rapport` rows with `select *` (large jsonb) and
  Zod-parses the stored result; fine at today's volume.
- Legacy kept in the database: the SQL functions `slapp_rapport_steg` and
  `radera_analys` (their TS wrappers were removed 2026-11-01) and the columns
  `analys.lan_underlag`/`grundtext` (still mapped in row types, unused by the
  current pipeline).
- Docs drift: SUPABASE.md still has some pre-v2 facts (30-day retention, 80 %
  scan threshold, 12k transcription tokens); PIPELINE.md's cost paragraph is
  from September. The code wins.
- Accessibility gaps in the kit: `Toggle` has no `aria-pressed`; `Field` has
  no `autocomplete`/`name` (password managers get no hints). `Field` got
  `aria-invalid`/`aria-describedby` in v3.
- Mobile nav: `SiteNav` is a flat wrapping row (three rows at 390 px with the
  account and register links); a mobile menu is on the Lovable list.
- The xlsx export has no cached formula values (`fullCalcOnLoad`): Excel and
  Numbers compute on open (verified in Excel), but Quick Look shows empty cells.

## Product surface (read-through 2026-10-27, for the feature inventory)

Facts that are easy to get wrong when describing the product.

- **Actors:** anonymous visitor (`binfo_enhet` device cookie only), anonymous
  device principal (created on the first upload; owns its analyses), account
  principal. Accounts have no roles. **There is no admin UI**: admin means the
  CLIs (`register`, `konto`, `analys`, `verify-rls`) plus the env kill switches
  and the Supabase/Lovable dashboards. Anyone holding an analysis UUID can read
  that report (no owner check on reads).
- **Entitlements** (`behorighet.ts`): `prisuppskattning`, `ladda_upp_analys`,
  `full_rapport`, `se_registeranalys`, `hamta_annons` are checked;
  `pdf_export` is defined but checked nowhere (PDF/Excel export is
  client-side). All are granted to everyone. Only the saves need an account.
- **Quotas** (`kvot.ts`, UTC windows): upload 5/device + 10/IP per day
  (strict, refundable) and 30/100 (loose); Priskoll 60/IP per hour (saving a
  valuation also takes one); Booli 20/device + 60/IP per hour; login 10/IP +
  5/e-mail per 15 min; sign-up 5/IP per hour; reset 3/e-mail + 10/IP per hour;
  register reads 300/IP per hour (a refusal there throws in the loader and
  shows the generic route error page, not an inline message); 200 saved
  valuations and 200 saved kalkyler per account.
- **Not implemented**, though parts exist: changing e-mail (template, config
  and `/konto/bekrafta` handling, but no UI); resending the confirmation mail;
  MFA; social login. (Saved items DO have an optional name field: "Namn" on
  the Priskoll save card, "Namn på kalkylen" on `/bolanekalkyl`.)
- **Register areas ≠ valuation areas:** `/brf` browses 19 register areas +
  `ovriga-stockholm` (`src/lib/register/omraden.ts`); the valuation model has
  its own 13 areas (Database section). Different lists on purpose.
- **Web vs PDF differences:** the web report shows at most two red flags
  (`toppRodaFlaggor(…, 2)`) and hides the section when there are none; the PDF
  lists every flag, with "Inga röda flaggor identifierade." when empty. The web
  shows only questions with `ursprung === "analys"` in `Fragor`.
- **Known UI/copy defects (unfixed, 2026-10-27):** the landing mock report's
  step links point to `#foreningen`/`#priset`/`#kostnaden`, which don't exist
  (its "Tolv steg"/"4 av 12" is correct: the köpguide shows 12 of its 13 steps
  in BRF mode); the köpguide step "Medlemskap i föreningen" text
  ends "…bostadsrättslagen,vanligtvis inom några veckor. U"; the `/bolanekalkyl`
  hints for Boarea and Antal personer name the wrong schablon drivers; the
  waiting screen says "3–5 minuter" (measured 1–3); the progress bar counts a
  transkribering step for `trasigt` PDFs that the pipeline skips;
  `BekraftaDialog` says "Tar bort…" for every delete; a wrong current password
  shows "Fel e-postadress eller lösenord."; the `scanned_pdf` copy still says
  to find a digital original; "kontakta oss" appears with no contact address.
- **SEO details:** `/sitemap.xml` omits `/integritet`; `/brf` (index) has no
  JSON-LD; `/exempel` has no nav/footer link (only from the landing page and
  `/analysera`).
- **Privacy page drift** (`/integritet`, last changed 2026-10-14): doesn't
  mention the `binfo_spara` (7 days) and `binfo_aterst` (15 min) cookies, the
  Booli prefill (listing URL in `property_input.kalla`, `annons_cache`,
  Nominatim), or the e-mail hashes used as quota keys.
- **E-mail templates** (`docs/epostmallar/`): signup, recovery, email_change;
  plain inline-styled Arial with no logo, links to `/konto/bekrafta`.

## Consistency audit (2026-10-26; how numbers and texts are produced)

Read before changing any report number or text; several sources can say the
same thing in different ways. Written BEFORE the consistency round fixed most
of it; each bullet ends with what holds now (→).

- **Model text vs Binfo's calculations.** `rodaFlaggor`, `betygMotivering`
  and the model's questions are written ONCE at judging (BRF-level, stored,
  date-independent) from `fastaVarden.ts` (loan maturities per YEAR, no
  "today"). Nothing ties them to the buyer-level fee prognosis. The only
  per-read, date-aware place is `assemble.ts` (`beraknaAvgiftsprognos({idag})`,
  deterministic questions, then `byggSammanfattning` last). `betygText` in
  `sammanfattning.ts` copies the first high/first flag title.
- **Refinancing** (`calc/avgiftsprognos.ts`): loans with `dag <= horisontSlut`
  are priced; matured loans (`dag <= idag`) are dropped only when the report is
  stale (> 18 months, commit 67e2e25). `RefinansieringsLan.fas` is
  `"inom_horisont" | "senare"` (contract). Table: `lanRader`
  (`analysisView.ts`) → `RefiSteg` (`AnalysRapport.tsx`), PDF `viewModel.ts`.
  → matured = `fas: "forfallit"`, shown, never priced; the flag/summary sentence
  come from `refinansieringsflagga.ts` over the same component.
- **Statuses are stored, not re-graded.** `berikaNyckeltal` runs at extraction
  (`slutfor.ts` `avstamExtraktion`); reads, the register summary and
  `/brf/$slug` use the stored status. → re-graded on read in `assemble.ts` and
  `registerPublik.ts` (`omgraderaNyckeltal`); stored grades untouched. Band values are not in any prompt, but
  `BENCHMARKS[id].kommentar` is (`FORBEHALL` in `prompts.ts`), so changing a
  kommentar or the informativ list forces a `PROMPT_VERSION` bump. Grade bands
  (`tillatnaBetyg`) count only svag/kritisk.
- **Sparande:** status band (benchmarks.ts) and the prognosis target
  (`sparbehov.ts`: 300 kr/m² schablon moved 250–350 by building-part ages, or
  the plan's own figure; gap counted 50 %, on TOTALYTA) are separate numbers.
- **The seventh nyckeltal** (årsavgifternas andel av rörelseintäkter) is
  `riktning: "informativ"` → always status `okant`, and hidden in the report and
  PDF by `visasIHuvudanalys(id) && status !== "okant"` (`AnalysRapport.tsx`,
  `pdf/viewModel.ts`). The register page shows it unrated.
- **Valuation display:** every figure goes through `formatVarde`/`kr()`
  (`analysisView.ts`) to the krona; only `sammanfattning.ts` `caPris` rounds
  (10 000). The 90 % interval (`vardera.ts`, `targetCoveragePercent`) is
  asymmetric (≈ −15/+17 %); its row is owner-hidden. Two comparisons exist:
  `avvikelseMotVardering` (baseline; used in `byggModellSlutsats`,
  `assemble.ts`) and `avvikelseMotJusteradVardering` (`prisjustering.ts`). The
  summary's bid-premium sentence uses ±3 % (`I_LINJE_PROCENT`), not the interval.
  Kalkyl prefill (`bolanekalkylPris`) passes the unrounded BASELINE. → one
  rounding rule `avrundaVardering`, span `vardespann` (±10 % of the exact shown
  value), `lageMotVardespann`; prefill = shown value.
- **Component price effects:** the card (`komponentPris`) uses the ROUNDED
  `krPerKrManad` × component kr/mån; the waterfall (`vattenfall`) adds the
  rounding remainder to the largest step, so the two differ by the remainder.
  The flat's share of a förening cost is the FEE share (`manadsavgift × 12 ÷
årsavgifter`, `raknaAndel`), not boarea ÷ yta; the texts don't say so. →
  `komponentPris` (exact factor `belopp ÷ −total`, remainder once) feeds card,
  waterfall and PDF; every component text states its basis and the share.
- **Byggår:** extraction falls back to värdeår when no byggår exists (prompts
  say so); `forening.byggar` carries no värdeår flag (only the excerpt).
  `uppgiftsjamforelse.ts` marks ±1 year as `bekraftat`; at high confidence the
  report year beats the buyer's. → buyer's year always used; `bekraftat`/`osakert`
  never produced; badge "Värdeår enligt årsredovisningen" from the excerpt;
  Fasta värden mark "Värdeår (INTE byggår)"; model flags claiming byggår is
  missing are dropped/stripped on read when it is known.
- **Ort** is required in `PropertyInput` (contract + `schema.ts`), shown as
  "adress, ort", and used by the Booli/Nominatim geocoder. Postnummer maps to a
  KOMMUN (`kommunForPostnummer`/`kommunNamn`), not a postort.
- **User-visible rule notes:** `regler.ts` `anmarkning` is printed on
  `/bolanekalkyl` ("Regler och antaganden") and in Excel; the driftschablon
  note and the skuldkvot note contained "TODO: unverified placeholder", the
  kalkylränta note "ägarbeslut".
- **Models:** one model per job (`rad.model`; CLIs read `ANTHROPIC_MODEL`), so
  a per-stage model mix needs code. Haiku 4.5 has no `effort` (the pipeline
  sends it), 200K context, 100-page PDF limit, and was rejected for
  transcription on 2026-10-09 (wrong page markers). Claude Haiku 5.5
  (`claude-haiku-5-5`) has effort, 1M context, $0.10/$0.50 per MTok up to
  100K prompt tokens and $0.50/$2.50 above; measured 2026-10-26
  (`docs/haiku-matning-2026-10-26.md`): cheaper (≈ 0,34 kr/report) but less
  accurate and overruns the 16k extraction cap → Sonnet 5.5 stays. CLI-only
  knobs: `ANTHROPIC_MODEL_BEDOMNING`, `ANTHROPIC_MAX_TOKENS_EXTRACTION`.

## Workstreams

v3 (accounts, register, calculator, exports, pipeline v7): `docs/PLAN-v3.md`.
v2 (all done, see `docs/PLAN-v2.md`):

1. **Scanned reports — done** (code). Transcription → citable grounding,
   sanity checks, scan notice and "osäker" markers in the UI.
2. **Separate price estimate — done.** `/vardering` + `price_estimate` service;
   full analysis adds the debt-share comment line (owner decision: no debt in
   the model, no andelstal).
3. **Register — done.** orgnr + fiscal year,
   hash pre-check, cheap identity stage, versioned re-runs (on user request only since 2026-10-23), admin CLI.
4. **Account-ready infrastructure — done.** Device principal, entitlement
   layer, quotas, GDPR CLI (Supabase Auth added in v3).
5. **Prompt caching — measured; off by default** (no net saving per isolated
   report; the register removes repeat cost).

## Visual boundary

Do NOT change visual design unless the owner explicitly asks. That covers
styling, layout, colours, typography, spacing, animations, images, and the
components in `@/components/ui/binfo`. **Exception, 2026-10-28:** the owner asked
for the v4 redesign; on branch `redesign-v4` the visual design is changed to
match the canvas (`docs/PLAN-v4-redesign.md`), for the files each brief names.
Outside that work the boundary holds: new UI is built from the kit and tokens
below, and anything that still needs polish goes on a "For Lovable to polish"
list reported at the end. The PDF export layout is ours to design, kept simple
and consistent with the site.

Owner-hidden elements are kept in the DOM with `hidden`: the valuation
provider line (`AnalysRapport.tsx`, web only; the PDF still prints it), the
apartment's debt-share row in the price section (`RapportPris.tsx`, web only,
owner via Lovable 2026-11-03; the PDF still prints it), the Hus/Bostadsrätt toggle on `/kopguide`, and the "Dina senaste analyser" box
(`VISA_SENASTE_ANALYSER = false`, not rendered at all). The old 90 % valuation
range row is gone, replaced by the visible "Ungefärligt spann (±10 %)" line
(consistency round). The drivers caveat went with the driver rows (2026-10-24).
Do not unhide them.

## Design system (redesign v4)

Source of truth: the "BINFO REDESIGN" canvas
(https://claude.ai/code/artifact/914d592f-7ae8-45ef-8234-fc3390006acd, files
`project/v4/*.dc.html`). Only its 13 artboards count; ignore other files.
Artboards hold example data (Brf Pontonjären 3) and placeholders
(`[din e-post]`, `[DATUM]`): every value on a page comes from real data.

- **Tokens** live in `src/styles.css` (`:root` + `@theme inline`, oklch with
  the hex in a comment). Never hard-code a hex in a component; add a token.
  Palette: navy `#0A2F5E` (primary, headings, logo), link `#1C4FA3`, ink
  `#111418`, text-2 `#30363D`, muted `#4B535C`, page `#F4F6F9`, card `#FFFFFF`,
  border `#DCE1E8`, divider `#EEF1F5`, input `#B9C2CE`, tint `#E8EEF8`, track
  `#E9EDF2`, success `#1E7A4D`/`#E6F4EA`/`#1E6B3A`, warning pill
  `#FFEDD5`/`#9A3412`, notice box `#FFF7E6`/`#F3D9A4`/`#5C3800`, danger
  `#B42318`/`#FDECEA`/`#991B1B`.
- **Grades A–E are coloured** (owner 2026-10-28, replaces the neutral badge):
  A `#14532D`, B `#1E7A4D`, C `#B45309`, D `#B42318`, E `#8A1C12`, white letter,
  serif. One component (`GradeBadge`, plus `GradeScale` for the 5-step bar) for
  every place a grade shows. The 7th nyckeltal is never graded ("Ingen
  bedömning").
- **Type:** Source Serif 4 (600) for h1/h2, key figures and the logo; Inter
  (400/500/600) for everything else. Eyebrows: Inter 13 px, 600, uppercase,
  0.08em, link colour. Body 16 px, line-height 1.5.
- **Shape and spacing:** cards 10 px radius, 1 px border, white; inputs and
  buttons 6 px radius, min-height 48 px (44 px secondary); pills 999 px; grade
  badges 8 px. Container max 1200 px, 32 px gutter (16 px under 640 px).
- **Focus:** visible 2 px link-colour outline with 2 px offset on every
  interactive element (the canvas draws none; this is ours). Contrast ≥ 4.5:1.
- **Logo:** house outline (navy) with a green check mark + "Binfo" in Source
  Serif 4 (`Logo` in the kit).
- **Value names:** "Liknande lägenheter" = the unadjusted model value
  (`externVardering`); "Binfos värdering" = the value adjusted for the
  förening's economy (`justeradVardering`, falls back to the baseline); span
  ±10 % of the shown value.
- **Copy:** never say anything is free ("gratis") or optional ("valfritt");
  describe what the user gets. Copy that states a fact about data handling must
  match `/integritet`.
- **Contact:** `KONTAKT_EPOST` (`src/lib/kontakt.ts`) drives the footer
  "Kontakt" link and "Hittar du ett fel?" links; while it is `null` they are
  hidden.

## Redesign v4: behaviour changes (2026-10-29; wins over older notes above)

- **/analysera:** Adress moved into step 1; Adress and Byggår are required for
  the Priskoll and the analysis (client-side only; server schemas keep them
  optional so old saved valuations still open). Priskoll result is
  `components/analysera/PriskollResultat.tsx` (built by `lib/priskollVy.ts`);
  `Prisrimlighet` survives only as `components/rapport/Prisrimlighet.tsx`
  (re-exported, no longer used by pages). A nameless saved valuation gets the
  address as label; valuation drafts carry `form.adress`.
- **Waiting screen:** six design steps mapped from the pipeline stage
  (`designSteg`/`designAndel` in `analysStatusVy.ts`): identifiering/
  transkribering/grundning → 1, extraktion → 2, bedomning → 3; steps 4–6 run at
  read time and are never shown "Klart". `AnalysStatusSvar` gained `adress`,
  `foreningNamn`, `utgangspris`, `liknande` (unadjusted valuation via
  `server/vantskarmVardering.ts`), set only while queued/running.
- **Report (K1):** `AnalysRapport.tsx` + `components/rapport/*` (sections
  Föreningen / Priset / Avgiften framåt / Inför visningen, Källor och metod).
  The closing "Sammanfattning" is no longer rendered (web or PDF; data kept).
  "I avgiften" shows all five items incl. värme and vatten (owner 2026-10-28,
  reverses 2026-10-26). Grade titles: `lib/betygVy.ts`. Price helpers:
  `lib/prisVy.ts` (`vanligtBud` = utgångspris × (1 + median bid premium),
  mkr formatting); "på/i" for valuation areas: `lib/omradeText.ts`. The kalkyl
  link sends `ingar`/`ingarEj` and, from real reports only, `analys=<id>`.
- **Bolånekalkyl:** `KalkylUnderlag` v2 = `pris` + `kontantinsats` (lån =
  pris − insats; v1 rows/drafts migrate, `okant` → `nej`); fee items are two
  states (ingår / ingår ej), no range anywhere; vatten 135 kr per person
  (`REGELVERSION` "2026-10-28"); rules table types Regel / Referensvärde /
  Antagande / Uppskattning.
- **Köpguide:** steps in `lib/kopguide/steg.ts`, progress persisted
  (`useKopguide`: localStorage `binfo:kopguide:v1` logged out, table
  `kopguide_framsteg` logged in, merged once per browser and account);
  /konto shows "X av 12 steg klara. Nästa: …".
- **Register:** coloured grades; per-area preposition in `omraden.ts`; the
  förening page shows the stored `betygMotivering` of the latest year
  (`RegisterArsSammanfattning.betygMotivering`, owner 2026-10-28).
- **Account:** wrong current password → "Fel nuvarande lösenord.", wrong
  delete password → "Fel lösenord."; dialog busy text per action; logout and
  deletion land on "/"; no leaked-password claims (Supabase free plan).
- **PDF:** Inter + Source Serif 4 (self-hosted TTF + OFL in `public/fonts`;
  the old IBM Plex/Libre Baskerville files stay for `scripts/genereraOgBild.mjs`).
- **Savings gap (owner 2026-10-29, PROMPT_VERSION 14 → `p14.i1.s1`):** the
  sparande is the average of up to four years (`forening.sparandeHistorik` +
  the key figure); a positive gap splits into a deficit part (below zero, paid
  by the fee) and a borrowable part, borrowed while debt per m² stays under
  `SKULDTAK_KR_PER_M2` = 5 000 (BENCHMARKS acceptabel/svag), so only interest
  reaches the fee within the horizon (`Sparbehov.finansiering`); unknown debt →
  nothing borrowed. Cash flow is deliberately not a price input. Page refs
  tolerate private-use ligature gaps (Nabo PDFs). "Så har vi räknat" (price)
  holds only the valuation model + span. Needs web app + `deploy:edge` together.
- **Building parts from year-column tables (2026-10-30, PROMPT_VERSION 15 →
  `p15.i1.s1`, superseded by p16):** in Nabo/SBC "utfört underhåll" tables the
  years sit in their own column, so a citation (pdf.js text order: all actions,
  then all years) never holds a row's year. With citations on, text the model
  writes before a quote arrives as its own UNCITED block, which
  `extractGroundingFindings` used to drop: the year was lost before the
  extraction (Ingemar 8: 0/4 parts in two runs). Now `foregaendeRad`
  (prompts.ts, also used by `transkriptionsblock.ts`) prefixes each finding's
  Sammanhang with the last line of the preceding uncited block ("- 1986: ");
  grounding writes the row's year before each quote, one row per quote;
  extraction takes the year from the quote or Sammanhang, never from a
  neighbouring row, keeps one item per byggdel AND year, counts status lines
  ("Tak: Omlagt 1986"), and maps utbytta elstigar → `el`. Loans were already
  stable (79/79 key fields in all 8 baseline runs). Measurement and stage
  evidence: PLAN.md "Stable building parts". `VERIFY_SAVE_RESULTS` also writes
  `<pdf>.underlag.json` (grounding text + raw extraction JSON before
  slutfor.ts). Draft keys: 10 in `fixtures/answer-key-lan/`, 9 in
  `fixtures/answer-key-underhall/` (all UTKAST).
- **Replacement vs life extension (owner 2026-10-30, PROMPT_VERSION 16 →
  `p16.i1.s1`, Edge deployed 2026-10-30; Ingemar 8 building parts vary run to run,
  3/7–6/7, PLAN.md):**
  `genomfordaAtgarder[].omfattning` "byte" | "forlangning" (absent = byte);
  an extension (relining 30 years, roof/window/facade/el 10,
  `BYGGDEL_FORLANGNING_AR`, `docs/underhall-referens.md` §1c) only delays
  "eftersatt" and is shown in "Husets byggdelar" with its year; ventilation
  and hiss count every action as a replacement.
- **Contact:** `KONTAKT_EPOST` = contactbinfohere@gmail.com (footer "Kontakt",
  report/BRF "Hittar du ett fel?", failure screens).
- Fixed known defects: landing anchor links, köpguide "Medlemskap" text,
  kalkyl hints, "3–5 minuter", `trasigt` progress mis-count, "Tar bort…" in
  every dialog, wrong-current-password copy, stale `scanned_pdf` copy,
  "kontakta oss" without an address, privacy-page drift.

## Lovable sync workflow

The frontend is also edited in Lovable, which pushes to `main` on GitHub.

- `git pull` before starting work; push when done.
- Never edit the same files in Lovable and Claude Code at the same time.
- Don't rename, move or restructure frontend files beyond what a task needs.
- Never rewrite pushed history (no force push, no amend or rebase of pushed
  commits).
- Publishing in Lovable is a manual UI step by the owner.

## Working model (supervisor + subagents)

- **The main session is supervisor.** It owns plan, order, decisions,
  integration, commits and checkpoints. The working plan lives in
  `PLAN.md` (status) and `.claude/working-plan.md` (gitignored notes).
  Keep both updated so they survive compaction.
- **Subagents** (definitions in `.claude/agents/`: `codebase-explorer`,
  `data-and-model`, `frontend-state`, `pdf-pipeline`, `reviewer`; run on Sonnet) get
  self-contained briefs. They:
  - never edit overlapping files concurrently;
  - never commit;
  - never run `git stash`/`checkout`/`reset` on the shared tree;
  - never change shared contracts (report back instead);
  - stop rather than guess.
- The supervisor reviews every diff and re-runs the checks before accepting it.
- **Deploys** (`supabase db push`, `deploy:edge`) and pushes to `main` need the
  owner's explicit OK.

## Don't touch

- `AGENTS.md` and `.lovable/` (Lovable-managed); `src/routeTree.gen.ts`.
- Applied migrations in `supabase/migrations/`. Add a new migration instead.
- `.env*` files and lockfiles by hand. Never commit secrets.
- **The server boundary.** `src/server/` and `src/lib/vardering` are
  client-forbidden, via `importProtection` in `vite.config.ts` and
  `no-restricted-imports` in `eslint.config.js`. Both carve out
  `src/server/analysFn.ts` and nothing else; never widen either. Nothing outside
  `src/server/` imports from it except through `analysFn.ts`.
- **`src/types/analysis.ts`.** Changing it breaks both sides at once, so stop and
  flag before editing. Never widen `Forhandsvisning`.

## Reference docs

- `SUPABASE.md`: schema, job orchestration, live verification. Partly stale on
  retention and bundling.
- `PIPELINE.md`: pipeline design rationale.
- `BENCHMARKS.md`: nyckeltal thresholds.
- `ml/artifacts/valuation-v3.1/MODEL_CARD.md` (delta) + `ml/artifacts/valuation-v3/MODEL_CARD.md`: valuation model.
- `ml/REGIONAL_DESIGN.md`: regional design.

When a reference doc and the code disagree, the code wins. Fix the doc.
