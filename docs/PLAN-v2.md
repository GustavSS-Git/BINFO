# Binfo v2 — plan

> **Archived 2026-10-12.** v2 is done and merged into `main`. The current plan is `PLAN.md` at the repo root.

Status: **APPROVED by owner 2026-10-09** (all recommendations D1–D9 accepted). Execution in progress on branch `v2`. Base commit `0f4bdbc`.
Owner answers to the Phase 1 questions are recorded in §0. Every later change to this plan is
logged in §9 with date and reason.

---

## 0. Decisions already made (owner, 2026-10-09)

| # | Decision |
|---|---|
| Budget | Claude API spend ceiling for this session: **300 SEK** (testing + development). Every run logged in `docs/api-test-log.md`. |
| Access | Spending commands may run outside the sandbox; branch `v2`, owner merges/pushes/publishes. |
| Hosting | Supabase Free plan today (Edge Functions 150 s wall clock), Cloudflare Workers via Lovable. Pro is an option if it pays — see §1.6. |
| Model | May switch to `claude-sonnet-5-5` if measured equal or better on the answer keys. |
| Scans | Target ≤ 5 min / ≤ 15 kr per scanned report; longer is acceptable if the analysis completes. Page refs for scans are verified against Claude's own transcription; figures tagged as from a scanned report, confidence capped at `medel`. Garbled text layers take the scan path. Failed sanity checks → show with "osäker" + question + lowered confidence, never hide. Supervisor drafts answer keys for the two image reports, owner verifies. Local OCR tools allowed for evaluation. |
| Price | New route `/vardering` (form without PDF, instant, free, rate-limited). **No andelstal, no debt in the valuation model.** After the normal valuation, the *full analysis only* adds a comment line: the apartment's approximate share of BRF debt = skuldsättning per m² bostadsrättsyta × boarea. Not available in the cheap price check. |
| Register | Shared across users (extraction + judgement only, never per-user object data). **PDFs kept indefinitely.** Lazy re-analysis on version change + admin backfill command. Kommun/område from the user's postnummer via existing mapping; report address secondary; one BRF ↔ many addresses. Admin = CLI. Older fiscal year uploaded → analyse it, note a newer exists. |
| Accounts | Supabase Auth later (email+password, TOTP, verification, reset). First-party httpOnly device-id cookie now. Rate limits 5 uploads/device/day, 10/IP/day, 60 price estimates/IP/hour, daily spend cap also checked at upload. Future: per-analysis payment instead of the upload limit — **not now**. |
| Caching | 5-minute TTL; ship only where measured profitable. |

---

## 1. Workstream 1 — image-only / scanned reports

### 1.1 Problem (measured, Phase 0)
- `skapaAnalys` (`src/server/analys.ts:121`) refuses any PDF where every page yields 0 characters
  (`scanned_pdf`), before upload or spend. Reproduced on both `annual reports pdf as image example/*`
  (23 p / 7.1 MB and 34 p / 8.3 MB: 0 chars on every page) and `SBC 2` (16 p raster).
- Two flavours: raster scans (`SBC 2`: one 2409×3437 image per page) and **vector-outlined text**
  (the two image examples: 200–2 500 fill paths per page, no fonts, plus some 300-DPI raster pages).
  Either way there is no text layer.
- **Anthropic docs: PDFs without extractable text are not citable.** Today's grounding stage gets
  every page reference from `page_location` citations, so the native-PDF route as-is would return
  "no findings". The fallback must make the content citable first.
- `test_rapport.pdf` has a garbled layer: single-character token share 0.785 vs ≤ 0.35 for all other
  text reports — a clean threshold exists (0.6).

### 1.2 Design (to be confirmed by the evaluation in 1.4)
1. **Classify at upload** (local, free): `textlager: 'ok' | 'saknas' | 'trasigt'` from per-page
   character counts + `bedomTextkvalitet`. A page is "empty" below 20 chars; the document is
   `saknas` if ≥ 80 % of pages are empty, `trasigt` if garble > 0.6. Stored on the register row and
   shown to the user: "Skannad årsredovisning upptäckt – analysen tar lite längre tid."
2. **New stage `transkribering`** before grounding, only for `saknas`/`trasigt`:
   - Split the PDF with **`pdf-lib`** (pure JS, MIT, runs in Workers and Deno) into chunks of
     ~4–6 pages.
   - Send each chunk as a native `document` block (Claude renders pages as images itself, so we never
     rasterise in production). Ask for a verbatim transcription per page, numbers exactly as printed.
   - Run the chunks **in parallel inside one Edge invocation**. Concurrent awaits cost no CPU budget,
     and each chunk call is about 60–90 s, within the 150 s wall clock.
   - Persist each page's text as it lands (table `sidtext`). A retry then redoes only the missing
     chunks.
3. **Grounding on the transcription.** Build a **custom-content document**, one content block per
   page, titled "Sida N". The existing grounding prompt runs with `citations` on, and
   `content_block_location` maps to the page number. Extraction and judging stay unchanged.
4. **Tagging.** `Datakvalitet` gets `kalla: 'textlager' | 'skannad'`. The extraction confidence for a
   scanned report is capped at `medel` and carries a skäl line.
5. **Sanity checks** (deterministic, both paths, new `src/lib/analysis/rimlighet.ts`):
   - balansräkning: tillgångar = eget kapital + skulder (±1 %);
   - räntekänslighet ≈ räntebärande skuld / årsavgifter (±10 %, when both are extracted);
   - årsavgift/m² × bostadsrättsyta ≈ årsavgifter;
   - skuldsättning/m² × yta ≈ total skuld;
   - plausible ranges per nyckeltal (catches tkr vs kr, factor 1 000);
   - flerårsöversikt year order.

   A failure adds a konfidens skäl, an "osäker" marker on the figure, and a question for the
   visning. This needs the extraction to also return a few raw totals (summa tillgångar, eget
   kapital, årsavgifter): a schema addition, optional fields.

