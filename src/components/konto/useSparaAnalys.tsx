import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SparaKnapp } from "@/components/konto/SparaKnapp";
import { SPARA_ANALYS_KNAPP } from "@/components/konto/kontoText";
import { useAterstallUtkast, type AterstallStatus } from "@/components/konto/useAterstallUtkast";
import type { AnalysSparstatus, HamtaSparstatusSvar } from "@/lib/kontoTyper";
import { SPARAT_KEY, useSession } from "@/lib/session";
import { AnalysUtkastSchema, skrivUtkast } from "@/lib/utkast";
import { forberedSparaAnalysFn, hamtaSparstatusFn, sparaAnalysFn } from "@/server/analysFn";

/* "Spara analysen": sidans logik. Vyn är `SparaAnalysVy` (./SparaAnalys.tsx). */

const FORBERED_FEL =
  "Analysen kunde inte förberedas för att sparas. Ladda om sidan och försök igen.";

export interface SparaAnalysTillstand {
  /** undefined medan svaret laddas eller om frågan misslyckades: visa inget. */
  sparstatus: AnalysSparstatus | undefined;
  aterstall: AterstallStatus;
  /** Knappen (en ny instans per plats). */
  knapp: () => ReactNode;
}

/**
 * Sidans halva: sparstatus, knappen och återkomsten med `?spara=analys`. Ska
 * anropas en gång per sida (före tidiga returer), och resultatet ges till båda
 * `SparaAnalysVy`-platserna.
 */
export function useSparaAnalys(args: {
  analysisId: string;
  spara: "analys" | undefined;
  rensaParam: () => void;
}): SparaAnalysTillstand {
  const { analysisId } = args;
  const { lage, session } = useSession();
  const qc = useQueryClient();
  // Nyckeln följer sessionen: efter inloggningen frågas servern på nytt.
  const vem = session?.inloggad ? session.principalId : "utloggad";
  const nyckel = ["analys-sparstatus", analysisId, vem] as const;
  const q = useQuery({
    queryKey: nyckel,
    queryFn: () => hamtaSparstatusFn({ data: { analysisId } }),
    enabled: lage !== "laddar",
    retry: false,
    staleTime: 60_000,
  });

  const markeraSparad = () => {
    const svar: HamtaSparstatusSvar = { status: "sparad" };
    qc.setQueryData(nyckel, svar);
    void qc.invalidateQueries({ queryKey: SPARAT_KEY });
  };

  const aterstall = useAterstallUtkast({
    typ: "analys",
    spara: args.spara,
    schema: AnalysUtkastSchema,
    rensaParam: args.rensaParam,
    aterstall: async () => {
      const svar = await sparaAnalysFn({ data: { analysisId } });
      if (svar.ok) markeraSparad();
      return svar;
    },
  });

  const knapp = () => (
    <SparaKnapp
      typ="analys"
      etikettKnapp={SPARA_ANALYS_KNAPP}
      utloggadTips={null}
      forberedFel={FORBERED_FEL}
      spara={() => sparaAnalysFn({ data: { analysisId } })}
      forbered={async () => {
        const svar = await forberedSparaAnalysFn({ data: { analysisId } });
        if (!svar.ok) return false;
        return skrivUtkast(
          "analys",
          { analysisId },
          typeof window !== "undefined" ? window.location.pathname : `/analys/${analysisId}`,
        );
      }}
      onSparad={markeraSparad}
    />
  );

  return { sparstatus: q.data?.status, aterstall, knapp };
}
