import type { ExtractionResult, Grade, KeyFigureId, Severity } from "@/types/analysis";
import { BENCHMARKS } from "./benchmarks";
import { beraknaFastaVarden, formateraFastaVarden, type FastaVarden } from "./fastaVarden";

/**
 * Del av cachenyckeln (pdf_hash, model, prompt_version) i Supabase-cachen.
 * Höjs för hand varje gång texten i någon av promptbyggarna nedan ändras —
 * annars fortsätter cachen att träffa på svar som togs fram med en gammal
 * prompt. Se prompts.test.ts, som larmar om utdatan ändras utan att detta
 * värde höjs.
 */
export const PROMPT_VERSION = "10";

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

FÖRST, och alltid: de sju lagstadgade nyckeltalen (BFNAR 2023:1) — leta upp exakta värden för var och en och redovisa dem före allt annat i ditt svar:
${ALLA_NYCKELTAL.map((n) => `- ${n.label}`).join("\n")}
Nyckeltalen är det viktigaste underlaget i hela rapporten och står oftast samlade i flerårsöversikten i förvaltningsberättelsen (en tabell med en kolumn per år) — leta alltid upp den tabellen och citera varje nyckeltal du hittar där, oavsett hur mycket annat du också letar efter.
Skuldsättning per kvm: anger rapporten bara ett enda skuldtal per kvm utan att tydligt skilja på totalyta och bostadsrättsyta (t.ex. "Lån per kvm bostadsyta, kr 2 284" eller "Skuldsättningsgrad kr/kvm 3 089"), citera det ändå — det ska redovisas som skuldsättning per m² bostadsrättsyta (skuldsattning_per_m2_brf_yta), inte utelämnas.

Föreningens identitet: namn, organisationsnummer, om föreningen är äkta eller oäkta bostadsrättsförening, byggår, antal lägenheter, föreningens totalyta och bostadsrättsyta (två olika tal: all yta respektive ytan upplåten med bostadsrätt), vilket räkenskapsår rapporten avser och räkenskapsårets sista dag (balansdagen).

Byggår är året byggnaden uppfördes ("uppfördes", "byggnadsår", "byggår"). Citera INTE "värdeår" som byggår — värdeår är året fastighetens värde fastställdes och är ofta ett annat år. Anger rapporten bara värdeår: citera det och säg uttryckligen att det är värdeår.

Antal medlemmar: föreningens medlemsantal VID RÄKENSKAPSÅRETS SLUT. Rapporter skriver ofta detta som "Föreningen hade vid årets slut 43 (41) medlemmar" — då är 43 talet att citera (nuvarande år), inte jämförelsetalet inom parentes (föregående år). Blanda inte ihop detta med ett annat tal som råkar stå nära ordet "medlemmar" i en annan mening (t.ex. ett årtal, ett styrelsemöte eller ett antal ledamöter) — citera bara meningen som uttryckligen anger det totala medlemsantalet. Vissa rapporter (särskilt från Riksbyggen i denna typ av underlag) anger bara antal lägenheter, aldrig medlemsantal — säg då inget om medlemsantal.

Antal hyresrätter och antal lokaler: leta efter hur många av föreningens enheter som är hyresrätter respektive lokaler (kontor, butik, förråd som föreningen hyr ut eller äger som lokal — INTE gemensamhetsutrymmen som "föreningslokal" eller "samlingslokal", och INTE en areauppgift i kvadratmeter som råkar innehålla ordet "lokal" eller "garagelokal"). En lokal nämns ibland med sin upplåtelseform i samma mening, t.ex. "2 lokaler (hyresrätt)" — citera då både antalet och att det är hyresrätt. Räkna bara enheter rapporten uttryckligen anger som lokaler eller hyresrätter; gissa aldrig utifrån vad som är vanligt.

Lånebok: total räntebärande skuld, genomsnittlig ränta och föreningens räntekostnader för året (resultaträkningens "Räntekostnader och liknande resultatposter" i kronor). Citera VARJE enskilt lån i lånenoten för sig, hela raden: kreditgivare, räntesats, villkorsändringsdag (även kallad konverteringsdag, förfallodag eller "bundet till") och skuld vid räkenskapsårets slut — och om raden anger rörlig eller bunden ränta. Säger rapporten uttryckligen att föreningen är skuldfri eller saknar räntebärande skulder — citera den meningen, den är själva svaret på "total räntebärande skuld".

Total räntebärande skuld är summan av BÅDE den långfristiga och den kortfristiga delen av lånen (t.ex. "Skulder till kreditinstitut" under långfristiga skulder PLUS "Skulder till kreditinstitut" eller "Kortfristig del av skuld" / "Kortfr. del av skuld" under kortfristiga skulder). Vissa föreningar bokför lånet under en annan rubrik, t.ex. "Övriga skulder" med en not som visar att det är ett lån — leta då upp både posten i balansräkningen och noten, och citera båda delarna var för sig. Står en tryckt totalsumma för lånen (t.ex. i en låne-not), citera den också.

Kontrollsummor — citera dessa särskilt, de används för att kontrollera att siffrorna hänger ihop: "Summa tillgångar" och "Summa eget kapital och skulder" (balansräkningen), årets årsavgifter (intäkten "Årsavgifter" i resultaträkningen, i kronor), föreningens bostadsrättsyta i kvadratmeter (ytan upplåten med bostadsrätt) och de räntebärande skulderna.

Underhållsplan: finns den, när uppdaterades den senast, vilka åtgärder är planerade (citera varje planerad åtgärd för sig — de kan nämnas på olika sidor).

Väsentliga händelser: händelser efter räkenskapsårets slut eller annan väsentlig information i förvaltningsberättelsen som en köpare bör känna till.

