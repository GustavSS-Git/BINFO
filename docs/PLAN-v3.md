# Binfo v3 — plan: accounts, public BRF register, bulk analysis, kalkyl exports

Status: **DRAFT, awaiting owner approval** (2026-10-12). Base: `main` @ 36c44bd.
Phase 1 answers: owner accepted every default on 2026-10-12 (recorded in
`docs/DECISIONS.md`). Previous plans: `docs/PLAN-v2.md` (scans, register,
account-ready infra; done, archived), root `PLAN.md` (UI copy; done).

Currency: SEK in the codebase, USD for the session budget. Conversion 9.7 SEK/USD
(`costGuard.ts`).

---

## 0. Ground rules for this plan

- **Prerequisite (W0): finish and verify the v2 deploy.** The owner
  published `main` in Lovable on 2026-10-12. Production Priskoll works, which
  proves the konto migration's `ta_kvot` exists in production. Still
  unverified:
  - that the register migration is applied;
  - that the v2 Edge worker (`analys-steg`) is deployed;
  - that `register -- backfill-legacy` has run.

  W0 checks all three with the owner (dashboard, or one production test upload
  with owner OK), completes any missing step, and only then does v3 start
  building on them.
- **Branch `v3`.** Subagents work in git worktrees off `v3`. Nothing merges to
  `v3` without typecheck, lint, tests and build passing. `v3` merges to `main`
  only when green, and pushes need the owner's OK.
- **No production change without telling the owner first.** That covers
  migrations, the Edge deploy and a Lovable publish.
- **Visual boundary.** New pages are built only from `@/components/ui/binfo`,
  the existing tokens and the existing page patterns
  (`mx-auto max-w-* px-5 py-14`, `Card`, `PageHeader`, small-caps labels). No
  new colours, fonts or kit components. Anything that wants more polish goes on
  the "For Lovable to polish" list.
- **Server boundary unchanged.** All new server functions are wired in
  `src/server/analysFn.ts` (the only client-importable server file). Their
  implementations live in new modules under `src/server/`. Workstreams deliver
  implementation + tests, and the supervisor does the `analysFn.ts` wiring at
  integration so that file never has parallel editors.
- **The browser still has no Supabase client.** Auth runs server-side.

---

## 1. Feature A — Accounts

### 1.1 Scope
- Sign up with email + password, email verification, login, logout.
- "Glömt lösenord" → email link → set a new password.
- Profile `/konto` lists the account's:
  - analyses (BRF reports);
  - saved valuations;
  - saved bolånekalkyler.

  Each entry shows a date and its key inputs/results, plus an "Öppna" action.
- Users can delete valuations and calculations. A report can be removed from
  the user's list but never deleted from the register.
- "Radera konto" and "Ladda ner mina uppgifter" (GDPR).
- "Spara" on `/vardering` and `/bolanekalkyl`:
  - Logged in: saves directly.
  - Logged out: goes through login (or signup, including the verification
    round-trip) and returns to the page with the inputs intact, then saves.
- No MFA in this round (it can be added later; Supabase Auth TOTP).

**Out of scope:** social login, magic links, payments, team accounts.

### 1.2 Auth design
- **Provider:** Supabase Auth on the existing project, used only from the server.
- **Session:**
  - Access and refresh tokens live in two httpOnly, Secure, SameSite=Lax
    cookies (`binfo_sa`, `binfo_sr`) set by server functions.
  - On each server-function call `losKontext` validates the access token
    (`auth.getUser(jwt)`), refreshes it when expired, and maps
    `auth_user_id` → `principal`.
- **Principal mapping and device merge:**
  - First login creates a `typ='konto'` principal.
  - On first login from a device, that device's anonymous principal (its
    analyses) is merged into the account (`sla_samman_principal`, already in
    the konto migration).
  - **Decision:** merge only the device used at the moment of login, never
    retroactively other devices.
- **Server functions** (implemented in a new `src/server/auth.ts`, wired in
  `analysFn.ts`):
  - `registreraKontoFn`, `loggaInFn`, `loggaUtFn`, `begarAterstallningFn`,
    `bekraftaEpostFn` (token_hash → session), `sattNyttLosenordFn`, `hamtaSessionFn`.
  - Token links use the PKCE-less `token_hash` flow: the email template links
    to `https://binfo.slanesens.com/konto/bekrafta?token_hash=…&type=signup|recovery`,
    and the server calls `auth.verifyOtp`.
- **Security by default:**
  - Passwords are hashed by Supabase (bcrypt); we never see or store them.
    Minimum 10 characters, plus Supabase's leaked-password check if the plan
    allows it.
  - Rate limits: Supabase's built-in auth limits, plus our own `kvot`:
    - login: 10/IP per 15 min and 5/email per 15 min;
    - signup: 5/IP per hour;
    - reset: 3/email per hour and 10/IP per hour.
  - Enumeration-safe copy: "Om adressen finns skickar vi ett mejl."
  - The CSRF middleware already covers server functions.
- **"RLS or equivalent":**
  - The browser has no DB access at all.
  - Every per-user read and write goes through a server function that filters
    on the session's `principal_id`. Ownership is checked in one helper
    (`kravAgare`), and tests try cross-account reads.
  - RLS stays on with zero policies, as defence in depth.
  - `verify-rls` is extended to the new tables.
- **Analysis UUID reads:** unchanged (capability URL). The profile is the only
  list view and only lists the session's own rows.

### 1.3 Data model (new migration `20261013120000_konto_v3.sql`)
- `sparad_vardering`:
  - columns: `id uuid pk`, `principal_id fk cascade`, `etikett text null`
    (e.g. address typed by the user), `input jsonb` (`PrisInput`),
    `resultat jsonb` (`PrisuppskattningResultat` snapshot), `modell_version text`,
    `skapad`;
  - index on `(principal_id, skapad desc)`.
- `sparad_kalkyl`:
  - columns: `id`, `principal_id`, `etikett`, `input jsonb` (the full calculator
    state, schema `KalkylUnderlagSchema` v1), `sammanfattning jsonb` (total/mån,
    belåningsgrad, amorteringstakt for the list view), `regelversion text`,
    `skapad`, `uppdaterad`;
  - same index.
