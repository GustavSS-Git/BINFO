# Maintenance reference: Swedish flerbostadshus (bostadsrättsföreningar)

Research note, 2026-10-24. Purpose: a sourced fallback for the "sustainable fee / savings gap"
(spargap) calculation when a BRF's own underhållsplan is unavailable. **No number here is
Binfo's own.** Every figure has a source. Where sources disagree, the range and each source are
given. Gaps are marked "ingen källa hittad". All amounts are nominal SEK in the price level of
the source's year. None has been inflation-adjusted.

Source quality labels used below:

- **P (primary/authoritative):** BFN, Boverket, FAR, the large förvaltare/banks publishing their
  own data (HSB, Riksbyggen, Swedbank), BeBo/WSP (based on Repab Fakta), academic theses.
- **S (secondary):** news articles quoting a primary actor, a competitor's guide, a municipal page.
- **W (weak):** lead-generation or marketplace sites with no stated method (brfpris.se and similar).

---

## 1. Components: interval / lifetime and cost

### 1a. Lifetimes and intervals

There are two kinds of lifetime source, and they answer different questions:

- **SIB M84:10 (Statens institut för byggnadsforskning, 1984)**, _teknisk medellivslängd_. It is
  republished in the two tables cited below, one of which adds the SABO avskrivningsregler. It
  is the classic table, but it is mostly used for småhus and dolda-fel insurance. Old.
- **FAR, "Komponentindelning i bostadsrättsförening" (2025-06-25)**, example _nyttjandeperioder_
  for the K3 component depreciation that is mandatory for BRFs from FY2026. These are
  accounting useful lives written specifically for BRFs, not maintenance intervals. They are the
  most current BRF-specific lifetime figures found.

A third, older comparison is the Chalmers thesis (2015). It sets SABO's 2013 guidance against
two municipal housing companies' component lives. Column attribution in the extracted table is
partly ambiguous, so it is used only as a range check.

