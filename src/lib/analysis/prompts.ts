import type { KeyFigureId } from "@/types/analysis";

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

Underhållsplan: finns den, när uppdaterades den senast, vilka åtgärder är planerade.

Väsentliga händelser: händelser efter räkenskapsårets slut eller annan väsentlig information i förvaltningsberättelsen som en köpare bör känna till.

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
        findings.push({ text: block.text, citat: citation.cited_text, sida: citation.start_page_number });
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
  return `Du sammanställer resultatet av en genomläsning av en svensk bostadsrättsförenings årsredovisning till JSON som motsvarar typen ExtractionResult:

{
  "schemaVersion": "1.0.0",
  "forening": { namn, orgnr, akta, byggar?, antalLagenheter?, totalyta?, rakenskapsar, keyFigures, lanebok?, underhallsplan?, vasentligaHandelser? },
  "datakvalitet": { "pdfSaknarTextlager": false, "extraktionKonfidens": { "niva": "hog"|"medel"|"lag", "skal"?: string[] }, "saknadeFalt": string[] }
}

Du får en numrerad lista med fynd — varje fynd har en sidhänvisning och ett exakt citat ur rapporten. Använd ENDAST dessa sidnummer för "ref.page" på extraherade figurer (varje figur med source "arsredovisning" måste ha en ref). Hitta aldrig på ett sidnummer som inte finns i listan.

Regler:
- Om ett nyckeltal eller värde inte finns bland fynden: sätt figure.value till null och källa "berakning" (inget citat att kräva för ett null-värde), och lägg fältnamnet i datakvalitet.saknadeFalt.
- Tristate-fält (t.ex. akta, underhallsplan.finns) ska vara "okant" om fynden inte ger ett entydigt svar — gissa aldrig "nej" bara för att inget nämns.
- keyFigures måste innehålla alla sju nyckeltalen, även de med value: null.
- Skriv "forklaring" på enkelt, rakt språk utan facktermer — en mening om vad talet betyder för köparen.
- datakvalitet.pdfSaknarTextlager: sätt alltid till false (den styrs separat av anroparen, inte av dig).
- datakvalitet.extraktionKonfidens.niva: sänk till "medel" eller "lag" om många fynd saknas eller är tvetydiga, med skäl i "skal".

Svara ENDAST med ett enda JSON-objekt av denna form — ingen inledande text, ingen förklaring, inga Markdown-kodstaket. Bara JSON.`;
}

export function buildExtractionUserPrompt(groundingText: string): string {
  return `Här är fynden från genomläsningen av årsredovisningen:\n\n${groundingText}\n\nSammanställ dessa till fältet "forening" enligt schemat. Utelämna inget av de sju nyckeltalen.`;
}
