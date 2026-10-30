# Redesign v4: plan (2026-10-28)

Status: **IMPLEMENTED 2026-10-29 on `redesign-v4` (not merged; owner checks in Lovable first). Outcome: §9.** Branch `redesign-v4` (from `main` 4f1a27a).
Never merged/pushed to `main` by Claude; Lovable deploys from `main`.

Design source: the "BINFO REDESIGN" canvas
(https://claude.ai/code/artifact/914d592f-7ae8-45ef-8234-fc3390006acd), 13 artboards under
`project/v4/`. Local copies for agents (not in the repo):
`/private/tmp/claude-501/-Users-gustavslanesens-Documents-GitHub-BINFO/5fcc676f-b87f-4d1f-aecb-66dada61badc/scratchpad/design/project/v4/*.dc.html`
(+ text outlines in `…/scratchpad/outline/*.txt`, photos in `…/scratchpad/design/assets/`).

Rules of precedence (owner prompt): keep every function; match the design's look, structure and
copy; where design and code disagree the code wins, except the seven "Design wins" changes (§3);
a figure the design shows without backing data is not invented (§6, questions).

---

## 1. Map: route → artboard → server functions → states

| Route                                                      | Artboard                               | Server functions                                                                                                                                                                                         | States to cover (no artboard = build in the design language)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                        | Start                                  | none (static)                                                                                                                                                                                            | example block reads `sampleAnalysis` (no hard-coded figures)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/analysera`                                               | Analysera + AnalyseraForifylld         | `hamtaAnnonsFn`, `hamtaPostnummerInfoFn`, `hamtaPrisuppskattningFn`, `sparaVarderingFn`, `hamtaSparadVarderingFn`, `skapaAnalysFn`, `skapaAnalysFranRegisterFn`, `hamtaRegisterForeningFn`               | Booli: ok / fel_doman / ogiltig_url / blockerad / hittades_inte / tolkning / natverk / kvot / avstangd / behorighet, per-field "Från annonsen" / "Ändrat manuellt" / "Fanns inte i annonsen" (+ OSM postcode); postnummer area hint; Priskoll validation, fel (postnummer / ogiltiga / kvot / behorighet), serverfel, ok; **Spara värderingen** (logged in / out / sparar / sparad / fel / FORBERED_FEL); `?spara=vardering` restore (kraver_inloggning / saknas / sparar / sparad / fel); `?sparad=` saved valuation (loading / ej_inloggad → login / fel / hittades_inte / snapshot / unreadable snapshot / "Räkna om med dagens modell" + result); `?forening=` register mode (laddar / hittad / saknas / fel + "Ladda upp en annan årsredovisning"); dropzone (drag, chosen file, Ta bort, PDF/size errors); submit (validation, `skickaFel` per `FELKOD_INNEHALL` incl. kvot / daily_cap / kill switch / scanned >60 p / behorighet / network) |
| `/forhandsvisning/$id`                                     | Analyserar (running) + Rapport2 (done) | `hamtaStatusFn` (5 s poll), `hamtaResultatFn`, `hamtaSparstatusFn`, `forberedSparaAnalysFn`, `sparaAnalysFn`                                                                                             | Pagar (6 design steps, §4.3) + notices Skannad / Analyseras redan; Misslyckad per code (scanned_pdf, cost_cap, daily_cap, validation, saknar_rantekanslighet, versionskonflikt incl. withdrawn/unreadable, kvot, behorighet, unknown incl. kill switch); HittadesInte; Vantar; done + "Redan analyserad"; result error → Misslyckad unknown; `?spara=analys`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/analys/$id`                                              | Rapport2                               | `hamtaResultatFn` + save fns                                                                                                                                                                             | any error → redirect to `/forhandsvisning`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/exempel`                                                 | Rapport2 (with the banner)             | none                                                                                                                                                                                                     | static `sampleAnalysis`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/bolanekalkyl`                                            | Bolanekalkyl                           | `sparaKalkylFn`, `hamtaSparadKalkylFn`                                                                                                                                                                   | empty / prefilled from report (`manadsavgift`, `rantekanslighet`, `pris`, `boarea`, `prisUppskattning`); insats < 10 %; no income (KALP missing), > 7 persons; `?sparad=` (open / unreadable format / logged out → login); `?spara=kalkyl` restore; save (new / "Spara ändringarna" / "Spara som ny"); PDF/Excel export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/kopguide`                                                | Kopguide                               | **new** köpguide progress fns (§3.1)                                                                                                                                                                     | logged out (localStorage) / logged in (account) / all done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/brf`                                                     | BRF2                                   | `hamtaRegisterOmradenFn`, `hamtaRegisterOmradeFn` (search)                                                                                                                                               | empty areas, "Övriga Stockholm" (only when non-empty), search results / no hits / Rensa, pagination, quota refusal (route error page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/brf/omrade/$omrade`                                      | BRFOmrade                              | `hamtaRegisterOmradeFn`                                                                                                                                                                                  | sort (5 columns × direction), search in area, pagination 50/page, empty area, unknown area (404)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/brf/$slug`                                               | BRFForening                            | `hamtaRegisterForeningFn`                                                                                                                                                                                | older version note, scan note, addresses, "Nyckeltal per år", renamed slug redirect, not found, link to full analysis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/brf/$slug/analys/$ar`                                    | none                                   | `hamtaRegisterAnalysFn`                                                                                                                                                                                  | full stored analysis (reuses report parts), entitlement refused, redirect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/konto`                                                   | Konto                                  | `listaSparatFn`, `taBortAnalysFranListaFn`, `raderaSparadVarderingFn`, `raderaSparadKalkylFn`, `hamtaSparadKalkylFn` (export), `hamtaMinaUppgifterFn`, `loggaUtFn`, `raderaKontoFn`, **new** köpguide fn | loading, list error + Försök igen, empty lists, unreadable saved valuation badge, dialogs (per-action busy text, fixes "Tar bort…" defect), delete account with password                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/konto/logga-in`                                          | KontoLoggaIn                           | `loggaInFn`                                                                                                                                                                                              | wrong credentials, unconfirmed, too many attempts, `?spara` lead, already logged in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/konto/nytt-losenord`                                     | KontoNyttLosenord                      | `sattNyttLosenordFn`                                                                                                                                                                                     | with/without current password (`?nuvarande=ja`, `kraver_nuvarande_losenord`), too short, wrong current password (fix copy), done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/konto/skapa`, `/konto/glomt-losenord`, `/konto/bekrafta` | none                                   | `registreraKontoFn`, `begarAterstallningFn`, `bekraftaEpostFn`                                                                                                                                           | all states in FEATURE_INVENTORY S14–S16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/integritet`, 404, error page, static 500 HTML            | none                                   | none                                                                                                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Header everywhere: logo (house + check mark), nav Analysera / BRF-register / Bolånekalkyl /
Köpguide, right side "Logga in" (logged out) or "Mitt konto" (logged in, person icon). Footer:
Binfo + disclaimer, "Så räknar vi", "Integritet och personuppgifter", "Kontakt" only when
`KONTAKT_EPOST` is set.

---

## 2. Design system (implemented first)

Tokens go into `src/styles.css` (`:root` + `@theme inline`, oklch as the file requires; hex
noted beside each). Names are semantic so shadcn primitives keep working.

| Token                     | Hex                                     | Use                                         |
| ------------------------- | --------------------------------------- | ------------------------------------------- |
| `--primary` / navy        | #0A2F5E                                 | headings, primary buttons, active nav, logo |
| `--link`                  | #1C4FA3                                 | links, eyebrows                             |
| `--foreground`            | #111418                                 | body text                                   |
| `--text-2`                | #30363D                                 | secondary text                              |
| `--muted-foreground`      | #4B535C                                 | captions, meta                              |
| `--background` (page)     | #F4F6F9                                 | page background                             |
| `--card`                  | #FFFFFF                                 | cards, header, footer                       |
| `--border`                | #DCE1E8                                 | card borders                                |
| `--divider`               | #EEF1F5                                 | table rows                                  |
| `--input`                 | #B9C2CE                                 | input borders                               |
| `--tint`                  | #E8EEF8                                 | icon chips, "Regel" tags                    |
| `--track`                 | #E9EDF2                                 | progress/span tracks                        |
| `--success` / tint / text | #1E7A4D / #E6F4EA (#E7F3EC) / #1E6B3A   | done, "Acceptabel", "Ingår"                 |
| `--warning` pill          | #FFEDD5 / #9A3412                       | "Svag", "Uppskattning", "Att hålla koll på" |
| `--notice` box            | #FFF7E6 / #F3D9A4 / #5C3800             | amber callout                               |
| `--danger`                | #B42318 / #FDECEA / #991B1B             | errors, "Kritisk", deficit                  |
| `--grade-a…e`             | #14532D #1E7A4D #B45309 #B42318 #8A1C12 | grade badges (white letter)                 |

- Type: **Source Serif 4** 600 for h1 (44 / 36), section h2 (26–32), key figures (22–28) and the
  logo; **Inter** 400/500/600 for everything else (16 body, 15/14 small, 13 uppercase eyebrows
  with 0.08em tracking). Loaded from Google Fonts in `__root.tsx` (replaces IBM Plex Sans +
  Libre Baskerville).
- Radii: cards 10 px, inputs/buttons 6 px, grade badges 8 px, pills 999 px. Container max 1200 px,
  32 px gutter (16 px under 640 px). Header min-height 72 px. Buttons/inputs min-height 48 px
  (44 px secondary), so touch targets pass.
- Focus (the design has none): 2 px `--link` outline, 2 px offset, on every interactive element.
- Components (all in `src/components/ui/binfo.tsx`; restyle the existing ones, add the missing):
  `Card`, `Button`/`LinkButton` (primary navy, secondary white/bordered, ghost, danger),
  `Field` (label above, suffix inside, hint/error, `framhav`, new `badge` slot for "Från
  annonsen"), `TristateChoice` → radio group as drawn, `Toggle` → segmented radiogroup (adds
  `aria-pressed`/`role=radio`), `ChipGroup` (two-state check chips), `Badge`, `Tag`, `Callout`
  (info / notice / danger), `PageHeader` (eyebrow + serif h1 + lead), **new**: `Logo`,
  `Eyebrow`, `GradeBadge` (A–E colour, sizes 28/32/88) + `GradeScale` (5-step bar, `role=img`),
  `StatusPill` (god / acceptabel / svag / kritisk / okant / "Ingen bedömning"), `Stepper`
  (Bostaden / Föreningen / Rapport), `ProgressList` (done / active / pending), `SpanBar`
  (span + labelled markers, `role=img` with a full text label), `DataTable` (scrolls in its box
  on mobile), `KeyValueList` (dl rows with sub-notes), `IconChip`.
- `StatusDot`/`StatusLabel` stay (used in many places) but render through `StatusPill`.
- The landing "dossier" CSS in `styles.css` is removed with the old landing mock.
- Dark mode: none (design is light only; the unused `.dark` block stays untouched).

---

## 3. "Design wins" changes (code changes)

### 3.1 Köpguide progress persisted

- Pure model `src/lib/kopguide/framsteg.ts`: step ids (existing ids, stable), `klara: string[]`,
  count over the 12 BRF-mode steps, `nastaSteg`. Step data moves from the route into
  `src/lib/kopguide/steg.ts` (copy from the artboard, which also fixes the truncated
  "Medlemskap" text). The hidden Hus toggle and `lagfart` stay (owner-hidden).
- Logged out: `localStorage` `binfo:kopguide:v1` (try/catch, renders without it).
- Logged in: new table **`kopguide_framsteg`** (`principal_id` pk → `principal` on delete
  cascade, `klara text[]` with a length/format check, `uppdaterad`), RLS on, zero policies,
  revoke from anon/authenticated, service_role functions. Migration
  `20261028120000_kopguide.sql` + rollback; `sla_samman_principal`, `radera_principal`
  re-created to cover it; GDPR export (`MinaUppgifter`) includes it; `verify-rls` covers it;
  `KontoDatabas` port + Supabase adapter + fake.
- Server fns `hamtaKopguideFn`, `sparaKopguideFn` (logged-in only, `kravAgare`, small quota).
- First logged-in load merges: union of local + account, written back once.
- `/konto` card: "X av 12 steg klara. Nästa: <step title>." + "Fortsätt i köpguiden"
  (0 done: "Du har inte bockat av något steg ännu."; all: "Alla 12 steg klara.").
- `/integritet` gains one paragraph on the stored progress.

### 3.2 Utility estimates (driftschabloner) — decision and justification

Research 2026-10-28 (sources appended to `docs/driftschabloner-kallor.md`):

| Item                     | Basis (chosen) | Value                                                                                      | Why                                                                                                                                                        |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hushållsel               | persons        | Konsumentverket 2026: 400 / 530 / 700 / 870 / 1 010 / 1 150 / 1 280 kr/mån (1–7)           | KV builds it from appliance use per person in a lägenhet; no public per-m² flat figure exists. Cross-check: 2 200 kWh × 2,67 kr ÷ 12 ≈ 490. **Unchanged.** |
| Värme (only "ingår ej")  | m² boarea      | 21 kr/m²/mån (Nils Holgersson 2026, Stockholm fjärrvärme 250,32 kr/m²·år incl. varmvatten) | heat demand scales with area; IMD värme is billed on measured energy. **Unchanged**; text now says it includes varmvatten energy.                          |
| Vatten (only "ingår ej") | **persons**    | **135 kr per person/mån** = KV 45,61 m³/person·år × NH Stockholm all-in 35,54 kr/m³ ÷ 12   | consumption and IMD billing follow persons (m³), not area. **Changed** from 6 kr/m².                                                                       |
| Hemförsäkring            | persons        | KV 2026: 150 / 170 / 200 / 250 / 300 / 340 / 350 kr/mån                                    | KV prices by household size; no bostadsrättstillägg source exists. **Unchanged**; label fixed to "Hemförsäkring (utan bostadsrättstillägg)".               |
| Bredband                 | fixed          | 349 kr, "Binfos uppskattning"                                                              | no separable public source. Unchanged.                                                                                                                     |
| Tv                       | —              | no cost item                                                                               | chip only, as today.                                                                                                                                       |

So the design's own formulas (el 250 + 8·m², värme 180 + 14·m², försäkring 120 + 3·m², vatten
120/person) are NOT adopted: they are the pre-2026-10-26 values without sources. Field hints
become: Boarea "Styr schablonen för värme", Personer "Styr schablonerna för hushållsel, vatten
och hemförsäkring". `regler.ts` (new id `schablon_vatten_per_person`, `REGELVERSION`
"2026-10-28"), `calc/schabloner.ts`, Excel formulas, PDF, the rules table and tests change
together. KALP: unchanged (KV living costs already contain el, VA, försäkring; only värme is
added).

