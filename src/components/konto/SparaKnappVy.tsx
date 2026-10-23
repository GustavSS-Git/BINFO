import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/binfo";
import { FelRuta, InfoRuta } from "@/components/konto/AuthSida";
import type { SessionLage } from "@/lib/till";

const UTLOGGAD_TIPS =
  "Du behöver ett konto för att spara. Dina uppgifter finns kvar när du har loggat in.";

export type SparaLage = "vilar" | "sparar" | "sparad" | "fel";

/** Ren vy för Spara-knappen (testbar utan webbläsare). Logiken ligger i `SparaKnapp`. */
export function SparaKnappVy({
  sessionLage,
  lage,
  fel,
  etikettKnapp,
  utloggadTips = UTLOGGAD_TIPS,
  onKlick,
}: {
  sessionLage: SessionLage;
  lage: SparaLage;
  fel: string | null;
  etikettKnapp: string;
  /** Texten bredvid knappen när man är utloggad; null = ingen text. */
  utloggadTips?: string | null;
  onKlick: () => void;
}) {
  if (lage === "sparad") {
    return (
      <InfoRuta>
        <p className="font-medium">Sparad i ditt konto.</p>
        <p>
          <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
            Se dina sparade uppgifter i Mitt konto
          </Link>
        </p>
      </InfoRuta>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={onKlick}
          disabled={lage === "sparar" || sessionLage === "laddar"}
        >
          {lage === "sparar" ? "Sparar…" : etikettKnapp}
        </Button>
        {sessionLage === "utloggad" && utloggadTips !== null ? (
          <span className="text-sm text-muted-foreground">{utloggadTips}</span>
        ) : null}
      </div>
      {lage === "fel" && fel !== null ? <FelRuta>{fel}</FelRuta> : null}
    </div>
  );
}
