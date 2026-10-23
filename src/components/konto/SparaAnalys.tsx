import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FelRuta, InfoRuta } from "@/components/konto/AuthSida";
import { SPARAD_I_PROFIL_TEXT } from "@/components/konto/kontoText";
import type { AterstallStatus } from "@/components/konto/useAterstallUtkast";
import { Card } from "@/components/ui/binfo";
import type { AnalysSparstatus } from "@/lib/kontoTyper";

/*
 * "Spara analysen" på /forhandsvisning/$id och /analys/$id (owner 2026-10-24).
 * Samma flöde som Priskollens Spara (`SparaKnapp` → inloggning med `?till=` och
 * `?spara=analys` → `useAterstallUtkast` på återkomsten), inget eget. Servern
 * avgör allt (`hamtaSparstatus`/`forberedSparaAnalys`/`sparaAnalys` i
 * src/server/sparat.ts): analysen görs aldrig om och inget API anropas.
 * Sidans logik: `useSparaAnalys` (./useSparaAnalys.tsx).
 */

/**
 * Ren vy (testbar utan webbläsare). `topp`: liten rad vid betyget, och där
 * återkomstens besked visas. `kort`: tydligare ruta i slutet, bara när
 * analysen kan sparas. Någon annans analys (`ingen`) → ingenting.
 */
export function SparaAnalysVy({
  variant,
  sparstatus,
  aterstall,
  knapp,
}: {
  variant: "topp" | "kort";
  sparstatus: AnalysSparstatus | undefined;
  aterstall: AterstallStatus;
  knapp: () => ReactNode;
}) {
  const sparad = aterstall.typ === "sparad" || sparstatus === "sparad";

  if (variant === "kort") {
    if (sparad || aterstall.typ === "sparar" || sparstatus !== "kan_sparas") return null;
    return (
      <Card className="mt-10">
        <h2 className="font-display text-xl text-foreground">Spara analysen i din profil</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Logga in eller skapa ett konto, så hittar du tillbaka till analysen under Mitt konto. Du
          kommer tillbaka hit och analysen görs inte om.
        </p>
        <div className="mt-4">{knapp()}</div>
      </Card>
    );
  }

  if (aterstall.typ === "sparar") {
    return (
      <div className="mb-6">
        <InfoRuta>
          <p>Sparar analysen…</p>
        </InfoRuta>
      </div>
    );
  }
  if (aterstall.typ === "sparad") {
    return (
      <div className="mb-6">
        <InfoRuta>
          <p className="font-medium">{SPARAD_I_PROFIL_TEXT}</p>
          <p>
            <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
              Se den i Mitt konto
            </Link>
          </p>
        </InfoRuta>
      </div>
    );
  }
  const fel =
    aterstall.typ === "fel" ? (
      <div className="mb-4">
        <FelRuta>{aterstall.meddelande}</FelRuta>
      </div>
    ) : null;

  if (sparstatus === "sparad") {
    return (
      <p className="mb-6 text-sm text-muted-foreground">
        Sparad i din profil.{" "}
        <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
          Mitt konto
        </Link>
      </p>
    );
  }
  if (sparstatus === "kan_sparas") {
    return (
      <div className="mb-6">
        {fel}
        {knapp()}
      </div>
    );
  }
  return fel;
}
