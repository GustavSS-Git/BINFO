import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthAside, AuthSida, FelRuta, InfoRuta, TEXTLANK } from "@/components/konto/AuthSida";
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

const aside = (
  <AuthAside
    rubrik="Bra att veta"
    punkter={[
      "Länken i mejlet fungerar en gång och gäller en begränsad tid.",
      "Är länken ogiltig eller har gått ut kan du begära en ny.",
      "Du måste trycka på knappen för att bekräfta. Då skyddas länken mot mejlskannrar som öppnar den i förväg.",
    ]}
  />
);

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
      <AuthSida eyebrow="Mitt konto" title="Länken fungerar inte" aside={aside}>
        <FelRuta>Länken är ofullständig. Öppna den direkt från mejlet eller begär en ny.</FelRuta>
        <p className="text-[15px] text-text-2">
          <Link to="/konto/logga-in" className={TEXTLANK}>
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
      <AuthSida eyebrow="Mitt konto" title="Kontot är bekräftat" aside={aside}>
        <InfoRuta>
          <p>Din e-postadress är bekräftad och du är inloggad.</p>
        </InfoRuta>
        <Button size="lg" className="w-full" onClick={() => gaTill(lage.mal, lage.spara)}>
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
      aside={aside}
    >
      <div className="space-y-5">
        {lage.typ === "fel" ? (
          <>
            <FelRuta>{lage.meddelande}</FelRuta>
            <p className="text-sm text-muted-foreground">
              <Link
                to={aterstallning ? "/konto/glomt-losenord" : "/konto/logga-in"}
                className={TEXTLANK}
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
