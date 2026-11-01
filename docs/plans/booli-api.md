# Plan: listing data via the Booli API (+ research on earlier sales)

Branch `booli-api`. Written 2026-10-31. Status: **approved 2026-10-31** (decisions in §7).

## 1. What we know (verified with 8 signed calls, 2026-10-31)

- `https://api.booli.se`, header `Accept: application/vnd.booli-v2+json`, query params
  `callerId`, `time` (**unix seconds**, works), `unique` (16 hex chars),
  `hash = sha1(callerId + time + privateKey + unique)`. Not behind Cloudflare: works from
  plain Node `fetch`, so it should work from the production Worker too (the page scraping
  there is challenged). No rate-limit headers in the responses.
- `listings/{booliId}` → `{ listings: [ … ] }` (200), or `404 {"listings":[]}`.
  `booliId` = the number in `booli.se/annons/<id>` (the response's `url` field is exactly that).
- `booli.se/bostad/<id>` carries a **residence id**, a different numbering:
  `listings/720821` → 404 and `sold/720821` → `{"sold":[]}`. The two number spaces can
  collide, so a residence id must **never** be sent to `listings/{id}` (risk: the wrong flat).
- `sold?q=…` works; a sold row has `soldPrice`, `soldDate`, `listPrice`, `firstPrice`,
  `location.address.postCode` (number, e.g. `11341`), `apartmentNumber`, `heating`,
  `soldPriceSource`.
- `areas?lat=&lng=` returns every area containing the point, including one of type
  `"Postnummer"` (`name: "11339"`). That is Booli's own postcode for the listing.
- Fields of an active listing (Tomtebogatan 23A): `streetAddress`, `position.latitude/longitude`,
  `region.municipalityName/countyName`, `namedAreas`, `listPrice`, `firstPrice`, `rent`,
  `livingArea`, `rooms`, `floor` (can be 1.5), `constructionYear`, `buildingHasElevator` 0/1,
  `hasBalcony` 0/1, `hasPatio`, `objectType`, `published`, `source` (the broker company, not the
  listing page), `url`. **No postcode, no förening name, no description** on the listing.

## 2. Field mapping (API → form → downstream)

| Form field (`ANNONS_FALT`) | API source                                                                    | Used by                            | Note                                             |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| adress                     | `location.address.streetAddress`                                              | report, register area              |                                                  |
| postnummer                 | listing: `areas?lat&lng` → type `Postnummer`; sold: `address.postCode`        | valuation (area + postcode effect) | formatted `NNN NN`; no Nominatim on the API path |
| ort                        | `region.municipalityName`                                                     | geocoder only                      |                                                  |
| utgangspris                | `listPrice` (falls back to nothing; never `firstPrice` for a changed price)   | price comparison                   |                                                  |
| manadsavgift               | `rent` (> 0)                                                                  | valuation (fee/m²), fee share      | `0` = not stated → missing                       |
| boarea                     | `livingArea` (> 0, one decimal)                                               | valuation, debt share              |                                                  |
| antalRum                   | `rooms`                                                                       | valuation                          |                                                  |
| vaning                     | `floor`, ≥ 0, truncated to an integer (as `parseVaning` does for typed input) | valuation                          |                                                  |
| byggar                     | `constructionYear` (plausible range)                                          | valuation                          |                                                  |
| hiss                       | `buildingHasElevator` 1 → "ja", 0 → "nej"                                     | valuation driver                   | D1                                               |
| balkong                    | `hasBalcony` 1 → "ja", 0 → "nej" unless `hasPatio: 1`                         | (not significant)                  | D1                                               |
| stadsdel (context)         | `namedAreas[0]`                                                               | display                            |                                                  |
| koordinater (context)      | `position`                                                                    | postcode lookup                    |                                                  |
| forening, maklarUrl        | **not in the API**                                                            | `PropertyInput.kalla` only         | absent; nothing downstream needs them            |

The BRF analysis uses none of these values directly; it gets them through the buyer's `PropertyInput`.

## 3. Design

- **Adapter interface** `src/server/annons/kallor.ts`: `interface AnnonsLeverantor { namn: "booli_api" | "booli_sida"; hamta(url, beroenden) → Utfall }`
  where `Utfall` = `ok(uppgifter, postnummerKalla)` | `fel(kod: "ej_tillganglig" | "nyckel" | "hittades_inte" | "blockerad" | "natverk" | "tolkning")`.
  Two implementations: `booliApi.ts` (new) and the existing scraping (`hamtaSida` + `tolkaBooli`, moved behind the interface, otherwise unchanged).
  When the key expires, swapping in another source means one new adapter.
- **New files:** `src/server/annons/booliApi.ts` (signing with Web Crypto `crypto.subtle.digest("SHA-1")`, no Node APIs;
  one GET per endpoint, 8 s deadline, no retry; `listings/{id}` → on 404 `sold/{id}` → for a listing without postCode `areas?lat&lng`),
  `src/server/annons/booliApiTolkning.ts` (pure JSON → `AnnonsUppgifter`, permissive Zod as in `booli.ts`).
- **`hamta.ts` order** (steps 1–6 unchanged: input, kill switch, URL, cache, entitlement, quota), then:
  1. `/annons/<id>` and the API is on (`BOOLI_API` ≠ `off` and both keys set) → API adapter.
  2. API answered `nyckel` (401/403 = expired/invalid key), `natverk` or `ej_tillganglig`, or the link is `/bostad/<id>`
     → the scraping adapter **only if `ANNONS_SIDHAMTNING=on`** (default **off**: it is challenged in production anyway).
  3. Otherwise a buyer-safe message and manual entry. A `/bostad/` link gets its own text: "Länken går till bostadens sida
     på Booli. Öppna annonsen och kopiera dess länk (booli.se/annons/…), eller fyll i uppgifterna själv."
     Every failure is logged `[annons] …` with the adapter name; an auth failure logs `booli-api nyckel avvisad` (the signal that the key has expired).
- **Cache:** unchanged table and key (`annons_cache`, canonical URL, 24 h). `AnnonsSvar` (in `src/lib/annons/typer.ts`, not the
  shared contract) gets `kalla: "booli"` unchanged plus a new `metod: "api" | "sida"`; old cache rows still parse.
  No migration. `src/types/analysis.ts` is NOT changed (`AnnonsKalla.typ` stays `"booli"`; `forening`/`maklarUrl` are just absent on the API path).
- **Env** (`src/server/env.ts`, web app only, never `VITE_`): `BOOLI_CALLER_ID`, `BOOLI_PRIVATE_KEY` (optional: absent → API path skipped),
  `BOOLI_API` (`off` = flag; default on), `ANNONS_SIDHAMTNING` (`on` = scraping fallback; default off). `ANNONS_HAMTNING=off` still turns off everything.
  `.env.example` updated with names only.
- **Attribution** (owner: yes): "Uppgifter från Booli" linking to booli.se next to the Booli field when a fetch succeeded, and in the report's
  sources section + PDF when `PropertyInput.kalla.typ === "booli"`. Built from the kit, no visual redesign. Booli's own `estimate` is never read or stored.
- **Quota/limits:** the existing `annonshamtning` quota (20/device, 60/IP per hour) stays; a cache hit costs no API call. One fetch costs 1–3 API calls.

## 4. Tests

- Unit: signing (fixed callerId/time/key/unique → known SHA-1), URL parsing incl. the id kind (existing tests + `/bostad` routing),
  mapping (recorded API JSON in `fixtures/booli-api/`, keys masked: active listing, sold, missing rent, half floor, no postcode, garbage),
  `hamta` orchestration with an injected `fetch`: listing ok, 404 → sold, auth failure → manual / scraping when on, `/bostad` link,
  postcode via `areas`, flag off, keys absent, cache hit = zero calls.
- Live terminal test `scripts/testaBooliApi.ts` (`node --env-file=.env.local --import tsx …`): 3–5 active Stockholm listings + 2–3 recently sold,
  prints per-field status, never the keys; `--spara` refreshes the fixtures. Logged in `docs/api-test-log.md`.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run dev` (the `/analysera` field), and one `wrangler dev` run of the built Worker
  against the real API (Web Crypto + fetch in workerd).

## 5. Part 2: research on earlier sales (no app code)

Throwaway scripts in the scratchpad only. Budget ≈ 250 calls. Questions from the brief: filters (`q`, `areaId`, `bbox`, `center`+`dim`,
`minSoldDate`/`maxSoldDate`, `objectType`, `minRooms`…, `minLivingArea`…), matching the same flat (`apartmentNumber` + address),
same address, same BRF (no förening field seen so far: address lists from the register / `forening_adress`), returned fields,
how far back and coverage in central Stockholm (counts per year per area vs our Mäklarstatistik data), limits, and what it adds
to the ML model (comparables, sanity check, training data). Deliverable: `docs/research/booli-sold.md` with masked example calls,
a proposed design and UX placement.

## 6. Execution (after approval)

Supervisor (main session) + parallel subagents, no overlapping files:

| Agent        | Scope                                                                            | Files                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A (server)   | adapter, API client, mapping, `hamta.ts`, env, unit tests, live script, fixtures | `src/server/annons/*`, `src/server/env.ts`, `src/lib/annons/typer.ts`, `scripts/testaBooliApi.ts`, `fixtures/booli-api/`      |
| B (frontend) | attribution line, `/bostad` message display, report/PDF source line              | `src/routes/analysera.tsx` (Booli block only), `src/lib/annons/formular.ts`, report sources component, `src/components/pdf/*` |
| C (research) | Part 2                                                                           | scratchpad + `docs/research/booli-sold.md`                                                                                    |

B starts once A has fixed the `AnnonsSvar` shape (it is the shared seam). The supervisor reviews each diff, re-runs the checks,
updates `docs/booli.md`, CLAUDE.md and `.env.example`, and commits on `booli-api`. No push to `main`, no deploy.

**Deploy (owner, later):** add `BOOLI_CALLER_ID` + `BOOLI_PRIVATE_KEY` to Lovable Secrets, merge, Lovable publish. No migration,
no Edge Function change, no `PROMPT_VERSION` bump.

## 7. Decisions (owner 2026-10-31)

- **D1** `buildingHasElevator: 0` → hiss "nej" (owner). Same rule for balkong: `hasBalcony: 0` → "nej",
  except when `hasPatio: 1` (then unknown). `1` → "ja"; a missing key → unknown. The listing-page parser keeps "ja" only.
  Amended 2026-10-31 (owner left it to the supervisor): a `0` on a sparse listing (≥ 2 of rent, floor, construction
  year, asking price missing) stays unknown.
  Seam: `AnnonsUppgifter.hiss/balkong: "ja" | "nej"`; the form applies "nej" with the "Hämtat från Booli" mark.
- **D2** ~~Buyers paste `/annons/` links~~. **Revised 2026-11-01 (owner):** buyers paste `/bostad/<id>` links. They are
  resolved with `listings?residenceId` → `upcomingSale=1` → `sold?residenceId` (docs/booli.md); `bostadslank` is gone.
- **D3** A sold listing fills utgångspris with its `listPrice`; the final price is not put in the form.
- Terms (owner, from Booli's representative): use is allowed; the key lasts ~3 months. Attribution "Uppgifter från Booli"
  is shown anyway (owner: yes). Default on, flag `BOOLI_API=off`.
