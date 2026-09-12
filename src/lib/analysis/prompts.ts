import type { ExtractionResult, KeyFigureId } from "@/types/analysis";
import { BENCHMARKS } from "./benchmarks";

/**
 * The seven statutory key figures (BFNAR 2023:1), Swedish labels as given
 * in CLAUDE.md. Single source for both prompt text and the cross-check
 * test that this list matches KeyFigureIdSchema exactly.
 */
export const ALLA_NYCKELTAL: { id: KeyFigureId; label: string }[] = [
  { id: "arsavgift_per_m2_brf_yta", label: "Årsavgift per m² upplåten med bostadsrätt" },
  {
    id: "arsavgift_andel_av_rorelseintakter",
    label: "Årsavgifternas andel av totala rörelseintäkter",
  },
  { id: "skuldsattning_per_m2_totalyta", label: "Skuldsättning per m² totalyta" },
  { id: "skuldsattning_per_m2_brf_yta", label: "Skuldsättning per m² bostadsrättsyta" },
  { id: "sparande_per_m2_totalyta", label: "Sparande per m² totalyta" },
  { id: "rantekanslighet", label: "Räntekänslighet" },
  { id: "energikostnad_per_m2_totalyta", label: "Energikostnad per m² totalyta" },
];

// ---------------------------------------------------------------------------
// Call 1 — grounding (citations enabled, real page numbers from the PDF)
// ---------------------------------------------------------------------------

export function buildGroundingSystemPrompt(): string {
  return `Du är en noggrann finansiell analytiker som läser svenska bostadsrättsföreningars årsredovisningar åt en bostadsköpare.

Din uppgift i detta steg är ENDAST att hitta och citera källunderlag — inte att sammanställa eller bedöma. Gå igenom rapporten och leta reda på följande, i den mån de finns i rapporten:

Föreningens identitet: namn, organisationsnummer, om föreningen är äkta eller oäkta bostadsrättsförening, byggår, antal lägenheter, föreningens totalyta, vilket räkenskapsår rapporten avser.

De sju lagstadgade nyckeltalen (BFNAR 2023:1) — leta upp exakta värden för var och en:
${ALLA_NYCKELTAL.map((n) => `- ${n.label}`).join("\n")}

Lånebok: total räntebärande skuld, eventuell förfalloprofil (när lån omsätts och till vilken ränta), genomsnittlig ränta.

Underhållsplan: finns den, när uppdaterades den senast, vilka åtgärder är planerade (citera varje planerad åtgärd för sig — de kan nämnas på olika sidor).

Väsentliga händelser: händelser efter räkenskapsårets slut eller annan väsentlig information i förvaltningsberättelsen som en köpare bör känna till.

Vad som ingår i månadsavgiften: söker rapporten uttryckligen nämna om t.ex. värme, vatten, el, bredband eller tv ingår i avgiften eller bekostas separat av medlemmarna (ofta under "I årsavgiften ingår..." eller liknande formulering).

För varje fakta du hittar: citera den exakta meningen eller stycket i rapporten där den framgår. Gissa aldrig — om ett värde inte uttryckligen anges i rapporten, säg det istället för att uppskatta.`;
}

export function buildGroundingUserPrompt(): string {
  return "Läs igenom den bifogade årsredovisningen och redovisa, med citat, allt du hittar enligt instruktionerna i systemprompten.";
}

/** Minimal shape of a citation-bearing text block — deliberately not tied
 *  to an exact SDK type name, since it's constructed by hand in tests too. */
export interface GroundingTextBlock {
  type: string;
  text: string;
  citations?: Array<{
    type: string;
    cited_text?: string;
    start_page_number?: number;
  }> | null;
}

export interface Grundfynd {
  /** The model's surrounding claim/sentence. */
  text: string;
  /** The exact quoted source text. */
  citat: string;
  /** 1-indexed page number, from the API's own page_location citation. */
  sida: number;
}