Vad som ingår i månadsavgiften: söker rapporten uttryckligen nämna om t.ex. värme, vatten, el, bredband eller tv ingår i avgiften eller bekostas separat av medlemmarna (ofta under "I årsavgiften ingår..." eller liknande formulering, t.ex. "I årsavgiften ingår kostnader för bredband, el, kabel-tv, vatten och värme" eller en explicit uteslutning som "Kostnader för medlemmarnas elförbrukning ingår inte i årsavgiften"). Citera var i rapporten varje sådan post uttryckligen nämns, en post i taget — olika poster nämns ofta i olika meningar eller på olika sidor. VIKTIGT: en mening om föreningens EGEN fastighetsförsäkring (t.ex. "X ingår ej i föreningens fastighetsförsäkring") handlar INTE om vad som ingår i medlemmarnas avgift — citera den aldrig som ett svar på om en post ingår i avgiften.

Individuell mätning (IMD): letar rapporten uttryckligen nämna att el, vatten eller värme mäts och debiteras individuellt per lägenhet (t.ex. "Kostnader för el ... tas ut via årsavgiften genom individuell mätning" eller "I begreppet årsavgift ingår inte IMD-avgifter"). Citera vilken specifik post (el, vatten eller värme) det gäller — om rapporten bara nämner "IMD" utan att säga vilken förbrukning det avser, notera det men koppla det inte till fel post.

Föreningens fastighet(er) och adress(er): fastighetsbeteckning(ar) (t.ex. "Pontonjären 3") och gatuadress(er) till föreningens egna byggnader, med postnummer och ort när rapporten anger dem (t.ex. "Föreningen äger fastigheten Pontonjären 3 på Baltzar von Platens gata 6 i Stockholm"). Det är föreningens EGNA fastighet som avses — inte förvaltarens, revisorns, styrelseledamöternas eller en banks adress, och inte en c/o-adress för post. Anger rapporten ingen: säg det, gissa aldrig.

Till sist, underlag för kommande avgiftsändringar (citera bara det som faktiskt står): planerade underhållskostnader som har ett BELOPP och hur de ska finansieras (nytt lån, fonden eller ett beslut), fondens saldo vid årets slut ("Fond för yttre underhåll") och den planerade årliga avsättningen; om ett negativt resultat eller uttag ur fonden är planerat och hur det finansieras; hyresintäkter från lokaler under året och hyresavtal för lokaler med slutdatum (och årshyra om den anges); namngivna energiprojekt (t.ex. solceller, bergvärme) med belopp och finansiering.

Underhåll och investeringsbehov, allra sist: (a) rapportens "investeringsbehov per kvm" / "genomsnittligt investeringsbehov" i kr per kvm och år (HSB-rapporter redovisar det ofta som ett nyckeltal), (b) vad underhållsplanen säger att föreningen BÖR avsätta per år (rekommenderad avsättning, skild från den faktiska avsättningen enligt stadgarna), (c) en uttalad total för underhållsplanen över ett antal år (t.ex. "underhållsplanen omfattar 45 Mkr under 30 år"), och (d) större åtgärder som REDAN är genomförda, med årtal — stambyte (även relining), takomläggning/takbyte, fasadrenovering/omputsning, fönsterbyte, ventilation (ny FTX/ventilationsaggregat), elstigare/elcentraler och hissbyte/hissmodernisering. Leta i förvaltningsberättelsen, i tabeller över "tidigare genomförda åtgärder"/"utfört underhåll" och i noterna; citera varje åtgärd för sig med dess årtal. Ta inte med planerade åtgärder, och inte enbart OVK (obligatorisk ventilationskontroll).

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
// Transcription of a scanned report (transkribering.ts) — one call per chunk
// of pages, the PDF as a native document block WITHOUT citations. Its output is
// what grounding later cites (custom-content document), so the page markers
// are the only source of page numbers: transkribering.ts validates them.
// ---------------------------------------------------------------------------

/**
 * Version of the transcription prompts below. Stored with every transcribed
 * page (`sidtext.kalla`, "transkribering:v<version>") so a page is reused for
 * another rapport of the SAME bytes only when it was written with the same
 * prompt. Bump it by hand whenever `buildTranskriberingSystemPrompt` or
 * `buildTranskriberingUserPrompt` changes (prompts.test.ts fails otherwise).
 * Independent of PROMPT_VERSION: a PROMPT_VERSION bump for the extraction or
 * judging prompts must NOT make an already paid-for transcription stale.
 */
export const TRANSKRIPTION_PROMPT_VERSION = "1";

export function buildTranskriberingSystemPrompt(): string {
  return `Du är en exakt transkriberare av skannade svenska årsredovisningar. Du ska skriva av texten på varje sida ordagrant, inget annat.

Regler:
- Transkribera VARJE sida i dokumentet, i läsordning, ordagrant. Sammanfatta, tolka och rätta ingenting.
- Tabeller skrivs som rader med " | " mellan cellerna, en tabellrad per rad, med kolumnrubrikerna (t.ex. årtalen) överst. Behåll tomma celler som tomma.
- Siffror skrivs EXAKT som de är tryckta: behåll mellanslag som tusentalsavgränsare ("12 867 450"), decimalkomma ("10,19"), minustecken, parenteser, "tkr", "neg", "-" och procenttecken. Slå aldrig ihop eller räkna om tal.
- Markera början av varje sida på en egen rad med "=== SIDA n ===" där n är sidans ORIGINALNUMMER i hela dokumentet (användaren anger vilket nummer den första sidan i denna del har; nästa sida har +1 osv.). Ett tryckt sidnummer på sidan är bara text och ska transkriberas som text.
- Är text eller en siffra oläslig: skriv [oläsligt] på stället. Gissa aldrig.
- Handskrivna signaturer, logotyper och bilder: skriv [signatur], [logotyp] eller [bild] där de förekommer.
- Ingen inledning, ingen avslutning, inga kommentarer — bara transkriptionen.

VIKTIGT: PDF-filen kan innehålla ett automatiskt textlager som är trasigt (siffror och ord uppdelade i enstaka tecken, tecken som saknas eller fel). Förlita dig ALDRIG på textlagret. Transkribera endast det du ser på sidans bild.`;
}