- **"Remove from my list":** deletes the user's `analys` row through the
  existing `radera_analys` (keeps the PDF while `rapport_fil` references it,
  never touches `rapport`). The analysis URL then shows "hittades inte", and
  the dialog says so.
- **`radera_principal`** is replaced (new migration, never edit applied ones)
  to also delete `sparad_*` rows. Account deletion is principal delete +
  `auth.admin.deleteUser`.
- **Retention:** `sparad_*` rows are kept until the user deletes them or the
  account. They are personal data the user chose to save, so they are exempt
  from the 12-month anonymisation (same basis as an account). The privacy text
  must say this (an owner task).
- **Export:** `konto exportera` is extended to the saved objects, plus a
  `hamtaMinaUppgifterFn` that returns the same JSON as a download.

### 1.4 Frontend
- **Routes** (all `noindex`):
  - `/konto/logga-in`, `/konto/skapa`, `/konto/glomt-losenord`,
    `/konto/bekrafta` (landing for email links: verifies, then redirects),
    `/konto/nytt-losenord`;
  - `/konto` (profile, requires a session; otherwise redirects to log in with
    `?till=/konto`).
- **`SiteNav`:** adds "Logga in" or "Mitt konto" at the right. The current
  nav is a flat wrapping row: on mobile I keep the wrap behaviour and flag a
  hamburger menu for Lovable.
- **Profile:** three sections ("Analyser", "Värderingar", "Bolånekalkyler").
  - Each entry is a row: date, label, 2–3 key figures, "Öppna", and
    "Ta bort"/"Radera" behind a confirm dialog (shadcn `alert-dialog`, already
    in the repo).
  - Plus "Radera konto" and "Ladda ner mina uppgifter".
  - Empty states have a call to action ("Gör din första priskoll").
- **Re-open:**
  - `/vardering?sparad=<id>` renders the snapshot, with "Räkna om med dagens
    modell" next to it.
  - `/bolanekalkyl?sparad=<id>` loads the stored inputs into the calculator
    (exports available there).
  - Reports open at `/analys/<id>` as today.
- **The Spara flow for a logged-out user:**
  1. The page serialises its inputs to `sessionStorage['binfo:utkast:<typ>']`
     (Zod-validated, 24 h expiry, never put in the URL).
  2. It navigates to `/konto/logga-in?till=<path>&spara=<typ>`.
  3. After login, or after the verification link (same tab or a new tab —
     the draft also goes to `localStorage` for 24 h so the email link opened
     in a new tab still finds it), the page restores the draft and completes
     the save with a confirmation.
- **`senasteAnalyser`:** when logged in, `AnalysHistorik` is swapped for the
  account list (the seam already exists). localStorage stays for anonymous
  users.

### 1.5 Tests
- **Unit:**
  - cookie set/clear/refresh;
  - `losKontext` with no session, a valid session, an expired session that
    refreshes, and an invalid one;
  - device → account merge happens once;
  - `kravAgare` denies another principal (every new server function gets a
    cross-account test);
  - kvot limits for login, signup and reset;
  - draft serialise/restore (expiry, schema mismatch → ignored).
- **SQL on the local Supabase stack:**
  - new tables, cascades, `radera_principal` v2;
  - `verify-rls` extended (publishable key cannot read `sparad_*`).
- **E2E on the local stack** (`v2-lokalt.sh`, whose Inbucket/Mailpit catches
  email), with Playwright from the scratchpad:
  - sign up → verify → log in → save a valuation → save a kalkyl → profile
    lists both → re-open both → delete;
  - forgot password → reset → log in;
  - logged-out Spara → signup → verify in a new tab → returns with inputs
    saved.

### 1.6 Risks
- **Email deliverability.** The built-in Supabase mailer is rate-limited
  (a few emails an hour). Production needs custom SMTP (Resend) with SPF/DKIM
  on slanesens.com, which is an owner task.
- **Cloudflare Workers + supabase-js auth.** It is fetch-based and should be
  fine, but it must be verified under workerd (`wrangler dev`) before publish.
- **Cookie size.** Two cookies under 4 kB each; checked in a test.
- **Lovable editing `SiteNav` or the auth pages concurrently.** The owner
  avoids Lovable edits on those files until merged.

### 1.7 Acceptance criteria (owner can check)
1. You can create an account at `/konto/skapa`, receive a Swedish verification
   email, click it, and land logged in.
2. A wrong password shows a generic error. After about 10 rapid wrong
   attempts you get "För många försök, vänta en stund."
3. "Glömt lösenord" sends an email whose link lets you set a new password. The
   old password stops working.
4. Logged out on `/bolanekalkyl`: fill in the inputs, click Spara, create an
   account, verify, and you're back with the same numbers and a "Sparad"
   confirmation.
5. `/konto` lists your analyses, valuations and kalkyler, with date and key
   figures. "Öppna" restores each in full. Valuations and kalkyler can be
   deleted. A report can be removed from the list, and the dialog explains the
   register keeps it.
6. A second account cannot open the first account's saved items (IDs swapped
   in the URL → "hittades inte").
7. "Radera konto" removes the account and its saved items. You can no longer
   log in.

---

## 2. Feature B — Public BRF register

### 2.1 Scope
- Public, indexable pages:
  - `/brf` (index of areas, with counts and a search box);
  - `/brf/omrade/<omrade>` (BRFs in that area; searchable and sortable by
    skuld/kvm bostadsrättsyta, årsavgift/kvm, sparande/kvm, betyg,
    analysdatum);
  - `/brf/<namn-slug>-<orgnr>` (latest analysis + earlier years).
