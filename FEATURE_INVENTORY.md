# Binfo – funktionsinventering för design

_Sammanställd 2026-10-27 från källkoden (`main`) och den publicerade sajten binfo.slanesens.com._

Det här dokumentet listar allt som finns i Binfo i dag och som en ny design borde täcka: varje sida, varje knapp och fält, vilken serverfunktion som ligger bakom, alla tillstånd (tomt, laddar, fel, lyckat, nekad, första besöket) och de viktigaste användarresorna. Sist finns en checklista att bocka av mot den nya designen.

**Vad som ingår:** bara funktioner som är publicerade och synliga för användare i dag.

**Vad som inte ingår:**

- Element som finns i koden men är dolda (t.ex. rutan "Dina senaste analyser" och växeln Bostadsrätt/Hus i köpguiden).
- Funktioner som inte är färdigbyggda (t.ex. byta e-postadress och skicka bekräftelsemejlet igen).
- Innehållet i PDF- och Excel-filerna och utformningen av mejlen. Knapparna som laddar ner filerna finns med.
- Adminverktyg. Det finns inget admin-gränssnitt; drift sköts med kommandoradsverktyg.

**Läsanvisning:**

- Texter inom citattecken är exakt de som visas i gränssnittet.
- Sidorna har fasta beteckningar som används i alla avsnitt: G1 sidhuvud/sidfot, S1–S19 sidor, K1 analysrapporten, K2 spara-flödet. K1 och K2 är delade delar som syns på flera sidor.
- Rader som börjar med **Känt fel** pekar ut brister i dagens texter eller beteenden som den nya designen inte bör ärva.

**Användartyper:**

- _Utloggad besökare_
- _Inloggad användare_
- _Ägare_ (den som skapade eller sparade något)
- _Vem som helst med länken_ (analyslänkar är hemliga länkar)
- Det finns inga andra roller.

## Innehåll

1. [Sidor och vägar in](#1-sidor-och-vägar-in)
2. [Alla handlingar per sida](#2-alla-handlingar-per-sida)
3. [Serverfunktioner och vad som utlöser dem](#3-serverfunktioner-och-vad-som-utlöser-dem)
4. [Tillstånd som UI:t måste hantera](#4-tillstånd-som-uit-måste-hantera)
5. [Användarresor från början till slut](#5-användarresor-från-början-till-slut)
6. [Checklista](#6-checklista)

## 1. Sidor och vägar in

Binfo har 19 sidor eller sidgrupper (S1–S19) plus ett gemensamt sidhuvud och en sidfot (G1). Avsnittet beskriver för varje sida vad den är till för, vem som kommer åt den, hur man hamnar där (varje länk, knapp och omdirigering) och vilka värden i adressraden som ändrar sidan. Vad som finns på sidorna (fält, knappar, tillstånd) beskrivs i avsnitten om sidornas innehåll. Här är fokus vägarna in.

Några regler som gäller överallt:

- **Ingen admin.** Det finns inget administratörsgränssnitt i Binfo. Driftarbete (till exempel att ogiltigförklara en rapport eller radera ett konto på begäran) sker via kommandoradsverktyg och beskrivs inte här.
- **Utloggad besökare** kan använda det mesta: analysera, priskoll, kalkyl, register, köpguide. Webbläsaren får då en anonym enhetscookie. Inloggning behövs bara för att spara och för Mitt konto.
- **Analyslänkar är hemliga.** Adressen till en analys (`/forhandsvisning/<id>` och `/analys/<id>`) innehåller ett slumpat id. Den som har länken kan läsa analysen. Det görs ingen ägarkontroll vid läsning.
- **Inloggningskrav sätts i webbläsaren.** Sidor som kräver inloggning (Mitt konto, Välj nytt lösenord, sparade objekt) visar först "Laddar…" och skickar sedan användaren till inloggningen när webbläsaren har kollat sessionen. Servern kontrollerar också vid varje anrop.
- **Sökmotorer:** konto-sidorna, analyssidorna och föreningens fullständiga analys har `noindex` (sökmotorer ska inte visa dem). Resten är öppna för sökmotorer.
- **Omdirigering efter inloggning:** många vägar skickar användaren till inloggningen med ett "dit du ska sedan" (`till`) och ibland en markering om vad som ska sparas (`spara`). Bara adresser på Binfos egen sajt godtas; allt annat ersätts med `/konto`.

### Sammanfattning

| Sida                                | Adress                                               | Vem                                    | Syfte                                                       |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| G1 Sidhuvud och sidfot              | alla sidor                                           | alla                                   | Navigering och integritetslänk                              |
| S1 Startsida                        | `/`                                                  | alla                                   | Presentera Binfo och leda vidare                            |
| S2 Analysera en bostad              | `/analysera`                                         | alla (spara kräver konto)              | Gratis priskoll och valfri föreningsanalys                  |
| S3 Analys pågår / rapport           | `/forhandsvisning/$analysisId`                       | den som har länken                     | Väntskärm, sedan hela rapporten                             |
| S4 Rapport (bokmärkeslänk)          | `/analys/$analysisId`                                | den som har länken                     | Samma rapport som stabil länk                               |
| S5 Exempelrapport                   | `/exempel`                                           | alla                                   | Visa en färdig rapport                                      |
| S6 Bolånekalkyl                     | `/bolanekalkyl`                                      | alla (spara kräver konto)              | Räkna månadskostnad                                         |
| S7 Köpguide                         | `/kopguide`                                          | alla                                   | Steg-för-steg-guide till bostadsköpet                       |
| S8 BRF-registret                    | `/brf`                                               | alla                                   | Sök och bläddra bland analyserade föreningar                |
| S9 Område i registret               | `/brf/omrade/$omrade`                                | alla                                   | Lista föreningar i ett område                               |
| S10 Föreningssida                   | `/brf/$slug`                                         | alla                                   | Sammanfattning av en förening                               |
| S11 Föreningens fullständiga analys | `/brf/$slug/analys/$ar`                              | alla (kan styras av behörighet)        | Hela den sparade föreningsanalysen                          |
| S12 Mitt konto                      | `/konto`                                             | inloggad                               | Sparade analyser, värderingar, kalkyler; kontoinställningar |
| S13 Logga in                        | `/konto/logga-in`                                    | utloggad                               | Logga in                                                    |
| S14 Skapa konto                     | `/konto/skapa`                                       | utloggad                               | Skapa konto                                                 |
| S15 Glömt lösenord                  | `/konto/glomt-losenord`                              | alla                                   | Be om länk för nytt lösenord                                |
| S16 Bekräfta e-post                 | `/konto/bekrafta`                                    | den som har mejllänken                 | Bekräfta konto eller återställning                          |
| S17 Välj nytt lösenord              | `/konto/nytt-losenord`                               | inloggad (även via återställningslänk) | Byta lösenord                                               |
| S18 Integritet                      | `/integritet`                                        | alla                                   | Integritetspolicy                                           |
| S19 Omdirigeringar och systemsidor  | `/vardering`, `/guide`, 404, felsida, `/sitemap.xml` | alla                                   | Gamla länkar, felhantering, sajtkarta                       |

### G1 Sidhuvud (navigering) och sidfot

**Syfte.** Sidhuvudet visas överst på varje sida och är fast vid scrollning. Sidfoten visas längst ned på varje sida.

**Vem kommer åt sidan.** Alla. Kontoknappen längst till höger byter text efter inloggning.

**Vad som finns.**

- Sidhuvud: logotypen "Binfo" (länk till startsidan), länkarna "Analysera", "BRF-register", "Bolånekalkyl", "Köpguide" och längst till höger en knapp: "Logga in" (utloggad) eller "Mitt konto" (inloggad). Medan sessionen hämtas reserveras platsen osynligt så att menyn inte hoppar. Den aktiva sidan markeras. Det finns ingen mobilmeny; raden bryts på flera rader.
- Sidfot: "Binfo", en text om att Binfo är oberoende och inte rådgivning, och länken "Integritet och personuppgifter". Det finns inga fler länkar i sidfoten (ingen kontaktadress, ingen sajtkarta).

**Hur man hamnar här.** Visas automatiskt på alla sidor. Felsidan som servern skickar vid ett allvarligt fel och 404-sidan har sin egen utformning (se S19).

**Adressparametrar.** Inga.

### S1 Startsida `/`

**Syfte.** Presenterar Binfo ("Säljaren har en mäklare. Nu har du Binfo."), visar ett exempel på hur en rapport ser ut (en uppbyggd exempelruta med påhittade siffror) och leder vidare till analys, köpguide och kalkyl.

**Vem kommer åt sidan.** Alla, utloggad eller inloggad. Öppen för sökmotorer. Startsidan visar inte om man är inloggad.

**Hur man hamnar här.**

- Logotypen "Binfo" i sidhuvudet.
- "Till startsidan" på 404-sidan och på felsidorna.
- Efter "Logga ut" i Mitt konto och efter att kontot raderats.
- Direkt via adressen.

**Adressparametrar.** Inga.

> **Känt fel:** I exempelrutan på startsidan pekar de fyra stegraderna ("Föreningen", "Priset", "Månadskostnad", "Har du råd?") på ankare (`#foreningen`, `#priset`, `#kostnaden`) som inte finns på sidan. Klick gör ingenting synligt.

> **Känt fel/avvikelse:** Startsidan säger "Tolv steg" i teasern om köpguiden och "4 av 12" i exempelrutan. Köpguiden visar i dag 12 steg för bostadsrätt, så antalet stämmer med det som visas, men stegen i exempelrutan är påhittade och inte kopplade till guiden.

### S2 Analysera en bostad `/analysera`

**Syfte.** Sidans huvudverktyg. Steg 1 "Priskoll" ger en gratis värdering utan uppladdning. Steg 2 "Granska föreningen (valfritt)" laddar upp årsredovisningen (eller använder en som redan finns i registret) och startar en föreningsanalys. Ovanför steg 1 kan man klistra in en Booli-länk för att fylla i formuläret. Samma adress visar också en sparad värdering när man öppnar den från Mitt konto.

**Vem kommer åt sidan.** Alla. Priskoll och analys fungerar utloggat; servern begränsar hur många man får göra per dygn. Att spara kräver konto. En sparad värdering (`?sparad=`) kräver inloggning och skickar annars användaren till inloggningen. Öppen för sökmotorer.

**Hur man hamnar här.**

- Sidhuvudets länk "Analysera".
- Startsidan: knappen "Analysera en bostad" samt kortlänkarna "Granska föreningen" och "Kolla priset".
- Köpguiden: länken "Analysera föreningen här" (steget "Granska föreningens ekonomi").
- Exempelrapporten: länken "Ladda upp en årsredovisning".
- Integritetssidan: länken "Analysera".
- Föreningssidan och föreningens fullständiga analys: knappen "Analysera en lägenhet i föreningen" (öppnar registerläget, `?forening=`).
- BRF-registret/området när listan är tom: knappen "Analysera en bostad".
- Mitt konto: "Analysera en bostad" (tom analyslista), "Gör en priskoll" (tom värderingslista) och "Öppna" på en sparad värdering (`?sparad=`).
- Felskärmarna på S3: "Till formuläret" och "Starta en ny analys".
- Den sparade värderingens länk "Gör en ny värdering".
- Efter inloggning: knappen "Spara värderingen" skickar utloggade via inloggningen och tillbaka hit (`?spara=vardering`).
- Den gamla adressen `/vardering` omdirigeras hit.
- Länken "Ladda upp en annan årsredovisning i stället" (i registerläget) laddar om sidan utan `?forening=`.

**Adressparametrar som ändrar sidan.**

- `forening` (föreningens identifierare från registret): steg 2 visar "Föreningens årsredovisning finns redan hos Binfo" i stället för filuppladdning. Hittas inte föreningen visas en ruta och vanlig uppladdning.
- `sparad` (id på en sparad värdering): hela sidan byts mot den sparade värderingen med knappen "Räkna om med dagens modell".
- `spara=vardering`: efter inloggning fyller sidan i det utkast användaren lämnade och sparar värderingen automatiskt.
- `utgangspris`, `boarea`, `antalRum`, `manadsavgift`, `postnummer`, `vaning`, `byggar`: förifyller motsvarande fält (äldre länkar).
- Ankaret `#vet-ej`: rullar ner till Hiss och Balkong (används av länken från rapportens säkerhetsmätare).

> **Notis om Booli:** Fältet "Klistra in länk från Booli" och knappen "Hämta uppgifter" finns live, men Booli blockerar hämtningen från Binfos server. I praktiken slutar det oftast i meddelandet "Vi kunde inte hämta uppgifterna, fyll i manuellt." Formuläret kan alltid fyllas i för hand.

### S3 Analys pågår / rapport `/forhandsvisning/$analysisId`

**Syfte.** Sidan man landar på direkt efter uppladdning. Den visar hur analysen går (steg och förloppsstapel), uppdaterar sig själv var femte sekund och visar sedan hela rapporten på samma sida. Den visar också felmeddelanden och "hittades inte".

**Vem kommer åt sidan.** Vem som helst med länken (hemligt id). Ingen inloggning krävs och ingen ägarkontroll vid läsning. Sökmotorer ska inte indexera sidan (`noindex`). Att spara analysen i sin profil kräver konto och går bara för analysen som skapades i den egna webbläsaren eller kontot.

**Hur man hamnar här.**

- Automatiskt efter "Analysera" på S2 (både uppladdning och registerläget).
- Omdirigering från S4 när analysen inte är klar, misslyckats, inte hittas eller inte får läsas.
- Mitt konto: "Öppna" på en analys som inte är klar.
- Bokmärke eller delad länk.

**Adressparametrar.** `spara=analys`: efter inloggning slutförs ett väntande "Spara analysen" (värdet tas bort ur adressen efteråt). Själva analysen väljs av id:t i adressen.

### S4 Rapport (bokmärkeslänk) `/analys/$analysisId`

**Syfte.** En stabil länk till den färdiga rapporten (samma innehåll som S3 när analysen är klar). Sidan har ingen egen väntskärm.

**Vem kommer åt sidan.** Vem som helst med länken. `noindex`. Är analysen inte klar, har misslyckats, saknas eller får inte läsas omdirigeras man direkt till S3, som visar rätt skärm.

**Hur man hamnar här.**

- Mitt konto: "Öppna" på en klar analys.
- Bokmärken och delade länkar.
- Tillbaka efter inloggning när "Spara analysen" gjorts på denna sida.

**Adressparametrar.** `spara=analys` som på S3.

### S5 Exempelrapport `/exempel`

**Syfte.** Visar en färdig riktig rapport (Brf Pontonjären 3, en tidigare körning) så att besökaren ser vad en analys innehåller innan något laddas upp.

**Vem kommer åt sidan.** Alla. Öppen för sökmotorer och med i sajtkartan. Ingen uppladdning och ingen kostnad. Rapporten saknar "Spara analysen"-rutan.

**Hur man hamnar här.** Bara från startsidan: länken "Se ett exempel på en rapport". Sidan finns inte i sidhuvudet eller sidfoten.

**Adressparametrar.** Inga.

### S6 Bolånekalkyl `/bolanekalkyl`

**Syfte.** Kalkyl för total månadskostnad (ränta, ränteavdrag, amortering enligt 2026 års regler, avgift och driftskostnader), med räntescenarier och bankens kalkyl (KALP) under "Fördjupning". Beräkningen sker i webbläsaren. Kalkylen kan sparas (konto) och exporteras.

**Vem kommer åt sidan.** Alla. Inget skickas till servern om man inte själv trycker på spara som inloggad. Att spara kräver konto; en sparad kalkyl (`?sparad=`) kräver inloggning och skickar annars användaren till inloggningen. Öppen för sökmotorer.

**Hur man hamnar här.**

- Sidhuvudets länk "Bolånekalkyl".
- Startsidan: länken "Räkna på månadskostnaden".
- Köpguiden: länken "Räkna på din månadskostnad här" (steg 1 och 9).
- Rapporten (S3/S4/S5): knappen "Räkna på månadskostnaden" (förifyller avgift, pris, boarea och räntekänslighet).
- Mitt konto: "Öppna bolånekalkylen" (tom lista) och "Öppna" på en sparad kalkyl.
- Efter inloggning från "Spara kalkylen": tillbaka hit (`?spara=kalkyl`).

**Adressparametrar som ändrar sidan.**

- `manadsavgift`, `boarea`, `pris`: förifyller månadsavgift, boarea och lånebelopp (priset delas i lån och minsta kontantinsats på 10 %).
- `rantekanslighet`: aktiverar stress av föreningens avgift i räntescenarierna.
- `prisUppskattning=true`: hjälptexten säger att priset är en uppskattning.
- `sparad` (id): öppnar en sparad kalkyl och fyller i alla fält.
- `spara=kalkyl`: slutför en väntande sparning efter inloggning.
- Skräpvärden ignoreras utan fel.

> **Känt fel:** Hjälptexten under Boarea ("Styr schablonerna för el, värme och hemförsäkring") och under Antal personer ("Styr schablonen för vattenkostnad") är fel väg: enligt reglerna räknas värme och vatten på boarea, medan hushållsel och hemförsäkring räknas på antal personer.

### S7 Köpguide `/kopguide`

**Syfte.** Tidslinje över bostadsköpets steg (från lånelöfte till tillträde och efter) med flaggor och tips per steg. Stegen kan bockas av.

**Vem kommer åt sidan.** Alla. Allt ligger bara i sidans minne: avbockningar sparas inte när man laddar om. Öppen för sökmotorer.

**Hur man hamnar här.**

- Sidhuvudets länk "Köpguide".
- Startsidan: knapparna "Se köpguiden" och "Öppna köpguiden" samt länken i exempelrutan ("Köpguiden: nästa steg är budgivningen").
- `/guide` omdirigeras hit.

**Adressparametrar.** Inga.

> **Känt fel:** Texten i steget "Medlemskap i föreningen" är avhuggen och slutar med "…bostadsrättslagen,vanligtvis inom några veckor. U".

### S8 BRF-registret `/brf`

**Syfte.** Registrets startsida: en sökruta (förening eller organisationsnummer) och områdeskort grupperade i Innerstaden, Söderort och Västerort (samt Övriga Stockholm när sådana finns).

**Vem kommer åt sidan.** Alla. Bara föreningsuppgifter, inga köpardata. Sidan är cache-bar och sätter inga cookies. Öppen för sökmotorer, med i sajtkartan.

**Hur man hamnar här.**

- Sidhuvudets länk "BRF-register".
- Brödsmulan "BRF-register" på S9, S10 och S11.
- Länkarna "Till BRF-registret" och "Sök i BRF-registret" på registrets 404-sidor.
- Integritetssidan: länken "BRF-registret".
- Sajtkartan.

**Adressparametrar som ändrar sidan.** `sok` (sökord, visar träfflistan ovanför områdena), `sortering` (betyg, skuld, avgift, sparande eller analysdatum), `riktning` (stigande/fallande) och `sida` (sidnummer). Sökning, sortering och sida ligger i adressen så att en vy går att dela.

### S9 Område i registret `/brf/omrade/$omrade`

**Syfte.** Sorterbar lista över föreningarna i ett område (50 per sida) med eget sökfilter.

**Vem kommer åt sidan.** Alla, som S8. Okänt område ger en egen 404-ruta ("Området finns inte i registret").

**Hur man hamnar här.**

- Ett områdeskort på S8.
- Områdets länk i brödsmulan på S10 och S11.
- Sajtkartan (bara områden som har minst en förening).

**Adressparametrar.** Områdets namn ingår i adressen. Dessutom `sok`, `sortering`, `riktning`, `sida` som på S8.

### S10 Föreningssida `/brf/$slug`

**Syfte.** Publik sammanfattning av en förening: betyg, de sju nyckeltalen med status och sidhänvisning, en tabell över tidigare år och en uppmaning att analysera en lägenhet i föreningen. Själva motiveringen, flaggorna och frågorna finns på S11.

**Vem kommer åt sidan.** Alla. Cache-bar, inga cookies, öppen för sökmotorer. Byter en förening namn omdirigeras den gamla adressen permanent till den nya. Okänd förening ger en 404-ruta ("Föreningen finns inte i registret").

**Hur man hamnar här.**

- Ett föreningsnamn i träfflistan på S8 eller i tabellen/korten på S9.
- Länkarna "Tillbaka till <föreningens namn>" och "Till föreningens sida" från S11 (och "Tillbaka till föreningens sammanfattning" när analysen inte är tillgänglig).
- Sajtkartan och sökmotorer.

**Adressparametrar.** Föreningens identifierare (`<namn>-<organisationsnummer>`) ingår i adressen. Inga andra parametrar.

> **Känt fel:** Raden "Hittar du ett fel? Kontakta oss." har ingen kontaktadress eller länk. Det finns ingen e-postadress att nå Binfo på.

### S11 Föreningens fullständiga analys `/brf/$slug/analys/$ar`

**Syfte.** Den sparade fullständiga föreningsanalysen för ett räkenskapsår: motivering till betyget, röda flaggor, nyckeltal med sidhänvisningar, övrig information och frågor till styrelsen. Ingen köpardata. Analysen körs inte om vid visning.

**Vem kommer åt sidan.** Alla i dag. Åtkomsten styrs av en behörighetsregel på servern ("se_registeranalys") som i dag ger alla tillträde men kan sättas bakom konto eller betalning. Nekas man visas "Analysen är inte tillgänglig just nu" som en vanlig sida. Sidan är aldrig cachad och har `noindex`; den står inte i sajtkartan.

**Hur man hamnar här.**

- På S10: knappen "Se hela analysen för varför föreningen fick betyget <betyg>" och årtalen i tabellen "Nyckeltal per år".
- Gammal föreningsadress omdirigeras permanent till den nya.

**Adressparametrar.** Förening och räkenskapsår ingår i adressen. Ett år utanför 1900–2200 eller utan sparad analys ger 404-rutan "Analysen finns inte i registret".

### S12 Mitt konto `/konto`

**Syfte.** Profilen: lista över sparade analyser, värderingar och bolånekalkyler (öppna, ta bort/radera, exportera kalkyl) samt kontoinställningar (byt lösenord, ladda ner mina uppgifter, logga ut, radera konto).

**Vem kommer åt sidan.** Bara inloggad användare. Utloggad ser "Laddar…" och skickas till `/konto/logga-in?till=/konto`. `noindex`.

**Hur man hamnar här.**

- Sidhuvudets knapp "Mitt konto" (inloggad).
- Länkar efter sparande: "Se den i Mitt konto", "Se dina sparade uppgifter i Mitt konto".
- "Till Mitt konto" från den sparade värderingen, från kalkylsidans felrutor, och efter bytt lösenord.
- Integritetssidan: länken "Mitt konto".
- Efter inloggning eller bekräftad e-post när ingen annan destination finns (standardmål).

**Adressparametrar.** Inga.

### S13 Logga in `/konto/logga-in`

**Syfte.** Logga in med e-postadress och lösenord.

**Vem kommer åt sidan.** Utloggad besökare. Är man redan inloggad (till exempel bekräftat i en annan flik) skickas man vidare till målet. `noindex`.

**Hur man hamnar här.**

- Sidhuvudets knapp "Logga in".
- Automatiskt från Mitt konto, Välj nytt lösenord, sparade värderingar/kalkyler (utloggad) och från alla Spara-knappar när man är utloggad.
- Länken "Logga in" i ruta "Logga in för att spara" på S2/S6 och på S14.
- "Till inloggningen" och "Tillbaka till inloggning" från S15/S16.
- Länken "Redan bekräftat? Logga in" på S14 efter att kontot skapats.

**Adressparametrar.** `till` (dit man ska efter inloggning, bara Binfos egna adresser), `spara` (vilket sparande som ska slutföras: värdering, kalkyl eller analys; ändrar också ingresstexten till "Logga in för att spara. Dina uppgifter finns kvar när du kommer tillbaka.").

### S14 Skapa konto `/konto/skapa`

**Syfte.** Skapa konto med e-postadress och lösenord (minst 10 tecken). Därefter ber sidan användaren bekräfta via mejl.

**Vem kommer åt sidan.** Utloggad besökare; inloggad skickas vidare. `noindex`.

**Hur man hamnar här.** Länken "Skapa konto" under "Har du inget konto?" på S13. Parametrarna `till` och `spara` följer med från inloggningssidan.

**Adressparametrar.** `till` och `spara` som på S13.

### S15 Glömt lösenord `/konto/glomt-losenord`

**Syfte.** Be om en länk för att välja nytt lösenord.

**Vem kommer åt sidan.** Alla. `noindex`.

**Hur man hamnar här.** Länken "Glömt lösenordet?" på S13 och länken "Begär en ny länk" på S16 när en återställningslänk inte fungerar.

**Adressparametrar.** Inga.

### S16 Bekräfta e-post / länk från mejl `/konto/bekrafta`

**Syfte.** Landningssida för länkarna i Binfos mejl (bekräfta konto eller välj nytt lösenord). Länken verifieras först när användaren trycker på knappen, så att mejlskannrar inte förbrukar engångskoden.

**Vem kommer åt sidan.** Den som har länken från mejlet. `noindex`.

**Hur man hamnar här.** Bara via länken i mejlet ("bekräfta konto" respektive "återställ lösenord"). Ingen länk på själva sajten.

**Adressparametrar.** `token_hash` (engångskod), `type` (konto, återställning eller e-postbyte; e-postbyte kan inte påbörjas i dagens UI), `till` och `spara`. Saknas kod eller typ visas "Länken fungerar inte".

### S17 Välj nytt lösenord `/konto/nytt-losenord`

**Syfte.** Välja nytt lösenord, antingen efter en återställningslänk eller som inloggad.

**Vem kommer åt sidan.** Kräver en session (inloggad eller kommen från återställningslänken). Utloggad skickas till `/konto/logga-in?till=/konto/nytt-losenord` när webbläsaren har kollat. `noindex`.

**Hur man hamnar här.**

- Knappen "Byt lösenord" i kontoinställningarna i Mitt konto.
- Automatiskt efter "Fortsätt" på S16 när det gäller en återställning.

**Adressparametrar.** `nuvarande=ja`: visar fältet "Nuvarande lösenord" direkt (används från Mitt konto). Servern kan också kräva det och då visas fältet ändå.

### S18 Integritet `/integritet`

**Syfte.** Integritetspolicy: vad som sparas med och utan konto, cookies, hur länge, leverantörer och dina rättigheter.

**Vem kommer åt sidan.** Alla. Öppen för sökmotorer men saknas i sajtkartan.

**Hur man hamnar här.**

- Sidfotens länk "Integritet och personuppgifter" (på alla sidor).
- Länken "integritetspolicyn" på S14.

**Adressparametrar.** Inga.

> **Känt fel:** Policyn säger "kontakta oss" på flera ställen men ger ingen kontaktadress; kontaktuppgift saknas.

### S19 Omdirigeringar och systemsidor

**Syfte.** Gamla adresser som leder rätt, felsidor och sajtkarta.

**Vem kommer åt sidan.** Alla.

**Innehåll och vägar in.**

- **`/vardering`** omdirigeras permanent till `/analysera` (och tar med `sparad` och `spara`). Gamla länkar och sparade värderingslänkar fungerar därför. Ingen sida visas.
- **`/guide`** omdirigeras permanent till `/kopguide`.
- **404-sida** för okända adresser: "404", "Sidan hittades inte", "Sidan du letar efter finns inte eller har flyttats." och knappen "Till startsidan". Registrets sidor har egna 404-rutor (se S9, S10, S11).
- **Felsida** när något går fel i webbläsaren: "Sidan kunde inte laddas", "Något gick fel hos oss. Prova att ladda om sidan eller gå tillbaka till startsidan." med knapparna "Försök igen" och "Till startsidan". Går något fel på servern visas en enkel fristående sida med samma text och samma två knappar, i en annan utformning än resten av sajten.
- **`/sitemap.xml`**: sajtkarta för sökmotorer. Listar startsidan, Analysera, Bolånekalkyl, Köpguide, Exempel, BRF-registret, områden med minst en förening och varje förening. Listar inte Integritet, konto- eller analyssidor. `robots.txt` släpper in alla sökmotorer och pekar på sajtkartan.
- **Okänt analys-id**: på S3 visas "Vi hittar ingen analys med det här id:t" (se S3).

**Adressparametrar.** `/vardering` bär vidare `sparad` och `spara`.

---

## 2. Alla handlingar per sida

Så läser du avsnittet: varje sida har en tabell över allt man kan klicka, skriva i, välja eller dra. Kolumnen "Anropar" anger vilken serverfunktion som körs (en serverfunktion är ett anrop från webbläsaren till Binfos server); "ingen – bara i webbläsaren" betyder att allt sker lokalt. Felmeddelanden står ordagrant inom citattecken. Det finns inget admin-gränssnitt; adminarbete sker via kommandoradsverktyg och beskrivs inte här.

Gemensamt för alla formulärfält (komponenten `Field`): en röd ram och en röd text under fältet visar fel; en grå hjälptext visas när det inte finns något fel; "(valfritt)" står efter etiketten på valfria fält. Knappar är nedtonade och går inte att klicka när de är upptagna.

---

### G1 Sidhuvud (navigering) och sidfot

| Element                                   | Typ  | Vad den gör                                                                                                               | Anropar                                    |
| ----------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| "Binfo" (logotyp)                         | länk | Till startsidan `/`.                                                                                                      | ingen – bara i webbläsaren                 |
| "Analysera"                               | länk | Till `/analysera`. Aktiv sida markeras med ljus bakgrund.                                                                 | ingen                                      |
| "BRF-register"                            | länk | Till `/brf`.                                                                                                              | ingen                                      |
| "Bolånekalkyl"                            | länk | Till `/bolanekalkyl`.                                                                                                     | ingen                                      |
| "Köpguide"                                | länk | Till `/kopguide`.                                                                                                         | ingen                                      |
| "Logga in" (knapp-länk)                   | länk | Visas för utloggad besökare. Till `/konto/logga-in`.                                                                      | sessionsstatus hämtas via `hamtaSessionFn` |
| "Mitt konto" (knapp-länk)                 | länk | Visas för inloggad användare. Till `/konto`. Medan sessionen hämtas reserveras platsen osynligt så att raden inte hoppar. | `hamtaSessionFn`                           |
| "Integritet och personuppgifter" (sidfot) | länk | Till `/integritet`.                                                                                                       | ingen                                      |

Sidfoten innehåller också en text: "Oberoende stöd för bostadsköpare, från lånelöfte till tillträde. Binfo är inte kopplat till mäklare, bank eller förening. Analyserna är beslutsstöd, inte finansiell rådgivning. Slutgiltiga ansvaret ligger hos du som köpare."

Ingen mobilmeny: länkraden bryts över flera rader på smala skärmar.

---

### S1 Startsida `/`

| Element                                                                       | Typ                                           | Vad den gör                                                                                                                                                                                                  | Anropar |
| ----------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| "Analysera en bostad"                                                         | knapp-länk (primär, stor)                     | Till `/analysera`.                                                                                                                                                                                           | ingen   |
| "Se köpguiden"                                                                | knapp-länk (sekundär)                         | Till `/kopguide`.                                                                                                                                                                                            | ingen   |
| "Se ett exempel på en rapport"                                                | länk                                          | Till `/exempel`.                                                                                                                                                                                             | ingen   |
| Exempelrutan "2 rok på Södermalm" (flik "Exempel")                            | statisk bild av en rapport, påhittade siffror | Fyra klickbara rader: "Föreningen" ("2 flaggor"), "Priset", "Månadskostnad", "Har du råd?" (alla "Klar"), plus rutan "Din gräns i budgivningen" (5 250 000 kr). Raderna är länkar till ankare på samma sida. | ingen   |
| Raden "Köpguiden: nästa steg är budgivningen" ("4 av 12")                     | länk (vanlig sidladdning)                     | Till `/kopguide`.                                                                                                                                                                                            | ingen   |
| "Granska föreningen" (kort "Är föreningen frisk?")                            | länk                                          | Till `/analysera`.                                                                                                                                                                                           | ingen   |
| "Kolla priset" (kort "Är priset rimligt?")                                    | länk                                          | Till `/analysera`.                                                                                                                                                                                           | ingen   |
| "Räkna på månadskostnaden" (kort "Har jag råd med just den här?")             | länk (vanlig sidladdning)                     | Till `/bolanekalkyl`.                                                                                                                                                                                        | ingen   |
| "Öppna köpguiden" (kort "Och resten av köpet? Köpguiden tar dig hela vägen.") | knapp-länk                                    | Till `/kopguide`.                                                                                                                                                                                            | ingen   |

Övrigt innehåll utan handling: märket "Oberoende beslutsstöd", rubriken "Säljaren har en mäklare. Nu har du Binfo.", texten "Tolv steg från lånelöfte till tillträde, med vad du ska se upp med och vad du gör härnäst." (stämmer: köpguiden har 12 steg), sektionen "Tre frågor du behöver svar på innan du budar." och "Vi tjänar ingenting på att du köper.".

> **Känt fel:** De fyra raderna i exempelrutan ("Föreningen", "Priset", "Månadskostnad", "Har du råd?") länkar till de tre ankarna `#foreningen`, `#priset` och `#kostnaden`, men inga element med de id:na finns på sidan (verifierat i koden och i den publicerade sidan). Klicken leder ingenstans.

---

### S2 Analysera en bostad `/analysera`

Rubrikblock: märket "Gratis priskoll · valfri BRF-analys", rubriken "Analysera en bostad" och ingress. Ingressen är "Börja med en gratis priskoll. Vill du granska föreningen också laddar du upp årsredovisningen i steg 2 — uppgifterna du redan fyllt i följer med." I registerläget (se nedan) står i stället "…Föreningens årsredovisning har vi redan, så för BRF-analysen i steg 2 behöver du bara lägga till adressen…".

Sidan har fyra lägen styrda av adressen: vanligt läge, `?forening=<slug>` (registerläget), `?sparad=<id>` (sparad värdering) och `?spara=vardering` (slutföra ett väntande Spara efter inloggning). Förifyllning går också via adressparametrar (`utgangspris`, `boarea`, `antalRum`, `manadsavgift`, `postnummer`, `vaning`, `byggar`).

#### 2a. Booli-länk (kort överst)

Notis: Booli blockerar hämtningen från Binfos server i produktion, så knappen slutar i praktiken i felet "Vi kunde inte hämta uppgifterna, fyll i manuellt." Funktionen finns ändå i gränssnittet.

| Element                                                                               | Typ      | Vad den gör                                                                                                                                                                                                                                                                    | Anropar         |
| ------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| "Klistra in länk från Booli" (valfritt; platshållare `https://www.booli.se/annons/…`) | textfält | Tar en annonslänk. Hjälptext före hämtning: "Vi fyller i uppgifterna från annonsen. Kontrollera dem innan du går vidare." Efter hämtning: "Uppgifterna är ifyllda nedan. Kontrollera dem innan du går vidare." Att skriva tar bort ett tidigare fel. Enter skickar formuläret. | ingen           |
| "Hämta uppgifter"                                                                     | knapp    | Kontrollerar länken i webbläsaren och hämtar annonsen. Visar "Hämtar…" och är nedtonad under hämtningen. Fyller bara i formuläret; startar aldrig en värdering eller analys.                                                                                                   | `hamtaAnnonsFn` |

Felmeddelanden under fältet:

- Tomt fält: "Klistra in en länk från Booli först."
- Fel webbplats: "Endast Booli-länkar stöds just nu."
- Fel adressform: "Länken går inte till en bostadsannons på Booli. Kopiera adressen från annonsens sida, t.ex. https://www.booli.se/annons/1234567."
- Avstängd: "Hämtning från Booli är tillfälligt avstängd, fyll i manuellt."
- För många hämtningar: "Du har hämtat många annonser på kort tid. Vänta en stund eller fyll i manuellt."
- Ingen behörighet: "Du har inte tillgång till den här funktionen just nu."
- Allt annat (blockerad, hittades inte, kunde inte tolkas, nätverksfel): "Vi kunde inte hämta uppgifterna, fyll i manuellt."

Efter en lyckad hämtning märks varje ifyllt fält med en liten text: "Hämtat från Booli"; "Uppslaget från adressen (© OpenStreetMap-bidragsgivare)" för ett postnummer som slagits upp via adressen; "Tolkat från annonsens text – kontrollera" om en AI-reservväg tolkat texten (bara om den reservvägen är påslagen, vilket den inte är som standard); "Ändrat manuellt" när du ändrat det. Fält som annonsen saknade och som är tomma får texten "Fanns inte i annonsen, fyll i själv" och en orange ram. Hiss och balkong får bara bli "Ja" från Booli; saknas de står "Framgår inte av annonsen". Om annonsen nämner föreningen visas i steg 2: "Booli anger föreningen: <namn>. Kontrollera att årsredovisningen gäller den." En andra hämtning ersätter tidigare Booli-värden men behåller det du själv skrivit.

#### 2b. Steg 1: Priskoll (gratis, utan uppladdning)

Text: "Gratis och direkt, ingen uppladdning. Utgångspriset är valfritt — fyller du i det jämförs det med värderingen."

| Element                                                        | Typ               | Vad den gör                                                                                                                                                                                                                             | Anropar                   |
| -------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| "Boarea" (enhet "m²", platshållare "58")                       | textfält          | Siffror med mellanslag eller komma går bra. Kräver tal över 0: annars "Ange en giltig boarea." Värdet delas även med bolånekalkylen i samma besök.                                                                                      | ingen                     |
| "Antal rum" (platshållare "3")                                 | textfält          | Tal över 0, annars "Ange antal rum."                                                                                                                                                                                                    | ingen                     |
| "Månadsavgift" (enhet "kr/mån", platshållare "3 240")          | textfält          | Tal över 0, annars "Ange en giltig månadsavgift."                                                                                                                                                                                       | ingen                     |
| "Postnummer" (platshållare "116 25")                           | textfält          | Fem siffror med eller utan mellanslag. Tomt: "Ange postnummer."; fel format: "Ange ett postnummer med fem siffror, t.ex. 116 25." Under fältet visas efter 0,25 sekunder en områdestext (se nedan).                                     | `hamtaPostnummerInfoFn`   |
| "Vet du inte postnumret? Sök hos PostNord"                     | länk (ny flik)    | Öppnar PostNords sökning.                                                                                                                                                                                                               | ingen                     |
| "Våning" (platshållare "4")                                    | textfält          | Heltal från 0 (0 = bottenvåning). Tomt eller ogiltigt: "Ange våning."                                                                                                                                                                   | ingen                     |
| "Byggår" (valfritt, platshållare "1931")                       | textfält          | Ogiltig text tolkas tyst som "inget angivet".                                                                                                                                                                                           | ingen                     |
| "Utgångspris" (valfritt, enhet "kr", platshållare "4 950 000") | textfält          | Tomt är OK. Text som inte är ett tal över 0: "Ange ett giltigt utgångspris eller lämna fältet tomt."                                                                                                                                    | ingen                     |
| "Hiss" (valfritt)                                              | val ja/nej/vet ej | "Ja" / "Nej" / "Vet ej" (förvalt "Vet ej"). Delas med resten av webbplatsen under besöket.                                                                                                                                              | ingen                     |
| "Balkong" (valfritt)                                           | val ja/nej/vet ej | Som Hiss.                                                                                                                                                                                                                               | ingen                     |
| "Se värderingen"                                               | knapp (stor)      | Validerar steg 1; körs värderingen. Visar "Värderar…" och är nedtonad under körning. Vid fel visas raden "Fyll i de obligatoriska fälten." intill knappen (annars "Ingen uppladdning behövs."); felen visas först efter första klicket. | `hamtaPrisuppskattningFn` |

Områdestexten under postnumret (kommer från värderingens tabeller):

- "Område: <område>, Stockholm."
- "Stockholm, men området är okänt. Värderingen jämför med hela Stockholm."
- "Kommun: <kommun>. Utanför Stockholms kommun blir värderingen grövre."
- "Kommun: <kommun>, utanför Stockholms län. Värderingen blir ungefärlig."
- Okänt men med trolig kommun: "Vi känner inte igen just det här postnumret. Närliggande nummer ligger i <kommun>, och värderingen utgår från det. Kontrollera att postnumret stämmer."
- Okänt utan grannar: "Vi känner inte igen postnumret, så värderingen blir ungefärlig. Kontrollera att det stämmer." (enda varianten med orange ram).

Resultat av "Se värderingen":

- Serverfel med eget budskap: ruta "Det gick inte att göra värderingen" + serverns text ordagrant, t.ex. "Postnumret måste bestå av fem siffror, t.ex. 118 57.", "Några av uppgifterna saknas eller är ogiltiga. Kontrollera boarea, antal rum, månadsavgift och utgångspris och försök igen.", "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen.", "Du har inte tillgång till den här funktionen just nu."
- Oväntat fel: samma rubrik + "Något gick fel. Försök igen om en stund."
- Lyckat: prisavsnittet (samma som i analysrapporten, se K1 "Är priset rimligt?" / "Binfos värdering"), därefter kortet nedan.

| Element                                                                                                              | Typ                         | Vad den gör                                                                                   | Anropar            |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| Kortet "Spara värderingen" ("Spara den i ditt konto för att hitta tillbaka till den och kunna räkna om den senare.") | kort                        | Visas efter ett lyckat resultat; döljs när en väntande sparning just slutförts.               | ingen              |
| "Namn" (valfritt, platshållare "Till exempel adressen"; högst 120 tecken)                                            | textfält                    | Valfritt namn på den sparade värderingen.                                                     | ingen              |
| "Spara värderingen"                                                                                                  | knapp (Spara-flödet, se K2) | Inloggad: sparar direkt. Utloggad: skickar till inloggning och sparar när du kommer tillbaka. | `sparaVarderingFn` |
| Texten "Vill du granska föreningen också? Fortsätt med steg 2 nedan — uppgifterna du fyllt i följer med."            | text                        | Visas under resultatet.                                                                       | –                  |

Meddelanden överst vid återkomst efter inloggning (`?spara=vardering`):

- "Logga in för att spara" – "Du behöver vara inloggad för att slutföra sparandet." med länk "Logga in" (till `/konto/logga-in`).
- "Utkastet finns inte kvar" – "Uppgifterna du fyllde i före inloggningen hittades inte (de sparas högst ett dygn, och bara i den här webbläsaren). Fyll i dem igen och tryck på Spara."
- "Sparar din värdering…"
- "Din värdering är sparad i ditt konto." med länk "Se den i Mitt konto".
- "Värderingen kunde inte sparas: <orsak>".
- Om uppgifterna i utkastet inte längre är kompletta: "Uppgifterna du fyllde i är inte kompletta längre."
  Vid lyckad återställning körs priskollen automatiskt.

#### 2c. Steg 2: Granska föreningen (valfritt)

Text: "Ladda upp föreningens senaste årsredovisning så får du de sju nyckeltalen, räntestresstest och frågor att ställa till styrelsen." (I registerläget: "Du får de sju nyckeltalen, räntestresstest och frågor att ställa till styrelsen.")

| Element                                                                                 | Typ             | Vad den gör                                                                                                                                                                                                                                                                                   | Anropar                                                                         |
| --------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| "Dra och släpp årsredovisningen här, eller klicka för att välja fil" ("PDF, max 25 MB") | uppladdningsyta | Klick, tangent Enter/mellanslag eller släpp av fil. Kontrollerar direkt att filen är PDF och högst 25 MB.                                                                                                                                                                                     | ingen                                                                           |
| "Ta bort" (bredvid det valda filnamnet och storleken, t.ex. "rapport.pdf (3,2 MB)")     | textknapp       | Tar bort vald fil.                                                                                                                                                                                                                                                                            | ingen                                                                           |
| "Adress" (platshållare "Kapellgränd 12")                                                | textfält        | Obligatoriskt. Tomt: "Ange adress." Kortet har rubriken "Adress till objektet" och texten "Resten av uppgifterna (boarea, våning, avgift med mera) tar vi från steg 1." Det finns inget ortfält.                                                                                              | ingen                                                                           |
| "Analysera"                                                                             | knapp (stor)    | Validerar steg 1, adress och fil; skickar sedan. Visar "Skickar in…" och är nedtonad; är också avstängd medan registerläget laddas. Vid lyckat svar går sidan till `/forhandsvisning/<id>`. Vid fel visas "Fyll i de obligatoriska fälten, även i steg 1." intill knappen och alla fel visas. | `skapaAnalysFn` (uppladdning) eller `skapaAnalysFranRegisterFn` (registerläget) |

Texter intill knappen: "Analysen tar några minuter — du följer den på nästa sida."; i registerläget "Föreningens analys finns redan — du får din rapport direkt."; under sändning "Laddar upp och startar analysen…" respektive "Skapar din analys…".

Filfel (visas direkt när du väljer fil, och vid sändning): "Välj en fil att ladda upp.", "Filen måste vara en PDF.", "Filen är för stor. Max 25 MB."

Fel vid sändning visas i en röd ruta med rubrik, serverns text och en åtgärdsrad. Rubrikerna kommer av felkoden (se S3). Oväntat nätverksfel: rubriken "Kunde inte skicka in analysen" och texten "Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och försök igen." Exempel på serverns egna meddelanden: "Uppgifterna om bostaden kunde inte tolkas. Kontrollera formuläret och försök igen.", "Filen verkar inte vara en PDF.", "Filen är för stor (max 25 MB).", "Du har nått dagens gräns för antal analyser. Försök igen i morgon.", "Dagens gräns för antal analyser från ditt nätverk är nådd. Försök igen i morgon.", "Den skannade årsredovisningen har fler sidor än vi kan läsa av just nu. Ladda gärna upp en digital version (med textlager) av årsredovisningen.", "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss."

Registerläget `?forening=<slug>` (kommer från knappen "Analysera en lägenhet i föreningen" på föreningssidan):

- Medan föreningen hämtas: kort "Hämtar föreningen från registret…".
- Hittad: kortet "Föreningens årsredovisning finns redan hos Binfo" med "<föreningsnamn> · räkenskapsår <år> · analyserad <datum>", "Du behöver bara fylla i lägenhetens uppgifter i steg 1 samt adressen nedan." och länken "Ladda upp en annan årsredovisning i stället" (tar bort registerläget men behåller det du fyllt i). Uppladdningsytan visas inte; ingen PDF behövs.
- Hittades inte / kunde inte hämtas: orange ruta "Vi hittade inte föreningen i registret" respektive "Vi kunde inte hämta föreningen just nu" med texten "Ladda upp föreningens årsredovisning nedan i stället." och den vanliga uppladdningsytan.

Sparad värdering `?sparad=<id>` (visas i stället för stegen; rubrik "Priskoll", märke "Sparad värdering"):

| Element                      | Typ   | Vad den gör                                                                                                                                                                                                                        | Anropar                   |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| "Räkna om med dagens modell" | knapp | Kör värderingen på nytt med de sparade uppgifterna och visar resultatet under rubriken "Omräknat med dagens modell". Visar "Räknar om…". Fel visas i en röd ruta ("Något gick fel. Försök igen om en stund." eller serverns text). | `hamtaPrisuppskattningFn` |
| "Gör en ny värdering"        | länk  | Till `/analysera`.                                                                                                                                                                                                                 | ingen                     |
| "Till Mitt konto"            | länk  | Till `/konto`.                                                                                                                                                                                                                     | ingen                     |

Tillstånd: "Hämtar den sparade värderingen…"; utloggad omdirigeras direkt till inloggning; "Värderingen hittades inte."; "Något gick fel. Försök igen om en stund."; om formatet inte längre stöds rutan "Kan inte visas som den sparades". Sidan visar den sparade bilden med texten "Så här såg värderingen ut när du sparade den (modell <version>). Modellen uppdateras över tid; räkna om för att se vad dagens modell säger." och datummärket "Sparad <datum>". Hämtas via `hamtaSparadVarderingFn`.

> **Känt fel:** Felmeddelandet "kontakta oss" (t.ex. "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss.") hänvisar till en kontaktadress som inte finns (`KONTAKT_EPOST` är tom).

---

### S3 Analys pågår / rapport `/forhandsvisning/$analysisId`

Sidan hämtar status (`hamtaStatusFn`) och uppdaterar sig själv var 5:e sekund tills analysen är klar eller har misslyckats. När den är klar visas hela rapporten på samma sida (se K1) under rubriken "Din analys" (märke "Klar"). Sidan är inte indexerad av sökmotorer. Ingen knapp för att avbryta analysen finns.

| Tillstånd                                             | Vad som visas                                                                                                                                                                                                                                                                                                                                                                   | Handling                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Pågår (märke "Analyserar", rubrik "Din analys pågår") | Stegtext, förloppsstapel och texten "Det här tar normalt **3–5 minuter**" (för skannad årsredovisning: ", för en skannad årsredovisning **några minuter extra**") följd av ". Vi går igenom hela årsredovisningen, granskar nyckeltalen och tar fram potentiella varningsflaggor. Du kan gärna låta fliken vara öppen, sidan uppdateras automatiskt så snart analysen är klar." | Ingen – sidan uppdateras själv.                  |
| Steg som visas                                        | "Identifierar föreningen…", "Läser av de skannade sidorna…" (bara skannad), "Läser årsredovisningen…", "Hämtar de sju nyckeltalen…", "Analyserar föreningens ekonomi…", "Sammanställer rapporten…"                                                                                                                                                                              | –                                                |
| Notis "Skannad årsredovisning"                        | "Skannad årsredovisning upptäckt – analysen tar lite längre tid."                                                                                                                                                                                                                                                                                                               | –                                                |
| Notis "Analyseras redan"                              | "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt."                                                                                                                                                                                                                                                                                                     | –                                                |
| Klar, ny körning                                      | Rapporten (K1).                                                                                                                                                                                                                                                                                                                                                                 | –                                                |
| Klar, redan analyserad                                | Ruta "Redan analyserad": "Den här årsredovisningen var redan analyserad – din analys är klar direkt." ovanför rapporten.                                                                                                                                                                                                                                                        | –                                                |
| Hämtar rapporten                                      | Rubrik "Hämtar analysen…" (märke "Ett ögonblick").                                                                                                                                                                                                                                                                                                                              | –                                                |
| Hittades inte                                         | Märke "Hittades inte", rubrik "Vi hittar ingen analys med det här id:t", texten "Länken kan vara felstavad, eller så finns analysen inte längre. Ladda upp årsredovisningen på nytt för att starta en ny analys."                                                                                                                                                               | Knapp "Starta en ny analys" (till `/analysera`). |
| Misslyckad (märke "Analysen kunde inte slutföras")    | Rubrik efter felkod, serverns text, förklaring och en åtgärdsrad (se nedan).                                                                                                                                                                                                                                                                                                    | Knapp "Till formuläret" (till `/analysera`).     |

Felrubriker per felkod (rubrik – åtgärd):

- `scanned_pdf`: "Årsredovisningen går inte att läsa maskinellt" – be mäklaren eller styrelsen om den digitala originalfilen.
- `cost_cap`: "Tillfälligt tekniskt stopp" – "Försök igen om en stund. Kvarstår det, hör av dig till oss."
- `daily_cap`: "Dagens gräns är nådd" – "Försök igen imorgon."
- `validation`: "Uppgifterna kunde inte tolkas" – "Gå tillbaka till formuläret, kontrollera uppgifterna och skicka in igen."
- `saknar_rantekanslighet`: "Räntekänslighet saknas i årsredovisningen" (gäller bara gamla misslyckade körningar).
- `versionskonflikt`: "Analysen kunde inte slutföras" – "Gå tillbaka till formuläret och ladda upp årsredovisningen igen om en stund…"
- `kvot`: "Gränsen är nådd för tillfället" – "Vänta och försök igen senare. Kvarstår det, hör av dig till oss."
- `behorighet`: "Ingen tillgång just nu" – "Hör av dig till oss om du tror att det är fel."
- övrigt: "Något gick fel" – "Försök igen. Kvarstår felet, hör av dig till oss så tittar vi på det."

Sparrutan (se K2) visas i rapporten när den är klar; sidan använder `?spara=analys` för att slutföra ett väntande Spara efter inloggning.

> **Känt fel:** Väntetexten lovar "3–5 minuter", men uppmätt tid är ca 1–3 minuter.

> **Känt fel:** Felrubriken för `scanned_pdf` säger att skannade rapporter inte kan läsas ("omkring var åttonde årsredovisning … saknar textlager"), trots att skannade rapporter numera analyseras. Koden för felet kan fortfarande visas.

> **Känt fel:** Flera felåtgärder säger "hör av dig till oss" utan att någon kontaktadress finns.

---

### S4 Rapport (bokmärkeslänk) `/analys/$analysisId`

Samma rapport som S3 (se K1) under rubriken "Din analys" (märke "Klar"), utan väntskärmar. Sidan är inte indexerad. Om analysen inte är klar, inte finns eller inte kan läsas skickas besökaren automatiskt till `/forhandsvisning/<id>`, som visar väntan, fel eller "Hittades inte". Läses via `hamtaResultatFn`. Alla med länken kan öppna rapporten (länken är ett hemligt id; ingen ägarkontroll vid läsning). Sparrutan (K2) och `?spara=analys` fungerar som på S3. Ingen särskild "återanvänd"-notis visas här.

| Element             | Typ | Vad den gör | Anropar                                |
| ------------------- | --- | ----------- | -------------------------------------- |
| Hela rapporten (K1) | –   | Se K1.      | `hamtaResultatFn`, `hamtaSparstatusFn` |

---

### S5 Exempelrapport `/exempel`

| Element                                                                                                                                                                                                                                | Typ            | Vad den gör                                                                                                                                                   | Anropar                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Ruta överst: "Det här är en exempelrapport — en riktig analys av en riktig årsredovisning (Brf Pontonjären 3), men en tidigare körning, inte en ny analys av just den bostad du är intresserad av. Vill du analysera din egen bostad?" | text           | Informationsruta.                                                                                                                                             | –                          |
| "Ladda upp en årsredovisning"                                                                                                                                                                                                          | länk (i rutan) | Till `/analysera`.                                                                                                                                            | ingen                      |
| Hela rapporten (K1) över ett fast exempel                                                                                                                                                                                              | –              | Samma som K1 men utan sparrutan (ingen "Spara analysen"). Knapparna "Ladda ner som PDF" och "Räkna på månadskostnaden" fungerar. Ingen serverfunktion behövs. | ingen – bara i webbläsaren |

Rubrik: märke "Exempelrapport", "Så här ser en analys ut".

---

### S6 Bolånekalkyl `/bolanekalkyl`

Rubrik: märke "Bolånekalkyl", "Vad kostar bostaden per månad?", ingress "Räkna ut din totala månadskostnad direkt i webbläsaren". Alla beräkningar sker i webbläsaren; inget skickas till servern förrän du själv trycker på spara som inloggad. Inmatning: fälten är textfält som tar mellanslag som tusentalsavgränsare och komma som decimaltecken; ett tomt fält betyder "inget svar" (aldrig 0). Fel: "Värdet kan inte vara negativt.", "Skriv ett tal, till exempel 3 960 000 eller 3,6.", "Ange ett helt tal." (för heltalsfält) och "Värdet måste vara mellan X och Y <enhet>."

Adressparametrar som förifyller sidan (kommer bl.a. från rapportens knapp "Räkna på månadskostnaden"): `manadsavgift`, `rantekanslighet`, `pris` (delas upp i minsta kontantinsats 10 % och lån på resten), `boarea`, `prisUppskattning`, samt `sparad` (öppna sparad kalkyl) och `spara` (slutföra väntande Spara).

#### 6a. Indata (vänster kolumn)

| Element                                                               | Typ               | Vad den gör                                                                                                                                                                                                                                                                                                     | Anropar |
| --------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| "Lånebelopp" (kr; 0–100 000 000; platshållare "t.ex. <exempelvärde>") | textfält          | Lånets storlek. Förifylld från rapport: "Förifyllt utifrån priset i din analys, med minsta kontantinsats (10 %) — ändra om beloppet inte stämmer." (om priset är en Binfo-uppskattning: "…utifrån en uppskattning av priset i din analys, …").                                                                  | ingen   |
| "Kontantinsats" (kr; 0–100 000 000)                                   | textfält          | Hjälptext "Bolånetaket är 90 % — minst 10 % kontantinsats krävs." Visar också fel om insatsen är för låg.                                                                                                                                                                                                       | ingen   |
| "Ränta" (%; 0–30)                                                     | textfält          | Din ränta.                                                                                                                                                                                                                                                                                                      | ingen   |
| "Månadsavgift" (kr; 0–100 000; platshållare "t.ex. 3 240")            | textfält          | Hjälptext "Från föreningens senaste årsredovisning eller objektsbeskrivning." (förifylld: "Förifylld från din analys — ändra om avgiften har uppdaterats.").                                                                                                                                                    | ingen   |
| "Vad ingår i avgiften?"                                               | utfällbar sektion | Text om att värme och vatten normalt ingår (förvalt "Ingår"); "Ingår ej" ger en uppskattning; "Vet ej" ger totalen som ett spann. Innehåller en rad per post: "Värme", "Vatten", "El", "Bredband", "TV", var och en med val "Ingår" / "Ingår ej" / "Vet ej". Förval: värme och vatten "Ingår", övriga "Vet ej". | ingen   |
| "Boarea" (m²; 1–1 000; platshållare "t.ex. 58")                       | textfält          | Hjälptext "Styr schablonerna för el, värme och hemförsäkring. Utan boarea kan vi inte räkna ut totalen."                                                                                                                                                                                                        | ingen   |
| "Antal personer i hushållet" (1–20, heltal)                           | textfält          | Hjälptext "Styr schablonen för vattenkostnad." Tomt = vuxna + barn.                                                                                                                                                                                                                                             | ingen   |
| "Antal låntagare"                                                     | flik/val          | "1 låntagare" / "2 låntagare" (förvalt 2). Text: "Ränteavdragets tak på 100 000 kr gäller per person och år."                                                                                                                                                                                                   | ingen   |
| "Låntagare 1: bruttoinkomst per år" (kr/år; 0–100 000 000)            | textfält          | Hjälptext "Lön före skatt per år, inklusive fasta tillägg."                                                                                                                                                                                                                                                     | ingen   |
| "Låntagare 2: bruttoinkomst per år" (samma)                           | textfält          | Visas bara vid 2 låntagare.                                                                                                                                                                                                                                                                                     | ingen   |
| "Hushållets nettoinkomst"                                             | beräknad ruta     | Visar "<belopp>/mån" eller "—". Text: "Uträknad efter skatt i Stockholm 2026, utan ränteavdrag."                                                                                                                                                                                                                | ingen   |
| "Räntestress" (0–3 procentenheter, steg 0,1; visar "+x,x p.e.")       | reglage           | Höjer din ränta (och föreningens avgift om räntekänsligheten är känd). Texterna "Höjer din ränta (x,xx %)" och, utan räntekänslighet, "Vi vet inte hur känslig den här föreningens avgift är för räntehöjningar — det kräver en uppladdad årsredovisning för att räkna med i totalen."                          | ingen   |

> **Känt fel:** Hjälptexten under "Boarea" säger att fältet styr "el, värme och hemförsäkring" och under "Antal personer i hushållet" att det styr "vattenkostnad". Det är fel väg: el och hemförsäkring styrs av antal personer, värme och vatten av boarea (verifierat i `schabloner.ts`; samma text finns i den publicerade sidan).

#### 6b. Resultat (höger kolumn)

Allt uppdateras direkt medan du skriver. Rader som saknar underlag visar "—".

- **Lånekostnad:** "Räntekostnad", "Amortering", "Ränteavdrag" (med "− " och notisen "förutsätter skatt").
- **Boendekostnad:** "Månadsavgift" (notis "från din analys" om förifylld); schablonrader för poster som du markerat "Ingår ej" (el, värme, vatten, bredband, hemförsäkring). Hjälptexter: "Schablonerna nedan räknar med boarean från din analys (X m²)." och "Fyll i boarea till vänster för att räkna ut schablonerna."
  - Varje schablonrad är en knapp med beloppet och märket "schablon" (streckad kant) eller "ditt värde"; klick gör beloppet till ett litet fält (enhet "kr"). Enter eller att lämna fältet sparar; om det inte går att tolka behålls det gamla. Text "okänt om det ingår i avgiften" visas när du valt "Vet ej".
- **Total månadskostnad:** stort belopp, eller ett spann "X – Y kr/mån" när "Vet ej" ger flera möjliga summor ("Beroende på vad som ingår i avgiften."); undertext "i snitt över året, efter ränteavdrag" eller "Fyll i uppgifterna till vänster."; "Brutto: …"; ränteavdragsnotis.
- **"Det här betalar ni varje månad"**, **"Andel av nettoinkomsten"** (%), **"Kvar att leva på per månad"** (röd om negativ; "Efter boendekostnaderna ovan, före mat och övriga levnadskostnader.").
- **"Tillbaka i deklarationen"** (kr/år och per månad) med text om utbetalning som skatteåterbäring "vanligtvis mellan april och juni" och möjlighet till jämkning hos Skatteverket. En ruta "…av ränteavdraget kan inte utnyttjas eftersom skatten inte räcker till." visas vid behov (för två låntagare även ett tips om vem som betalar räntan).
- **Kortet "Amorteringskravet"** ("Enligt reglerna som gäller från 1 april 2026."): "Belåningsgrad", "Skuldkvot (lån / bruttoinkomst)", "Tillämpad amorteringstakt". Märken: "Över 70 % → 2 %", "Över 50 % till 70 % → 1 %", "Högst 50 % → inget krav"; och, med inkomst, "Över bankernas vanliga interna tak — kan påverka din kreditprövning." Förklarande text om att skuldkvoten inte styr lagkravet, samt "Bostadens värde beräknas som lånebelopp + kontantinsats (X kr)."

#### 6c. Åtgärder under resultatet

| Element                                                                               | Typ                      | Vad den gör                                                                                                                                                                                                                                                                                                                         | Anropar                      |
| ------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| "Ladda ner PDF" (visar "Skapar PDF…" under körning)                                   | knapp                    | Laddar ner kalkylen som PDF. Avstängd tills lånebelopp och ränta är ifyllda: då står "Fyll i lånebelopp och ränta för att kunna ladda ner kalkylen." Annars visas "Excel-filen har levande formler: ändra värdena på bladet Indata så räknas allt om." Fel: "Det gick inte att skapa filen just nu. Försök igen om en liten stund." | ingen – skapas i webbläsaren |
| "Ladda ner Excel" (visar "Skapar Excel…")                                             | knapp                    | Laddar ner kalkylen som Excel-fil. Samma villkor som PDF.                                                                                                                                                                                                                                                                           | ingen – skapas i webbläsaren |
| "Namn på kalkylen" (valfritt, platshållare "Till exempel adressen"; högst 120 tecken) | textfält                 | Namn på den sparade kalkylen och på exporten.                                                                                                                                                                                                                                                                                       | ingen                        |
| "Spara kalkylen" / "Spara ändringarna"                                                | knapp (Spara-flödet, K2) | Visas efter att sidan laddats. "Spara ändringarna" uppdaterar en redan öppnad eller nysparad kalkyl. Utloggad: skickas till inloggning och kalkylen sparas när du kommer tillbaka (`?spara=kalkyl`).                                                                                                                                | `sparaKalkylFn`              |
| "Spara som ny kalkyl"                                                                 | knapp                    | Visas bara när en sparad kalkyl är öppen; skapar en ny rad i stället för att uppdatera. Sparat-läget nollställs när du ändrar något.                                                                                                                                                                                                | `sparaKalkylFn`              |

#### 6d. Fördjupning (hopfälld sektion)

"Fördjupning: räntescenarier och bankens kalkyl (valfritt)" – utfällbar sektion (`details`). Den öppnas automatiskt om någon KALP-uppgift (barn, antal vuxna eller kalkylränta) avviker från förvalet. Text: "Det här behövs inte för att förstå månadskostnaden ovan. Här kan du se vad som händer om räntan ändras och hur banken brukar räkna på om ni klarar lånet."

| Element                                                                                                             | Typ                              | Vad den gör                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Anropar |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Kortet "Om räntan ändras"                                                                                           | kort                             | Rader med scenarier (namn och ränta), total månadskostnad efter ränteavdrag eller spann, och detaljen "Ränta X · avgift Y (+Z) · kvar efter boendet W". Text om att avgiften räknas upp med räntekänslighet, annars "Bara din egen ränta stressas: avgiftens känslighet är okänd." Utan ränta: "Fyll i ränta ovan för att se scenarierna."                                                                                                                                                                                              | ingen   |
| "Antal vuxna i hushållet" (1–10, heltal)                                                                            | textfält                         | Hjälptext "Lämna tomt för samma antal som låntagare."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ingen   |
| "Barn 0–3 år", "Barn 4–6 år", "Barn 7–10 år", "Barn 11–14 år", "Barn 15–17 år" (enhet "st"; 0–10; platshållare "0") | textfält (5 st)                  | Antal barn per åldersgrupp för bankens kalkyl.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ingen   |
| "Kalkylränta" (%; 0–30)                                                                                             | textfält                         | Hjälptext "Ett antagande, inte en regel: varje bank sätter sin egen kalkylränta. Förvalt är 7 %."                                                                                                                                                                                                                                                                                                                                                                                                                                       | ingen   |
| Kortet "Kvar att leva på enligt bankens kalkyl"                                                                     | kort                             | Nettoinkomst minus ränta vid kalkylräntan, amortering, avgift, värme och Konsumentverkets levnadskostnader. Visar rader (bl.a. "Hushållets nettoinkomst" och "Levnadskostnader (Konsumentverket 2026)"), "Överskott per månad" eller "Underskott per månad" (röd), och en lista med förutsättningar. Utan underlag: "Fyll i <saknade fält> för att räkna ut bankens kalkyl."; för hushåll över 7 personer: "Konsumentverkets tabell gäller hushåll upp till 7 personer, så vi kan inte räkna ut bankens kalkyl för ett större hushåll." | ingen   |
| "Så räknas levnadskostnaderna"                                                                                      | utfällbar sektion (inuti kortet) | Visar raderna för levnadskostnaderna.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ingen   |
| Kortet "Regler och antaganden"                                                                                      | kort med lista                   | Alla regler och siffror som kalkylen räknar med: namn, värde, status (märke), källa (ofta en länk), "gäller från X, kontrollerad Y" eller "ej kontrollerad", ev. anmärkning. Konsumentverkets tabellvärden listas inte här utan länkas: "Hushållskostnader 2026".                                                                                                                                                                                                                                                                       | ingen   |

#### 6e. Öppnad sparad kalkyl och väntande Spara

- `?sparad=<id>` (kräver inloggning; utloggad skickas till inloggning och tillbaka). Under hämtning: "Hämtar den sparade kalkylen…". Ruta "Öppnad från ditt konto" (text: "Öppnad från ditt konto: <namn eller datum>. Spara uppdaterar den här kalkylen; du kan också spara den som en ny."). Om formatet inte stöds eller kalkylen saknas: ruta "Kalkylen kan inte öppnas" med t.ex. "Kalkylen hittades inte. Den kan ha raderats." / "Kalkylen kunde inte hämtas." + "Du kan fortfarande räkna på en ny kalkyl här." och länk "Till Mitt konto". Hämtas via `hamtaSparadKalkylFn`.
- `?spara=kalkyl` efter inloggning: samma fem meddelanden som för värderingen, anpassade ("Logga in för att spara", "Utkastet finns inte kvar", "Sparar din kalkyl…", "Din kalkyl är sparad i ditt konto.", "Kalkylen kunde inte sparas: <orsak>").

---

### S7 Köpguide `/kopguide`

Rubrik: märke "Köpguide", "Hela bostadsköpet, steg för steg", ingress "Klicka på ett steg för att se varningar och tips. Bocka av det du är klar med." Allt sker i webbläsaren; avbockningar och öppet steg sparas inte och nollställs vid omladdning.

| Element                                                                                                                                                 | Typ                | Vad den gör                                                                                                                     | Anropar |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Märket "X av 12 steg klara" och förloppsstapel                                                                                                          | räknare            | Uppdateras när du kryssar klart.                                                                                                | ingen   |
| Stegrubriken (titel + sammanfattning, `Steg N`) för varje steg                                                                                          | knapp (fäll ut/in) | Fäller ut beskrivning, rutan "Viktiga flaggor" och rutan "Tips". Bara ett steg är öppet åt gången; steg 1 är öppet från början. | ingen   |
| "Markera klar" / "Klar" (per steg)                                                                                                                      | kryssa klar        | Bockar av steget; den runda markeringen på tidslinjen fylls.                                                                    | ingen   |
| Länkar i tips: "Räkna på din månadskostnad här" (steg 1 och steg "Ansök om bolån…") och "Analysera föreningen här" (steg "Granska föreningens ekonomi") | länk               | Till `/bolanekalkyl` respektive `/analysera`.                                                                                   | ingen   |

Tre grupper: "Före budgivningen", "Affären", "Fram till och efter tillträdet". Steg (bostadsrätt, 12 st): "Förberedelse & lånelöfte", "Sök & bevaka objekt", "Visning", "Granska föreningens ekonomi", "Budgivning", "Vinnande bud & överenskommelse", "Kontrakt/Överlåtelseavtal", "Handpenning", "Ansök om bolån & bind eller ha rörlig ränta", "Medlemskap i föreningen", "Tillträde & slutbetalning", "Efter tillträde". Steget "Lagfart & pantbrev" gäller bara hus och visas aldrig.

> **Känt fel:** Texten i steget "Medlemskap i föreningen" är avhuggen och saknar mellanslag: "…enligt stadgarna och bostadsrättslagen,vanligtvis inom några veckor. U".

---

### S8 BRF-registret `/brf`

Rubrik: märke "BRF-register", "Bostadsrättsföreningar i Stockholm", ingress "Nyckeltal och betyg för föreningar vars årsredovisning har analyserats av Binfo." Sidan är offentlig och sätter inga cookies.

| Element                                                                                       | Typ                | Vad den gör                                                                                                                           | Anropar                                    |
| --------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| "Sök förening" (platshållare "Namn eller organisationsnummer")                                | sök                | Sökord ligger i adressen (`?sok=`).                                                                                                   | `hamtaRegisterOmradeFn` (vid sökning)      |
| "Sök"                                                                                         | knapp              | Kör sökningen över alla områden.                                                                                                      | `hamtaRegisterOmradeFn`                    |
| "Rensa"                                                                                       | textknapp          | Visas när en sökning är aktiv; tömmer sökningen.                                                                                      | ingen                                      |
| Sökresultat                                                                                   | tabell/kort        | Se "Föreningslista" nedan. Inga träffar: "Inga föreningar matchar "<sökord>". Prova ett kortare namn eller bara organisationsnumret." | –                                          |
| Områdeskort (under rubrikerna "Innerstaden", "Söderort", "Västerort", ev. "Övriga Stockholm") | länk (hela kortet) | Visar områdesnamn, "N föreningar" eller "Inga föreningar ännu" och "Senast uppdaterad <datum>"; till `/brf/omrade/<område>`.          | `hamtaRegisterOmradenFn` (vid sidladdning) |

"Övriga Stockholm" har hjälptexten "Föreningar i Stockholms kommun vars adress inte går att placera i ett av områdena ovan." Om kvoten är slut för sökningen visas den vanliga felsidan.

Fotnot: "<N> förening(ar) i registret. Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad."

**Föreningslista** (delas av S8 och S9):

| Element                                                                                                       | Typ                          | Vad den gör                                                       | Anropar                 |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- | ----------------------- |
| Föreningens namn                                                                                              | länk                         | Till `/brf/<slug>`.                                               | ingen                   |
| Kolumnrubrikerna "Betyg", "Skuld per m² bostadsrättsyta", "Årsavgift per m²", "Sparande per m²", "Analyserad" | sortering (knappar; pil ↑/↓) | Sorterar tabellen; nytt klick vänder ordningen. Går till sida 1.  | `hamtaRegisterOmradeFn` |
| "Sortera efter" (rullista med alla fem) + "Stigande ↑" / "Fallande ↓"                                         | sortering (mobil)            | Samma sak på smala skärmar, där raderna visas som kort.           | `hamtaRegisterOmradeFn` |
| "Föregående" / "Nästa" och texten "Sida X av Y · N föreningar"                                                | sidbläddring                 | Visas när det finns mer än en sida; annars står "N förening(ar)". | `hamtaRegisterOmradeFn` |
| Betygsmärke "Betyg A…E" eller "–"                                                                             | märke                        | Neutral ton – ingen färg som tolkar bra/dåligt.                   | –                       |

---

### S9 Område i registret `/brf/omrade/$omrade`

Brödsmula "BRF-register › <område>" (länk "BRF-register"). Rubrik "Bostadsrättsföreningar i <område>", ingress "Föreningar i området som har analyserats av Binfo. Siffrorna kommer från respektive årsredovisning; klicka på en förening för sidhänvisningar och bedömning."

| Element                                        | Typ          | Vad den gör                                                                                                                                                                         | Anropar                 |
| ---------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| "BRF-register" (brödsmula)                     | länk         | Till `/brf`.                                                                                                                                                                        | ingen                   |
| "Sök i <område>"                               | sök          | Söker bara i området.                                                                                                                                                               | `hamtaRegisterOmradeFn` |
| "Sök", "Rensa"                                 | knappar      | Som S8.                                                                                                                                                                             | `hamtaRegisterOmradeFn` |
| Föreningslista (länk, sortering, sidbläddring) | –            | Som S8 (utan kolumnen "Område").                                                                                                                                                    | `hamtaRegisterOmradeFn` |
| Tomt läge                                      | text + knapp | "Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här." och knappen "Analysera en bostad" (till `/analysera`). Vid sökning utan träff: texten som på S8. | –                       |

Fotnot: "Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad." Okänt område: sidan "Området finns inte i registret" med länken "Till BRF-registret".

---

### S10 Föreningssida `/brf/$slug`

Offentlig sammanfattning. Visar bara föreningens uppgifter, aldrig något om köpare.

| Element                                                                                                                                                                                                                  | Typ                   | Vad den gör                                                                                                                                                                      | Anropar                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Brödsmula "BRF-register" › område › föreningsnamn                                                                                                                                                                        | länkar                | Till `/brf` och till `/brf/omrade/<område>`.                                                                                                                                     | ingen                                   |
| Faktakort: "Organisationsnummer", "Område", "Räkenskapsår", "Analyserad" och, om finns, "Adress enligt årsredovisningen: …"                                                                                              | text                  | Information.                                                                                                                                                                     | `hamtaRegisterForeningFn` (sidladdning) |
| Ruta "Skannad årsredovisning"                                                                                                                                                                                            | informationsruta      | Visas om rapporten byggde på en skanning: "Årsredovisningen var skannad; siffrorna är avlästa från sidbilderna och kan innehålla fel – kontrollera de viktigaste mot rapporten." | –                                       |
| Text om äldre version                                                                                                                                                                                                    | text                  | Visas om analysen gjorts med en äldre version av Binfo.                                                                                                                          | –                                       |
| Betygskort                                                                                                                                                                                                               | kort                  | Bokstavsbetyg och en generell förklaring av hur betyg sätts (ingen individuell motivering).                                                                                      | –                                       |
| "Nyckeltal" (hjälptext "De sju nyckeltalen enligt årsredovisningen. De som årsredovisningen saknar visas inte.")                                                                                                         | lista                 | De sju nyckeltalen som finns, med status (utom "Okänt"), värde och sidhänvisning ("s. N"). Saknade nyckeltal visas inte.                                                         | –                                       |
| "Se hela analysen för varför föreningen fick betyget <betyg>"                                                                                                                                                            | knapp-länk (sekundär) | Till `/brf/<slug>/analys/<år>`.                                                                                                                                                  | ingen                                   |
| "Nyckeltal per år" (hjälptext "Samma nyckeltal ur föreningens analyserade årsredovisningar, nyaste först"; tabell: År, Betyg, Skuld per m² bostadsrättsyta, Årsavgift per m², Sparande per m² totalyta, Räntekänslighet) | tabell                | Visas när fler år finns. Årtalet är en länk till det årets fullständiga analys.                                                                                                  | –                                       |
| Kortet "Köper du i den här föreningen?" med knappen "Analysera en lägenhet i föreningen"                                                                                                                                 | knapp-länk            | Till `/analysera?forening=<slug>` (registerläget, S2).                                                                                                                           | ingen                                   |
| Fotnot "Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel. Hittar du ett fel? Kontakta oss."                                                                                             | text                  | Ingen länk – kontaktadress saknas.                                                                                                                                               | –                                       |
| Fotnot "Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad. Analysen är beslutsstöd, inte finansiell rådgivning."                                                                                   | text                  | Källhänvisning och friskrivning.                                                                                                                                                 | –                                       |

Saknas föreningen: sidan "Föreningen finns inte i registret" med länken "Sök i BRF-registret". Ett gammalt namn omdirigeras permanent till det nya.

> **Känt fel:** "Hittar du ett fel? Kontakta oss." har ingen länk eller adress att kontakta (`KONTAKT_EPOST` är tom).

---

### S11 Föreningens fullständiga analys `/brf/$slug/analys/$ar`

Den sparade fullständiga BRF-analysen för ett räkenskapsår, exakt som den lagrades (ingen omkörning vid visning). Ej indexerad. Läses via `hamtaRegisterAnalysFn`.

Sidhuvud: märke "Hela analysen", rubrik = föreningens namn, ingress "Den sparade analysen av årsredovisningen för räkenskapsåret <år>, gjord <datum>. Varje siffra visar vilken sida i årsredovisningen den kommer från." Sist på sidan: "Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel. Analysen är beslutsstöd, inte finansiell rådgivning."

| Element                                                                                                                                                                                                 | Typ         | Vad den gör                                                                           | Anropar |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- | ------- |
| Brödsmula "BRF-register › område › förening › Analys <år>"                                                                                                                                              | länkar      | Navigering uppåt.                                                                     | ingen   |
| Ruta "Skannad årsredovisning", text om äldre version                                                                                                                                                    | information | Som S10.                                                                              | –       |
| Delar av rapporten (K1, begränsad variant): betygskort med riktig motivering, röda flaggor (högst två), "Föreningens ekonomi", "Övrig info från årsredovisningen", "Frågor att ställa" (med kryssrutor) | –           | Inget om pris, räntestress eller sammanfattning; ingen PDF-knapp och ingen spara-rad. | –       |
| "Tillbaka till <föreningsnamn>"                                                                                                                                                                         | länk        | Till föreningssidan.                                                                  | ingen   |
| Kortet "Köper du i den här föreningen?" + "Analysera en lägenhet i föreningen"                                                                                                                          | knapp-länk  | Till `/analysera?forening=<slug>`.                                                    | ingen   |

Om åtkomsten nekas (kan styras av konto eller betalning senare): sidan "Analysen är inte tillgänglig just nu" med serverns text och länken "Tillbaka till föreningens sammanfattning". Okänt år/slug: sidan "Analysen finns inte i registret" med länkarna "Till föreningens sida" och "Sök i BRF-registret". Ogiltigt år i adressen ger 404.

---

### S12 Mitt konto `/konto`

Kräver inloggning; utloggad skickas till `/konto/logga-in?till=/konto`. Medan sessionen laddas: "Laddar…". Ingress "Inloggad som <e-postadress>." Listan hämtas via `listaSparatFn`: "Hämtar dina sparade uppgifter…" under hämtning; vid fel en röd ruta med serverns text eller "Något gick fel. Försök igen om en stund." och knappen "Försök igen". Fel vid en borttagning visas i en röd ruta överst.

**Kortet "Analyser"**

| Element                                                                                                                                                                                 | Typ            | Vad den gör                                                                                                                                                                                                                                                          | Anropar                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Rad per analys: datum, föreningsnamn (eller "Förening ej identifierad"), märken "Pågår" / "Klar" / "Misslyckades", "Betyg X", detaljer (adress · "Räkenskapsår N" · "Utgångspris X kr") | lista          | Information.                                                                                                                                                                                                                                                         | –                         |
| "Öppna"                                                                                                                                                                                 | länk           | Klara analyser till `/analys/<id>`, övriga till `/forhandsvisning/<id>`.                                                                                                                                                                                             | ingen                     |
| "Ta bort från listan"                                                                                                                                                                   | knapp → dialog | Dialog "Ta bort analysen från din lista?" med texten att analysen försvinner från listan, att adress och pris raderas, att föreningens rapport finns kvar i registret och att länken slutar fungera. Knappar "Avbryt" och "Ta bort från listan" (visar "Tar bort…"). | `taBortAnalysFranListaFn` |
| Tomt läge                                                                                                                                                                               | text + knapp   | "Du har inga analyser än. Ladda upp en årsredovisning så hamnar analysen här." + knappen "Analysera en bostad" (till `/analysera`).                                                                                                                                  | –                         |

**Kortet "Värderingar"**

| Element                                                                                                                                                                         | Typ            | Vad den gör                                                                                                                                            | Anropar                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Rad per värdering: datum, namn (eller "Postnummer X" / "Värdering"), märket "Kan inte öppnas" om formatet inte stöds, detaljer ("Värdering X kr" · "N m²" · "Utgångspris X kr") | lista          | Information.                                                                                                                                           | –                         |
| "Öppna"                                                                                                                                                                         | länk           | Till `/analysera?sparad=<id>` (S2). Visas inte om formatet inte stöds.                                                                                 | ingen                     |
| "Radera"                                                                                                                                                                        | knapp → dialog | Dialog "Radera värderingen?" – "Den sparade värderingen raderas permanent. Det går inte att ångra." Knappar "Avbryt" och "Radera" (visar "Tar bort…"). | `raderaSparadVarderingFn` |
| Tomt läge                                                                                                                                                                       | text + knapp   | "Du har inga sparade värderingar. Gör en priskoll och tryck på Spara." + "Gör en priskoll".                                                            | –                         |

**Kortet "Bolånekalkyler"**

| Element                                                                                                                                                                               | Typ                       | Vad den gör                                                                                                                                                                                                                                                                                   | Anropar                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Rad per kalkyl: datum (senast ändrad), namn (eller "Bolånekalkyl"), detaljer ("X kr i månaden efter ränteavdrag" eller spann "X–Y kr…", "Belåningsgrad X %", "Amortering X % per år") | lista                     | Information.                                                                                                                                                                                                                                                                                  | –                      |
| "Öppna"                                                                                                                                                                               | länk (vanlig sidladdning) | Till `/bolanekalkyl?sparad=<id>`.                                                                                                                                                                                                                                                             | ingen                  |
| "PDF" och "Excel" (visar "Skapar PDF…" / "Skapar Excel…")                                                                                                                             | knappar                   | Hämtar kalkylen och laddar ner den som PDF respektive Excel. Fel: "Det gick inte att skapa filen just nu. Försök igen om en liten stund."; om formatet inte stöds: "Den här kalkylen sparades i ett format som inte längre stöds, så den kan inte laddas ner. Du kan fortfarande radera den." | `hamtaSparadKalkylFn`  |
| "Radera"                                                                                                                                                                              | knapp → dialog            | Dialog "Radera kalkylen?" – "Den sparade kalkylen raderas permanent. Det går inte att ångra."                                                                                                                                                                                                 | `raderaSparadKalkylFn` |
| Tomt läge                                                                                                                                                                             | text + knapp              | "Du har inga sparade bolånekalkyler. Räkna på ditt bolån och tryck på Spara." + "Öppna bolånekalkylen".                                                                                                                                                                                       | –                      |

**Kortet "Konto"**

| Element                                                                                                                                                                                                                           | Typ            | Vad den gör                                                                                                                                                                                                                                                                   | Anropar                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| "Byt lösenord"                                                                                                                                                                                                                    | länk           | Till `/konto/nytt-losenord?nuvarande=ja` (kräver nuvarande lösenord).                                                                                                                                                                                                         | ingen                  |
| "Ladda ner mina uppgifter" (visar "Hämtar…")                                                                                                                                                                                      | knapp          | Laddar ner en JSON-fil med dina uppgifter (`binfo-mina-uppgifter-<datum>.json`).                                                                                                                                                                                              | `hamtaMinaUppgifterFn` |
| "Logga ut"                                                                                                                                                                                                                        | knapp          | Loggar ut och går till startsidan.                                                                                                                                                                                                                                            | `loggaUtFn`            |
| "Radera mitt konto" (under rubriken "Radera konto": "Raderar kontot och allt som är sparat i det: dina värderingar, bolånekalkyler och analyslistan. Föreningsrapporterna finns kvar i Binfos register. Det går inte att ångra.") | knapp → dialog | Dialog "Radera kontot?" med texten "Ange ditt lösenord för att bekräfta. Kontot och allt sparat i det raderas.", fältet "Lösenord" (felet visas i fältet) och knapparna "Avbryt" / "Radera kontot" (visar "Tar bort…"). Vid lyckat svar loggas du ut och går till startsidan. | `raderaKontoFn`        |

> **Känt fel:** Alla raderingsdialoger visar "Tar bort…" på bekräftaknappen medan den arbetar, även de som heter "Radera" och "Radera kontot".

> **Känt fel:** Om du anger fel lösenord i dialogen "Radera kontot" visas "Fel e-postadress eller lösenord." (samma text som vid inloggning), fast ingen e-postadress anges.

---

### S13 Logga in `/konto/logga-in`

Ej indexerad. Ingress: "Logga in för att se dina sparade analyser, värderingar och kalkyler." Med väntande Spara: "Logga in för att spara. Dina uppgifter finns kvar när du kommer tillbaka." Är du redan inloggad går sidan vidare automatiskt.

| Element                                         | Typ                              | Vad den gör                                                                                                                                                                                                                                                                                                                                                              | Anropar     |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| "E-postadress" (platshållare "namn@exempel.se") | textfält (e-post)                | Din e-post.                                                                                                                                                                                                                                                                                                                                                              | ingen       |
| "Lösenord"                                      | textfält (lösenord)              | Ditt lösenord.                                                                                                                                                                                                                                                                                                                                                           | ingen       |
| "Logga in" (visar "Loggar in…")                 | knapp (skicka, stor, full bredd) | Loggar in och går till sidan du kom från (`?till=`; bara egna sidor tillåts) och slutför ev. väntande Spara (`?spara=`). Fel visas i en röd ruta: t.ex. "Fel e-postadress eller lösenord.", "E-postadressen är inte bekräftad ännu. Klicka på länken i bekräftelsemejlet först.", "För många försök, vänta en stund.", annars "Något gick fel. Försök igen om en stund." | `loggaInFn` |
| "Glömt lösenordet?"                             | länk                             | Till `/konto/glomt-losenord`.                                                                                                                                                                                                                                                                                                                                            | ingen       |
| "Skapa konto" (efter "Har du inget konto?")     | länk                             | Till `/konto/skapa` och för med `till` och `spara`.                                                                                                                                                                                                                                                                                                                      | ingen       |

---

### S14 Skapa konto `/konto/skapa`

Ej indexerad. Ingress: "Med ett konto kan du spara värderingar och bolånekalkyler och hitta tillbaka till dina analyser."

| Element                                                                   | Typ      | Vad den gör                                                                                                                                                                                                                                                                                                                                                                                                                                             | Anropar             |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| "E-postadress" (platshållare "namn@exempel.se")                           | textfält | Din e-post.                                                                                                                                                                                                                                                                                                                                                                                                                                             | ingen               |
| "Lösenord" (hjälptext "Minst 10 tecken.")                                 | textfält | Kontrolleras i webbläsaren: "Lösenordet måste vara minst 10 tecken." Servern kan även svara att lösenordet är för kort, för långt (över 72 byte) eller för vanligt.                                                                                                                                                                                                                                                                                     | ingen               |
| "Skapa konto" (visar "Skapar konto…")                                     | knapp    | Skapar kontot. Lyckat: sidan "Kolla din e-post" med texten "Om adressen <e-post> går att använda har vi skickat ett mejl med en länk för att bekräfta kontot. Det brukar komma inom någon minut. Titta även i skräpposten." och "Du kan öppna länken i en ny flik. Den här sidan går vidare när kontot är bekräftat." Sidan kontrollerar sessionen när fliken får fokus. Fel: "Ange en giltig e-postadress.", "För många försök, vänta en stund." m.fl. | `registreraKontoFn` |
| "integritetspolicyn"                                                      | länk     | Till `/integritet`.                                                                                                                                                                                                                                                                                                                                                                                                                                     | ingen               |
| "Logga in" (efter "Har du redan ett konto?" och efter "Redan bekräftat?") | länk     | Till `/konto/logga-in` (för med `till` och `spara`).                                                                                                                                                                                                                                                                                                                                                                                                    | ingen               |

---

### S15 Glömt lösenord `/konto/glomt-losenord`

Ej indexerad. Ingress: "Ange e-postadressen till ditt konto så skickar vi en länk för att välja ett nytt lösenord."

| Element                                         | Typ      | Vad den gör                                                                                                                                                                                                                                                                                    | Anropar                |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| "E-postadress" (platshållare "namn@exempel.se") | textfält | Din e-post.                                                                                                                                                                                                                                                                                    | ingen                  |
| "Skicka återställningslänk" (visar "Skickar…")  | knapp    | Skickar ett mejl med en länk om adressen finns. Visar alltid samma besked: "Om adressen finns skickar vi ett mejl med en länk för att välja nytt lösenord. Länken gäller en begränsad tid. Titta även i skräpposten." Fel: "Ange en giltig e-postadress.", "För många försök, vänta en stund." | `begarAterstallningFn` |
| "Tillbaka till inloggning"                      | länk     | Till `/konto/logga-in`.                                                                                                                                                                                                                                                                        | ingen                  |

---

### S16 Bekräfta e-post / länk från mejl `/konto/bekrafta`

Ej indexerad. Nås från länken i bekräftelse- eller återställningsmejlet (`?token_hash=…&type=signup|recovery|email_change`). Länken används först när du trycker på knappen (så att mejlskannrar inte förbrukar engångslänken).

| Element                                                                          | Typ   | Vad den gör                                                                                                                                                                                                             | Anropar           |
| -------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| "Bekräfta e-postadressen" (för återställning: "Fortsätt"; visar "Kontrollerar…") | knapp | Verifierar länken och loggar in dig. Rubrik "Bekräfta din e-postadress" (återställning: "Välj nytt lösenord"). Vid lyckad återställning går sidan direkt till `/konto/nytt-losenord`.                                   | `bekraftaEpostFn` |
| "Fortsätt" / "Fortsätt och spara"                                                | knapp | Visas på sidan "Kontot är bekräftat" ("Din e-postadress är bekräftad och du är inloggad."); går till sidan du kom från och slutför ev. väntande Spara.                                                                  | ingen             |
| "Begär en ny länk" (återställning) / "Till inloggningen"                         | länk  | Efter fel: "Länken är ogiltig eller har gått ut. Länkar i mejl fungerar bara en gång och en begränsad tid." eller "Något gick fel. Försök igen om en stund." Till `/konto/glomt-losenord` respektive `/konto/logga-in`. | ingen             |
| Sidan "Länken fungerar inte"                                                     | läge  | Visas om länken saknar uppgifter: "Länken är ofullständig. Öppna den direkt från mejlet eller begär en ny." med länken "Till inloggningen".                                                                             | ingen             |

---

### S17 Välj nytt lösenord `/konto/nytt-losenord`

Ej indexerad. Kräver en session (återställningslänken eller vanlig inloggning); utloggad skickas till inloggning. Rubrik "Välj nytt lösenord", ingress "Lösenordet ska vara minst 10 tecken."

| Element                                        | Typ                 | Vad den gör                                                                                                                                                                                   | Anropar              |
| ---------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| "Nuvarande lösenord"                           | textfält (lösenord) | Visas när du kommer från "Byt lösenord" (`?nuvarande=ja`) eller när servern ber om det ("Ange ditt nuvarande lösenord för att byta till ett nytt."). Behövs inte efter en återställningslänk. | ingen                |
| "Nytt lösenord" (hjälptext "Minst 10 tecken.") | textfält (lösenord) | Kontrolleras: "Lösenordet måste vara minst 10 tecken."                                                                                                                                        | ingen                |
| "Spara nytt lösenord" (visar "Sparar…")        | knapp               | Byter lösenord. Lyckat: sidan "Lösenordet är ändrat" ("Ditt nya lösenord gäller från och med nu.") med länken "Till Mitt konto". Fel visas i röd ruta.                                        | `sattNyttLosenordFn` |

> **Känt fel:** Anger du fel nuvarande lösenord visas "Fel e-postadress eller lösenord." (samma text som vid inloggning).

---

### S18 Integritet `/integritet`

Ren textsida: märke "Integritet", rubrik "Så hanterar vi dina uppgifter", "Senast ändrad 14 oktober 2026". Avsnitt (kort var): "Vem ansvarar", "Utan konto", "Med konto", "Årsredovisningar och BRF-registret", "I din webbläsare", "Leverantörer som behandlar uppgifter åt oss", "Dina rättigheter". Personuppgiftsansvarig anges som "Binfo (binfo.slanesens.com)".

| Element                              | Typ  | Vad den gör        | Anropar |
| ------------------------------------ | ---- | ------------------ | ------- |
| "Analysera" (i texten om priskollen) | länk | Till `/analysera`. | ingen   |
| "BRF-registret"                      | länk | Till `/brf`.       | ingen   |
| "Mitt konto"                         | länk | Till `/konto`.     | ingen   |

> **Känt fel:** Frågor och rättigheter hänvisas med "kontakta oss", men ingen kontaktadress finns (`KONTAKT_EPOST` är tom; sidan visar ren text, ingen länk).

> **Känt fel:** Avsnittet "I din webbläsare" beskriver en lista över dina senaste analyser, men rutan "Dina senaste analyser" är dold i gränssnittet – webbläsaren sparar listan ändå.

---

### S19 Omdirigeringar och systemsidor

- `/vardering` går permanent (301) till `/analysera` och behåller `sparad` och `spara`.
- `/guide` går permanent (301) till `/kopguide`.
- 404-sida och felsida (svenska) finns; `/sitemap.xml` är en serversida för sökmotorer. Inga handlingar.

---

### K1 Analysrapporten (delad komponent; visas på S3, S4, S5 och i en variant på S11)

Sektioner i visningsordning. Flest villkor styrs av vilka uppgifter analysen har.

**1. Objektsammanfattning** – Kort med föreningens namn, "<adress> · N rum" (har adressen raderats efter 12 månader: "Adressen raderad efter 12 månader") och märket "Analyserad <datum>". Fält: "Utgångspris" (utelämnas om inget angavs), "Boarea", "Månadsavgift" (`/mån`), "Våning" (eller "Okänt"), "Byggår". Vid Byggår kan ett litet märke och en rad stå. Ditt eget byggår används alltid.

- "Avviker" med raden "Årsredovisningen anger <år>" (eller "värdeår <år>"): visas när årsredovisningen anger ett annat år. En skillnad på ±1 år ger ingen märkning, bara raden. Äldre sparade analyser kan i stället visa "Årsredovisningen: <år> (du angav <år>)".
- "Okänt" + "Osäkert": visas när du inte angav något och årsredovisningens år är osäkert läst. Det året används då inte.
- "Från årsredovisningen" eller "Värdeår enligt årsredovisningen": visas när du inte angav något.

Märkningen kan ha en sidhänvisning.

**2. Betygskort** – Rund bokstav (A–E), "Sammanvägt riskbetyg" och motivering.

**3. Spara-rad (ej på S5)** – Liten rad under betyget: se K2.

**4. Röda flaggor** – Högst två kort, allvarligast först: märke "Hög risk" / "Medelrisk" / "Låg risk", rubrik, beskrivning. Sektionen försvinner helt om inga flaggor finns.

**5. "Föreningens ekonomi"** – Hjälptext "Viktiga nyckeltal att ha koll på från föreningens årsredovisning". Ett kort per nyckeltal: statusetikett ("God", "Acceptabel", "Svag", "Kritisk"), namn, värde, förklaring, jämförelsevärde, märken: "Schablon", "s. N" (sidhänvisning; hovra visar citatet), "Osäker" (hovra visar orsak), "Viktigast här" på räntekänslighet. Det sjunde nyckeltalet (årsavgifternas andel av rörelseintäkter) visas inte i rapporten; nyckeltal utan bedömning visas utan statusetikett.

**6. "Övrig info från årsredovisningen"** – Hjälptext "Fakta ur årsredovisningen som inte är ett nyckeltal, men som är bra att känna till." Hela sektionen försvinner om inget finns. Delar: antal ("Antal medlemmar", "Antal lägenheter", "Varav hyresrätter", "Antal lokaler"); "Vad ingår i avgiften" (rader "El", "Bredband", "Tv": "Ingår" / "Ingår ej" / "Framgår inte av årsredovisningen", ev. "Individuell mätning" / "Ingen individuell mätning"); "Väsentliga händelser" (eller "(ingen exakt sidhänvisning)"); ruta "Skannad årsredovisning" (se S10) vid skannad rapport; kortet "Om extraktionens tillförlitlighet" med punktlista – här visas även noterna "Analysen gjordes med en tidigare version av Binfo." (äldre version, rapporten visas som den lagrades) och "Det finns en nyare årsredovisning (<år>) analyserad för föreningen."

**7. Prisavsnittet** (rubrik "Är priset rimligt?" med hjälptext "Jämförelse mot Binfos värderingsmodell och pris per kvadratmeter."; utan utgångspris rubriken "Binfos värdering" och hjälptexten "Binfos uppskattning utifrån lägenhetens egna uppgifter." – samma avsnitt visas i Priskollen på S2 och i sparad värdering):

- Utanför Stockholms län: orange ruta ("Utanför täckningsområdet") med förbehåll.
- Rad "Utgångspris" med pris per m² (bara om utgångspris angivits).
- Rad "Vad jämförbara lägenheter säljs för" + märket "Estimat" med värde avrundat till 10 000 kr, pris per m², "Ungefärligt spann (±10 %)" och en färgad rad om utgångspriset ligger över eller under (t.ex. "Utgångspriset ligger X % över/under …" eller "…, inom spannet"). Saknas värdering: "Binfos värdering – Inte tillgänglig — postnumret saknas eller är ogiltigt".
- Rad "Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift" + "Estimat" (bara i fullständig analys med avgiftsprognos).
- Notis om byggår som värderingen räknat med (med sidhänvisning).
- Rad om lägenhetens andel av föreningens lån ("Ingår inte i värderingen.") eller att föreningen är skuldfri; med sidhänvisning och ev. "Osäker".
- "Område: <område>", ev. budpremie-text, slutsatsruta, "Låg tillförlitlighet: …".
- Utfällbar sektion **"Så har vi räknat"** (inuti prisavsnittet; visas när värderingsunderlag eller avgiftsprognos finns): (a) "Utgångsläget: Binfos värderingsmodell" med kort text och utfällbara "Visa mer" (förklaring + sju faktorer + datakälla); (b) stapeldiagrammet "Så påverkar föreningens ekonomi priset"; (c) "Väntad avgiftsutveckling enligt årsredovisningen" med stort belopp, färgprick och text ("Inget tryck på avgiften" / "Visst tryck på avgiften" / "Tydlig avgiftshöjning väntas") och märket "Uppskattning"; delen "Sparande till underhåll" med utfällbart "Visa byggdelarna"; delen "Lån som omsätts" med lånetabell (Förfaller, Belopp, Ränta, Period, Effekt) och utfällbart "Visa hela uträkningen"; övriga delar med "Visa mer om övriga delar"; "Så räknas avgiften om till pris"; en rad om att räntekänsligheten inte påverkar priset. Alla "Visa mer"-delar är inbyggda utfällbara sektioner (fungerar utan JavaScript).
- Detaljtexter i "Så har vi räknat" som designen måste rymma:
  - **Stapeldiagrammet:** förklaringen "Delbeloppen är fördelade efter komponenternas kr/mån." (när beloppen fördelats proportionellt).
  - **Avgiftsutvecklingens huvudbelopp:**
    - Formen är "+<N> kr/mån" med raden "inom <N> månader".
    - "Kan inte uppskattas" visas när underlag saknas.
    - "Ingen tydlig förändring" visas när förändringen är liten.
    - Varje delpost kan visa ett belopp, "Underlag saknas" eller "Ej aktuellt" (nedtonad).
  - **Sparande till underhåll:**
    - Två staplar, "Behov" och "Sparar".
    - Faktarutan "Glapp", som heter "Överskott" om föreningen sparar mer än behovet.
    - Tabellen under "Visa byggdelarna" har kolumnerna "Byggdel", "Senast", "Normalt" och "Status".
    - Statusvärdena är "Nyligen", "Ok", "Eftersatt" och "Okänt".
  - **Lån som omsätts:**
    - Underlagsraderna är "Lån som omsätts inom horisonten", "Nuvarande ränta" ("Uppgift saknas" om den är okänd) och "Antagen ny ränta".
    - "Antagen ny ränta" visas som "<ny %> = <referensränta> <%> (<datum>, ev. reservvärde) + föreningens marginal <%>".
    - Lånetabellens celler kan vara:
      - "Rörlig ränta", "Datum saknas" eller "under <år>"
      - "Ränta saknas" eller "<nu %> → <ny %>"
      - perioden "≤ <N> mån" eller "År 3–5 · väger <N> %"
      - för ett förfallet lån en hel rad i formen "Förföll <datum> – omsatt till villkor vi inte känner till".
- Prisraden heter "Extern värdering" i stället för Binfos etikett om värderingen inte är Binfos egen. Det ska inte inträffa i dag, men etiketten finns.

**7b. Räntereglaget** – Under reglaget står förklaringen "Reglaget lägger en ränteökning på föreningens hela skuld, via räntekänsligheten, ovanpå den förväntade avgiften." (fliken "Förväntad avgift").

**8. "Vad händer om räntan stiger?"** – Hjälptext "Dra i reglaget för att se hur just den här lägenhetens avgift påverkas." (utan räntekänslighet: "Räntekänslighet saknas i årsredovisningen, så avgiftsstressen kan inte beräknas." och reglaget är låst på +0).

- Flikar "Dagens avgift" / "Förväntad avgift" (visas bara när analysen har en förväntad avgift; förvalt "Dagens avgift").
- Reglaget "Räntehöjning" 0–3 procentenheter i steg om 1 (förvalt +1), visar "+N p.e.".
- Två rutor: till vänster dagens eller förväntad avgift, till höger "Stressad avgift" (eller "Inte möjligt att räkna då räntekänslighet saknas i rapporten."). Kommentartext under.

**9. "Frågor att ställa"** – Hjälptext "Ta med listan till visningen. Svaren avgör om riskbetyget bör justeras." Varje fråga är en kryssruta (kryssar du över den streckas texten; avbockningen sparas inte), med "Varför: …" och ev. "Bra svar: … Varningssignal: …".

**10. "Sammanfattning"** (bara om analysen har en) – Fyra stycken (betyg, pris, avgift – med färgmärke –, slutsats).

**11. Knappar längst ned (inte på S11)**

| Element                                   | Typ              | Vad den gör                                                                                                                                                    | Anropar                      |
| ----------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| "Ladda ner som PDF" (visar "Skapar PDF…") | knapp (sekundär) | Laddar ner rapporten som PDF. Fel: "Det gick inte att skapa PDF:en just nu. Försök igen om en liten stund."                                                    | ingen – skapas i webbläsaren |
| "Räkna på månadskostnaden"                | knapp            | Öppnar `/bolanekalkyl` förifylld med månadsavgift, räntekänslighet (om över 0), pris (värdet som visas), boarea och en markering om priset är en uppskattning. | ingen                        |

**12. "Spara analysen i din profil"** – kort i slutet (ej på S5); se K2.

Varianter: utan utgångspris (se 7), saknad räntekänslighet (se 8), skannad rapport (ruta "Skannad årsredovisning" och märken "Osäker"), äldre version (not i "Om extraktionens tillförlitlighet"), utanför Stockholm (orange ruta, grövre värdering), skuldfri förening, ingen avgiftsprognos (äldre resultat: inga flikar, ingen justerad värdering, ingen sammanfattning).

---

### K2 Spara-flödet (spara värdering / kalkyl / analys, utkast, inloggning)

Samma knapp och samma flöde för tre saker: "Spara värderingen" (S2), "Spara kalkylen" / "Spara ändringarna" / "Spara som ny kalkyl" (S6) och "Spara analysen" (S3, S4).

| Läge                                    | Vad som händer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Anropar                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Knappen (sekundär)                      | Nedtonad medan sessionen hämtas och medan sparning pågår ("Sparar…").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | –                                                    |
| Inloggad                                | Sparar direkt. Lyckat: ruta "Sparad i ditt konto." med länken "Se dina sparade uppgifter i Mitt konto". Fel: röd ruta med serverns text (t.ex. "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen.") eller "Något gick fel. Försök igen om en stund." Har sessionen gått ut mitt i behandlas det som utloggad.                                                                                                                                                                                                                                                               | `sparaVarderingFn`, `sparaKalkylFn`, `sparaAnalysFn` |
| Utloggad                                | Texten bredvid: "Du behöver ett konto för att spara. Dina uppgifter finns kvar när du har loggat in." (visas inte vid analyser). Knappen skriver först ett utkast av dina uppgifter i webbläsaren (giltigt 24 timmar, aldrig i adressen) och skickar till `/konto/logga-in?till=…&spara=<typ>`. För en analys sätter servern dessutom en markering först. Kan utkastet inte sparas: "Webbläsaren tillåter inte att vi tillfälligt sparar dina uppgifter. Logga in först och fyll sedan i uppgifterna igen." (analys: "Analysen kunde inte förberedas för att sparas. Ladda om sidan och försök igen.") | `forberedSparaAnalysFn` (bara analys)                |
| Återkomst efter inloggning (`?spara=…`) | Sidan läser utkastet, tar bort det, fyller i formuläret och sparar en gång. Meddelanden: "Logga in för att spara", "Utkastet finns inte kvar", "Sparar …", "… är sparad i ditt konto." / "Analysen är sparad i din profil." med länk, eller felet. Nytt konto som bekräftas via mejl: länken öppnas ofta i ny flik och leder tillbaka via utkastet ("Fortsätt och spara").                                                                                                                                                                                                                             | `sparaVarderingFn`, `sparaKalkylFn`, `sparaAnalysFn` |

**"Spara analysen" på rapportsidor (S3, S4):**

- Liten rad under betyget: knappen "Spara analysen" (när analysen kan sparas), "Sparar analysen…", "Analysen är sparad i din profil." + länk "Se den i Mitt konto", eller texten "Sparad i din profil. Mitt konto". Visas inget om någon annans analys.
- Kort i slutet: "Spara analysen i din profil" – "Logga in eller skapa ett konto, så hittar du tillbaka till analysen under Mitt konto. Du kommer tillbaka hit och analysen görs inte om." + knappen. Visas bara när analysen kan sparas och inte redan är sparad.
- Sparstatus hämtas via `hamtaSparstatusFn` (sparad / kan sparas / ingen). Ingen ny körning och inget betalt anrop sker vid sparning. Servern kan svara "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där."

---

## 3. Serverfunktioner och vad som utlöser dem

### Så hänger det ihop (kort)

En **serverfunktion** är ett anrop från webbläsaren till Binfos server. Webbläsaren pratar med Binfo bara på det sättet; den har ingen egen koppling till databasen. Varje knapp som "gör något" (se värderingen, analysera, logga in, spara) anropar en serverfunktion, och sidan måste kunna visa varje svar som funktionen kan ge, både lyckade och felaktiga.

Själva analysen av årsredovisningen körs **inte** medan användaren väntar. När någon klickar "Analysera" laddas filen upp och ett jobb skapas. Därefter går användaren till S3 (Analys pågår), som **frågar servern om status var 5:e sekund** tills jobbet är klart eller har misslyckats. Under tiden arbetar ett bakgrundsjobb steg för steg (se "Bakgrundsarbete" nedan).

Alla sidor som visar felmeddelanden visar serverns svenska text ordagrant. Tekniska fel visas aldrig; då får användaren en generell text.

**Texter som återkommer**

- Generell analystext (`GENERISKT_FEL_MEDDELANDE`): "Analysen kunde inte slutföras på grund av ett internt fel. Försök igen, och kontakta oss om felet kvarstår."
- Generell text på konto- och sparsidor: "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår." (från servern) respektive "Något gick fel. Försök igen om en stund." (när anropet själv kastar fel i webbläsaren).
- Nekad behörighet: "Du har inte tillgång till den här funktionen just nu." Alla behörigheter är i dag öppna för alla, så texten ska i praktiken inte synas.

**Användartyper:** utloggad besökare (anonym enhetscookie sätts vid första besöket), inloggad användare, ägare, vem som helst med länken. Adminarbete (lista/ogiltigförklara rapporter, GDPR-export och -radering, köra om analyser) sker via kommandoradsverktyg. Det finns **inget admin-UI**.

**Dagsgräns och paus (gäller analys-uppladdning och analys från register, inte läsningar):**

- Dagsgräns för API-kostnad. Text: "Dagens gräns för antal analyser är nådd. Det är tillfälligt — försök igen imorgon."
- Nödbroms ("paus"). Text: "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss." (visas under rubriken "Något gick fel").

---

### Analys

#### `skapaAnalysFn` — starta en analys med uppladdad årsredovisning

- **Vad den gör:** tar emot PDF:en och bostadens uppgifter, kontrollerar dem, och skapar ett analysjobb. Finns samma årsredovisning redan analyserad blir analysen klar direkt och gratis.
- **Utlöses av:** S2, steg 2, knappen "Analysera" (visar "Skickar in…" under tiden). Hjälptext bredvid: "Laddar upp och startar analysen…".
- **Kräver:** utloggad ok.
- **Begränsningar:**
  - Max 25 MB, måste vara PDF.
  - Skannade PDF:er över 60 sidor nekas.
  - Uppladdningskvot: 5 per enhet och 10 per nätverk (IP) och dygn. Den återlämnas om analysen inte kostade något (redan analyserad eller ansluten till en pågående).
  - Lös kvot: 30 per enhet och 100 per nätverk och dygn, återlämnas aldrig.
  - Dagsgräns och paus (ovan).
- **Svar UI:t måste hantera:**
  - Lyckat: går till S3. Svaret kan bära flaggorna "redan analyserad" och "väntar på pågående rapport" (visas där som notiser).
  - Fel (visas i rutan under knappen med rubrik, serverns text och åtgärd från tabellen "Felmeddelanden för analyser"):
    - `validation`: "Uppgifterna om bostaden kunde inte tolkas. Kontrollera formuläret och försök igen."
    - `validation`: "Filen verkar inte vara en PDF."
    - `validation`: "Filen är för stor (max 25 MB)."
    - `scanned_pdf`: "Den skannade årsredovisningen har fler sidor än vi kan läsa av just nu. Ladda gärna upp en digital version (med textlager) av årsredovisningen."
    - `daily_cap`: dagsgränstexten ovan.
    - `unknown`: pausetexten ovan, eller generella analystexten vid oväntat fel.
    - `kvot`: "Du har nått dagens gräns för antal analyser. Försök igen i morgon." / "Dagens gräns för antal analyser från ditt nätverk är nådd. Försök igen i morgon." / "Du har gjort många uppladdningar idag, även av rapporter som redan var analyserade. Försök igen i morgon." / "Många uppladdningar har gjorts från ditt nätverk idag, även av rapporter som redan var analyserade. Försök igen i morgon."
    - `behorighet`: nekad-texten ovan.
  - Kastat nätverks-/serverfel: formuläret visar en generell "okänd"-ruta.

#### `skapaAnalysFranRegisterFn` — analys av en lägenhet i en förening som redan finns i registret

- **Vad den gör:** skapar en analys utan ny PDF. Föreningens sparade analys återanvänds och bostadens uppgifter läggs till. Kostar normalt inget API-pengar. Är den sparade analysen från en äldre version och PDF:en finns kvar köas en ny körning.
- **Utlöses av:** S2 i registerläget (`?forening=<slug>`, nås via knappen "Analysera en lägenhet i föreningen" på S10 eller S11), knappen "Analysera". Hjälptext: "Föreningens analys finns redan — du får din rapport direkt." och "Skapar din analys…".
- **Kräver:** utloggad ok.
- **Begränsningar:** bara den lösa kvoten (30 per enhet, 100 per nätverk och dygn). Vid omkörning av äldre version gäller även den strikta kvoten och dagsgränsen. Paus gäller.
- **Svar UI:t måste hantera:**
  - Lyckat: går till S3.
  - Fel: samma ruta som ovan, med dessa tillägg:
    - `validation`: "Föreningen finns inte i registret, eller så har den ingen färdig analys ännu. Ladda upp årsredovisningen i stället."
    - `validation`: "Uppgifterna om bostaden kunde inte tolkas. Kontrollera formuläret och försök igen."
    - samt `kvot`, `daily_cap`, `unknown` (paus), `behorighet` som ovan.

> **Känt fel:** Texten "Föreningen finns inte i registret…" visas under felrubriken "Uppgifterna kunde inte tolkas" med åtgärden "Gå tillbaka till formuläret, kontrollera uppgifterna och skicka in igen." Rubriken och åtgärden passar inte: det är föreningen som saknas, inte formuläret som är fel.

#### `hamtaStatusFn` — fråga hur långt analysen har kommit

- **Vad den gör:** returnerar jobbets status, vilket steg det är i, om årsredovisningen är skannad, om den redan var analyserad och om den väntar på en rapport som någon annan startat. Gratis, ingen kvot.
- **Utlöses av:** automatiskt när S3 laddas, och därefter **var 5:e sekund** tills analysen är klar eller har misslyckats.
- **Kräver:** utloggad ok (vem som helst med länken).
- **Möjliga svar:**
  - Okänt id: sidan visar "Vi hittar ingen analys med det här id:t" ("Länken kan vara felstavad, eller så finns analysen inte längre. Ladda upp årsredovisningen på nytt för att starta en ny analys.", knapp "Starta en ny analys").
  - Pågår (köad eller körs): "Din analys pågår" med stegtext, förloppsstapel och notiser (se Bakgrundsarbete).
  - Misslyckad: skärmen "Analysen kunde inte slutföras" med rubrik, text och åtgärd per kod (se felmeddelandetabellen), knapp "Till formuläret".
  - Klar: rapporten visas. Om den redan var analyserad visas först notisen "Redan analyserad": "Den här årsredovisningen var redan analyserad – din analys är klar direkt."
  - Sparad rapport som inte längre går att läsa med nuvarande version: status "misslyckad" med koden `versionskonflikt` och texten "Analysen gjordes med en tidigare version av Binfo och behöver göras om. Ladda upp årsredovisningen igen."
  - Oväntat fel: sidan faller tillbaka på "hittades inte"-skärmen.

#### `hamtaResultatFn` — hämta den färdiga rapporten

- **Vad den gör:** sätter ihop hela analysrapporten (K1) varje gång den läses, med dagens referensränta. Kör aldrig om något och kostar inget.
- **Utlöses av:** S3 när analysen är klar (hämtas direkt i sidans laddning, eller efter statussvaret "klar"; under hämtningen visas "Hämtar analysen…"). S4 hämtar den i sidans laddning. Går något fel på S4 omdirigeras användaren automatiskt till S3, som visar rätt skärm.
- **Kräver:** utloggad ok (vem som helst med länken).
- **Möjliga svar:**
  - Lyckat: rapporten (K1). Är den gjord med äldre version eller finns en nyare årsredovisning läggs en rad i kortet "Om extraktionens tillförlitlighet": "Analysen gjordes med en tidigare version av Binfo." / "Det finns en nyare årsredovisning (ÅÅÅÅ) analyserad för föreningen."
  - Okänt id → "hittades inte"-skärmen.
  - Ej klar eller ej läsbar, eller nekad behörighet → S4 skickar vidare till S3; på S3 blir det "misslyckad"/"hittades inte" enligt statussvaret.
  - Annat fel på S3: skärmen "Något gick fel" (kod `unknown`).

---

### Priskoll och formulärhjälp

#### `hamtaPrisuppskattningFn` — Priskollen (värdering utan årsredovisning)

- **Vad den gör:** räknar fram Binfos värdering av lägenheten ur formulärets uppgifter. Ingen PDF, inget sparas, kostar inget.
- **Utlöses av:**
  - S2, steg 1, knappen "Se värderingen" (visar "Värderar…" under tiden).
  - S2 i läget sparad värdering (`?sparad=`), knappen "Räkna om med dagens modell" (visar "Räknar om…").
  - Efter inloggning när ett sparat utkast av en värdering återställs (`?spara=vardering`): värderingen räknas om automatiskt.
- **Kräver:** utloggad ok.
- **Begränsningar:** 60 värderingar per nätverk (IP) och timme. Även ogiltiga förfrågningar räknas.
- **Svar UI:t måste hantera:**
  - Lyckat: resultatet visas (Priskoll-delen, `Prisrimlighet`) och, om man är på S2, kortet "Spara värderingen".
  - Fel (röd ruta med rubriken "Det gick inte att göra värderingen" och serverns text):
    - "Postnumret måste bestå av fem siffror, t.ex. 118 57."
    - "Några av uppgifterna saknas eller är ogiltiga. Kontrollera boarea, antal rum, månadsavgift och utgångspris och försök igen."
    - "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen."
    - "Du har inte tillgång till den här funktionen just nu."
  - Kastat fel: "Något gick fel. Försök igen om en stund."

#### `hamtaPostnummerInfoFn` — områdesrad under postnummerfältet

- **Vad den gör:** slår upp vad värderingen vet om postnumret (område eller kommun). Ren uppslagning, ingen kvot, ingen cookie.
- **Utlöses av:** automatiskt 0,25 sekunder efter att postnumret i S2 har blivit fem siffror.
- **Kräver:** utloggad ok.
- **Möjliga svar (visas som hjälptext under fältet):**
  - "Område: X, Stockholm."
  - "Stockholm, men området är okänt. Värderingen jämför med hela Stockholm."
  - "Kommun: X. Utanför Stockholms kommun blir värderingen grövre."
  - "Kommun: X, utanför Stockholms län. Värderingen blir ungefärlig."
  - Okänt med grannar: "Vi känner inte igen just det här postnumret. Närliggande nummer ligger i X, och värderingen utgår från det. Kontrollera att postnumret stämmer."
  - Okänt utan grannar (fältet får varningsram): "Vi känner inte igen postnumret, så värderingen blir ungefärlig. Kontrollera att det stämmer."
  - Ogiltigt eller fel vid anrop: ingen text visas.
  - Länken "Vet du inte postnumret? Sök hos PostNord" är en vanlig länk och anropar ingen serverfunktion.

---

### Booli-hämtning

> **Notis (produktion):** Funktionen finns i UI:t, men Booli blockerar Binfos server i produktion (se `docs/booli.md`). I praktiken slutar den i "Vi kunde inte hämta uppgifterna, fyll i manuellt." Designen ska ändå hantera alla svar nedan.

#### `hamtaAnnonsFn` — "Hämta uppgifter" från en Booli-annons

- **Vad den gör:** läser en Booli-annons och fyller i formulärfält (boarea, rum, avgift, postnummer, våning, byggår, utgångspris, hiss, balkong, adress, ort). Startar aldrig en värdering eller analys. Hiss/balkong fylls bara i som "ja". Saknas postnummer slås det upp via OpenStreetMap. Svaret sparas i 24 timmar.
- **Utlöses av:** S2, fältet "Klistra in länk från Booli" och knappen "Hämta uppgifter" (visar "Hämtar…"; Enter i fältet fungerar också).
- **Kräver:** utloggad ok.
- **Begränsningar:** 20 hämtningar per enhet och 60 per nätverk och timme (ett svar ur 24-timmarscachen räknas inte). Kan stängas av av driften ("avstängd").
- **Svar UI:t måste hantera:**
  - Lyckat: fält fylls i med märkningen "Hämtat från Booli" (efter egen ändring "Ändrat manuellt"; ett uppslaget postnummer anges komma från OpenStreetMap). Fält som saknas i annonsen får "Fanns inte i annonsen, fyll i själv" och varningsram. Hjälptext vid fältet: "Uppgifterna är ifyllda nedan. Kontrollera dem innan du går vidare."
  - Fel (visas under länkfältet):
    - Tomt fält: "Klistra in en länk från Booli först."
    - Inte Booli: "Endast Booli-länkar stöds just nu."
    - Booli men inte en annons: "Länken går inte till en bostadsannons på Booli. Kopiera adressen från annonsens sida, t.ex. https://www.booli.se/annons/1234567."
    - Avstängd: "Hämtning från Booli är tillfälligt avstängd, fyll i manuellt."
    - Kvot: "Du har hämtat många annonser på kort tid. Vänta en stund eller fyll i manuellt."
    - Nekad behörighet: "Du har inte tillgång till den här funktionen just nu."
    - Alla andra fel (blockerad av Booli, annonsen hittas inte, sidan går inte att tolka, nätverksfel): "Vi kunde inte hämta uppgifterna, fyll i manuellt."

---

### Konto och inloggning

Alla kontofunktioner kräver att konton är påslagna. Annars visas "Konton är inte aktiverade just nu. Försök igen senare." Lösenordsregeln är minst 10 tecken (och högst 72 byte) och får inte vara ett lösenord som förekommit i ett dataintrång.

#### `hamtaSessionFn` — vem är inloggad?

- **Vad den gör:** talar om om besökaren är inloggad och vilken e-postadress.
- **Utlöses av:** automatiskt på nästan alla sidor (sidhuvudet G1 visar "Mitt konto" eller inloggningslänk; Spara-knappar, S12–S14 och S17 väntar på svaret, under tiden "Laddar…").
- **Kräver:** utloggad ok.
- **Svar:** inloggad (med e-post) eller utloggad.

#### `registreraKontoFn` — skapa konto

- **Vad den gör:** skapar kontot och skickar ett bekräftelsemejl. Svarar lika oavsett om adressen redan finns.
- **Utlöses av:** S14, knappen "Skapa konto" ("Skapar konto…").
- **Kräver:** utloggad.
- **Begränsningar:** 5 registreringar per nätverk och timme.
- **Svar:** lyckat → vyn "Kolla din e-post" ("Om adressen X går att använda har vi skickat ett mejl…"). Fel:
  - "Ange en giltig e-postadress."
  - "Lösenordet måste vara minst 10 tecken (och högst 72 byte). Det får inte heller vara ett lösenord som förekommit i ett dataintrång eller det du redan har."
  - "För många försök, vänta en stund."
  - "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår."

#### `loggaInFn` — logga in

- **Vad den gör:** loggar in med e-post och lösenord. Flyttar webbläsarens anonyma analyser till kontot.
- **Utlöses av:** S13, knappen "Logga in" ("Loggar in…"). Efter lyckad inloggning går användaren till sidan i `?till=` (och avslutar ev. väntande sparande).
- **Kräver:** utloggad.
- **Begränsningar:** 10 försök per nätverk och 5 per e-postadress per 15 minuter. Ett lyckat försök räknas inte.
- **Svar:** lyckat → vidare. Fel:
  - "Fel e-postadress eller lösenord."
  - "E-postadressen är inte bekräftad ännu. Klicka på länken i bekräftelsemejlet först."
  - "För många försök, vänta en stund."
  - "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår."

#### `bekraftaEpostFn` — bekräfta e-post / återställningslänk

- **Vad den gör:** verifierar länken i mejlet och loggar in. Händer bara när användaren trycker på knappen, så att mejlskannrar inte "förbrukar" länken.
- **Utlöses av:** S16, knappen "Bekräfta e-postadressen" ("Kontrollerar…"). Därefter "Fortsätt" eller "Fortsätt och spara". Vid återställningslänk går sidan direkt vidare till S17.
- **Kräver:** utloggad ok (länken är beviset).
- **Begränsningar:** Supabase Auths egna gränser.
- **Svar:** lyckat → "Kontot är bekräftat". Fel:
  - "Länken är ogiltig eller har gått ut. Länkar i mejl fungerar bara en gång och en begränsad tid."
  - "Du är redan inloggad med ett annat konto. Logga ut och be om en ny länk (via Glömt lösenord eller genom att registrera dig igen)."
  - "För många försök, vänta en stund."
  - "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår."
  - Ofullständig länk (saknar uppgifter): rubriken "Länken fungerar inte", "Länken är ofullständig. Öppna den direkt från mejlet eller begär en ny."

#### `begarAterstallningFn` — glömt lösenord

- **Vad den gör:** skickar ett mejl med återställningslänk. Svarar lika oavsett om adressen finns.
- **Utlöses av:** S15, knappen "Skicka återställningslänk" ("Skickar…").
- **Kräver:** utloggad ok.
- **Begränsningar:** 3 per e-postadress och 10 per nätverk och timme.
- **Svar:** lyckat → "Om adressen finns skickar vi ett mejl med en länk för att välja nytt lösenord. Länken gäller en begränsad tid. Titta även i skräpposten." Fel: "Ange en giltig e-postadress." och "För många försök, vänta en stund."

#### `sattNyttLosenordFn` — välj eller byt lösenord

- **Vad den gör:** sätter nytt lösenord. Kräver antingen en nyss använd återställningslänk eller det nuvarande lösenordet. Loggar ut alla andra sessioner.
- **Utlöses av:** S17, knappen "Spara nytt lösenord" ("Sparar…"). Nås från återställningslänken eller från "Byt lösenord" på S12 (då visas fältet "Nuvarande lösenord").
- **Kräver:** inloggning.
- **Begränsningar:** delar inloggningskvoten (5 per e-postadress, 10 per nätverk och 15 minuter).
- **Svar:** lyckat → "Lösenordet är ändrat" ("Ditt nya lösenord gäller från och med nu."). Fel:
  - "Du behöver logga in för att göra det här." (skickar till inloggning)
  - "Lösenordet måste vara minst 10 tecken (och högst 72 byte). Det får inte heller vara ett lösenord som förekommit i ett dataintrång eller det du redan har."
  - "Ange ditt nuvarande lösenord för att byta till ett nytt." (fältet "Nuvarande lösenord" visas)
  - "Fel e-postadress eller lösenord." (fel nuvarande lösenord)
  - "För många försök, vänta en stund."
  - Generell text.

> **Känt fel:** Vid fel _nuvarande_ lösenord på S17 visas "Fel e-postadress eller lösenord.", trots att ingen e-postadress anges där.

#### `loggaUtFn` — logga ut

- **Vad den gör:** avslutar sessionen, rensar väntande sparande och ger webbläsaren ett nytt enhets-id.
- **Utlöses av:** S12, knappen "Logga ut". Går därefter till S1.
- **Kräver:** inloggning. **Svar:** alltid lyckat (fel loggas bara).

#### `raderaKontoFn` — radera kontot

- **Vad den gör:** raderar kontot och allt sparat i det (värderingar, kalkyler, analyslistan). Föreningsrapporterna i registret finns kvar. Kräver lösenord.
- **Utlöses av:** S12, avsnittet "Radera konto": knappen "Radera mitt konto" → dialogen "Radera kontot?" → knappen "Radera kontot" (avbryt: "Avbryt"). Går därefter till S1.
- **Kräver:** inloggning (ägare).
- **Begränsningar:** delar inloggningskvoten.
- **Svar:** lyckat → utloggad, till S1. Fel visas i lösenordsfältet:
  - "Fel e-postadress eller lösenord." (fel lösenord)
  - "För många försök, vänta en stund."
  - "Du behöver logga in för att göra det här."
  - Generell text.

> **Känt fel:** Alla raderingsdialoger (konto, analys, värdering, kalkyl) visar "Tar bort…" på bekräftaknappen medan det pågår, även "Radera kontot" och "Radera".

---

### Sparat och profil

Alla funktioner här kräver **inloggning** och gäller bara **ägaren**. Utan inloggning svarar de "Du behöver logga in för att göra det här." (sidan skickar då till S13). Ett id som inte finns, inte är ens eget eller inte är ett riktigt id ger alltid "Vi hittade inte det du sökte." Gränsen är 200 sparade per sort. Gränstext: "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen."

#### `sparaVarderingFn` — spara en värdering

- **Vad den gör:** räknar om värderingen på servern och sparar den med valfritt namn (högst 120 tecken).
- **Utlöses av:** S2, kortet "Spara värderingen" (fältet "Namn", knappen "Spara värderingen"). Utloggad: utkast skrivs och användaren skickas till S13. Efter inloggning (`?spara=vardering`) sparas värderingen automatiskt.
- **Kräver:** inloggning.
- **Begränsningar:** räknas mot samma kvot som priskollen (60 per nätverk och timme).
- **Svar:** lyckat → "Sparad i ditt konto." + länk "Se dina sparade uppgifter i Mitt konto". Fel:
  - "Uppgifterna är ogiltiga. Kontrollera dem och försök igen."
  - priskollens egna valideringstexter (postnummer / "Några av uppgifterna saknas…")
  - "För många försök, vänta en stund."
  - gränstexten ovan
  - "Du behöver logga in för att göra det här."

> **Känt fel:** När priskoll-kvoten är slut vid sparande visas kontots text "För många försök, vänta en stund." i stället för priskollens "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen."

#### `hamtaSparadVarderingFn` — öppna en sparad värdering

- **Utlöses av:** automatiskt när S2 öppnas med `?sparad=<id>` (länken "Öppna" på S12). Under tiden: "Hämtar den sparade värderingen…".
- **Kräver:** inloggning (ägare). Utloggad skickas till S13 och tillbaka.
- **Svar:** den sparade bilden med datum och modellversion ("Sparad ÅÅÅÅ-MM-DD"). Fel: "Värderingen hittades inte." (id saknas), "Något gick fel. Försök igen om en stund." (kastat fel), annars serverns text.

#### `raderaSparadVarderingFn` — radera en sparad värdering

- **Utlöses av:** S12, kortet "Värderingar": knappen "Radera" → dialogen "Radera värderingen?" ("Den sparade värderingen raderas permanent. Det går inte att ångra.") → "Radera".
- **Kräver:** inloggning (ägare). **Svar:** lyckat (listan läses om) eller "Vi hittade inte det du sökte."

#### `sparaKalkylFn` — spara en bolånekalkyl

- **Vad den gör:** sparar kalkylens indata, nytt eller som uppdatering av en redan sparad. Sammanfattningen för listan räknas på servern.
- **Utlöses av:** S6, knapparna "Spara kalkylen" / "Spara ändringarna" (när en sparad kalkyl är öppen) och "Spara som ny kalkyl", med fältet "Namn". Utloggad: utkast skrivs och användaren skickas till S13. Efter inloggning (`?spara=kalkyl`) sparas den automatiskt.
- **Kräver:** inloggning.
- **Svar:** lyckat → "Sparad i ditt konto." Fel: "Uppgifterna är ogiltiga. Kontrollera dem och försök igen.", gränstexten, "Vi hittade inte det du sökte." (uppdatering av saknad kalkyl), "Du behöver logga in för att göra det här."

#### `hamtaSparadKalkylFn` — öppna eller exportera en sparad kalkyl

- **Utlöses av:** (1) automatiskt när S6 öppnas med `?sparad=<id>` (länken "Öppna" på S12). (2) S12, kortet "Bolånekalkyler", knapparna "PDF" och "Excel" (kalkylen hämtas när man klickar och filen laddas ner).
- **Kräver:** inloggning (ägare). Utloggad skickas till S13 och tillbaka.
- **Svar:** kalkylen (är det sparade formatet okänt visas en tom kalkyl med notis). Fel: "Vi hittade inte det du sökte.", "Något gick fel. Försök igen om en stund."

#### `raderaSparadKalkylFn` — radera en sparad kalkyl

- **Utlöses av:** S12, kortet "Bolånekalkyler": "Radera" → dialogen "Radera kalkylen?" → "Radera".
- **Kräver:** inloggning (ägare). **Svar:** lyckat eller "Vi hittade inte det du sökte."

#### `listaSparatFn` — hämta profilens listor

- **Vad den gör:** returnerar kontots analyser (status Pågår/Klar/Misslyckades, betyg), sparade värderingar och sparade kalkyler, nyast först.
- **Utlöses av:** automatiskt när S12 laddas (inloggad). Under tiden "Hämtar dina sparade uppgifter…".
- **Kräver:** inloggning. Utloggad skickas till S13.
- **Svar:** tre listor (eller tomlägen). Fel visas som ruta med knappen "Försök igen".

#### `taBortAnalysFranListaFn` — ta bort en analys från sin lista

- **Vad den gör:** raderar bara kontots egen analysrad. Föreningens rapport och registret påverkas inte; länken till analysen slutar fungera ("Vi hittar ingen analys med det här id:t").
- **Utlöses av:** S12, kortet "Analyser": "Ta bort från listan" → dialogen "Ta bort analysen från din lista?" → "Ta bort från listan".
- **Kräver:** inloggning (ägare). **Svar:** lyckat eller "Vi hittade inte det du sökte."

#### `hamtaSparstatusFn` — kan den här analysen sparas?

- **Vad den gör:** avgör om rapportsidan ska visa Spara-knapp. Ändrar inget.
- **Utlöses av:** automatiskt på S3 (när rapporten är klar) och S4.
- **Kräver:** utloggad ok.
- **Svar:** `sparad` ("Sparad i din profil. Mitt konto"), `kan_sparas` (knappen "Spara analysen" under betygskortet och kortet "Spara analysen i din profil" i slutet) eller `ingen` (någon annans analys, eller konton av: ingenting visas). Är kontot inte konfigurerat är svaret alltid `ingen`.

#### `forberedSparaAnalysFn` — förbered sparande av en analys när man är utloggad

- **Vad den gör:** kontrollerar att analysen tillhör just den här webbläsaren och sätter en tillfällig markering (7 dagar) så att den kan sparas efter inloggning/kontoskapande.
- **Utlöses av:** S3/S4, knappen "Spara analysen" när man är utloggad. Går därefter till S13 med `?spara=analys`.
- **Kräver:** utloggad ok (analysen måste tillhöra webbläsaren).
- **Svar:** lyckat → vidare till inloggning. Fel (alla nekanden har samma text): "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där." Går utkastet inte att skriva: "Analysen kunde inte förberedas för att sparas. Ladda om sidan och försök igen."

#### `sparaAnalysFn` — spara en analys i kontot

- **Vad den gör:** flyttar den här analysen till kontot. Ingen omkörning, inget API-anrop. Redan sparad går bra (idempotent).
- **Utlöses av:** S3/S4, knappen "Spara analysen" när man är inloggad ("Sparar…"), och automatiskt när man kommer tillbaka från inloggning med `?spara=analys` ("Sparar analysen…").
- **Kräver:** inloggning (ägare: samma webbläsare, eller redan kontots).
- **Svar:** lyckat → "Analysen är sparad i din profil." + länk "Se den i Mitt konto". Fel: "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där." och "Du behöver logga in för att göra det här." (skickar till inloggning).

#### `hamtaMinaUppgifterFn` — ladda ner mina uppgifter

- **Vad den gör:** samlar allt som är lagrat om kontot (konto, analysernas indata, sparade värderingar och kalkyler) som en JSON-fil.
- **Utlöses av:** S12, avsnittet "Konto": knappen "Ladda ner mina uppgifter" ("Hämtar…"). Filen heter `binfo-mina-uppgifter-<datum>.json`.
- **Kräver:** inloggning (ägare).
- **Svar:** fil, eller felrutan med "Vi hittade inte det du sökte." / generell text.

---

### BRF-registret

Läsfunktionerna kräver ingen inloggning och sätter ingen cookie (sidorna är cache-bara). De delar gränsen **300 läsningar per nätverk och timme**. Det finns ingen inline-ruta för kvoten.

> **Känt fel:** När registerkvoten är slut ("Du har läst många sidor i registret på kort tid. Vänta en stund och försök igen.") kastar sidans laddare ett fel, så användaren ser den generella felsidan (S19), inte texten och inte en vänlig ruta. Gäller S8, S9, S10 och S11.

#### `hamtaRegisterOmradenFn` — områdeskorten

- **Utlöses av:** automatiskt när S8 laddas.
- **Svar:** områdeskort (namn, "N föreningar" / "Inga föreningar ännu", "Senast uppdaterad <datum>"), grupperade Innerstaden / Söderort / Västerort / Övriga Stockholm.

#### `hamtaRegisterOmradeFn` — tabell över föreningar och sök

- **Vad den gör:** ger en sida (50 rader) föreningar, i ett område eller (utan område) över alla listade områden vid sökning. Sortering: betyg, skuld per m², årsavgift per m², sparande per m², analysdatum, stigande/fallande. Söker på namn eller organisationsnummer (högst 80 tecken).
- **Utlöses av:**
  - S8: fältet "Sök förening" + knappen "Sök" (och "Rensa"); sökordet ligger i adressen (`?sok=`).
  - S9: laddas med sidan; kolumnrubrikerna/sorteringsväljaren ("Sortera efter", "Stigande ↑" / "Fallande ↓"), sökfältet "Sök i <område>", samt "Föregående" / "Nästa".
- **Svar:** tabell/kort, tomläge (S8: "Inga föreningar matchar "X". Prova ett kortare namn eller bara organisationsnumret."; S9: "Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här."), okänt område → 404 "Området finns inte i registret", kvot → se känt fel ovan.

#### `hamtaRegisterForeningFn` — en förenings sammanfattning

- **Vad den gör:** ger föreningens namn, område, adresser, senaste årets betyg och nyckeltal med status, samt tidigare år. Inget annat ur analysen.
- **Utlöses av:** automatiskt när S10 laddas. Används även av S2 i registerläget (`?forening=`) för att hitta föreningen (följer ett byte av namn en gång).
- **Svar:** sammanfattning; gammal adress (föreningen bytt namn) → omdirigering (301) till nya; okänd eller ej listad förening → 404 "Föreningen finns inte i registret". På S2 vid fel eller okänd förening: formuläret faller tillbaka på vanlig uppladdning.

#### `hamtaRegisterAnalysFn` — föreningens fullständiga sparade analys

- **Vad den gör:** ger hela den sparade BRF-analysen för ett räkenskapsår (årtal 1900–2100). Visas som den sparades, med äldre-version-notis om den är gammal. Kör aldrig om.
- **Utlöses av:** automatiskt när S11 laddas, via knappen "Se hela analysen för varför föreningen fick betyget X" eller en årslänk i "Nyckeltal per år" på S10. Anropet kan sätta enhetscookien och cachas aldrig.
- **Kräver:** i dag utloggad ok. Behörigheten kan senare läggas bakom konto eller betalning.
- **Svar:** hela analysen; nekad behörighet → "Analysen är inte tillgänglig just nu" med serverns text "Du har inte tillgång till den fullständiga analysen just nu." och länken "Tillbaka till föreningens sammanfattning"; okänt år/förening → 404 "Analysen finns inte i registret"; kvot → se känt fel ovan.

#### `hamtaSitemapDataFn` — sajtkarta

- **Vad den gör:** listar adresserna till /brf, områden med minst en förening och varje listad förening, till sökmotorer.
- **Utlöses av:** S19, `/sitemap.xml` (ingen knapp; sökmotorer hämtar den). Ingen kvot, cachas 1 timme.

---

### Bakgrundsarbete

**Så ser användaren det.** Efter uppladdning arbetar servern i bakgrunden i upp till sex steg. Sidan S3 visar rubriken "Din analys pågår", en stegtext, en förloppsstapel och texten "Det här tar normalt 3–5 minuter" (för skannade: "…, för en skannad årsredovisning några minuter extra") följt av "Vi går igenom hela årsredovisningen, granskar nyckeltalen och tar fram potentiella varningsflaggor. Du kan gärna låta fliken vara öppen, sidan uppdateras automatiskt så snart analysen är klar."

| Steg (intern kod)                | Stegtext som visas                | Vad som händer                                                                                                                              |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `identifiering`                  | "Identifierar föreningen…"        | Läser sidorna 1–3 för att hitta organisationsnummer, år och namn. Finns föreningen redan i registret återanvänds den.                       |
| `transkribering` (bara skannade) | "Läser av de skannade sidorna…"   | Läser av bilderna sida för sida.                                                                                                            |
| `grundning`                      | "Läser årsredovisningen…"         | Går igenom hela dokumentet och samlar belägg med sidhänvisningar.                                                                           |
| `extraktion`                     | "Hämtar de sju nyckeltalen…"      | Tar ut nyckeltal och lån och kontrollerar sidhänvisningarna.                                                                                |
| `bedomning`                      | "Analyserar föreningens ekonomi…" | Sätter betyg, röda flaggor och frågor till styrelsen. Här skrivs även betygsmotiveringen vid behov om. Inget eget steg syns för användaren. |
| `klar`                           | "Sammanställer rapporten…"        | Rapporten är klar och visas.                                                                                                                |

**Notiser ovanför förloppet (Callout):**

- "Skannad årsredovisning": "Skannad årsredovisning upptäckt – analysen tar lite längre tid." Bara för skannade PDF:er, aldrig för "trasigt" textlager.
- "Analyseras redan": "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt."
- Efter klar, om rapporten fanns sedan innan: "Redan analyserad" (se `hamtaStatusFn`).

**Statusvärden som sidan kan se:** köad, körs, klar, misslyckad, "hittades inte". Det finns inget avbryt- eller köa-om-läge i UI:t.

> **Känt fel:** Texten "3–5 minuter" stämmer inte med uppmätt tid, som är ungefär 1–3 minuter.

> **Känt fel:** Förloppsstapeln räknar med steget "Läser av de skannade sidorna…" även när textlagret är "trasigt" (text finns men är oläslig), trots att det steget hoppas över i den vägen. Stapeln visar då för lite framsteg i varje steg. Notisen "Skannad årsredovisning" visas korrekt bara för "saknas".

**Bakgrundsjobb (cron), en mening var:**

- Var minut väcks arbetaren som tar nästa steg i väntande analyser.
- Var 5:e minut städas jobb som har misslyckats upprepade gånger bort och markeras som misslyckade ("Analysen misslyckades upprepade gånger och avbröts.").
- Varje natt anonymiseras adress, postnummer och organisationsnummer i gamla analysuppgifter (efter 12 månader), och gamla kvotrader och Booli-cache (äldre än 2 dygn) tas bort.
- Varje natt görs ett litet anrop som håller databasprojektet vaket.

**Felsteg som användaren kan se:** misslyckas ett steg försöker systemet upp till tre gånger. Efter det blir analysen "misslyckad" med någon av koderna i tabellen nedan. Binfo kan också ha uppdaterats medan analysen väntade; då kommer `versionskonflikt`: "Binfo uppdaterades medan din analys väntade i kön. Ladda upp årsredovisningen igen om en stund, så körs den med den senaste versionen." Har en administratör dragit tillbaka en rapport: "Analysen av den här årsredovisningen har dragits tillbaka. Ladda upp den igen, så görs en ny analys." (visas med samma skärm som `versionskonflikt`).

---

### Felmeddelanden för analyser

Skärmen `Misslyckad` (S3; eyebrow "Analysen kunde inte slutföras") visar: rubrik per kod, serverns text (om någon, annars förklaringen), förklaringen (om serverns text visas), åtgärden i fetstil och knappen "Till formuläret". Samma rubrik, text och åtgärd visas även i rutan under "Analysera" på S2.

| Kod                      | Rubrik                                        | Förklaring                                                                                                                                                                              | Åtgärd                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scanned_pdf`            | Årsredovisningen går inte att läsa maskinellt | Filen verkar vara en skannad bild eller ett foto snarare än ett digitalt PDF-dokument med text. Det händer ofta — omkring var åttonde årsredovisning vi hittills sett saknar textlager. | Be mäklaren eller styrelsen om den digitala originalfilen, till exempel från föreningens ekonomiska förvaltare, och ladda upp den i stället för en skanning eller ett foto.                                |
| `cost_cap`               | Tillfälligt tekniskt stopp                    | Det beror inte på din årsredovisning eller dina uppgifter — stoppet är på vår sida.                                                                                                     | Försök igen om en stund. Kvarstår det, hör av dig till oss.                                                                                                                                                |
| `daily_cap`              | Dagens gräns är nådd                          | Det beror inte på din analys — vi tar just nu emot ett begränsat antal analyser per dag.                                                                                                | Försök igen imorgon.                                                                                                                                                                                       |
| `validation`             | Uppgifterna kunde inte tolkas                 | Något i formuläret gick inte att tolka innan analysen kunde starta.                                                                                                                     | Gå tillbaka till formuläret, kontrollera uppgifterna och skicka in igen.                                                                                                                                   |
| `saknar_rantekanslighet` | Räntekänslighet saknas i årsredovisningen     | Räntekänslighet är det viktigaste av de sju lagstadgade nyckeltalen, och den här årsredovisningen redovisar det inte tillräckligt tydligt för att vi ska kunna räkna på det.            | Kontrollera att det är den senaste årsredovisningen (nyckeltalet är obligatoriskt sedan räkenskapsår 2023). Saknas uppgiften ändå, fråga styrelsen om den direkt. (Visas bara för gamla misslyckade jobb.) |
| `versionskonflikt`       | Analysen kunde inte slutföras                 | Det berodde inte på din årsredovisning — våra system uppdaterades medan analysen väntade i kön, mellan två steg som måste köras med samma version.                                      | Gå tillbaka till formuläret och ladda upp årsredovisningen igen om en stund, så körs den med den senaste versionen.                                                                                        |
| `kvot`                   | Gränsen är nådd för tillfället                | Det beror inte på din årsredovisning eller dina uppgifter — vi begränsar hur mycket som kan göras på kort tid, så att tjänsten räcker till alla.                                        | Vänta och försök igen senare. Kvarstår det, hör av dig till oss.                                                                                                                                           |
| `behorighet`             | Ingen tillgång just nu                        | Den här delen av Binfo är inte öppen för dig just nu.                                                                                                                                   | Hör av dig till oss om du tror att det är fel.                                                                                                                                                             |
| `unknown`                | Något gick fel                                | Vi kunde inte slutföra analysen.                                                                                                                                                        | Försök igen. Kvarstår felet, hör av dig till oss så tittar vi på det.                                                                                                                                      |

Serverns text per kod (visas ovanför förklaringen):

- `scanned_pdf` från jobbet: "Vi kunde inte läsa av de skannade sidorna tillförlitligt. Försök gärna med en digital version av årsredovisningen." (skannad PDF vars sidor inte gick att läsa).
- `cost_cap`: "Den här analysens uppskattade kostnad överstiger vad vi tillåter per rapport just nu. Försök igen senare, eller kontakta oss om det upprepas."
- `validation` (modellen svarade fel): generella analystexten.
- `unknown`: generella analystexten eller pausetexten.

> **Känt fel:** Flera texter säger "kontakta oss" / "hör av dig till oss" utan att det finns någon kontaktadress i UI:t.

---

## 4. Tillstånd som UI:t måste hantera

Det här avsnittet listar vad användaren ser när något inte är "normalfallet": tom lista, väntan, fel, nekad åtkomst, första besöket och så vidare. Texter står exakt som i koden. Där en text kommer från servern och kan variera står det "serverns text" och de vanligaste varianterna listas.

Allmänt om fel i Binfo:

- Kontofel och formulärfel visas i en röd ruta (`FelRuta`, `role="alert"`) med serverns svenska text ordagrant.
- När något oväntat går fel (nätverk, krasch) visas den generella texten "Något gick fel. Försök igen om en stund." (på kontosidor) eller en sidspecifik variant (se respektive sida).
- Det finns inget admin-UI. Adminarbete sker via kommandoradsverktyg och visas inte i gränssnittet.

### Tillståndstyper

| Typ                                  | Betyder                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Tomt                                 | Listan eller sidan har inget innehåll än. Oftast med en knapp som leder vidare.                                                            |
| Laddar/väntar                        | Något hämtas eller räknas. Text som "Laddar…", knappen byter text och blir inaktiv.                                                        |
| Fel                                  | Något gick snett: ogiltig inmatning, nätverk, serverfel, hittades inte.                                                                    |
| Lyckat                               | Handlingen gick bra: "Sparad i ditt konto.", rapport klar.                                                                                 |
| Nekad behörighet / kräver inloggning | Sidan eller handlingen kräver konto, eller servern nekar. I dag får alla alla funktioner, så nekad behörighet är i praktiken ett undantag. |
| Förstagångsanvändare                 | Första besöket: inga sparade objekt, inga analyser, inget konto.                                                                           |
| Analys pågår                         | Väntskärmen med steg, förloppsstapel och tidsuppskattning.                                                                                 |
| Skannad rapport                      | Årsredovisningen saknar textlager och läses av från bilder. Extra tid och extra varning om felrisk.                                        |
| Redan analyserad                     | Samma årsredovisning fanns redan i registret. Rapporten är klar direkt.                                                                    |
| Analyseras redan                     | Samma årsredovisning analyseras just nu för någon annan. Du får resultatet samtidigt.                                                      |
| Äldre version                        | Analysen gjordes med en tidigare version av Binfo. Visas som den är sparad, med en notis.                                                  |
| Delvis data / saknade nyckeltal      | Årsredovisningen saknar uppgifter. Kort döljs, "Okänt" visas eller en funktion stängs av.                                                  |
| Utanför Stockholm / lägre säkerhet   | Värderingen är grövre utanför Stockholms kommun och särskilt utanför länet.                                                                |
| Gräns nådd / kvot                    | Dagens eller timmens gräns för analyser, värderingar, Booli-hämtning, inloggningsförsök eller registerläsning är nådd.                     |
| Tillfälligt pausad                   | Driften har stängt av analyser (nödbroms), eller Booli-hämtningen är avstängd.                                                             |
| Utkast efter inloggning              | Användaren tryckte Spara utloggad, loggade in och kommer tillbaka. Formuläret fylls i igen och sparas en gång.                             |
| Session laddas                       | Webbläsaren frågar servern om användaren är inloggad. Menyn och kontosidor visar en platshållare eller "Laddar…".                          |

Kvotgränser (siffror, för att designern ska veta när meddelandena kan visas):

- Uppladdning av årsredovisning: 5 per enhet och dag, 10 per nätverk och dag, samt 30 per enhet och 100 per nätverk och dag totalt (inklusive uppladdningar som redan fanns).
- Priskoll (och sparande av värdering): 60 per nätverk och timme.
- Hämta uppgifter från Booli: 20 per enhet och 60 per nätverk och timme.
- Inloggning (och lösenordskontroll): 10 per nätverk och 5 per e-postadress per 15 minuter.
- Skapa konto: 5 per nätverk och timme. Glömt lösenord: 3 per e-postadress och 10 per nätverk och timme.
- Läsning i BRF-registret: 300 per nätverk och timme.
- Sparade objekt: högst 200 värderingar och 200 kalkyler per konto.

---

### G1 Sidhuvud (navigering) och sidfot

Gäller alla sidor.

| Tillstånd                 | När det inträffar                                                            | Vad användaren ser                                                                                               | Vad man kan göra                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Session laddas            | Direkt när en sida öppnas, medan webbläsaren frågar om inloggning            | Kontoknappen längst till höger har en osynlig platshållare med texten "Mitt konto" så att menyn inte hoppar      | Länkarna "Analysera", "BRF-register", "Bolånekalkyl", "Köpguide" och logotypen "Binfo" fungerar redan  |
| Utloggad                  | Ingen inloggning, eller sessionsfrågan misslyckades (behandlas som utloggad) | Knappen "Logga in"                                                                                               | Gå till `/konto/logga-in`                                                                              |
| Inloggad                  | Giltig session                                                               | Knappen "Mitt konto"                                                                                             | Gå till `/konto`                                                                                       |
| Aktiv sida                | Användaren är på en av de fyra huvudsidorna                                  | Den aktuella länken har ljus bakgrund                                                                            | –                                                                                                      |
| Smal skärm                | Mobil                                                                        | Länkraden bryts över flera rader (ingen mobilmeny)                                                               | –                                                                                                      |
| Sidfot                    | Alltid                                                                       | Länken "Integritet och personuppgifter"                                                                          | Öppna `/integritet`. Det finns ingen kontaktadress, inga sociala länkar och ingen sajtkarta i sidfoten |
| Okänd adress (404)        | Användaren öppnar en adress som inte finns                                   | "404", "Sidan hittades inte", "Sidan du letar efter finns inte eller har flyttats."                              | Knappen "Till startsidan"                                                                              |
| Oväntat fel i webbläsaren | Ett fel kastas när sidan visas                                               | "Sidan kunde inte laddas", "Något gick fel hos oss. Prova att ladda om sidan eller gå tillbaka till startsidan." | Knapparna "Försök igen" och "Till startsidan"                                                          |
| Oväntat serverfel (500)   | Servern kraschar vid sidvisning                                              | Fristående sida med samma rubrik "Sidan kunde inte laddas" och samma text, enkel stil utan sajtens design        | Knapparna "Försök igen" (laddar om) och "Till startsidan"                                              |

> **Känt fel:** Serverfelsidan använder inte sajtens design (systemtypsnitt, grå bakgrund, svarta knappar).
> Omdirigeringar och systemsidor beskrivs i S19.

---

### S1 Startsida `/`

Sidan är helt statisk. Den visar inte kontostatus och har inga laddnings- eller felvarianter.

| Tillstånd                  | När det inträffar | Vad användaren ser                                                                                                                                             | Vad man kan göra                                                                                                                                           |
| -------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalläge (alla besökare) | Alltid            | Rubriken "Säljaren har en mäklare. Nu har du Binfo." och en exempelrapport ("dossier") med påhittade siffror, tre frågekort, köpguide-teaser och oberoendetext | "Analysera en bostad", "Se köpguiden", "Se ett exempel på en rapport", "Granska föreningen", "Kolla priset", "Räkna på månadskostnaden", "Öppna köpguiden" |
| Förstagångsbesökare        | Första besöket    | Samma sida. Det finns ingen introduktion eller välkomstruta utöver sidan själv                                                                                 | Starta med "Analysera en bostad"                                                                                                                           |
| Inloggad användare         | Inloggad          | Samma sida som för utloggad. Bara menyknappen visar "Mitt konto"                                                                                               | –                                                                                                                                                          |

> **Känt fel:** De fyra stegen i exempelrapporten (Föreningen, Priset, Månadskostnad, Har du råd?) länkar till `#foreningen`, `#priset` och `#kostnaden`, men inga element har de id:na. Klick ändrar bara adressen, inget händer.

> **Känt fel:** Köpguide-teasern säger "Tolv steg från lånelöfte till tillträde" och exempelrapporten visar "4 av 12". I köpguiden visas 12 steg för bostadsrätt, så antalet stämmer i dag, men det är hårdkodat och följer inte köpguiden om steg läggs till eller tas bort.

---

### S2 Analysera en bostad `/analysera`

Sidan har tre lägen: vanligt läge (Booli-länk, Steg 1 Priskoll, Steg 2 Granska föreningen), registerläge (`?forening=<slug>`) och visning av en sparad värdering (`?sparad=<id>`).

**Förstagångsanvändare och återkommande**

- Alla fält är tomma. Fältens platshållare visar exempel: Boarea "58", Antal rum "3", Månadsavgift "3 240", Postnummer "116 25", Våning "4", Byggår "1931", Utgångspris "4 950 000". Hiss och balkong står på "Vet ej".
- Rutan "Dina senaste analyser" är dold och visas inte (även om webbläsaren sparar listan).
- Uppgifter som skrivits på `/analysera` (boarea, hiss, balkong) delas i minnet med `/bolanekalkyl`. En omladdning av sidan nollställer dem.

| Tillstånd                              | När det inträffar                                                                     | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Vad man kan göra                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ifyllning, inget försök än             | Första visningen                                                                      | Rubriken "Analysera en bostad", "Gratis priskoll · valfri BRF-analys". Bredvid knappen: "Ingen uppladdning behövs."                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fylla i fälten                                                                                           |
| Booli: tomt fält                       | Klick på "Hämta uppgifter" utan länk                                                  | "Klistra in en länk från Booli först." under fältet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Klistra in länk                                                                                          |
| Booli: hämtar                          | Under hämtning                                                                        | Knappen "Hämtar…" (inaktiv)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Vänta                                                                                                    |
| Booli: klart                           | Hämtning lyckades                                                                     | Hjälptexten byter till "Uppgifterna är ifyllda nedan. Kontrollera dem innan du går vidare." Fält får små texter: "Hämtat från Booli", "Uppslaget från adressen (© OpenStreetMap-bidragsgivare)", "Tolkat från annonsens text – kontrollera", efter ändring "Ändrat manuellt". Hiss/balkong som inte framgår: "Framgår inte av annonsen". Om annonsen anger förening: "Booli anger föreningen: <namn>. Kontrollera att årsredovisningen gäller den."                                                                                                            | Kontrollera och ändra                                                                                    |
| Booli: uppgift saknades                | Fältet fanns inte i annonsen och är tomt                                              | Texten "Fanns inte i annonsen, fyll i själv" och fältet får varningsram                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Fylla i själv                                                                                            |
| Booli: fel domän                       | Länken är inte Booli                                                                  | "Endast Booli-länkar stöds just nu."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Rätta länken                                                                                             |
| Booli: ogiltig länk                    | Booli men inte en annons                                                              | "Länken går inte till en bostadsannons på Booli. Kopiera adressen från annonsens sida, t.ex. https://www.booli.se/annons/1234567."                                                                                                                                                                                                                                                                                                                                                                                                                             | Rätta länken                                                                                             |
| Booli: avstängd                        | Driften har stängt av hämtningen                                                      | "Hämtning från Booli är tillfälligt avstängd, fyll i manuellt."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fylla i manuellt                                                                                         |
| Booli: kvot                            | Mer än 20 hämtningar per enhet eller 60 per nätverk och timme                         | "Du har hämtat många annonser på kort tid. Vänta en stund eller fyll i manuellt."                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Vänta eller fylla i manuellt                                                                             |
| Booli: nekad behörighet                | Behörigheten nekas (nekas inte i dag)                                                 | "Du har inte tillgång till den här funktionen just nu."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | –                                                                                                        |
| Booli: kunde inte hämta                | Sidan blockeras, hittas inte, kan inte tolkas, nätverksfel eller kast                 | "Vi kunde inte hämta uppgifterna, fyll i manuellt."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fylla i manuellt                                                                                         |
| Steg 1: valideringsfel                 | Klick på "Se värderingen" med ofullständiga fält                                      | Text bredvid knappen: "Fyll i de obligatoriska fälten." Fältfel: "Ange en giltig boarea.", "Ange antal rum.", "Ange en giltig månadsavgift.", "Ange postnummer.", "Ange ett postnummer med fem siffror, t.ex. 116 25.", "Ange våning.", "Ange ett giltigt utgångspris eller lämna fältet tomt." Felen visas först efter första försöket                                                                                                                                                                                                                        | Rätta och försöka igen                                                                                   |
| Postnummerhjälp                        | Fem siffror skrivna                                                                   | En rad under fältet: "Område: <område>, Stockholm." / "Stockholm, men området är okänt. Värderingen jämför med hela Stockholm." / "Kommun: <k>. Utanför Stockholms kommun blir värderingen grövre." / "Kommun: <k>, utanför Stockholms län. Värderingen blir ungefärlig." / "Vi känner inte igen just det här postnumret. Närliggande nummer ligger i <k>, och värderingen utgår från det. Kontrollera att postnumret stämmer." / "Vi känner inte igen postnumret, så värderingen blir ungefärlig. Kontrollera att det stämmer." (den sista ger varningsram)   | Kontrollera postnumret, eller följa länken "Vet du inte postnumret? Sök hos PostNord" (öppnas i ny flik) |
| Steg 1: räknar                         | Klick på "Se värderingen"                                                             | Knappen "Värderar…" (inaktiv)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Vänta                                                                                                    |
| Steg 1: serverfel i data               | Servern avvisar uppgifterna                                                           | Röd ruta, rubrik "Det gick inte att göra värderingen" och serverns text, t.ex. "Postnumret måste bestå av fem siffror, t.ex. 118 57." eller "Några av uppgifterna saknas eller är ogiltiga. Kontrollera boarea, antal rum, månadsavgift och utgångspris och försök igen."                                                                                                                                                                                                                                                                                      | Rätta uppgifterna                                                                                        |
| Steg 1: kvot                           | Mer än 60 värderingar per nätverk och timme                                           | Samma ruta med "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen."                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Vänta                                                                                                    |
| Steg 1: nekad behörighet               | Behörigheten nekas (nekas inte i dag)                                                 | Samma ruta med "Du har inte tillgång till den här funktionen just nu."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | –                                                                                                        |
| Steg 1: oväntat fel                    | Nätverk eller krasch                                                                  | Samma rubrik med "Något gick fel. Försök igen om en stund."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Försöka igen                                                                                             |
| Steg 1: resultat                       | Lyckat                                                                                | Prisdelen (se K1, Prisdelen) och kortet "Spara värderingen" ("Spara den i ditt konto för att hitta tillbaka till den och kunna räkna om den senare.") med fältet "Namn" (valfritt, "Till exempel adressen") och knappen "Spara värderingen". Därunder: "Vill du granska föreningen också? Fortsätt med steg 2 nedan — uppgifterna du fyllt i följer med."                                                                                                                                                                                                      | Spara, eller gå vidare till steg 2                                                                       |
| Steg 1: utanför länet                  | Postnummer utanför Stockholms län                                                     | Varningsruta i prisdelen "Utanför Binfos täckningsområde" (text i K1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Läsa varningen                                                                                           |
| Spara: utloggad                        | Klick på "Spara värderingen" utloggad                                                 | Bredvid knappen: "Du behöver ett konto för att spara. Dina uppgifter finns kvar när du har loggat in." Efter klick sparas ett utkast och användaren skickas till inloggning                                                                                                                                                                                                                                                                                                                                                                                    | Logga in eller skapa konto                                                                               |
| Spara: kan inte skriva utkast          | Webbläsaren blockerar lagring                                                         | "Webbläsaren tillåter inte att vi tillfälligt sparar dina uppgifter. Logga in först och fyll sedan i uppgifterna igen."                                                                                                                                                                                                                                                                                                                                                                                                                                        | Logga in först                                                                                           |
| Spara: sparar / klart                  | Inloggad användare sparar                                                             | "Sparar…", sedan "Sparad i ditt konto." med länken "Se dina sparade uppgifter i Mitt konto"                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Gå till Mitt konto                                                                                       |
| Spara: gräns                           | 200 sparade värderingar                                                               | "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Radera något i Mitt konto                                                                                |
| Spara: ogiltig indata                  | Servern avvisar uppgifterna                                                           | "Uppgifterna är ogiltiga. Kontrollera dem och försök igen." eller serverns text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Rätta                                                                                                    |
| Spara: kvot                            | Värderingskvoten är slut (sparande räknas som en värdering, 60 per nätverk och timme) | "För många försök, vänta en stund."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Vänta                                                                                                    |
| Spara: sessionen gick ut               | Inloggningen löpte ut                                                                 | Behandlas som utloggad: utkast skrivs och användaren skickas till inloggning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Logga in igen                                                                                            |
| Efter inloggning: kräver inloggning    | `?spara=vardering` men användaren är utloggad                                         | Ruta "Logga in för att spara": "Du behöver vara inloggad för att slutföra sparandet." med länken "Logga in"                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Logga in                                                                                                 |
| Efter inloggning: utkast saknas        | Utkastet är äldre än 24 timmar, i annan webbläsare eller redan använt                 | Ruta "Utkastet finns inte kvar": "Uppgifterna du fyllde i före inloggningen hittades inte (de sparas högst ett dygn, och bara i den här webbläsaren). Fyll i dem igen och tryck på Spara."                                                                                                                                                                                                                                                                                                                                                                     | Fylla i på nytt                                                                                          |
| Efter inloggning: sparar               | Utkastet återställs                                                                   | "Sparar din värdering…". Formuläret fylls i och värderingen räknas automatiskt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Vänta                                                                                                    |
| Efter inloggning: klart                | Sparandet lyckades                                                                    | "Din värdering är sparad i ditt konto." med länken "Se den i Mitt konto". Kortet "Spara värderingen" döljs                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gå till Mitt konto                                                                                       |
| Efter inloggning: fel                  | Sparandet misslyckades                                                                | "Värderingen kunde inte sparas: <serverns text>"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Försöka igen manuellt                                                                                    |
| Efter inloggning: ofullständigt utkast | Utkastet klarar inte valideringen längre                                              | "Uppgifterna du fyllde i är inte kompletta längre." och steg 1:s fältfel visas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Komplettera                                                                                              |
| Steg 2: registerläge laddar            | `?forening=<slug>` öppnas                                                             | Kort "Hämtar föreningen från registret…"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Vänta                                                                                                    |
| Steg 2: registerträff                  | Föreningen finns                                                                      | Kort "Föreningens årsredovisning finns redan hos Binfo" med "<namn> · räkenskapsår <år> · analyserad <datum>" och "Du behöver bara fylla i lägenhetens uppgifter i steg 1 samt adressen nedan." Rubrikens text blir "Du får de sju nyckeltalen, räntestresstest och frågor att ställa till styrelsen." Uppladdningsrutan döljs. Ingress: "…Föreningens årsredovisning har vi redan, så för BRF-analysen i steg 2 behöver du bara lägga till adressen — …". Knappen under: "Analysera" och texten "Föreningens analys finns redan — du får din rapport direkt." | "Ladda upp en annan årsredovisning i stället"                                                            |
| Steg 2: föreningen hittades inte       | Okänd slug                                                                            | Varningsruta "Vi hittade inte föreningen i registret" och "Ladda upp föreningens årsredovisning nedan i stället." Uppladdningsrutan visas                                                                                                                                                                                                                                                                                                                                                                                                                      | Ladda upp själv                                                                                          |
| Steg 2: föreningen kunde inte hämtas   | Fel vid hämtning                                                                      | Varningsruta "Vi kunde inte hämta föreningen just nu" och samma text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Ladda upp själv                                                                                          |
| Filval: ingen fil                      | Klick på "Analysera" utan fil                                                         | "Välj en fil att ladda upp."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Välja fil                                                                                                |
| Filval: fel typ                        | Filen är inte PDF                                                                     | "Filen måste vara en PDF." (filen behålls inte)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Välja annan fil                                                                                          |
| Filval: för stor                       | Över 25 MB                                                                            | "Filen är för stor. Max 25 MB."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Välja annan fil                                                                                          |
| Filval: vald                           | En PDF är vald                                                                        | Pillret "<filnamn> (x,y MB)" med knappen "Ta bort"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Byta eller ta bort                                                                                       |
| Steg 2: adress saknas                  | Klick på "Analysera" utan adress                                                      | "Ange adress." och "Fyll i de obligatoriska fälten, även i steg 1." (steg 1:s fel visas också)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fylla i                                                                                                  |
| Skickar                                | Klick på "Analysera"                                                                  | Knappen "Skickar in…" (inaktiv) och "Laddar upp och startar analysen…" (registerläge: "Skapar din analys…"). Vid uppladdning annars: "Analysen tar några minuter — du följer den på nästa sida."                                                                                                                                                                                                                                                                                                                                                               | Vänta, sedan flyttas användaren till S3                                                                  |
| Skickar: serverns avvisning            | Servern avvisar                                                                       | Röd ruta med rubrik efter felkod (se S3, tabellen över felkoder), serverns text, förklaring och åtgärd. Vanliga texter: "Uppgifterna om bostaden kunde inte tolkas. Kontrollera formuläret och försök igen." / "Filen verkar inte vara en PDF." / "Filen är för stor (max 25 MB)." / "Den skannade årsredovisningen har fler sidor än vi kan läsa av just nu. Ladda gärna upp en digital version (med textlager) av årsredovisningen." / "Föreningen finns inte i registret, eller så har den ingen färdig analys ännu. Ladda upp årsredovisningen i stället." | Rätta eller ladda upp annan fil                                                                          |
| Skickar: kvot                          | Dagsgräns för uppladdningar                                                           | "Du har nått dagens gräns för antal analyser. Försök igen i morgon." / "Dagens gräns för antal analyser från ditt nätverk är nådd. Försök igen i morgon." / "Du har gjort många uppladdningar idag, även av rapporter som redan var analyserade. Försök igen i morgon." / "Många uppladdningar har gjorts från ditt nätverk idag, även av rapporter som redan var analyserade. Försök igen i morgon."                                                                                                                                                          | Vänta till nästa dag                                                                                     |
| Skickar: dagens tak / paus             | Dagens kostnadstak nått eller nödbroms                                                | "Dagens gräns för antal analyser är nådd. Det är tillfälligt — försök igen imorgon." / "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss."                                                                                                                                                                                                                                                                                                                                                                                 | Vänta                                                                                                    |
| Skickar: nekad behörighet              | Behörighet nekas (nekas inte i dag)                                                   | "Du har inte tillgång till den här funktionen just nu."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | –                                                                                                        |
| Skickar: oväntat fel                   | Nätverk eller krasch                                                                  | Rubrik "Kunde inte skicka in analysen" och "Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och försök igen."                                                                                                                                                                                                                                                                                                                                                                                                                           | Försöka igen                                                                                             |
| Sparad värdering: laddar               | `?sparad=<id>`                                                                        | Sidhuvud "Sparad värdering" / "Priskoll" och "Hämtar den sparade värderingen…"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Vänta                                                                                                    |
| Sparad värdering: utloggad             | Ingen inloggning                                                                      | Samma laddningstext, sedan automatisk flytt till `/konto/logga-in?till=/analysera?sparad=<id>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Logga in                                                                                                 |
| Sparad värdering: hittades inte        | Fel id eller någon annans                                                             | "Värderingen hittades inte."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | "Gör en ny värdering", "Till Mitt konto"                                                                 |
| Sparad värdering: fel                  | Nätverk eller serverfel                                                               | "Något gick fel. Försök igen om en stund." eller serverns text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Ladda om                                                                                                 |
| Sparad värdering: öppnad               | Lyckat                                                                                | Kort med namn (eller "Sparad värdering"), märket "Sparad <datum>" och "Så här såg värderingen ut när du sparade den (modell <version>). Modellen uppdateras över tid; räkna om för att se vad dagens modell säger." Därunder den sparade prisdelen                                                                                                                                                                                                                                                                                                             | "Räkna om med dagens modell", "Gör en ny värdering", "Till Mitt konto"                                   |
| Sparad värdering: räknar om            | Klick på omräkning                                                                    | Knappen "Räknar om…". Resultatet visas under "Omräknat med dagens modell". Fel visas i en röd ruta                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Vänta                                                                                                    |
| Sparad värdering: gammalt format       | Lagrat format stöds inte längre                                                       | Varningsruta "Kan inte visas som den sparades": "Den sparade värderingen har ett format som inte längre stöds. Du kan räkna om den med uppgifterna du angav." (om uppgifterna inte går att läsa: "…Uppgifterna går inte heller att läsa, så den kan inte öppnas.")                                                                                                                                                                                                                                                                                             | Räkna om om möjligt                                                                                      |

> **Känt fel:** Hämtningen från Booli blockeras i produktion av Booli (Cloudflare). I praktiken slutar den nästan alltid i "Vi kunde inte hämta uppgifterna, fyll i manuellt." Funktionen finns kvar i gränssnittet.

> **Känt fel:** Fältet "Byggår" tolkar ogiltig text tyst som tomt, utan felmeddelande.

---

### S3 Analys pågår / rapport `/forhandsvisning/$analysisId`

Länken är en hemlig UUID-adress. Vem som helst med länken kan läsa status och rapport. Sidan är `noindex`.

| Tillstånd                      | När det inträffar                                      | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Vad man kan göra                           |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Pågår                          | Jobbet köas eller körs. Status hämtas var 5:e sekund   | Ögonbryn "Analyserar", rubrik "Din analys pågår". Stegtext (en av): "Identifierar föreningen…", "Läser av de skannade sidorna…", "Läser årsredovisningen…", "Hämtar de sju nyckeltalen…", "Analyserar föreningens ekonomi…", till sist "Sammanställer rapporten…". Förloppsstapel (5 steg, 6 för skannad). Text: "Det här tar normalt 3–5 minuter. Vi går igenom hela årsredovisningen, granskar nyckeltalen och tar fram potentiella varningsflaggor. Du kan gärna låta fliken vara öppen, sidan uppdateras automatiskt så snart analysen är klar." | Vänta. Sidan går vidare av sig själv       |
| Pågår, skannad                 | Textlager saknas ("saknas")                            | Tipsruta "Skannad årsredovisning": "Skannad årsredovisning upptäckt – analysen tar lite längre tid." Tidstexten får tillägget ", för en skannad årsredovisning några minuter extra". Visas aldrig vid trasigt textlager                                                                                                                                                                                                                                                                                                                              | Vänta                                      |
| Analyseras redan               | Samma årsredovisning körs redan för någon annan        | Tipsruta "Analyseras redan": "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt."                                                                                                                                                                                                                                                                                                                                                                                                                                             | Vänta                                      |
| Hämtar rapporten               | Jobbet är klart men resultatet hämtas                  | Rubrik "Hämtar analysen…" (ögonbryn "Ett ögonblick")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Vänta                                      |
| Statuskontroll                 | Defensivt, normalt osynligt                            | Rubrik "Kontrollerar status…"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | –                                          |
| Klar                           | Rapporten finns                                        | Ögonbryn "Klar", rubrik "Din analys", därefter hela rapporten (K1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Läsa, spara, ladda ner PDF, gå till kalkyl |
| Redan analyserad               | Rapporten återanvändes från registret                  | Tipsruta "Redan analyserad": "Den här årsredovisningen var redan analyserad – din analys är klar direkt."                                                                                                                                                                                                                                                                                                                                                                                                                                            | Läsa                                       |
| Äldre version                  | Rapporten gjordes med äldre version                    | Rapporten visas som den sparades. I rutan "Om extraktionens tillförlitlighet" står "Analysen gjordes med en tidigare version av Binfo."                                                                                                                                                                                                                                                                                                                                                                                                              | Läsa                                       |
| Hittades inte                  | Okänt id, id raderat, eller resultatet hittas inte     | Ögonbryn "Hittades inte", rubrik "Vi hittar ingen analys med det här id:t", "Länken kan vara felstavad, eller så finns analysen inte längre. Ladda upp årsredovisningen på nytt för att starta en ny analys."                                                                                                                                                                                                                                                                                                                                        | Knappen "Starta en ny analys"              |
| Misslyckad                     | Jobbet misslyckades                                    | Ögonbryn "Analysen kunde inte slutföras", rubrik efter felkod (tabellen nedan), serverns text, en förklaring och en fetad åtgärd                                                                                                                                                                                                                                                                                                                                                                                                                     | Knappen "Till formuläret"                  |
| Spara analysen: kan sparas     | Analysen är webbläsarens eget (utloggad) eller kontots | Knappen "Spara analysen" i en rad under betyget och i kortet "Spara analysen i din profil" i slutet ("Logga in eller skapa ett konto, så hittar du tillbaka till analysen under Mitt konto. Du kommer tillbaka hit och analysen görs inte om.")                                                                                                                                                                                                                                                                                                      | Spara. Utloggad skickas till inloggning    |
| Spara analysen: redan sparad   | Analysen tillhör redan kontot                          | Raden "Sparad i din profil." med länken "Mitt konto". Kortet i slutet visas inte                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gå till Mitt konto                         |
| Spara analysen: någon annans   | Analysen tillhör annan enhet eller konto               | Ingenting visas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | –                                          |
| Spara analysen: sparar / klart | Efter inloggning med `?spara=analys`                   | "Sparar analysen…", sedan "Analysen är sparad i din profil." med länken "Se den i Mitt konto"                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Gå till Mitt konto                         |
| Spara analysen: fel            | Kunde inte sparas                                      | "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där." Vid för många sparade: "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen." Om förberedelsen misslyckas: "Analysen kunde inte förberedas för att sparas. Ladda om sidan och försök igen."                                                                                                                                                                                                       | Försöka igen eller radera något            |

Felrubriker vid misslyckad analys (felkod, rubrik, åtgärd):

- Skannad som inte kan läsas: "Årsredovisningen går inte att läsa maskinellt" – "Be mäklaren eller styrelsen om den digitala originalfilen…"
- Kostnadstak per rapport: "Tillfälligt tekniskt stopp" – "Försök igen om en stund. Kvarstår det, hör av dig till oss."
- Dagens tak: "Dagens gräns är nådd" – "Försök igen imorgon."
- Ogiltiga uppgifter: "Uppgifterna kunde inte tolkas" – "Gå tillbaka till formuläret, kontrollera uppgifterna och skicka in igen."
- Räntekänslighet saknas (gamla misslyckade jobb): "Räntekänslighet saknas i årsredovisningen"
- Versionskonflikt: "Analysen kunde inte slutföras" – "Gå tillbaka till formuläret och ladda upp årsredovisningen igen om en stund…" Serverns text kan också vara "Analysen av den här årsredovisningen har dragits tillbaka. Ladda upp den igen, så görs en ny analys." eller "Analysen gjordes med en tidigare version av Binfo och behöver göras om. Ladda upp årsredovisningen igen."
- Gräns nådd: "Gränsen är nådd för tillfället" – "Vänta och försök igen senare. Kvarstår det, hör av dig till oss."
- Ingen behörighet: "Ingen tillgång just nu" – "Hör av dig till oss om du tror att det är fel."
- Okänt: "Något gick fel" – "Försök igen. Kvarstår felet, hör av dig till oss så tittar vi på det."
- Generell servertext: "Analysen kunde inte slutföras på grund av ett internt fel. Försök igen, och kontakta oss om felet kvarstår."
- Nödbroms: "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss."

> **Känt fel:** Tiden "3–5 minuter" stämmer inte med uppmätt tid (ungefär 1–3 minuter).

> **Känt fel:** Felrubriken för skannad som inte kan läsas ("Årsredovisningen går inte att läsa maskinellt") påstår att "var åttonde" rapport saknar textlager och ber om en digital original. Skannade rapporter stöds sedan v2. Texten visas bara om servern fortfarande returnerar den felkoden, vilket är oklart.

> **Känt fel:** "Hör av dig till oss" och "kontakta oss" står på flera felskärmar, men sajten har ingen kontaktadress.

---

### S4 Rapport (bokmärkeslänk) `/analys/$analysisId`

Samma rapport som S3 men som stabil länk. Sidan har inga egna väntskärmar eller felskärmar.

| Tillstånd                       | När det inträffar                                  | Vad användaren ser                                                                                    | Vad man kan göra         |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------ |
| Klar                            | Analysen är klar                                   | Ögonbryn "Klar", rubrik "Din analys", hela rapporten (K1), "Spara analysen" (som i S3)                | Läsa, spara, PDF, kalkyl |
| Alla andra lägen                | Pågår, misslyckad, okänt id eller nekad behörighet | Användaren skickas direkt till `/forhandsvisning/$analysisId`, som visar väntskärmen eller felet (S3) | Se S3                    |
| Redan analyserad                | Rapporten återanvändes                             | Ingen notis här (notisen finns bara i S3)                                                             | –                        |
| Spara analysen efter inloggning | `?spara=analys`                                    | Som i S3                                                                                              | Som i S3                 |

---

### S5 Exempelrapport `/exempel`

| Tillstånd           | När det inträffar               | Vad användaren ser                                                                                                                                                                                                                                                                                                              | Vad man kan göra                                                                                          |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Normalläge          | Alltid, ingen server involverad | Ögonbryn "Exempelrapport", rubrik "Så här ser en analys ut" och en ruta: "Det här är en exempelrapport — en riktig analys av en riktig årsredovisning (Brf Pontonjären 3), men en tidigare körning, inte en ny analys av just den bostad du är intresserad av. Vill du analysera din egen bostad?" Därunder hela rapporten (K1) | Länken "Ladda upp en årsredovisning" (till `/analysera`), "Ladda ner som PDF", "Räkna på månadskostnaden" |
| Ingen sparfunktion  | Alltid                          | Raden "Spara analysen" och kortet i slutet visas inte                                                                                                                                                                                                                                                                           | –                                                                                                         |
| Inloggad / utloggad | –                               | Ingen skillnad                                                                                                                                                                                                                                                                                                                  | –                                                                                                         |

---

### S6 Bolånekalkyl `/bolanekalkyl`

Allt räknas i webbläsaren. Inget skickas till servern förrän inloggad användare sparar.

**Förstagångsanvändare:** fälten visar förvalda värden och platshållare ("t.ex. <förvalt värde>"). Räntestress står på 0, "Antal låntagare" på "2 låntagare". Under "Vad ingår i avgiften?" är Värme och Vatten förvalda till "Ingår", övriga till "Vet ej". Fördjupningen är hopfälld. Uppgifter som skrivits på `/analysera` (boarea, vad som ingår) följer med i minnet, men nollställs vid omladdning.

| Tillstånd                          | När det inträffar                                          | Vad användaren ser                                                                                                                                                                                                                                                                                                              | Vad man kan göra         |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Förifylld från rapport             | Användaren kom via "Räkna på månadskostnaden" i en rapport | Lånebelopp: "Förifyllt utifrån priset i din analys, med minsta kontantinsats (10 %) — ändra om beloppet inte stämmer." (variant: "…utifrån en uppskattning av priset…"). Månadsavgift: "Förifylld från din analys — ändra om avgiften har uppdaterats." Boarea: "Schablonerna nedan räknar med boarean från din analys (X m²)." | Ändra värden             |
| Ofullständig inmatning             | Obligatoriska uppgifter saknas                             | Total månadskostnad visar "—" och "Fyll i uppgifterna till vänster." Schablonrader utan boarea: "Fyll i boarea till vänster för att räkna ut schablonerna."                                                                                                                                                                     | Fylla i                  |
| Fältfel                            | Ogiltigt tal eller utanför gräns                           | "Värdet måste vara mellan X och Y <enhet>.", "Värdet kan inte vara negativt.", "Skriv ett tal, till exempel 3 960 000 eller 3,6.", "Ange ett helt tal." Under kontantinsats även felet från beräkningen om den är under minimum (bolånetaket 90 %)                                                                              | Rätta                    |
| Spann                              | Något är satt till "Vet ej"                                | Total månadskostnad som intervall "X – Y kr/mån" med "Beroende på vad som ingår i avgiften."                                                                                                                                                                                                                                    | Välja Ingår/Ingår ej     |
| Okänd räntekänslighet              | Ingen rapport kopplad                                      | Räntestress: "Vi vet inte hur känslig den här föreningens avgift är för räntehöjningar — det kräver en uppladdad årsredovisning för att räkna med i totalen."                                                                                                                                                                   | –                        |
| Ränteavdrag begränsat              | Skatten räcker inte                                        | Ruta: "…av ränteavdraget kan inte utnyttjas eftersom skatten inte räcker till." med tips för två låntagare                                                                                                                                                                                                                      | Lägga lånet på båda      |
| Skuldkvot över tak                 | Inkomst angiven och skuldkvoten hög                        | Märket "Över bankernas vanliga interna tak — kan påverka din kreditprövning."                                                                                                                                                                                                                                                   | –                        |
| Fördjupning: saknar ränta          | Ränta tom                                                  | "Fyll i ränta ovan för att se scenarierna."                                                                                                                                                                                                                                                                                     | Fylla i                  |
| Fördjupning: öppnas själv          | Något KALP-fält avviker från förval                        | Sektionen "Fördjupning: räntescenarier och bankens kalkyl (valfritt)" är öppen                                                                                                                                                                                                                                                  | –                        |
| Bankens kalkyl: saknar uppgifter   | KALP-fält saknas                                           | "Fyll i <saknade fält> för att räkna ut bankens kalkyl."                                                                                                                                                                                                                                                                        | Fylla i                  |
| Bankens kalkyl: för stort hushåll  | Över 7 personer                                            | "Konsumentverkets tabell gäller hushåll upp till 7 personer, så vi kan inte räkna ut bankens kalkyl för ett större hushåll."                                                                                                                                                                                                    | –                        |
| Bankens kalkyl: underskott         | Resultatet negativt                                        | "Underskott per månad" i rött (annars "Överskott per månad")                                                                                                                                                                                                                                                                    | –                        |
| Export: inaktiv                    | Lånebelopp eller ränta saknas                              | Knapparna "Ladda ner PDF" och "Ladda ner Excel" är inaktiva med "Fyll i lånebelopp och ränta för att kunna ladda ner kalkylen."                                                                                                                                                                                                 | Fylla i                  |
| Export: skapar                     | Klick                                                      | "Skapar PDF…" / "Skapar Excel…". Hjälptext för Excel: "Excel-filen har levande formler: ändra värdena på bladet Indata så räknas allt om."                                                                                                                                                                                      | Vänta                    |
| Export: fel                        | Filen kunde inte skapas                                    | "Det gick inte att skapa filen just nu. Försök igen om en liten stund."                                                                                                                                                                                                                                                         | Försöka igen             |
| Spara: utloggad                    | Klick på "Spara kalkylen" utloggad                         | Utkast sparas, användaren skickas till `/konto/logga-in?till=/bolanekalkyl&spara=kalkyl`. Spara-knapparna visas först efter att sidan laddats i webbläsaren                                                                                                                                                                     | Logga in                 |
| Spara: lyckat                      | Inloggad                                                   | "Sparar…", sedan "Sparad i ditt konto." med länken "Se dina sparade uppgifter i Mitt konto". Fältet "Namn på kalkylen" är valfritt ("Till exempel adressen", max 120 tecken). "Sparad" nollställs vid varje ändring                                                                                                             | Gå till Mitt konto       |
| Spara: öppnad sparad kalkyl        | `?sparad=<id>` ok                                          | Ruta "Öppnad från ditt konto": "Öppnad från ditt konto: <namn eller datum>. Spara uppdaterar den här kalkylen; du kan också spara den som en ny." Knapparna blir "Spara ändringarna" och "Spara som ny kalkyl"                                                                                                                  | Uppdatera eller spara ny |
| Spara: gräns / fel                 | 200 kalkyler eller ogiltig indata                          | "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen." / "Uppgifterna är ogiltiga. Kontrollera dem och försök igen."                                                                                                                                                                                    | Radera något             |
| Sparad kalkyl: laddar / utloggad   | `?sparad=<id>`                                             | Rubrik och "Hämtar den sparade kalkylen…". Utloggad skickas till inloggning med `till=/bolanekalkyl?sparad=<id>`                                                                                                                                                                                                                | Logga in                 |
| Sparad kalkyl: hittades inte / fel | Id saknas eller har raderats                               | Varningsruta "Kalkylen kan inte öppnas": "Kalkylen hittades inte. Den kan ha raderats." (eller "Kalkylen kunde inte hämtas." / serverns text) och "Du kan fortfarande räkna på en ny kalkyl här." med länken "Till Mitt konto"                                                                                                  | Räkna ny                 |
| Sparad kalkyl: gammalt format      | Lagrat format stöds inte                                   | Samma rubrik: "Den sparade kalkylen har ett format som inte längre stöds, så uppgifterna kan inte fyllas i. Du kan fortfarande räkna på en ny kalkyl här."                                                                                                                                                                      | Räkna ny                 |
| Efter inloggning (`?spara=kalkyl`) | Återkomst efter inloggning                                 | Samma fem lägen som i S2: "Logga in för att spara" / "Utkastet finns inte kvar" / "Sparar din kalkyl…" / "Din kalkyl är sparad i ditt konto." med "Se den i Mitt konto" / "Kalkylen kunde inte sparas: <serverns text>"                                                                                                         | Se S2                    |

> **Känt fel:** Hjälptexten under Boarea ("Styr schablonerna för el, värme och hemförsäkring.") och under Antal personer ("Styr schablonen för vattenkostnad.") beskriver fel styrning. El och hemförsäkring styrs av antal personer. Värme och vatten styrs av boarea.

> **Känt fel:** Listan över vad som ingår skriver "TV" i kalkylen men "Tv" i rapporten.

---

### S7 Köpguide `/kopguide`

Ingen server, inga inloggningar. All status ligger bara i sidan.

| Tillstånd           | När det inträffar            | Vad användaren ser                                                                                                                                                                            | Vad man kan göra            |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Första visningen    | Alltid vid laddning          | Märket "0 av 12 steg klara" och tom förloppsstapel. Steg 1 "Förberedelse & lånelöfte" är öppet, övriga stängda. Tre grupper: "Före budgivningen", "Affären", "Fram till och efter tillträdet" | Öppna steg, bocka av        |
| Steg öppet          | Klick på ett steg            | Beskrivning, rutan "Viktiga flaggor" och rutan "Tips". Bara ett steg är öppet åt gången                                                                                                       | Stänga eller öppna annat    |
| Steg avbockat       | Klick på "Markera klar"      | Knappen blir "Klar", tidslinjens punkt fylls och räknaren ökar                                                                                                                                | Ångra genom att klicka igen |
| Allt klart          | Alla steg avbockade          | Märket "12 av 12 steg klara" och full stapel                                                                                                                                                  | –                           |
| Omladdning          | Sidan laddas om eller lämnas | All avbockning och öppet steg nollställs. Inget sparas i webbläsaren eller på servern                                                                                                         | Börja om                    |
| Inloggad / utloggad | –                            | Ingen skillnad                                                                                                                                                                                | –                           |
| Länkar i tips       | Steg 1, 4 och 9              | "Räkna på din månadskostnad här" (`/bolanekalkyl`), "Analysera föreningen här" (`/analysera`)                                                                                                 | Fullständig sidladdning     |

> **Känt fel:** Steget "Medlemskap i föreningen" slutar mitt i en mening: "…enligt stadgarna och bostadsrättslagen,vanligtvis inom några veckor. U" (saknat mellanslag efter kommat och ett lösryckt "U").

> **Känt fel:** Flera punkter i guiden saknar punkt eller har stavfel, t.ex. "Köper ni tillsammans ska ni båda ansöka om medlemskap" och "Tomträttsavgälden".

Dolt, ska inte byggas om: växeln Bostadsrätt/Hus finns i koden men är dold. Steget "Lagfart & pantbrev" hör till hus och visas inte.

---

### S8 BRF-registret `/brf`

Registret är offentligt, cachas och sätter inga cookies.

| Tillstånd                      | När det inträffar                           | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                                                          | Vad man kan göra                       |
| ------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Normalläge                     | Sidan öppnas                                | Rubrik "Bostadsrättsföreningar i Stockholm", sökfältet "Sök förening" (platshållare "Namn eller organisationsnummer"), områdeskort under "Innerstaden", "Söderort", "Västerort" och ev. "Övriga Stockholm". Varje kort: namn, "<n> förening(ar)" eller "Inga föreningar ännu", "Senast uppdaterad <datum>". Fotrad "<n> förening(ar) i registret. Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad." | Söka, välja område                     |
| Tomt område                    | Området har inga föreningar                 | Kortet visas ändå med "Inga föreningar ännu"                                                                                                                                                                                                                                                                                                                                                                                | Öppna området (visar tomt läge, se S9) |
| Förstagångsläge, tomt register | Inga föreningar alls                        | "Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här." och knappen "Analysera en bostad"                                                                                                                                                                                                                                                                                                        | Starta en analys                       |
| Sökning med träffar            | `?sok=`                                     | Tabell eller kort med träffarna och en områdeskolumn. Knappen "Rensa" visas                                                                                                                                                                                                                                                                                                                                                 | Sortera, öppna förening, rensa         |
| Sökning utan träffar           | Inga träffar                                | `Inga föreningar matchar "<sök>". Prova ett kortare namn eller bara organisationsnumret.`                                                                                                                                                                                                                                                                                                                                   | Ändra sökningen                        |
| Sortering och sidor            | Fler än 50 träffar eller klick på sortering | Sorteringsknappar på kolumnerna Betyg, "Skuld per m² bostadsrättsyta", "Årsavgift per m²", "Sparande per m²", Analysdatum. På mobil en rullista "Sortera efter" och en riktningsknapp ("Stigande ↑" / "Fallande ↓"). Sidning "Föregående", "Nästa", "Sida X av Y · N föreningar"                                                                                                                                            | Bläddra                                |
| Kvot                           | Över 300 läsningar per nätverk och timme    | Sidan kan inte laddas och felsidan "Sidan kunde inte laddas" visas. Texten "Du har läst många sidor i registret på kort tid. Vänta en stund och försök igen." finns i servern men visas inte på sidan                                                                                                                                                                                                                       | Vänta                                  |
| Utloggad / inloggad            | –                                           | Ingen skillnad                                                                                                                                                                                                                                                                                                                                                                                                              | –                                      |

> **Känt fel:** Vid registerkvot visas den generella felsidan i stället för meddelandet "Du har läst många sidor i registret på kort tid. Vänta en stund och försök igen."

---

### S9 Område i registret `/brf/omrade/$omrade`

| Tillstånd            | När det inträffar            | Vad användaren ser                                                                                                                                                                                                                                                                                                                               | Vad man kan göra              |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Lista                | Området har föreningar       | Brödsmula "BRF-register › <område>", rubrik "Bostadsrättsföreningar i <område>", ingress "Föreningar i området som har analyserats av Binfo. Siffrorna kommer från respektive årsredovisning; klicka på en förening för sidhänvisningar och bedömning." Sökfält "Sök i <område>", tabell/kort med sortering och sidning, fotrad om OpenStreetMap | Söka, sortera, öppna förening |
| Tomt område          | Inga föreningar              | "Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här." och knappen "Analysera en bostad"                                                                                                                                                                                                                             | Starta analys                 |
| Sökning utan träffar | Inga träffar i området       | `Inga föreningar matchar "<sök>". …`                                                                                                                                                                                                                                                                                                             | Rensa                         |
| Området finns inte   | Okänd områdesadress          | Ögonbryn "404", rubrik "Området finns inte i registret", länk "Till BRF-registret"                                                                                                                                                                                                                                                               | Gå till registret             |
| Kvot                 | Över 300 läsningar per timme | Generella felsidan (se S8)                                                                                                                                                                                                                                                                                                                       | Vänta                         |

---

### S10 Föreningssida `/brf/$slug`

Sammanfattning av en förening. Inga flaggor, motiveringar eller frågor visas här.

| Tillstånd         | När det inträffar                  | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Vad man kan göra                                                        |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Normalläge        | Föreningen finns                   | Brödsmula, ögonbryn "Föreningens analys", föreningens namn, ingress "Riskbetyg och nyckeltal enligt årsredovisningen för räkenskapsåret <år>. Varje siffra visar vilken sida i årsredovisningen den kommer från." Faktakort (Organisationsnummer, Område, Räkenskapsår, Analyserad), ev. "Adress enligt årsredovisningen: …", betygskort med förklaring, "Nyckeltal", knappen "Se hela analysen för varför föreningen fick betyget <X>", ev. tabellen "Nyckeltal per år", kortet "Köper du i den här föreningen?" | Öppna hela analysen, öppna ett år, "Analysera en lägenhet i föreningen" |
| Skannad rapport   | Källan var en skanning             | Varningsruta "Skannad årsredovisning": "Årsredovisningen var skannad; siffrorna är avlästa från sidbilderna och kan innehålla fel – kontrollera de viktigaste mot rapporten."                                                                                                                                                                                                                                                                                                                                     | Läsa                                                                    |
| Äldre version     | Analysen gjordes med äldre version | Grå rad: "Analysen gjordes med en tidigare version av Binfo."                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Läsa                                                                    |
| Saknade nyckeltal | Årsredovisningen saknar uppgifter  | Nyckeltal som saknas visas inte ("De som årsredovisningen saknar visas inte."). Det sjunde nyckeltalet (andel av rörelseintäkter) visas utan status                                                                                                                                                                                                                                                                                                                                                               | Läsa                                                                    |
| Bara ett år       | Inga tidigare år                   | Tabellen "Nyckeltal per år" visas inte                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | –                                                                       |
| Omdirigerad       | Föreningen har bytt adress (slug)  | Användaren skickas permanent till den nya adressen                                                                                                                                                                                                                                                                                                                                                                                                                                                                | –                                                                       |
| Finns inte        | Okänd slug                         | Ögonbryn "404", rubrik "Föreningen finns inte i registret", "Länken kan vara felskriven, eller så har föreningen inte analyserats ännu." och länken "Sök i BRF-registret". Fliktitel "Föreningen finns inte                                                                                                                                                                                                                                                                                                       | Binfo"                                                                  | Söka i registret |
| Kvot              | Över 300 läsningar per timme       | Generella felsidan (se S8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Vänta                                                                   |
| Felrapport        | Alltid i sidfoten                  | "Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel. Hittar du ett fel? Kontakta oss." (ingen länk, eftersom kontaktadress saknas)                                                                                                                                                                                                                                                                                                                                                 | –                                                                       |

> **Känt fel:** "Hittar du ett fel? Kontakta oss." saknar kontaktadress. Länken "Mejla oss" visas först när en adress anges i koden, vilket inte är gjort.

---

### S11 Föreningens fullständiga analys `/brf/$slug/analys/$ar`

Kräver behörigheten `se_registeranalys` (alla har den i dag). Sidan sätter ev. enhetscookie, cachas inte och är `noindex`.

| Tillstånd               | När det inträffar                                            | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Vad man kan göra                           |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Normalläge              | Analysen finns                                               | Brödsmula "BRF-register › <område> › <namn> › Analys <år>", ögonbryn "Hela analysen", föreningens namn, ingress "Den sparade analysen av årsredovisningen för räkenskapsåret <år>, gjord <datum>. …", betygskort med motivering, röda flaggor (högst två), föreningens ekonomi, övrig info, frågor att ställa, länk "Tillbaka till <namn>", kortet "Köper du i den här föreningen?" och fotrad "Siffrorna är hämtade ur föreningens årsredovisning och kan innehålla tolkningsfel. Analysen är beslutsstöd, inte finansiell rådgivning." | Läsa, "Analysera en lägenhet i föreningen" |
| Skannad / äldre version | Som S10                                                      | Samma varningsruta och grå rad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Läsa                                       |
| Behörighet nekad        | Policyn nekar (sker inte i dag)                              | Vanlig sida (inte felsida): ögonbryn "Hela analysen", rubrik "Analysen är inte tillgänglig just nu", serverns text ("Du har inte tillgång till den fullständiga analysen just nu.") och länken "Tillbaka till föreningens sammanfattning"                                                                                                                                                                                                                                                                                                | Gå tillbaka                                |
| Året finns inte         | Inget år, ogiltigt år (utanför 1900–2200) eller ingen analys | Ögonbryn "404", rubrik "Analysen finns inte i registret", "Länken kan vara felskriven, eller så finns ingen analys för det räkenskapsåret." och länkarna "Till föreningens sida" och "Sök i BRF-registret"                                                                                                                                                                                                                                                                                                                               | Gå vidare                                  |
| Omdirigerad             | Ny slug                                                      | Permanent omdirigering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | –                                          |
| Kvot                    | Över 300 läsningar per timme                                 | Generella felsidan (se S8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Vänta                                      |
| Spara / PDF             | –                                                            | Inga spar- eller PDF-knappar på den här sidan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | –                                          |

---

### S12 Mitt konto `/konto`

Kräver inloggning. Kontrollen sker i webbläsaren efter sidladdning.

| Tillstånd                         | När det inträffar              | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                        | Vad man kan göra                                                     |
| --------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Session laddas / utloggad         | Sidan öppnas                   | Ögonbryn "Mitt konto", rubrik "Mitt konto" och "Laddar…". Utloggad skickas till `/konto/logga-in?till=/konto`. Samma flytt sker om servern svarar "Du behöver logga in för att göra det här."                                                                                                                                                                                             | Logga in                                                             |
| Hämtar listor                     | Inloggad, data hämtas          | Ingress "Inloggad som <e-post>." och "Hämtar dina sparade uppgifter…"                                                                                                                                                                                                                                                                                                                     | Vänta                                                                |
| Listfel                           | Listorna kunde inte hämtas     | Röd ruta med serverns text (eller "Något gick fel. Försök igen om en stund.") och knappen "Försök igen"                                                                                                                                                                                                                                                                                   | Försöka igen                                                         |
| Förstagångsanvändare: allt tomt   | Nytt konto utan sparade objekt | Tre kort med tomtext. Analyser: "Du har inga analyser än. Ladda upp en årsredovisning så hamnar analysen här." (knapp "Analysera en bostad"). Värderingar: "Du har inga sparade värderingar. Gör en priskoll och tryck på Spara." (knapp "Gör en priskoll"). Bolånekalkyler: "Du har inga sparade bolånekalkyler. Räkna på ditt bolån och tryck på Spara." (knapp "Öppna bolånekalkylen") | Följa knappen                                                        |
| Analysrad                         | Det finns analyser             | Datum, föreningens namn (eller "Förening ej identifierad"), märke "Pågår" / "Klar" / "Misslyckades", ev. "Betyg <X>", detaljer (adress, "Räkenskapsår <år>", "Utgångspris <belopp> kr"). Adressen saknas efter 12 månader                                                                                                                                                                 | "Öppna" (klar: rapporten, annars väntskärmen), "Ta bort från listan" |
| Värderingsrad                     | Det finns värderingar          | Datum, namn (annars "Postnummer <nr>", annars "Värdering"), "Värdering <belopp>", "<n> m²", "Utgångspris <belopp>". Märket "Kan inte öppnas" om formatet inte längre går att läsa                                                                                                                                                                                                         | "Öppna" (visas bara om den går att öppna), "Radera"                  |
| Kalkylrad                         | Det finns kalkyler             | Datum, namn (annars "Bolånekalkyl"), "<belopp> i månaden efter ränteavdrag" (eller spann "X–Y kr…"), "Belåningsgrad <x> %", "Amortering <x> % per år"                                                                                                                                                                                                                                     | "Öppna", "PDF", "Excel", "Radera"                                    |
| Export av sparad kalkyl: fel      | Gammalt format eller fel       | "Den här kalkylen sparades i ett format som inte längre stöds, så den kan inte laddas ner. Du kan fortfarande radera den." / "Det gick inte att skapa filen just nu. Försök igen om en liten stund."                                                                                                                                                                                      | Radera eller försöka igen                                            |
| Bekräfta borttagning av analys    | Klick på "Ta bort från listan" | Dialog "Ta bort analysen från din lista?": "Analysen försvinner från din lista och dina uppgifter om lägenheten (adress och pris) raderas. Själva rapporten om föreningen finns kvar i Binfos register." och "Länken till analysen slutar fungera, så spara den på annat håll om du vill kunna öppna den igen." Knappar "Avbryt" och "Ta bort från listan"                                | Bekräfta eller avbryta                                               |
| Bekräfta borttagning av värdering | Klick på "Radera"              | Dialog "Radera värderingen?": "Den sparade värderingen raderas permanent. Det går inte att ångra."                                                                                                                                                                                                                                                                                        | Bekräfta eller avbryta                                               |
| Bekräfta borttagning av kalkyl    | Klick på "Radera"              | Dialog "Radera kalkylen?": "Den sparade kalkylen raderas permanent. Det går inte att ångra."                                                                                                                                                                                                                                                                                              | Bekräfta eller avbryta                                               |
| Borttagning pågår                 | Efter bekräftelse              | Knappen visar "Tar bort…" och båda dialogknapparna är inaktiva                                                                                                                                                                                                                                                                                                                            | Vänta                                                                |
| Borttagningsfel                   | Servern nekar                  | Röd ruta överst: serverns text, t.ex. "Vi hittade inte det du sökte." eller "Något gick fel. Försök igen om en stund." Listorna läses om                                                                                                                                                                                                                                                  | –                                                                    |
| Ladda ner mina uppgifter          | Klick                          | Knappen "Hämtar…". En fil `binfo-mina-uppgifter-<ÅÅÅÅ-MM-DD>.json` laddas ner. Fel visas i den röda rutan överst                                                                                                                                                                                                                                                                          | Spara filen                                                          |
| Logga ut                          | Klick på "Logga ut"            | Användaren skickas till `/` och sessionen rensas                                                                                                                                                                                                                                                                                                                                          | –                                                                    |
| Byt lösenord                      | Klick på "Byt lösenord"        | Går till `/konto/nytt-losenord?nuvarande=ja`                                                                                                                                                                                                                                                                                                                                              | Se S17                                                               |
| Radera konto: dialog              | Klick på "Radera mitt konto"   | Dialog "Radera kontot?": "Ange ditt lösenord för att bekräfta. Kontot och allt sparat i det raderas." Fältet "Lösenord". Knappar "Avbryt" och "Radera kontot". Förklaring på sidan: "Raderar kontot och allt som är sparat i det: dina värderingar, bolånekalkyler och analyslistan. Föreningsrapporterna finns kvar i Binfos register. Det går inte att ångra."                          | Bekräfta eller avbryta                                               |
| Radera konto: fel lösenord        | Fel lösenord                   | Dialogen står kvar med felet i fältet: "Fel e-postadress eller lösenord."                                                                                                                                                                                                                                                                                                                 | Försöka igen                                                         |
| Radera konto: kvot                | Fem felförsök på 15 minuter    | "För många försök, vänta en stund."                                                                                                                                                                                                                                                                                                                                                       | Vänta                                                                |
| Radera konto: oväntat fel         | Krasch under radering          | "Något gick fel. Försök igen om en stund." Data kan redan vara raderad; användaren måste i så fall logga in igen för att försöka på nytt                                                                                                                                                                                                                                                  | –                                                                    |
| Radera konto: lyckat              | Allt raderat                   | Användaren skickas till `/` och är utloggad                                                                                                                                                                                                                                                                                                                                               | –                                                                    |

> **Känt fel:** Alla bekräftelsedialoger visar "Tar bort…" under arbetet, även "Radera" och "Radera kontot".

> **Känt fel:** Fel lösenord i raderingsdialogen ger texten "Fel e-postadress eller lösenord." trots att ingen e-postadress anges.

---

### S13 Logga in `/konto/logga-in`

Sökparametrar: `?till=` (endast adresser på sajten, annars `/konto`) och `?spara=` (vardering, kalkyl eller analys).

| Tillstånd                | När det inträffar                                              | Vad användaren ser                                                                                                                                                                                                                                                                   | Vad man kan göra                      |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Vanlig inloggning        | Öppnad från menyn                                              | Ögonbryn "Mitt konto", rubrik "Logga in", ingress "Logga in för att se dina sparade analyser, värderingar och kalkyler." Fält "E-postadress" (platshållare "namn@exempel.se") och "Lösenord", knappen "Logga in", länkarna "Glömt lösenordet?" och "Har du inget konto? Skapa konto" | Logga in                              |
| Inloggning för att spara | `?spara=` finns                                                | Ingress "Logga in för att spara. Dina uppgifter finns kvar när du kommer tillbaka."                                                                                                                                                                                                  | Logga in                              |
| Loggar in                | Under anrop                                                    | Knappen "Loggar in…" (inaktiv)                                                                                                                                                                                                                                                       | Vänta                                 |
| Fel uppgifter            | Okänd adress eller fel lösenord                                | "Fel e-postadress eller lösenord." (samma text i båda fallen)                                                                                                                                                                                                                        | Försöka igen                          |
| E-post inte bekräftad    | Kontot finns men länken inte använd                            | "E-postadressen är inte bekräftad ännu. Klicka på länken i bekräftelsemejlet först." Det finns ingen knapp för att skicka mejlet igen                                                                                                                                                | Använda mejlet, eller registrera igen |
| Kvot                     | Fler än 5 försök per adress eller 10 per nätverk på 15 minuter | "För många försök, vänta en stund."                                                                                                                                                                                                                                                  | Vänta                                 |
| Ogiltigt format          | Fel e-postformat                                               | "Fel e-postadress eller lösenord." (formatfel i fältet hanteras av webbläsaren)                                                                                                                                                                                                      | Rätta                                 |
| Konton avstängda         | Tjänsten saknar konfiguration                                  | "Konton är inte aktiverade just nu. Försök igen senare."                                                                                                                                                                                                                             | –                                     |
| Oväntat fel              | Krasch                                                         | "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår." (serverfel) eller "Något gick fel. Försök igen om en stund." (nätverk)                                                                                                                        | Försöka igen                          |
| Lyckat                   | Rätt uppgifter                                                 | Användaren skickas till `?till=` (standard `/konto`), med `?spara=` tillagt om ett sparande väntar. Anonyma analyser från samma enhet flyttas till kontot                                                                                                                            | –                                     |
| Redan inloggad           | Sidan öppnas med giltig session (t.ex. bekräftat i annan flik) | Användaren skickas vidare till `till` utan att slutföra något sparande                                                                                                                                                                                                               | –                                     |
| Utkast efter inloggning  | Kom hit från Spara                                             | Efter inloggning visar målsidan sina egna lägen (S2, S3, S4, S6)                                                                                                                                                                                                                     | –                                     |

---

### S14 Skapa konto `/konto/skapa`

| Tillstånd                       | När det inträffar                                             | Vad användaren ser                                                                                                                                                                                                                                                                                                                                    | Vad man kan göra    |
| ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Formulär                        | Öppnad                                                        | Ögonbryn "Mitt konto", rubrik "Skapa konto", ingress "Med ett konto kan du spara värderingar och bolånekalkyler och hitta tillbaka till dina analyser." Fält "E-postadress" och "Lösenord" (hint "Minst 10 tecken."), knappen "Skapa konto", texten "Läs hur vi hanterar dina uppgifter i integritetspolicyn." och "Har du redan ett konto? Logga in" | Skapa konto         |
| Skickar                         | Under anrop                                                   | Knappen "Skapar konto…"                                                                                                                                                                                                                                                                                                                               | Vänta               |
| För kort lösenord (webbläsaren) | Under 10 tecken                                               | "Lösenordet måste vara minst 10 tecken."                                                                                                                                                                                                                                                                                                              | Rätta               |
| Svagt lösenord (servern)        | Under 10 tecken, över 72 byte, läckt eller samma som tidigare | "Lösenordet måste vara minst 10 tecken (och högst 72 byte). Det får inte heller vara ett lösenord som förekommit i ett dataintrång eller det du redan har."                                                                                                                                                                                           | Välja annat         |
| Ogiltig e-post                  | Fel format                                                    | "Ange en giltig e-postadress."                                                                                                                                                                                                                                                                                                                        | Rätta               |
| Kvot                            | Fler än 5 registreringar per nätverk och timme                | "För många försök, vänta en stund."                                                                                                                                                                                                                                                                                                                   | Vänta               |
| Konton avstängda / oväntat fel  | Se S13                                                        | "Konton är inte aktiverade just nu. Försök igen senare." / "Något gick fel hos oss. …"                                                                                                                                                                                                                                                                | –                   |
| Kolla din e-post                | Registreringen godtogs (visas även om adressen redan finns)   | Rubrik "Kolla din e-post": "Om adressen <e-post> går att använda har vi skickat ett mejl med en länk för att bekräfta kontot. Det brukar komma inom någon minut. Titta även i skräpposten." och "Du kan öppna länken i en ny flik. Den här sidan går vidare när kontot är bekräftat." Länk "Redan bekräftat? Logga in"                                | Öppna mejlet, vänta |
| Bekräftat i annan flik          | Användaren återvänder till fliken                             | Fliken kontrollerar sessionen när den får fokus och går vidare till `till` (standard `/konto`)                                                                                                                                                                                                                                                        | –                   |
| Redan inloggad                  | Sidan öppnas med giltig session                               | Användaren skickas vidare till `till`                                                                                                                                                                                                                                                                                                                 | –                   |

---

### S15 Glömt lösenord `/konto/glomt-losenord`

| Tillstånd      | När det inträffar                                   | Vad användaren ser                                                                                                                                                                                                            | Vad man kan göra                         |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Formulär       | Öppnad (även när inloggad)                          | Rubrik "Glömt lösenord", ingress "Ange e-postadressen till ditt konto så skickar vi en länk för att välja ett nytt lösenord.", fält "E-postadress", knappen "Skicka återställningslänk" och länken "Tillbaka till inloggning" | Skicka                                   |
| Skickar        | Under anrop                                         | Knappen "Skickar…"                                                                                                                                                                                                            | Vänta                                    |
| Skickat        | Alltid, oavsett om adressen finns                   | Formuläret ersätts av: "Om adressen finns skickar vi ett mejl med en länk för att välja nytt lösenord. Länken gäller en begränsad tid. Titta även i skräpposten."                                                             | Öppna mejlet, "Tillbaka till inloggning" |
| Ogiltig e-post | Fel format                                          | "Ange en giltig e-postadress."                                                                                                                                                                                                | Rätta                                    |
| Kvot           | Fler än 3 per adress eller 10 per nätverk och timme | "För många försök, vänta en stund."                                                                                                                                                                                           | Vänta                                    |
| Oväntat fel    | Krasch                                              | "Något gick fel. Försök igen om en stund."                                                                                                                                                                                    | Försöka igen                             |

---

### S16 Bekräfta e-post / länk från mejl `/konto/bekrafta`

Länken kommer från mejlet och kontrolleras inte när sidan öppnas. Först när användaren trycker på knappen används den. Sidan har tre typer: bekräfta konto, återställ lösenord och byta e-post (typen finns men kan inte startas från gränssnittet).

| Tillstånd                      | När det inträffar                | Vad användaren ser                                                                                                                                                                                                   | Vad man kan göra    |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Ofullständig länk              | Kod eller typ saknas             | Rubrik "Länken fungerar inte": "Länken är ofullständig. Öppna den direkt från mejlet eller begär en ny." Länk "Till inloggningen"                                                                                    | Logga in / begär ny |
| Redo (bekräfta konto)          | Giltig länkform                  | Rubrik "Bekräfta din e-postadress", "Tryck på knappen för att bekräfta din e-postadress och logga in." Knappen "Bekräfta e-postadressen"                                                                             | Trycka              |
| Redo (återställ)               | `type=recovery`                  | Rubrik "Välj nytt lösenord", "Tryck på knappen för att fortsätta och välja ett nytt lösenord." Knappen "Fortsätt"                                                                                                    | Trycka              |
| Kontrollerar                   | Under anrop                      | Knappen "Kontrollerar…" (inaktiv)                                                                                                                                                                                    | Vänta               |
| Ogiltig eller använd länk      | Länken gammal eller redan använd | Röd ruta: "Länken är ogiltig eller har gått ut. Länkar i mejl fungerar bara en gång och en begränsad tid." och länk "Begär en ny länk" (återställning, till S15) eller "Till inloggningen"                           | Begära ny länk      |
| Annan session aktiv            | Redan inloggad med annat konto   | "Du är redan inloggad med ett annat konto. Logga ut och be om en ny länk (via Glömt lösenord eller genom att registrera dig igen)."                                                                                  | Logga ut            |
| Kvot / oväntat fel             | Tillfälligt                      | "För många försök, vänta en stund." / "Något gick fel hos oss. Försök igen om en stund, och kontakta oss om felet kvarstår." / "Något gick fel. Försök igen om en stund."                                            | Försöka igen        |
| Konto bekräftat                | Lyckat                           | Rubrik "Kontot är bekräftat": "Din e-postadress är bekräftad och du är inloggad." Knappen "Fortsätt", eller "Fortsätt och spara" om ett sparande väntar. Målet är `?till=`, annars målet i utkastet, annars `/konto` | Gå vidare           |
| Återställning lyckad           | `type=recovery`                  | Användaren skickas direkt till S17 och är inloggad                                                                                                                                                                   | Välja nytt lösenord |
| Ny webbläsarflik utan `?till=` | Länken öppnas i ny flik          | Målet hämtas från ett sparat utkast om ett finns (giltigt i 24 timmar)                                                                                                                                               | –                   |

---

### S17 Välj nytt lösenord `/konto/nytt-losenord`

Kräver en session. Nås efter en återställningslänk eller via "Byt lösenord" på S12 (`?nuvarande=ja`).

| Tillstånd                | När det inträffar                        | Vad användaren ser                                                                                                                                                  | Vad man kan göra   |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Utloggad                 | Ingen session                            | Användaren skickas till `/konto/logga-in?till=/konto/nytt-losenord`                                                                                                 | Logga in           |
| Efter återställningslänk | Giltigt återställningsmärke (15 minuter) | Rubrik "Välj nytt lösenord", ingress "Lösenordet ska vara minst 10 tecken." Bara fältet "Nytt lösenord" (hint "Minst 10 tecken.") och knappen "Spara nytt lösenord" | Spara              |
| Byte från Mitt konto     | `?nuvarande=ja`                          | Även fältet "Nuvarande lösenord"                                                                                                                                    | Fylla i båda       |
| Nuvarande lösenord krävs | Inget giltigt märke och inget angivet    | "Ange ditt nuvarande lösenord för att byta till ett nytt." Fältet visas                                                                                             | Fylla i            |
| Sparar                   | Under anrop                              | Knappen "Sparar…"                                                                                                                                                   | Vänta              |
| För kort lösenord        | Under 10 tecken                          | "Lösenordet måste vara minst 10 tecken."                                                                                                                            | Rätta              |
| Svagt lösenord (servern) | Se S14                                   | "Lösenordet måste vara minst 10 tecken (och högst 72 byte). Det får inte heller vara ett lösenord som förekommit i ett dataintrång eller det du redan har."         | Välja annat        |
| Fel nuvarande lösenord   | Felaktigt                                | "Fel e-postadress eller lösenord."                                                                                                                                  | Försöka igen       |
| Kvot                     | Fem felförsök på 15 minuter              | "För många försök, vänta en stund."                                                                                                                                 | Vänta              |
| Sessionen gick ut        | Under sparande                           | Användaren skickas till inloggning                                                                                                                                  | Logga in           |
| Klart                    | Lyckat                                   | Rubrik "Lösenordet är ändrat": "Ditt nya lösenord gäller från och med nu." Länk "Till Mitt konto". Alla andra inloggade enheter loggas ut                           | Gå till Mitt konto |
| Oväntat fel              | Krasch                                   | "Något gick fel. Försök igen om en stund."                                                                                                                          | Försöka igen       |

> **Känt fel:** Fel nuvarande lösenord ger texten "Fel e-postadress eller lösenord." trots att ingen e-postadress anges.

---

### S18 Integritet `/integritet`

| Tillstånd           | När det inträffar          | Vad användaren ser                                                                                                                                                                                                                                   | Vad man kan göra                                 |
| ------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Normalläge          | Alltid, statisk            | Rubrik "Så hanterar vi dina uppgifter", datum "Senast ändrad 14 oktober 2026" och sju kort: Vem ansvarar, Utan konto, Med konto, Årsredovisningar och BRF-registret, I din webbläsare, Leverantörer som behandlar uppgifter åt oss, Dina rättigheter | Läsa, länkar till `/analysera`, `/brf`, `/konto` |
| Ingen kontaktadress | Kontaktadress är inte satt | Där en adress ska stå står "kontakta oss" utan länk (personuppgiftsansvarig: "Binfo (binfo.slanesens.com)")                                                                                                                                          | –                                                |
| Inloggad / utloggad | –                          | Ingen skillnad                                                                                                                                                                                                                                       | –                                                |

> **Känt fel:** Integritetstexten saknar kakorna `binfo_spara` (7 dagar) och `binfo_aterst` (15 minuter), nämner inte Booli-hämtningen och annonscachen (2 dagar), och säger ingenting om att e-postadresser används som oläsliga nycklar för begränsning av försök.

> **Känt fel:** "kontakta oss" används här och på flera felskärmar utan att det finns en kontaktadress.

---

### K1 Delad komponent: Analysrapporten

Visas på S3, S4, S5 och delvis på S11. Prisdelen ("Är priset rimligt?" / "Binfos värdering") visas även i S2.

| Tillstånd                                         | När det inträffar                                              | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                       | Vad man kan göra              |
| ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Fullständig rapport                               | Alla delar finns                                               | Sammanfattning av bostaden, betygskort, röda flaggor, föreningens ekonomi, övrig info, prisdelen, "Vad händer om räntan stiger?", frågor, sammanfattning och knapparna "Ladda ner som PDF" och "Räkna på månadskostnaden"                                                                                                                                                                | –                             |
| Adressen anonymiserad                             | Efter 12 månader                                               | I stället för adressen: "Adressen raderad efter 12 månader"                                                                                                                                                                                                                                                                                                                              | –                             |
| Utgångspris saknas                                | Köparen angav inget pris                                       | Prisdelen heter "Binfos värdering" (underrubrik "Binfos uppskattning utifrån lägenhetens egna uppgifter."). Utgångspris saknas i sammanfattningen och avvikelsemeningen visas inte                                                                                                                                                                                                       | –                             |
| Inga röda flaggor                                 | Inga flaggor                                                   | Delen visas inte alls                                                                                                                                                                                                                                                                                                                                                                    | –                             |
| Röda flaggor                                      | Finns flaggor                                                  | Högst två, svårast först, märkta "Hög risk", "Medelrisk" eller "Låg risk"                                                                                                                                                                                                                                                                                                                | –                             |
| Nyckeltal: god/acceptabel/svag/kritisk            | Nyckeltalet finns                                              | Kort med statusen "God", "Acceptabel", "Svag" eller "Kritisk"                                                                                                                                                                                                                                                                                                                            | –                             |
| Nyckeltal: ingen betygsatt status                 | Gäller bl.a. årsavgifternas andel av rörelseintäkter           | Kortet visas inte i rapporten                                                                                                                                                                                                                                                                                                                                                            | –                             |
| Nyckeltal: schablon / osäkert                     | Värde är uppskattat eller misstänkt                            | Märket "Schablon" respektive "Osäker" (med förklaring vid hovring)                                                                                                                                                                                                                                                                                                                       | –                             |
| Räntekänslighet markerad                          | Alltid för detta nyckeltal                                     | Märket "Viktigast här" och tonad ram                                                                                                                                                                                                                                                                                                                                                     | –                             |
| Övrig info saknas                                 | Inget finns                                                    | Delen "Övrig info" visas inte                                                                                                                                                                                                                                                                                                                                                            | –                             |
| Avgift ingår: framgår inte                        | Årsredovisningen är tyst                                       | "Framgår inte av årsredovisningen" per post (El, Bredband, Tv). Värme och vatten visas inte                                                                                                                                                                                                                                                                                              | –                             |
| Skannad rapport                                   | Källan var skannad                                             | Varningsruta "Skannad årsredovisning" med texten "Årsredovisningen var skannad; siffrorna är avlästa från sidbilderna och kan innehålla fel – kontrollera de viktigaste mot rapporten."                                                                                                                                                                                                  | –                             |
| Äldre version                                     | Äldre analys                                                   | Rad i rutan "Om extraktionens tillförlitlighet": "Analysen gjordes med en tidigare version av Binfo." och ev. "Det finns en nyare årsredovisning (<år>) analyserad för föreningen."                                                                                                                                                                                                      | –                             |
| Byggår: avviker                                   | Årsredovisningen anger annat år (mer än ±1 år) än det du angav | Märke "Avviker" och raden "Årsredovisningen anger <år>" (ditt år används ändå). Äldre sparade analyser: "Årsredovisningen: <år> (du angav <år>)"                                                                                                                                                                                                                                         | Kontrollera                   |
| Byggår: liten skillnad                            | ±1 år                                                          | Ingen märkning, bara raden "Årsredovisningen anger <år>"                                                                                                                                                                                                                                                                                                                                 | –                             |
| Byggår: osäkert                                   | Du angav inget och årsredovisningens år är osäkert läst        | Värdet "Okänt" med märket "Osäkert"; året används inte                                                                                                                                                                                                                                                                                                                                   | –                             |
| Byggår: från rapporten                            | Köparen angav inget                                            | Märke "Från årsredovisningen" eller "Värdeår enligt årsredovisningen". Okänt visas som "Okänt"                                                                                                                                                                                                                                                                                           | –                             |
| Våning okänd                                      | Våning saknas                                                  | "Okänt"                                                                                                                                                                                                                                                                                                                                                                                  | –                             |
| Värdering utan postnummer                         | Postnumret saknas eller är ogiltigt                            | "Binfos värdering — Inte tillgänglig — postnumret saknas eller är ogiltigt"                                                                                                                                                                                                                                                                                                              | Rätta postnummer i formuläret |
| Inom Stockholms län men utanför Stockholms kommun | Gäller kommuner i länet                                        | En metodrad: "Uppskattningen bygger på generella samband från Binfos Stockholmsmodell, skalade till genomsnittspriset i <plats>…"                                                                                                                                                                                                                                                        | –                             |
| Utanför Stockholms län                            | Postnummer utanför länet                                       | Varningsruta "Utanför Binfos täckningsområde": "Binfo är byggt för bostadsrätter i Stockholms län, och värderingsmodellen är tränad på försäljningar i Stockholm. Det här postnumret ligger utanför Stockholms län, så uppskattningen nedan bygger på generella samband från Stockholm och riksgenomsnittet för bostadsrätter… Den kan vara betydligt mindre träffsäker än i Stockholm." | Läsa                          |
| Låg tillförlitlighet                              | Värderingens säkerhet är låg                                   | Raden "Låg tillförlitlighet: <orsaker>"                                                                                                                                                                                                                                                                                                                                                  | –                             |
| Område okänt                                      | Postnumret saknas i områdesindelningen                         | "Stockholm (postnumret saknas i vår områdesindelning)"                                                                                                                                                                                                                                                                                                                                   | –                             |
| Prisjämförelse                                    | Utgångspris angivet                                            | Avvikelsemening, neutral eller röd (över) / grön (under)                                                                                                                                                                                                                                                                                                                                 | –                             |
| Justerat värde saknas                             | Ingen avgiftsprognos                                           | Raden "Värde med hänsyn till föreningens ekonomi utöver nuvarande avgift" visas inte                                                                                                                                                                                                                                                                                                     | –                             |
| Skuldfri förening                                 | Inga räntebärande skulder                                      | Texten om skuldfrihet i stället för skuldandel                                                                                                                                                                                                                                                                                                                                           | –                             |
| Lånet har förfallit                               | Lånets förfallodag har passerat                                | Radens text "– omsatt till villkor vi inte känner till", raden är tonad                                                                                                                                                                                                                                                                                                                  | –                             |
| Ränteställning: räntekänslighet saknas            | Nyckeltalet saknas                                             | "Räntekänslighet saknas i årsredovisningen, så avgiftsstressen kan inte beräknas." Reglaget är låst på +0. Högra rutan: "Inte möjligt att räkna då räntekänslighet saknas i rapporten."                                                                                                                                                                                                  | –                             |
| Ränteställning: flikar                            | Avgiftsprognos finns                                           | Flikar "Dagens avgift" / "Förväntad avgift" (förvald: "Dagens avgift"). Utan prognos visas inga flikar                                                                                                                                                                                                                                                                                   | Dra reglaget 0–3              |
| Avgiftstryck                                      | Prognos finns                                                  | "Inget tryck på avgiften" / "Visst tryck på avgiften" / "Tydlig avgiftshöjning väntas"                                                                                                                                                                                                                                                                                                   | –                             |
| Frågor                                            | Frågor finns                                                   | Kryssrutor med fråga, "Varför: …" och ev. "Bra svar: … / Varningssignal: …". Bockning stryker över frågan, men sparas inte                                                                                                                                                                                                                                                               | Bocka av                      |
| Ingen sammanfattning                              | Äldre rapport                                                  | Sammanfattningsdelen visas inte                                                                                                                                                                                                                                                                                                                                                          | –                             |
| PDF: skapar / fel                                 | Klick på "Ladda ner som PDF"                                   | "Skapar PDF…" (inaktiv). Fel: "Det gick inte att skapa PDF:en just nu. Försök igen om en liten stund."                                                                                                                                                                                                                                                                                   | Försöka igen                  |
| Kalkylknapp                                       | Klick på "Räkna på månadskostnaden"                            | Går till S6 förifyllt med avgift, räntekänslighet (om över 0), pris, boarea                                                                                                                                                                                                                                                                                                              | –                             |

---

### K2 Delad komponent: Spara-flödet

Gäller tre typer: värdering (S2), kalkyl (S6) och analys (S3, S4). Själva knapparnas olika texter: "Spara värderingen", "Spara kalkylen" / "Spara ändringarna" / "Spara som ny kalkyl", "Spara analysen".

| Tillstånd                              | När det inträffar                                 | Vad användaren ser                                                                                                                                                                                                                                                                                                                                                                                                               | Vad man kan göra             |
| -------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Session laddas                         | Sessionsfrågan pågår                              | Knappen är inaktiv                                                                                                                                                                                                                                                                                                                                                                                                               | Vänta                        |
| Utloggad                               | Ingen inloggning                                  | Knappen med tipset "Du behöver ett konto för att spara. Dina uppgifter finns kvar när du har loggat in." (visas inte på analyssidorna)                                                                                                                                                                                                                                                                                           | Trycka                       |
| Utkast sparas, skickar till inloggning | Klick utloggad                                    | Formulärets innehåll sparas i webbläsaren (sessionStorage med kopia i localStorage, 24 timmar, aldrig i adressen). För analys sätter servern också en signerad kaka som bevisar att just den här webbläsaren äger analysen (7 dagar). Användaren skickas till `/konto/logga-in?till=<sidan>&spara=<typ>`                                                                                                                         | Logga in eller skapa konto   |
| Kan inte spara utkast                  | Webbläsaren blockerar lagring                     | "Webbläsaren tillåter inte att vi tillfälligt sparar dina uppgifter. Logga in först och fyll sedan i uppgifterna igen." (analys: "Analysen kunde inte förberedas för att sparas. Ladda om sidan och försök igen.")                                                                                                                                                                                                               | Logga in och fylla i på nytt |
| Skapa konto i mellantiden              | Ny användare                                      | Registrera, bekräfta i mejlet (kan ske i ny flik, då hittas målet via utkastet), "Fortsätt och spara"                                                                                                                                                                                                                                                                                                                            | Följa flödet                 |
| Inloggad, sparar direkt                | Klick inloggad                                    | "Sparar…"                                                                                                                                                                                                                                                                                                                                                                                                                        | Vänta                        |
| Sparat                                 | Lyckat                                            | "Sparad i ditt konto." med "Se dina sparade uppgifter i Mitt konto" (analys: "Analysen är sparad i din profil." med "Se den i Mitt konto")                                                                                                                                                                                                                                                                                       | Gå till Mitt konto           |
| Redan sparad                           | Analysen finns i kontot                           | "Sparad i din profil." med "Mitt konto"                                                                                                                                                                                                                                                                                                                                                                                          | –                            |
| Fel                                    | Servern nekar                                     | Röd ruta med serverns text: "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen." / "Uppgifterna är ogiltiga. Kontrollera dem och försök igen." / "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där." / "För många försök, vänta en stund." / "Något gick fel hos oss. …" / vid kast: "Något gick fel. Försök igen om en stund." | Försöka igen                 |
| Sessionen gick ut                      | Under sparande                                    | Behandlas som utloggad: utkast skrivs, inloggning                                                                                                                                                                                                                                                                                                                                                                                | Logga in igen                |
| Återkomst                              | Sidan öppnas med `?spara=<typ>`                   | Utkastet läses, raderas, formuläret fylls i och sparas en gång. Lägen: "Logga in för att spara" (utloggad), "Utkastet finns inte kvar" (äldre än 24 timmar, annan webbläsare eller redan använt), "Sparar…", "Sparad…", "…kunde inte sparas: <text>"                                                                                                                                                                             | Se respektive sida           |
| Analys: efter e-postbekräftelse        | Konto skapat via mejlänk i samma webbläsare       | Enhetens anonyma historik slås inte ihop med kontot. Bara just den analysen flyttas, med hjälp av den signerade kakan                                                                                                                                                                                                                                                                                                            | –                            |
| Analys: efter lösenordsinloggning      | Inloggning med lösenord                           | Alla analyser som den här enheten gjort utan konto flyttas till kontot                                                                                                                                                                                                                                                                                                                                                           | –                            |
| Någon annans analys                    | Analysen tillhör annan enhet eller konto          | Ingen spara-knapp                                                                                                                                                                                                                                                                                                                                                                                                                | –                            |
| Kvot                                   | Sparande av värdering räknas mot värderingskvoten | "För många försök, vänta en stund."                                                                                                                                                                                                                                                                                                                                                                                              | Vänta                        |

Bakgrund för designern: utkastet gäller 24 timmar, den signerade analyskakan 7 dagar, och en analys kan bara sparas av webbläsaren som gjorde den (eller av kontot som redan äger den). Alla nekanden ger samma text ("Analysen kunde inte sparas i din profil. …") så att ett id inte avslöjar vems analys det är.

---

## 5. Användarresor från början till slut

Varje resa är numrerad steg för steg: vad användaren ser eller gör, och vad som händer. Förgreningar (fel och alternativa vägar) står som underpunkter märkta "Om …". Sidnamnen (S1–S19) är desamma som i avsnitt 1. Texter inom citattecken är exakt de som visas i gränssnittet.

### Resa A. Förstagångsbesökare: startsida → priskoll → resultat

1. Besökaren kommer till **startsidan** (S1) och ser rubriken "Säljaren har en mäklare. Nu har du Binfo." och knapparna "Analysera en bostad" och "Se köpguiden".
   - Om besökaren vill se vad som ingår först: länken "Se ett exempel på en rapport" öppnar S5 (Exempelrapport).
2. Klick på "Analysera en bostad" → **Analysera en bostad** (S2). Rubriken är "Analysera en bostad" med ingressen "Börja med en gratis priskoll…". Ingen inloggning krävs.
3. I kortet **"Steg 1: Priskoll"** fyller besökaren i: Boarea, Antal rum, Månadsavgift, Postnummer, Våning, (valfritt) Byggår och Utgångspris, samt de valfria valen Hiss och Balkong (ja / nej / okänt).
   - Under Postnummer kommer en områdestext medan man skriver. Länken "Vet du inte postnumret? Sök hos PostNord" öppnar PostNord i ny flik.
4. Klick på **"Se värderingen"** (knappen visar "Värderar…" under tiden).
   - Om något obligatoriskt fält saknas eller är ogiltigt: fälten markeras med fel, och texten bredvid knappen blir "Fyll i de obligatoriska fälten." Inget skickas.
   - Om servern nekar (till exempel "Du har gjort många prisuppskattningar på kort tid. Vänta en stund och försök igen."): en röd ruta "Det gick inte att göra värderingen" med serverns text.
   - Om något oväntat går fel: samma ruta med "Något gick fel. Försök igen om en stund."
5. Resultatet visas under formuläret som prisavsnittet (värdering avrundad till 10 000 kr med ett spann, jämförelse med utgångspriset om det angetts, faktorer, "Så har vi räknat").
6. Därefter får besökaren välja:
   - **Spara värderingen** (kortet "Spara värderingen") → se resa F.
   - **Fortsätta med steg 2** ("Vill du granska föreningen också? Fortsätt med steg 2 nedan") → resa B.
   - Gå till **Bolånekalkyl** eller **Köpguide** via sidhuvudet.
   - Ändra fälten och trycka "Se värderingen" igen.

### Resa B. Priskoll → steg 2 uppladdning → väntskärm → rapport

1. Efter priskollen (eller direkt) scrollar användaren till **"Steg 2: Granska föreningen (valfritt)"** på S2.
2. Användaren lägger in årsredovisningen i dropzonen "Dra och släpp årsredovisningen här, eller klicka för att välja fil" (PDF, max 25 MB). Filen visas som "● <filnamn> (<storlek>)" med knappen "Ta bort".
   - Om filen inte är en PDF: "Filen måste vara en PDF." Om den är för stor: "Filen är för stor. Max 25 MB." Filen tas inte emot och felet visas direkt.
3. Användaren fyller i **Adress** i kortet "Adress till objektet". Resten tas från steg 1 (Boarea, Våning, Månadsavgift, Antal rum, Postnummer måste alltså vara ifyllda).
4. Klick på **"Analysera"** (visar "Skickar in…"; sidtexten säger "Laddar upp och startar analysen…").
   - Om obligatoriska fält saknas (även i steg 1) eller filen saknas: fel markeras och texten blir "Fyll i de obligatoriska fälten, även i steg 1." Inget skickas.
   - Om servern avvisar uppladdningen visas en röd ruta med serverns text och en åtgärdsrad → se resa O.
   - Om nätverket fallerar: "Kunde inte skicka in analysen" / "Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och försök igen."
5. Vid lyckad uppladdning går webbläsaren automatiskt till **"Analys pågår / rapport"** (S3, `/forhandsvisning/<id>`). Rubriken är "Din analys pågår" med eyebrow "Analyserar".
   - Sidan visar nuvarande steg ("Identifierar föreningen…", "Läser av de skannade sidorna…" för skanningar, "Läser årsredovisningen…", "Hämtar de sju nyckeltalen…", "Analyserar föreningens ekonomi…"), en förloppsstapel och texten "Det här tar normalt 3–5 minuter" (för skannade rapporter "några minuter extra").
   - Sidan uppdaterar sig själv var femte sekund. Användaren kan lämna fliken öppen.
   - Om rapporten är skannad visas rutan "Skannad årsredovisning". Om samma årsredovisning redan analyseras av någon annan visas "Analyseras redan".
   - Om samma årsredovisning redan var analyserad blir analysen klar direkt, med rutan "Redan analyserad" ("Den här årsredovisningen var redan analyserad – din analys är klar direkt.").
   > **Känt fel:** Väntskärmen säger "3–5 minuter", men uppmätt tid är i regel 1–3 minuter.
6. När analysen är klar byter sidan till **hela rapporten** (rubrik "Din analys", eyebrow "Klar"): lägenhetens uppgifter, betyg, röda flaggor, föreningsekonomi, prisavsnittet, räntestress, frågor, sammanfattning. Längst ned: "Ladda ner som PDF" och "Räkna på månadskostnaden" (→ resa L). Dessutom kan analysen sparas (→ resa F).
   - Om analysen misslyckas: skärmen "Analysen kunde inte slutföras" med rubrik efter orsak (till exempel "Årsredovisningen går inte att läsa maskinellt", "Tillfälligt tekniskt stopp", "Dagens gräns är nådd", "Gränsen är nådd för tillfället") och knappen "Till formuläret".
   - Om id:t inte finns: "Vi hittar ingen analys med det här id:t" med knappen "Starta en ny analys".
   - Om rapporten blivit klar men inte kan läsas: "Något gick fel".

### Resa C. Från BRF-registret till analys utan uppladdning

1. Användaren klickar "BRF-register" i sidhuvudet → **BRF-registret** (S8): rubrik "Bostadsrättsföreningar i Stockholm".
2. Två vägar:
   - **Sök:** skriver namn eller organisationsnummer i "Sök förening" och trycker "Sök". Träfflistan visas ovanför områdena; "Rensa" tömmer sökningen. Inga träffar ger texten `Inga föreningar matchar "<sök>"…`.
   - **Område:** klickar ett områdeskort (till exempel under "Innerstaden", "Söderort" eller "Västerort") → **Område i registret** (S9) med en sorterbar tabell (kolumnerna Betyg, Skuld per m² bostadsrättsyta, Årsavgift per m², Sparande per m², Analysdatum), sökfältet "Sök i <område>" och sidknapparna "Föregående" / "Nästa". Tomt område visar "Inga föreningar här ännu — ladda upp en årsredovisning så hamnar föreningen här." med knappen "Analysera en bostad".
3. Klick på en förening → **Föreningssida** (S10): betyg, de sju nyckeltalen med sidhänvisning ("s. <sida>"), tabellen "Nyckeltal per år" om äldre år finns.
   - Om föreningen inte finns: "Föreningen finns inte i registret" med länken "Sök i BRF-registret".
   - Om den har bytt namn: webbläsaren flyttas automatiskt till den nya adressen.
   - Vill användaren veta varför betyget blev som det blev: knappen "Se hela analysen för varför föreningen fick betyget <betyg>" (eller ett årtal i tabellen) → **Föreningens fullständiga analys** (S11) med motivering, flaggor och frågor till styrelsen. Om åtkomst nekas visas "Analysen är inte tillgänglig just nu" med länken "Tillbaka till föreningens sammanfattning".
4. Användaren klickar **"Analysera en lägenhet i föreningen"** (kortet "Köper du i den här föreningen?") → **S2** med `?forening=<förening>`.
5. På S2 hämtas föreningen ("Hämtar föreningen från registret…"). Steg 2 visar kortet **"Föreningens årsredovisning finns redan hos Binfo"** med föreningens namn, räkenskapsår och analysdatum. Ingen uppladdning behövs.
   - Om föreningen inte hittas eller inte kan hämtas: rutan "Vi hittade inte föreningen i registret" eller "Vi kunde inte hämta föreningen just nu" och vanlig uppladdning ("Ladda upp föreningens årsredovisning nedan i stället.").
   - Länken "Ladda upp en annan årsredovisning i stället" växlar tillbaka till vanlig uppladdning.
6. Användaren fyller i steg 1 (lägenhetens uppgifter) och **Adress**, och trycker "Analysera". Texten bredvid säger "Föreningens analys finns redan — du får din rapport direkt." Knappen visar "Skickar in…" och texten "Skapar din analys…".
7. Webbläsaren går till S3. Rapporten är klar direkt (ingen uppladdning, inget AI-anrop) och visas med den lägenhetsspecifika delen (pris, månadskostnad, räntestress).
   - Om registerrapporten är gjord med en äldre version eller inte kan läsas: se resa N och O (köas bara om man laddar upp själv).

### Resa D. Booli-länk → förifyllt formulär

> **Notis:** Funktionen finns live men Booli blockerar Binfos server i produktion. I praktiken slutar steg 3 med felmeddelandet "Vi kunde inte hämta uppgifterna, fyll i manuellt." Beskrivningen visar hur den är tänkt att fungera.

1. På S2, i kortet ovanför steg 1, klistrar användaren in en annonslänk i fältet **"Klistra in länk från Booli"** (platshållare `https://www.booli.se/annons/…`, valfritt).
2. Användaren trycker **"Hämta uppgifter"** (eller Enter). Knappen visar "Hämtar…".
3. Utfall:
   - **Lyckad hämtning:** formuläret fylls i (Boarea, Antal rum, Månadsavgift, Postnummer, Våning, Byggår, Utgångspris, Adress, hiss/balkong som "ja" när annonsen anger det). Fält som kom från annonsen får texten "Hämtat från Booli" (och "Ändrat manuellt" om användaren ändrar dem). Ett postnummer som slagits upp via OpenStreetMap markeras så. Fält som saknades i annonsen får "Fanns inte i annonsen, fyll i själv" och en varningsram. Hjälptexten blir "Uppgifterna är ifyllda nedan. Kontrollera dem innan du går vidare."
   - **Fel länk (inte Booli):** "Endast Booli-länkar stöds just nu." eller "Länken går inte till en bostadsannons på Booli. Kopiera adressen från annonsens sida, t.ex. https://www.booli.se/annons/1234567."
   - **Misslyckad hämtning (det vanliga i produktion):** "Vi kunde inte hämta uppgifterna, fyll i manuellt."
   - **Funktionen avstängd:** "Hämtning från Booli är tillfälligt avstängd, fyll i manuellt."
   - **För många hämtningar:** "Du har hämtat många annonser på kort tid. Vänta en stund eller fyll i manuellt."
4. Hämtningen startar aldrig någon värdering eller analys. Användaren kontrollerar fälten och fortsätter med resa A eller B. Annonskällan följer med analysen om användaren går vidare.

### Resa E. Skapa konto → mejl → bekräfta → Mitt konto

1. Användaren klickar "Logga in" i sidhuvudet → **Logga in** (S13) och väljer länken "Skapa konto" under "Har du inget konto?" → **Skapa konto** (S14). (Från ett sparaflöde följer `till` och `spara` med.)
2. Användaren fyller i **E-postadress** och **Lösenord** (hjälptext "Minst 10 tecken.") och trycker **"Skapa konto"** (visar "Skapar konto…"). Länken "integritetspolicyn" öppnar S18.
   - Om lösenordet är för kort: "Lösenordet måste vara minst 10 tecken."
   - Om servern avvisar (till exempel för enkelt lösenord): serverns text i en röd ruta.
3. Sidan byter till **"Kolla din e-post"**: "Om adressen <epost> går att använda har vi skickat ett mejl med en länk för att bekräfta kontot…". Sidan avslöjar medvetet inte om adressen redan finns. Användaren får ett mejl med en länk.
4. Användaren öppnar länken (ofta i en ny flik) → **Bekräfta e-post** (S16): "Bekräfta din e-postadress" med knappen **"Bekräfta e-postadressen"** (visar "Kontrollerar…"). Länken förbrukas först när knappen trycks.
   - Om länken är ofullständig: "Länken fungerar inte" och länken "Till inloggningen".
   - Om länken är ogiltig eller utgången: röd ruta ("Länken är ogiltig eller har gått ut. …") och länken "Till inloggningen".
5. Lyckat: **"Kontot är bekräftat"** – "Din e-postadress är bekräftad och du är inloggad." – med knappen "Fortsätt" (eller "Fortsätt och spara" om ett sparande väntar). Knappen går till `till`, eller till sidan som utkastet pekar ut, annars **Mitt konto** (S12).
6. Den första fliken (som visade "Kolla din e-post") uppdaterar sin session när den får fokus och går själv vidare till `till`/Mitt konto. Länken "Redan bekräftat? Logga in" finns som reserv.

### Resa F. Utloggad trycker Spara → logga in eller skapa konto → tillbaka och sparat

Gemensamt: utloggad trycker en Spara-knapp. Webbläsaren sparar ett utkast (det användaren fyllt i) i webbläsarens lagring (högst ett dygn) och skickar användaren till inloggningen med `till` (sidan man kom från) och `spara` (vad som ska sparas).

- Om webbläsaren inte tillåter lagring av utkastet: "Webbläsaren tillåter inte att vi tillfälligt sparar dina uppgifter. Logga in först och fyll sedan i uppgifterna igen." och ingen omdirigering.
- Bredvid knappen står för utloggade: "Du behöver ett konto för att spara. Dina uppgifter finns kvar när du har loggat in."

**F1. Spara värdering (S2).**

1. Efter priskollen: kortet "Spara värderingen". Valfritt fält "Namn" ("Till exempel adressen"). Knappen **"Spara värderingen"**.
2. Inloggad: sparas direkt; rutan blir "Sparad i ditt konto." med länken "Se dina sparade uppgifter i Mitt konto". Fel (till exempel "Du har nått gränsen för antal sparade objekt. Ta bort något och försök igen.") visas under knappen.
3. Utloggad: omdirigeras till **Logga in** (S13) med ingressen "Logga in för att spara. Dina uppgifter finns kvar när du kommer tillbaka." Användaren loggar in (eller skapar konto via "Skapa konto", resa E).
4. Tillbaka på S2 (`?spara=vardering`) fylls formuläret i från utkastet, värderingen sparas och körs, och en ruta säger "Sparar din värdering…" och därefter **"Din värdering är sparad i ditt konto."** med länken "Se den i Mitt konto".
   - Om utkastet inte finns kvar (äldre än ett dygn eller annan webbläsare): "Utkastet finns inte kvar" – fyll i igen och tryck Spara.
   - Om uppgifterna inte längre är kompletta: "Uppgifterna du fyllde i är inte kompletta längre." och felmarkering.
   - Om användaren inte hunnit logga in: "Logga in för att spara" med länken "Logga in".
   - Annat fel: "Värderingen kunde inte sparas: <orsak>".

**F2. Spara kalkyl (S6).**

1. Längst ned: valfritt fält "Namn på kalkylen" och knappen **"Spara kalkylen"** (efter första sparningen "Spara ändringarna", plus "Spara som ny kalkyl"). Knapparna visas först efter att sidan laddats.
2. Utloggad: samma utkast/inloggning som F1, tillbaka till `/bolanekalkyl?spara=kalkyl`.
3. Tillbaka: fälten fylls i, kalkylen sparas, rutan "Din kalkyl är sparad i ditt konto." med "Se den i Mitt konto" visas. Alternativ: "Utkastet finns inte kvar", "Logga in för att spara", "Kalkylen kunde inte sparas: <orsak>".

**F3. Spara analys (S3/S4).**

1. I rapporten visas knappen **"Spara analysen"** i en rad under betygskortet och ett kort "Spara analysen i din profil" längst ned ("Logga in eller skapa ett konto, så hittar du tillbaka till analysen under Mitt konto. Du kommer tillbaka hit och analysen görs inte om."). Knappen visas bara för analysen som skapades i den egna webbläsaren eller kontot; för någon annans analys visas ingenting.
2. Utloggad: via inloggning/skapa konto och tillbaka till samma analys med `?spara=analys`.
3. Tillbaka: "Sparar analysen…" och sedan **"Analysen är sparad i din profil."** med "Se den i Mitt konto". Redan sparad analys visar "Sparad i din profil. Mitt konto".
   - Om analysen inte kan flyttas till kontot (till exempel skapad i en annan webbläsare): "Analysen kunde inte sparas i din profil. Öppna den i webbläsaren där du gjorde analysen och tryck på Spara analysen där."
   - Ingen ny körning och inget AI-anrop görs.

### Resa G. Logga in → Mitt konto → öppna eller ta bort sparat

1. Användaren klickar "Logga in" → **Logga in** (S13): fält "E-postadress", "Lösenord", knappen **"Logga in"** (visar "Loggar in…").
   - Fel inloggning: röd ruta "Fel e-postadress eller lösenord."
   - Obekräftad e-post: "E-postadressen är inte bekräftad ännu. Klicka på länken i bekräftelsemejlet först."
   - För många försök: "För många försök, vänta en stund."
   - Länken "Glömt lösenordet?" → resa H.
2. Lyckat: webbläsaren går till `till` (annars Mitt konto). Sidhuvudets knapp byter till "Mitt konto".
3. **Mitt konto** (S12), "Inloggad som <epost>." Tre kort:
   - **Analyser:** varje rad visar datum, föreningsnamn (eller "Förening ej identifierad"), status ("Pågår", "Klar", "Misslyckades"), "Betyg X", adress, räkenskapsår, utgångspris.
     - "Öppna" → rapporten (S4) om klar, annars väntskärmen (S3).
     - "Ta bort från listan" → dialogen "Ta bort analysen från din lista?" (analysen försvinner från listan och lägenhetens adress och pris raderas; föreningsrapporten finns kvar; länken slutar fungera) med "Avbryt" och "Ta bort från listan".
   - **Värderingar:** rader med datum, namn (eller "Postnummer <nr>"), värdering, boarea, utgångspris. "Öppna" → S2 med `?sparad=<id>`: visar den sparade värderingen med knappen **"Räkna om med dagens modell"** ("Omräknat med dagens modell") och länkarna "Gör en ny värdering" och "Till Mitt konto". En värdering i äldre format visar "Kan inte öppnas" eller "Kan inte visas som den sparades". "Radera" → dialogen "Radera värderingen?" ("Den sparade värderingen raderas permanent. Det går inte att ångra.").
   - **Bolånekalkyler:** rader med datum, namn (eller "Bolånekalkyl") och sammanfattning. "Öppna" → S6 med `?sparad=<id>` (rutan "Öppnad från ditt konto"; "Spara ändringarna" uppdaterar den, "Spara som ny kalkyl" skapar en kopia). Exportknappar (PDF/Excel) för den sparade kalkylen. "Radera" → dialogen "Radera kalkylen?".
   - Tom lista visar en förklarande text med knapp ("Analysera en bostad", "Gör en priskoll", "Öppna bolånekalkylen").
   > **Känt fel:** Bekräftelsedialogen visar "Tar bort…" medan en borttagning pågår, även för radering av värdering, kalkyl och konto.
4. Fel i listorna: röd ruta med meddelandet och knappen "Försök igen"; under hämtning "Hämtar dina sparade uppgifter…".
5. Är sessionen utgången: Mitt konto skickar tillbaka till inloggningen (`till=/konto`).

### Resa H. Glömt lösenord → mejl → nytt lösenord

1. På S13 klickar användaren "Glömt lösenordet?" → **Glömt lösenord** (S15): "Ange e-postadressen till ditt konto så skickar vi en länk för att välja ett nytt lösenord."
2. Användaren fyller i "E-postadress" och trycker **"Skicka återställningslänk"** (visar "Skickar…").
3. Formuläret ersätts av "Om adressen finns skickar vi ett mejl med en länk för att välja nytt lösenord. Länken gäller en begränsad tid. Titta även i skräpposten." (samma svar oavsett om adressen finns). Länken "Tillbaka till inloggning" finns kvar. Användaren får ett mejl med en länk.
4. Länken öppnar **S16**: "Välj nytt lösenord" med knappen **"Fortsätt"**.
   - Ogiltig, utgången eller redan använd länk: röd ruta och länken "Begär en ny länk" (tillbaka till S15).
5. Efter "Fortsätt" loggas användaren in och går direkt till **Välj nytt lösenord** (S17): fält "Nytt lösenord" (minst 10 tecken), knappen **"Spara nytt lösenord"** (visar "Sparar…"). Återställningslänken räknas som bevis på ägandet, så fältet "Nuvarande lösenord" krävs inte.
   - För kort lösenord: "Lösenordet måste vara minst 10 tecken."
6. Lyckat: **"Lösenordet är ändrat"** – "Ditt nya lösenord gäller från och med nu." – och länken "Till Mitt konto".

### Resa I. Byta lösenord som inloggad

1. I **Mitt konto**, kortet "Konto", knappen **"Byt lösenord"** → **Välj nytt lösenord** (S17) med `?nuvarande=ja`.
2. Sidan visar fälten "Nuvarande lösenord" och "Nytt lösenord". Användaren trycker "Spara nytt lösenord".
   - Fel nuvarande lösenord: röd ruta med servertexten.
   > **Känt fel:** Vid fel nuvarande lösenord visas "Fel e-postadress eller lösenord." (samma text som vid inloggning), trots att ingen e-postadress fylls i här.
   - Kortare än 10 tecken: "Lösenordet måste vara minst 10 tecken."
   - Utgången session: omdirigeras till inloggningen med återvändo hit.
3. Lyckat: "Lösenordet är ändrat" och "Till Mitt konto".

### Resa J. Ladda ner mina uppgifter

1. I **Mitt konto**, kortet "Konto", knappen **"Ladda ner mina uppgifter"**.
2. Knappen visar "Hämtar…". Servern samlar användarens sparade uppgifter.
3. Webbläsaren laddar ner en JSON-fil som heter `binfo-mina-uppgifter-<ÅÅÅÅ-MM-DD>.json`.
   - Vid fel visas en röd ruta ovanför listorna (serverns text eller "Något gick fel. Försök igen om en stund.").

### Resa K. Radera konto

1. I **Mitt konto**, avsnittet "Radera konto" (röd rubrik): "Raderar kontot och allt som är sparat i det: dina värderingar, bolånekalkyler och analyslistan. Föreningsrapporterna finns kvar i Binfos register. Det går inte att ångra."
2. Användaren trycker **"Radera mitt konto"** → dialogen "Radera kontot?": "Ange ditt lösenord för att bekräfta. Kontot och allt sparat i det raderas." med fältet "Lösenord" och knapparna "Avbryt" och "Radera kontot" (visar "Tar bort…").
   - Fel lösenord: felet visas i dialogen, som förblir öppen.
   - "Avbryt" stänger utan åtgärd.
3. Lyckat: sessionen töms och användaren skickas till **startsidan** (S1). Sidhuvudets knapp är åter "Logga in".

(Utloggning utan radering: knappen **"Logga ut"** i samma kort loggar ut och går till startsidan.)

### Resa L. Rapport → bolånekalkyl (förifyllt) → spara kalkyl / exportera

1. I en rapport (S3, S4 eller S5) trycker användaren **"Räkna på månadskostnaden"** (längst ned).
2. **Bolånekalkyl** (S6) öppnas förifylld med månadsavgift, boarea, pris (som lån på priset minus minsta kontantinsats 10 %) och föreningens räntekänslighet. Hjälptexterna säger "Förifylld från din analys — ändra om avgiften har uppdaterats." och "Förifyllt utifrån priset i din analys, med minsta kontantinsats (10 %) — ändra om beloppet inte stämmer." (när priset är en uppskattning står det så).
3. Användaren kompletterar: Lånebelopp, Kontantinsats, Ränta, Månadsavgift, Boarea, Antal personer i hushållet, "Antal låntagare" (1 eller 2), "Låntagare 1: bruttoinkomst per år" (och 2). I "Vad ingår i avgiften?" väljs Ingår / Ingår ej / Vet ej per post (värme och vatten förvalda som "Ingår").
   - Saknas boarea eller inkomst visas "—" för det som inte kan räknas. "Vet ej" ger en total som spann.
   - Boxen "Amorteringskravet" visar belåningsgrad, skuldkvot och amorteringstakt enligt reglerna från 1 april 2026.
4. Under "Fördjupning: räntescenarier och bankens kalkyl (valfritt)" (öppnas automatiskt om bankens kalkyl-fält ändrats): "Om räntan ändras", "Bankens kalkyl (KALP)" och "Kvar att leva på enligt bankens kalkyl", samt "Regler och antaganden".
5. Export: knapparna för PDF och Excel ("laddar ner kalkylen som PDF" respektive Excel) ligger i åtgärdsraden. De fungerar utan konto.
6. Spara: valfritt "Namn på kalkylen" och "Spara kalkylen" → resa F2 om man är utloggad, annars sparas den direkt ("Sparad i ditt konto.").
7. Kalkylen kan också nås utan rapport (från "Bolånekalkyl" i sidhuvudet eller startsidan); då är alla fält tomma med grå exempel ("t.ex. …").
8. Exporten av själva rapporten (PDF) sker med **"Ladda ner som PDF"** i rapporten (visar "Skapar PDF…"; vid fel "Det gick inte att skapa PDF:en just nu. Försök igen om en liten stund.").

### Resa M. Köpguiden steg för steg

1. Användaren klickar "Köpguide" i sidhuvudet (eller "Se köpguiden"/"Öppna köpguiden" på startsidan) → **Köpguide** (S7): "Hela bostadsköpet, steg för steg".
2. Överst visas "<n> av 12 steg klara" och en förloppsstapel. Stegen är grupperade i "Före budgivningen", "Affären" och "Fram till och efter tillträdet".
3. Första steget ("Förberedelse & lånelöfte") är öppet. Klick på ett stegs rubrik öppnar det (bara ett öppet åt gången; klick igen stänger). Det öppna steget visar en beskrivning, rutan "Viktiga flaggor" och rutan "Tips".
4. Knappen **"Markera klar"** på ett steg byter till "Klar", fyller tidslinjens prick och uppdaterar räknaren och stapeln. Klick igen tar bort markeringen.
   - Avbockningar ligger bara i sidans minne. Laddas sidan om är allt återställt, och inget sparas på kontot.
5. Länkar i tipsen: "Räkna på din månadskostnad här" (steg 1 och 9, → S6) och "Analysera föreningen här" (steg "Granska föreningens ekonomi", → S2). De laddar om sidan helt.
6. Stegen i ordning: Förberedelse & lånelöfte; Sök & bevaka objekt; Visning; Granska föreningens ekonomi; Budgivning; Vinnande bud & överenskommelse; Kontrakt/Överlåtelseavtal; Handpenning; Ansök om bolån & bind eller ha rörlig ränta; Medlemskap i föreningen; Tillträde & slutbetalning; Efter tillträde.
   > **Känt fel:** Texten i steget "Medlemskap i föreningen" är avhuggen ("…bostadsrättslagen,vanligtvis inom några veckor. U").

### Resa N. Öppna en gammal analyslänk eller ett bokmärke

1. Användaren öppnar `/analys/<id>` (bokmärke, delad länk eller "Öppna" i Mitt konto) eller `/forhandsvisning/<id>`.
2. Beroende på analysens läge:
   - **Klar:** rapporten visas (S4 direkt, eller S3 efter att ha hämtats). Är det en återanvänd analys visas "Redan analyserad" på S3.
   - **Pågår fortfarande:** S4 omdirigerar till S3, som visar "Din analys pågår" och uppdaterar sig tills den är klar.
   - **Misslyckad:** S4 omdirigerar till S3, som visar "Analysen kunde inte slutföras" med orsaken och knappen "Till formuläret". Rubriken beror på orsaken (se resa B).
   - **Okänt eller borttaget id** (till exempel efter "Ta bort från listan"): S3 visar "Vi hittar ingen analys med det här id:t" och knappen "Starta en ny analys".
   - **Äldre version av Binfo:** rapporten visas som den sparades (med betyget den fick) och en notering om att den gjordes med en tidigare version. Går den inte att läsa med dagens kod (schemat har ändrats) och ingen ny körning finns, visas "Analysen gjordes med en tidigare version av Binfo och behöver göras om. Ladda upp årsredovisningen igen." Att öppna en länk startar aldrig en ny körning; en ny körning köas först när någon laddar upp årsredovisningen igen eller begär föreningen via registret.
   - **Indragen rapport:** "Analysen av den här årsredovisningen har dragits tillbaka. Ladda upp den igen, så görs en ny analys."
   - **Versionskonflikt under körning:** "Binfo uppdaterades medan din analys väntade i kön. Ladda upp årsredovisningen igen om en stund, så körs den med den senaste versionen."
   - **Registeranalys i föreningsregistret:** gamla föreningsadresser omdirigeras till den nya; äldre analysers version märks med "Analysen gjordes med en tidigare version av Binfo."
3. Ingen inloggning krävs för att läsa en analys. Den som har länken ser den.

### Resa O. Uppladdning som nekas

Alla dessa visas på S2 i den röda rutan under "Adress till objektet" (rubrik + serverns text + en åtgärdsrad), eller som fel på filen. Inget jobb skapas.

1. **Fel filtyp:** direkt vid val av fil: "Filen måste vara en PDF." Filen tas inte emot. Servern kontrollerar också och kan svara "Filen verkar inte vara en PDF."
2. **För stor fil:** direkt: "Filen är för stor. Max 25 MB." Servern: "Filen är för stor (max 25 MB)."
3. **Ingen fil vald:** vid "Analysera" visas filfelet och "Fyll i de obligatoriska fälten, även i steg 1."
4. **Saknade uppgifter:** fältfel markeras; inget skickas.
5. **Kvot (för många uppladdningar):** rubriken "Gränsen är nådd för tillfället" med texten till exempel "Du har nått dagens gräns för antal analyser. Försök igen i morgon." eller "Dagens gräns för antal analyser från ditt nätverk är nådd. Försök igen i morgon." eller varianter om att många uppladdningar gjorts, även av redan analyserade rapporter. Åtgärd: "Vänta och försök igen senare."
6. **Dagens gräns för hela tjänsten:** rubriken "Dagens gräns är nådd" med "Dagens gräns för antal analyser är nådd. Det är tillfälligt — försök igen imorgon." Åtgärd: "Försök igen imorgon." (Gäller inte om samma fil redan är analyserad: den serveras gratis ur registret.)
7. **Paus:** rubriken "Något gick fel" med "Analyser är tillfälligt pausade av driftskäl. Försök igen senare, eller kontakta oss."
8. **Skannad årsredovisning med för många sidor (över 60):** rubriken "Årsredovisningen går inte att läsa maskinellt" med "Den skannade årsredovisningen har fler sidor än vi kan läsa av just nu. Ladda gärna upp en digital version (med textlager) av årsredovisningen." Åtgärd: be om den digitala originalfilen.
9. **Skannad som inte går att läsa av:** samma rubrik med "Vi kunde inte läsa av de skannade sidorna tillförlitligt. Försök gärna med en digital version av årsredovisningen."
10. **Kostnadsgräns per rapport:** rubriken "Tillfälligt tekniskt stopp" med text om att den uppskattade kostnaden överstiger vad som tillåts just nu.
11. **Behörighet saknas:** rubriken "Ingen tillgång just nu".
12. **Nätverksfel:** "Kunde inte skicka in analysen" / "Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och försök igen."
13. **Fel som uppstår efter att jobbet skapats** (under körningen) visas inte i formuläret utan på väntskärmen S3 som "Analysen kunde inte slutföras" (se resa B).

---

## 6. Checklista

Bocka av varje rad när den finns i den nya designen. Raderna följer avsnitt 1–5.

### 6.1 Sidor och vägar in

#### Sidor (en rad per sida)

- [ ] G1 Sidhuvud: logotyp "Binfo", länkarna "Analysera", "BRF-register", "Bolånekalkyl", "Köpguide", kontoknapp "Logga in" / "Mitt konto", aktiv sida markerad, ingen mobilmeny
- [ ] G1 Sidfot: "Binfo", beslutsstödstext, länken "Integritet och personuppgifter" (enda länken)
- [ ] S1 Startsida `/`: hero, exempelruta, tre frågor, köpguide-teaser, oberoende-text
- [ ] S2 Analysera en bostad `/analysera`: Booli-kort, Steg 1 Priskoll, Steg 2 Granska föreningen, adresskort
- [ ] S2 Registerläge `?forening=`
- [ ] S2 Sparad värdering `?sparad=`
- [ ] S3 Analys pågår / rapport `/forhandsvisning/$analysisId`
- [ ] S4 Rapport (bokmärkeslänk) `/analys/$analysisId`
- [ ] S5 Exempelrapport `/exempel`
- [ ] S6 Bolånekalkyl `/bolanekalkyl`
- [ ] S7 Köpguide `/kopguide`
- [ ] S8 BRF-registret `/brf`
- [ ] S9 Område i registret `/brf/omrade/$omrade`
- [ ] S10 Föreningssida `/brf/$slug`
- [ ] S11 Föreningens fullständiga analys `/brf/$slug/analys/$ar`
- [ ] S12 Mitt konto `/konto`
- [ ] S13 Logga in `/konto/logga-in`
- [ ] S14 Skapa konto `/konto/skapa`
- [ ] S15 Glömt lösenord `/konto/glomt-losenord`
- [ ] S16 Bekräfta e-post `/konto/bekrafta`
- [ ] S17 Välj nytt lösenord `/konto/nytt-losenord`
- [ ] S18 Integritet `/integritet`
- [ ] S19 `/vardering` → `/analysera` (permanent, bär `sparad` och `spara`)
- [ ] S19 `/guide` → `/kopguide` (permanent)
- [ ] S19 404-sida (med "Till startsidan")
- [ ] S19 Felsida i webbläsaren ("Försök igen", "Till startsidan")
- [ ] S19 Fristående serverfelsida
- [ ] S19 `/sitemap.xml` och `robots.txt`
- [ ] Registrets egna 404-rutor: område, förening, analys

#### Åtkomst och sökmotorer

- [ ] Kräver inloggning (klientkontroll): Mitt konto, Välj nytt lösenord, sparad värdering, sparad kalkyl
- [ ] Vem som helst med länken: S3, S4 (hemligt id)
- [ ] `noindex`: S3, S4, S11, S12–S17
- [ ] Offentliga och cache-bara utan cookies: S8, S9, S10
- [ ] Öppna för sökmotorer men inte i sajtkartan: S18
- [ ] Inget admin-UI (sägs en gång)
- [ ] Behörighetsstyrd åtkomst S11 ("Analysen är inte tillgänglig just nu")

#### Vägar in (S2)

- [ ] Sidhuvud "Analysera"
- [ ] Startsida "Analysera en bostad", "Granska föreningen", "Kolla priset"
- [ ] Köpguide "Analysera föreningen här"
- [ ] Exempel "Ladda upp en årsredovisning"
- [ ] Integritet "Analysera"
- [ ] S10/S11 "Analysera en lägenhet i föreningen" (`?forening=`)
- [ ] Tomt register "Analysera en bostad"
- [ ] Mitt konto "Analysera en bostad", "Gör en priskoll", "Öppna" (`?sparad=`)
- [ ] Felskärmar "Till formuläret", "Starta en ny analys"
- [ ] "Gör en ny värdering" på sparad värdering
- [ ] Efter inloggning `?spara=vardering`
- [ ] "Ladda upp en annan årsredovisning i stället"

#### Vägar in (övriga sidor)

- [ ] S3: efter "Analysera", omdirigering från S4, konto-"Öppna" (ej klar), bokmärke
- [ ] S4: konto-"Öppna" (klar), bokmärke, `?spara=analys`
- [ ] S5: bara "Se ett exempel på en rapport" på startsidan
- [ ] S6: sidhuvud, startsida "Räkna på månadskostnaden", köpguide "Räkna på din månadskostnad här", rapportknapp "Räkna på månadskostnaden", konto "Öppna bolånekalkylen"/"Öppna", `?spara=kalkyl`
- [ ] S7: sidhuvud, startsida "Se köpguiden"/"Öppna köpguiden"/exempelrutans länk, `/guide`
- [ ] S8: sidhuvud, brödsmulor, "Till BRF-registret", "Sök i BRF-registret", integritet "BRF-registret", sajtkarta
- [ ] S9: områdeskort på S8, brödsmula, sajtkarta
- [ ] S10: träfflista/tabell/kort, "Tillbaka till <namn>", "Till föreningens sida", sajtkarta
- [ ] S11: "Se hela analysen för varför föreningen fick betyget <betyg>", årtal i "Nyckeltal per år"
- [ ] S12: "Mitt konto", "Se den i Mitt konto", "Till Mitt konto", integritet "Mitt konto", standardmål efter inloggning
- [ ] S13: "Logga in", automatisk omdirigering, "Redan bekräftat? Logga in", "Till inloggningen", "Tillbaka till inloggning"
- [ ] S14: "Skapa konto" på S13
- [ ] S15: "Glömt lösenordet?", "Begär en ny länk"
- [ ] S16: bara via mejllänk
- [ ] S17: "Byt lösenord", "Fortsätt" efter återställning
- [ ] S18: sidfot, "integritetspolicyn" på S14

#### Adressparametrar

- [ ] `/analysera`: `forening`, `sparad`, `spara`, sju förifyllningsfält, ankaret `#vet-ej`
- [ ] `/forhandsvisning` och `/analys`: `spara=analys`
- [ ] `/bolanekalkyl`: `manadsavgift`, `boarea`, `pris`, `rantekanslighet`, `prisUppskattning`, `sparad`, `spara`
- [ ] `/brf` och `/brf/omrade`: `sok`, `sortering`, `riktning`, `sida`
- [ ] `/konto/logga-in` och `/konto/skapa`: `till`, `spara`
- [ ] `/konto/bekrafta`: `token_hash`, `type`, `till`, `spara`
- [ ] `/konto/nytt-losenord`: `nuvarande=ja`
- [ ] `till` släpper bara in Binfos egna adresser

#### Kända fel att bevara i dokumentet

- [ ] Döda ankarlänkar i startsidans exempelruta
- [ ] "Tolv steg" / "4 av 12" på startsidan
- [ ] Avhuggen text i steget "Medlemskap i föreningen"
- [ ] Fel hjälptext på kalkylens Boarea / Antal personer
- [ ] Ingen kontaktadress ("kontakta oss", "Kontakta oss.")
- [ ] Booli blockeras i produktion

### 6.2 Handlingar per sida

#### G1 Sidhuvud och sidfot

- [ ] Logotyp "Binfo" (länk till startsidan)
- [ ] Länk "Analysera"
- [ ] Länk "BRF-register"
- [ ] Länk "Bolånekalkyl"
- [ ] Länk "Köpguide"
- [ ] Knapp-länk "Logga in" (utloggad)
- [ ] Knapp-länk "Mitt konto" (inloggad), reserverad plats medan sessionen hämtas
- [ ] Aktiv sida markeras i länkraden
- [ ] Ingen mobilmeny (länkraden bryts)
- [ ] Sidfot: text om oberoende/beslutsstöd
- [ ] Sidfot: länk "Integritet och personuppgifter"

#### S1 Startsida

- [ ] Knapp-länk "Analysera en bostad"
- [ ] Knapp-länk "Se köpguiden"
- [ ] Länk "Se ett exempel på en rapport"
- [ ] Märket "Oberoende beslutsstöd" och rubriken "Säljaren har en mäklare. Nu har du Binfo."
- [ ] Exempelruta "2 rok på Södermalm" (flik "Exempel", fakta, påhittade siffror)
- [ ] Exempelrad "Föreningen" (länk till ankare #foreningen)
- [ ] Exempelrad "Priset" (länk till #priset)
- [ ] Exempelrad "Månadskostnad" (länk till #kostnaden)
- [ ] Exempelrad "Har du råd?" (länk till #kostnaden)
- [ ] Ruta "Din gräns i budgivningen"
- [ ] Rad "Köpguiden: nästa steg är budgivningen" ("4 av 12", länk)
- [ ] Anmärkning "Exempel med påhittade siffror…"
- [ ] Kort "Är föreningen frisk?" med länk "Granska föreningen"
- [ ] Kort "Är priset rimligt?" med länk "Kolla priset"
- [ ] Kort "Har jag råd med just den här?" med länk "Räkna på månadskostnaden"
- [ ] Kort "Och resten av köpet?…" med knapp-länk "Öppna köpguiden"
- [ ] Sektion "Vi tjänar ingenting på att du köper."
- [ ] Känt fel: döda ankarlänkar #foreningen, #priset, #kostnaden

#### S2 Analysera en bostad

- [ ] Rubrikblock och ingress (vanlig variant och registerläge)
- [ ] Fält "Klistra in länk från Booli" + hjälptext före/efter hämtning
- [ ] Knapp "Hämta uppgifter" ("Hämtar…")
- [ ] Booli: sju felmeddelanden under fältet
- [ ] Booli: fältmärken "Hämtat från Booli", "Ändrat manuellt", "Fanns inte i annonsen, fyll i själv", "Framgår inte av annonsen", "Tolkat från annonsens text – kontrollera", OpenStreetMap-text
- [ ] Booli: notis att Booli blockerar i produktion
- [ ] Steg 1: fält "Boarea"
- [ ] Steg 1: fält "Antal rum"
- [ ] Steg 1: fält "Månadsavgift"
- [ ] Steg 1: fält "Postnummer" + områdestext (sex varianter)
- [ ] Länk "Vet du inte postnumret? Sök hos PostNord"
- [ ] Steg 1: fält "Våning"
- [ ] Steg 1: fält "Byggår" (valfritt)
- [ ] Steg 1: fält "Utgångspris" (valfritt)
- [ ] Val "Hiss" (Ja/Nej/Vet ej)
- [ ] Val "Balkong" (Ja/Nej/Vet ej)
- [ ] Valideringsmeddelanden för steg 1 (alla)
- [ ] Knapp "Se värderingen" ("Värderar…") och hjälptexten intill
- [ ] Resultat: prisavsnittet (se K1)
- [ ] Resultat: felruta "Det gick inte att göra värderingen" (serverns text / "Något gick fel. Försök igen om en stund.")
- [ ] Kort "Spara värderingen" med fält "Namn" och knappen "Spara värderingen"
- [ ] Text "Vill du granska föreningen också?…"
- [ ] Meddelanden vid väntande Spara (fem lägen + "Uppgifterna du fyllde i är inte kompletta längre.")
- [ ] Förifyllning via adressparametrar
- [ ] Steg 2: rubrik och förklaring (två varianter)
- [ ] Uppladdningsyta (klick, tangentbord, släpp) "Dra och släpp årsredovisningen här, eller klicka för att välja fil"
- [ ] Knapp "Ta bort" vald fil
- [ ] Filfel (tre meddelanden)
- [ ] Fält "Adress" (kort "Adress till objektet")
- [ ] Knapp "Analysera" ("Skickar in…") + hjälptexter + "Fyll i de obligatoriska fälten, även i steg 1."
- [ ] Felruta vid sändning (felrubrik, serverns text, åtgärd; "Kunde inte skicka in analysen")
- [ ] Registerläge: "Hämtar föreningen från registret…"
- [ ] Registerläge: kort "Föreningens årsredovisning finns redan hos Binfo" + länk "Ladda upp en annan årsredovisning i stället"
- [ ] Registerläge: ruta "Vi hittade inte föreningen i registret" / "Vi kunde inte hämta föreningen just nu"
- [ ] Sparad värdering: sida "Priskoll" med datummärke
- [ ] Sparad värdering: knapp "Räkna om med dagens modell" ("Räknar om…") och "Omräknat med dagens modell"
- [ ] Sparad värdering: länkar "Gör en ny värdering", "Till Mitt konto"
- [ ] Sparad värdering: tillstånd (laddar, utloggad → inloggning, hittades inte, fel, format stöds inte)
- [ ] Känt fel: "kontakta oss" utan kontaktadress

#### S3 Analys pågår / rapport

- [ ] Väntskärm "Din analys pågår" med stegtext och förloppsstapel
- [ ] Alla sex stegtexter
- [ ] Automatisk uppdatering var 5:e sekund
- [ ] Notis "Skannad årsredovisning"
- [ ] Notis "Analyseras redan"
- [ ] Notis "Redan analyserad" över rapporten
- [ ] Rubrik "Hämtar analysen…"
- [ ] Skärm "Vi hittar ingen analys med det här id:t" + knapp "Starta en ny analys"
- [ ] Felskärm "Analysen kunde inte slutföras" + knapp "Till formuläret"
- [ ] Nio felrubriker per felkod med åtgärdstext
- [ ] Rapporten (K1) när klar
- [ ] Spara analysen (K2) och återkomst med ?spara=analys
- [ ] Känt fel: "3–5 minuter" mot uppmätt 1–3
- [ ] Känt fel: scanned_pdf-texten är föråldrad
- [ ] Känt fel: "hör av dig till oss" utan kontaktadress

#### S4 Rapport (bokmärkeslänk)

- [ ] Hela rapporten (K1) under "Din analys"
- [ ] Omdirigering till /forhandsvisning om ej klar/ej hittad/ej läsbar
- [ ] Spara analysen (K2) och ?spara=analys

#### S5 Exempelrapport

- [ ] Informationsruta om att det är en exempelrapport
- [ ] Länk "Ladda upp en årsredovisning"
- [ ] Rapporten (K1) utan spara-rad
- [ ] Knapparna "Ladda ner som PDF" och "Räkna på månadskostnaden" fungerar

#### S6 Bolånekalkyl

- [ ] KALP-kortets rader "Hushållets nettoinkomst" och "Levnadskostnader (Konsumentverket 2026)"
- [ ] Rubrikblock och ingress
- [ ] Fält "Lånebelopp" (+ förifylld hjälptext, två varianter)
- [ ] Fält "Kontantinsats" (+ hjälptext om bolånetak)
- [ ] Fält "Ränta"
- [ ] Fält "Månadsavgift" (+ hjälptext, förifylld variant)
- [ ] Utfällbar "Vad ingår i avgiften?"
- [ ] Val Ingår/Ingår ej/Vet ej för "Värme"
- [ ] Val för "Vatten"
- [ ] Val för "El"
- [ ] Val för "Bredband"
- [ ] Val för "TV"
- [ ] Fält "Boarea" (+ hjälptext)
- [ ] Fält "Antal personer i hushållet" (+ hjälptext)
- [ ] Växel "1 låntagare" / "2 låntagare"
- [ ] Fält "Låntagare 1: bruttoinkomst per år"
- [ ] Fält "Låntagare 2: bruttoinkomst per år" (bara vid 2 låntagare)
- [ ] Ruta "Hushållets nettoinkomst"
- [ ] Reglage "Räntestress" 0–3 (+ förklarande texter, med/utan räntekänslighet)
- [ ] Inmatningsfel (negativt, format, heltal, intervall)
- [ ] Resultat: "Lånekostnad" (Räntekostnad, Amortering, Ränteavdrag)
- [ ] Resultat: "Boendekostnad" med "Månadsavgift" och klickbara schablonrader ("schablon"/"ditt värde")
- [ ] Resultat: "Total månadskostnad" (belopp eller spann), "Brutto"
- [ ] Resultat: "Det här betalar ni varje månad", "Andel av nettoinkomsten", "Kvar att leva på per månad"
- [ ] Resultat: "Tillbaka i deklarationen" + ruta om outnyttjat avdrag
- [ ] Kort "Amorteringskravet" (tre mått + märken)
- [ ] Knapp "Ladda ner PDF" ("Skapar PDF…")
- [ ] Knapp "Ladda ner Excel" ("Skapar Excel…")
- [ ] Hjälptexter för när exportknapparna är avstängda/på
- [ ] Fält "Namn på kalkylen"
- [ ] Knapp "Spara kalkylen" / "Spara ändringarna"
- [ ] Knapp "Spara som ny kalkyl"
- [ ] Utfällbar "Fördjupning: räntescenarier och bankens kalkyl (valfritt)" (öppnas automatiskt vid ändrad KALP)
- [ ] Kort "Om räntan ändras"
- [ ] KALP-fält "Antal vuxna i hushållet"
- [ ] KALP-fält "Barn 0–3 år", "Barn 4–6 år", "Barn 7–10 år", "Barn 11–14 år", "Barn 15–17 år"
- [ ] KALP-fält "Kalkylränta"
- [ ] Kort "Kvar att leva på enligt bankens kalkyl" (+ tre tomlägen)
- [ ] Utfällbar "Så räknas levnadskostnaderna"
- [ ] Kort "Regler och antaganden" med länk "Hushållskostnader 2026"
- [ ] Förifyllning via adressparametrar (manadsavgift, rantekanslighet, pris, boarea, prisUppskattning)
- [ ] Öppna sparad kalkyl (?sparad) – laddar, utloggad, "Öppnad från ditt konto", "Kalkylen kan inte öppnas"
- [ ] Väntande Spara (?spara=kalkyl) – fem meddelanden
- [ ] Känt fel: fel hjälptext under "Boarea" och "Antal personer i hushållet"

#### S7 Köpguide

- [ ] Rubrikblock och ingress
- [ ] Räknare "X av 12 steg klara" och förloppsstapel
- [ ] Tre grupprubriker
- [ ] Stegrubrik som fäller ut/in (12 steg)
- [ ] Knapp "Markera klar" / "Klar" per steg
- [ ] Rutorna "Viktiga flaggor" och "Tips" i utfällt steg
- [ ] Länkar i tips: "Räkna på din månadskostnad här" (två steg), "Analysera föreningen här"
- [ ] Steget "Lagfart & pantbrev" (hus) visas inte
- [ ] Känt fel: avhuggen text i "Medlemskap i föreningen"

#### S8 BRF-registret

- [ ] Fotnot "<N> förening(ar) i registret. Områdesindelning: © OpenStreetMap-bidragsgivare (ODbL), Stockholms stad."
- [ ] Rubrikblock
- [ ] Sökfält "Sök förening"
- [ ] Knapp "Sök"
- [ ] Knapp "Rensa"
- [ ] Sökresultat (tabell/kort) eller "Inga föreningar matchar …"
- [ ] Områdeskort under "Innerstaden", "Söderort", "Västerort"
- [ ] Områdeskort under "Övriga Stockholm"
- [ ] Föreningslista: länk på föreningsnamn
- [ ] Föreningslista: sortering på kolumnrubriker (Betyg, Skuld per m², Årsavgift per m², Sparande per m², Analyserad)
- [ ] Föreningslista: mobil rullista "Sortera efter" + "Stigande ↑"/"Fallande ↓"
- [ ] Föreningslista: "Föregående"/"Nästa" och "Sida X av Y"
- [ ] Betygsmärke (neutral ton)

#### S9 Område i registret

- [ ] Brödsmula "BRF-register › <område>"
- [ ] Sökfält "Sök i <område>", "Sök", "Rensa"
- [ ] Föreningslista (länk, sortering, sidbläddring)
- [ ] Tomt läge + knapp "Analysera en bostad"
- [ ] Fotnot om OpenStreetMap
- [ ] Sida "Området finns inte i registret"

#### S10 Föreningssida

- [ ] Hjälptexter under "Nyckeltal" och "Nyckeltal per år"
- [ ] Fotnot om tolkningsfel + "Hittar du ett fel? Kontakta oss."
- [ ] Fotnot om OpenStreetMap-områdesindelning + "Analysen är beslutsstöd, inte finansiell rådgivning."
- [ ] Brödsmula (BRF-register › område › förening)
- [ ] Faktakort (Organisationsnummer, Område, Räkenskapsår, Analyserad, adress)
- [ ] Ruta "Skannad årsredovisning"
- [ ] Text om äldre version
- [ ] Betygskort med generell förklaring
- [ ] Lista "Nyckeltal" med status och sidhänvisning
- [ ] Knapp-länk "Se hela analysen för varför föreningen fick betyget <betyg>"
- [ ] Tabell "Nyckeltal per år" med länkar på årtal
- [ ] Kort "Köper du i den här föreningen?" + "Analysera en lägenhet i föreningen"
- [ ] Fotnot "Hittar du ett fel? Kontakta oss." och OpenStreetMap-text
- [ ] Sida "Föreningen finns inte i registret"
- [ ] Känt fel: "Kontakta oss" utan adress

#### S11 Föreningens fullständiga analys

- [ ] Sidhuvud: märke "Hela analysen", föreningens namn, ingress om räkenskapsår, analysdatum och sidhänvisningar
- [ ] Avslutande friskrivning om tolkningsfel och beslutsstöd
- [ ] Brödsmula med "Analys <år>"
- [ ] Ruta "Skannad årsredovisning" / text om äldre version
- [ ] Betygskort med motivering
- [ ] Röda flaggor
- [ ] "Föreningens ekonomi"
- [ ] "Övrig info från årsredovisningen"
- [ ] "Frågor att ställa" (kryssrutor)
- [ ] Länk "Tillbaka till <förening>"
- [ ] Kort "Köper du i den här föreningen?" + knapp-länk
- [ ] Sida "Analysen är inte tillgänglig just nu"
- [ ] Sida "Analysen finns inte i registret"

#### S12 Mitt konto

- [ ] Ingress "Inloggad som <e-post>", "Laddar…", omdirigering när utloggad
- [ ] Felruta med "Försök igen"
- [ ] Analyser: rad med märken (Pågår/Klar/Misslyckades, Betyg)
- [ ] Analyser: länk "Öppna"
- [ ] Analyser: "Ta bort från listan" + dialog
- [ ] Analyser: tomt läge + "Analysera en bostad"
- [ ] Värderingar: rad, märket "Kan inte öppnas"
- [ ] Värderingar: länk "Öppna"
- [ ] Värderingar: "Radera" + dialog
- [ ] Värderingar: tomt läge + "Gör en priskoll"
- [ ] Bolånekalkyler: rad med sammanfattning
- [ ] Bolånekalkyler: länk "Öppna"
- [ ] Bolånekalkyler: knappar "PDF" och "Excel"
- [ ] Bolånekalkyler: "Radera" + dialog
- [ ] Bolånekalkyler: tomt läge + "Öppna bolånekalkylen"
- [ ] Länk "Byt lösenord"
- [ ] Knapp "Ladda ner mina uppgifter"
- [ ] Knapp "Logga ut"
- [ ] Knapp "Radera mitt konto" + dialog med fält "Lösenord"
- [ ] Känt fel: "Tar bort…" i alla raderingsdialoger
- [ ] Känt fel: "Fel e-postadress eller lösenord." vid fel lösenord i kontoraderingen

#### S13 Logga in

- [ ] Fält "E-postadress"
- [ ] Fält "Lösenord"
- [ ] Knapp "Logga in" ("Loggar in…") + felmeddelanden
- [ ] Länk "Glömt lösenordet?"
- [ ] Länk "Skapa konto"
- [ ] Ingress (två varianter) och automatisk vidare om redan inloggad
- [ ] Återgång till ?till= och slutföra ?spara=

#### S14 Skapa konto

- [ ] Fält "E-postadress"
- [ ] Fält "Lösenord" (minst 10 tecken)
- [ ] Knapp "Skapa konto" ("Skapar konto…") + felmeddelanden
- [ ] Sidan "Kolla din e-post" + länk "Logga in"
- [ ] Automatisk vidare vid fokus när kontot bekräftats
- [ ] Länk "integritetspolicyn"
- [ ] Länk "Logga in" (har redan konto)

#### S15 Glömt lösenord

- [ ] Fält "E-postadress"
- [ ] Knapp "Skicka återställningslänk" ("Skickar…")
- [ ] Bekräftelsetext efter sändning
- [ ] Länk "Tillbaka till inloggning"

#### S16 Bekräfta e-post

- [ ] Knapp "Bekräfta e-postadressen" / "Fortsätt" ("Kontrollerar…")
- [ ] Sida "Kontot är bekräftat" + knapp "Fortsätt"/"Fortsätt och spara"
- [ ] Felläge + länk "Begär en ny länk" / "Till inloggningen"
- [ ] Sida "Länken fungerar inte" + länk "Till inloggningen"
- [ ] Omdirigering till nytt lösenord vid återställning

#### S17 Välj nytt lösenord

- [ ] Fält "Nuvarande lösenord" (villkorat)
- [ ] Fält "Nytt lösenord"
- [ ] Knapp "Spara nytt lösenord" ("Sparar…")
- [ ] Sida "Lösenordet är ändrat" + länk "Till Mitt konto"
- [ ] Omdirigering till inloggning när utloggad
- [ ] Känt fel: "Fel e-postadress eller lösenord." vid fel nuvarande lösenord

#### S18 Integritet

- [ ] Sju textavsnitt
- [ ] Länkar "Analysera", "BRF-registret", "Mitt konto"
- [ ] Känt fel: "kontakta oss" utan adress
- [ ] Känt fel: texten om "senaste analyser" mot dold ruta

#### S19 Omdirigeringar och systemsidor

- [ ] /vardering → /analysera
- [ ] /guide → /kopguide
- [ ] 404-sida, felsida, /sitemap.xml

#### K1 Analysrapporten

- [ ] Byggårsmärkning: "Avviker" + "Årsredovisningen anger <år>", ±1 år utan märke, "Okänt" + "Osäkert", "Från årsredovisningen" / "Värdeår enligt årsredovisningen"
- [ ] Hjälptext för "Övrig info från årsredovisningen"
- [ ] "Så har vi räknat": avgiftsbelopp "+N kr/mån" / "Kan inte uppskattas" / "Ingen tydlig förändring"; delposter "Underlag saknas" / "Ej aktuellt"
- [ ] "Så har vi räknat": staplarna "Behov" / "Sparar" och rutan "Glapp" / "Överskott"
- [ ] "Visa byggdelarna": kolumner Byggdel, Senast, Normalt, Status; status Nyligen / Ok / Eftersatt / Okänt
- [ ] Lån som omsätts: underlagsrader (inom horisonten, nuvarande ränta, antagen ny ränta med referensränta + marginal)
- [ ] Lånetabellens celltexter: "Rörlig ränta", "Datum saknas", "Ränta saknas", "≤ N mån", "År 3–5 · väger N %", rad för förfallet lån
- [ ] Förklaringstext under stapeldiagrammet och under räntereglaget (fliken "Förväntad avgift")
- [ ] Objektsammanfattning (fält, byggårsmärke, raderad adress)
- [ ] Betygskort
- [ ] Spara-rad under betyget
- [ ] Röda flaggor (högst två)
- [ ] "Föreningens ekonomi" (statusetiketter, märken, "Viktigast här")
- [ ] "Övrig info från årsredovisningen" (antal, vad ingår i avgiften, händelser, skannad-ruta, tillförlitlighet, äldre version, nyare år)
- [ ] Prisavsnitt "Är priset rimligt?" / "Binfos värdering"
- [ ] Prisavsnitt: utanför Stockholms län-ruta
- [ ] Prisavsnitt: utgångspris, värdering, spann, avvikelse
- [ ] Prisavsnitt: justerat värde
- [ ] Prisavsnitt: byggårsnotis, andel av lån, område, slutsats, låg tillförlitlighet
- [ ] Utfällbar "Så har vi räknat"
- [ ] "Så har vi räknat": Utgångsläget + "Visa mer"
- [ ] "Så har vi räknat": stapeldiagram "Så påverkar föreningens ekonomi priset"
- [ ] "Så har vi räknat": "Väntad avgiftsutveckling enligt årsredovisningen"
- [ ] "Så har vi räknat": "Sparande till underhåll" + "Visa byggdelarna"
- [ ] "Så har vi räknat": "Lån som omsätts" + "Visa hela uträkningen"
- [ ] "Så har vi räknat": "Visa mer om övriga delar"
- [ ] "Så har vi räknat": "Så räknas avgiften om till pris"
- [ ] "Vad händer om räntan stiger?": flikar "Dagens avgift" / "Förväntad avgift"
- [ ] "Vad händer om räntan stiger?": reglaget "Räntehöjning" 0–3
- [ ] "Vad händer om räntan stiger?": två rutor och kommentar
- [ ] "Vad händer om räntan stiger?": saknad räntekänslighet (låst reglage)
- [ ] "Frågor att ställa" (kryssrutor, "Varför", svarssignal)
- [ ] "Sammanfattning"
- [ ] Knapp "Ladda ner som PDF" ("Skapar PDF…") + felmeddelande
- [ ] Knapp "Räkna på månadskostnaden"
- [ ] Kort "Spara analysen i din profil"
- [ ] Varianter: utan utgångspris, skannad, äldre version, utanför Stockholm, skuldfri, äldre resultat utan prognos

#### K2 Spara-flödet

- [ ] Spara-knapp (tillstånd: vilar, "Sparar…", nedtonad medan session laddas)
- [ ] Inloggad: sparar direkt → "Sparad i ditt konto." + länk
- [ ] Inloggad: felruta med serverns text
- [ ] Utloggad: tips "Du behöver ett konto för att spara. …"
- [ ] Utloggad: utkast skrivs (24 h) och omdirigering till inloggning med ?till och ?spara
- [ ] Utkast kan inte sparas: felmeddelande (två varianter)
- [ ] Återkomst: sparande slutförs en gång, utkastet raderas
- [ ] Återkomst: meddelandena "Logga in för att spara", "Utkastet finns inte kvar", "Sparar …", "är sparad", fel
- [ ] Nytt konto via mejl: återkomst i ny flik, "Fortsätt och spara"
- [ ] "Spara analysen": rad under betyget (fyra tillstånd)
- [ ] "Spara analysen": kort i slutet
- [ ] Spara värdering / kalkyl / analys använder samma flöde

### 6.3 Serverfunktioner

#### Gemensamt

- [ ] Generell analystext visas vid oväntat fel
- [ ] Generell text på konto-/sparsidor ("Något gick fel hos oss…" / "Något gick fel. Försök igen om en stund.")
- [ ] Nekad behörighet ("Du har inte tillgång till den här funktionen just nu.")
- [ ] Paus-text ("Analyser är tillfälligt pausade av driftskäl…")
- [ ] Dagsgräns-text ("Dagens gräns för antal analyser är nådd…")
- [ ] Adminarbete sker via kommandoradsverktyg, inget admin-UI (nämnt en gång)

#### Analys

- [ ] `skapaAnalysFn`: knappen "Analysera" (S2) med "Skickar in…" och hjälptexten "Laddar upp och startar analysen…"
- [ ] `skapaAnalysFn` lyckat: går till S3, flaggorna "redan analyserad" och "väntar på pågående rapport"
- [ ] `skapaAnalysFn` fel: "Uppgifterna om bostaden kunde inte tolkas…"
- [ ] `skapaAnalysFn` fel: "Filen verkar inte vara en PDF."
- [ ] `skapaAnalysFn` fel: "Filen är för stor (max 25 MB)."
- [ ] `skapaAnalysFn` fel: skannad PDF över 60 sidor
- [ ] `skapaAnalysFn` fel: fyra kvottexter (enhet, nätverk, lös enhet, löst nätverk)
- [ ] `skapaAnalysFn` fel: dagsgräns, paus, behörighet
- [ ] `skapaAnalysFn` kastat fel: generell "okänd"-ruta
- [ ] `skapaAnalysFranRegisterFn`: knappen "Analysera" i registerläget med "Föreningens analys finns redan — du får din rapport direkt." / "Skapar din analys…"
- [ ] `skapaAnalysFranRegisterFn` fel: "Föreningen finns inte i registret, eller så har den ingen färdig analys ännu…"
- [ ] `skapaAnalysFranRegisterFn` fel: samma kvot-/dagsgräns-/paustexter som uppladdning
- [ ] Känt fel: registerfelet visas under rubriken "Uppgifterna kunde inte tolkas"
- [ ] `hamtaStatusFn`: automatiskt vid laddning och var 5:e sekund på S3
- [ ] Status: okänt id ("Vi hittar ingen analys med det här id:t", "Starta en ny analys")
- [ ] Status: pågår ("Din analys pågår", stegtext, förloppsstapel, notiser)
- [ ] Status: misslyckad (skärm per kod, knappen "Till formuläret")
- [ ] Status: klar (rapport; notisen "Redan analyserad")
- [ ] Status: gammal rapport som inte går att läsa ("…behöver göras om. Ladda upp årsredovisningen igen.")
- [ ] `hamtaResultatFn`: hämtar rapporten på S3 ("Hämtar analysen…") och S4
- [ ] Resultat: noterna "Analysen gjordes med en tidigare version av Binfo." / "Det finns en nyare årsredovisning (ÅÅÅÅ) analyserad för föreningen."
- [ ] Resultat: S4 omdirigerar till S3 vid fel

#### Priskoll och formulärhjälp

- [ ] `hamtaPrisuppskattningFn`: knappen "Se värderingen" ("Värderar…")
- [ ] `hamtaPrisuppskattningFn`: knappen "Räkna om med dagens modell" ("Räknar om…") på sparad värdering
- [ ] `hamtaPrisuppskattningFn`: automatisk omräkning när utkast återställs efter inloggning
- [ ] Priskoll fel: ogiltigt postnummer
- [ ] Priskoll fel: ogiltiga uppgifter
- [ ] Priskoll fel: kvot (60/timme)
- [ ] Priskoll fel: behörighet
- [ ] Priskoll kastat fel: "Något gick fel. Försök igen om en stund."
- [ ] Röd ruta "Det gick inte att göra värderingen"
- [ ] `hamtaPostnummerInfoFn`: områdesrad under postnummerfältet (automatisk, fördröjd)
- [ ] Postnummerhjälp: område / Stockholm okänt område / kommun i länet / utanför länet
- [ ] Postnummerhjälp: okänt med grannar / okänt utan grannar (varningsram) / ogiltigt = ingen text
- [ ] Länken "Vet du inte postnumret? Sök hos PostNord"

#### Booli-hämtning

- [ ] `hamtaAnnonsFn`: fältet "Klistra in länk från Booli" och knappen "Hämta uppgifter" ("Hämtar…")
- [ ] Notis: blockeras i produktion, slutar i "Vi kunde inte hämta uppgifterna, fyll i manuellt."
- [ ] Lyckat: fält märks "Hämtat från Booli" / "Ändrat manuellt" / OpenStreetMap
- [ ] Lyckat: saknade fält "Fanns inte i annonsen, fyll i själv" med varningsram
- [ ] Fel: tom länk, "Endast Booli-länkar stöds just nu.", ogiltig annonslänk
- [ ] Fel: avstängd, kvot (20/60 per timme), behörighet
- [ ] Fel: allmänt "Vi kunde inte hämta uppgifterna, fyll i manuellt."

#### Konto och inloggning

- [ ] `hamtaSessionFn`: automatiskt (sidhuvud, spara-knappar, kontosidor, "Laddar…")
- [ ] "Konton är inte aktiverade just nu. Försök igen senare."
- [ ] `registreraKontoFn`: "Skapa konto" ("Skapar konto…") och vyn "Kolla din e-post"
- [ ] Registrering fel: ogiltig e-post, svagt lösenord, kvot, generell
- [ ] `loggaInFn`: "Logga in" ("Loggar in…") och vidare till `?till=`
- [ ] Inloggning fel: fel uppgifter, ej bekräftad, kvot, generell
- [ ] `bekraftaEpostFn`: "Bekräfta e-postadressen" ("Kontrollerar…"), "Fortsätt" / "Fortsätt och spara"
- [ ] Bekräfta fel: ogiltig länk, annan session aktiv, kvot, generell, ofullständig länk
- [ ] Återställningslänk går direkt till S17
- [ ] `begarAterstallningFn`: "Skicka återställningslänk" ("Skickar…") och bekräftelsetext
- [ ] Återställning fel: ogiltig e-post, kvot
- [ ] `sattNyttLosenordFn`: "Spara nytt lösenord" ("Sparar…") och "Lösenordet är ändrat"
- [ ] Nytt lösenord fel: ej inloggad, svagt, kräver nuvarande, fel nuvarande, kvot, generell
- [ ] Känt fel: fel nuvarande lösenord säger "Fel e-postadress eller lösenord."
- [ ] `loggaUtFn`: knappen "Logga ut" på S12
- [ ] `raderaKontoFn`: "Radera mitt konto" → dialog "Radera kontot?" → "Radera kontot" / "Avbryt"
- [ ] Radera konto fel: i lösenordsfältet (fel lösenord, kvot, inloggning, generell)
- [ ] Känt fel: "Tar bort…" i alla raderingsdialoger

#### Sparat och profil

- [ ] `sparaVarderingFn`: kortet "Spara värderingen" med fältet "Namn" och knappen "Spara värderingen"
- [ ] Spara värdering: utloggad → utkast → S13 → sparas automatiskt efter inloggning
- [ ] Spara värdering lyckat: "Sparad i ditt konto." + länk till Mitt konto
- [ ] Spara värdering fel: ogiltiga uppgifter, priskollens valideringstexter, kvot, gräns, ej inloggad
- [ ] Känt fel: kvottexten vid sparande är kontots, inte priskollens
- [ ] `hamtaSparadVarderingFn`: öppnar `?sparad=` ("Hämtar den sparade värderingen…")
- [ ] Sparad värdering fel: "Värderingen hittades inte.", generell, ej inloggad → S13
- [ ] `raderaSparadVarderingFn`: "Radera" → "Radera värderingen?"
- [ ] `sparaKalkylFn`: "Spara kalkylen" / "Spara ändringarna" / "Spara som ny kalkyl" med "Namn"
- [ ] Spara kalkyl: utloggad → utkast → S13 → automatiskt efter inloggning
- [ ] Spara kalkyl fel: ogiltigt, gräns, hittades inte, ej inloggad
- [ ] `hamtaSparadKalkylFn`: öppnar `?sparad=` på S6 (okänt format = tom kalkyl med notis)
- [ ] `hamtaSparadKalkylFn`: knapparna "PDF" och "Excel" på S12
- [ ] `raderaSparadKalkylFn`: "Radera" → "Radera kalkylen?"
- [ ] `listaSparatFn`: laddar S12 ("Hämtar dina sparade uppgifter…"), tomlägen, felruta med "Försök igen"
- [ ] `taBortAnalysFranListaFn`: "Ta bort från listan" → dialog "Ta bort analysen från din lista?"
- [ ] `hamtaSparstatusFn`: automatiskt på S3/S4; tre lägen sparad / kan sparas / ingen
- [ ] `forberedSparaAnalysFn`: "Spara analysen" när utloggad → S13 med `?spara=analys`
- [ ] Förbered fel: "Analysen kunde inte sparas i din profil…" och "Analysen kunde inte förberedas för att sparas…"
- [ ] `sparaAnalysFn`: "Spara analysen" när inloggad ("Sparar…") och automatiskt efter inloggning ("Sparar analysen…")
- [ ] Spara analys lyckat: "Analysen är sparad i din profil." + "Se den i Mitt konto"
- [ ] Spara analys fel: kan inte sparas, ej inloggad
- [ ] `hamtaMinaUppgifterFn`: "Ladda ner mina uppgifter" ("Hämtar…"), filnamn, felruta
- [ ] "Vi hittade inte det du sökte." och gränstexten "Du har nått gränsen för antal sparade objekt…"

#### BRF-registret

- [ ] `hamtaRegisterOmradenFn`: områdeskorten på S8
- [ ] `hamtaRegisterOmradeFn`: sökning på S8 ("Sök förening", "Sök", "Rensa")
- [ ] `hamtaRegisterOmradeFn`: tabell på S9 (sortering, sök, "Föregående" / "Nästa")
- [ ] Register tomlägen (S8 och S9) och okänt område (404)
- [ ] `hamtaRegisterForeningFn`: laddar S10 (404, omdirigering av gammalt namn)
- [ ] `hamtaRegisterForeningFn`: används av S2 i registerläget (faller tillbaka på uppladdning)
- [ ] `hamtaRegisterAnalysFn`: laddar S11 via "Se hela analysen…" och årslänkar
- [ ] S11 nekad: "Analysen är inte tillgänglig just nu" + länk tillbaka
- [ ] S11 saknas: 404 "Analysen finns inte i registret"
- [ ] Känt fel: registerkvoten ger den generella felsidan (S8–S11)
- [ ] `hamtaSitemapDataFn`: `/sitemap.xml`

#### Bakgrundsarbete

- [ ] Stegtext "Identifierar föreningen…"
- [ ] Stegtext "Läser av de skannade sidorna…" (bara skannade)
- [ ] Stegtext "Läser årsredovisningen…"
- [ ] Stegtext "Hämtar de sju nyckeltalen…"
- [ ] Stegtext "Analyserar föreningens ekonomi…"
- [ ] Stegtext "Sammanställer rapporten…"
- [ ] Notis "Skannad årsredovisning"
- [ ] Notis "Analyseras redan"
- [ ] Tidstexten "3–5 minuter" (+ skannad-tillägget)
- [ ] Känt fel: "3–5 minuter" mot uppmätt 1–3
- [ ] Känt fel: förloppsstapeln räknar skanningssteget för "trasigt" textlager
- [ ] Fel efter tre försök; versionskonflikt-text; "dragits tillbaka"-text
- [ ] Fyra cronjobb (varje minut, var 5:e minut, natt-anonymisering, natt-keep-alive) beskrivna

#### Felmeddelanden för analyser

- [ ] `scanned_pdf`
- [ ] `cost_cap` (inkl. serverns text)
- [ ] `daily_cap`
- [ ] `validation`
- [ ] `saknar_rantekanslighet` (bara gamla jobb)
- [ ] `versionskonflikt`
- [ ] `kvot`
- [ ] `behorighet`
- [ ] `unknown`
- [ ] Känt fel: "kontakta oss" utan kontaktadress

### 6.4 Tillstånd

#### Tillståndstyper (allmänt)

- [ ] Tomt (lista eller sida utan innehåll, med knapp vidare)
- [ ] Laddar/väntar (text, inaktiv knapp)
- [ ] Fel (röd ruta med serverns text, generell text vid kast)
- [ ] Lyckat
- [ ] Nekad behörighet / kräver inloggning
- [ ] Förstagångsanvändare
- [ ] Analys pågår med steg
- [ ] Skannad rapport
- [ ] Redan analyserad
- [ ] Analyseras redan
- [ ] Äldre version
- [ ] Delvis data / saknade nyckeltal
- [ ] Utanför Stockholm / lägre säkerhet
- [ ] Gräns nådd / kvot (alla kvotmeddelanden)
- [ ] Tillfälligt pausad (nödbroms, Booli avstängd)
- [ ] Utkast efter inloggning
- [ ] Session laddas

#### G1 Sidhuvud och sidfot

- [ ] Session laddas: osynlig platshållare "Mitt konto"
- [ ] Utloggad: knappen "Logga in"
- [ ] Inloggad: knappen "Mitt konto"
- [ ] Aktiv länk markerad
- [ ] Smal skärm: länkraden bryts, ingen mobilmeny
- [ ] Sidfot med länken "Integritet och personuppgifter"
- [ ] 404 "Sidan hittades inte" med "Till startsidan"
- [ ] Felsida i webbläsaren "Sidan kunde inte laddas" med "Försök igen" och "Till startsidan"
- [ ] Serverfelsida (500) i enkel stil
- [ ] Känt fel: serverfelsidan följer inte sajtens design

#### S1 Startsida

- [ ] Normalläge för alla besökare
- [ ] Ingen skillnad för inloggad/utloggad/förstagångsbesökare
- [ ] Känt fel: döda ankarlänkar i exempelrapporten
- [ ] Känt fel: "Tolv steg" / "4 av 12" är hårdkodat

#### S2 Analysera en bostad

- [ ] Tomt formulär med platshållare och "Ingen uppladdning behövs."
- [ ] Rutan "Dina senaste analyser" ska inte visas (dold)
- [ ] Booli: tomt fält, hämtar, klart, uppgift saknades, fel domän, ogiltig länk, avstängd, kvot, nekad, kunde inte hämta
- [ ] Booli: fältmärkning ("Hämtat från Booli", "Ändrat manuellt", "Fanns inte i annonsen, fyll i själv", OpenStreetMap, "Tolkat från annonsens text – kontrollera", "Framgår inte av annonsen")
- [ ] Booli: "Booli anger föreningen: <namn>…"
- [ ] Känt fel: Booli blockerar hämtningen i produktion
- [ ] Steg 1: alla fältfel och "Fyll i de obligatoriska fälten."
- [ ] Postnummerhjälp, alla sex texter, och PostNord-länken
- [ ] Steg 1: räknar ("Värderar…")
- [ ] Steg 1: serverfel, kvot, nekad, oväntat fel (rutan "Det gick inte att göra värderingen")
- [ ] Steg 1: resultat och kortet "Spara värderingen"
- [ ] Steg 1: utanför länet (varningsruta)
- [ ] Spara värdering: utloggad tips, kan inte skriva utkast, sparar, klart, gräns, ogiltig indata, kvot, session gick ut
- [ ] Efter inloggning: kräver inloggning, utkast saknas, sparar, klart, fel, ofullständigt utkast
- [ ] Steg 2: registerläge laddar, träff, hittades inte, kunde inte hämtas
- [ ] Filval: ingen fil, fel typ, för stor, vald fil
- [ ] Adress saknas
- [ ] Skickar: knapptext och hjälptexter
- [ ] Skickar: serverns avvisning (ogiltig indata, ej PDF, för stor, för många skannade sidor, förening saknas i registret)
- [ ] Skickar: kvot (fyra texter), dagens tak, nödbroms, nekad behörighet, oväntat fel
- [ ] Sparad värdering: laddar, utloggad (flytt), hittades inte, fel, öppnad, omräkning, gammalt format
- [ ] Känt fel: "Byggår" tolkar ogiltig text tyst som tomt

#### S3 Analys pågår / rapport

- [ ] Pågår med stegtexter, förloppsstapel och tidstext
- [ ] Skannad: tipsruta och extra tid
- [ ] Analyseras redan: tipsruta
- [ ] Hämtar rapporten och "Kontrollerar status…"
- [ ] Klar: rapport
- [ ] Redan analyserad: tipsruta
- [ ] Äldre version: notis
- [ ] Hittades inte: "Vi hittar ingen analys med det här id:t"
- [ ] Misslyckad: alla nio felrubriker med förklaring och åtgärd
- [ ] Misslyckad: versionskonflikt-texterna och generell servertext
- [ ] Spara analysen: kan sparas, redan sparad, någon annans, sparar, klart, fel
- [ ] Känt fel: "3–5 minuter" mot uppmätt 1–3
- [ ] Känt fel: föråldrad text för skannad som inte kan läsas
- [ ] Känt fel: "kontakta oss" utan kontaktadress

#### S4 Rapport (bokmärkeslänk)

- [ ] Klar: rapport
- [ ] Alla andra lägen: omdirigering till S3
- [ ] Ingen "Redan analyserad"-notis här
- [ ] Spara analysen efter inloggning

#### S5 Exempelrapport

- [ ] Normalläge med informationsruta
- [ ] Ingen sparfunktion
- [ ] PDF- och kalkylknapp fungerar

#### S6 Bolånekalkyl

- [ ] Förstagångsläge med förvalda värden
- [ ] Förifylld från rapport (tre hjälptexter)
- [ ] Ofullständig inmatning ("—")
- [ ] Fältfel (fyra texter)
- [ ] Spann vid "Vet ej"
- [ ] Okänd räntekänslighet
- [ ] Ränteavdrag begränsat
- [ ] Skuldkvot över tak
- [ ] Fördjupning: saknar ränta, öppnas själv
- [ ] Bankens kalkyl: saknar uppgifter, för stort hushåll, underskott
- [ ] Export: inaktiv, skapar, fel
- [ ] Spara: utloggad, lyckat, öppnad sparad, gräns/fel
- [ ] Sparad kalkyl: laddar/utloggad, hittades inte/fel, gammalt format
- [ ] Efter inloggning: fem lägen
- [ ] Känt fel: hjälptexter för Boarea och Antal personer
- [ ] Känt fel: "TV" mot "Tv"

#### S7 Köpguide

- [ ] Första visningen (0 av 12, steg 1 öppet)
- [ ] Steg öppet/stängt
- [ ] Steg avbockat
- [ ] Allt klart
- [ ] Omladdning nollställer allt
- [ ] Ingen skillnad inloggad/utloggad
- [ ] Länkar i tips
- [ ] Dolt: växeln Bostadsrätt/Hus
- [ ] Känt fel: avhuggen text i steget "Medlemskap i föreningen"
- [ ] Känt fel: saknade punkter och stavfel

#### S8 BRF-registret

- [ ] Normalläge med områdeskort
- [ ] Tomt område
- [ ] Tomt register
- [ ] Sökning med träffar, utan träffar
- [ ] Sortering och sidning
- [ ] Kvot (generell felsida)
- [ ] Känt fel: registerkvotens meddelande visas inte

#### S9 Område i registret

- [ ] Lista
- [ ] Tomt område
- [ ] Sökning utan träffar
- [ ] Området finns inte
- [ ] Kvot

#### S10 Föreningssida

- [ ] Normalläge
- [ ] Skannad rapport
- [ ] Äldre version
- [ ] Saknade nyckeltal
- [ ] Bara ett år (ingen årstabell)
- [ ] Omdirigerad slug
- [ ] Finns inte (404)
- [ ] Kvot
- [ ] Känt fel: "Kontakta oss" utan kontaktadress

#### S11 Föreningens fullständiga analys

- [ ] Normalläge
- [ ] Skannad / äldre version
- [ ] Behörighet nekad (vanlig sida)
- [ ] Året finns inte (404)
- [ ] Omdirigerad
- [ ] Kvot
- [ ] Inga spar- eller PDF-knappar

#### S12 Mitt konto

- [ ] Session laddas / utloggad (flytt)
- [ ] Hämtar listor
- [ ] Listfel med "Försök igen"
- [ ] Förstagångsanvändare: tre tomma kort med knappar
- [ ] Analysrad (Pågår, Klar, Misslyckades, betyg, adress saknas efter 12 månader)
- [ ] Värderingsrad (inklusive "Kan inte öppnas")
- [ ] Kalkylrad (inklusive spann)
- [ ] Export av sparad kalkyl: fel
- [ ] Dialog: ta bort analys
- [ ] Dialog: radera värdering
- [ ] Dialog: radera kalkyl
- [ ] Borttagning pågår, borttagningsfel
- [ ] Ladda ner mina uppgifter
- [ ] Logga ut
- [ ] Byt lösenord
- [ ] Radera konto: dialog, fel lösenord, kvot, oväntat fel, lyckat
- [ ] Känt fel: "Tar bort…" i alla dialoger
- [ ] Känt fel: fel lösenord ger "Fel e-postadress eller lösenord."

#### S13 Logga in

- [ ] Vanlig inloggning
- [ ] Inloggning för att spara
- [ ] Loggar in
- [ ] Fel uppgifter
- [ ] E-post inte bekräftad (ingen knapp för nytt mejl)
- [ ] Kvot
- [ ] Konton avstängda
- [ ] Oväntat fel
- [ ] Lyckat och omdirigering (`?till=`, `?spara=`)
- [ ] Redan inloggad

#### S14 Skapa konto

- [ ] Formulär
- [ ] Skickar
- [ ] För kort lösenord (webbläsaren)
- [ ] Svagt lösenord (servern)
- [ ] Ogiltig e-post
- [ ] Kvot
- [ ] Konton avstängda / oväntat fel
- [ ] "Kolla din e-post"
- [ ] Bekräftat i annan flik (fokus kontrollerar session)
- [ ] Redan inloggad

#### S15 Glömt lösenord

- [ ] Formulär
- [ ] Skickar
- [ ] Skickat (samma text oavsett om adressen finns)
- [ ] Ogiltig e-post
- [ ] Kvot
- [ ] Oväntat fel

#### S16 Bekräfta e-post / länk från mejl

- [ ] Ofullständig länk
- [ ] Redo: bekräfta konto
- [ ] Redo: återställ lösenord
- [ ] Kontrollerar
- [ ] Ogiltig eller använd länk
- [ ] Annan session aktiv
- [ ] Kvot / oväntat fel
- [ ] Konto bekräftat ("Fortsätt" / "Fortsätt och spara")
- [ ] Återställning lyckad, vidare till S17
- [ ] Länk i ny flik utan `?till=`

#### S17 Välj nytt lösenord

- [ ] Utloggad (flytt till inloggning)
- [ ] Efter återställningslänk
- [ ] Byte från Mitt konto (`?nuvarande=ja`)
- [ ] Nuvarande lösenord krävs
- [ ] Sparar
- [ ] För kort lösenord
- [ ] Svagt lösenord (servern)
- [ ] Fel nuvarande lösenord
- [ ] Kvot
- [ ] Sessionen gick ut
- [ ] Klart ("Lösenordet är ändrat")
- [ ] Oväntat fel
- [ ] Känt fel: fel nuvarande lösenord ger "Fel e-postadress eller lösenord."

#### S18 Integritet

- [ ] Normalläge
- [ ] Ingen kontaktadress ("kontakta oss")
- [ ] Känt fel: saknade kakor och Booli i texten
- [ ] Känt fel: "kontakta oss" utan kontaktadress

#### K1 Analysrapporten

- [ ] Fullständig rapport
- [ ] Adressen anonymiserad
- [ ] Utgångspris saknas ("Binfos värdering")
- [ ] Inga röda flaggor / röda flaggor
- [ ] Nyckeltal: status, ingen status, schablon, osäkert, "Viktigast här"
- [ ] Övrig info saknas
- [ ] Avgift ingår: "Framgår inte av årsredovisningen"
- [ ] Skannad rapport
- [ ] Äldre version
- [ ] Byggår: avviker, osäkert, från rapporten, okänt
- [ ] Våning okänd
- [ ] Värdering utan postnummer
- [ ] Inom länet men utanför Stockholms kommun
- [ ] Utanför länet (varningsruta)
- [ ] Låg tillförlitlighet
- [ ] Område okänt
- [ ] Prisjämförelse (neutral, över, under)
- [ ] Justerat värde saknas
- [ ] Skuldfri förening
- [ ] Lån som förfallit
- [ ] Räntestress: räntekänslighet saknas
- [ ] Räntestress: flikar bara med prognos
- [ ] Avgiftstryck (tre nivåer)
- [ ] Frågor: bockning sparas inte
- [ ] Ingen sammanfattning (äldre rapport)
- [ ] PDF: skapar / fel
- [ ] Kalkylknapp med förifyllning

#### K2 Spara-flödet

- [ ] Session laddas
- [ ] Utloggad med tips
- [ ] Utkast sparas och inloggning
- [ ] Kan inte spara utkast
- [ ] Skapa konto i mellantiden
- [ ] Inloggad sparar direkt
- [ ] Sparat
- [ ] Redan sparad
- [ ] Fel (gräns, ogiltig, kan inte sparas, kvot, generellt)
- [ ] Sessionen gick ut
- [ ] Återkomst efter inloggning
- [ ] Analys efter e-postbekräftelse (en analys flyttas)
- [ ] Analys efter lösenordsinloggning (hela enhetens historik flyttas)
- [ ] Någon annans analys: ingen knapp
- [ ] Kvot vid sparande av värdering

### 6.5 Användarresor

#### Resa A Förstagångsbesökare

- [ ] Startsida → "Analysera en bostad" → S2
- [ ] Alternativ: "Se ett exempel på en rapport" / "Se köpguiden"
- [ ] Fylla i Steg 1 (Boarea, Antal rum, Månadsavgift, Postnummer, Våning, Byggår, Utgångspris, Hiss, Balkong)
- [ ] Postnummerhjälp och PostNord-länk
- [ ] "Se värderingen" → resultat
- [ ] Gren: obligatoriska fält saknas ("Fyll i de obligatoriska fälten.")
- [ ] Gren: servern nekar (kvot) / allmänt fel ("Det gick inte att göra värderingen")
- [ ] Efter resultat: spara / steg 2 / kalkyl / köpguide

#### Resa B Uppladdning → rapport

- [ ] Välja PDF (klick, dra och släpp, "Ta bort")
- [ ] Gren: fel filtyp / för stor fil
- [ ] Fylla i Adress
- [ ] "Analysera" → "Skickar in…"
- [ ] Gren: saknade fält ("Fyll i de obligatoriska fälten, även i steg 1.")
- [ ] Väntskärm "Din analys pågår" (steg, förloppsstapel, tid, uppdatering var 5:e s)
- [ ] Rutor: "Skannad årsredovisning", "Analyseras redan", "Redan analyserad"
- [ ] Klar rapport "Din analys"
- [ ] Gren: "Analysen kunde inte slutföras" och dess orsaksrubriker
- [ ] Gren: "Vi hittar ingen analys med det här id:t"

#### Resa C Från registret

- [ ] Sök i /brf (träffar, tomt, "Rensa")
- [ ] Områdeskort → område (sortering, sök, sidor)
- [ ] Förening → föreningssida
- [ ] "Se hela analysen …" → fullständig analys
- [ ] Gren: åtkomst nekas / 404 / gammalt namn omdirigeras
- [ ] "Analysera en lägenhet i föreningen" → `?forening=`
- [ ] Kortet "Föreningens årsredovisning finns redan hos Binfo"
- [ ] Gren: föreningen hittas inte / kan inte hämtas → vanlig uppladdning
- [ ] "Analysera" utan PDF → rapport direkt

#### Resa D Booli-länk

- [ ] Klistra in länk, "Hämta uppgifter"
- [ ] Lyckad hämtning: fält fylls, markeringar "Hämtat från Booli", "Fanns inte i annonsen, fyll i själv", "Ändrat manuellt"
- [ ] Gren: fel domän / ogiltig länk / allmänt fel / avstängd / för många hämtningar
- [ ] Notis om Booli-blockeringen i produktion
- [ ] Hämtningen startar aldrig värdering eller analys

#### Resa E Skapa konto

- [ ] Logga in → "Skapa konto"
- [ ] Fylla i e-post och lösenord (minst 10 tecken)
- [ ] Gren: för kort lösenord / serverfel
- [ ] "Kolla din e-post"
- [ ] Mejl → länk → "Bekräfta e-postadressen"
- [ ] Gren: ofullständig, ogiltig eller utgången länk
- [ ] "Kontot är bekräftat" → "Fortsätt" / "Fortsätt och spara"
- [ ] Första fliken går vidare själv

#### Resa F Spara som utloggad

- [ ] Spara värdering ("Spara värderingen") utloggad → inloggning → tillbaka → "Din värdering är sparad i ditt konto."
- [ ] Spara kalkyl ("Spara kalkylen") utloggad → inloggning → tillbaka → "Din kalkyl är sparad i ditt konto."
- [ ] Spara analys ("Spara analysen") utloggad → inloggning → tillbaka → "Analysen är sparad i din profil."
- [ ] Inloggad sparar direkt ("Sparad i ditt konto.")
- [ ] Gren: utkastet finns inte kvar
- [ ] Gren: webbläsaren tillåter inte lagring
- [ ] Gren: uppgifterna inte kompletta
- [ ] Gren: gränsen för antal sparade objekt
- [ ] Gren: analysen kan inte flyttas till kontot
- [ ] Gren: någon annans analys visar ingen sparknapp

#### Resa G Mitt konto

- [ ] Logga in (fält, "Logga in", "Loggar in…")
- [ ] Gren: fel uppgifter / obekräftad e-post / för många försök
- [ ] Mitt konto: kort Analyser, Värderingar, Bolånekalkyler
- [ ] Öppna analys (klar → S4, ej klar → S3)
- [ ] "Ta bort från listan" (dialog)
- [ ] Öppna värdering → "Räkna om med dagens modell"
- [ ] "Radera" värdering (dialog)
- [ ] Öppna kalkyl → "Spara ändringarna" / "Spara som ny kalkyl"
- [ ] Exportera sparad kalkyl
- [ ] "Radera" kalkyl (dialog)
- [ ] Tomma listor med knappar
- [ ] Gren: listfel med "Försök igen"
- [ ] "Logga ut"

#### Resa H Glömt lösenord

- [ ] "Glömt lösenordet?" → formulär
- [ ] "Skicka återställningslänk" → bekräftelsetext
- [ ] Mejl → länk → "Välj nytt lösenord" → "Fortsätt"
- [ ] Gren: ogiltig länk → "Begär en ny länk"
- [ ] "Spara nytt lösenord" → "Lösenordet är ändrat"

#### Resa I Byta lösenord

- [ ] "Byt lösenord" → fälten Nuvarande och Nytt
- [ ] Gren: fel nuvarande lösenord (känt fel i texten)
- [ ] Gren: för kort lösenord / utgången session
- [ ] "Lösenordet är ändrat"

#### Resa J Ladda ner mina uppgifter

- [ ] "Ladda ner mina uppgifter" → fil `binfo-mina-uppgifter-<datum>.json`
- [ ] Gren: fel

#### Resa K Radera konto

- [ ] "Radera mitt konto" → dialog "Radera kontot?"
- [ ] Gren: fel lösenord / "Avbryt"
- [ ] Efter radering → startsidan
- [ ] Känt fel: "Tar bort…" i dialogen

#### Resa L Rapport → kalkyl

- [ ] "Räkna på månadskostnaden" i rapport
- [ ] Förifyllning (avgift, pris/lån, boarea, räntekänslighet) och hjälptexter
- [ ] Fylla i resten (inkomster, låntagare, "Vad ingår i avgiften?")
- [ ] Gren: tomma fält ger "—", "Vet ej" ger spann
- [ ] "Fördjupning" (räntescenarier, KALP, regler)
- [ ] Exportknappar PDF / Excel
- [ ] Spara kalkyl (se resa F)
- [ ] "Ladda ner som PDF" i rapporten
- [ ] Gren: PDF-fel

#### Resa M Köpguiden

- [ ] Öppna köpguiden
- [ ] Öppna/stänga steg
- [ ] "Markera klar" / "Klar", räknare och förloppsstapel
- [ ] Avbockningar sparas inte
- [ ] Länkar i tips till kalkyl och analys
- [ ] Känt fel: avhuggen text i "Medlemskap i föreningen"

#### Resa N Gammal länk

- [ ] Klar analys
- [ ] Pågående analys
- [ ] Misslyckad analys
- [ ] Okänt id / borttagen analys
- [ ] Äldre version / kan inte läsas ("behöver göras om")
- [ ] Indragen rapport
- [ ] Versionskonflikt
- [ ] Ingen inloggning krävs

#### Resa O Nekad uppladdning

- [ ] Fel filtyp
- [ ] För stor fil
- [ ] Ingen fil / saknade fält
- [ ] Kvot per enhet / nätverk
- [ ] Dagens gräns för tjänsten
- [ ] Paus (driftskäl)
- [ ] Skannad över 60 sidor
- [ ] Skannad som inte går att läsa
- [ ] Kostnadsgräns per rapport
- [ ] Saknar behörighet
- [ ] Nätverksfel
- [ ] Fel under körningen visas på väntskärmen
