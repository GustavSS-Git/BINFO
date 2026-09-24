import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hamtaStatusFn } from "@/server/analysFn";
import { Card, LinkButton, PageHeader } from "@/components/ui/binfo";
import {
  FELKOD_INNEHALL,
  STEG_TEXT,
  stegAndel,
  type AnalysErrorCode,
  type AnalysStage,
} from "@/lib/analysStatusCopy";

/**
 * Delad väntnings-/felskärm för jobbpollning av en analys — används av både
 * `/forhandsvisning/$analysisId` (som väntar in och sen visar förhandsvisningen)
 * och tidigare av `/analys/$analysisId` (som numera aldrig pollar själv: dess
 * loader omdirigerar till förhandsvisningen för alla icke-klara/okända
 * tillstånd, se den routens kommentar). Extraherad hit så att stegtext,
 * förloppsstapel och de sex felkodsskärmarna bara finns skrivna på ett
 * ställe — den här produkten har redan en gång tappat två kopior av en
 * ranking-funktion i otakt, se inte upprepa mönstret för den här UI:n.
 */

/** Formen `hamtaStatusFn` faktiskt svarar med — härledd av funktionens egen
 *  returtyp i stället för att importeras från src/server/portar.ts, som
 *  klientkod inte får nå (se @/lib/analysStatusCopy för samma resonemang). */
export type StatusSvar = Awaited<ReturnType<typeof hamtaStatusFn>>;

/**
 * Pollningsintervall medan jobbet varken är klart eller misslyckat. Några
 * sekunder, inte snabbare — varje pollning är en riktig tur-och-retur till
 * servern, och ett jobb tar 195–326 sekunder totalt (uppmätt kall körning), så det
 * finns inget att vinna på tätare pollning.
 */
export const POLLNINGSINTERVALL_MS = 5000;

/**
 * Pollar `hamtaStatusFn` för ett givet analysisId, sedd med ett status-svar
 * en loader redan hämtat server-sidan. Stannar automatiskt vid ett
 * slutgiltigt tillstånd (`done`/`failed`) via TanStack Querys egen
 * `refetchInterval`-mekanism — ingen handskriven timer att städa upp.
 */
export function useAnalysStatusPolling(analysisId: string, initialStatus: StatusSvar) {
  return useQuery({
    queryKey: ["analys-status", analysisId],
    queryFn: () => hamtaStatusFn({ data: { analysisId } }),
    initialData: initialStatus,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.status === "done" || data.status === "failed") return false;
      return POLLNINGSINTERVALL_MS;
    },
  });
}

/**
 * Poll-och-väntgrind: håller statuspollningen och visar den standardiserade
 * väntnings-/fel-/hittades-inte-skärmen för varje tillstånd utom `done`. När
 * jobbet är klart anropas `children` så att den anropande routen kan rendera
 * sitt eget innehåll (den fullständiga rapporten eller förhandsvisningen).
 */
export function AnalysStatusVakt({
  analysisId,
  initialStatus,
  children,
}: {
  analysisId: string;
  initialStatus: StatusSvar;
  children: () => ReactNode;
}) {
  const statusQuery = useAnalysStatusPolling(analysisId, initialStatus);
  const status = statusQuery.data;

  // I praktiken alltid definierad — loadern levererar redan `status` (kan
  // vara `null`, aldrig `undefined`) innan komponenten ens monteras. Kvar
  // som ett explicit, ofarligt fall snarare än en implicit tom skärm.
  if (status === undefined) {
    return <Vantar text="Kontrollerar status…" />;
  }

  if (status === null) {
    return <HittadesInte />;
  }

  if (status.status === "failed") {
    return <Misslyckad errorCode={status.errorCode} errorMessage={status.errorMessage} />;
  }

  if (status.status !== "done") {
    return <Pagar stage={status.stage} />;
  }

  return <>{children()}</>;
}

export function Vantar({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Ett ögonblick" title={text} />
    </div>
  );
}

/** Väntskärmen medan jobbet pollas — det steg som faktiskt pågår, ett
 *  ärligt tidsspann, och en enkel förloppsstapel. Aldrig ett löfte om att
 *  det snart är klart. */
export function Pagar({ stage }: { stage: AnalysStage }) {
  const andelProcent = Math.round(stegAndel(stage) * 100);

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Analyserar" title="Din analys pågår" />
      <Card>
        <p className="text-base font-medium text-foreground">{STEG_TEXT[stage]}</p>
        <div className="mt-4 h-1.5 w-full rounded-full bg-secondary">
          <div
            className="h-1.5 rounded-full bg-primary transition-[width]"
            style={{ width: `${andelProcent}%` }}
          />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Det här tar normalt <strong className="font-medium text-foreground">3–5 minuter</strong> —
          vi läser hela årsredovisningen och räknar på alla sju nyckeltal. Du kan gärna lämna den
          här fliken öppen; sidan uppdateras automatiskt så fort analysen är klar.
        </p>
      </Card>
    </div>
  );
}

export function Misslyckad({
  errorCode,
  errorMessage,
}: {
  errorCode?: AnalysErrorCode | undefined;
  errorMessage?: string | undefined;
}) {
  const kod = errorCode ?? "unknown";
  const innehall = FELKOD_INNEHALL[kod];

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Analysen kunde inte slutföras" title={innehall.rubrik} />
      <Card>
        <p className="text-sm text-foreground">{errorMessage ?? innehall.forklaring}</p>
        {errorMessage ? (
          <p className="mt-4 text-sm text-muted-foreground">{innehall.forklaring}</p>
        ) : null}
        <p className="mt-4 text-sm font-medium text-foreground">{innehall.atgard}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/analysera" size="lg">
            Till formuläret
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}

export function HittadesInte() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <PageHeader eyebrow="Hittades inte" title="Vi hittar ingen analys med det här id:t" />
      <Card>
        <p className="text-sm text-muted-foreground">
          Länken kan vara felstavad, eller så finns analysen inte längre. Ladda upp årsredovisningen
          på nytt för att starta en ny analys.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/analysera" size="lg">
            Starta en ny analys
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