**Regression scenario** (5 260 000 kr, insats 789 000, 3 %, avgift 3 503, 48 m², 2 persons,
Värme + Vatten + Tv ingår, el + bredband ingår ej, 2 borrowers, no income): **19 828 kr/mån**
with today's code and with this plan (vatten is included, so the change moves nothing). The
design's 20 026 differs by exactly 198 kr: hushållsel 634 vs 530 (−104) and hemförsäkring 264
vs 170 (−94), i.e. the design's outdated formulas. All other rows match to the krona. A test
pins 19 828.

### 3.3 `/analysera` step 1: Adress and Byggår required

- Adress moves into step 1 (as drawn); Byggår becomes required (4 digits, 1600–current year)
  for the Priskoll and the analysis. Client validation only: server schemas keep both optional
  so saved valuations without byggår still re-open and "Räkna om" still works (the form shows
  the error only when the user edits/sends).
- Booli prefill marks a missing byggår/adress with "Fanns inte i annonsen, fyll i själv".
- A saved valuation without a name gets the address as its label (no schema change).

### 3.4 Calculator: "Pris du räknar med" + kontantinsats; two-state fee items

- `KalkylUnderlag` **version 2**: `pris` + `kontantinsats` (lån = pris − insats, shown as
  "Lån: … · Belåningsgrad … · amortering …"); `avgiftInkluderar` values `ja | nej` only.
  `tolkaKalkylUnderlag` migrates v1 → v2 (pris = lanebelopp + kontantinsats; `okant` → `nej`)
  so every saved kalkyl and 24 h draft still opens. `sammanfattaKalkyl`, Excel named cells
  (`Pris`, `Kontantinsats`, `Lanebelopp = Pris − Kontantinsats`), PDF view model and search
  params follow.