### 1.3 Alternatives
| Option | Verdict |
|---|---|
| (a) Native PDF + citations | Rejected as-is: not citable without a text layer. Used inside the transcription step instead, without citations. |
| (a′) Native PDF, model self-reports page numbers | Evaluated only as an accuracy reference. Self-reported pages violate "API-verified citation". |
| (b) Rasterise ourselves, send image blocks | Production runtimes (Workers/Deno) have no canvas, and pdf.js rendering needs one. Only worth it if (a) misreads small digits and higher DPI fixes it — measured in 1.4. |
| (c) Local OCR (Tesseract, Swedish) → text pipeline | Cannot run in Workers/Edge without a separate service. `tesseract.js` (WASM) is evaluated locally for accuracy/cost; it ships only if it clearly wins and the owner accepts an OCR service. |
| (d) Cheap page-locator pass, then transcribe only relevant pages | Evaluated. Saves output tokens but adds a sequential call (~30–60 s) and the risk of missing a page. |

### 1.4 Evaluation protocol (Phase 3, before implementation)
- **Reports:** the 2 image examples + `SBC 2` (scanned) + `test_rapport` (garbled).
  **Answer keys:** drafted by the supervisor from rendered pages, then verified by the owner.
- **Variants:**

  | Variant | Model / setting |
  |---|---|
  | (a′) | Sonnet 5 |
  | (a)-transcription + custom-content grounding | Sonnet 5 / Sonnet 5.5 / Haiku 4.5 for the transcription |
  | (c) tesseract.js | — |
  | (d) | — |
  | (b) image blocks | only if transcription digit errors > 0 |

- **Metrics:**
  - field accuracy on the 7 nyckeltal plus total skuld;
  - Swedish number formats checked explicitly (space thousands, comma decimals, tkr vs kr, "neg");
  - tokens and cost;
  - wall clock.
- **Free pre-checks:** count tokens per page with `countTokens` before any paid call.
- **Estimated cost of the evaluation: ~90–120 kr.**


### 1.9 Evaluation results (2026-10-09, measured — 77.44 SEK, 117 calls; raw calls in `docs/api-runs/`)
Scored against the supervisor's draft answer keys (owner verification pending). 8 fields = 7 nyckeltal + total skuld.

| Report | V1 direct (ref only, self-reported pages) | V2 transcr. Haiku 4.5 | V2 Sonnet 5 | V2 Sonnet 5.5 | V3 Tesseract (local) |
|---|---|---|---|---|---|
| Startfältet (23 p, outlined) | 8/8 · 0.76 kr · 8 s | 8/8 · 3.15 kr | 8/8 · 4.38 kr | 8/8 · 4.68 kr · 105 s | 8/8 · 1.86 kr |
| Ängsknarren (34 p, outlined) | 8/8 · 1.10 kr | 8/8 · 3.69 kr | 8/8 · 5.77 kr | 8/8 · 5.79 kr · 108 s | 8/8 · 2.16 kr |
| Zederslundshus (16 p, raster) | 6/8 · 0.61 kr | 7/8 · 2.80 kr | 7/8 · 3.43 kr | 7/8 · 3.31 kr · 96 s | 7/8 · 1.83 kr |

(V2 cost/time = transcription + grounding + extraction; judging adds ~0.5 kr / ~25 s.)
- **Digit quality is clean**: no resolution-related misreads, no tkr/kr, comma, sign or column errors → option (b) image blocks not needed.
- The only miss (Zederslundshus total debt 7 581 085 vs 7 706 397) is a **prompt gap, not a transcription error**: the extraction prompt never says to add the short-term part of the loans. Affects text PDFs too → fixed in W1-IMPL (PROMPT_VERSION 6).
- Haiku 4.5 emits wrong/duplicate page markers (breaks the citation rule) and is slower per chunk → rejected.
- 5-page chunks: slowest single call 25.7 s (Sonnet 5.5) → far inside the Edge 150 s limit; 17-page chunks take 107 s (too close). pdf-lib split of the 8.3 MB PDF: 96 ms, < 45 MB RSS.
- One block per page makes citations cite whole pages (extraction input 24–45k tok); paragraph/row blocks with a block→page map ("V2b") cut extraction input to 9–13k at equal accuracy → adopted.
- Tesseract matches on numbers at ~40 % of the API cost but loses table columns and cannot run in Workers/Edge → not adopted (would need a separate OCR service).
- **Garbled text layer (test_rapport)**: the CURRENT text pipeline already scores 7/7 at 3.01 kr / 80 s vs the scan path 7/7 at 4.96 kr / 117 s (only with an "ignore the text layer" note; without it 6/7 because the model copies the broken layer). **Decision changed (supervisor, 2026-10-09):** garbled layers stay on the normal path; the scan path is the fallback only for 'saknas'. Owner's "garbled → scan path" answer was conditional on it helping; measured, it does not.

**Decision D8 (made):** V2b — Sonnet 5.5 (effort medium) transcription in parallel 5-page chunks via pdf-lib, "ignore any text layer" note on every call, page markers validated (count = chunk size, else retry the chunk), per-page persistence in `sidtext`, then custom-content grounding with paragraph/row blocks mapped to pages. Expected **≈ 4–6.5 kr and ≈ 2–2.5 min of API time per scanned report** (target was ≤ 15 kr / ≤ 5 min).

### 1.5 Files
- **New:** `src/lib/analysis/{textlager,transkribering,rimlighet}.ts` (+ tests), `pdf-lib` dependency.
- **Changed:** `pdf.ts`, `runExtraction.ts` (grounding accepts a custom-content source), `prompts.ts`
  (transcription prompt; `PROMPT_VERSION` → 6), `schema.ts` (optional raw totals), `steg.ts` /
  register job machine (new stage), Edge glue, `analysStatusCopy.ts`, `AnalysStatus.tsx` (scan
  notice), `fel.ts`.
