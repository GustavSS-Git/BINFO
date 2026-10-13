import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, LinkButton, SectionTitle } from "@/components/ui/binfo";
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
import { formatSkapadDatum } from "@/lib/analysisView";
import type { AnalysPost, SparadKalkylPost, SparadVarderingPost } from "@/lib/kontoTyper";

const kr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const prosent = (n: number) => `${n.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} %`;

/** Bekräftelsedialog (shadcn alert-dialog). Dialogen stängs först när `onBekrafta` är klar. */
export function BekraftaDialog({
  knapp,
  rubrik,
  text,
  bekraftaText,
  onBekrafta,
}: {
  knapp: string;
  rubrik: string;
  text: ReactNode;
  bekraftaText: string;
  /** Returnera false för att hålla dialogen öppen (t.ex. fel lösenord). */
  onBekrafta: () => Promise<boolean | void>;
}) {
  const [oppen, setOppen] = useState(false);
  const [arbetar, setArbetar] = useState(false);
  return (
    <AlertDialog open={oppen} onOpenChange={setOppen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost">{knapp}</Button>
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
            {arbetar ? "Tar bort…" : bekraftaText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
    <li className="flex flex-wrap items-start justify-between gap-4 border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{datum}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 font-medium text-foreground">
          <span>{rubrik}</span>
          {badges}
        </p>
        {detaljer.length > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{detaljer.join(" · ")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{atgarder}</div>
    </li>
  );
}

function Tom({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

const KAN_INTE_OPPNAS = <Badge tone="warning">Kan inte öppnas</Badge>;

const STATUS_TEXT: Record<
  AnalysPost["status"],
  { text: string; tone: "neutral" | "teal" | "danger" }
> = {
  pagar: { text: "Pågår", tone: "neutral" },
  klar: { text: "Klar", tone: "teal" },
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
    <Card>
      <SectionTitle>Analyser</SectionTitle>
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
                    <Badge tone={status.tone}>{status.text}</Badge>
                    {a.betyg !== null ? <Badge tone="teal">Betyg {a.betyg}</Badge> : null}
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
                      className="inline-flex items-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                    >
                      Öppna
                    </Link>
                    <BekraftaDialog
                      knapp="Ta bort från listan"
                      rubrik="Ta bort analysen från din lista?"
                      bekraftaText="Ta bort från listan"
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
    </Card>
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
    <Card>
      <SectionTitle>Värderingar</SectionTitle>
      {varderingar.length === 0 ? (
        <Tom text="Du har inga sparade värderingar. Gör en priskoll och tryck på Spara.">
          <LinkButton to="/vardering" variant="secondary">
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
                  ...(v.vardering !== null ? [`Värdering ${kr(v.vardering)}`] : []),
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
                      <Link
                        to="/vardering"
                        search={{ sparad: v.id }}
                        className="inline-flex items-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
                      >
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
    </Card>
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
    <Card>
      <SectionTitle>Bolånekalkyler</SectionTitle>
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
                      className="inline-flex items-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
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
    </Card>
  );
}
