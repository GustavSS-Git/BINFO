# Going live — connecting the frontend to the real pipeline

Plan for turning Binfo from "UI renders a baked-in sample" into "a buyer
uploads their own årsredovisning and gets their own analysis". Read
`CLAUDE.md` first for boundaries, `PIPELINE.md` for how the analysis itself
works.

---

## Where we actually are

**Working and verified:** the whole analysis pipeline, end to end, from the
terminal. `npm run extract -- <pdf> <input.json>` takes a real annual report
and prints a complete, schema-valid `AnalysisResult`.

**Also working:** every report screen renders that exact contract shape —
`/analys`, `/forhandsvisning`, `/bolanekalkyl`, `PropertySummary`.

**The gap:** the UI reads `src/data/sampleAnalysis.ts`, a static fixture
committed at build time. It is real data (a real Nabo-managed förening, run
through the real pipeline) but it is frozen. The upload form on `/analysera`
is cosmetic. There is no server route, no storage, no payment. Every visitor
sees the same report regardless of what they upload.

So: frontend and backend agree on the **shape** of the data end to end. They
are not **connected**.

---

## Phase 0 — DONE. The spike ran; the architecture is unblocked

**Question: does the pipeline run at all inside a Cloudflare Worker?**
**Answer: yes, comfortably, with no compatibility flags.**

Verified by running the real pipeline modules inside real `workerd`
(`wrangler dev`, local), POSTing actual annual reports at it. Measured:

| Report | Size | Pages | `extractPdfText` | base64 encode | Text layer |
|---|---|---|---|---|---|
| HSB (largest) | 11,4 MB | 21 | **378 ms** | 240 ms | ok, 39 776 chars |
| Nabo (typical) | 1,2 MB | 27 | **164 ms** | 29 ms | ok, 42 206 chars |
| SBC 2 | 5,3 MB | 16 | 6 ms | 134 ms | **SAKNAS — scan** |

The worst case is ~620 ms of work against a 30-second CPU budget, roughly
2 % of it. PDF parsing was the one thing that could have forced a different
runtime, and it does not. `unpdf`, `@anthropic-ai/sdk` (client construction),
`crypto.randomUUID()` and the pure `benchmarks` module all load and run in
`workerd` unmodified.

Two Node-only dependencies were removed as part of the spike, so the pipeline
now needs **no `nodejs_compat` flag at all**:

| Was | Now |
|---|---|
| `Buffer.from(pdfBytes).toString("base64")` in `runExtraction.ts` | `toBase64()` — chunked, web-standard `btoa`, tested against `Buffer` as the oracle |
| `randomUUID` from `node:crypto` in `assemble.ts` | global `crypto.randomUUID()` |

The base64 helper is chunked deliberately: `String.fromCharCode(...bytes)`
spreads every byte as an argument and blows the call stack far below 11 MB.
There is a test that encodes 12 MB to prove it.

### The spike's other finding: scans are not an edge case

`SBC 2 årsredovnisng.pdf` has **no text layer** — it is a 5,3 MB scan of a
paper document. That is **1 of the 8 real reports collected so far, 12,5 %**.

Detection works correctly and fails loudly before any API spend, exactly as
`PIPELINE.md` requires. But it means "vi kan inte läsa den här PDF:en" is a
routine outcome a real buyer will hit, not a rare edge case — it deserves a
genuinely good Swedish error screen explaining what happened and what to do
next (ask the broker or the board for the digital original), not a generic
failure. Worth sizing the upload flow around that from the start.

---

## The insight that shapes the economics

**Both API calls are förening-level, not apartment-level.**

`runExtraction(pdfBytes)` and `runAnalys(extraction)` never see the buyer's
apartment. Only `assembleraAnalys(...)` takes `PropertyInput`, and that step is
pure, deterministic, and free.

This matters because **many buyers upload the same PDF**. Every bidder on every
apartment in Brf Granen is looking at the same 2025 årsredovisning. So:

> Cache the pipeline output keyed by a content hash (SHA-256) of the uploaded
> PDF. The first buyer for a förening pays the API cost. Every subsequent
> buyer for that same förening costs **0 kr** and gets an instant result.

Measured cost of one cold run (from an actual run against the Nabo report):

| Step | Cost |
|---|---|
| Pass 1 — extraction (sends the whole PDF) | 3,27 kr |
| Pass 2 — judgement (text only) | 0,64 kr |
| **Total, cold** | **3,91 kr** |
| Total, cache hit on the same report | **0 kr** |

Note pass 1 dominates, and it is unavoidable for a report we've never seen —
there is no "cheap preview" that skips it. Which leads to the next point.

