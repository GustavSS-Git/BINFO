# Decisions log (v3)

One line each: date — decision — rationale. Owner decisions are marked (owner).

## Phase 1 (owner accepted all recommended defaults, 2026-10-12)

- 2026-10-12 — Plan file is `docs/PLAN-v3.md` (owner) — `PLAN-v2.md` is the archived earlier v2.
- 2026-10-12 — Work on branch `v3`, worktrees per workstream; merge to `main` when green; push and any production change only with owner OK (owner).
- 2026-10-12 — Separate commit runs `eslint --fix` on Lovable-edited files; tighten `.claude/settings.json` ask-rules for deploy and paid CLIs (owner).
- 2026-10-12 — New pages use only the existing `binfo` kit and tokens; polish items go to Lovable (owner).
- 2026-10-12 — Auth: Supabase Auth, server-side only via httpOnly cookies; email+password, verification, reset; no MFA now (owner). Implemented in code rather than via Lovable's auth setup, to keep "no browser Supabase client" and one Supabase project.
- 2026-10-12 — Email: Resend SMTP, `noreply@binfo.slanesens.com`; owner creates the account and DNS (owner).
- 2026-10-12 — Everything works logged out; only "Spara" needs an account (owner).
- 2026-10-12 — Saved to an account: analyses uploaded while logged in; the current device's anonymous analyses on first login; valuations/kalkyler only on explicit Spara (owner).
- 2026-10-12 — Storing loan/income server-side on explicit Spara is accepted, a reversal of the earlier no-persistence stance (owner).
- 2026-10-12 — Reports are never deleted from the register; "Ta bort från min lista" deletes only the user's `analys` link and apartment data; valuations/kalkyler deletable (owner).
- 2026-10-12 — Profile has "Radera konto" and "Ladda ner mina uppgifter" (GDPR) (owner).
- 2026-10-12 — Logged-out Spara keeps the draft in sessionStorage (+ localStorage 24 h for the email-link tab), never in the URL (owner).
- 2026-10-12 — Saved valuation = full result snapshot + "Räkna om med dagens modell" (owner).
- 2026-10-12 — Public BRF page shows the BRF-level analysis (nyckeltal, grade, flags, questions, earlier years), never buyer data (owner).
- 2026-10-12 — Listed publicly: register BRFs in Stockholms kommun; others stay unlisted (owner).
- 2026-10-12 — Register area taxonomy is a display layer (~19 areas) built from Stockholms stad's 117 stadsdel polygons; the valuation model's 13 areas are unchanged (owner).
- 2026-10-12 — Extract the BRF's addresses + fastighetsbeteckning (cited); contract change, `PROMPT_VERSION` 6 → 7 (owner).
- 2026-10-12 — URLs `/brf`, `/brf/omrade/<omrade>`, `/brf/<namn-slug>-<orgnr>`; sitemap, canonical, JSON-LD, noindex on private pages (owner).
- 2026-10-12 — Bulk processor = Message Batches API only; the subscription route is ruled out (Consumer Terms, no Citations API); handoff format stays generic (owner).
- 2026-10-12 — PDF sources: start with the 14 available reports; owner adds a folder of more reports soon; Bolagsverket API investigated as a spike (owner).
- 2026-10-12 — Pilot 50 reports, then up to 300 after review (owner). Pilot starts with the available reports until the owner's folder arrives (owner).
- 2026-10-12 — 10-report production-vs-batch diff + deterministic page-reference verifier (also in production) (owner).
- 2026-10-12 — Calculator: add Konsumentverket 2026 living costs + 7 % editable kalkylränta (KALP), in UI and exports (owner).
- 2026-10-12 — One per-person, tax-limited ränteavdrag computation everywhere (owner).
- 2026-10-12 — Excel: live formulas incl. 2026 income tax; Rules sheet with source/date; `exceljs` client-side (owner).
- 2026-10-12 — Drift schablons labelled "Schablon (uppskattning)" in exports; sourcing them is a follow-up (owner).
- 2026-10-12 — Budget: USD 30 for development/testing/pilot; USD 60 for full pre-population after pilot approval (owner).
- 2026-10-12 — Cut order if needed: Bolagsverket fetching → KALP in UI (kept in exports) → year-history polish (owner).

## Execution