- Stockholms kommun only (listed). Other BRFs stay in the register, unlisted.
- **A BRF page shows the BRF-level analysis only:**
  - the seven nyckeltal with page references and grading;
  - betyg and motivering, röda flaggor, frågor till styrelsen;
  - fiscal year, analysis date, data quality (scan marker);
  - earlier years as a compact table plus expandable sections.

  It never shows buyer data. Call to action: "Analysera en lägenhet i
  föreningen" → `/analysera` with the orgnr prefilled. Upload of that BRF's
  report is then an instant register hit; a future "use the register report
  without uploading" is listed in §6 as a follow-up.
- "Hittar du ett fel? Kontakta oss" (mailto) on every BRF page.

### 2.2 Area taxonomy (register display layer; the valuation model is untouched)
Built from the 117 Stockholms stad stadsdel polygons already in the repo
(`ml/mapping/sources/stadsdelar_fullsize.geo.json`, CC0) via a new crosswalk
`ml/mapping/stadsdel_registeromrade.csv`, with a source per row. There are 19
areas:

| Register area | Stadsdelar (SBK polygons) |
|---|---|
| Gamla stan | Gamla Stan, Riddarholmen, Skeppsholmen |
| Norrmalm | Norrmalm |
| Vasastan | Vasastaden |
| Östermalm | Östermalm |
| Djurgården & Gärdet | Djurgården, Norra Djurgården, Ladugårdsgärdet, Hjorthagen |
| Kungsholmen | Kungsholmen, Marieberg, Stadshagen, Fredhäll, Kristineberg |
| Essingeöarna | Lilla Essingen, Stora Essingen |
| Södermalm | Södermalm, Långholmen, Reimersholme |
| Hammarby sjöstad | Södra Hammarbyhamnen |
| Liljeholmen & Hägersten | Liljeholmen, Gröndal, Aspudden, Midsommarkransen, Hägersten, Hägerstensåsen, Västertorp, Fruängen, Mälarhöjden, Västberga |
| Älvsjö | Älvsjö, Herrängen, Långbro, Solberga, Liseberg, Långsjö, Örby Slott |
| Årsta & Johanneshov | Årsta, Johanneshov, Östberga |
| Enskede | Enskede Gård, Gamla Enskede, Enskedefältet, Stureby, Bandhagen, Högdalen, Örby, Rågsved, Hagsätra |
| Skarpnäck | Hammarbyhöjden, Björkhagen, Kärrtorp, Bagarmossen, Skarpnäcks Gård, Enskededalen, Flaten, Orhem, Skrubba |
| Farsta | Farsta, Farsta Strand, Farstanäset, Gubbängen, Hökarängen, Sköndal, Svedmyra, Tallkrogen, Fagersjö, Larsboda |
| Skärholmen | Skärholmen, Bredäng, Sätra, Vårberg |
| Bromma | all Bromma stadsdelar (Abrahamsberg … Ålsten) |
| Hässelby-Vällingby | Grimsta, Hässelby Gård/Strand/Villastad, Kälvesta, Nälsta, Råcksta, Vinsta, Vällingby, Beckomberga? (per SDO) |
| Kista & Järva | Akalla, Husby, Kista, Rinkeby, Tensta, Bromsten, Flysta, Lunda, Solhem, Sundby, Hansta |

Every one of the 117 polygons gets exactly one area, checked by a test. Rows
marked "?" are resolved against Basområdeslistan 2026 by the data agent and
cited.

**How a BRF gets its area**, in priority order:
1. **The BRF's own address from its årsredovisning (new; see 2.3).** The
   street address is geocoded offline to a point, then point-in-polygon to a
   stadsdel and then to an area.
   - Geocoding uses Nominatim (OSM; usage policy 1 req/s; bulk/offline only;
     the result is cached on `forening`).
   - At runtime, for user uploads, the address's postnummer goes through a
     precomputed `postnummer → stadsdel` majority table. That table is a new
     output of `ml/mapping/build_postnummer_omrade.py`, from the same OSM
     points.
2. **Bulk-import metadata** (CSV `adress`/`postnummer`), via the same path.
3. **Fallback: buyers' postnummer** (`forening_adress kalla='anvandare'`),
   majority vote.
4. **None of the above:** listed under "Övriga Stockholm" if the kommun is
   0180; otherwise unlisted.

Stored as `forening.registeromrade`, `forening.omrade_kalla`
(`rapport_adress | import | anvandare`) and `forening.slug`, recomputed by the
worker after extraction and by the importer.

**Licensing:**
- The stadsdel polygons are CC0.
- OSM-derived points and Nominatim results are ODbL. We publish only the area
  name per BRF, not the derived dataset. That reading is recorded as a
  decision, and ODbL attribution goes in the footer of register pages.

### 2.3 Pipeline change: the BRF's address (contract change, owner-approved)
- **Contract (`src/types/analysis.ts` + `schema.ts`), additive:**
  - `ForeningData.adresser?: Array<{ gatuadress, postnummer, ort, ref }>`
  - `ForeningData.fastighetsbeteckningar?: Array<{ beteckning, ref }>`

  Each item is cited like every other figure (no citation → not stored).
  Optional, so old stored results still parse.