export function buildTranskriberingUserPrompt(forstaSida: number, antalSidor: number): string {
  const sista = forstaSida + antalSidor - 1;
  return `Detta dokument innehåller ${antalSidor} sida${antalSidor > 1 ? "or" : ""}. Den första sidan har originalnummer ${forstaSida} (alltså "=== SIDA ${forstaSida} ===")${antalSidor > 1 ? `, den sista har nummer ${sista}` : ""}. Transkribera alla sidor.`;
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
    "totalyta": { "value": 3450, "unit": "m2", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "Total yta 3 450 kvm varav lokaler 250 kvm" } },
    "bostadsrattsyta": { "value": 3200, "unit": "m2", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "Bostadsrättsarea 3 200 kvm" } },
    "rakenskapsar": 2025,
    "balansdag": "2025-12-31",
    "antalMedlemmar": { "value": 43, "unit": "antal", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "Föreningen hade vid årets slut 43 (41) medlemmar" } },
    "antalHyresratter": { "value": 2, "unit": "antal", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "2 lokaler (hyresrätt)" } },
    "antalLokaler": { "value": 2, "unit": "antal", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "2 lokaler (hyresrätt)" } },
    "avgiftInkluderarEnligtForening": { "varme": "ja", "vatten": "ja", "el": "ja", "bredband": "okant", "tv": "okant" },
    "avgiftInkluderarKallor": {
      "varme": { "page": 15, "excerpt": "I årsavgiften ingår kostnader för bredband, el, kabel-tv, vatten och värme" },
      "vatten": { "page": 15, "excerpt": "I årsavgiften ingår kostnader för bredband, el, kabel-tv, vatten och värme" },
      "el": { "page": 15, "excerpt": "Kostnader för el tas ut via årsavgiften genom individuell mätning" }
    },
    "individuellMatning": {
      "el": { "matning": "ja", "ref": { "page": 15, "excerpt": "Kostnader för el tas ut via årsavgiften genom individuell mätning" } }
    },
    "keyFigures": [
      {
        "id": "arsavgift_per_m2_brf_yta",
        "label": "Årsavgift per m² upplåten med bostadsrätt",
        "figure": { "value": 670, "unit": "kr/m2", "source": "arsredovisning", "ref": { "page": 8, "excerpt": "Årsavgift kr/kvm upplåten med bostadsrätt 670" } },
        "status": "okant",
        "forklaring": "Vad du betalar per kvadratmeter och år i avgift."
      },
      {
        "id": "sparande_per_m2_totalyta",
        "label": "Sparande per m² totalyta",
        "figure": { "value": null, "unit": "kr/m2", "source": "arsredovisning", "ref": { "page": 4, "excerpt": "Sparande per kvm, kr neg neg neg" }, "tryckt": "neg" },
        "status": "okant",
        "forklaring": "Hur mycket föreningen sparar per kvadratmeter totalyta och år."
      }
    ],
    "lanebok": {
      "totalSkuld": { "value": 43200000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "Summa 43 200 000,00" } },
      "lan": [
        {
          "kreditgivare": "SBAB",
          "belopp": { "value": 25000000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "SBAB 3,2% 2027-02-25 25 000 000,00" } },
          "ranta": { "value": 3.2, "unit": "procent", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "SBAB 3,2% 2027-02-25 25 000 000,00" } },
          "villkorsandringsdag": "2027-02-25",
          "rantetyp": "okant",
          "ref": { "page": 12, "excerpt": "SBAB 3,2% 2027-02-25 25 000 000,00" }
        },
        {
          "kreditgivare": "Swedbank",
          "belopp": { "value": 18200000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "Swedbank rörlig ränta 2,1% 2026-03-28 18 200 000,00" } },
          "ranta": { "value": 2.1, "unit": "procent", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "Swedbank rörlig ränta 2,1% 2026-03-28 18 200 000,00" } },
          "villkorsandringsdag": "2026-03-28",
          "rantetyp": "rorlig",
          "ref": { "page": 12, "excerpt": "Swedbank rörlig ränta 2,1% 2026-03-28 18 200 000,00" }
        }
      ],
      "rantekostnader": { "value": 1050000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 9, "excerpt": "Räntekostnader och liknande resultatposter -1 050 000" } },
      "snittranta": { "value": 1.94, "unit": "procent", "source": "berakning" }
    },
    "underhallsplan": {
      "finns": "ja",
      "senastUppdaterad": 2024,
      "kommandeAtgarder": [
        { "text": "Stambyte planerat 2029", "ref": { "page": 6, "excerpt": "Stambyte ca 2027–2029" } },
        { "text": "Fasadrenovering under utredning" }
      ],
      "ref": { "page": 15, "excerpt": "Underhållsplanen uppdaterades 2024" },
      "planeradeKostnader": [
        {
          "text": "Stambyte",
          "fran": 2027,
          "till": 2029,
          "belopp": { "value": 12000000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 6, "excerpt": "Stambyte ca 2027–2029, beräknad kostnad 12 mkr, finansieras med nytt lån" } },
          "finansiering": "lan",
          "ref": { "page": 6, "excerpt": "Stambyte ca 2027–2029, beräknad kostnad 12 mkr, finansieras med nytt lån" }
        }
      ],
      "underhallsfond": { "value": 850000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 11, "excerpt": "Fond för yttre underhåll 850 000" } },
      "arligAvsattning": { "value": 300000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 4, "excerpt": "Avsättning till underhållsfonden 300 000 kr per år" } },
      "investeringsbehovPerM2": { "value": 310, "unit": "kr/m2", "source": "arsredovisning", "ref": { "page": 8, "excerpt": "Genomsnittligt investeringsbehov kr/kvm 310" } },
      "rekommenderadAvsattning": { "value": 1100000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 6, "excerpt": "Enligt underhållsplanen bör 1 100 000 kr avsättas per år" } },
      "planTotal": { "belopp": { "value": 45000000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 6, "excerpt": "Underhållsplanen omfattar 45 Mkr under 30 år" } }, "ar": 30 }
    },
    "genomfordaAtgarder": [
      { "byggdel": "tak", "ar": 2019, "text": "Takomläggning", "ref": { "page": 5, "excerpt": "2019 takomläggning" } },
      { "byggdel": "fonster", "ar": 2022, "text": "Byte av fönster", "ref": { "page": 5, "excerpt": "Fönsterbyte genomfördes 2021–2022" } }
    ],
    "sparandeUttag": { "planerat": "ja", "finansierat": "ja", "text": "Underskottet täcks av uttag ur underhållsfonden.", "ref": { "page": 4, "excerpt": "Årets underskott täcks genom uttag ur fonden för yttre underhåll" } },
    "lokaler": {
      "hyresintakter": { "value": 480000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 9, "excerpt": "Hyresintäkter lokaler 480 000" } },
      "kontrakt": [
        { "text": "Butikslokal, hyresavtal löper ut", "arshyra": { "value": 240000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 5, "excerpt": "Butiken hyrs ut för 240 000 kr/år, avtalet löper till 2026-09-30" } }, "slutdatum": "2026-09-30", "ref": { "page": 5, "excerpt": "Butiken hyrs ut för 240 000 kr/år, avtalet löper till 2026-09-30" } }
      ]
    },
    "energiprojekt": [
      { "text": "Solceller på taket", "belopp": { "value": 1500000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 5, "excerpt": "Solceller installeras 2026 för 1,5 mkr" } }, "finansierat": "okant", "ref": { "page": 5, "excerpt": "Solceller installeras 2026 för 1,5 mkr" } }
    ],
    "vasentligaHandelser": [
      { "text": "Föreningen har beslutat om en avgiftshöjning på 8 % från 2026.", "ref": { "page": 4, "excerpt": "styrelsen beslutat om höja årsavgiften med 8 %" } }
    ],
    "adresser": [
      { "gatuadress": "Exempelvägen 12", "postnummer": "123 45", "ort": "Stockholm", "ref": { "page": 3, "excerpt": "Föreningen äger fastigheten Exempel 3 på Exempelvägen 12, 123 45 Stockholm" } }
    ],
    "fastighetsbeteckningar": [
      { "beteckning": "Exempel 3", "ref": { "page": 3, "excerpt": "Föreningen äger fastigheten Exempel 3" } }
    ]
  },
  "datakvalitet": {
    "pdfSaknarTextlager": false,
    "extraktionKonfidens": { "niva": "hog", "skal": [] },
    "saknadeFalt": []
  },
  "kontrollsummor": {
    "summaTillgangar": { "value": 301200000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 10, "excerpt": "Summa tillgångar 301 200 000" } },
    "summaEgetKapitalOchSkulder": { "value": 301200000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 11, "excerpt": "Summa eget kapital och skulder 301 200 000" } },
    "arsavgifter": { "value": 3400000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 9, "excerpt": "Årsavgifter 3 400 000" } },
    "bostadsrattsyta": { "value": 3200, "unit": "m2", "source": "arsredovisning", "ref": { "page": 3, "excerpt": "Bostadsrättsarea 3 200 kvm" } },
    "rantebarandeSkulder": { "value": 43200000, "unit": "kr", "source": "arsredovisning", "ref": { "page": 12, "excerpt": "Summa 43 200 000,00" } }
  }
}