| Component                           | Lifetime / interval (years)                                                                                                                                                                                                                    | Sources                                                                                                                     | Strength                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Stambyte, avlopp/tappvatten**     | 50 (FAR: "Stammar VA" 50); 50 (M84:10: avloppsledningar, kall-/varmvattenledningar 50); 40–60 for cast iron (Lusa); "30 till 40 år" for a new stambyte (Sveriges Bostadsrättscentrum, 2014). Relining guarantee ≈ 10 years (same 2014 source). | [FAR 2025][far-komp]; [M84:10 via Gallagher][m84-ajg]; [Lusa][lusa-stam] (S, competitor); [SVT 2014][svt-relining] (S)      | Medium: two P sources agree on ~50.                |
| Våtrum tätskikt                     | 30 under klinker/kakel; 15 for thin dispersion layers from the 1980s/early 1990s; plastmatta 20 (before 1995) / 30 (after 1995)                                                                                                                | [M84:10 via Gallagher][m84-ajg]; [Bilaga 1, M84:10 + SABO][insyn-bilaga]                                                    | Medium (old, småhus-oriented)                      |
| **Tak, papp** (low-slope)           | 20 (M84:10); 30 (FAR "papp")                                                                                                                                                                                                                   | [M84:10][m84-ajg]; [FAR 2025][far-komp]                                                                                     | Medium                                             |
| **Tak, tegel/betongpannor**         | 30 for pannor and the underlying papp (M84:10); 40 (FAR "tegel")                                                                                                                                                                               | [M84:10][m84-ajg]; [FAR 2025][far-komp]                                                                                     | Medium                                             |
| **Tak, plåt**                       | 35 for falsad/korrugerad plåt on papp (M84:10); 60 (FAR "plåt, skiffer el. likn.")                                                                                                                                                             | [M84:10][m84-ajg]; [FAR 2025][far-komp]                                                                                     | Medium (the two sources differ widely)             |
| Hängrännor/stuprör, plåtdetaljer    | 25 / 35                                                                                                                                                                                                                                        | [M84:10][m84-ajg]                                                                                                           | Weak-medium                                        |
| **Fasad, puts**                     | 30 for omputsning of thick render (M84:10); 40 (FAR "puts, betongelement, spritputs"); "cirka 20–30 år" (HSB Mellersta Götaland)                                                                                                               | [M84:10][m84-ajg]; [FAR 2025][far-komp]; [HSB fasad][hsb-fasad] (S, service page)                                           | Medium                                             |
| **Fasad, tegel**                    | "Ej byte" (M84:10); omfogning 30 (Bilaga 1); 100 (FAR)                                                                                                                                                                                         | [M84:10][m84-ajg]; [Bilaga 1][insyn-bilaga]; [FAR 2025][far-komp]                                                           | Medium                                             |
| **Fasad, trä**                      | Repaint 10, replace panel 40 (M84:10); 40 (FAR)                                                                                                                                                                                                | [M84:10][m84-ajg]; [FAR 2025][far-komp]                                                                                     | Medium                                             |
| **Fönster**                         | Replace 40, repaint 10, isolerglas leaks after ~25 (M84:10); 40 for wood 2–3-glass or plastic, 60 for clad wood or aluminium (FAR)                                                                                                             | [M84:10][m84-ajg]; [FAR 2025][far-komp]                                                                                     | Medium-good                                        |
| **Ventilation**                     | FTX/FT system 20, natural draft (självdrag) 100 (FAR); injustering 5, fan motor 15, controls 20 (M84:10). OVK every **3 years** for FT/FTX, every **6 years** for F, FX and S in flerbostadshus                                                | [FAR 2025][far-komp]; [M84:10][m84-ajg]; [Malmö stad OVK][malmo-ovk] (S, municipal page summarising Boverket's BFS 2011:16) | Good for OVK; medium for lifetimes                 |
| **El** (stigarledningar, centraler) | 50 (FAR "El"); 45 (M84:10 "kablar, centraler etc.")                                                                                                                                                                                            | [FAR 2025][far-komp]; [M84:10][m84-ajg]                                                                                     | Medium                                             |
| **Hissar**                          | 20 for platform/stair lifts, 30 hydraulic, 40 traction (FAR); "mellan 20 och 30 år" (Hissförbundet, 2021)                                                                                                                                      | [FAR 2025][far-komp]; [Dagens PS 2021][dps-hiss] (S, quoting Hissförbundet)                                                 | Medium                                             |
| **Balkonger**                       | 50 for a concrete slab, 30 wood, 25 glazed (FAR); 50 for concrete excl. tätskikt, 35 for tätskikt/plåt (M84:10)                                                                                                                                | [FAR 2025][far-komp]; [M84:10][m84-ajg]                                                                                     | Medium                                             |
| **Värmesystem**                     | Värmestammar 80 (FAR); värme-/vattenledningar 50 and värmeväxlare 20 (M84:10); new reglercentral "cirka 20 år" (BeBo/WSP); styr och övervakning 25 (FAR). Radiators: ingen källa hittad                                                        | [FAR 2025][far-komp]; [M84:10][m84-ajg]; [BeBo 2023][bebo]                                                                  | Medium for pipes/controls; no source for radiators |
| **Tvättstuga/maskiner**             | Tvättmaskin, torktumlare, torkskåp 10 (M84:10, household-machine row); "Miljö, tvättstugor, garage" 30 (Chalmers 2015 comparison table, building part)                                                                                         | [M84:10][m84-ajg]; [Chalmers 2015][chalmers]                                                                                | Weak                                               |
| Dörrar/portar                       | 35 (M84:10, "byte dörrar (inne/ute)"); 25–50 for "fönster, dörrar och portar … i skal" (Chalmers 2015 table)                                                                                                                                   | [M84:10][m84-ajg]; [Chalmers 2015][chalmers]                                                                                | Weak-medium                                        |
| Dränering                           | 25 for dräneringsledning + vertical fuktisolering; 50 for dagvattenledning outside the building (M84:10)                                                                                                                                       | [M84:10][m84-ajg]                                                                                                           | Weak-medium (old)                                  |
| Källare                             | ingen källa hittad                                                                                                                                                                                                                             | —                                                                                                                           | —                                                  |
| Gård/mark                           | Markbyggnationer 25–50 (Chalmers proposal); markanläggningar under mark 30–100, ytskikt 10–30 (Chalmers comparison table)                                                                                                                      | [Chalmers 2015][chalmers]                                                                                                   | Weak                                               |
| Entré/trapphus, målning             | Only a generic indoor repaint interval of 10 (M84:10 "målning/tapetsering"). No trapphus-specific source found                                                                                                                                 | [M84:10][m84-ajg]                                                                                                           | Weak                                               |

### 1b. Costs

Most cost figures are given **per unit of the component** (m² of facade or window, per
apartment, per elevator), not per m² BOA. Converting them to kr/m² BOA needs the building's
geometry (facade area per BOA and so on), and **no source gives that conversion. Don't invent
it.**

| Component                                         | Cost (unit, price year)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Sources                                                                                                                                            | Strength                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Stambyte**                                      | **Per lägenhet, incl. VAT:** 150 000–300 000 kr for stammar + badrum, the most common variant (Lusa, "2025–2026", citing "branschsnitt från HSB, Riksbyggen och entreprenadupphandlingar"); 250 000–500 000 kr (brfpris, labelled 2026 levels); ~200 000 kr including new tätskikt (Sveriges Bostadsrättscentrum, **2014**). **Per m²:** ~5 000 kr/m² for "stambyten, fönsterrenovering och omputsade fasader" **combined** (SABO via BKN, **2008**), which Hyresgästföreningen indexed to ~7 600 kr/m² in 2022 (assuming 3.7 %/yr). | [Lusa][lusa-stam] (S, competitor); [brfpris][brfpris-stam] (W); [SVT 2014][svt-relining] (S); [Hyresgästföreningen 2022][hgf] (S, citing BKN 2008) | **Weak.** No primary, current, per-m² stambyte figure found. The range spans about 2× even among recent secondary sources. |
| Relining                                          | 30 000–40 000 kr per lägenhet (Sveriges Bostadsrättscentrum, 2014)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [SVT 2014][svt-relining] (S)                                                                                                                       | Weak (old)                                                                                                                 |
| **Tak**                                           | 15 000–50 000 kr per lägenhet, depending on BRF size; 1.2–3.0 Mkr per project for a 600–1 200 m² roof (brfpris, undated). **Per m² roof by material: ingen källa hittad**                                                                                                                                                                                                                                                                                                                                                            | [brfpris tak][brfpris-tak] (W)                                                                                                                     | Weak                                                                                                                       |
| **Fasad**                                         | 3 200 kr/m² facade for puts on lättbetong without energy measures; 3 900 kr/m² with 170 mm added insulation (BeBo/WSP 2023, based on Repab Fakta 2023 and project data). "Komplett renovering" 2 500–4 000 kr/m² bruttofasad (Repab Fakta 2023, as cited by BeBo). 1 800–3 000 kr/m² for flerbostadshus (HSB Mellersta Götaland, undated)                                                                                                                                                                                            | [BeBo 2023][bebo] (P); [HSB fasad][hsb-fasad] (S)                                                                                                  | Medium (per m² facade, not per BOA)                                                                                        |
| **Fönster**                                       | 7 000 kr/m² window for new wood windows; 8 000 kr/m² for aluminium-clad wood; 3 700 kr/m² for renovation without energy measures (BeBo/WSP 2023). Small 2-glass wood windows ~5 000 kr each or 8 000 kr/m² (Repab Fakta 2023, as cited by BeBo)                                                                                                                                                                                                                                                                                      | [BeBo 2023][bebo] (P)                                                                                                                              | Medium (per m² window)                                                                                                     |
| **Ventilation**                                   | New FTX unit incl. fans 350 000 kr per unit; new frånluftsfläkt 10 000 kr per fan (BeBo/WSP 2023). Two Svenska Bostäder projects: a standalone FTX renovation of 70 apartments / 5 252 m² BOA (Bredäng, built 1965, done 2015) at ~10.5 Mkr in 2023 money ≈ **2 000 kr/m² BOA**; an FX renovation of 96 apartments / 5 496 m² BOA (Akalla, built 1975) procured 2023 at ~3.0 Mkr ≈ **550 kr/m² BOA** (division by Binfo)                                                                                                             | [BeBo 2023][bebo] (P); [KTH 2023][kth-fx] (P, thesis on one owner's data)                                                                          | Medium. Two single projects, not a distribution.                                                                           |
| OVK                                               | ingen källa hittad (cost)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                  | —                                                                                                                          |
| **El**                                            | ingen källa hittad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                  | —                                                                                                                          |
| **Hissar**                                        | Per project, incl. VAT: modernisation 0.3–1.5 Mkr; new elevator in an existing shaft 1.5–4 Mkr (brfpris, undated). Per elevator or per apartment from a primary source: ingen källa hittad                                                                                                                                                                                                                                                                                                                                           | [brfpris hiss][brfpris-hiss] (W)                                                                                                                   | Weak                                                                                                                       |
| **Balkonger**                                     | ingen källa hittad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                  | —                                                                                                                          |
| **Värmesystem**                                   | New fjärrvärmecentral (undercentral) 450 000 kr each; shuntgrupp 60 000 kr; reglercentral 40 000 kr; termostatventiler 600 kr each; injustering 3 000 kr per apartment (BeBo/WSP 2023). Full heating-system replacement incl. radiators: ingen källa hittad                                                                                                                                                                                                                                                                          | [BeBo 2023][bebo] (P)                                                                                                                              | Medium for UC parts                                                                                                        |
| Tvättstuga                                        | ingen källa hittad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                  | —                                                                                                                          |
| Dörrar/portar, dränering, källare, gård, trapphus | ingen källa hittad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                                                  | —                                                                                                                          |

**Total actual maintenance spending (for scale, not a need):** underhåll + reparation in
flerbostadshus and lokaler averaged "cirka 150 kr per kvadratmeter och år" according to SCB
for 2007, as cited by Boverket ([BETSI, Boverket 2009][betsi], P). Planima's blog lists Allabrf
(2021) at 150 kr/m² for BRF flerbostadshus and SCB 2017 at 161 kr/m² (private) and 222 kr/m²
(allmännytta) ([Planima][planima], S; the Allabrf original could not be opened). This is what
owners **spent**, which in an underinvesting stock is below what is **needed**.

---

## 2. Recommended annual savings (sparande / sparbehov), kr/m² per year

### 2a. Stated recommendations

| Actor                                                   | Level                                                                                                                                                                                                                                                                                                                                                                                                   | Area basis                                                                          | Year                          | Source                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| **HSB (national), Sveriges Bostadsrättsbarometer 2026** | "Saknas en underhålls- och investeringsplan kan styrelsen utgå från ett schabloniserat sparande på 300 kr/kvm/år." Also: "HSBs och branschens rekommendation är ett sparande om cirka 300 kr/kvm/år" and "Börja med att spara minst 300 kr/kvm/år". Caveat in the same text: the right level depends on building design. Many low-rise bodies mean more roof and facade; tall buildings have elevators. | kr/kvm (HSB's sparande is per total yta = boyta + lokalyta, per Bostadsrättskollen) | 2026 (2025 data, ~4 300 BRFs) | [HSB 2026][hsb-barometer-2026] (P)                             |
| **Riksbyggen**, Ekonomisk rapport                       | "Vår rekommendation för 2025 är att en bostadsrättsförening bör ha ett sparande på 305 kr/kvm." No derivation published. The April 2026 report gives no new number, only that savings in 2026 are expected "ca. 70 kr/kvm under underhållsplanernas krav".                                                                                                                                              | not stated                                                                          | April 2025; April 2026        | [Riksbyggen 2025][rb-2025] (P); [Riksbyggen 2026][rb-2026] (P) |
| **Swedbank** (Boindex temarapport Q2 2025)              | Sparbehov: "De flesta … som har en teknisk underhållsplan som sträcker sig i 50 år uppvisar framtida kostnader … på **250 till 500 kronor per kvadratmeter boyta**. Saknas en teknisk underhållsplan kan du utgå från en schablon på **350 kronor per kvadratmeter boyta**."                                                                                                                            | **boyta**                                                                           | published 2025-09-10          | [Swedbank Boindex Q2 2025][swb-boindex] (P)                    |
| **HSB** nyckeltalsrapport (Brf Mälaren, FY2023)         | Savings should match the average maintenance need from a complete 50-year plan. "Saknas detta för stunden kan man generellt säga att ett sparande bör ligga på mellan **250-300 kr/kvm**, men det är en generell rekommendation."                                                                                                                                                                       | kr/kvm (HSB total yta)                                                              | report file 2024-06           | [HSB nyckeltalsrapport][hsb-nyckeltal] (P)                     |
| **HSB Malmö**, Bostadsrättsbarometer 2025               | "Den generella rekommendationen är att det bör ligga inom spannet **250 - 300 kr/kvm och år**."                                                                                                                                                                                                                                                                                                         | total yta (boyta + lokalyta)                                                        | 2025 (2024 data, 251 BRFs)    | [HSB Malmö 2025][hsb-malmo-2025] (P)                           |
| **Nabo**                                                | "över 300 kr per kvadratmeter" (2024). "250–300 kr per m²" (chief economist, 2026, paraphrased by Realtid)                                                                                                                                                                                                                                                                                              | not stated                                                                          | 2024-12-16; 2026-05-27        | [Placera 2024][placera] (S); [Realtid 2026][realtid] (S)       |
| **HSB Stockholm**                                       | "250-300 är en rimlig nivå"                                                                                                                                                                                                                                                                                                                                                                             | not stated                                                                          | 2024-12-16                    | [Placera 2024][placera] (S)                                    |
| **SEB**                                                 | "Över 200kr/kvm" is good; "Under 120 kr/kvm" calls for caution                                                                                                                                                                                                                                                                                                                                          | total yta                                                                           | undated page (post-2023)      | [SEB][seb] (S/P, bank guide)                                   |
| New-production calculations (Swedbank's observation)    | Developers' cost calculations often budget only 30–40 kr/m² boyta for löpande reparationer och underhåll, which Swedbank says produces too-low savings                                                                                                                                                                                                                                                  | boyta                                                                               | 2025                          | [Swedbank Boindex Q2 2025][swb-boindex] (P)                    |
| Banks in credit assessment                              | No fixed levels. Nordea, Swedbank, SEB and SBAB use the nyckeltal in an overall assessment; cash flow matters most                                                                                                                                                                                                                                                                                      | —                                                                                   | survey autumn 2023            | [Fastighetsägarna Stockholm 2024][fao-bank] (P)                |

### 2b. Actual levels, for contrast (what BRFs save)

| Measure                                      | Value                                             | Source                                    |
| -------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| HSB national average, 2025                   | 225 kr/kvm/år (+12.5 % y/y)                       | [HSB 2026][hsb-barometer-2026]            |
| HSB Malmö average, 2020→2024                 | 254 → 176 kr/kvm/år                               | [HSB Malmö 2025][hsb-malmo-2025]          |
| HSB Stockholm comparison sample, FY2023      | 169 kr/kvm (633 BRFs, average byggår 1971)        | [HSB nyckeltalsrapport][hsb-nyckeltal]    |
| Nabo, 2023                                   | 126 kr/kvm                                        | [Placera 2024][placera]                   |
| Nabo, latest review (2026 article)           | 148 kr/kvm (+21 %)                                | [Realtid 2026][realtid]                   |
| Parameter Revision, ~200 Stockholm-area BRFs | 113 (2022), 86 (2023), 85 (2024) kr/kvm total yta | [FAR Balans 2025-06-24][far-balans] (S/P) |

Recommended levels (250–350) sit well above actual averages (85–225). Riksbyggen 2025 says
the average förening would need to raise savings by "nästan 50 procent".

### 2c. Variation with building age

- **No source found that gives kr/m² savings need by age band** (new vs 1960s–70s vs pre-1940):
  **ingen källa hittad**.
- The qualitative statements found:
  - Swedbank (Dec 2025): "åldern i sig [säger] ofta väldigt lite om föreningens behov av
    underhåll". Newbuild needs are low in the near term, older buildings can have large or
    imminent needs, but well-kept old buildings may have few
    ([Swedbank, Teknisk skuld och underhållsskuld][swb-teknisk], P).
  - HSB 2026: the level depends on design (number of building bodies, floors, elevators), not
    on age as such ([HSB 2026][hsb-barometer-2026]).
  - Riksbyggen 2026: newly built BRFs normally have a detailed 50-year plan; older BRFs' plans
    vary in quality ([Riksbyggen 2026][rb-2026]).
  - Swedbank (Dec 2025), on debt rather than maintenance: newbuild 10 000–14 000 kr/m² boyta;
    pre-1990s 4 000–8 000; 1950s or older often under 2 000 or debt-free
    ([Swedbank, Teknisk skuld][swb-teknisk]). This is context for age-related financing, not
    a maintenance figure.

### 2d. Verdict on 300 kr/m²/year as a default

**Supported, as a generic "no plan available" default for sparande per m² total yta.**

- HSB's national 2026 report states it explicitly as a schablon when a plan is missing, and
  calls ~300 the HSB and industry recommendation.
- Riksbyggen's 305 kr/kvm (2025) and Nabo's "över 300" (2024) agree.
- HSB Malmö, HSB Stockholm, HSB's nyckeltal report and Nabo (2026) give the slightly lower band
  250–300.
- Swedbank's default is higher, **350 kr/m² boyta**, with 250–500 observed in 50-year plans.
- SEB calls anything over 200 good.

Caveats:

1. Area basis differs: Swedbank uses **boyta**; HSB and the BFNAR nyckeltal use total yta
   (BR + hyresrätt area). For a BRF with lokaler, 300 kr/m² total yta ≠ 300 kr/m² boyta.
2. None of these actors publishes how the number is derived. They are rules of thumb from
   förvaltare and banks, not engineering estimates.
3. All are nominal 2024–2026 levels.
4. Every source says the BRF's own 50-year underhållsplan beats the schablon.

A defensible fallback is "300 kr/m² total yta per year (HSB 2026; Riksbyggen 2025: 305), range
250–350". Name the source in the UI and label it "Schablon".

---

## 3. How the statutory nyckeltal "sparande per m²" is defined and benchmarked

**Definition (BFNAR 2023:1, punkt 8, [BFN][bfnar]):** "justerat resultat divideras med summan
av antalet kvadratmeter upplåtna med bostadsrätt och antalet kvadratmeter upplåtna med
hyresrätt". Here "justerat resultat" = "årets resultat ökat med årets avskrivningar, årets
kostnad för utrangeringar och årets kostnad för planerat underhåll". Material items outside
normal operations are removed. The measure is therefore close to an operating cash surplus
before planned maintenance. Amortisation is not deducted (SEB notes that savings via
amortisation don't show up separately).

Benchmarks found:

| Source                                                                                      | Low                 | OK                                                         | High / good  |
| ------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- | ------------ |
| HSB Bostadsrättskollen scale, printed in HSB annual reports (e.g. HSB brf Skogslyckan 2025) | "Mycket lågt" < 120 | "Lågt till måttligt" 120–200; "Måttligt till högt" 201–300 | "Högt" > 300 |
| Swedbank Boindex Q2 2025                                                                    | < 225 "lågt"        | —                                                          | > 325 "bra"  |
| SEB                                                                                         | < 120 "se upp"      | —                                                          | > 200 "bra"  |

Sources: [HSB Bostadsrättskollen scale in an annual report][hsb-brk];
[Swedbank Boindex][swb-boindex]; [SEB][seb]. Bostadsrättskollen also prints a separate
nyckeltal, **"Investeringsbehov"**, defined as the average value of the investments needed over
the next 50 years per m² total yta. Where a BRF reports it, it is the direct counterpart of
sparbehov and beats any schablon. Allabrf grades nyckeltal on an A++–C scale against national
data, but its sparande cut-offs could not be retrieved (ingen källa hittad).

Note for Binfo: `BENCHMARKS.md` §5 currently grades sparande only by sign (God > 0, Svag < 0),
far more lenient than any external scale above. This is not changed here; it is the owner's
product decision.

---

## 4. How to use this

**Well supported:**

- The ~300 kr/m²/year generic savings target (several independent P sources, 250–350 band).
- The BFNAR definition.
- The HSB and Swedbank benchmark scales.
- Lifetimes for fönster, fasad, tak and stammar in broad terms (≈ 30–60 years, with FAR 2025
  as the current BRF-specific reference).
- OVK intervals (3/6 years).

**Weak or missing:**

- Per-component **costs**, especially stambyte (only secondary or lead-gen sources, per
  apartment, spanning 150 000–500 000 kr).
- Per-m² roof costs.
- Elevators, el, balconies, tvättstuga, källare, gård: no costs found.
- Age-banded savings needs: none found.

**Caveats:**

- _Price level:_ cost figures range from 1984 (M84:10, lifetimes only), 2008 (SABO/BKN) and
  2014 (relining/stambyte) to 2023 (BeBo/Repab) and 2025–26 (secondary). None is indexed here.
  Construction costs rose substantially 2021–2023, so pre-2021 kronor understate today's costs.
  If Binfo indexes, cite the index (e.g. SCB byggkostnadsindex) and the base year.
- _Accounting vs technical life:_ FAR's nyttjandeperioder are for depreciation. A component can
  outlive its depreciation life (or not). Use them as planning intervals only with that label.
- _Building type:_ HSB 2026 stresses design (number of bodies, floors, elevators); Swedbank
  stresses condition over age. A flat national kr/m² ignores both.
- _Regional differences:_ actual savings differ by region (HSB Malmö 176 vs HSB national 225
  in nearby years). No source gives region-specific _need_. Contractor price differences
  between regions: ingen källa hittad.
- _Recommendations come from förvaltare and banks_ that sell administration, plans or loans to
  BRFs. Their incentives point towards higher savings and better plans. That is not a reason to
  dismiss them, but none publishes its derivation.
- _Area basis:_ always state whether a figure is per boyta (Swedbank) or per total yta
  (BFNAR, HSB) before comparing it with a BRF's nyckeltal.

---

## 5. Sources (all accessed 2026-10-24)

| Key                | Source                                                                                                                                                                                                                  | Year / date               | Type             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------- |
| bfnar              | Bokföringsnämnden, BFNAR 2023:1, punkt 8 — https://www.bfn.se/wp-content/uploads/bfnar2023-1-grund.pdf                                                                                                                  | 2023                      | P                |
| far-komp           | FAR, "Komponentindelning i bostadsrättsförening – en vägledning vid övergång från K2 till K3" — https://www.faronline.se/dokument/far/vlkomponentindelningbrf/                                                          | 2025-06-25                | P                |
| m84-ajg            | SIB Meddelande M84:10 "Teknisk medellivslängd för byggnadskonstruktioner", as republished by Gallagher — https://www.ajg.com/se/-/media/files/gallagher/se/nordic-files/lista-teknisk-medellivsl-ng-byggnadsdelar.pdf   | 1984 (file 2016)          | P (old)          |
| insyn-bilaga       | "Bilaga 1. Teknisk medellivslängd för byggnadsdelar" (based on M84:10 + SABO avskrivningsregler) — https://insynsverige.se/documentHandler.ashx?did=2018592                                                             | undated                   | S                |
| chalmers           | Apelqvist & Nilsson, "Komponentavskrivning i teori och praktik", Chalmers examensarbete 2015:20 — https://publications.lib.chalmers.se/records/fulltext/220298/220298.pdf                                               | 2015                      | P (thesis)       |
| bebo               | BeBo / WSP (Karlsson, Holmén, Bratt, Werner), "Vägledning – Lönsamhet och kostnader" (costs based on Repab Fakta 2023) — https://www.bebostad.se/media/6643/v%C3%A4gledning-l%C3%B6nsamhet-och-kostnader-2024-01-31.pdf | 2023-09 (file 2024-01-31) | P                |
| kth-fx             | Hansson & Svensson, "Energibesparing med FX och FTX", KTH 2023 (Svenska Bostäder data) — https://kth.diva-portal.org/smash/get/diva2:1809388/FULLTEXT01.pdf                                                             | 2023                      | P (thesis)       |
| betsi              | Boverket, "Så mår våra hus" (BETSI), 2009 — https://www.fuktcentrum.lth.se/fileadmin/fuktcentrum/Publikationer/sa_mar_vara_hus_Boverket2009_BETSI.pdf                                                                   | 2009 (SCB 2007 data)      | P                |
| hgf                | Hyresgästföreningen, "Renovera Sverige" (cites BKN 2008 / SABO) — https://www.hyresgastforeningen.se/globalassets/bostadsfakta/rapporter/2022/hgf_rapport_renovera_sverige_20221116.pdf                                 | 2022-11                   | S                |
| hsb-barometer-2026 | HSB, "Sveriges Bostadsrättsbarometer 2026" — https://via.tt.se/files/3237251/4441121/359329/sv                                                                                                                          | 2026                      | P                |
| hsb-malmo-2025     | HSB Malmö, "Bostadsrättsbarometer 2025" — https://mnd-assets.mynewsdesk.com/image/upload/f_pdf/grth1rad7bswokh9wj2h03                                                                                                   | 2025                      | P                |
| hsb-nyckeltal      | HSB nyckeltalsrapport, Brf Mälaren, räkenskapsår 2023 — https://www.hsb.se/link/5d4635bad4f94d4685a439d035e441d3.aspx                                                                                                   | file 2024-06              | P                |
| hsb-brk            | HSB brf Skogslyckan i Västerås, Årsredovisning 2025 (Bostadsrättskollen page) — https://cdn-realestate.kowboy.se/v310/vitec/files/M16986/OBJ5PQHBSS2RNNLL6BSBK/_F_ORG_T218_49038.pdf                                    | 2026                      | P (HSB template) |
| hsb-fasad          | HSB Mellersta Götaland, Fasadrenovering — https://www.hsb.se/mellerstagotaland/tjanster/byggledning/fasadrenovering/                                                                                                    | undated                   | S                |
| rb-2025            | Riksbyggen, "Ekonomisk rapport för bostadsrättsföreningar", April 2025 — https://www.riksbyggen.se/globalassets/1-riksbyggen/fastighetsforvaltning/ekonomisk-forvaltning/ekonomisk-rapport-brf-april2025.pdf            | 2025-04                   | P                |
| rb-2026            | Riksbyggen, "Ekonomisk rapport för bostadsrättsföreningar", April 2026 — https://www.riksbyggen.se/49b963/globalassets/1-riksbyggen/fastighetsforvaltning/ekonomisk-forvaltning/ekonomisk_rapport_brf_april_2026.pdf    | 2026-04                   | P                |
| swb-boindex        | Swedbank, "Vad bestämmer priset på en bostadsrätt?", Temarapport Swedbank Boindex kvartal 2 (P. Witthoff) — https://mb.cision.com/Public/67/4235484/bb78bcbce985aec2.pdf                                                | 2025-09-10                | P                |
| swb-teknisk        | Swedbank & Sparbankerna, "Teknisk skuld och underhållsskuld" (P. Witthoff, A. Arques) — https://mb.cision.com/Public/67/4279156/a0cfcb238a87545b.pdf                                                                    | 2025-12-08                | P                |
| fao-bank           | Fastighetsägarna Stockholm, "Viktiga parametrar vid bankens kreditbedömning" — https://www.fastighetsagarna.se/globalassets/broschyrer-och-faktablad/brf/viktiga_parametrar_vid_bankens_kreditbedomning_2024.pdf        | 2024                      | P                |
| seb                | SEB, "Nya nyckeltal för bostadsrättsföreningar – så tolkar du dem" — https://seb.se/privat/livet/bostadsguide/bostadsratt/nya-nyckeltal-for-bostadsrattsforeningar-sa-tolkar-du-dem                                     | undated                   | S/P              |
| placera            | Placera, "Rekordlågt sparande bland BRF:er – risk för avgiftschock" — https://www.placera.se/nyheter/rekordlagt-sparande-bland-brf-er-risk-for-avgiftschock-2024-12-16                                                  | 2024-12-16                | S                |
| realtid            | Realtid, "Faran för bostadsrättsföreningarna är inte över" — https://www.realtid.se/spara-placera/faran-for-bostadsrattsforeningarna-ar-inte-over/                                                                      | 2026-05-27                | S                |
| far-balans         | O. Deurell, "Brf:er sparar för lite trots nya regler", Balans fördjupning (Parameter Revision data) — https://www.faronline.se/dokument/balans-fordjupning/2020-tal/2025/balans_fordjupning_2025062401/                 | 2025-06-24                | S/P              |
| planima            | Planima blog (lists SCB, Malmö, Allabrf maintenance kr/m²) — https://planima.se/blogg/sank-dina-underhallskostnader-med-6-enkla-planeringsknep/                                                                         | undated                   | S                |
| lusa-stam          | Lusa, "Stambyte i BRF" — https://lusa.se/guide/stambyte-brf                                                                                                                                                             | updated 2026-10           | S (competitor)   |
| svt-relining       | SVT, "Varnar för relining – kan bli ekonomisk kalldusch" (Sveriges Bostadsrättscentrum) — https://www.svt.se/nyheter/inrikes/varnar-for-relining-kan-bli-ekonomisk-kalldusch                                            | 2014-07-12                | S                |
| brfpris-stam       | brfpris.se (Fixer Sverige AB), Pris för stambyte — https://brfpris.se/stambyte/pris/                                                                                                                                    | "2026" levels, no method  | W                |
| brfpris-tak        | brfpris.se, Pris för tak — https://brfpris.se/tak/pris/                                                                                                                                                                 | undated                   | W                |
| brfpris-hiss       | brfpris.se, Pris för hiss — https://brfpris.se/hiss/pris/                                                                                                                                                               | undated                   | W                |
| dps-hiss           | Dagens PS, "Varning: gamla hissar kan bli dödsfällor" (Hissförbundet via Hem & Hyra) — https://www.dagensps.se/privatekonomi/bostadsratt/varning-gamla-hissar-kan-bli-dodsfallor/                                       | 2021-03-10                | S                |
| malmo-ovk          | Malmö stad, Obligatorisk ventilationskontroll (OVK) — https://malmo.se/For-foretag-och-verksamheter/For-fastighetsagare/Obligatorisk-ventilationskontroll-OVK.html                                                      | undated                   | S                |

Not used, though found: offerta.se, hantverkskollen.se, boio.se and similar price-guide pages,
which are unsourced and duplicate the brfpris ranges. Also forum posts. The Allabrf support
article (support.allabrf.se) could not be opened (certificate error / 404).

[bfnar]: https://www.bfn.se/wp-content/uploads/bfnar2023-1-grund.pdf
[far-komp]: https://www.faronline.se/dokument/far/vlkomponentindelningbrf/
[m84-ajg]: https://www.ajg.com/se/-/media/files/gallagher/se/nordic-files/lista-teknisk-medellivsl-ng-byggnadsdelar.pdf
[insyn-bilaga]: https://insynsverige.se/documentHandler.ashx?did=2018592
[chalmers]: https://publications.lib.chalmers.se/records/fulltext/220298/220298.pdf
[bebo]: https://www.bebostad.se/media/6643/v%C3%A4gledning-l%C3%B6nsamhet-och-kostnader-2024-01-31.pdf
[kth-fx]: https://kth.diva-portal.org/smash/get/diva2:1809388/FULLTEXT01.pdf
[betsi]: https://www.fuktcentrum.lth.se/fileadmin/fuktcentrum/Publikationer/sa_mar_vara_hus_Boverket2009_BETSI.pdf
[hgf]: https://www.hyresgastforeningen.se/globalassets/bostadsfakta/rapporter/2022/hgf_rapport_renovera_sverige_20221116.pdf
[hsb-barometer-2026]: https://via.tt.se/files/3237251/4441121/359329/sv
[hsb-malmo-2025]: https://mnd-assets.mynewsdesk.com/image/upload/f_pdf/grth1rad7bswokh9wj2h03
[hsb-nyckeltal]: https://www.hsb.se/link/5d4635bad4f94d4685a439d035e441d3.aspx
[hsb-brk]: https://cdn-realestate.kowboy.se/v310/vitec/files/M16986/OBJ5PQHBSS2RNNLL6BSBK/_F_ORG_T218_49038.pdf
[hsb-fasad]: https://www.hsb.se/mellerstagotaland/tjanster/byggledning/fasadrenovering/
[rb-2025]: https://www.riksbyggen.se/globalassets/1-riksbyggen/fastighetsforvaltning/ekonomisk-forvaltning/ekonomisk-rapport-brf-april2025.pdf
[rb-2026]: https://www.riksbyggen.se/49b963/globalassets/1-riksbyggen/fastighetsforvaltning/ekonomisk-forvaltning/ekonomisk_rapport_brf_april_2026.pdf
[swb-boindex]: https://mb.cision.com/Public/67/4235484/bb78bcbce985aec2.pdf
[swb-teknisk]: https://mb.cision.com/Public/67/4279156/a0cfcb238a87545b.pdf
[fao-bank]: https://www.fastighetsagarna.se/globalassets/broschyrer-och-faktablad/brf/viktiga_parametrar_vid_bankens_kreditbedomning_2024.pdf
[seb]: https://seb.se/privat/livet/bostadsguide/bostadsratt/nya-nyckeltal-for-bostadsrattsforeningar-sa-tolkar-du-dem
[placera]: https://www.placera.se/nyheter/rekordlagt-sparande-bland-brf-er-risk-for-avgiftschock-2024-12-16
[realtid]: https://www.realtid.se/spara-placera/faran-for-bostadsrattsforeningarna-ar-inte-over/
[far-balans]: https://www.faronline.se/dokument/balans-fordjupning/2020-tal/2025/balans_fordjupning_2025062401/
[planima]: https://planima.se/blogg/sank-dina-underhallskostnader-med-6-enkla-planeringsknep/
[lusa-stam]: https://lusa.se/guide/stambyte-brf
[svt-relining]: https://www.svt.se/nyheter/inrikes/varnar-for-relining-kan-bli-ekonomisk-kalldusch
[brfpris-stam]: https://brfpris.se/stambyte/pris/
[brfpris-tak]: https://brfpris.se/tak/pris/
[brfpris-hiss]: https://brfpris.se/hiss/pris/
[dps-hiss]: https://www.dagensps.se/privatekonomi/bostadsratt/varning-gamla-hissar-kan-bli-dodsfallor/
[malmo-ovk]: https://malmo.se/For-foretag-och-verksamheter/For-fastighetsagare/Obligatorisk-ventilationskontroll-OVK.html