- 2026-10-12 — Owner published `main` in Lovable before the planned v2 deploy. Production Priskoll verified working (quota RPC exists → konto migration is applied in production; docs said pending). Register tables and v2 Edge worker unverified; a production test upload needs owner OK.
- 2026-10-13 — Production check (owner-approved test upload, Pontonjären 3): v2 IS deployed in production (register live; Brf Laxöringen 1 analysed OK on 2026-10-10 for 3.46 kr). But both Pontonjären uploads (2026-10-12 15:34 and 2026-10-13 11:05 UTC) failed at stage `grundning` after 3 fast attempts, 0 kr, errorCode `unknown`. Local API key works. Root cause (2026-10-13, FIXED same day — production upload verified OK): the Anthropic key expired; the owner updated `.env.local` and Lovable secrets but not the Supabase Edge Function secret `ANTHROPIC_API_KEY`, which the worker uses. Fix: set it in Supabase → Edge Functions → Secrets. Follow-up in W3: the worker must log the underlying error (Edge logs showed only boot/shutdown).
- 2026-10-13 — Bolagsverket fetching cut from v3 (first item in the agreed cut order): no free source for BRF årsredovisningar (paper-filed, not in the free iXBRL API); the paid Dokument API (~25 000 kr incl. moms for ~300 reports, BRF coverage unconfirmed) is an owner business decision. The bulk tool takes a folder + CSV. Free Stockholm BRF list via SCB API (juridisk form 53, KommunSate 0180) noted for later. See docs/bolagsverket.md.
- 2026-10-13 — Bulk pre-population cut (owner): the register fills only from user uploads for now. Dropped from v3: W8 bulk tool, the pilot, the production-vs-batch diff, and W3's build/parse split for batching. Kept: page-reference verifier in production, address extraction, register tables/pages. The cost comparison (§3.1) stays in the plan as the record for a later decision.
- 2026-10-13 — Register groups follow Stockholms stad's stadsområden: Innerstaden, Söderort, Västerort (no "Norr"; Kista & Järva and Hässelby-Vällingby are Västerort). Riddarholmen → Gamla stan (not in Basområdeslistan; sv.wikipedia); Hammarbyhöjden stays Skarpnäck (Blåsut boundary flagged); Beckomberga → Bromma (the plan's guess was wrong).
- 2026-10-13 — A BRF's area: highest-priority source with a resolvable postnummer decides (rapport address > import > buyer), majority within it; ties/weak evidence flagged `osakert`. Postnummer without a stadsdel → "Övriga Stockholm" (152) or unlisted.
- 2026-10-13 — ODbL: we publish only an area name per BRF (produced work). Note `data/derived/postnummer_stadsdel.csv` is OSM-derived and committed; if the repo becomes public that is publishing the derived DB → owner to decide (flagged).
- 2026-10-13 — Repo is private; owner wants it public later. Pre-public checklist: (1) release OSM-derived `data/derived/postnummer_stadsdel.csv` (and other OSM-derived mapping files) under ODbL with attribution, (2) confirm Svensk Mäklarstatistik permits redistributing `data/raw/*.xlsx` (else remove from history), (3) scan git history for secrets, (4) review `annual reports examples/` stays gitignored.
- 2026-10-13 — W3's per-stage build/parse split kept although batching was cut: finished, golden-tested byte-identical, and it makes the pipeline easier to test.
- 2026-10-13 — PROMPT_VERSION 7 accepted: the Albohem grounding flake seen with earlier wordings did not recur on the shipped wording (6/6 clean runs, 24/24 fields each). Unverifiable addresses are dropped (they drive public area placement), never shown.
- 2026-10-13 — Logout rotates the device cookie so anonymous uploads on a shared device after logout don't land in the account.
- 2026-10-13 — KALP avoids double counting: Konsumentverket's household costs already include hushållsel, vatten, internet/mobil and hemförsäkring, so only värme is taken from Binfo's drift schablons; el/vatten are removed from the Konsumentverket total when the fee covers them; unknown counts (cautious). Verdict = sign + amount only.
- 2026-10-13 — KALP children 0–3 use Konsumentverket's dearer "0 år" column; adults counted as 25–50; households above 7 persons → KALP not computed (no extrapolation).
- 2026-10-13 — Calculator no longer reads boarea/antalPersoner from the shared uppgifter store (it can't tell a typed value from the legacy 58 m² default); boarea is a field on the page.
- 2026-10-13 — Ränteavdrag in the calculator is floored to whole kronor (IL 67 kap 1 §); the amortisation badge uses the exact LTV (70.04 % → 2 %).
- 2026-10-13 — M3 kept by design: the page-reference verifier corrects a page only when the exact excerpt (≥ 12 canonical chars) is absent from the cited page and present on exactly one other page; measured 457/457 ok, 0 corrections on the 13 answer-key reports.
- 2026-10-13 — L3 documented as a known limitation: if a session expires without a logout, a later anonymous upload on that device is attributed to the account it was merged into (the device id is only rotated on logout and on email-link login).
- 2026-10-14 — Bolånekalkyl layout (owner): the main view returns to the simple pre-v3 layout for non-financial users; rate scenarios, KALP (with its household/kalkylränta inputs) and the rules list move into one collapsed, visually separated 'Fördjupning' section. Spara and exports stay visible.
- 2026-10-14 — Privacy page (owner): accounts stay on; controller shown as "Binfo (binfo.slanesens.com)" without a personal name and without a contact email while Binfo is an innovation-course project. Owner informed that GDPR art. 13 expects the controller's identity and contact details; to be completed (company name + contact address) before public launch/marketing. "Binfo.com" not used: not the owner's domain.

## Booli prefill (2026-10-24)

- 2026-10-24 — Booli is behind Cloudflare bot management (curl/Node default → challenge; browser-like headers from curl and local workerd → real page). Build the server fetch anyway with a normal browser header set, one request, no challenge solving, behind the `ANNONS_HAMTNING` kill switch; verify from the deployed Worker before announcing (owner).
- 2026-10-24 — Earlier sales at the same address are only in Booli's internal GraphQL (persisted queries, challenged for servers): left out this round, documented in `docs/booli.md` for round 3 (owner).
- 2026-10-24 — Booli has no description text; store the broker link (`listingUrl`) only, never fetch it (owner).
- 2026-10-24 — Source stored as optional `PropertyInput.kalla` (contract change) + a retention migration that drops it after 12 months like the address (owner).

## Report → price via the expected fee rise (2026-10-24b)

- 2026-10-24 — Everything from the årsredovisning reaches the price through ONE channel: the expected rise in månadsavgift (spargap, refinansiering, ofinansierat underhåll, lokalintäkter i riskzonen, ofinansierade energiprojekt). The grade never moves the price. Previous sales in the förening: out of scope (no data source); the price is a list of adjustments so one can be added later (owner).
- 2026-10-24 — Coefficient: the OLS companion's β = −0.0024471 per kr/m²/mån on log(kr/m²) (`metadata.json` `effects_fee_per_sqm`), applied flat-specifically: price effect = β × rise × baseline kr/m². The LightGBM trees give no stable slope (finite differences −1 278…+170 kr per kr/mån, sign flips). β is an association, labelled as such (owner).
- 2026-10-24 — Base rate: the Riksbank API stopped publishing STIBOR in July 2020; swfbf.se blocks servers (Vercel checkpoint, HTTP 429) and its terms require a paid licence for commercial use. Use the 3-month T-bill (SSVX, `SETB3MBENCH`) behind a reference-rate interface that licensed STIBOR can replace (owner).
- 2026-10-24 — BRF margin 0.58 pp over SSVX: per-BRF median of variable loans (labelled "rörlig", or villkorsändringsdag ≤ 3 months after the balance date) in 5 of the test reports. Details: `docs/avgiftsprognos.md`.
- 2026-10-24 — Assumptions (moderate set, placeholders): horizon 24 months; 50 % of debt refinances when maturities are missing (range 0–100 %); maintenance spread over 10 years; 50 % of lokal rent at risk; each missing input widens only the LOW end of the price range by 3 % (owner).
- 2026-10-24 — No separate recommendation: the buyer decides. Instead "Så har vi räknat" under the price explains model + report, and a deterministic closing summary (grade, adjusted price vs utgångspris and area budpremie, fee rise, closing line) sits before the save options. "Sammanvägt riskbetyg" unchanged (owner).

## Sustainable fee + longer refinancing horizon (2026-10-24c)

- 2026-10-24 — Build A (savings gap) and B (refinancing years 3–5); räntekänslighet stays out of the price (owner). Reference table of maintenance needs with sources: `docs/underhall-referens.md`.
- 2026-10-24 — Savings target, first available: investeringsbehov per m² → the plan's recommended allocation / stated yearly need ÷ totalyta → planned costs ÷ years ÷ totalyta (excluding horizon items counted by `underhall`) → schablon 300 kr/m² totalyta (HSB 2026, Riksbyggen 2025). The schablon is moved within 250–350 by building parts (FAR 2025 / SIB M84:10 lifetimes): score = (#eftersatt − #nyligen) ÷ #assessed; target = 300 + 50 × score. Component costs per m² are not used (weak sources).
- 2026-10-24 — A schablon-based gap counts 50 % (owner); a plan-based gap counts in full. A surplus counts too and can raise the price (owner).
- 2026-10-24 — A plan-based target below 50 % of the schablon (< 150 kr/m²) is taken as a partial plan and not used (Helsingborgshus: "underhållsbehov 777 tkr/år" ≈ 46 kr/m²). Placeholder.
- 2026-10-24 — Missing totalyta is derived as total debt ÷ skuldsättning per m² totalyta (both statutory/reported figures).
- 2026-10-24 — Refinancing: ≤ 24 months both directions; months 25–60 only loans cheaper than SSVX + margin, weights 0.75 / 0.5 / 0.25 by year (owner). No later phase for undated debt.
- 2026-10-24 — Fee pressure colour: green < 2 %, yellow 2–10 %, red > 10 % of today's fee (owner); a decrease is green. Same colours on web, summary and PDF.
- 2026-10-24 — Price labels: "Vad jämförbara lägenheter säljs för" (baseline) and "Värde med hänsyn till föreningens ekonomi" (adjusted). The range is not shown, so its widening reasons are not either (owner).
- 2026-10-24 — Component id `spargap` kept (label "Sparande mot underhållsbehov") instead of a new `sparandegap` id: prognoses are assembled per read, so no stored data depends on the label, and the contract stays smaller.
- 2026-10-24 — Extraction v10: past renovations (seven building parts, year, cited), investeringsbehov per m², the plan's recommended allocation or stated yearly need, plan total. Minor repairs (e.g. hissens styrskor, new fans) are not renovations. Known miss: Beckasinen's "Fasadrenovering" in the 4th line of a long 2018 paragraph.

## Postnummer help on /analysera (2026-10-25)

- 2026-10-25 — Area hint under the postnummer field: what the valuation tables say (area; kommun + tier; "unknown" with the neighbours' kommun), from the same `losTackning` the valuation uses, via the pure server function `hamtaPostnummerInfoFn` (the tables are server-only). "Unknown" never claims a typo: the kommun table is thin outside Stockholms län (19 Malmö postnummer); only a fully unresolvable postnummer gets the warning border.
- 2026-10-25 — "Vet du inte postnumret?" links to PostNord's official postcode search (new tab) instead of looking the address up (owner). An address search via Nominatim was built and dropped: on 7 test addresses (6 Booli fixtures + Baltzar von Platens gata 6) it returned a wrong postnummer in all 5 cases where it found anything (usually the last digit; 112 42 → 112 35) and nothing in 2. Valuation moved 0 to 5.6 % (112 58 → 112 59: −5.6 %, ≈ 320 000 kr on a 60 m² flat). The Booli prefill's Nominatim postcode fallback has the same weakness (used only when a listing lacks its postcode: 0 of 6 fixtures); it keeps its "kontrollera" hint.

## Owner feedback round (2026-10-25b)

- 2026-10-25 — "Vad händer om räntan stiger?" is the slider again (owner preferred it to the table), now with two tabs in the same card: "Dagens avgift" and "Förväntad avgift". The slider means the same in both (räntekänslighet: a rate rise on the förening's whole debt); only the base differs. The PDF table's +1/+2 rows follow the same formula (before: only the debt repricing within 24 months), so web and PDF show the same numbers.
- 2026-10-25 — Lokal rent lowers the expected fee (and so the price) only when the report says it will fall away: terminated lease, tenant leaving, vacancy, insolvency, dispute or a lower rent (owner). A lease end date alone is not a signal: commercial leases are usually renewed, and lokal income is rather a strength. Cited field `lokaler.forlustsignaler` (PROMPT_VERSION 11). Older extractions lack it and subtract nothing.
- 2026-10-25 — Internal check of stated årsavgift changes (owner): a report is published once a year, so a raise it announces may already be in the fee the buyer enters. For each change after the balance date, the start date is compared with today and the buyer's fee with årsavgift/m² × boarea ÷ 12 before and after the change; the date decides when it is known. The result is stored on the prognosis (`avgiftsandringKontroll`) for Binfo's review and never shown. Not yet in effect → it adds the raise; unknown → it widens the range only. The raise's yearly revenue offsets the savings gap in every case, since the raise is the förening's answer to that gap and would otherwise be counted twice.
- 2026-10-25 (refined the same day, owner) — Lokal rent, compromise: rent the report says will fall away (a cited loss signal) counts 100 %. Rent whose lease ends within the horizon (or already ended after the balance date), when the report says nothing about renewal or a new tenant, counts 50 %: a 50 % probability that the income disappears. A cited renewal (`kontrakt[].fornyelse`, PROMPT_VERSION 12) removes the risk. The explanation names each lease and its end date, and each such lease, or loss signal, becomes a question to the styrelse.
- 2026-10-25 — A stated raise in effect also corrects the flat's share: the report's fee income is scaled up by the raise before dividing, and the fee-deviation question compares with the raised level. Otherwise an old report overstates the share, and so every component in kronor (Volontären: 453 → 363 kr/mån).