- **Contract (flag):** `Datakvalitet.kalla?`, the optional "osäker" marker on `Figure`
  (`osaker?: string`).

### 1.6 Supabase Pro — supervisor view
- Pro does **not** change API cost per analysis. It raises the Edge wall clock from 150 to 400 s.
- Text reports already chain stages via reinvoke, with about 10 s gaps (live measurement
  2026-09-25). Running all stages in one invocation would save roughly 20–30 s per analysis.
- The scan path fits Free by running transcription chunks in parallel within one invocation.
- **Recommendation: stay on Free.** Revisit only if the evaluation shows single transcription calls
  above ~120 s, which would force tiny chunks (≥ 8 parallel calls).

### 1.7 Tests
- Unit:
  - classification thresholds on all 13 test PDFs (fixture: per-page char counts, no PDFs committed);
  - pdf-lib chunking (page counts, sizes);
  - custom-content block → page mapping;
  - each sanity check, including a deliberate tkr/kr error.
- Integration: steg state machine with a fake client through `transkribering` → done; partial-chunk
  retry; scan-flagged confidence cap.
- E2E (paid): both image examples + `SBC 2` + 3 text regressions through `npm run extract`, then one
  live job.

### 1.8 Risks
- **Transcription digit errors.** Mitigated by the sanity checks and the confidence cap. Measured, not
  assumed.
- **Edge memory with 8 MB PDFs split in memory.** Measured locally; fallback is fewer pages per chunk.
- **Request size.** Under 32 MB per chunk by construction. Reports above 25 MB are already refused at
  upload.
- **Page count.** The 100/600 page limit is irrelevant per chunk.

---

## 2. Workstream 2 — decouple the price estimate

### 2.1 Problem (measured)
- The valuation (`src/lib/vardering`, ~0.03 ms per call) already uses **only** form inputs.
- It is gated behind a finished PDF job by plumbing alone: it is computed inside
  `assembleraAnalys` at read time, and there is no endpoint of its own.
- The training data has a monthly fee but **no BRF identity and no debt**, so debt cannot be learned
  from it. The fee already partly proxies debt.

### 2.2 Design
1. **`price_estimate` service:** new `src/server/prisuppskattning.ts`.
   - `prisuppskattning(input: PrisInput): PrisuppskattningResultat` wraps
     `korBinfoVarderingsmodell` (valuation, interval, drivers, coverage, budpremie, deviation from
     utgångspris).
   - `PrisInput` = the valuation subset of `PropertyInput`: postnummer, boarea, rum, avgift, våning,
     byggår, hiss, balkong, optional utgångspris.
   - Stateless; nothing persisted.
2. **Server function `hamtaPrisuppskattningFn`** in `analysFn.ts`: Zod-validated, rate-limited
   (60/IP/hour, WS4), entitlement `prisuppskattning`.
3. **`brf_analysis` service** = the register pipeline (WS3).
4. **Orchestration of the full analysis.** `assembleraAnalys` calls the same `prisuppskattning()`,
   then adds the BRF layer. A single code path means the two results can never disagree.
5. **BRF layer (full analysis only, owner decision):**
   - `Prisanalys.andelAvForeningensSkuld?: Figure` = skuldsättning per m² bostadsrättsyta (extracted,
     cited) × boarea, `source: 'berakning'`, with a ref to the nyckeltal page.
   - Rendered as a comment line under the valuation, e.g. "Lägenhetens ungefärliga andel av
     föreningens lån: ca 412 000 kr (skuldsättning 7 630 kr/m² × 54 m²). Ingår inte i värderingen."
   - A debt-free BRF shows 0 kr (cited). If the figure is missing, the line is omitted and a question
     is added.
   - Not an adjustment: the valuation number is untouched.
6. **`/vardering` route:** the current form fields without the PDF, with the result rendered by the
   existing `Prisrimlighet` section. It is built functionally (→ "For Lovable to polish") and linked
   from `/` and `/analysera` ("Bara priskoll? Gratis och direkt").

### 2.3 Alternatives
| Alternative | Why rejected |
|---|---|
| Flat 30 % debt deduction | Biases every estimate down. The model was trained on BRFs with all debt levels and already sees the fee. Owner chose no adjustment. |
| Deviation-based adjustment (debt vs area benchmark × capitalisation factor) | No sourced benchmark or factor exists, and debt is not observable in the training data. Could be revisited once the register has enough BRFs per area: the register gives debt per orgnr, but the transaction data has no orgnr, so a join needs address-level transaction data we don't have. |
| "Effective price" = price + debt share as a headline | Not requested. The comment line gives the same information without competing with the valuation. Open decision D4. |
| BRF grade affecting price | Recommend **no**. Debt and fee are already priced in or shown. Deferred maintenance, stambyte and rate exposure are already red flags and questions in the report. A price adjustment would need sourced magnitudes we don't have, and would risk presenting association as causation. Open decision D5. |
| Cheap nyckeltal pass feeding the price | Out of scope by owner decision: the cheap price check uses no BRF data. The cheap pass is still built, for the register identity (WS3). |

### 2.4 Files
- **New:** `src/server/prisuppskattning.ts` (+ test), `src/routes/vardering.tsx`.
- **Changed:** `analysFn.ts`, `prisdata.ts` and `assemble.ts` (call the service; debt line),
  `AnalysRapport.tsx` (comment line), `pdf/viewModel.ts` (same line), `SiteNav.tsx`, `index.tsx`
  (link only).
- **Contract (flag):** new exported `PrisuppskattningResultat` and `PrisInput`;
  `Prisanalys.andelAvForeningensSkuld?`. Both are additive.