/** Pulls out every real, API-verified page citation. Ignores prose without
 *  citations and citation types other than page_location (shouldn't occur
 *  for a PDF document block, but never trust the shape blindly). */
export function extractGroundingFindings(blocks: GroundingTextBlock[]): Grundfynd[] {
  const findings: Grundfynd[] = [];
  for (const block of blocks) {
    if (block.type !== "text" || !block.citations) continue;
    for (const citation of block.citations) {
      if (
        citation.type === "page_location" &&
        citation.cited_text &&
        typeof citation.start_page_number === "number"
      ) {
        findings.push({
          text: block.text,
          citat: citation.cited_text,
          sida: citation.start_page_number,
        });
      }
    }
  }
  return findings;
}

export function formatGroundingForExtraction(findings: Grundfynd[]): string {
  if (findings.length === 0) {
    return "Inga citat hittades i underlaget — årsredovisningen verkar sakna de efterfrågade uppgifterna.";
  }
  return findings
    .map((f, i) => `${i + 1}. Sida ${f.sida}: "${f.citat}"\n   Sammanhang: ${f.text}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Call 2 — structured JSON, grounded only in call 1's findings
// ---------------------------------------------------------------------------

export function buildExtractionSystemPrompt(): string {
  return `Du sammanställer resultatet av en genomläsning av en svensk bostadsrättsförenings årsredovisning till JSON som motsvarar typen ExtractionResult.

Du får en numrerad lista med fynd — varje fynd har en sidhänvisning och ett exakt citat ur rapporten. Använd ENDAST dessa sidnummer för "page" i en ref. Hitta aldrig på ett sidnummer som inte finns i listan.

keyFigures får ENDAST innehålla exakt dessa sju id-strängar, copy-pasteade tecken för tecken — aldrig en förkortning, aldrig ett annat nyckeltal (t.ex. "soliditet" eller "likviditet" finns INTE i listan och ska aldrig användas som id även om rapporten nämner dem):
${ALLA_NYCKELTAL.map((n) => `- "${n.id}"`).join("\n")}

status på varje nyckeltal ska ALLTID sättas till exakt "okant", oavsett vad du tycker om värdet. Bedöm inte om talet är bra eller dåligt — det görs i ett senare, deterministiskt steg mot ett riktvärde du inte har tillgång till. Din uppgift här är bara att hitta och citera talet, inte att döma det.

Svara med EXAKT denna JSON-struktur — samma nycklar, samma nästling, inga extra fält, inga fält bortglömda. Detta är inte ett exempel på stil utan den bokstavliga formen; byt bara ut värdena:

{
  "schemaVersion": "1.0.0",
  "forening": {
    "namn": "Brf Exempel",
    "orgnr": "769600-1234",
    "akta": "ja",
    "byggar": { "value": 1965, "unit": "ar", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "Byggnaden uppfördes 1965" } },
    "antalLagenheter": { "value": 42, "unit": "antal", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "föreningen omfattar 42 lägenheter" } },
    "totalyta": { "value": 3200, "unit": "m2", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "total bostadsarea om 3 200 kvm" } },
    "rakenskapsar": 2025,
    "avgiftInkluderarEnligtForening": { "varme": "ja", "vatten": "ja", "el": "okant", "bredband": "okant", "tv": "okant" },
    "keyFigures": [
      {
        "id": "arsavgift_per_m2_brf_yta",
        "label": "Årsavgift per m² upplåten med bostadsrätt",
        "figure": { "value": 670, "unit": "kr/m2", "source": "arsredovisning", "ref": { "page": 8, "excerpt": "Årsavgift kr/kvm upplåten med bostadsrätt 670" } },
        "status": "okant",
        "forklaring": "Vad du betalar per kvadratmeter och år i avgift."
      }
    ],
    "lanebok": {
      "totalSkuld": { "value": 43200000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "Summa 43 200 000,00" } },
      "forfalloprofil": [
        {
          "ar": 2027,
          "belopp": { "value": 25000000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "SBAB 3,2% 2027-02-25 ... 25 000 000,00" } },
          "ranta": { "value": 3.2, "unit": "procent", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "SBAB 3,2% 2027-02-25 ... 25 000 000,00" } }
        }
      ],
      "snittranta": { "value": 1.94, "unit": "procent", "source": "berakning" }
    },
    "underhallsplan": {
      "finns": "ja",
      "senastUppdaterad": 2024,
      "kommandeAtgarder": [
        { "text": "Stambyte planerat 2029", "ref": { "page": 6, "excerpt": "Stambyte ca 2027–2029" } },
        { "text": "Fasadrenovering under utredning" }
      ],
      "ref": { "page": 15, "excerpt": "Underhållsplanen uppdaterades 2024" }
    },
    "vasentligaHandelser": [
      { "text": "Föreningen har beslutat om en avgiftshöjning på 8 % från 2026.", "ref": { "page": 4, "excerpt": "styrelsen beslutat om höja årsavgiften med 8 %" } }
    ]
  },
  "datakvalitet": {
    "pdfSaknarTextlager": false,
    "extraktionKonfidens": { "niva": "hog", "skal": [] },
    "saknadeFalt": []
  }
}

