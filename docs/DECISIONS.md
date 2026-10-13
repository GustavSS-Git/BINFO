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
- 2026-10-13 — Production check (owner-approved test upload, Pontonjären 3): v2 IS deployed in production (register live; Brf Laxöringen 1 analysed OK on 2026-10-10 for 3.46 kr). But both Pontonjären uploads (2026-10-12 15:34 and 2026-10-13 11:05 UTC) failed at stage `grundning` after 3 fast attempts, 0 kr, errorCode `unknown`. Local API key works. Root cause (2026-10-13): the Anthropic key expired; the owner updated `.env.local` and Lovable secrets but not the Supabase Edge Function secret `ANTHROPIC_API_KEY`, which the worker uses. Fix: set it in Supabase → Edge Functions → Secrets. Follow-up in W3: the worker must log the underlying error (Edge logs showed only boot/shutdown).
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
