import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card, Eyebrow, LinkButton } from "@/components/ui/binfo";
import { PriskollResultat } from "@/components/analysera/PriskollResultat";
import { FelRuta } from "@/components/konto/AuthSida";
import { formatSkapadDatum } from "@/lib/analysisView";
import { inloggningsSok } from "@/lib/till";
import { hamtaPrisuppskattningFn, hamtaSparadVarderingFn } from "@/server/analysFn";
import type { PrisInput, PrisuppskattningResultat } from "@/types/analysis";

/** En sparad värdering (`/analysera?sparad=<id>`): den lagrade ögonblicksbilden
 *  samt "Räkna om med dagens modell". Flyttad hit från den tidigare /vardering. */
export const SERVERFEL_TEXT = "Något gick fel. Försök igen om en stund.";

export function SparadVardering({ id }: { id: string }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["sparad-vardering", id],
    queryFn: () => hamtaSparadVarderingFn({ data: { id } }),
    retry: false,
  });
  const [nyttResultat, setNyttResultat] = useState<PrisuppskattningResultat | null>(null);
  const [raknarOm, setRaknarOm] = useState(false);
  const [omFel, setOmFel] = useState<string | null>(null);

  const kravInloggning = q.data !== undefined && !q.data.ok && q.data.felKod === "ej_inloggad";
  useEffect(() => {
    if (kravInloggning) {
      void navigate({
        to: "/konto/logga-in",
        search: inloggningsSok(`/analysera?sparad=${encodeURIComponent(id)}`, undefined),
      });
    }
  }, [kravInloggning, id, navigate]);

  const raknaOm = async (input: PrisInput) => {
    if (raknarOm) return;
    setRaknarOm(true);
    setOmFel(null);
    try {
      const svar = await hamtaPrisuppskattningFn({ data: input });
      if (svar.ok) setNyttResultat(svar.resultat);
      else setOmFel(svar.errorMessage);
    } catch (error) {
      console.error("[analysera] omräkning kastade:", error);
      setOmFel(SERVERFEL_TEXT);
    } finally {
      setRaknarOm(false);
    }
  };

  let rubrik = "Priskoll";
  let innehall;
  if (q.isPending || kravInloggning) {
    innehall = <p className="text-base text-muted-foreground">Hämtar den sparade värderingen…</p>;
  } else if (q.isError) {
    innehall = <FelRuta>{SERVERFEL_TEXT}</FelRuta>;
  } else if (!q.data.ok) {
    innehall = (
      <FelRuta>
        {q.data.felKod === "hittades_inte" ? "Värderingen hittades inte." : q.data.meddelande}
      </FelRuta>
    );
  } else {
    const v = q.data.vardering;
    const input = v.input;
    rubrik = v.etikett ?? "Sparad värdering";
    innehall = (
      <div className="flex flex-col gap-8">
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Sparad {formatSkapadDatum(v.skapad)}</Badge>
          </div>
          <p className="text-base text-text-2">
            Så här såg värderingen ut när du sparade den (modell {v.modellVersion}). Modellen
            uppdateras över tid; räkna om för att se vad dagens modell säger.
          </p>
          {input !== null ? (
            <div>
              <Button onClick={() => void raknaOm(input)} disabled={raknarOm}>
                {raknarOm ? "Räknar om…" : "Räkna om med dagens modell"}
              </Button>
            </div>
          ) : null}
          {omFel !== null ? <FelRuta>{omFel}</FelRuta> : null}
        </Card>

        {v.resultat !== null ? (
          <PriskollResultat resultat={v.resultat} harSteg2={false} />
        ) : (
          <Callout variant="flag" title="Kan inte visas som den sparades">
            <p>
              Den sparade värderingen har ett format som inte längre stöds.
              {input !== null
                ? " Du kan räkna om den med uppgifterna du angav."
                : " Uppgifterna går inte heller att läsa, så den kan inte öppnas."}
            </p>
          </Callout>
        )}

        {nyttResultat !== null ? (
          <PriskollResultat
            resultat={nyttResultat}
            id="omrakning"
            eyebrow="Omräknat med dagens modell"
            harSteg2={false}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14">
      <header className="mb-8 flex max-w-[760px] flex-col gap-3 md:mb-10">
        <Eyebrow>Sparad värdering</Eyebrow>
        <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-primary md:text-[44px]">
          {rubrik}
        </h1>
      </header>
      {innehall}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <LinkButton to="/analysera" variant="secondary">
          Gör en ny värdering
        </LinkButton>
        <LinkButton to="/konto" variant="ghost">
          Till Mitt konto
        </LinkButton>
      </div>
    </div>
  );
}