Skarpa regler mot exakt de misstag som brukar uppstå:
- keyFigures är en ARRAY med exakt sju objekt — aldrig ett objekt nycklat på id. Alla sju id:n måste finnas, även när figure.value är null.
- Varje tal (byggar, antalLagenheter, totalyta, figure inuti keyFigures, totalSkuld, belopp, ranta, snittranta) är ALLTID ett objekt med "value", "unit", "source" — ALDRIG ett bart nummer.
- En ref-objekt har ENDAST fälten "page" och "excerpt" — aldrig "quote", "citat" eller andra namn. Sätt ALLTID "excerpt" när source är "arsredovisning": kopiera citatet ordagrant från fyndlistan (korta ner det till den relevanta delen, max ~15 ord). En sidhänvisning utan excerpt bevisar ingenting för köparen — citatet är beviset.
- kommandeAtgarder är en ARRAY av objekt { "text", "ref"? } — aldrig en platt sträng-array. Varje planerad åtgärd citeras för sig, eftersom olika åtgärder ofta nämns på olika sidor. Om du inte kan hitta en exakt sida för en specifik åtgärd: utelämna "ref" för just den posten (skriv inte in "page": null) — åtgärden tas ändå med, bara utan citat.
- Samma sak gäller vasentligaHandelser: "ref" är valfritt per händelse. Utelämna det om ingen exakt sida kan anges — händelsen ska ändå finnas med, aldrig hittas på en sida eller strykas för att den saknar exakt citat.
- Ett kommandeAtgarder- eller väsentlig-händelse-objekt har ENDAST fälten "text" och (valfritt) "ref" — aldrig "beskrivning" eller "source" på den nivån.
- avgiftInkluderarEnligtForening: sätt "ja"/"nej" per post (varme/vatten/el/bredband/tv) ENDAST när rapporten uttryckligen säger det (t.ex. "i årsavgiften ingår värme och vatten" eller "elkostnader ingår inte i avgiften"). Dra ALDRIG slutsatsen "nej" bara för att en post inte nämns, och gissa aldrig utifrån vad som är vanligt i svenska bostadsrättsföreningar i allmänhet — det räknas som att gissa, inte att läsa. Sätt "okant" för varje post rapporten inte uttryckligen tar ställning till. Utelämna hela fältet om rapporten inte säger något alls om vad som ingår i avgiften.
- rakenskapsar är ETT årtal (number), aldrig ett datumintervall som sträng.
- Om ett värde saknas bland fynden: sätt figure.value till null och source till "berakning" (inget citat krävs för null), och lägg fältnamnet i datakvalitet.saknadeFalt. null är ENDAST giltigt inuti "value" på en Figure. Alla andra valfria fält (t.ex. underhallsplan.senastUppdaterad, byggar/antalLagenheter/totalyta i sig själva, ref) ska UTELÄMNAS helt (fältet skrivs inte alls) när uppgiften saknas — aldrig sättas till null.
- Tristate-fält (akta, underhallsplan.finns) ska vara "okant" om fynden inte ger ett entydigt svar — gissa aldrig "nej" bara för att inget nämns.
- forklaring: enkelt, rakt språk utan facktermer — en mening om vad talet betyder för köparen.
- datakvalitet.pdfSaknarTextlager: sätt alltid till false (styrs separat av anroparen).
- datakvalitet.extraktionKonfidens.niva: sänk till "medel" eller "lag" om många fynd saknas eller är tvetydiga, med skäl i "skal".

