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
  return `Du sammanställer resultatet av en genomläsning av en svensk bostadsrättsförenings årsredovisning till JSON som motsvarar typen ExtractionResult.

Du får en numrerad lista med fynd — varje fynd har en sidhänvisning och ett exakt citat ur rapporten. Använd ENDAST dessa sidnummer för "page" i en ref. Hitta aldrig på ett sidnummer som inte finns i listan.

keyFigures får ENDAST innehålla exakt dessa sju id-strängar, copy-pasteade tecken för tecken — aldrig en förkortning, aldrig ett annat nyckeltal (t.ex. "soliditet" eller "likviditet" finns INTE i listan och ska aldrig användas som id även om rapporten nämner dem):
${ALLA_NYCKELTAL.map((n) => `- "${n.id}"`).join("\n")}

status på varje nyckeltal måste vara EXAKT en av dessa fem strängar — aldrig "ok", "varning" eller någon annan svensk beskrivning:
- "god", "acceptabel", "svag", "kritisk", "okant"

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
        "status": "god",
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
