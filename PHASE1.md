# Phase 1 — connecting the frontend to the real pipeline

The work that makes Binfo real: a buyer uploads their own årsredovisning and
gets their own analysis on screen. Read `CLAUDE.md` for the zone boundaries and
the working agreement, `PIPELINE.md` for how the analysis itself works, and
`SUPABASE.md` for the persistence and job layer this builds on.

`GOLIVE.md` is the origin document for this plan but is now **partly stale** —
it still names Cloudflare Workers as the runtime and lists the server zone as
an open proposal. `SUPABASE.md` superseded both. Where the two disagree,
`SUPABASE.md` is right.

---

## Where we actually are

Verified on 2026-09-13: `npm run typecheck` clean, `npm test` 386 passing
across 26 files.

**Done and verified live:** the analysis pipeline (`src/lib/analysis/`), and
the whole Supabase persistence and job-orchestration layer (`src/server/`,
`supabase/`). A real upload creates a job, `pg_cron` processes it in three
capped steps, and `npm run analys` prints a schema-valid `AnalysisResult`. The
largest report in the corpus (11,4 MB, never seen before) completed in 326 s
for 3,58 kr with no retries; an identical re-upload completed in ~2 s at
0,00 kr.

**Not done:** everything between the buyer and that pipeline. The UI still
reads `src/data/sampleAnalysis.ts`, a static fixture. The upload form on
`/analysera` is cosmetic — it holds a *filename string*, not a file.

So the frontend and backend agree on the **shape** of the data. They are not
**connected**.

---

## Decisions that shape this phase

Three decisions were made before starting, and they remove a lot of work that
earlier drafts assumed.

### 1. Loan data is client-side only

`/bolanekalkyl` becomes a standalone calculator. Lånebelopp, kontantinsats,
ränta, hushållets bruttoinkomst and antal låntagare are entered there and
computed in the browser using the existing pure functions in
`src/lib/analysis/calc/`. No server round-trip, no persistence, no new server
function. A user can land on `/bolanekalkyl` directly with no analysis at all
and enter everything by hand; arriving from a finished report pre-fills
`manadsavgift` as a convenience and nothing more.

This is smaller than it sounds, because it is close to how the screen already
works: `bolanekalkyl.tsx` already imports `beraknaManadskostnad` and
`rantestressScenario` and computes locally. It never read
`sampleAnalysis.manadskostnad`.

Consequences: `skapaAnalys` drops its `LaneUnderlag` argument;
`AnalysisResult.manadskostnad` and `PropertyInput.antalLantagare` leave the
contract; `antalLantagare` moves onto `LaneUnderlag`, where it belongs — it
exists only to set the ränteavdrag cap, which is a fact about the borrower's
loan, not about the apartment.

Nothing in the report UI breaks: `manadskostnad` has zero references in
`analys.tsx`, `forhandsvisning.tsx` and `PropertySummary.tsx`. And
`calc/rantestress.ts` already omits `totalManadskostnad` with an explicit
comment that it needs loan details which are not passed in — rate stress was
never coupled to loan data, so there is no cascade.

### 2. The paywall is deferred, not removed

The report screen renders the full analysis unconditionally — no blur, no lock
icons, no payment integration. But `gratisSektioner` stays in the contract and
the pipeline keeps populating it (`assemble.ts`); the report component simply
ignores it for now.

**One thing this phase must get right anyway.** Gating is server-side —
`GOLIVE.md` is explicit that blurring cards in CSS is not a paywall. If
`/forhandsvisning/$id` loaded from the same full-object endpoint as the report,
the preview page would already be shipping the complete analysis to an unpaid
browser, and turning payment on later would mean re-plumbing that route's data
source, loader and types — not flipping a conditional.

So the preview gets its **own** narrow server function from day one,
`hamtaForhandsvisning`, returning only the free sections. In Phase 1 that is
just a narrower read of data that happens to be free anyway. When payment
arrives, only `/analys/$id`'s loader gains a paid check, and `hamtaResultat`
stays what `SUPABASE.md` already calls it: the single place a full analysis is
handed out.

### 3. `/forhandsvisning` stays in the flow

It remains the landing point after an analysis completes — betyg, two red
flags, datakvalitet — but the "Lås upp för 249 kr" call to action becomes a
plain "Se hela analysen". Keeping the screen's structure means turning payment
on later is a copy change, not a re-route.

---

## Steps

### Step 0 — contract and schema

One reviewable commit, done alone and first, because everything else depends on
the resulting types.

- Remove `manadskostnad` from `AnalysisResult` and `antalLantagare` from
  `PropertyInput` in `src/types/analysis.ts`. **Keep** the `Manadskostnad`,
  `CostItem`, `CostItemId` and `Amorteringsunderlag` types — the client-side
  calculator still needs them.