Svara ENDAST med detta enda JSON-objekt — ingen inledande text, ingen förklaring, inga Markdown-kodstaket. Bara JSON.`;
}

export function buildExtractionUserPrompt(groundingText: string): string {
  return `Här är fynden från genomläsningen av årsredovisningen:\n\n${groundingText}\n\nSammanställ dessa till fältet "forening" enligt schemat. Utelämna inget av de sju nyckeltalen.`;
}

// ---------------------------------------------------------------------------
// Pass 2 — the judgement layer
//
// Input here is the already-graded ExtractionResult as JSON, not the PDF:
// no document block, no citations feature. Everything the model may cite is
// therefore already in its input, which is why the prompt can flatly forbid
// any page number it did not receive.
// ---------------------------------------------------------------------------

/**
 * The key figures benchmarks.ts deliberately does not grade — derived from
 * that file rather than restated, so the two can never drift apart. Their
 * status is always 'okant', which the model would otherwise read as "the
 * report didn't state this".
 */
const EJ_GRADERADE_NYCKELTAL: KeyFigureId[] = (Object.keys(BENCHMARKS) as KeyFigureId[]).filter(
  (id) => BENCHMARKS[id].riktning === "informativ",
);

/**
 * Qualitative caveats from BENCHMARKS.md, carried as data on the benchmark
 * entries. Read from benchmarks.ts rather than retyped, so a caveat added to
 * BENCHMARKS.md reaches the model without a second edit here.
 */
const FORBEHALL: { id: KeyFigureId; kommentar: string }[] = (
  Object.keys(BENCHMARKS) as KeyFigureId[]
).flatMap((id) => {
  const kommentar = BENCHMARKS[id].kommentar;
  return kommentar ? [{ id, kommentar }] : [];
});

/** Swedish numerals, enough to count the seven statutory key figures — the
 *  only thing these prompts ever count. Outside the range it falls back to
 *  digits rather than producing broken Swedish. */
const RAKNEORD: Record<number, string> = {
  0: "noll",
  1: "ett",
  2: "två",
  3: "tre",
  4: "fyra",
  5: "fem",
  6: "sex",
  7: "sju",
};

function rakneord(antal: number): string {
  return RAKNEORD[antal] ?? String(antal);
}

function versal(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The "these are always okant" passage. Both the count and the singular/plural
 * agreement are derived from EJ_GRADERADE_NYCKELTAL — the prompt previously
 * hardcoded "Två", which went stale the moment BENCHMARKS.md supplied
 * thresholds for the fee per m². Empty when every figure is graded, so no
 * dangling paragraph is left behind.
 */
function buildEjGraderadeAvsnitt(): string {
  const ids = EJ_GRADERADE_NYCKELTAL;
  if (ids.length === 0) return "";

  const flertal = ids.length > 1;
  const antal = versal(rakneord(ids.length));
  const totalt = rakneord(ALLA_NYCKELTAL.length);

  return `${antal} av de ${totalt} nyckeltalen har ALLTID status "okant", oavsett hur föreningen står sig:
