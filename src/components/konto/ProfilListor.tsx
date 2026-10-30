import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Badge, Button, GradeBadge, LinkButton, StatusPill } from "@/components/ui/binfo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SparadKalkylExport } from "@/components/konto/SparadKalkylExport";
import { ARBETAR_RADERA, ARBETAR_TA_BORT, bekraftaKnappText } from "@/components/konto/kontoText";
import { PapperskorgIkon, RAD_FARA, RAD_KNAPP } from "@/components/konto/radAtgard";
import { formatSkapadDatum, formatVardeAvrundat } from "@/lib/analysisView";
import type { AnalysPost, SparadKalkylPost, SparadVarderingPost } from "@/lib/kontoTyper";

const kr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const prosent = (n: number) => `${n.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;

/** Bekräftelsedialog (shadcn alert-dialog). Dialogen stängs först när `onBekrafta` är klar. */
export function BekraftaDialog({
  knapp,
  rubrik,
  text,
  bekraftaText,
  arbetarText = ARBETAR_RADERA,
  utlosare = "lank",
  onBekrafta,
}: {
  knapp: string;
  rubrik: string;
  text: ReactNode;
  bekraftaText: string;
  /** Knapptexten medan åtgärden pågår; ska passa åtgärden ("Tar bort…", "Raderar…"). */
  arbetarText?: string;
  /** `lank`: röd textknapp med papperskorg (rader i listor). `knapp`: ram runt (Radera konto). */
  utlosare?: "lank" | "knapp";
  /** Returnera false för att hålla dialogen öppen (t.ex. fel lösenord). */
  onBekrafta: () => Promise<boolean | void>;
}) {
  const [oppen, setOppen] = useState(false);
  const [arbetar, setArbetar] = useState(false);
  return (
    <AlertDialog open={oppen} onOpenChange={setOppen}>
      <AlertDialogTrigger asChild>
        {utlosare === "knapp" ? (
          <Button variant="danger">{knapp}</Button>
        ) : (
          <button type="button" className={RAD_FARA}>
            <PapperskorgIkon />
            {knapp}
          </button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{rubrik}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{text}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={arbetar}>Avbryt</AlertDialogCancel>
          <AlertDialogAction
            disabled={arbetar}
            onClick={async (e) => {
              e.preventDefault();
              setArbetar(true);
              let stang: boolean | void = true;
              try {
                stang = await onBekrafta();
              } finally {
                setArbetar(false);
                if (stang !== false) setOppen(false);
              }
            }}
          >
            {bekraftaKnappText(arbetar, bekraftaText, arbetarText)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Ett kort per lista: rubrik 19 px, förklaring, rader. */
function Lista({ rubrik, hint, children }: { rubrik: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-5 sm:p-7">
      <h2 className="mb-2 text-[19px] font-semibold leading-snug text-foreground">{rubrik}</h2>
      <p className="mb-2 text-sm text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function Rad({
  datum,
  rubrik,
  badges,
  detaljer,
  atgarder,
}: {
  datum: string;
  rubrik: string;
  badges?: ReactNode;
  detaljer: string[];
  atgarder: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-t border-divider py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[13px] text-muted-foreground">{datum}</p>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-base text-foreground">
          <strong className="font-semibold">{rubrik}</strong>
          {badges}
        </p>
        {detaljer.length > 0 ? (
          <p className="text-sm tabular-nums text-text-2">{detaljer.join(" · ")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{atgarder}</div>
    </li>
  );
}

function Tom({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 border-t border-divider pt-4">
      <p className="text-[15px] text-text-2">{text}</p>
      {children}
    </div>
  );
}

const KAN_INTE_OPPNAS = <Badge tone="warning">Kan inte öppnas</Badge>;

const STATUS_TEXT: Record<
  AnalysPost["status"],
  { text: string; tone: "neutral" | "success" | "danger" }
> = {
  pagar: { text: "Pågår", tone: "neutral" },
  klar: { text: "Klar", tone: "success" },
  misslyckad: { text: "Misslyckades", tone: "danger" },
};

export function AnalysLista({
  analyser,
  onTaBort,
}: {
  analyser: AnalysPost[];
  onTaBort: (analysisId: string) => Promise<void>;
}) {
  return (
    <Lista rubrik="Analyser" hint="Bostäder där du har laddat upp årsredovisningen.">
      {analyser.length === 0 ? (
        <Tom text="Du har inga analyser än. Ladda upp en årsredovisning så hamnar analysen här.">
          <LinkButton to="/analysera" variant="secondary">
            Analysera en bostad
          </LinkButton>
        </Tom>
      ) : (
        <ul>
          {analyser.map((a) => {
            const status = STATUS_TEXT[a.status];
            return (
              <Rad
                key={a.analysisId}
                datum={formatSkapadDatum(a.skapad)}
                rubrik={a.foreningNamn ?? "Förening ej identifierad"}
                badges={
                  <>
                    <StatusPill tone={status.tone} label={status.text} />
                    {a.betyg !== null ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-2">
                        <span aria-hidden="true">Betyg</span>
                        <GradeBadge grade={a.betyg} size="sm" />
                      </span>
                    ) : null}
                  </>
                }
                detaljer={[
                  ...(a.adress !== null ? [a.adress] : []),
                  ...(a.rakenskapsar !== null ? [`Räkenskapsår ${a.rakenskapsar}`] : []),
                  ...(a.utgangspris !== null ? [`Utgångspris ${kr(a.utgangspris)}`] : []),
                ]}
                atgarder={
                  <>
                    <Link
                      to={
                        a.status === "klar" ? "/analys/$analysisId" : "/forhandsvisning/$analysisId"
                      }
                      params={{ analysisId: a.analysisId }}
                      className={RAD_KNAPP}
                    >
                      Öppna
                    </Link>
                    <BekraftaDialog
                      knapp="Ta bort från listan"
                      rubrik="Ta bort analysen från din lista?"
                      bekraftaText="Ta bort från listan"
                      arbetarText={ARBETAR_TA_BORT}
                      text={
                        <>
                          <p>
                            Analysen försvinner från din lista och dina uppgifter om lägenheten
                            (adress och pris) raderas. Själva rapporten om föreningen finns kvar i
                            Binfos register.
                          </p>
                          <p>
                            Länken till analysen slutar fungera, så spara den på annat håll om du
                            vill kunna öppna den igen.
                          </p>
                        </>
                      }
                      onBekrafta={() => onTaBort(a.analysisId)}
                    />
                  </>
                }
              />
            );
          })}
        </ul>
      )}
    </Lista>
  );
}

export function VarderingLista({
  varderingar,
  onRadera,
}: {
  varderingar: SparadVarderingPost[];
  onRadera: (id: string) => Promise<void>;
}) {
  return (
    <Lista
      rubrik="Värderingar"
      hint="Sparade värderingar utan hänsyn till föreningen. Du kan räkna om dem med dagens modell."
    >
      {varderingar.length === 0 ? (
        <Tom text="Du har inga sparade värderingar. Gör en priskoll och tryck på Spara.">
          <LinkButton to="/analysera" variant="secondary">
            Gör en priskoll
          </LinkButton>
        </Tom>
      ) : (
        <ul>
          {varderingar.map((v) => {
            const kanOppnas = v.input !== null;
            return (
              <Rad
                key={v.id}
                datum={formatSkapadDatum(v.skapad)}
                rubrik={
                  v.etikett ?? (v.input !== null ? `Postnummer ${v.input.postnummer}` : "Värdering")
                }
                badges={kanOppnas ? null : KAN_INTE_OPPNAS}
                detaljer={[
                  ...(v.vardering !== null
                    ? [`Liknande lägenheter ca ${formatVardeAvrundat(v.vardering)}`]
                    : []),
                  ...(v.input !== null
                    ? [
                        `${v.input.boarea.toLocaleString("sv-SE")} m²`,
                        ...(v.input.utgangspris !== undefined
                          ? [`Utgångspris ${kr(v.input.utgangspris)}`]
                          : []),
                      ]
                    : []),
                ]}
                atgarder={
                  <>
                    {kanOppnas ? (
                      <Link to="/analysera" search={{ sparad: v.id }} className={RAD_KNAPP}>
                        Öppna
                      </Link>
                    ) : null}
                    <BekraftaDialog
                      knapp="Radera"
                      rubrik="Radera värderingen?"
                      bekraftaText="Radera"
                      text={
                        <p>Den sparade värderingen raderas permanent. Det går inte att ångra.</p>
                      }
                      onBekrafta={() => onRadera(v.id)}
                    />
                  </>
                }
              />
            );
          })}
        </ul>
      )}
    </Lista>
  );
}

export function KalkylLista({
  kalkyler,
  onRadera,
}: {
  kalkyler: SparadKalkylPost[];
  onRadera: (id: string) => Promise<void>;
}) {
  return (
    <Lista rubrik="Bolånekalkyler" hint="Kalkyler du har sparat från bolånekalkylen.">
      {kalkyler.length === 0 ? (
        <Tom text="Du har inga sparade bolånekalkyler. Räkna på ditt bolån och tryck på Spara.">
          <LinkButton to="/bolanekalkyl" variant="secondary">
            Öppna bolånekalkylen
          </LinkButton>
        </Tom>
      ) : (
        <ul>
          {kalkyler.map((k) => {
            const s = k.sammanfattning;
            return (
              <Rad
                key={k.id}
                datum={formatSkapadDatum(k.uppdaterad)}
                rubrik={k.etikett ?? "Bolånekalkyl"}
                detaljer={
                  s === null
                    ? []
                    : [
                        ...(s.totalPerManad !== null
                          ? [
                              s.totalPerManadHog !== undefined &&
                              s.totalPerManadHog !== null &&
                              s.totalPerManadHog !== s.totalPerManad
                                ? `${kr(s.totalPerManad)}–${kr(s.totalPerManadHog)} i månaden efter ränteavdrag`
                                : `${kr(s.totalPerManad)} i månaden efter ränteavdrag`,
                            ]
                          : []),
                        ...(s.belaningsgradProcent !== null
                          ? [`Belåningsgrad ${prosent(s.belaningsgradProcent)}`]
                          : []),
                        ...(s.amorteringstaktProcent !== null
                          ? [`Amortering ${prosent(s.amorteringstaktProcent)} per år`]
                          : []),
                      ]
                }
                atgarder={
                  <>
                    {/* Vanlig länk: kalkylsidans sökparametrar ägs av kalkylflödet. Öppnas
                        även när sammanfattningen saknas: kalkylsidan avgör om underlaget går
                        att läsa och säger till om det inte gör det. */}
                    <a
                      href={`/bolanekalkyl?sparad=${encodeURIComponent(k.id)}`}
                      className={RAD_KNAPP}
                    >
                      Öppna
                    </a>
                    <SparadKalkylExport id={k.id} etikett={k.etikett} />
                    <BekraftaDialog
                      knapp="Radera"
                      rubrik="Radera kalkylen?"
                      bekraftaText="Radera"
                      text={<p>Den sparade kalkylen raderas permanent. Det går inte att ångra.</p>}
                      onBekrafta={() => onRadera(k.id)}
                    />
                  </>
                }
              />
            );
          })}
        </ul>
      )}
    </Lista>
  );
}
