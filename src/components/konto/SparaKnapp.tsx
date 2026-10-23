import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { SparaKnappVy, type SparaLage } from "@/components/konto/SparaKnappVy";
import { GENERELLT_FEL } from "@/components/konto/kontoText";
import { useSession } from "@/lib/session";
import { inloggningsSok, type SparaTyp } from "@/lib/till";

/** Det SparaKnapp behöver veta om ett sparförsök. Matchar formen på `KontoFel`. */
export type SparaUtfall = { ok: true } | { ok: false; felKod?: string; meddelande: string };

export interface SparaKnappProps {
  typ: SparaTyp;
  /** Inloggad: spara direkt. */
  spara: () => Promise<SparaUtfall>;
  /** Utloggad: skriv utkastet (se `skrivUtkast` i `@/lib/utkast`). True om det lyckades. */
  skrivUtkast: () => boolean;
  /** Knapptext, t.ex. "Spara värderingen". */
  etikettKnapp: string;
  /** Sidan man ska tillbaka till efter inloggning. Standard: nuvarande sökväg. */
  till?: string;
  /** Anropas efter ett lyckat sparande. */
  onSparad?: () => void;
}

/**
 * "Spara"-knapp. Inloggad sparar den direkt och visar "Sparad". Utloggad
 * skriver den utkastet och skickar användaren till inloggning, med `?till=`
 * och `?spara=` så att målsidan kan slutföra sparandet (se `useAterstallUtkast`).
 */
export function SparaKnapp(props: SparaKnappProps) {
  const { lage: sessionLage } = useSession();
  const navigate = useNavigate();
  const [lage, setLage] = useState<SparaLage>("vilar");
  const [fel, setFel] = useState<string | null>(null);

  const tillInloggning = () => {
    const till =
      props.till ?? (typeof window !== "undefined" ? window.location.pathname : "/analysera");
    if (!props.skrivUtkast()) {
      setFel(
        "Webbläsaren tillåter inte att vi tillfälligt sparar dina uppgifter. Logga in först och fyll sedan i uppgifterna igen.",
      );
      setLage("fel");
      return;
    }
    void navigate({ to: "/konto/logga-in", search: inloggningsSok(till, props.typ) });
  };

  const onKlick = async () => {
    if (lage === "sparar") return;
    if (sessionLage !== "inloggad") {
      tillInloggning();
      return;
    }
    setLage("sparar");
    setFel(null);
    try {
      const svar = await props.spara();
      if (svar.ok) {
        setLage("sparad");
        props.onSparad?.();
      } else if (svar.felKod === "ej_inloggad") {
        // Sessionen hann gå ut: samma väg som om man inte var inloggad.
        setLage("vilar");
        tillInloggning();
      } else {
        setFel(svar.meddelande);
        setLage("fel");
      }
    } catch (error) {
      console.error("[SparaKnapp] spara kastade:", error);
      setFel(GENERELLT_FEL);
      setLage("fel");
    }
  };

  return (
    <SparaKnappVy
      sessionLage={sessionLage}
      lage={lage}
      fel={fel}
      etikettKnapp={props.etikettKnapp}
      onKlick={() => void onKlick()}
    />
  );
}