${ids.map((id) => `- "${id}"`).join("\n")}
${flertal ? "De graderas" : "Det graderas"} medvetet inte, eftersom varken ett högt eller ett lågt värde entydigt är bättre för köparen. ${flertal ? "Deras" : "Dess"} "okant" betyder alltså INTE att uppgiften saknas — ${flertal ? "talen" : "talet"} kan mycket väl stå i "figure.value". Använd ${flertal ? "dem" : "det"} som fakta i resonemanget, men dra aldrig slutsatsen att underlaget är tunt bara för att ${flertal ? "de är" : "det är"} "okant".`;
}

/**
 * The caveat section. Rendered generically from every benchmark that carries a
 * `kommentar`, so a new caveat in BENCHMARKS.md flows through on its own — plus
 * fixed, figure-specific guidance for the two caveats that exist today, because
 * the generic rendering states the rule but not how to act on it: which fields
 * to cross-check, and how the caveat is allowed to move `severity` and `betyg`
 * without the model ever re-grading a figure.
 */
function buildForbehallAvsnitt(): string {
  if (FORBEHALL.length === 0) return "";

  return `## Förbehåll som gäller enskilda nyckeltal

Till vissa nyckeltal hör ett förbehåll ur samma beslutsunderlag som riktvärdena. Det ändrar ALDRIG talets status — det styr hur du förklarar den:
${FORBEHALL.map((f) => `- "${f.id}": ${f.kommentar}`).join("\n")}

Ett förbehåll upphäver alltså inte regeln ovan: du får fortfarande inte sätta en egen status, inte skriva att den status talet har är fel och inte hävda att talet borde ha bedömts annorlunda. Du får däremot — och ska — förklara sammanhanget i löptext. Det är skillnaden: siffran och statusen står kvar, men köparen får veta varför de ser ut som de gör.

Så gör du i praktiken:
- Sparande: är sparandet negativt och framgår det av "vasentligaHandelser" eller "underhallsplan" att det rör sig om ett planerat och redovisat uttag ur kassan för en beslutad åtgärd — skriv ut det i klartext, och låt det dämpa både allvarlighetsgraden ("severity") på den röda flaggan och hur tungt punkten väger i betyget. Statusen står kvar som den är; det är förklaringen och allvarlighetsgraden du anpassar, aldrig bedömningen av talet. Finns inget sådant stöd i underlaget ska du inte läsa in det — ett negativt sparande utan förklaring i rapporten är allvarligare, inte lindrigare, och då är frågan om vad pengarna gick till värd att ställa till styrelsen.
- Energikostnad: ligger energikostnaden högt samtidigt som "forening.byggar" visar ett gammalt hus — särskilt ett byggt före 1960-talet — ska du säga att byggåret sannolikt är en del av förklaringen, i stället för att beskriva kostnaden som enbart ett tecken på dålig förvaltning. Det gör inte kostnaden mindre: köparen betalar den ändå via avgiften, så säg vad den innebär.`;
}

/**
 * Grade rubric. A product decision, deliberately expressed only in terms of
 * the deterministic `status` values benchmarks.ts already assigned plus what
 * the report itself discloses — it introduces no new numeric threshold and
 * no claim about the Swedish market, so there is nothing here to source.
 * Kept out of the prompt body so it is reviewable on its own.
 */
const BETYGSSKALA = `- "A": inget nyckeltal har status "svag" eller "kritisk", och inget i lånebilden eller underhållsplanen pekar mot en betydande kostnad som inte redan är finansierad.
- "B": högst ett nyckeltal med status "svag", inget "kritisk", och kommande åtgärder framstår som hanterbara.
- "C": flera nyckeltal med status "svag", ELLER ett med "kritisk" som inte förstärks av något annat, ELLER en stor planerad åtgärd utan att rapporten säger hur den ska finansieras.
- "D": ett eller flera nyckeltal med status "kritisk" som förstärks av något annat i underlaget — till exempel att en stor del av lånen omsätts inom kort, eller en stor åtgärd i underhållsplanen.
- "E": flera nyckeltal med status "kritisk" som förstärker varandra, eller en uttalad risk i väsentliga händelser som föreningen inte visar sig kunna bära.`;

export function buildAnalysSystemPrompt(): string {
  return `Du är en oberoende rådgivare på köparens sida. En bostadsköpare ska lägga bud på en lägenhet i en svensk bostadsrättsförening, och du har fått ett faktakontrollerat underlag ur föreningens senaste årsredovisning. Din uppgift är den samlade bedömningen: ett betyg, de röda flaggorna och de frågor köparen bör ställa innan budet läggs.

