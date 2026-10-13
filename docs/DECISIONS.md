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
