import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthSida, FelRuta, InfoRuta } from "@/components/konto/AuthSida";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { useGaTill } from "@/components/konto/useGaTill";
import { Button } from "@/components/ui/binfo";
import type { EpostLankTyp } from "@/lib/kontoTyper";
import { bekraftaEpostFn } from "@/server/analysFn";
import { useSessionAtgarder } from "@/lib/session";
import { parseKontoSok, type SparaTyp } from "@/lib/till";
import { lasUtkastMal } from "@/lib/utkast";

const TYPER: readonly EpostLankTyp[] = ["signup", "recovery", "email_change"];

export const Route = createFileRoute("/konto/bekrafta")({
  head: () => kontoHead("Bekräfta e-postadress"),
  validateSearch: (s: Record<string, unknown>) => {
    const type = TYPER.find((t) => t === s["type"]);
    return {
      ...parseKontoSok(s),
      ...(typeof s["token_hash"] === "string" ? { token_hash: s["token_hash"] } : {}),
      ...(type !== undefined ? { type } : {}),
    };
  },
  component: Bekrafta,
});

type Lage =
  | { typ: "vilar" }
  | { typ: "kontrollerar" }
  | { typ: "klar"; mal: string; spara: SparaTyp | undefined }
  | { typ: "fel"; meddelande: string };

/**
 * Mejllänken verifieras INTE vid sidladdning: virusskannrar och länkförhandsvisare
 * öppnar länkar och skulle förbruka engångskoden. Först när personen trycker på
 * knappen anropas servern.
 */
function Bekrafta() {
  const { token_hash: tokenHash, type, till, spara } = Route.useSearch();
  const gaTill = useGaTill();
  const { sattInloggad } = useSessionAtgarder();
  const [lage, setLage] = useState<Lage>({ typ: "vilar" });

  if (tokenHash === undefined || type === undefined) {
    return (
      <AuthSida eyebrow="Mitt konto" title="Länken fungerar inte">
        <FelRuta>Länken är ofullständig. Öppna den direkt från mejlet eller begär en ny.</FelRuta>
        <p className="mt-6 text-sm text-muted-foreground">
          <Link
            to="/konto/logga-in"
            className="font-medium text-primary underline underline-offset-2"
          >
            Till inloggningen
          </Link>
        </p>
      </AuthSida>
    );
  }

  const bekrafta = async () => {
    if (lage.typ === "kontrollerar") return;
    setLage({ typ: "kontrollerar" });
    try {
      const svar = await bekraftaEpostFn({ data: { tokenHash, typ: type } });
      if (!svar.ok) {
        setLage({ typ: "fel", meddelande: svar.meddelande });
        return;
      }
      sattInloggad(svar.epost, svar.principalId);
      if (svar.typ === "recovery") {
        gaTill("/konto/nytt-losenord");
        return;
      }
      // Länken öppnas ofta i en ny flik utan `?till=`; då pekar utkastet ut målet.
      const utkastMal = till === undefined ? lasUtkastMal() : null;
      setLage({
        typ: "klar",
        mal: till ?? utkastMal?.till ?? "/konto",
        spara: spara ?? utkastMal?.typ,
      });
    } catch (error) {
      console.error("[bekrafta] bekraftaEpostFn kastade:", error);
      setLage({ typ: "fel", meddelande: GENERELLT_FEL });
    }
  };

  if (lage.typ === "klar") {
    return (
      <AuthSida eyebrow="Mitt konto" title="Kontot är bekräftat">
        <InfoRuta>
          <p>Din e-postadress är bekräftad och du är inloggad.</p>
        </InfoRuta>
        <Button size="lg" className="mt-6 w-full" onClick={() => gaTill(lage.mal, lage.spara)}>
          {lage.spara !== undefined ? "Fortsätt och spara" : "Fortsätt"}
        </Button>
      </AuthSida>
    );
  }

  const aterstallning = type === "recovery";
  return (
    <AuthSida
      eyebrow="Mitt konto"
      title={aterstallning ? "Välj nytt lösenord" : "Bekräfta din e-postadress"}
      lead={
        aterstallning
          ? "Tryck på knappen för att fortsätta och välja ett nytt lösenord."
          : "Tryck på knappen för att bekräfta din e-postadress och logga in."
      }
    >
      <div className="space-y-5">
        {lage.typ === "fel" ? (
          <>
            <FelRuta>{lage.meddelande}</FelRuta>
            <p className="text-sm text-muted-foreground">
              <Link
                to={aterstallning ? "/konto/glomt-losenord" : "/konto/logga-in"}
                className="font-medium text-primary underline underline-offset-2"
              >
                {aterstallning ? "Begär en ny länk" : "Till inloggningen"}
              </Link>
            </p>
          </>
        ) : null}
        <Button
          size="lg"
          className="w-full"
          onClick={() => void bekrafta()}
          disabled={lage.typ === "kontrollerar"}
        >
          {lage.typ === "kontrollerar"
            ? "Kontrollerar…"
            : aterstallning
              ? "Fortsätt"
              : "Bekräfta e-postadressen"}
        </Button>
      </div>
    </AuthSida>
  );
}
