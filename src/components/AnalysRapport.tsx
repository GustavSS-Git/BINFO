import type { ReactNode } from "react";
import { Button, Card } from "@/components/ui/binfo";
import { PropertySummary } from "@/components/PropertySummary";
import { ForeningSektion } from "@/components/rapport/RapportForening";
import { AvgiftSektion } from "@/components/rapport/RapportAvgift";
import { Fragor } from "@/components/rapport/RapportFragor";
import { PrisSektion } from "@/components/rapport/RapportPris";
import { Prisrimlighet } from "@/components/rapport/Prisrimlighet";
import { Ansvarsfriskrivning, KallorOchMetod, SlutRuta } from "@/components/rapport/RapportSlut";
import { Sammanfattningskort } from "@/components/rapport/Sammanfattningskort";
import { useRapportAtgarder } from "@/components/rapport/useRapportAtgarder";
import { andelAvSkuldRad, rapportOmrade } from "@/lib/analysisView";
import type { AnalysisResult } from "@/types/analysis";

export { Fragor, Prisrimlighet };

/**
 * Rent presentationslager för en färdig `AnalysisResult` (redesign v4, K1): rapportens
 * huvud, tre sammanfattningskort och fyra avsnitt (Föreningen, Priset, Avgiften framåt,
 * Inför visningen) samt källor, avslutande ruta och friskrivning. Ingen egen
 * datahämtning: tar analysen som prop så att både exempelsidan (`/exempel`, som visar
 * `sampleAnalysis`) och den riktiga rapporten delar exakt samma renderingskod.
 * Rapportens huvud ÄR sidans rubrik, så sidorna lägger ingen egen PageHeader.
 */
export function AnalysRapport({
  analys,
  sparaSlot,
  sparaKort,
}: {
  analys: AnalysisResult;
  /** "Spara analysen" som knapp i åtgärdsraden (på /forhandsvisning och /analys).
   *  Saknas på /exempel. */
  sparaSlot?: ReactNode;
  /** Den större "Spara analysen i din profil"-rutan före friskrivningen. */
  sparaKort?: ReactNode;
}) {
  const { pdfStatus, hamtaPdf, tillKalkyl } = useRapportAtgarder(analys);
  const byggarJamforelse = analys.uppgiftsjamforelse?.find((r) => r.falt === "byggar");
  const omrade = rapportOmrade(analys.prisanalys.varderingsunderlag);

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-5">
        <PropertySummary
          input={analys.input}
          foreningNamn={analys.forening.namn}
          skapad={analys.skapad}
          byggarJamforelse={byggarJamforelse}
          {...(omrade ? { omrade } : {})}
        >
          <Button
            variant="secondary"
            size="lg"
            onClick={hamtaPdf}
            disabled={pdfStatus === "skapar"}
          >
            {pdfStatus === "skapar" ? "Skapar PDF…" : "Ladda ner PDF"}
          </Button>
          {sparaSlot}
          <Button variant="secondary" size="lg" onClick={tillKalkyl}>
            Räkna på månadskostnaden
          </Button>
        </PropertySummary>
        {pdfStatus === "fel" ? (
          <p className="text-sm text-danger-text">
            Det gick inte att skapa PDF:en just nu. Försök igen om en liten stund.
          </p>
        ) : null}
        <Sammanfattningskort analys={analys} />
      </div>

      <ForeningSektion
        analys={analys}
        sparbehovMal={analys.avgiftsprognos?.sparbehov?.malKrPerM2}
      />
      <PrisSektion
        prisanalys={analys.prisanalys}
        input={analys.input}
        avgiftsprognos={analys.avgiftsprognos}
        skuldrad={andelAvSkuldRad(analys)}
        byggarJamforelse={byggarJamforelse}
      />
      <AvgiftSektion analys={analys} />
      <Fragor analys={analys} medPrognos={analys.avgiftsprognos !== undefined} />
      <KallorOchMetod analys={analys} />
      <SlutRuta tillKalkyl={tillKalkyl} hamtaPdf={hamtaPdf} pdfSkapas={pdfStatus === "skapar"} />
      {sparaKort}
      <Ansvarsfriskrivning
        rakenskapsar={analys.forening.rakenskapsar}
        foreningNamn={analys.forening.namn}
      />
    </div>
  );
}

/**
 * Betygskortet används kvar av den publika BRF-sidan (`/brf/$slug`) tills den är
 * omgjord; rapporten själv visar betyget i sammanfattningskortet och avsnitt 1.
 */
export function Betygskort({ betyg, motivering }: { betyg: string; motivering: string }) {
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-6">
      <div className="flex size-20 items-center justify-center rounded-full border-4 border-primary/20 bg-primary/5 font-display text-3xl text-primary">
        {betyg}
      </div>
      <div className="max-w-xl flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sammanvägt riskbetyg
        </p>
        <p className="mt-2 text-sm text-foreground">{motivering}</p>
      </div>
    </Card>
  );
}