- Move `antalLantagare` onto `LaneUnderlag` in `calc/manadskostnad.ts`.
- Update `schema.ts`, `assemble.ts` (which drops its `lan` parameter),
  `sampleAnalysis.ts`, `mockData.ts` and `fixtures/property-input-example.json`.
- Strip `LaneUnderlag` from the server zone: `portar.ts`, `analys.ts`,
  `analysFn.ts`, `supabase.ts`, `__fakes__/lager.ts`, `cli/analysCli.ts`.
- One forward migration making `analys.lan_underlag` nullable. The column is
  **not** dropped and the init migration is **not** rewritten — it is already
  applied to the live project, so the column stays as documented dead weight
  rather than churning a production table.

Tests first: the existing tests already encode the old contract, so they are
updated to encode the new one, watched to fail, and only then is the
implementation changed.

### Step 1 — unblock the zone boundary

`CLAUDE.md` says the UI reaches the server "only through
`src/server/analysFn.ts`'s `createServerFn` wrappers", but
`eslint.config.js` bans the pattern `@/server/*` from `src/routes/**` with no
carve-out for `analysFn`. No route imports it today, so the rule has never been
exercised — the first line of wiring trips it.

Carve out `@/server/analysFn` (and only that module) from the restricted group.
The rest of the server zone stays forbidden to the client, which is the point
of the rule.

### Step 2 — `/bolanekalkyl` standalone

Drop the `sampleAnalysis` import; add `antalLantagare` as a real field; accept
an optional `manadsavgift` pre-fill via search param. Entirely client-side,
works with no analysis in existence.

### Step 3 — the preview server function

`hamtaForhandsvisning`, per decision 2 above: a narrow read returning only the
sections `gratisSektioner` already names as free, plus the förening's name.
Server-zone only, with no UI wiring — deliberately landed on its own so the
paywall's seam exists before anything reads from it.

The narrowing is explicit field-by-field construction rather than a cast or a
spread-and-delete, and a test asserts on `Object.keys` that `prisanalys`,
`rantestress`, `fragor` and `input` are genuinely absent. That test is what
makes "turning the paywall on is a one-line change" a checked property rather
than an intention.

### Step 4 — the upload → job → result vertical slice

**This absorbs what earlier drafts split across steps 3 and 4.** They cannot
ship separately: an upload form whose submit handler navigates to a waiting
screen is broken until that screen exists, so the form, the job polling and the
failure screens are one deliverable.

- A real `<input type="file">` plus drag-and-drop, holding an actual `File` —
  today `/analysera` holds only a filename string, pre-seeded with a fake name.
- Blank the mockData pre-fills so a buyer starts from an empty form.
- POST to `skapaAnalysFn`, then navigate to `/analys/$analysisId`.

The measured cold run is 195–326 s. The form currently says *"Tar ungefär en
minut"*, which is wrong by three to five times.

- `/analys/$analysisId` polls `hamtaStatusFn`, with honest Swedish copy mapped
  to the real stages (*Läser årsredovisningen… Analyserar nyckeltalen…*) and a
  budget of **3–5 minutes**.
- All six `AnalysErrorCode` values get user-facing Swedish screens.
  `scanned_pdf` is first-class, not an edge case: **12,5 % of the real reports
  collected so far have no text layer**. That screen should explain what
  happened and what to do next — ask the broker or the board for the digital
  original — rather than reading as a generic failure.

### Step 5 — swap the fixture

`/analys/$id` and `/forhandsvisning/$id` read from route loaders.
`sampleAnalysis` survives as a genuine demo at `/exempel`: no upload, no API
cost, useful for the landing page and for developing UI without spending money.

---

## Deliberately out of scope

- **Payment.** Deferred by decision. See decision 2 for what Phase 1 does to
  keep it cheap to add.
- **Rate limiting and Turnstile.** The global daily spend cap and kill switch
  already exist and are live in `src/server/spend.ts`; per-IP limits and
  Turnstile do not, and are Phase 3 hardening.
- **`src/lib/uppgifter.ts`.** It is a module-level mutable singleton seeded
  from `mockData`. That is survivable while there is one static fixture, and
  becomes a real bug once a session can hold more than one analysis — state
  will leak between them. Worth fixing before launch, not during this slice.
- **Re-running `npm run verify-extraction`** against all answer-key fixtures.
  Listed in `GOLIVE.md` Phase 3 and still worth doing before real traffic.

---

## Open questions

**Does an analysis expire?** A report concerns an årsredovisning that is
superseded annually, and the uploaded PDF is deleted after 30 days, so a
cached förening cannot be re-run from source. Does the buyer keep access
forever? Affects storage and, once payment exists, refund policy. Not blocking
this phase.