### 2.5 Tests
- **Parity:** `prisuppskattning(x)` equals the `prisanalys` valuation fields of
  `assembleraAnalys(x, …)` for fixtures in all three tiers.
- **Debt line:** `skuld/m²` × boarea, rounded to whole kronor; debt-free gives 0; missing gives no
  field plus a question; the ambiguous-basis figure is used as is.
- **Server function:** invalid postnummer → validation error, rate limit → error.
- **Route:** renders with the fake.
- **No API spend.**

### 2.6 Risks
- Users might read the debt line as a price adjustment. Mitigated by the wording "Ingår inte i
  värderingen" and a separate row.
- The free endpoint could be abused. Mitigated by the rate limit; the endpoint costs no API money.

---

## 3. Workstream 3 — register of analysed reports

### 3.1 Problem (measured)
- The cache is keyed only by `(pdf_hash, model, prompt_version)`, so a re-downloaded copy of the
  same report is a full-price miss.
- `extraktion_cache.orgnr` and `rakenskapsar` exist but are unindexed and unvalidated.
- Two simultaneous identical uploads both pay for grounding.
- PDFs are deleted after 30 days.

### 3.2 Design
**Schema** (one new migration, together with WS4):
- `forening(orgnr pk, namn, forst_sedd, senast_sedd)`
- `rapport(id uuid pk, orgnr fk null, rakenskapsar int null, pipeline_version text, model text,
  status rapport_status, stage rapport_stage, textlager text, lease_until, attempts, grundtext,
  extraction jsonb, judgement jsonb, konfidens text, error_code, error_message, cost_sek,
  created_at, finished_at, ersatt_av uuid null)`
  - `unique (orgnr, rakenskapsar, pipeline_version) where status <> 'failed'` — the concurrency lock.
  - Indexes on `(orgnr, rakenskapsar)`.
- `rapport_fil(pdf_hash pk, rapport_id fk, pdf_path, sidor int, bytes int, uppladdad)` — many byte
  versions per report. PDFs are kept indefinitely.
- `sidtext(rapport_id, sida, text, kalla, pk(rapport_id, sida))` — scan transcriptions (WS1).
- `forening_adress(id, orgnr fk, postnummer, adress, kommun_kod, omrade, kalla 'rapport'|'anvandare',
  forst_sedd, unique(orgnr, postnummer, adress))`.
- `analys` (now strictly the per-user request) gains `rapport_id fk null` and `principal_id fk null`
  (WS4). Its job columns stay only for legacy rows.

**Flow at upload** (`skapaAnalys`):
1. Hash → `rapport_fil` hit whose report has a compatible `pipeline_version` → link the `analys`
   row to it. Status is "done" immediately if the report is done, otherwise it waits on the
   report.
2. Hash miss → **local identity extraction** (free, text-layer PDFs). Orgnr regex
   (`\d{6}-\d{4}`, Luhn-checked, majority vote across page footers) and the räkenskapsår pattern
   ("räkenskapsåret 2025-01-01 – 2025-12-31" / "Årsredovisning för räkenskapsåret 2025"). If
   confident → register lookup on `(orgnr, år)`. A hit requires the BRF name in the PDF text to fuzzy-match
   `forening.namn` (guards against a mis-read orgnr). On a hit → new `rapport_fil` row for these
   bytes, link, done.
3. Still unknown (scans, or ambiguous) → create the `rapport` with `stage = 'identifiering'`. The
   first worker stage is a **cheap identity call**: pages 1–3 via pdf-lib, Haiku 4.5, JSON
   `{orgnr, rakenskapsar, namn}` (~0.05–0.1 kr). It then looks up the register again. On a hit it
   re-points the analys row to the existing report and marks the new `rapport` `ersatt_av`; on a
   miss it continues to the full pipeline.
4. **Concurrency:**
   - Same bytes: `rapport_fil.pdf_hash` is a primary key, so `insert … on conflict do nothing
     returning`; the loser reads the winner's `rapport_id`.
   - Same identity: the partial unique index means the second insert conflicts and links to the
     in-progress report.
   - The user sees "Rapporten analyseras redan — din analys blir klar samtidigt."

**Job machine moves from `analys` to `rapport`:**
- `claim_next_rapport_steg` uses the same lease / `SKIP LOCKED` / attempts semantics.
- Stages: `identifiering` → (`transkribering`) → `grundning` → `extraktion` → `bedomning` →
  `klar`.
- `hamtaStatus` for an analys row reads its report's status.
- The version guard compares `rapport.pipeline_version`.

**Versioning:**
- `pipeline_version = "p{PROMPT_VERSION}.s{SCHEMA_MAJOR}"`.
- Read path:
  - The newest `klar` report for `(orgnr, år)` with the current `pipeline_version` wins.
  - Else the newest whose schema major matches is served, marked "analyserad med äldre version",
    and a lazy re-run is queued once per report.
  - Else (incompatible schema) the old result is never served: re-run, and the user waits.
- Admin backfill: `npm run register -- backfill --to current [--limit N] [--dry-run]`, with spend
  guarded by the daily cap.

**Legacy:**
- Old `analys` rows (no `rapport_id`) keep reading from `extraktion_cache`/`analys_cache` unchanged.
- A one-off backfill script creates `forening`/`rapport`/`rapport_fil` rows from v5 cache rows that
  have an orgnr and a year.
- Their PDFs may already be deleted (30-day rule), so those reports are marked `pdf_saknas`.

**Admin CLI** `npm run register -- list [--orgnr X] | inspect <id|orgnr år> | invalidate <id> | backfill`.
`invalidate` sets `status='failed'`, `error_code='ogiltigforklarad'` and frees the identity slot.

**Location:**
- On every analysis, upsert `forening_adress(kalla 'anvandare')` with the user's postnummer →
  kommun/område from the existing `losTackning` mapping. The street address is **not** stored in
  the register. It is per-user data and stays in `property_input`, where it is anonymised at 30
  days.