- "Vet ej" and the low–high range are removed everywhere (UI, PDF, Excel, saved summary keeps
  reading old `totalPerManadHog` but no longer writes it). The shared `FeeInclusion` contract
  type is NOT changed (the analysis contract keeps `Tristate`); the calculator maps.
- Prefill from the report: `pris` → price field ("Från rapporten"), insats = ceil(10 %).
- Chips: Värme, Vatten, Hushållsel, Bredband, Tv; defaults värme/vatten "ingår", el/bredband/tv
  "ingår ej" (was "vet ej").
- Layout as drawn: Lånet (pris, insats, ränta, räntestress slider 0–3 step 0,1) / Bostaden /
  Hushållet / "Klarar ni bankens kalkyl?" (KALP) / sticky result with rows + income block /
  "Om räntan stiger" table (Din ränta, +1, +2, +3, plus the existing kalkylränta row) / PDF +
  Excel / "Regler och antaganden" (grouped details). The per-row "eget värde" override and the
  save controls (name, Spara / Spara ändringarna / Spara som ny) are kept, styled in the design
  language.

### 3.5 Progress page: the design's six steps

Mapping (pipeline stage → active step; earlier steps shown "Klart"):

| Design step                                    | Active while                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| 1 Läser in årsredovisningen                    | `identifiering`, `transkribering`, `grundning` (legacy `uploaded`) |
| 2 Hämtar de sju nyckeltalen                    | `extraktion` (legacy `extracting`)                                 |
| 3 Jämför dina uppgifter med årsredovisningen   | `bedomning` (legacy `judging`)                                     |
| 4 Räknar på avgiften de närmaste två åren      | — (runs at read time, < 1 s)                                       |
| 5 Justerar värderingen för föreningens ekonomi | — (read time)                                                      |
| 6 Skriver frågor till styrelsen                | — (questions come from `bedomning` + read time)                    |