Skarpa regler mot exakt de misstag som brukar uppstå:
- keyFigures är en ARRAY med exakt sju objekt — aldrig ett objekt nycklat på id. Alla sju id:n måste finnas, även när figure.value är null.
- Varje tal (byggar, antalLagenheter, totalyta, bostadsrattsyta, figure inuti keyFigures, totalSkuld, belopp, ranta, snittranta, rantekostnader, underhallsfond, arligAvsattning, investeringsbehovPerM2, rekommenderadAvsattning, planTotal.belopp, hyresintakter, arshyra) är ALLTID ett objekt med "value", "unit", "source" — ALDRIG ett bart nummer.
- En ref-objekt har ENDAST fälten "page" och "excerpt" — aldrig "quote", "citat" eller andra namn. Sätt ALLTID "excerpt" när source är "arsredovisning": kopiera citatet ordagrant från fyndlistan (korta ner det till den relevanta delen, max ~15 ord). En sidhänvisning utan excerpt bevisar ingenting för köparen — citatet är beviset.
- kommandeAtgarder är en ARRAY av objekt { "text", "ref"? } — aldrig en platt sträng-array. Varje planerad åtgärd citeras för sig, eftersom olika åtgärder ofta nämns på olika sidor. Om du inte kan hitta en exakt sida för en specifik åtgärd: utelämna "ref" för just den posten (skriv inte in "page": null) — åtgärden tas ändå med, bara utan citat.
- Samma sak gäller vasentligaHandelser: "ref" är valfritt per händelse. Utelämna det om ingen exakt sida kan anges — händelsen ska ändå finnas med, aldrig hittas på en sida eller strykas för att den saknar exakt citat.
- Ett kommandeAtgarder- eller väsentlig-händelse-objekt har ENDAST fälten "text" och (valfritt) "ref" — aldrig "beskrivning" eller "source" på den nivån.
- avgiftInkluderarEnligtForening: sätt "ja"/"nej" per post (varme/vatten/el/bredband/tv) ENDAST när rapporten uttryckligen säger det (t.ex. "i årsavgiften ingår värme och vatten" eller "elkostnader ingår inte i avgiften"). Dra ALDRIG slutsatsen "nej" bara för att en post inte nämns, och gissa aldrig utifrån vad som är vanligt i svenska bostadsrättsföreningar i allmänhet — det räknas som att gissa, inte att läsa. Sätt "okant" för varje post rapporten inte uttryckligen tar ställning till. Utelämna hela fältet om rapporten inte säger något alls om vad som ingår i avgiften. En mening om föreningens EGEN fastighetsförsäkring (t.ex. "X ingår ej i föreningens fastighetsförsäkring") är INTE ett svar om avgiften — använd den aldrig här.
- avgiftInkluderarKallor: för VARJE post där avgiftInkluderarEnligtForening faktiskt är "ja" eller "nej" (aldrig för en post som är "okant" eller utelämnad), lägg till en post med samma nyckel som citerar var i rapporten det står — { "page", "excerpt" }, excerpt obligatoriskt. Utelämna hela fältet om avgiftInkluderarEnligtForening utelämnas.
- individuellMatning: sätt en post (el/vatten/varme) ENDAST när rapporten uttryckligen säger att just den förbrukningen mäts och debiteras individuellt per lägenhet (t.ex. "Kostnader för el ... tas ut via årsavgiften genom individuell mätning" eller "I begreppet årsavgift ingår inte IMD-avgifter" — koppla den senare bara till en specifik post om rapporten säger vilken). "matning" är alltid "ja" eller "nej", ALDRIG "okant" — en post rapporten inte tar upp UTELÄMNAS helt, den sätts inte till "okant". "ref" är obligatoriskt med excerpt när posten finns.
- antalMedlemmar: föreningens medlemsantal vid räkenskapsårets slut, ALDRIG jämförelsetalet inom parentes för föregående år (t.ex. "43 (41) medlemmar" → 43). Utelämna hela fältet om rapporten bara anger antal lägenheter, inte medlemsantal.
- antalHyresratter / antalLokaler: sätt bara när rapporten uttryckligen anger föreningens hyresrätter respektive lokaler som egna enheter (t.ex. "2 lokaler (hyresrätt)"). Räkna aldrig en areauppgift i kvadratmeter (t.ex. "garagelokaler 130 kvm") eller ett gemensamhetsutrymme ("föreningslokal", "samlingslokal") som en lokal i den här betydelsen.
- adresser: föreningens EGNA gatuadress(er), en post per adress, ENDAST när fynden uttryckligen anger dem. "gatuadress" är gatunamnet och numret (t.ex. "Baltzar von Platens gata 6") utan postnummer och ort, skrivet som i rapporten. "postnummer" skrivs "NNN NN" (fem siffror med ett mellanslag efter de tre första) och "ort" som i rapporten — utelämna båda när rapporten inte anger dem i samband med adressen, gissa aldrig utifrån gatunamnet. "ref" är obligatorisk med excerpt ordagrant ur fyndlistan. Skriv aldrig förvaltarens, revisorns, en styrelseledamots eller en banks adress och inte en c/o-adress för post; sätt aldrig ett ortnamn som gatuadress. Utelämna hela fältet när fynden inte anger någon gatuadress.
- fastighetsbeteckningar: föreningens fastighetsbeteckning(ar) (t.ex. "Pontonjären 3", "Kungsholmen 1:23"), en post per beteckning, ENDAST när fynden uttryckligen anger dem, med "ref" och excerpt som ovan. Utelämna hela fältet när fynden inte anger någon.
- byggar är året byggnaden uppfördes (rapporten skriver "uppfördes", "byggnadsår", "byggår"). "Värdeår" är något annat (året fastighetens värde fastställdes): ta det ENDAST om rapporten inte anger något annat byggår, och då ska excerpt visa att det står "värdeår". Skriv aldrig i datakvalitet.extraktionKonfidens.skal att byggår saknas eller inte framgår — den texten visas för köpare som kan ha angett byggåret själva; lägg i stället "byggar" i saknadeFalt.
- totalyta (all yta, inklusive lokaler) och bostadsrattsyta (ytan upplåten med bostadsrätt) är OLIKA tal med olika citat — använd aldrig samma tal eller samma citat för båda. Anger rapporten bara en yta: sätt den på det fält etiketten säger och utelämna det andra. bostadsrattsyta i forening och i kontrollsummor är samma tal.
- balansdag: räkenskapsårets sista dag som "YYYY-MM-DD" (t.ex. "2025-12-31", eller "2025-08-31" vid brutet räkenskapsår). Utelämna om den inte står i fynden.
- lanebok.lan: ett objekt per lån i lånenoten, med skuld vid RÄKENSKAPSÅRETS SLUT (årets kolumn, inte jämförelseårets) i belopp (kr). Ta inte med en rad vars skuld är 0 vid årets slut (återbetalt lån). ranta är räntesatsen som procent-tal ("3,2 %" → 3.2). villkorsandringsdag som "YYYY-MM-DD" från villkorsändringsdag/konv.datum/förfallodag/"bundet till"; står bara ett år eller ingen dag: utelämna fältet, hitta aldrig på en dag. rantetyp är "rorlig" ENDAST när raden eller texten uttryckligen säger rörlig/rörligt, "bunden" ENDAST när den säger bunden/fast ränta, annars "okant". ref.excerpt är lånets egen rad ordagrant; belopp och ranta får samma ref. Skriv INTE forfalloprofil när du anger lan — koden härleder den. Finns ingen lånetabell per lån men ett förfalloprofil per år: använd forfalloprofil som tidigare och utelämna lan.
- lanebok.rantekostnader: årets räntekostnader i kronor som POSITIVT tal (resultaträkningen/noten "Räntekostnader och liknande resultatposter"; står den med minustecken, skriv beloppet utan tecken). Står belopp i tkr: räkna om till kronor.
- underhallsplan.planeradeKostnader: ENDAST planerade kostnader där rapporten anger ett belopp (kr; mkr/tkr räknas om). En åtgärd utan belopp hör bara hemma i kommandeAtgarder. finansiering: "lan" om rapporten säger nytt lån, "fond" om den tas ur underhållsfonden, "beslutad" om den är beslutad/finansierad utan att säga hur, "ofinansierad" om rapporten uttryckligen säger att finansiering saknas, annars "okant". fran/till är år när rapporten anger dem. underhallsfond är fonden för yttre underhåll vid årets slut (kr); arligAvsattning är den PLANERADE årliga avsättningen (kr/år), inte årets uttag.
- sparandeUttag: ENDAST när rapporten uttryckligen säger att ett negativt sparande/resultat är ett planerat uttag (t.ex. ur fonden) eller hur underskottet finansieras. planerat/finansierat är "ja"/"nej"/"okant" och ref.excerpt är obligatoriskt; utelämna fältet annars.
- lokaler: hyresintakter är årets hyresintäkter från lokaler (kr). kontrakt: ENDAST hyresavtal för lokaler med angivet slutdatum (YYYY-MM-DD), arshyra om hyran anges; ref med excerpt obligatoriskt. Utelämna lokaler helt om rapporten inte säger något.
- underhallsplan.investeringsbehovPerM2: rapportens "investeringsbehov per kvm"/"genomsnittligt investeringsbehov" i kr per m² och år (unit "kr/m2"), ENDAST när rapporten uttryckligen anger det. rekommenderadAvsattning: vad underhållsplanen säger att föreningen bör avsätta per år (kr/år, unit "kr"), ENDAST när rapporten anger det separat från den faktiska avsättningen — sätt den aldrig lika med arligAvsattning bara för att den saknas. planTotal: en uttalad total för underhållsplanen { "belopp": Figure (kr; mkr/tkr räknas om), "ar": antal år planen omfattar }, ENDAST när både belopp och antal år står i rapporten. Utelämna fälten annars.
- genomfordaAtgarder: större åtgärder som REDAN är genomförda, en post per åtgärd { "byggdel", "ar", "text", "ref" } med ref och excerpt obligatoriskt. byggdel är exakt en av "stambyte" (även relining), "tak" (takomläggning/takbyte), "fasad" (fasadrenovering, omputsning), "fonster" (fönsterbyte), "ventilation" (ny FTX/ventilationsaggregat), "el" (elstigare/elcentraler), "hiss" (hissbyte/hissmodernisering) — inga andra byggdelar, och enbart OVK är INTE en renovering. "ar" är året arbetet utfördes (ett intervall → det sista året). Ta aldrig med en planerad eller pågående åtgärd, och hitta aldrig på ett årtal. Utelämna fältet om fynden inte nämner någon.
- energiprojekt: ENDAST namngivna projekt (solceller, bergvärme, fönsterbyte för energi m.m.); belopp om det anges; finansierat "ja"/"nej" bara när rapporten säger det, annars "okant".
- rakenskapsar är ETT årtal (number), aldrig ett datumintervall som sträng.
- Skuldsättning per kvm med otydlig bas: finns bara ett skuldtal per kvm och det framgår inte om det avser totalyta eller bostadsrättsyta (t.ex. "Lån per kvm bostadsyta" eller "Skuldsättningsgrad kr/kvm" — säger etiketten inte uttryckligen "totalyta" är basen oklar), lägg det under skuldsattning_per_m2_brf_yta med sitt citat och låt skuldsattning_per_m2_totalyta vara null. Ett tal är bättre än inget här — de två brukar ligga nära varandra.
- Skuldfri förening: säger fynden uttryckligen att föreningen är skuldfri eller saknar räntebärande skulder, sätt lanebok.totalSkuld till { "value": 0, "unit": "kr", "source": "arsredovisning", "ref": { ... } } med en ref till det stället — nyckeltalscellerna (rantekanslighet, skuldsattning_per_m2_totalyta, skuldsattning_per_m2_brf_yta) lämnas precis som de står tryckta i rapporten, ett senare steg härleder dem vid behov.
- lanebok.totalSkuld är SUMMAN av den långfristiga och den kortfristiga delen av lånen, oavsett vad posterna heter (t.ex. "Skulder till kreditinstitut" långfristigt + kortfristigt, "Kortfr. del av skuld", eller ett lån som bokförs som "Övriga skulder" med en not som visar att det är ett lån). Missa aldrig den kortfristiga delen. Finns en tryckt totalsumma för lånen i fynden: använd den (source "arsredovisning", med ref och excerpt). Annars: lägg ihop delarna själv och sätt source "berakning" med ref/excerpt från den STÖRRE delen. Finns bara en del i fynden: använd den delen.
- kontrollsummor: fyll i de fem uppgifterna summaTillgangar, summaEgetKapitalOchSkulder, arsavgifter (årets intäkt "Årsavgifter" i kronor), bostadsrattsyta (m², ytan upplåten med bostadsrätt) och rantebarandeSkulder (kr) som ordinära Figure-objekt med källa och excerpt — ENDAST de som uttryckligen finns bland fynden. En uppgift som saknas UTELÄMNAS helt ur kontrollsummor (skriv aldrig 0 eller null i stället). Står belopp i tkr: räkna om till kronor. Utelämna hela kontrollsummor om inget av de fem finns.
- Om ett värde saknas bland fynden: sätt figure.value till null och source till "berakning" (inget citat krävs för null), och lägg fältnamnet i datakvalitet.saknadeFalt. null är ENDAST giltigt inuti "value" på en Figure. Alla andra valfria fält (t.ex. underhallsplan.senastUppdaterad, byggar/antalLagenheter/totalyta/bostadsrattsyta i sig själva, balansdag, lan, rantekostnader, sparandeUttag, lokaler, energiprojekt, ref) ska UTELÄMNAS helt (fältet skrivs inte alls) när uppgiften saknas — aldrig sättas till null.
- Om cellen för ett nyckeltal INTE är ett rent tal — t.ex. "neg", "negativ", "(123)", "−4,2", "-", eller en kolumn märkt "tkr" — kopiera det exakt som det står i rapporten (tecken, mellanslag och allt) till figure.tryckt. Sätt figure.value till din bästa läsning av talet om du kan utläsa ett (annars null); ett senare, deterministiskt steg tolkar tryckt på nytt och den tolkningen vinner ALLTID över value när tryckt är satt, så en ofullständig gissning i value kostar ingenting — men hitta aldrig på en siffra som inte alls går att utläsa ur cellen. Sätt ALDRIG fältet "tecken" själv — det sätts uteslutande i det deterministiska steget, aldrig av dig. Är cellen redan ett rent tal (t.ex. "670" eller "-1 200"): utelämna tryckt helt, precis som idag.
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
- "E": flera nyckeltal med status "kritisk" som förstärker varandra, eller ett nyckeltal med status "kritisk" tillsammans med en uttalad risk i väsentliga händelser som föreningen inte visar sig kunna bära.
En allvarlig risk i väsentliga händelser utan något nyckeltal med status "kritisk" ger som mest betyget C, och ska beskrivas i en röd flagga med severity "hog".`;

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

Alla andelar och summor du behöver är redan uträknade av Binfo och står under "Fasta värden" i användarmeddelandet (till exempel hur stor del av "lanebok.totalSkuld" som förfaller ett visst år enligt "lanebok.forfalloprofil"). Varje tal i "betygMotivering" (och i flaggornas "beskrivning" och frågornas "varfor") ska komma från underlaget eller från de fasta värdena och kopieras därifrån; att avrunda en procentsats till heltal (74,2 blir 74 %) är tillåtet. Räkna aldrig själv — ingen egen addition, subtraktion, division eller procentberäkning — och för aldrig in en siffra utifrån.

${buildForbehallAvsnitt()}

## Det du aldrig får göra

1. Hitta aldrig på ett riktvärde, ett riksgenomsnitt, ett branschsnitt, ett lagkrav eller en gräns för vad som är normalt. Du får bara använda tal som står i underlaget, plus de riktvärden som redan följer med i nyckeltalens "benchmark"-fält. Kräver ett påstående en siffra du inte har — skriv inte påståendet.
2. Hitta aldrig på ett sidnummer. "ref" får bara innehålla ett sidnummer som finns i underlaget, och användarmeddelandet räknar upp exakt vilka de är. Kan du inte peka ut en sida ur underlaget: utelämna "ref" helt (skriv inte "page": null).
3. Argumentera aldrig om ett okänt tal som om det vore ett dåligt tal. Okänt är inte detsamma som dåligt. Ett nyckeltal vars "figure.value" är null saknas i rapporten — det är i sig värt en flagga eller en fråga ("uppgiften går inte att kontrollera"), aldrig en gissning om vad talet skulle ha varit.
4. Skriv aldrig frågor om sådant köparen själv inte fyllt i — de genereras deterministiskt på annat håll och har ursprung "saknad_uppgift". Alla frågor du skriver har ursprung "analys" och ska handla om något i årsredovisningen.
5. Påstå aldrig något om lagfart eller pantbrev: det gäller hus, aldrig bostadsrätter.

## Betygsskalan

${BETYGSSKALA}

Användarmeddelandet anger under "Fasta värden" vilka betyg som är tillåtna med tanke på antalet nyckeltal med status "svag" och "kritisk". Välj betyget bland dem; en bokstav utanför intervallet ändras ändå i ett senare steg.

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
      "varfor": "Avgiften har inte höjts sedan 2022, men 60 % av lånen förfaller 2026.",
      "svarssignal": "Bra svar: styrelsen har räknat på avgiften med dagens ränta för lånen som förfaller. Varningssignal: att styrelsen inte vet vad de nya lånen kommer att kosta.",
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
- "varfor" på en fråga är en eller två korta meningar som namnger det specifika fyndet och de konkreta siffrorna i underlaget som gör frågan nödvändig, till exempel "Avgiften har inte höjts sedan 2022, men 60 % av lånen förfaller 2026." Skriv aldrig ett tal som inte står i underlaget (se regel 1 ovan). Är frågan inte kopplad till ett enskilt fynd ska "varfor" i stället säga varför frågan spelar roll och hur svaret påverkar köparen — avgift, budnivå eller risk.
- "svarssignal" är valfri och bara på frågor. Skriv en enda rad på formen "Bra svar: … Varningssignal: …" (eller bara en av delarna) som säger hur ett lugnande respektive oroande svar låter, konkret och utan nya siffror. Finns inget användbart att säga: utelämna nyckeln helt.
- Alla textfält som du skriver ska vara ifyllda. Skriv hellre färre flaggor och färre frågor än tomma. Valfria fält utelämnas helt, de skrivs aldrig som tom sträng eller null.
- "ref" är valfritt överallt och utelämnas helt när ingen sida i underlaget kan pekas ut.

Svara ENDAST med detta enda JSON-objekt — ingen inledande text, ingen förklaring, inga Markdown-kodstaket. Bara JSON.`;
}