- The report's own address, if extracted, is stored with `kalla 'rapport'`.

**Fiscal years:** the register keeps every year. The report view notes "Det finns en nyare
årsredovisning (2026) analyserad" when a newer `klar` year exists. Multi-year trends are a later
feature.

### 3.3 Alternatives
| Alternative | Why rejected |
|---|---|
| Keep the job on `analys` and add an advisory lock per hash/identity | Fewer moving parts, but a per-user row would still own shared work, and concurrent same-report requests would need polling of a sibling row. The register-level job is the cleaner long-term shape. |
| LLM identity on every upload | Costs ~0.1 kr and ~5–10 s per upload. Local regex is free and handles all 10 text reports measured (orgnr in footers on almost every page). |
| Geocoding service for kommun/district | Adds a paid external dependency and an API key. The postnummer mapping already exists and is consistent with valuation tiering. |
| Hash-only identity | Fails exactly the case the register exists for. |

### 3.4 Files
- **New:**
  - migration `supabase/migrations/2026101xxxxxxx_register_och_konto.sql`
  - `src/server/register.ts` (lookup, link, versioning)
  - `src/lib/analysis/identitet.ts` (local orgnr/year/name)
  - `src/server/cli/registerCli.ts`
  - backfill script
- **Changed:** `portar.ts`, `supabase.ts`, `__fakes__/lager.ts`, `steg.ts`, `analys.ts`, `cache.ts`
  (legacy read only), `supabase/functions/analys-steg/index.ts` (glue), `edge/build.ts` (pdf-lib
  external), `SUPABASE.md`.

### 3.5 Tests
- **Identity:**
  - orgnr Luhn check;
  - footer majority vote;
  - year patterns, run on the 10 text reports' real page text, saved as small text fixtures (only
    page 1–3 snippets, no full reports).
- **Fake-lager integration:**
  - hash hit;
  - identity hit with name match and with a mismatch;
  - concurrent identical uploads → exactly one pipeline run (simulated interleaving);
  - lazy re-run on a version bump;
  - incompatible schema never served;
  - legacy rows still readable.
- **SQL:** migration applied on local Supabase (Docker); `verify-rls` extended to the new tables.

### 3.6 Risks
- **A wrong identity serves another BRF's analysis.** Guards: Luhn check, majority vote, fuzzy name
  match, and the report name shown prominently.
- **The job-machine refactor is the largest change.** Mitigated by tests first, a fake-based test of
  the whole lifecycle, a drained queue at deploy, and the legacy read path kept.
- **Storage grows indefinitely.** About 5 MB per report; 1 GB is included on Free (verify current
  limits).

---

## 4. Workstream 4 — account-ready infrastructure

### 4.1 Design
**Principal concept** (same migration as WS3):
- `principal(id uuid pk, typ 'anonym'|'konto', auth_user_id uuid null unique references auth.users,
  skapad, senast_sedd, sammanslagen_till uuid null)`.
- An anonymous device = one `principal` row. When accounts arrive, signing in either sets
  `auth_user_id` or merges the device principal into the account principal (`sammanslagen_till`).
  Anonymous history is claimed that way.
- `analys.principal_id` links a per-user request to its principal. A direct FK is correct here:
  `analys` is already the per-user request and the shared data lives in `rapport`. This gives the
  separation the brief asks for: shared register data on one side, per-user data on the other.
- Later per-user tables (saved objects, notes, purchases) all hang off `principal_id`.

**Device ID:**
- A server-set `binfo_enhet` cookie: random 128-bit, httpOnly, Secure, SameSite=Lax, 1 year.
- It is created lazily by TanStack Start request middleware (`src/start.ts`).
- The cookie stores only a random id. The `principal` row is created on the first expensive action.

**Request context middleware:**
- `src/server/kontext.ts` resolves `{ principalId, ipHash }` per server-function call. The IP comes
  from Cloudflare's `cf-connecting-ip`, hashed with a secret salt and never stored raw.
- `analysFn.ts` handlers pass `kontext` to the implementations.
- Accounts later only change `kontext.ts` (session → principal). Handlers stay unchanged.

**Entitlements:** `src/server/behorighet.ts`.
- `type Formaga = 'prisuppskattning' | 'ladda_upp_analys' | 'full_rapport' | 'pdf_export'`.
- `harBehorighet(kontext, formaga): Promise<boolean>`, with a single policy table in code. Today
  everything is granted to everyone.
- Table `behorighet(principal_id, formaga, kalla 'gratis'|'kop'|'prenumeration', rapport_id null,
  giltig_till null)` is created now and left empty. Per-analysis payment later is a row with
  `kalla 'kop'` and a `rapport_id`, plus one policy line.
- Checked in exactly one place per server function (`hamtaResultat`, `skapaAnalys`,
  `hamtaPrisuppskattning`).

**Rate limiting:**
- Table `kvot(nyckel text, fonster_start timestamptz, antal int, pk(nyckel, fonster_start))` and an
  atomic RPC `ta_kvot(nyckel, fonster_sek, max) returns boolean`.
- Limits:
  - `skapaAnalys`: device 5/day and IP 10/day;
  - `hamtaPrisuppskattning`: IP 60/hour.
- `skapaAnalys` also checks the daily spend cap up front. Today it queues silently.
- Rows older than 2 days are purged by the retention job.
- A new error code `kvot` with Swedish copy.

**Auth later:**
- Supabase Auth: email+password, email confirmation, reset, and TOTP MFA.
- Free-plan availability of TOTP is to be verified; the local config template comment suggests
  Pro.
- Integration points: `kontext.ts` (session), `principal.auth_user_id`, the merge function, and RLS
  policies only if the browser ever talks to Supabase directly. Today it doesn't, so all
  enforcement stays server-side.
- No password or crypto code of our own.

