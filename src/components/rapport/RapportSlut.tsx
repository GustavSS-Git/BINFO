import { Button } from "@/components/ui/binfo";
import {
  OMRADES_KALLA_RAD,
  BYGGDEL_KALLOR,
  formatSkapadDatum,
  modellKallaRad,
} from "@/lib/analysisView";
import { booliKallaRad } from "@/lib/annons/formular";
import { KONTAKT_EPOST } from "@/lib/kontakt";
import type { AnalysisResult } from "@/types/analysis";

/** "Källor och metod": vad uppgifterna bygger på, med en rad per källa som rapporten använt. */
export function KallorOchMetod({ analys }: { analys: AnalysisResult }) {
  const u = analys.prisanalys.varderingsunderlag;
  const prognos = analys.avgiftsprognos;
  const refi = prognos?.refinansiering;
  const rader: string[] = [];
  const booliRad = booliKallaRad(analys.input.kalla);
  if (booliRad) rader.push(booliRad);
  if (u) rader.push(`Värdering: ${modellKallaRad(u)}`);
  if (u?.prisniva) {
    rader.push(
      `Prisnivå för ${u.prisniva.region}: ${u.prisniva.kalla}, ${u.prisniva.krPerM2.toLocaleString("sv-SE")} kr/m².`,
    );
  }
  if (prognos?.sparbehov?.byggdelar) rader.push(`Byggdelarnas livslängd: ${BYGGDEL_KALLOR}.`);
  if (refi) {
    rader.push(
      `Antagen ny ränta för föreningens lån: ${refi.referensranta.namn} ${formatSkapadDatum(refi.referensranta.datum)} plus föreningens marginal.`,
    );
  }
  if (u) rader.push(`Områdesindelning: ${OMRADES_KALLA_RAD}`);

  return (
    <section
      id="metod"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-7 sm:px-8"
    >
      <h2 className="text-[19px] font-semibold text-foreground">Källor och metod</h2>
      <p className="text-[15px] text-text-2">
        Uppgifterna om föreningen kommer från årsredovisningen för {analys.forening.rakenskapsar},
        med sidhänvisning vid varje siffra. Hur vi har räknat förklaras under respektive avsnitt
        ovan.
      </p>
      {rader.length > 0 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          {rader.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Avslutande ruta: räkna vidare i bolånekalkylen eller ladda ner rapporten. */
export function SlutRuta({
  tillKalkyl,
  hamtaPdf,
  pdfSkapas,
}: {
  tillKalkyl: () => void;
  hamtaPdf: () => void;
  pdfSkapas: boolean;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-12 gap-y-6 rounded-lg bg-primary p-8 sm:p-10">
      <div className="flex max-w-[640px] flex-1 basis-80 flex-col gap-2">
        <h2 className="font-display text-[28px] font-semibold text-primary-foreground">
          Har du råd med just den här?
        </h2>
        <p className="text-primary-foreground/85">
          Bolånekalkylen tar med pris, avgift och föreningens räntekänslighet från rapporten.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="lg" onClick={tillKalkyl}>
          Räkna på månadskostnaden
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={hamtaPdf}
          disabled={pdfSkapas}
          className="border-primary-foreground/50 text-primary-foreground hover:bg-primary-foreground/10"
        >
          {pdfSkapas ? "Skapar PDF…" : "Ladda ner PDF"}
        </Button>
      </div>
    </section>
  );
}

/** Friskrivning med räkenskapsåret och en mejllänk för att rapportera fel (dold utan adress). */
export function Ansvarsfriskrivning({
  rakenskapsar,
  foreningNamn,
}: {
  rakenskapsar: number;
  foreningNamn: string;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      Rapporten är beslutsstöd, inte råd. Siffrorna kommer från föreningens årsredovisning för{" "}
      {rakenskapsar} och kan innehålla tolkningsfel.{" "}
      {KONTAKT_EPOST !== null ? (
        <a
          href={`mailto:${KONTAKT_EPOST}?subject=${encodeURIComponent(`Fel i rapporten om ${foreningNamn}`)}`}
          className="text-link underline underline-offset-2"
        >
          Hittar du ett fel? Säg till.
        </a>
      ) : null}
    </p>
  );
}