---

## The free-preview cost problem — flagging, not solving

The product gives away a preview (betyg, two red flags, datakvalitet) and
charges 249 kr to unlock the rest. But the preview requires a **complete**
pipeline run: `betyg` and `rodaFlaggor` come from pass 2. There is no version
of the preview that costs less than a full analysis.

So every visitor who uploads a *new* report costs ~3,91 kr before paying
anything:

| Conversion rate | API cost per paying customer | Margin on 249 kr |
|---|---|---|
| 10 % | ~39 kr | ~210 kr |
| 5 % | ~78 kr | ~171 kr |
| 2 % | ~196 kr | ~53 kr |

Workable at healthy conversion, thin at low conversion, and **catastrophic
under abuse** — a script uploading distinct PDFs in a loop bills us directly.
Caching helps real traffic a lot (many buyers, few föreningar) but does
nothing against an attacker who varies the file.

Mitigations, in the order they're worth doing:
1. A hard global daily spend cap with a kill switch — the one that stops a
   bad night from becoming a bad month.
2. Per-IP and per-session rate limits.
3. Cloudflare Turnstile on the upload (free, native to the platform we're on).
4. Email capture before the analysis runs — also the most valuable thing we
   could collect at that moment anyway.
5. Reject PDFs above a size/page cap before spending anything.

`MAX_COST_PER_ANALYSIS_SEK` already enforces the per-run cap. The *global*
cap does not exist yet and is the one that actually protects the business.

---

## A fourth repository zone

`CLAUDE.md`'s boundary table has three zones and no home for server code.
Proposed addition:

| Path | Contains | Rule |
|---|---|---|
| `src/server/` | Server functions, storage, payment, job orchestration | May import `src/lib/analysis/` and the contract. **Nothing may import it back.** UI reaches it only through typed server functions. |

Two hard rules for this zone, both about not leaking secrets:

- `ANTHROPIC_API_KEY` never reaches the browser. It is not `VITE_`-prefixed so
  Vite won't inject it, but the real protection is that `runExtraction.ts`,
  `analyze.ts` and `pdf.ts` must never be imported from a client component.
  Today nothing does — `bolanekalkyl.tsx` and `analys.tsx` only import the
  pure `calc/*` and `benchmarks` modules, which is fine and should stay that
  way. Worth enforcing with `createServerOnlyFn` and an ESLint
  `no-restricted-imports` rule rather than trusting discipline.
- The full `AnalysisResult` must never be sent to an unpaid client. Blurring
  cards in CSS is not a paywall. Gating happens server-side, by returning a
  redacted object — see Phase 2.

---

## Phase 1 — real analysis, no payment yet

Goal: a buyer uploads their own PDF and sees their own report. Everyone sees
everything; payment comes next.

**1. Storage — Supabase** (decided). Three things persist:

| What | Where | Why |
|---|---|---|
| Uploaded PDF | Supabase Storage | Needed for the cache key and for re-running a failed job |
| `analys` row: id, pdf hash, state, stage, error, result JSON, cost, timestamps | Postgres | The job record and the result in one place |
| `forening_cache` row keyed by **PDF SHA-256** → `ExtractionResult` + judgement | Postgres | The 0 kr repeat path — see the caching section above |

The result column holds the `AnalysisResult` as JSON rather than a normalised
schema. The contract already has a `schemaVersion` field; store it alongside so
a future contract change can migrate or invalidate old rows instead of
silently mis-rendering them.

Worth knowing: the Worker reaches Supabase over the network, so every query is
a subrequest. That is fine at this volume, but keep the request path to a small
number of round trips and don't chat with the database inside a loop.

**2. Job model, not a blocking request.** A cold run is two sequential LLM
calls over a large document; expect tens of seconds (this has not been
measured yet — the spike should time it). Do not hold an HTTP request open for
it:

```
POST  upload      → { analysisId }      (hash PDF, check cache, enqueue)
GET   status      → { state, stage }    (client polls)
GET   result      → AnalysisResult      (gated in Phase 2)
```

Stages map naturally onto the pipeline and give the UI something honest to
show while waiting: *Läser årsredovisningen… Analyserar nyckeltalen…
Sammanställer rapporten…*

On a cache hit the job completes immediately and the UI skips straight to the
result, which will be the common path once a few hundred föreningar are in.

**3. Wire `/analysera` for real.** The form already collects everything
`PropertyInput` needs. Validate with the existing `PropertyInputSchema` —
already written, already tested. The Tristate fields keep their `okant`
default, which flows into `saknadeFalt` and the auto-generated questions
exactly as the deterministic assembly already handles.

**4. Swap the fixture for the real result.** `analys.tsx`,
`forhandsvisning.tsx`, `PropertySummary.tsx`, `bolanekalkyl.tsx` currently
import `sampleAnalysis` directly. They each need the analysis passed in from a
route loader instead. This is the smallest part of the work — the components
already speak the contract.

**Keep `sampleAnalysis.ts`.** It becomes a genuine demo: an
"se ett exempel på en rapport" page, with no upload and no cost. Useful for
the landing page and for developing UI without burning API spend.

**5. Failure paths, visibly.** `PIPELINE.md` already specifies these and the
pipeline already throws the right typed errors — they now need user-facing
Swedish treatment: scanned PDF with no text layer (`ScannedPdfError`, fails
before any spend), malformed model output after one retry, spend cap hit, a
report several years old, a PDF that isn't an årsredovisning at all. Silent
empty analysis remains the worst possible outcome.

---

## Phase 2 — the paywall (deferred)

**Decision: payment is deferred.** Phase 1 ships with everything visible to
everyone, so the core loop can be proven before commerce is added.

Two things are still worth doing in Phase 1 so this stays cheap to add later:
keep `gratisSektioner` populated in the stored result, and keep the `result`
endpoint as the single place a full analysis is handed out. Then turning the
paywall on is a change in one function, not a refactor of every screen.

The rest of this section is the plan for when that day comes.

**Server-side gating.** `AnalysisResult.gratisSektioner` already declares what
is free: `betyg`, `rodaFlaggor_topp2`, `datakvalitet`. The `result` endpoint
returns the full object only when the analysis is paid; otherwise it returns
an object containing *only* those sections. The blurred teaser cards on
`/forhandsvisning` then describe content the client genuinely does not have.

**Payment.** One-time 249 kr per analysis. Flow: create a checkout session for
an `analysisId` → provider redirects back → **webhook** marks the analysis paid
(never trust the redirect alone) → `result` starts returning the full object.

**Identity.** A buyer who pays must be able to come back to their report
tomorrow, from another device. The minimum that works is emailing a signed
link at purchase; full accounts are a bigger commitment and can wait.

---

## Phase 3 — hardening before real traffic

Global spend cap + kill switch. Rate limits. Turnstile. Structured logging of
every run (cost, duration, cache hit/miss, failure reason) — without which the
economics above are guesswork. An admin view of recent analyses. Alerting on
spend and on failure rate.

Also worth doing before launch: run `npm run verify-extraction` against all six
answer-key fixtures and fix whatever regressed. That harness exists precisely
so extraction accuracy isn't taken on faith, and a paying customer finding a
wrong debt figure is the failure this product cannot afford.

---

## Decisions made

- **Storage: Supabase** (Postgres + Storage).
- **Payment: deferred.** Phase 1 ships without a paywall.
- **Runtime: Cloudflare Workers**, confirmed viable by the Phase 0 spike.

## Still open

**1. How does a job actually run?** A cold analysis is two sequential LLM calls
and will take tens of seconds of *wall* time (CPU is a non-issue, per the
spike — almost all of it is waiting on Anthropic). A Worker can wait on I/O
for a long time, but the client request shouldn't. Options, cheapest first:
`waitUntil` on the upload request; a Supabase Edge Function doing the work; or
Cloudflare Queues/Workflows. This needs a measured number first — nobody has
yet timed a full cold run end to end, and the answer changes which of these is
warranted.

**2. Does an analysis expire?** A report bought today concerns an
årsredovisning that is superseded annually. Does the buyer keep access
forever? Affects storage and, later, refund policy. Not blocking Phase 1.

**3. Who owns deployment today?** Is the site served through Lovable's
hosting, or a separate Cloudflare account? Whichever it is, that's where
`ANTHROPIC_API_KEY`, the Supabase keys, the spend cap and the kill switch have
to live. This one does block going live.

---

## Suggested order

1. ~~Phase 0 spike~~ — **done.** Workers runtime confirmed; the two Node-API
   dependencies removed; no `nodejs_compat` needed.
2. Time a full cold run end to end, so the job model in "Still open" #1 is
   chosen against a real number rather than a guess.
3. Stand up Supabase: schema, storage bucket, keys wired into the Worker.
4. Phase 1 as one vertical slice: upload → job → poll → real report on screen,
   with PDF-hash caching from day one (cheap now, awkward to retrofit).
5. Phase 3 hardening — above all the global spend cap and kill switch.
6. Phase 2 paywall, when payment stops being deferred.

Phase 1 is the one that makes the product real. Everything before it is
de-risking; everything after it is commerce.