**GDPR design (documented in `SUPABASE.md`, minimal code now):**
- Register data (public documents) is not personal data. `principal`, `analys.property_input`,
  `kvot` and the cookie are.
- `radera_principal(id)`: deletes the principal's `analys` rows (wiring the existing
  `radera_analys` logic) and `kvot` rows; leaves the register.
- Export: JSON of the principal's analyses (inputs + links).
- Retention: unchanged 30-day anonymisation of `property_input`; IP hashes only, 2-day purge.
- Implemented now as CLI-only functions, with a user-facing flow once accounts exist.

### 4.2 Alternatives
| Alternative | Why rejected |
|---|---|
| Supabase anonymous sign-in for the device id | Ties now to Auth session handling in the browser, needs a Supabase client in the browser, and anonymous users count as MAUs. A plain cookie is simpler and fully replaceable. |
| Link table user↔analysis | Unnecessary: `analys` is already per-user and the shared part is `rapport`. |
| Rate limiting via Cloudflare rules | Not configurable through Lovable's deployment as far as the repo shows. Application-level limits are portable. |

### 4.3 Files
- **New:** `src/server/{kontext,behorighet,kvot,principal}.ts` (+ tests).
- **Changed:** `src/start.ts` (middleware), `analysFn.ts`, `analys.ts`, `portar.ts`, `supabase.ts`,
  `__fakes__/lager.ts`, `fel.ts`, `analysStatusCopy.ts`, `senasteAnalyser.ts` (unchanged
  interface).

### 4.4 Tests
- Unit:
  - cookie created once and reused;
  - IP hashing (never raw);
  - quota boundary (5th allowed, 6th refused);
  - window rollover;
  - entitlement policy defaults to all granted;
  - one forced deny proves each handler checks.
- SQL: `ta_kvot` atomic under concurrency, on local Supabase.
- No API spend.

### 4.5 Risks
- A shared IP (offices, mobile carriers) hits the 10/IP limit. Acceptable for now; it is a constant.
- Middleware ordering with Start's CSRF middleware: covered by a test.

---

## 5. Workstream 5 — prompt caching

### 5.1 Honest assessment
- The current pipeline sends the PDF **once** (grounding). Extraction and judging are text-only and
  never re-read the document, so there is **no multi-pass-over-the-same-document win** on text
  reports today.
- The grounding system prompt (~420 tokens) is below the Sonnet 5 minimum (1 024; 512 on
  Sonnet 5.5).
- **Static prefixes that qualify:** the extraction system prompt (~1.7k tokens) and the judging
  system prompt (~2.4k). These hit only when another analysis runs within 5 minutes (low traffic
  today), or on the one validation retry. Expected saving: ≈ 0.01–0.03 kr per analysis. Cache-write
  overhead on a miss is about the same size, so the expected net effect is ±0.
- **Where it can pay:**
  1. **The scanned path:** the transcription system prompt shared by 5–8 parallel chunk calls.
     Send the first call, then fire the rest once the first starts streaming. Padded with
     transcription examples to reach the minimum if it is close.
  2. **Validation retries:** a breakpoint on the full user message, so the retry reads it from the
     cache.
  3. **The register backfill:** sequential runs within 5 minutes share the static prefixes.
- The register (WS3) removes repeat cost entirely; caching only trims within a 5-minute window. The
  two are reported separately.

### 5.2 Design
- Explicit `cache_control` breakpoints (never automatic — the last block varies per request):
  - extraction and judging: on the static system block;
  - transcription: **not cached** — the transcription call sends `system` as a plain string, without
    `cache_control` (verified in the code 2026-10-10); the "scan-path breakpoint" below was never
    implemented.
- `costGuard`/`callMetrics` priced with cache-write at 1.25× and cache-read at 0.1×. Today's cost
  estimate ignores cache fields, so it under-reports when caching is on.
- Per-analysis metrics persisted: `cache_read`/`cache_write` tokens summed on `rapport`.

### 5.3 Tests and measurement
- Unit: pricing with cache fields; breakpoint placed on the stable block (request snapshot).
- Paid: 3 text reports run back-to-back, before/after. Report the cache hit rate
  (`cache_read / total input`) and kr per analysis.
- **Estimated cost: ~25 kr.**
- Ship only if the net is ≤ 0 kr. (Outcome: caching stays off by default; there is no scan-path
  breakpoint — see the status log.)

### 5.4 Files
`costGuard.ts`, `callMetrics.ts`, `runExtraction.ts`, `analyze.ts`, the transcription module.

---

## 6. Dependency graph and order

```
            ┌───────────────────────── W1-EVAL (scan options, paid) ─────────────┐
            │                                                                     ▼
 P0 ──► C1 cache-aware cost metrics ──► W5 caching measure ──────────────► W1-IMPL scan stage
  │                                                                           ▲
  ├──► S1 schema+ports (WS3+WS4 migration, fakes, Edge glue) ──► W3 register ─┘
  │                                         │                      │
  │                                         └──► W4 kontext/kvot/behorighet
  │                                                                │
  └──► W2 price service (backend, no schema) ──────────────────────┤
                                                                   ▼
                                               F1 frontend (all UI) ──► R review ──► E2E live
```

| Wave | Runs in parallel | Why the order |
|---|---|---|
| A | W1-EVAL (scratch only), C1 (`costGuard`/`callMetrics`), S1 (schema + ports, supervisor-led), W2 backend (`prisuppskattning.ts` + contract additions by supervisor) | Disjoint files. The eval needs no repo code. |
| B | W3 register (`steg.ts`, `analys.ts`, `register.ts`, `identitet.ts`), W5 measurement, W4 (`kontext`, `behorighet`, `kvot`, `start.ts`) | W3 and W4 both touch `analys.ts`/`analysFn.ts` → W4 gets `analysFn.ts` + `start.ts`; W3 gets `analys.ts` + `steg.ts`. Interface agreed in S1. |
| C | W1-IMPL (scan stage in the register job machine) | Needs W3's job machine and the W1-EVAL decision. |
| D | F1 frontend | Covers the scan notice, reuse notice, `/vardering`, debt line, `kvot` copy and older-version note. Single agent, one short window agreed with the owner, for Lovable sync. |
| E | Reviewer per integration; full E2E: 2 image + `SBC 2` + 3 text reports locally, then one live job after the owner deploys | |

