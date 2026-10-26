import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card, PageHeader } from "@/components/ui/binfo";
import { Prisrimlighet } from "@/components/AnalysRapport";
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

  let innehall;
  if (q.isPending || kravInloggning) {
    innehall = <p className="text-sm text-muted-foreground">Hämtar den sparade värderingen…</p>;
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
    innehall = (
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl text-foreground">
              {v.etikett ?? "Sparad värdering"}
            </h2>
            <Badge>Sparad {formatSkapadDatum(v.skapad)}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Så här såg värderingen ut när du sparade den (modell {v.modellVersion}). Modellen
            uppdateras över tid; räkna om för att se vad dagens modell säger.
          </p>
          {input !== null ? (
            <div className="mt-4">
              <Button onClick={() => void raknaOm(input)} disabled={raknarOm}>
                {raknarOm ? "Räknar om…" : "Räkna om med dagens modell"}
              </Button>
            </div>
          ) : null}
          {omFel !== null ? (
            <div className="mt-4">
              <FelRuta>{omFel}</FelRuta>
            </div>
          ) : null}
        </Card>

        {v.resultat !== null ? (
          <Prisrimlighet prisanalys={v.resultat.prisanalys} boarea={v.resultat.input.boarea} />
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
          <div>
            <h2 className="mb-4 font-display text-2xl text-foreground">
              Omräknat med dagens modell
            </h2>
            <Prisrimlighet
              prisanalys={nyttResultat.prisanalys}
              boarea={nyttResultat.input.boarea}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader eyebrow="Sparad värdering" title="Priskoll" />
      {innehall}
      <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
        <Link
          to="/analysera"
          search={{}}
          className="font-medium text-primary underline underline-offset-2"
        >
          Gör en ny värdering
        </Link>
        <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
          Till Mitt konto
        </Link>
      </div>
    </div>
  );
}