Steps 4–6 complete in the same moment the report renders, so the display is: during
`bedomning` step 3 is "Pågår" and steps 4–6 are pending; when the job is done the report
replaces the page (steps 4–6 are never shown as "Klart" before they have happened). Bar = done steps ÷ 6. Fixes the `trasigt` mis-count. Scanned
notice stays (adds time). Copy "Det tar några minuter" (fixes "3–5 minuter").
The header line "<adress> · <förening>" and the side box ("Liknande lägenheter ca …", "Inför
visningen") need data the status payload lacks → question Q5.

### 3.6 Coloured grade badges

`GradeBadge` A–E colours everywhere a grade shows: register list + area table + search,
`/brf/$slug` (88 px + scale legend), `/brf/$slug/analys/$ar`, the report card (+ `GradeScale`),
`/konto` analysis rows ("Betyg B" pill coloured), landing example. The comment in
`RegisterLista.tsx` about "no colour interpretation" is updated (owner overrides it).
Scale legend "A starkast, E svagast. Bygger på …" as drawn.

### 3.7 Contact address

`KONTAKT_EPOST` (`src/lib/kontakt.ts`, already exists, `null`) drives: footer "Kontakt"
(hidden while null, as drawn), report "Hittar du ett fel? Säg till." (mailto; hidden while
null), `/brf/$slug` error-report line, and the error copies that say "kontakta oss"/"hör av dig
till oss" (link when set, neutral wording when null). Address: question Q1.

---

## 4. Page-by-page approach

### 4.1 Shell — `__root.tsx`, `SiteNav.tsx`

Header/footer as drawn; nav wraps on mobile (no hamburger, as drawn); 404 + root error +
`lib/error-page.ts` restyled with tokens. Footer "Så räknar vi" → `/exempel#metod` (Q15).

### 4.2 `/` — `routes/index.tsx`

As drawn. The example block takes BRF name, area, rum, boarea, grade, title, valuation + span,
asking-price sentence, fee rise and three nyckeltal from `sampleAnalysis` through the same view
helpers the report uses (no hard-coded figures; it changes when `/exempel` is regenerated).
Hero chips without "Gratis" (owner: no "free" copy) → "Inte kopplat till mäklare eller bank",
"Varje siffra med sidhänvisning". Hero photo (Q2). "Se en exempelrapport" → `/exempel`.

### 4.3 `/analysera`

Stepper; Booli card ("Snabbast: hämta från annonsen", "Vi fyllde i N uppgifter…"); step 1 "Om
bostaden" (Adress, Postnummer + area hint + "Hitta postnummer", Boarea, Antal rum, Våning,
Månadsavgift, Byggår, Utgångspris) + "Fler uppgifter som ger en säkrare värdering" (Hiss,
Balkong as radios Ja/Nej/Vet ej; no "Valfritt"); "Se värderingen utan hänsyn till föreningen";
result block as drawn in AnalyseraForifylld (verdict heading, paragraph, SpanBar with
Utgångspris / Vanligt bud / Liknande lägenheter, "Värdering i siffror" table, amber "Föreningens
ekonomi är inte inräknad…", "Vad värderingen bygger på" details) — a new
`PriskollResultat` component, built on the same `analysisView` helpers as the report;
"Spara värderingen" card under it; step 2 "Granska föreningen" (dropzone or register card);
"Analysera bostaden och föreningen"; aside "Det här får du" + "Var hittar jag
årsredovisningen?" + privacy line (corrected, §5). `?sparad=` page restyled with the same
result block.

### 4.4 `/forhandsvisning`, `/analys`, `/exempel` — the report (K1)

Order as drawn: header (eyebrow "Rapport · analyserad …", h1 address, meta line, actions PDF /
Spara / Räkna på månadskostnaden) → three summary cards (anchors) → 1 Föreningen (heading,
"Att hålla koll på" cards with page ref, 7-row nyckeltal table: Värde / Bedömning / Jämförelse
/ Källa, 7th "Ingen bedömning", "Mer ur årsredovisningen" details) → 2 Priset (verdict, SpanBar
with four markers, "Priset i annonsen" + "Binfos värdering" lists incl. per-component effects,
debt share line, byggår note, coverage/low-confidence notes, "Så har vi räknat" incl. the
waterfall) → 3 Avgiften framåt (headline, Dagens/Förväntad tabs + slider, "Det här driver den
förväntade avgiften" details with drivers, byggdelar, savings math, loans, reference rate) → 4
Inför visningen (questions with checkbox, Varför, Bra svar, Varningssignal) → Källor och metod
(`#metod`) → closing CTA (calculator + PDF) → disclaimer with fiscal year → contact link.
Every variant keeps working: no utgångspris (no asking-price marker/sentence/bid), no
räntekänslighet (slider locked + note), no/degraded avgiftsprognos (no tabs, no adjusted
value, card 3 "Kan inte uppskattas"), `lan` / `utanfor_lan` (coverage callout first, no
"Vanligt bud" since `budpremie` is null), scanned report, older version note, erased address
(h1 falls back to the BRF name). Labels: "Liknande lägenheter" = baseline, "Binfos värdering" =
adjusted (falls back to baseline when no prognosis), span ±10 %. `/exempel` banner as drawn.
The PDF keeps its own layout (Q14) but its labels follow the new names.

### 4.5 `/bolanekalkyl` — §3.2 + §3.4.

### 4.6 `/kopguide` — as drawn (phases, accordion, Markera klar / Ångra, progress, "Nästa

steg", all-done line, closing CTA) + §3.1 persistence. Step copy from the artboard.

### 4.7 Register

`/brf`: hero, Stockholm photo (Q2), search (name or orgnr) + results, grade legend, three groups

- "Övriga Stockholm" when non-empty, area cards "N föreningar · uppdaterad <datum>" / "Inga
  föreningar ännu" (grey, not a link), "Saknas din förening?" CTA, footer count + ODbL line,
  pagination for search. `/brf/omrade/$omrade`: breadcrumb, "Föreningar på/i <område>" (Q12),
  search in area, "Sortera efter" select (+ the existing column-header sorting, kept), table
  with coloured grades, legend, empty state, pagination. `/brf/$slug`: header line (område ·
  org.nr · årsredovisning år · analyserad datum), grade card (88 px badge + headline (Q6) + text
- "Betyg X på skalan A–E…"), seven nyckeltal cards (7th unrated), "Se hela analysen…", "Nyckeltal
  per år", scan/older notes, addresses, sticky navy CTA "Ska du köpa här?" → `?forening=`.
  `/brf/$slug/analys/$ar`: report sections 1 + 4 in the K1 style.

### 4.8 Account

`/konto` as drawn (three lists, Köpguiden card, "Konto" section with Inloggning / Dina
uppgifter / Radera konto; dialogs keep confirm + password). Auth pages
(`logga-in`, `skapa`, `glomt-losenord`, `bekrafta`, `nytt-losenord`) use the KontoLoggaIn
two-column layout (form card + "Bra att veta"/benefits aside). Fix the two copy defects (dialog
busy text per action; wrong current password → "Fel nuvarande lösenord.").

### 4.9 Static: `/integritet` (design language; adds köpguide progress, keeps the rest),

404, error pages.

---

## 5. Deviations from the design already decided by the rules (no question needed)

1. Utility formulas: §3.2 (sourced values, not the artboard's).
2. "Gratis" chip (Start), "Valfritt" (Analysera), "(om du vet det)" removed: owner rule "no
   mention of free or optional". The Utgångspris hint "Fyller du i det jämför vi det med
   värderingen." stays.
3. "Vi sparar inte uppgifterna om du inte loggar in." (Analysera aside) is **false** for
   analyses (flat details are stored 12 months, `/integritet`). Replaced with: "Priskollen
   sparas inte. Vid en analys sparar vi lägenhetsuppgifterna i 12 månader." + privacy link.
4. "Sju nyckeltal, förklarade och jämförda med snittet": averages exist for 4 of 7 → "Sju
   nyckeltal, förklarade och bedömda".
5. The 7th nyckeltal is unrated (design's BRFForening card shows "Acceptabel").
6. Rate slider in the report keeps whole steps 0–3 (as drawn); the calculator's 0,1 steps.
7. "Lösenordet får inte vara ett som förekommit i ett dataintrång" is shown only if leaked-
   password protection is on in the hosted project (Q9).
8. Postnummer area hint (existing function) stays under the field although the artboard only
   shows the PostNord link.
9. Kalkylränta row stays in the "Om räntan stiger" table; "eget värde" overrides stay.
10. Header/actions the design lacks but the code has (Spara end card on the report, "Nyckeltal
    per år", search pagination, sort direction, Namn on saves, "Räkna om med dagens modell")
    are kept in the design language.
11. Bostadsrättstillägg is not added (no source); the label says so.

---

## 6. Open questions (owner) — see the chat message for the same list

Q1 contact address; Q2 photo licences; Q3 calculator price prefill; Q4 fee-inclusion prefill
from the report; Q5 progress-page data; Q6 grade titles + `/brf/$slug` headline; Q7 report
section-1 heading; Q8 värme/vatten in "I avgiften"; Q9 leaked-password protection; Q10 the
closing "Sammanfattning"; Q11 "Bra svar"/"Varningssignal" split; Q12 area prepositions; Q13
köpguide migration deploy; Q14 PDF restyle scope; Q15 "Så räknar vi" target; Q16 API budget
for end-to-end runs.

---

### 6.1 Owner answers (2026-10-28)

- Q1 `KONTAKT_EPOST` = contactbinfohere@gmail.com (footer "Kontakt", "Hittar du ett fel?").
- Q2 photos: owner generated them; use them (`public/bilder/`).
- Q3 calculator price prefill = Binfos värdering (as today).
- Q4 yes: prefill "Ingår i avgiften" from the report (all five items the report states), each
  chip still toggleable.
- Q5 yes: status payload gains address, BRF name and the unadjusted valuation (server-side,
  no API cost).
- Q6 yes: fixed grade titles A "Stark ekonomi", B "Stabil ekonomi", C "Godtagbar, med
  svagheter", D "Svag ekonomi", E "Mycket svag ekonomi"; `/brf/$slug` may show the stored
  `betygMotivering`.
- Q7 section-1 heading: supervisor decides (deterministic, adjusted to the analysis).
- Q8 show värme and vatten in "I avgiften" as drawn (reverses the 2026-10-26 hide).
- Q9 Supabase free plan: drop the leaked-password bullet.
- Q10 remove the closing "Sammanfattning" from the web report AND the PDF.
- Q11 split `svarssignal` into "Bra svar" / "Varningssignal" when both labels are present.
- Q12 prepositions approved ("på" Kungsholmen, Östermalm, Södermalm, Norrmalm, Essingeöarna,
  Djurgården & Gärdet; "i" elsewhere).
- Q13 köpguide per account: build it; may be dropped if it gets difficult (low priority).
- Q14 restyle the PDF to match the new report.
- Q15 drop the "Så räknar vi" footer link (the footer itself stays: privacy link, disclaimer,
  Kontakt).
- Q16 ≤ 3 real analyses (≈ 10–15 kr) approved.

## 7. Order of work and subagents

The supervisor (main chat) owns tokens/kit review, contracts, migrations, integration,
commits, and reviews every diff against the artboard before committing. Agents never commit,
never touch the same files concurrently; at most three run at once. Each brief names its files,
lifts the visual boundary for exactly those files (owner request), and points to the artboard
copy and outline.

| Step | Who                                                | Scope (files)                                                                                                                                                                                                 | Gate                                                         |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0    | supervisor                                         | this plan, CLAUDE.md, research note                                                                                                                                                                           | owner approval                                               |
| 1    | supervisor + `frontend-state`                      | tokens (`styles.css`), fonts (`__root.tsx`), kit (`ui/binfo.tsx` + new components), `SiteNav`, 404/error, `error-page.ts`; component tests                                                                    | build + screenshots of nav/footer/kit at 1280/390            |
| 2a   | `frontend-state` (calc)                            | `lib/kalkyl/*`, `calc/schabloner.ts`, `regler.ts`, `xlsx.ts`, kalkyl PDF view model, `lib/bolanekalkyl.ts`, tests (logic only)                                                                                | tests incl. regression 19 828, v1→v2 migration, Excel parity |
| 2b   | `frontend-state` (report)                          | `AnalysRapport.tsx` (split into `components/rapport/*`), `PropertySummary.tsx`, `analysisView.ts` helpers, `exempel.tsx`, `SparaAnalys*` styling, PDF labels                                                  | report tests + variants                                      |
| 2c   | `frontend-state` (flow)                            | `analysera.tsx`, `components/analysera/*` (new `PriskollResultat`), `analyseraForm.ts`/`varderingForm.ts`, `AnalysStatus.tsx`, `analysStatusVy.ts`, `forhandsvisning`/`analys` routes, `SparaKnapp*` styling  | flow tests                                                   |
| 3a   | `frontend-state` (calc UI)                         | `routes/bolanekalkyl.tsx`, `components/kalkyl/*`                                                                                                                                                              | after 2a                                                     |
| 3b   | `frontend-state` (register)                        | `routes/brf*`, `components/register/*`, `registerVy.ts`, `omraden.ts` (prepositions)                                                                                                                          |                                                              |
| 3c   | supervisor + `frontend-state` (account + köpguide) | migration + rollback, `kontoPortar.ts`, `supabaseKonto.ts`, `__fakes__/konto.ts`, `sparat.ts`, `analysFn.ts`, `kontoTyper.ts`, `lib/kopguide/*`, `routes/kopguide.tsx`, `routes/konto*`, `components/konto/*` | RLS fake tests, `verify-rls` locally                         |
| 4    | `frontend-state` (static)                          | `routes/index.tsx`, `integritet.tsx`, footer contact wiring                                                                                                                                                   |                                                              |
| 5    | `frontend-state` (PDF)                             | `components/pdf/*` per Q14                                                                                                                                                                                    | PDF tests                                                    |
| 6    | supervisor + `reviewer`                            | full walkthrough §8, journeys A–O, diff review against the prompt                                                                                                                                             | all checks green                                             |

Commits: one per step or sub-step (e.g. "design tokens + fonts", "kit components", "nav/footer",
"kalkyl underlag v2", "vatten per person", …), each with typecheck/lint/test/build passing.

---

## 8. Test strategy

- **After every chunk:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
  (+ `npm run dev` page load after touching `analysFn.ts`). Real output reported.
- **New/updated unit tests:** köpguide model (count, next step, merge union, storage
  try/catch), köpguide server fns against the fake (ownership, merge on principal merge,
  erasure, export); schablon basis (vatten per person, el/försäkring per person, värme per m²,
  hints/rules text agree with the formulas); `KalkylUnderlag` v1→v2 migration (every old field,
  `okant`→`nej`, drafts); price + insats inputs (lån, belåningsgrad, insats < 10 %); two-state
  inclusion (no range anywhere, Excel parity); rate stress (slider 0–3 step 0,1 and table rows,
  fee via räntekänslighet); KALP unchanged values; **regression 19 828 kr/mån** for the owner's
  scenario; progress-step mapping per stage incl. `trasigt`; grade colour map; "Vanligt bud"
  helper (only with utgångspris and budpremie); span kr/m² ends; required Adress/Byggår
  validation; report variants (no utgångspris / no räntekänslighet / no prognosis / `lan` /
  `utanfor_lan`) render without crashing and hide the right parts.
- Existing copy-asserting tests (`Prisrimlighet.test.tsx`, `AnalysRapportPrognos.test.tsx`,
  `SparaAnalys.test.tsx`, PDF tests, `konto.test.tsx`, route tests) are updated, not deleted.
- **Visual + a11y walk:** local stack (`./scripts/v2-lokalt.sh`, Docker; never production
  `.env.local`), Playwright with the cached Chromium at 1280 px and 390 px for every route and
  state I can trigger; screenshots side by side with the artboards; console errors; Tab order
  and visible focus; axe-core contrast check (injected from the Playwright script, not a
  dependency).
- **Journeys A–O** (FEATURE_INVENTORY §5) end to end on the local stack, incl. save while logged
  out (F1–F3), new account via local Inbucket mail, delete account, quota and kill-switch
  states (env toggles), failure codes (forced via the fake/env where a real trigger is not
  possible; listed in the report).
- **Paid runs:** ≤ 3 real analyses (one text PDF, one scan, one register hit = free) ≈ 10–15
  kr, logged in `docs/api-test-log.md` (Q16).

---

## 9. Outcome (2026-10-29)

Built per route as planned (§4); every step committed separately on `redesign-v4`.
Final checks: `npm run typecheck` clean; `npm test` 171 files / 3 503 tests pass;
`npm run lint` 0 errors (9 pre-existing react-refresh warnings); `npm run build`
OK, Worker bundle ≈ 1.9 MB gzipped (limit 3 MB).

Walkthrough on the local stack (Docker Supabase + local Edge Function, port 8080),
Playwright at 1280 and 390 px, no console errors and no horizontal scroll on any
route: /, /analysera, /forhandsvisning (waiting, done, failure, not found), /exempel,
/bolanekalkyl (regression scenario shows 19 828 kr/mån), /kopguide, /brf, area page,
förening page, /konto, all auth pages, /integritet. Journeys run end to end: B (real
PDF upload at 390 px, 131 s), C (register mode, re-run of an old report), D (Booli
error paths), E + F3 (create account → mail → confirm → analysis saved), F1, F2, G,
H, I, K (incl. wrong-password copy), M (köpguide merged into the account), O
(validation and non-PDF). Paid runs: 2 (8,34 kr, `docs/api-test-log.md` rows 137–138).

Deviations beyond §5 (all decided by the rules or found during QA):

- Report/landing price figures use two decimals in mkr where the artboard mixes one
  and two (the inside/outside decision is made at 10 000 kr).
- No "strax under/långt under" wording (no justified threshold); plain under/inom/över.
- Calculator: "Om räntan stiger", exports and save sit in a row under the form/result
  grid (only the result card is sticky); a fourth rule type "Referensvärde" (Nils
  Holgersson/Konsumentverket values are not Binfo's guesses); 53 rules listed (the
  generated `kv_*` rows stay out, as before).
- Waiting screen: the bar stays at 0 % during step 1 (done steps ÷ 6).
- Register: mobile area table is a card list; the förening page keeps the search-free
  layout but the area page keeps its search box beside the sort select.
- PDF: price lists stacked, rate section as boxes + table (no slider), all flags
  listed (heading counts them all).

Open items for the owner:

1. Saved kalkyler from before 2026-10-28 that had "Vet ej" items reopen with those
   items counted ("ingår ej"), so the reopened total can be higher than the total in
   the /konto list (which is the stored summary).
2. /brf/$slug shows the stored `betygMotivering` (owner Q6) next to statuses that are
   re-graded on read; on reports older than p13 the text can disagree with a status.
3. `Toggle` is a radiogroup of buttons without arrow-key navigation (every option is a
   tab stop) — fine for two options, noted for Lovable.
4. The two photos are owner-generated (Q2); no licence file needed.