---

## 7. Subagent breakdown

| Agent (type) | Task | May touch | Definition of done |
|---|---|---|---|
| `pdf-pipeline` "scan-eval" | W1-EVAL | scratchpad, `scripts/eval/` (new), `docs/api-test-log.md` (append), draft answer keys `fixtures/answer-key/*-UTKAST.json` | Results table per variant (accuracy, kr, s, tokens), recommendation, ≤ 120 kr spent |
| `pdf-pipeline` "cache-cost" | C1 + W5 | `costGuard.ts`, `callMetrics.ts`, `runExtraction.ts`, `analyze.ts` (+ tests) | Cache-aware pricing tested; before/after measured; ≤ 25 kr |
| `general-purpose` "price" | W2 backend | `src/server/prisuppskattning.ts`, `prisdata.ts`, `assemble.ts`, `analysFn.ts` (one new fn only, in Wave A) | Parity tests green, debt-line tests green |
| `general-purpose` "register" | W3 | `src/server/{register,steg,analys,cache}.ts`, `src/lib/analysis/identitet.ts`, `src/server/cli/registerCli.ts`, Edge `index.ts`, `edge/build.ts` | Lifecycle tests on the fake green; migration applies locally; legacy reads green |
| `general-purpose` "konto" | W4 | `src/server/{kontext,behorighet,kvot,principal}.ts`, `src/start.ts`, `analysFn.ts` (Wave B), `fel.ts` | Quota/entitlement/cookie tests green; one forced deny per handler |
| `pdf-pipeline` "scan-impl" | W1-IMPL | `src/lib/analysis/{textlager,transkribering,rimlighet}.ts`, `pdf.ts`, `prompts.ts`, `schema.ts`, `runExtraction.ts`, the scan stage in `steg.ts` (after "register" is merged) | Both image examples + `SBC 2` complete with a measured accuracy ≥ the agreed bar; text regression unchanged on the answer keys |
| `frontend-state` | F1 | routes, `AnalysStatus.tsx`, `AnalysRapport.tsx`, `pdf/viewModel.ts`, `analysStatusCopy.ts`, `SiteNav.tsx` | `npm run dev` checked in a browser, "For Lovable to polish" list |
| `reviewer` | after each merge | read-only | Findings ranked |

The supervisor owns:
- the migration SQL;
- the contract (`src/types/analysis.ts`);
- `portar.ts` and `supabase.ts` (shared ports);
- integration, commits on branch `v2`, `docs/PLAN-v2.md`, `CLAUDE.md`.

---

## 8. Migration and rollback

- **One additive migration:** new tables, new enums, nullable `analys.rapport_id` and
  `analys.principal_id`, new RPCs. No column dropped, no applied migration edited.
- **Retention cron replaced** (unschedule + reschedule, as `20260924120000` did):
  - stop deleting PDFs;
  - keep the `property_input` anonymisation;
  - add the `kvot` purge.
- **Retention hotfix first** (found by the local Supabase run, 2026-10-10): the old command begins
  with a direct `delete from storage.objects`, which current Storage refuses (`protect_objects_delete`:
  "Direct deletion from storage tables is not allowed"). pg_cron runs it as one transaction, so the
  error also rolled back the `property_input` anonymisation — the nightly job has been `failed`.
  `supabase/migrations/20261008000000_retention_fix.sql` reschedules it without the storage delete
  and catches up rows older than 30 days. It is standalone, ordered before the v2 migrations and
  applied to production on its own **ahead of v2**. The konto migration replaces the command once
  more (adds the `kvot` purge).
- **Local testing:** the Supabase CLI against Docker (`supabase start`, `db reset`). **Docker Desktop
  must be running.** Production `db push` is done by the owner.
- **Deploy order:**
  0. retention hotfix `20261008000000` applied on its own, ahead of v2;
  1. kill switch on; let the queue drain (no `queued`/`running` rows);
  2. `db push`;
  3. `deploy:edge`;
  4. Lovable publish;
  5. kill switch off.

  The version guard catches any skew.
- **Backfill** (owner-run): `npm run register -- backfill-legacy --dry-run`, then for real. It is
  idempotent (on-conflict-do-nothing).
- **Rollback:**
  - code: revert the `v2` merge. Old code ignores the new tables and nullable columns, so it keeps
    working.
  - data: the new tables are left in place (harmless).
  - full schema undo: a written down-script in `supabase/rollback/2026101x_register_och_konto.down.sql`.
    It is never auto-applied and is used only on the owner's command.
  - retention: do **not** reschedule the pre-v2 command — it fails on current Storage and takes the
    anonymisation down with it. The konto down-script restores the anonymisation only (PDFs stay);
    PDF expiry, if ever wanted again, needs the Storage API, not a SQL delete.
- **Reinvoke and scan batching** (local stack, 2026-10-10): the Edge worker's self-POST must target
  `<PROJECT_URL>/functions/v1/analys-steg` (`req.url` inside the runtime is the internal
  `http://kong:8081/analys-steg` and is refused — stages then wait for the next minute tick:
  text job 176 s instead of ~77 s). The scan transcription handles at most 3 chunks per invocation
  (hard CPU limit 2 s; 4 chunks logged the soft limit, 3 did not) and reinvokes for the rest.

---