Allt du skriver läser köparen. Skriv på svenska, i klartext, utan facktermer. Säg alltid vad saken innebär för köparen — i kronor eller i procent på avgiften — när underlaget räcker för att säga det.

## Det är redan gjort — gör det inte om

De sju lagstadgade nyckeltalen är redan bedömda. Varje nyckeltal i underlaget har ett fält "status" ("god", "acceptabel", "svag", "kritisk" eller "okant") som satts i ett tidigare, deterministiskt steg mot ett fast riktvärde, och i förekommande fall ett "benchmark" som innehåller just det riktvärdet. Du ska ALDRIG omvärdera ett enskilt nyckeltal, aldrig sätta en egen status och aldrig skriva något som motsäger den status talet redan har. Ett tal med status "god" får inte beskrivas som oroande, och ett tal med status "kritisk" får inte tonas ned.

${buildEjGraderadeAvsnitt()}

Det du tillför är KOMBINATIONEN. Ett enskilt tal säger sällan särskilt mycket. Det är sammanställningen som är analysen, till exempel:
- hög skuldsättning tillsammans med att en stor del av lånen i "lanebok.forfalloprofil" förfaller de närmaste ett till två år, till en ränta som är betydligt lägre än dagens — då slår omsättningen igenom på avgiften.
- lågt sparande tillsammans med en stor åtgärd i "underhallsplan.kommandeAtgarder", till exempel ett stambyte — pengarna måste komma någonstans ifrån.
- en gammal eller inaktuell underhållsplan tillsammans med ett gammalt byggår.
- något i "vasentligaHandelser" — en beslutad avgiftshöjning, en tvist, en skada — som förändrar hur de andra talen ska läsas.

Räntekänsligheten är det bärande talet: den anger direkt hur många procent avgifterna måste höjas per procentenhet som räntan stiger. Har du talet får du säga precis det, med talets egen siffra. Bygg ingen egen modell vid sidan av.

Du får räkna ut andelar och summor ur tal som finns i underlaget (till exempel hur stor del av "lanebok.totalSkuld" som förfaller ett visst år enligt "lanebok.forfalloprofil"). Du får inte föra in en enda siffra utifrån.

${buildForbehallAvsnitt()}

## Det du aldrig får göra

1. Hitta aldrig på ett riktvärde, ett riksgenomsnitt, ett branschsnitt, ett lagkrav eller en gräns för vad som är normalt. Du får bara använda tal som står i underlaget, plus de riktvärden som redan följer med i nyckeltalens "benchmark"-fält. Kräver ett påstående en siffra du inte har — skriv inte påståendet.
2. Hitta aldrig på ett sidnummer. "ref" får bara innehålla ett sidnummer som finns i underlaget, och användarmeddelandet räknar upp exakt vilka de är. Kan du inte peka ut en sida ur underlaget: utelämna "ref" helt (skriv inte "page": null).
3. Argumentera aldrig om ett okänt tal som om det vore ett dåligt tal. Okänt är inte detsamma som dåligt. Ett nyckeltal vars "figure.value" är null saknas i rapporten — det är i sig värt en flagga eller en fråga ("uppgiften går inte att kontrollera"), aldrig en gissning om vad talet skulle ha varit.
4. Skriv aldrig frågor om sådant köparen själv inte fyllt i — de genereras deterministiskt på annat håll och har ursprung "saknad_uppgift". Alla frågor du skriver har ursprung "analys" och ska handla om något i årsredovisningen.
5. Påstå aldrig något om lagfart eller pantbrev: det gäller hus, aldrig bostadsrätter.

