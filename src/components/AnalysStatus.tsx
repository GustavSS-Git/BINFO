import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hamtaStatusFn } from "@/server/analysFn";
import { Link } from "@tanstack/react-router";
import {
  Callout,
  Card,
  Eyebrow,
  LinkButton,
  PageHeader,
  ProgressBar,
  ProgressList,
  Stepper,
} from "@/components/ui/binfo";
import { FELKOD_INNEHALL, kontaktDelar, type AnalysErrorCode } from "@/lib/analysStatusCopy";
import {
  arSkannadRapport,
  designAndel,
  designSteg,
  vantaNotiser,
  vantskarmLiknande,
  vantskarmRubrikrad,
  VANTSKARM_TIPS,
  type StatusVyIndata,
} from "@/lib/analysStatusVy";
import { KONTAKT_EPOST } from "@/lib/kontakt";

/**
 * Delad väntnings-/felskärm för jobbpollning av en analys — används av både
 * `/forhandsvisning/$analysisId` (som väntar in och sen visar hela analysen)
 * och tidigare av `/analys/$analysisId` (som numera aldrig pollar själv: dess
 * loader omdirigerar till `/forhandsvisning` för alla icke-klara/okända
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
 * servern, och ett jobb tar minuter (uppmätt ca 1–3 min, se CLAUDE.md; texten säger "några minuter"), så det
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
    return <Pagar status={status} />;
  }

  return <>{children()}</>;
}

const SIDA = "mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8 md:py-14";

/** Stegindikatorn överst på väntskärmen och dess fel-/hittades-inte-varianter: bostaden och
 *  föreningen är inskickade, rapporten är det som pågår. */
function RapportSteg() {
  return (
    <div className="mb-8">
      <Stepper
        steg={[
          { label: "Bostaden", lage: "klar" },
          { label: "Föreningen", lage: "klar" },
          { label: "Rapport", lage: "aktuell" },
        ]}
      />
    </div>
  );
}

export function Vantar({ text }: { text: string }) {
  return (
    <div className={SIDA}>
      <PageHeader eyebrow="Ett ögonblick" title={text} />
    </div>
  );
}

/** Väntskärmen medan jobbet pollas: sex steg (se `designSteg`), en ärlig
 *  tidsangivelse och, när vi har den, Binfos värdering utan hänsyn till föreningen
 *  medan man väntar. Aldrig ett löfte om att det snart är klart. */
export function Pagar({ status }: { status: StatusVyIndata }) {
  const notiser = vantaNotiser(status);
  const rubrikrad = vantskarmRubrikrad(status);
  const liknande = vantskarmLiknande(status);

  return (
    <div className={SIDA}>
      <RapportSteg />
      {notiser.map((notis) => (
        <div key={notis.titel} className="mb-4">
          <Callout variant="tip" title={notis.titel}>
            <p>{notis.text}</p>
          </Callout>
        </div>
      ))}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            {rubrikrad ? <Eyebrow>{rubrikrad}</Eyebrow> : null}
            <h1 className="font-display text-[30px] font-semibold leading-[1.15] text-primary md:text-[38px]">
              Vi läser årsredovisningen
            </h1>
            <p className="text-base text-text-2">
              Det tar några minuter
              {arSkannadRapport(status)
                ? " (en skannad årsredovisning tar några minuter extra)"
                : ""}
              . Sidan uppdateras själv när rapporten är klar. Spara rapporten då, så hittar du den i
              Mitt konto.{" "}
              <Link to="/exempel" className="font-medium text-link underline underline-offset-2">
                Så här ser en färdig rapport ut
              </Link>
            </p>
          </div>
          <ProgressBar andel={designAndel(status)} label="Så långt har analysen kommit" />
          <ProgressList rader={designSteg(status)} ariaLabel="Stegen i analysen" />
        </Card>
        <aside className="flex flex-col gap-5">
          <Eyebrow>Medan du väntar</Eyebrow>
          {liknande ? (
            <Card className="flex flex-col gap-2">
              <h2 className="text-base font-semibold text-foreground">Liknande lägenheter</h2>
              <p className="font-display text-[34px] font-semibold leading-none text-primary">
                {liknande.varde}
              </p>
              <p className="text-sm text-text-2">{liknande.text}</p>
            </Card>
          ) : null}
          <Callout variant="tip" title="Inför visningen">
            <p>{VANTSKARM_TIPS}</p>
          </Callout>
          <Link
            to="/kopguide"
            className="text-[15px] font-medium text-link underline underline-offset-2"
          >
            Se var du är i köpguiden
          </Link>
        </aside>
      </div>
    </div>
  );
}

/** En text där kontaktfrasen är en mailto-länk när adressen finns (se `kontaktDelar`). */
export function MedKontakt({
  text,
  epost = KONTAKT_EPOST,
}: {
  text: string;
  epost?: string | null;
}) {
  return (
    <>
      {kontaktDelar(text, epost).map((del, i) =>
        typeof del === "string" ? (
          <span key={i}>{del}</span>
        ) : (
          <a key={i} href={del.href} className="font-medium text-link underline underline-offset-2">
            {del.text}
          </a>
        ),
      )}
    </>
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
    <div className={SIDA}>
      <RapportSteg />
      <Card className="flex max-w-[760px] flex-col gap-4">
        <Eyebrow>Analysen kunde inte slutföras</Eyebrow>
        <h1 className="font-display text-[30px] font-semibold leading-[1.15] text-primary md:text-[38px]">
          {innehall.rubrik}
        </h1>
        <p className="text-base text-foreground">{errorMessage ?? innehall.forklaring}</p>
        {errorMessage ? <p className="text-[15px] text-text-2">{innehall.forklaring}</p> : null}
        <p className="text-[15px] font-semibold text-foreground">
          <MedKontakt text={innehall.atgard} />
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
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
    <div className={SIDA}>
      <RapportSteg />
      <Card className="flex max-w-[760px] flex-col gap-4">
        <Eyebrow>Hittades inte</Eyebrow>
        <h1 className="font-display text-[30px] font-semibold leading-[1.15] text-primary md:text-[38px]">
          Vi hittar ingen analys med det här id:t
        </h1>
        <p className="text-base text-text-2">
          Länken kan vara felstavad, eller så finns analysen inte längre. Ladda upp årsredovisningen
          på nytt för att starta en ny analys.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <LinkButton to="/analysera" size="lg">
            Starta en ny analys
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