## 9. Decisions (owner approved all recommendations 2026-10-09)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Contract additions (all additive): `PrisInput`, `PrisuppskattningResultat`, `Prisanalys.andelAvForeningensSkuld?`, `Datakvalitet.kalla?`, `Figure.osaker?`, optional raw totals in `ExtractionResult`, `AnalysStatusSvar.{textlager?, ateranvand?, vantarPaRapport?}` | Approve |
| D2 | Move the job machine from `analys` to `rapport` (vs a lock on `analys`) | Move |
| D3 | Register identity hit requires orgnr (Luhn) + year + fuzzy name match | Approve |
| D4 | Show "pris + andel av lån" as an extra figure | No — the comment line only |
| D5 | BRF grade affects price/interval | No — flags and questions already cover it |
| D6 | Free consistency check: the user's månadsavgift vs årsavgift/m² × boarea / 12 from the report → a question if > 15 % apart (15 % is a product threshold, marked as such) | Yes, full analysis only |
| D7 | Supabase Pro | Stay on Free (§1.6) |
| D8 | Scan method | Decided by the W1-EVAL measurements; reported before implementation only if it changes cost > 15 kr or latency > 8 min |
| D9 | Model switch to Sonnet 5.5 | Decided by measurement (owner pre-approved). Note: a switch changes the cache/register key → lazy re-runs on access |

---

## 10. Estimated API spend (testing)

| Item | kr |
|---|---|
| W1-EVAL (4 reports × variants, countTokens free) | 90–120 |
| W5 caching before/after | ~25 |
| Identity call tests (Haiku, scans) | ~5 |
| W1-IMPL regression (2 image + `SBC 2` + 3 text) | ~45 |
| Model comparison Sonnet 5 vs 5.5 (3 text reports) | ~25 |
| Final E2E + one live job | ~20 |
| **Total** | **≈ 210–240** (ceiling 300) |

---

## 11. Status log

| Date | Item | Status |
|---|---|---|
| 2026-10-09 | Phase 0 orientation, CLAUDE.md rewrite | done (uncommitted) |
| 2026-10-09 | Phase 1 questions answered | done |
| 2026-10-09 | This plan | approved (all D1–D9) |
| 2026-10-09 | Branch `v2`; pdf-lib added (4b99f66); contract D1 (b33ce92) | done |
| 2026-10-09 | Wave A launched: W1-EVAL (worktree), C1/W5 cache+model A/B, W2 price backend, W3a register core, W3b identity, W4 account modules | in progress |
| 2026-10-09 | Draft answer keys (supervisor, from page images): Startfältet 769635-9905, Ängsknarren 2001 769607-2912, Zederslundshus 724000-0161 (`SBC 2`), Barsbro Parken 769624-6953 (`test_rapport` nyckeltal, previously unreadable) | drafted — owner to verify |
| 2026-10-09 | W4 account modules (8cebb70), W2 price service (5adeb9d), C1/W5 + identity (35facff) | done, committed |
| 2026-10-09 | D9 model: default claude-sonnet-5-5 (A/B: 64/65 vs 64/65, ~2x faster, −9 % cost) | done (35facff) |
| 2026-10-09 | W5 caching: breakpoints implemented but OFF by default — isolated report +0.05–0.12 kr with caching, burst −3 %; fails the "net ≤ 0" rule for production. 'system' mode kept for backfills | done |
| 2026-10-09 | W1-EVAL: see §1.9; D8 decided (V2b, Sonnet 5.5); garbled layers stay on normal path | done |
| 2026-10-09 | W3a register core: SQL verified on PGlite (Postgres-in-WASM, 45 checks) pending real Supabase; under review | in review |
| 2026-10-09 | W3a register (7a7377c) after review M1–M5/L6–L8/L10 fixes | done |
| 2026-10-09 | W1 scan library layer + sanity checks, PROMPT_VERSION 6 (4cccb25): 3 scans 45/45 on draft keys; text regression unchanged | done |
| 2026-10-09 | W4 wiring (c94b972) + dev import-protection fix (0c2edfc) | done |
| 2026-10-09 | F1 UI (be36c52) + review fixes (993c6e1) | done |
| 2026-10-09 | Scans switched on in the job machine (5d351d6): state-machine E2E 34-p scan 8/8, 5.94 kr; register re-upload 0 kr | done |
| 2026-10-09 | Server review hardening (deae884): transcription reuse, terminal deterministic failures, 15 kr stage ceiling, ≥50 % empty-page rule, loose quotas, safe errors | done |
| 2026-10-09 | Changed vs plan: garbled layers stay on the normal path (§1.9); 'saknas' = ≥ 50 % empty pages (plan said 80 %; 50 % chosen after review — all corpus PDFs unchanged); fee sanity tolerance 25 % (10 % false-alarmed); caching off by default (§5); 60-page scan limit (owner confirmed 2026-10-10) | documented |
| 2026-10-10 | Owner: all four drafted answer keys verified correct; 60-page scan limit confirmed; ANTHROPIC_MODEL set to claude-sonnet-5-5 in Lovable secrets and .env.local; PDF retention may become ~1 year (GDPR basis pending, owner) | done / open |
| 2026-10-10 | Owner: production retention job confirmed failing ("Direct deletion from storage tables is not allowed"). Decision: keep register/PDFs/BRF analyses; anonymise only the buyer's address/postnummer/orgnr, after **12 months** (was 30 days) — hotfix, konto migration, rollback, UI copy and the browser's recent-analyses list updated | done |
| 2026-10-10 | Retention hotfix (495150b + 840cc7c) cherry-picked to `main` and applied to production by the owner (`db push`); `scripts/v2-lokalt.sh` added for trying v2 locally | done |
| 2026-10-09 | Total API spend this session: 154.21 SEK of 300 | — |
| 2026-10-09 | Docker unavailable (owner remote) → migration apply, SQL-level tests, verify-rls deferred to a Docker session | deferred |