/**
 * The judging sees the loan book as `forfalloprofil` (derived from `lan` in
 * slutfor/tolkaVarde, with the same citations), so the per-loan rows are left
 * out of its input: same facts, fewer tokens.
 */
function utanLanrader(extraction: ExtractionResult): ExtractionResult {
  const lanebok = extraction.forening.lanebok;
  if (!lanebok?.lan) return extraction;
  const { lan: _lan, ...utan } = lanebok;
  return { ...extraction, forening: { ...extraction.forening, lanebok: utan } };
}

export function buildAnalysUserPrompt(
  extraction: ExtractionResult,
  tillatnaSidor: ReadonlySet<number>,
  fasta: FastaVarden = beraknaFastaVarden(extraction),
): string {
  const sidor = [...tillatnaSidor].sort((a, b) => a - b);
  const sidlista =
    sidor.length > 0
      ? sidor.join(", ")
      : '(inga — underlaget saknar sidhänvisningar, utelämna "ref" helt)';

  return `Här är det faktakontrollerade underlaget ur årsredovisningen:

${JSON.stringify(utanLanrader(extraction), null, 2)}

## Fasta värden (beräknade av Binfo ur underlaget — använd exakt dessa tal, räkna aldrig om dem)

${formateraFastaVarden(fasta)}

Tillåtna sidnummer i en "ref": ${sidlista}. Inga andra sidnummer får förekomma i ditt svar.

Gör den samlade bedömningen enligt systemprompten och svara med enbart JSON-objektet.`;
}

