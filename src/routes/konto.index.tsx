import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BekraftaDialog,
  AnalysLista,
  KalkylLista,
  VarderingLista,
} from "@/components/konto/ProfilListor";
import { FelRuta } from "@/components/konto/AuthSida";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { useGaTill } from "@/components/konto/useGaTill";
import { Button, Card, Field, PageHeader, SectionTitle } from "@/components/ui/binfo";
import {
  hamtaMinaUppgifterFn,
  listaSparatFn,
  loggaUtFn,
  raderaKontoFn,
  raderaSparadKalkylFn,
  raderaSparadVarderingFn,
  taBortAnalysFranListaFn,
} from "@/server/analysFn";
import type { KontoSvar } from "@/lib/kontoTyper";
import { SPARAT_KEY, useSession, useSessionAtgarder } from "@/lib/session";

export const Route = createFileRoute("/konto/")({
  head: () => kontoHead("Mitt konto"),
  component: Konto,
});

/** `mina-uppgifter` får datumet i filnamnet (lokal tid är tillräckligt för en nedladdning). */
function nedladdningsNamn(nu = new Date()): string {
  return `binfo-mina-uppgifter-${nu.toISOString().slice(0, 10)}.json`;
}

function laddaNerJson(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nedladdningsNamn();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Konto() {
  const gaTill = useGaTill();
  const qc = useQueryClient();
  const { lage, epost } = useSession();
  const { sattUtloggad } = useSessionAtgarder();
  const [fel, setFel] = useState<string | null>(null);

  const sparat = useQuery({
    queryKey: SPARAT_KEY,
    queryFn: () => listaSparatFn(),
    enabled: lage === "inloggad",
    retry: false,
  });

  const behovInloggning =
    lage === "utloggad" ||
    (sparat.data !== undefined && !sparat.data.ok && sparat.data.felKod === "ej_inloggad");

  useEffect(() => {
    if (behovInloggning) gaTill("/konto/logga-in?till=/konto", undefined, "/konto");
  }, [behovInloggning]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Kör en borttagning; fel visas ordagrant, lyckat svar läser om listorna. */
  const kor = async (anrop: () => Promise<KontoSvar>) => {
    setFel(null);
    try {
      const svar = await anrop();
      if (!svar.ok) setFel(svar.meddelande);
      await qc.invalidateQueries({ queryKey: SPARAT_KEY });
    } catch (error) {
      console.error("[konto] åtgärd kastade:", error);
      setFel(GENERELLT_FEL);
    }
  };

  if (lage === "laddar" || behovInloggning) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-14">
        <PageHeader eyebrow="Mitt konto" title="Mitt konto" />
        <p className="text-sm text-muted-foreground">Laddar…</p>
      </div>
    );
  }

  const data = sparat.data !== undefined && sparat.data.ok ? sparat.data : null;
  const listFel =
    sparat.isError || (sparat.data !== undefined && !sparat.data.ok)
      ? sparat.data !== undefined && !sparat.data.ok
        ? sparat.data.meddelande
        : GENERELLT_FEL
      : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Mitt konto"
        title="Mitt konto"
        {...(epost !== null ? { lead: `Inloggad som ${epost}.` } : {})}
      />

      <div className="space-y-6">
        {fel !== null ? <FelRuta>{fel}</FelRuta> : null}

        {listFel !== null ? (
          <FelRuta>
            {listFel}{" "}
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2"
              onClick={() => void sparat.refetch()}
            >
              Försök igen
            </button>
          </FelRuta>
        ) : data === null ? (
          <p className="text-sm text-muted-foreground">Hämtar dina sparade uppgifter…</p>
        ) : (
          <>
            <AnalysLista
              analyser={data.analyser}
              onTaBort={(analysisId) =>
                kor(() => taBortAnalysFranListaFn({ data: { analysisId } }))
              }
            />
            <VarderingLista
              varderingar={data.varderingar}
              onRadera={(id) => kor(() => raderaSparadVarderingFn({ data: { id } }))}
            />
            <KalkylLista
              kalkyler={data.kalkyler}
              onRadera={(id) => kor(() => raderaSparadKalkylFn({ data: { id } }))}
            />
          </>
        )}

        <Kontoinstallningar
          onLoggaUt={async () => {
            try {
              await loggaUtFn();
            } catch (error) {
              console.error("[konto] loggaUtFn kastade:", error);
            }
            sattUtloggad();
            gaTill("/", undefined, "/");
          }}
          onRaderat={() => {
            sattUtloggad();
            gaTill("/", undefined, "/");
          }}
          setFel={setFel}
        />
      </div>
    </div>
  );
}

function Kontoinstallningar({
  onLoggaUt,
  onRaderat,
  setFel,
}: {
  onLoggaUt: () => Promise<void>;
  onRaderat: () => void;
  setFel: (fel: string | null) => void;
}) {
  const [laddar, setLaddar] = useState(false);
  const [losenord, setLosenord] = useState("");
  const [raderaFel, setRaderaFel] = useState<string | null>(null);

  const ladda = async () => {
    setFel(null);
    setLaddar(true);
    try {
      const svar = await hamtaMinaUppgifterFn();
      if (svar.ok) laddaNerJson(svar.json);
      else setFel(svar.meddelande);
    } catch (error) {
      console.error("[konto] hamtaMinaUppgifterFn kastade:", error);
      setFel(GENERELLT_FEL);
    } finally {
      setLaddar(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Konto</SectionTitle>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Link
            to="/konto/nytt-losenord"
            search={{ nuvarande: "ja" }}
            className="inline-flex items-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Byt lösenord
          </Link>
          <Button variant="secondary" onClick={() => void ladda()} disabled={laddar}>
            {laddar ? "Hämtar…" : "Ladda ner mina uppgifter"}
          </Button>
          <Button variant="secondary" onClick={() => void onLoggaUt()}>
            Logga ut
          </Button>
        </div>

        <div className="border-t border-border pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-danger">Radera konto</p>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Raderar kontot och allt som är sparat i det: dina värderingar, bolånekalkyler och
            analyslistan. Föreningsrapporterna finns kvar i Binfos register. Det går inte att ångra.
          </p>
          <div className="mt-4">
            <BekraftaDialog
              knapp="Radera mitt konto"
              rubrik="Radera kontot?"
              bekraftaText="Radera kontot"
              text={
                <>
                  <p>Ange ditt lösenord för att bekräfta. Kontot och allt sparat i det raderas.</p>
                  <Field
                    label="Lösenord"
                    type="password"
                    value={losenord}
                    onChange={setLosenord}
                    error={raderaFel}
                  />
                </>
              }
              onBekrafta={async () => {
                setRaderaFel(null);
                try {
                  const svar = await raderaKontoFn({ data: { losenord } });
                  if (svar.ok) {
                    onRaderat();
                    return true;
                  }
                  setRaderaFel(svar.meddelande);
                } catch (error) {
                  console.error("[konto] raderaKontoFn kastade:", error);
                  setRaderaFel(GENERELLT_FEL);
                }
                return false;
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