- **Prompts:** grounding gets one more finding category ("föreningens
  fastighet(er) och adress(er)"), and extraction gets the fields.
  `PROMPT_VERSION` 6 → 7, so `PIPELINE_VERSION` becomes `p7.i1.s1`.
  - Existing register reports re-run lazily (about 3 kr each, on access).
    Production's register is empty until the v2 deploy, so the cost is about 0.
  - **The web app and the Edge Function deploy together.**
- **Writer:** `forening_adress kalla='rapport'` rows are written from the
  extraction (the column already exists; today it has no writer).
- **Regression:** the 13 answer-key reports plus Pontonjären must keep their
  nyckeltal score (64/65 baseline on the 3-report set; full-set baseline
  measured first). Addresses are checked by hand against the PDFs.

### 2.4 Pipeline change: page-reference verification (fixes a production gap)
`verifieraSidreferenser(extraction, sidtexter)` is new, pure and deterministic.
- **Page text:**
  - text PDFs: per-page pdf.js text (`extractPdfText`);
  - scans: `sidtext`.
- **Matching:** each `ref.excerpt` is normalised (whitespace, hyphenation,
  digit grouping) and matched on its cited page.
  - Found → ok.
  - Found on exactly one other page → page corrected, logged.
  - Not found → `Figure.osaker` + a question, confidence ≤ medel. Never hidden;
    same treatment as the sanity checks.
- **Runs:** in production after extraction, and in the bulk importer. It is
  the shared validator's last step.
- Free; no API calls.

### 2.5 Backend
- New `src/server/registerPublik.ts` (read-only, secret key, server-side):
  - `listaOmraden()`: area, BRF count, last updated.
  - `listaForeningar(omrade, {sok, sortering, sida})`: one row per BRF with the
    latest done rapport's nyckeltal.
  - `hamtaForening(slug)`: forening + all done rapporter (latest per year) as
    BRF-level views, built by the existing `tolkaRapportInnehall`, never
    `select *`.
- **Performance:**
  - A new SQL view `register_sammanfattning`, materialised per BRF
    (orgnr, slug, namn, area, latest år, the 7 nyckeltal + betyg as columns),
    refreshed by the worker on rapport completion and by the importer. The
    area list and sort run on it.
  - `pg_trgm` index on `namn` for search.
  - Pages are cached at the edge with `Cache-Control: public, s-maxage=3600,
    stale-while-revalidate=86400`.
- **Server functions:** `hamtaRegisterOmradenFn`, `hamtaRegisterOmradeFn`,
  `hamtaRegisterForeningFn` (public, rate-limited per IP, 300/h).
- **SEO:**
  - A `/sitemap.xml` server route lists static pages + areas + BRFs with
    `lastmod`. `robots.txt` gets a `Sitemap:` line.
  - Per-page `head()`:
    - title "Brf Pontonjären 3, Kungsholmen: nyckeltal och analys | Binfo";
    - a description with real figures ("Skuld 4 799 kr/kvm, sparande 183
      kr/kvm enligt årsredovisningen 2025…");
    - canonical, og:url, `og:image` (a single static brand image for now;
      dynamic OG images go on the follow-up list).
  - JSON-LD: `Organization` (name, `taxID`, address) + `BreadcrumbList`.
  - Also `noindex` on `/analys/*`, `/forhandsvisning/*` and `/konto/*`, and
    Swedish 404/error pages (they're English today).
- **Slugs:** `slugify(namn)` (å→a, ä→a, ö→o, lowercase, hyphens) + `-` +
  orgnr. A name change keeps the old slug as a 301 redirect via `forening_slug`
  history (a small table).

### 2.6 Frontend
- **`/brf`:**
  - an intro paragraph (what the register is, that the figures come from each
    association's årsredovisning, what "betyg" means, with a link to `/exempel`);
  - a search box (name or orgnr → results across areas);
  - area cards grouped Innerstaden / Söderort / Västerort / Norr, with counts.
- **`/brf/omrade/<omrade>`:**
  - a short area intro;
  - a table: name, betyg (`StatusLabel`), skuld/kvm, avgift/kvm, sparande/kvm,
    år, analysdatum;
  - sort through clickable headers with `aria-sort`, a search filter, and
    pagination at 50 rows;
  - on mobile, rows become cards (same pattern as `PropertySummary`).
- **`/brf/<slug>`:**
  - an orientation block: name, orgnr, area, fiscal year, analysed date;
  - the BRF-level part of `AnalysRapport`, reusing its sections (nyckeltal,
    flags, questions). This needs a small refactor so `AnalysRapport` can
    render without `prisanalys`/`input`; it is planned as a pure extraction of
    sub-components with no visual change;
  - earlier years as a compact year × nyckeltal table;
  - the call to action.
- **Nav:** "BRF-register" link in `SiteNav`.
- **Loading/empty/error:**
  - An area with 0 BRFs shows an empty state with the call to action
    "Ladda upp en årsredovisning så hamnar föreningen här".
  - An unknown slug returns a 404 with a link back to `/brf`.

### 2.7 Tests
- Slugs and the redirect for a renamed BRF.
- Crosswalk completeness (117/117).
- Area resolution priority (rapport address > import > buyer; "Övriga").
- Register view excludes buyer data (snapshot of the server payload keys).
- Sort and search.
- `sitemap.xml` is well-formed and contains only listed BRFs.
- `head()` output per page (title, canonical, JSON-LD parse).
- Page-ref verifier on synthetic and real page texts (all 14 PDFs, free).

### 2.8 Risks
- **Thin coverage at launch** (an empty register looks bad). Mitigated by
  Feature C (bulk) before launch and by hiding areas with 0 BRFs from the
  index (they're shown greyed out).
- **Wrong area for a BRF with properties in several stadsdelar.** The first
  address wins and every address is shown.
- **Publishing a grade about a named association** (reputational). Mitigated:
  the methodology is linked, the source is every figure's page reference, and
  the "Hittar du ett fel" contact.
- **SEO thinness:** each page has real, unique figures. hemklar (≈190 pages)
  is the bar.

### 2.9 Acceptance criteria
1. `/brf` lists the areas with counts. The search finds "Pontonjären" and
   "716420-0599".
2. `/brf/omrade/kungsholmen` lists BRFs sortable by skuld/kvm, avgift/kvm,
   sparande/kvm, betyg and date, with keyboard-operable sort headers.
3. `/brf/brf-pontonjaren-3-716420-0599` shows the 2025 analysis with page
   references and no buyer data. Earlier years appear when present.
4. `https://…/sitemap.xml` lists the BRF pages. View-source shows
   title/description with figures, canonical and JSON-LD (validated with
   Google's Rich Results test).
5. Uploading a report for a BRF that is already in the register returns the
   analysis instantly (0 kr; visible in `register -- list`).
6. A newly analysed Stockholm BRF appears in the right area automatically.

---

## 3. Feature C — Offline bulk analysis

> **CUT 2026-10-13 (owner):** no bulk pre-population for now; the register fills
> from user uploads only. §3.1 is kept as the cost record for a later decision;
> §3.2–3.6 are not built in v3 (W8, W9 and the pilot are dropped).

### 3.1 Cost comparison (deliverable `docs/bulk-kostnad.md`; summary here)

| Route | Cost per text report | Per scan (≈25 p) | Throughput | Verdict |
|---|---|---|---|---|
| (a) Current API path (measured, n=8) | 3.2 kr (1.98–3.82); ≈ $0.33 | ≈ 5.3 kr | Sequential; ~1–2 min each; limited by our own daily cap | Baseline |
| (b) Message Batches API (50 % off input+output; PDFs, citations and effort supported) | ≈ 1.6 kr | ≈ 2.7 kr | 100k requests/batch; most batches < 1 h, max 24 h; 3 rounds (text) or 5 (scan) → a 300-report run completes in a few hours | **Recommended** |
| (b) + prompt caching | ≈ 1.55–1.6 kr | ≈ 2.6 kr | Same; cache hits best-effort in batches | Marginal (no large repeated prefix: the PDF is read once; system prompts ≈ 2k tokens) |
| (b) + ground text PDFs on pdf.js text instead of the native PDF | ≈ 0.9 kr (est.; scan-path grounding is 15–28k tokens vs 95k) | — | Same | Promising but unmeasured; a quality A/B is a follow-up, not in scope |
| (c) Claude Code / chat on a Pro/Max subscription | "Free" at the margin | — | Unpublished 5-hour and weekly caps (~tens of reports per window at best, with attention needed) | **Not allowed and not equivalent** |

Why (c) is out:
- The Consumer Terms ban automated access except via an API key, and the EEA
  version bans commercial use.
- The Claude Code docs direct developers building products to API keys.
- It has no Citations API, so page references would be self-reported. That
  breaks Binfo's core rule.

### 3.2 Pipeline design
The batch path must produce the same result as production, so it reuses
production's request builders, parsers and validators. The refactor that
makes this possible:

- **Split build/parse.** Each stage in `src/lib/analysis` gets a pure
  `byggXRequest(...) → MessageCreateParams` and `tolkaXSvar(message, ...) →
  result`. Today's sync functions become `tolkaXSvar(await
  client.messages.create(byggXRequest(...)))`, so production uses exactly the
  same code.
  - Stages: identity, transcription chunk, grounding, extraction, judging.
  - Golden tests prove the production request bodies are byte-identical before
    and after the refactor.
- **Shared validator `slutforAnalys(extractionRaw, judgementRaw, sidtexter)`.**
  It factors out today's strip/fill/override → Zod → reconciliation, grading
  and sanity checks → page-ref verification (2.4) → judging validation with
  the allowed-page check. Production and the importer both call it.
- **Provenance.** A new `rapport.proveniens` (`api | batch | offline-session`)
  and `rapport.proveniens_detalj jsonb` (model, prompt_version,
  pipeline_version, batch ids, created). Production writes `api`. It shows in
  `register -- inspect`. It is not shown to buyers, so there is no contract
  change (`Datakvalitet` is untouched).

### 3.3 The bulk tool (`npm run bulk -- <cmd>`; CLI in `src/lib/analysis/bulk/`)
Folder layout `bulk/<körning>/` (gitignored):
- `inkorg.csv`: columns `fil, orgnr, namn, rakenskapsar, adress, postnummer`.
  orgnr/år are optional and the identity stage fills them.
- `ko.jsonl`: one line per item with state.
- `resultat/<orgnr>-<år>.json`
- `fel.jsonl`
- `batcher.jsonl`

Commands:
1. `forbered <körning>`:
   - hashes each PDF and runs local identity (free); Haiku identity via batch
     only if needed;
   - classifies the text layer;
   - skips any (orgnr, år) that already has a done rapport at the current
     `PIPELINE_VERSION` in the register, or a result file;
   - writes `ko.jsonl`.
2. `kor <körning>`:
   - submits the next round for every item ready for it (transcription chunks →
     grounding → extraction → judging) with `custom_id = <itemId>:<stage>`;
   - polls until each batch ends, then parses each response with the shared
     `tolkaXSvar`;
   - advances state;
   - a validation failure gets one retry in the next round; the second failure
     goes to `fel.jsonl` with the reason.
   - Re-runnable at any point: state is on disk and batch ids are recorded, so
     an interrupted run resumes by polling the existing batches.
3. `validera <körning>`: re-runs `slutforAnalys` on every result file and
   prints a pass/fail table (free).
4. `importera <körning> [--torr]`: for each valid result file it upserts
   `forening`, then a `rapport` (`status done`, `stage klar`,
   `pipeline_version`, `proveniens batch`, cost), `rapport_fil` (uploading the
   PDF to the bucket), `forening_adress kalla='rapport'` and the register area,
   then refreshes `register_sammanfattning`.
   - Same path as `backfillLegacy`, via the `Databas` port, so it is tested
     against the in-memory fake.
   - Idempotent: an existing live rapport at the same version is skipped.
5. `jamfor <pdf…>`: runs the same reports through the sync production path and
   the batch path and writes a field-by-field diff report
   (`docs/bulk-jamforelse.md`).
- **Spend guard:**
  - token estimates from `countTokens` (free) before submit;
  - refuses above `--tak <kr>` (default 100 kr per run);
  - logs to `docs/api-test-log.md` automatically.
- **Handoff format for any other processor:**
  - the queue + per-item result JSON + `validera` + `importera`;
  - a processor only has to write `resultat/*.json` in the documented shape
    (the raw stage outputs plus the custom-content page map), with
    `proveniens` set;
  - the format is documented in `docs/bulk.md`.

### 3.4 PDF sources
- **Spike (½ day):**
  - does Bolagsverket's high-value-data API (free; commercial reuse allowed)
    list and serve årsredovisning documents for ekonomiska föreningar
    (bostadsrättsföreningar)?
  - Are FY2025 filings available yet?
  - What format: PDF/iXBRL/scan?
  - Rate limits and authentication?
- **If yes:** `npm run bulk -- hamta-bolagsverket <orgnr-lista>` writes the
  PDFs + `inkorg.csv`.
- **If no:** the owner supplies a folder + CSV. The pipeline is the same.
- **Orgnr lists for Stockholm BRFs:** from Bolagsverket's open data (legal
  form BRF, säte Stockholm) if available; otherwise owner-provided.
- **No scraping of estate-agent CDNs.**

### 3.5 Tests
- Golden request-body tests (prod == batch builder).
- Shared validator on stored real outputs (`docs/api-runs`).
- Queue state machine: resume after a crash mid-round, skip done items, retry
  once then `fel.jsonl`.
- Importer against `__fakes__` (idempotent: running twice = same rows).
- Importer on the local Supabase stack (real SQL).
- A mocked Batches client (record/replay) for CI.

### 3.6 Acceptance criteria
1. `docs/bulk-kostnad.md` shows the comparison with measured per-report costs
   from the pilot (not just estimates).
2. The 10-report production-vs-batch comparison
   (`docs/bulk-jamforelse.md`):
   - equal nyckeltal on ≥ 95 % of fields;
   - every difference explained;
   - page references verified on 100 %;
   - nyckeltal score on the answer keys no worse than production's.
3. After an interrupted `kor`, re-running finishes without re-submitting
   finished stages or paying twice (visible in `batcher.jsonl` and the log).
4. `importera` twice gives the same register (no duplicates). Imported BRFs
   appear on `/brf` in the right area.
5. Pilot at ≤ 2 kr per text report average. It starts with the 14 reports in
   `annual reports examples/` (owner decision 2026-10-12; only ~4–7 are in
   Stockholm, so it tests the machinery more than coverage). It grows to 50
   Stockholm reports when the owner's new folder arrives.

---

## 4. Feature D — Bolånekalkyl: rules, KALP, PDF and Excel export

### 4.1 Rules (verified 2026-10-12; any later change needs a new entry)
A single rules registry, `src/lib/kalkyl/regler.ts`, has one entry per rule:
`{ id, namn, varde, kalla (title + URL), galler_fran, verifierad }`. It is
consumed by the calculator, the PDF and the Excel "Regler och antaganden"
sheet.

| Rule | Value | Source |
|---|---|---|
| Bolånetak | 90 % (min. 10 % kontantinsats) | Lag (2026:226) §4, from 2026-04-01 |
| Amortering | > 70 % → 2 %; > 50–70 % → 1 %; ≤ 50 % → 0 (on the highest loan since the last valuation) | SFS 2026:226 §7 |
| Nyproduktion | lender may waive amortisation ≤ 5 years (first buyer) | §10 (information only) |
| Skärpt amorteringskrav | abolished | prop. 2025/26:119 |
| Ränteavdrag | 30 % up to 100 000 kr interest per person/year, 21 % above; limited by tax paid | Skatteverket, inkomstår 2026 |
| Income tax 2026 | kommunalskatt Stockholm 30.55 %, statlig 20 % above skiktgräns 643 000, grundavdrag, jobbskatteavdrag, PBB 59 200, IBB 83 400 … | **to verify:** each constant in `skatt2026.ts` is checked against Skatteverket/SCB in W6 and gets a cited source (today none is cited) |
| Living costs (KALP) | Konsumentverket Hushållskostnader 2026 (food by age, individual costs, shared household costs by size) | Konsumentverket, published 2025-11-18 |
| Kalkylränta (stress) | 7 % default, user-editable | Not regulated; banks set it themselves; labelled "antagande" |
| Driftsschabloner | el, värme, vatten, bredband, hemförsäkring | **Unsourced placeholders**: labelled "Schablon (uppskattning)"; sourcing is a follow-up |
| Bankernas skuldkvotstak | ~5–6× (info only) | Secondary sources; labelled "antagande" |

### 4.2 Calculator changes (functional, inside the visual boundary)
- **Refactor first (no behaviour change, covered by tests).** The route's
  inline math moves into `src/lib/kalkyl/berakna.ts`:
  `beraknaKalkyl(underlag: KalkylUnderlag) → KalkylResultat`.
  - It covers kvar att leva på, override deltas, tier badges and the
    kontantinsats check.
  - `KalkylUnderlag` (Zod, versioned) is also the saved-kalkyl and export
    input.
- **Fix:** a single ränteavdrag computation everywhere: per person, interest
  split equally, limited by each person's tax (`beraknaHushallSkatt`). The
  monthly total and "Tillbaka i deklarationen" then always agree.
  - When income is empty, the total shows ränteavdrag at full rate with a note
    "förutsätter att ni betalar tillräckligt med skatt". Explicit, not silent.
- **Add KALP:**
  - inputs: number of adults, children by age band (0–3, 4–6, 7–10, 11–14,
    15–17), kalkylränta;
  - output: "Kvar att leva på enligt bankens kalkyl" = net income − (loan ×
    kalkylränta + amortisation + avgift + drift + Konsumentverket living costs),
    with a clear verdict ("Marginal" / "Tight" / "Underskott").
  - Thresholds for those words: **no invented numbers.** The verdict is only
    the sign (≥ 0 / < 0), plus the amount.
- **Add an interest scenario table:** your rate, +1, +2, +3 pp, and the
  kalkylränta; the fee is stressed via räntekänslighet when known.
- **Input hygiene:** comma and space accepted (`type="text"` + `inputMode="decimal"`),
  NaN guarded, range checks with `aria-invalid` + `aria-describedby` on
  `Field`. That is an additive, non-visual kit prop; flagged for Lovable.
- **Buttons:** "Spara", "Ladda ner PDF", "Ladda ner Excel" at the bottom of
  the results.

### 4.3 PDF export
- `src/components/pdf/KalkylPdfDocument.tsx` + `kalkylViewModel.ts` (pure),
  reusing `fonts.ts`, `theme.ts` and the lazy `download.tsx` pattern
  (client-only).
- Sections:
  1. header (Binfo, date, label);
  2. inputs;
  3. monthly cost breakdown (interest before/after deduction, amortisation,
     avgift, drift with schablon marking);
  4. amortisation basis (belåningsgrad, tier, rule);
  5. interest scenarios table;
  6. KALP result;
  7. "Regler och antaganden" (each rule with its source and date);
  8. disclaimer.
- A4, print-ready, 2–3 pages.

### 4.4 Excel export (`.xlsx`, live formulas)
- **Library:** `exceljs`, MIT, lazy-loaded client-side only.
- **Sheets:**
  1. **Indata:**
     - every input in a named cell (`Lanebelopp`, `Kontantinsats`, `Ranta`,
       `Inkomst1`, …);
     - input cells styled as inputs (light fill), with data validation (number
       ranges, list for ja/nej/vet ej) and a hint column.
  2. **Beräkning:**
     - the whole calculation as formulas referencing `Indata` and `Regler`:
       - belåningsgrad and amorteringstakt (`IFS`);
       - interest, amortisation;
       - the 2026 income tax per person: grundavdrag, jobbskatteavdrag,
         kommunal/statlig skatt, public service, as piecewise
         `IF`/`MIN`/`MAX` formulas mirroring `skatt2026.ts`;
       - ränteavdrag per person, limited by tax;
       - drift (schablons + ja/nej/vet ej);
       - total;
       - KALP.
     - The scenario table is formulas too.
  3. **Regler och antaganden:** every rule value in a named cell with source,
     URL and date. Changing a rule (e.g. 90 % → 85 %) recomputes everything.
  4. **Om filen:** generated date, Binfo version, disclaimer.
- Formatting: SEK number formats, frozen headers, column widths, print area,
  no external links.
- **Verification that formulas compute what the app computes:**
  - `npm run test:xlsx` (or a vitest suite) loads the generated workbook,
    evaluates the formulas with a formula engine and compares against
    `beraknaKalkyl` on 50 randomised scenarios, ±1 kr.
  - Engine: `hyperformula`, which is GPL/commercial and therefore a
    devDependency used in tests only. Shipping it is ruled out; if its licence
    is unacceptable even for tests, LibreOffice headless recalculation in a
    script instead.
  - Plus a manual open in Excel/Numbers/LibreOffice (screenshots).

### 4.5 Tests
- Unit tests for every rule in `regler.ts` (thresholds at 50/70 % boundaries;
  ränteavdrag at 100k per person, 1 vs 2 borrowers, low income).
- `beraknaKalkyl` parity with the old route output on a fixture set (before
  the ränteavdrag fix), then the intended diffs after it.
- KALP against hand-computed Konsumentverket examples.
- PDF view-model snapshot plus text extraction of the generated PDF.
- The xlsx formula parity suite.

### 4.6 Acceptance criteria
1. On `/bolanekalkyl` the monthly total and "Tillbaka i deklarationen" agree
   for a low-income single borrower (today they don't).
2. "Ladda ner PDF" gives a 2–3 page A4 summary with every section in 4.3 and
   cited rules.
3. "Ladda ner Excel" opens in Excel/Numbers/LibreOffice with no warnings.
   Changing `Ranta` or `Inkomst1` on Indata changes every dependent figure.
   Changing the bolånetak on the Regler sheet changes the kontantinsats check.
4. Excel and the app agree (±1 kr) on 50 randomised scenarios (test output).
5. Both exports are available from `/konto` for each saved kalkyl.

---

## 5. Work breakdown and parallel execution

### 5.1 Workstreams

| WS | Owner (agent) | Owns (exclusive files) | Depends on |
|---|---|---|---|
| **W0** Prereqs | supervisor + owner | v2 deploy steps; `.claude/settings.json`; lint-fix commit; branch `v3`; `docs/DECISIONS.md`; contract edits in `src/types/analysis.ts` (adresser, fastighetsbeteckningar) | — |
| **W1** Auth + saved objects backend | `pdf-pipeline` (server scope) | `src/server/auth.ts`, `sessionCookies.ts`, `sparat.ts`, `kontext.ts` (session part), `kontoPortar.ts`, `supabaseKonto.ts`, `__fakes__/konto.ts`, migration `…_konto_v3.sql` + rollback, `cli/kontoCli.ts`, `cli/verifyRls.ts` | W0 |
| **W2** Accounts frontend | `frontend-state` | `src/routes/konto*.tsx`, `src/lib/utkast.ts`, `src/lib/session.ts`, `SiteNav.tsx` (auth link), Spara buttons in `vardering.tsx` | W1 interfaces (stubbed from day 1) |
| **W3** Pipeline: address + page-ref verifier + build/parse split + shared validator + provenance | `pdf-pipeline` | `src/lib/analysis/**`, `src/server/steg.ts`, `register.ts`, `portar.ts`, `supabase.ts`, `__fakes__/lager.ts`, Edge `index.ts`, migration `…_register_v3.sql` (proveniens, forening.slug/registeromrade, `register_sammanfattning`, pg_trgm) | W0 contract edit |
| **W4** Area mapping | `data-and-model` | `ml/mapping/**` (crosswalk, `postnummer_stadsdel` output, geocode script), `data/derived/*`, `src/lib/register/omraden*.ts` (generated data + resolver) | — |
| **W5** Register pages + SEO | `frontend-state` | `src/routes/brf*.tsx`, `src/routes/sitemap[.]xml.ts`, `src/server/registerPublik.ts`, `AnalysRapport` sub-component extraction, `__root.tsx` (404/error in Swedish, og defaults), `public/robots.txt`, `public/og.png` | W3 migration, W4 resolver |
| **W6** Kalkyl lib + rules + KALP + calculator UI | `frontend-state` | `src/lib/kalkyl/**`, `src/routes/bolanekalkyl.tsx`, `src/lib/skatt2026.ts`, `src/lib/analysis/calc/ranteavdrag.ts`, `ui/binfo.tsx` (`Field` aria props only) | — |
| **W7** Exports (PDF + XLSX) | `frontend-state` | `src/components/pdf/Kalkyl*`, `src/lib/kalkyl/xlsx.ts` + parity test | W6 `KalkylUnderlag`/`beraknaKalkyl` |
| **W8** Bulk tool | `pdf-pipeline` | `src/lib/analysis/bulk/**`, `docs/bulk*.md`, `package.json` script | W3 split + validator |
| **W9** Bolagsverket spike | `general-purpose` (research only) | `docs/bolagsverket.md` | — |
| **Integration** | supervisor | `src/server/analysFn.ts` wiring, `vardering.tsx`/`bolanekalkyl.tsx` Spara wiring when two WS touch them, `CLAUDE.md`, `docs/PLAN-v3.md`, merges | each WS |
| **Review** | `reviewer` per WS | read-only | each WS |

### 5.2 Waves and merge order
- **Wave 1 (parallel):** W1, W3, W4, W6, W9. No shared files.
  - W3 adds its migration and W1 adds its own. Different timestamps, no
    overlap.
- **Wave 2 (parallel):** W2 (on W1), W5 (on W3 + W4), W7 (on W6), W8 (on W3).
- **Merge order into `v3`:** W0 → W4 → W6 → W1 → W3 → W7 → W2 → W5 → W8.
  The supervisor rebases each WS on the latest `v3`, re-runs all checks, and
  then merges.
- **Wave 3 (supervisor):**
  - local-stack E2E for all flows;
  - Playwright screenshots at 390 px and 1280 px;
  - the pilot batch (50 reports) + production-vs-batch comparison;
  - the docs update;
  - the owner's acceptance walkthrough.
- **Production rollout (with the owner; after v3 is green):**
  1. kill switch on;
  2. `db push` (konto_v3, register_v3);
  3. `deploy:edge` (PROMPT_VERSION 7);
  4. Lovable publish;
  5. Supabase Auth settings (Site URL, redirect URLs, SMTP, templates);
  6. smoke test;
  7. kill switch off;
  8. `bulk importera` of the pilot into production (on owner OK).

---

## 6. Deliberately out of scope (follow-ups)
- Using a register report without uploading the PDF ("analysera lägenhet i
  föreningen" without a file). This needs a product decision on entitlement.
- Dynamic OG images per BRF.
- A quality A/B of grounding text PDFs over pdf.js text (≈ −1.5 kr/report).
- Sourcing the drift schablons.
- MFA.
- A mobile hamburger nav.
- Ranking pages ("lägst skuld på Södermalm").
- Re-analysis notifications.
- Haiku 5.5 for the identity stage (10× cheaper; needs an accuracy check).

## 7. Cost estimate (API)

| Item | kr | USD |
|---|---|---|
| W3 regression: 14 PDFs, PROMPT_VERSION 7 (address + verifier), one re-run margin | 50–70 | 5–7 |
| Production vs batch comparison, 10 reports (sync 3.2 + batch 1.6 each) | 50 | 5 |
| Local-stack E2E (accounts don't spend; 3 analyses) | 10–15 | 1–1.5 |
| Pilot bulk, 50 reports via batch (mix text/scan) | 80–100 | 8–10 |
| **Session total** | **≈ 190–235** | **≈ 20–24** (ceiling $30) |
| Optional full pre-population, 300 reports (after pilot review) | ≈ 500 | ≈ 52 (ceiling $60) |

Infrastructure: Resend free tier (3k emails/month). Supabase stays on Free;
Auth MAUs are far below the limit. No other paid services. Nominatim is free
at 1 req/s.

## 8. Owner tasks
1. Confirm in the Supabase dashboard that the `rapport` table exists and the
   `analys-steg` Edge Function was deployed on/after 2026-10-09 (or OK one
   production test upload, ≈ 3.5 kr). Then finish any missing v2 step together
   with the supervisor (W0).
2. Create a Resend account, verify the domain (SPF/DKIM DNS records for
   `binfo.slanesens.com` / `slanesens.com`) and give the SMTP credentials
   to the Supabase dashboard (instructions provided).
3. In the Supabase dashboard (instructions provided):
   - set Site URL and redirect URLs;
   - paste the Swedish email templates (provided in `docs/epostmallar/`).
4. A new folder of PDFs (+ CSV) for the full pilot. The pilot starts with the
   14 available reports meanwhile.
5. Update the privacy text (saved items, accounts, PDF retention basis). A
   draft is provided; legal sign-off is the owner's.
6. Don't edit `SiteNav`, `bolanekalkyl.tsx`, `vardering.tsx` or `__root.tsx`
   in Lovable until v3 is merged.
7. Acceptance walkthrough using §1.7, §2.9, §3.6 and §4.6.

## 9. Status log
| Date | Item | Status |
|---|---|---|
| 2026-10-12 | Phase 0 (6 agents), CLAUDE.md updated, Phase 1 answered (all defaults) | done |
| 2026-10-12 | This plan | approved by owner 2026-10-13 |
| 2026-10-13 | W0 done (branch v3, lint fix, settings, contract + KalkylUnderlag); Wave 1 launched (W1, W3, W4, W6, W9) | in progress |
| 2026-10-13 | W9 Bolagsverket spike: no free BRF source (docs/bolagsverket.md) | done |
| 2026-10-13 | Owner: bulk pre-population cut → W8/pilot dropped, W3 trimmed | decided |
| 2026-10-13 | W4 register areas merged (434c474): 19 areas, 117/117 stadsdelar, 1 440 postnummer | done |
| 2026-10-13 | W1 accounts backend merged (8fd48cb): fakes + mocks only, not yet on a real Supabase; 1739 tests green | done (live check pending) |
| 2026-10-13 | Hardening: password change needs reset marker or current password; account deletion needs password (f060f91) | done |
| 2026-10-13 | Account server functions wired in analysFn.ts; logout rotates device id (000e5f2); dev server clean | done |
| 2026-10-13 | W3 pipeline v7 merged (dfc7dab): addresses, page-ref verifier (457/457), register summary, Edge error logging; Albohem 6/6 clean | done |
| 2026-10-13 | Local stack: all 8 migrations apply; verify-rls 80/80 OK incl. saved-item tables | done |
| 2026-10-13 | Wave 2 launched: W2 accounts frontend, W5 register pages + SEO; W6 still running; W7 after W6 | in progress |