// ---------------------------------------------------------------------------
// Grade motivation, regenerated (analyze.ts). A small extra call that rewrites
// ONLY betygMotivering for a letter that is already fixed, used when the
// model's letter was clamped by the deterministic band check or when a number
// in its motivation did not match the data (siffrorKontroll.ts).
// ---------------------------------------------------------------------------

export function buildMotiveringSystemPrompt(): string {
  return `Du är en oberoende rådgivare på köparens sida. Du skriver om en enda text: "betygMotivering", den korta motiveringen till betyget i en bedömning av en svensk bostadsrättsförening. Köparen läser den.

Betyget är redan fastställt och står i användarmeddelandet. Skriv motiveringen för just den bokstaven. Argumentera aldrig för ett annat betyg och skriv aldrig att betyget borde ha varit högre eller lägre.

Regler:
- Använd bara tal som står i användarmeddelandet (de fasta värdena och de röda flaggorna). Kopiera dem exakt; att avrunda en procentsats till heltal (74,2 blir 74 %) är tillåtet. Räkna aldrig själv och för aldrig in en siffra utifrån.
- Ändra aldrig ett nyckeltals status och beskriv inget nyckeltal i strid med dess status. Ett tal med status "okant" ska aldrig beskrivas som dåligt.
- Hitta aldrig på riktvärden, riksgenomsnitt eller lagkrav.
- Skriv på svenska, i klartext, utan facktermer, rakt och kort (två till fyra meningar). Säg vad som faktiskt drev betyget och, när underlaget räcker för det, vad det innebär för köparen.
- Den tidigare motiveringen är bara material: ta med det som stämmer med de fasta värdena och lämna det som inte gör det.

Svara ENDAST med detta enda JSON-objekt — ingen inledande text, ingen förklaring, inga Markdown-kodstaket. Bara JSON:

{ "betygMotivering": "Kort, rak motivering på svenska för det fastställda betyget." }`;
}