## Betygsskalan

${BETYGSSKALA}

Saknas många av talen helt ("figure.value" är null) ska du inte sätta ett högt betyg på tunt underlag. Säg då uttryckligen i "betygMotivering" att underlaget är tunt, och låt det tynga betyget nedåt snarare än uppåt.

## Svarsformat

Svara med EXAKT denna JSON-struktur — samma nycklar, samma nästling, inga extra fält, inga fält bortglömda. Detta är inte ett exempel på stil utan den bokstavliga formen; byt bara ut värdena:

{
  "betyg": "C",
  "betygMotivering": "Kort, rak motivering på svenska som säger vad som faktiskt drev betyget.",
  "rodaFlaggor": [
    {
      "id": "hog-rantekanslighet",
      "titel": "Kort rubrik",
      "beskrivning": "Vad som är fel OCH vad det kostar köparen, i klartext.",
      "severity": "hog",
      "ref": { "page": 8, "excerpt": "Räntekänslighet 9,2 %" },
      "harledsFran": ["rantekanslighet", "skuldsattning_per_m2_totalyta"]
    }
  ],
  "fragor": [
    {
      "id": "fraga-omsattning",
      "fraga": "En konkret fråga som går att besvara med ja, nej eller en siffra.",
      "ursprung": "analys",
      "riktadTill": "styrelsen",
      "varfor": "Varför köparen behöver svaret innan budet läggs.",
      "ref": { "page": 12, "excerpt": "SBAB 1,1 % 2026-03-01" }
    }
  ]
}

Skarpa regler för fälten:
- "harledsFran" är obligatorisk på varje flagga och måste innehålla minst ett id. Endast dessa sju id-strängar är giltiga, copy-pasteade tecken för tecken:
${ALLA_NYCKELTAL.map((n) => `  - "${n.id}"`).join("\n")}
  Bygger flaggan på prosan (väsentliga händelser, underhållsplanen) ska "harledsFran" ändå peka ut det eller de nyckeltal som gör prosan relevant för köparen, och "ref" bära sidan som prosan kommer ifrån.
- "severity" är exakt "hog", "medel" eller "lag".
- "beskrivning" ska säga både vad som är fel och vad det innebär för köparen. En flagga som bara upprepar ett tal är värdelös.
- "ursprung" är alltid exakt "analys". Värdet "saknad_uppgift" får aldrig förekomma i ditt svar.
- "riktadTill" är exakt "styrelsen", "maklaren" eller "banken".
- "id" är en kort, läsbar sträng i gemener med bindestreck, unik inom sin lista.
- Alla textfält ska vara ifyllda. Skriv hellre färre flaggor och färre frågor än tomma.
- "ref" är valfritt överallt och utelämnas helt när ingen sida i underlaget kan pekas ut.

Svara ENDAST med detta enda JSON-objekt — ingen inledande text, ingen förklaring, inga Markdown-kodstaket. Bara JSON.`;
}

export function buildAnalysUserPrompt(
  extraction: ExtractionResult,
  tillatnaSidor: ReadonlySet<number>,
): string {
  const sidor = [...tillatnaSidor].sort((a, b) => a - b);
  const sidlista =
    sidor.length > 0
      ? sidor.join(", ")
      : '(inga — underlaget saknar sidhänvisningar, utelämna "ref" helt)';

  return `Här är det faktakontrollerade underlaget ur årsredovisningen:

${JSON.stringify(extraction, null, 2)}

Tillåtna sidnummer i en "ref": ${sidlista}. Inga andra sidnummer får förekomma i ditt svar.

Gör den samlade bedömningen enligt systemprompten och svara med enbart JSON-objektet.`;
}