export interface MotiveringsUnderlag {
  /** The fixed (final) letter. */
  betyg: Grade;
  /** Set when the model's own letter was clamped: the letter it first chose. */
  klampadFran?: Grade | undefined;
  /** Numbers in the previous motivation that matched nothing in the data, as written. */
  avvikandeSiffror: readonly string[];
  fasta: FastaVarden;
  rodaFlaggor: ReadonlyArray<{ titel: string; beskrivning: string; severity: Severity }>;
  tidigareMotivering: string;
}

export function buildMotiveringUserPrompt(u: MotiveringsUnderlag): string {
  const skal: string[] = [];
  if (u.klampadFran !== undefined) {
    skal.push(
      `- Det första förslaget var betyget ${u.klampadFran}, men antalet nyckeltal med status "svag" och "kritisk" tillåter bara ${u.fasta.tillatnaBetyg.join(", ")}. Betyget blev därför ${u.betyg}, och motiveringen ska stödja det.`,
    );
  }
  if (u.avvikandeSiffror.length > 0) {
    skal.push(
      `- Dessa tal i den tidigare motiveringen stämde inte med underlaget: ${u.avvikandeSiffror.join("; ")}. Använd i stället talen under "Fasta värden".`,
    );
  }
  const flaggor =
    u.rodaFlaggor.length > 0
      ? u.rodaFlaggor
          .map((f) => `- ${f.titel} (severity "${f.severity}"): ${f.beskrivning}`)
          .join("\n")
      : "(inga röda flaggor)";

  return `Fastställt betyg: ${u.betyg}

Motiveringen skrivs om därför att:
${skal.length > 0 ? skal.join("\n") : "- (ingen angiven orsak)"}

## Fasta värden (beräknade av Binfo ur underlaget — använd exakt dessa tal, räkna aldrig om dem)

${formateraFastaVarden(u.fasta)}

## Röda flaggor

${flaggor}

## Tidigare motivering (material, inte facit)

${u.tidigareMotivering}

Skriv den nya betygMotivering för betyget ${u.betyg} och svara med enbart JSON-objektet.`;
}
