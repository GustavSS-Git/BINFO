import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BekraftaDialog,
  AnalysLista,
  KalkylLista,
  VarderingLista,
} from "@/components/konto/ProfilListor";
import { FelRuta, TEXTLANK } from "@/components/konto/AuthSida";
import { KopguideKort } from "@/components/konto/KopguideKort";
import { NedladdningIkon, RAD_KNAPP } from "@/components/konto/radAtgard";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { useGaTill } from "@/components/konto/useGaTill";
import { Button, Eyebrow, Field, LinkButton } from "@/components/ui/binfo";
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

  // Set when the user logs out or deletes the account here: the page then goes to
  // the start page, and the "not logged in → login" redirect below must not win the race.
  const lamnar = useRef(false);
  useEffect(() => {
    if (behovInloggning && !lamnar.current) {
      gaTill("/konto/logga-in?till=/konto", undefined, "/konto");
    }
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
      <div className={SIDA}>
        <Rubrik epost={null} />
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
    <div className={SIDA}>
      <Rubrik epost={epost} />

      {fel !== null ? <FelRuta>{fel}</FelRuta> : null}

      {listFel !== null ? (
        <FelRuta>
          {listFel}{" "}
          <button type="button" className={TEXTLANK} onClick={() => void sparat.refetch()}>
            Försök igen
          </button>
        </FelRuta>
      ) : data === null ? (
        <p className="text-sm text-muted-foreground">Hämtar dina sparade uppgifter…</p>
      ) : (
        <>
          <AnalysLista
            analyser={data.analyser}
            onTaBort={(analysisId) => kor(() => taBortAnalysFranListaFn({ data: { analysisId } }))}
          />
          <VarderingLista
            varderingar={data.varderingar}
            onRadera={(id) => kor(() => raderaSparadVarderingFn({ data: { id } }))}
          />
          <div className="flex flex-wrap items-stretch gap-5">
            <div className="flex flex-[2_1_560px] flex-col [&>section]:flex-1">
              <KalkylLista
                kalkyler={data.kalkyler}
                onRadera={(id) => kor(() => raderaSparadKalkylFn({ data: { id } }))}
              />
            </div>
            <div className="flex flex-[1_1_300px] flex-col [&>section]:flex-1">
              <KopguideKort />
            </div>
          </div>
        </>
      )}

      <p className="text-sm text-muted-foreground">
        Innan något raderas får du bekräfta. Det går inte att ångra. Tar du bort en analys från
        listan finns föreningens rapport kvar i registret, men länken till din analys slutar
        fungera.
      </p>

      <Kontoinstallningar
        epost={epost}
        onLoggaUt={async () => {
          try {
            await loggaUtFn();
          } catch (error) {
            console.error("[konto] loggaUtFn kastade:", error);
          }
          lamnar.current = true;
          sattUtloggad();
          gaTill("/", undefined, "/");
        }}
        onRaderat={() => {
          lamnar.current = true;
          sattUtloggad();
          gaTill("/", undefined, "/");
        }}
        setFel={setFel}
      />
    </div>
  );
}

const SIDA = "mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-24 pt-10 sm:px-8 md:pt-12";

function Rubrik({ epost }: { epost: string | null }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Eyebrow>Mitt konto</Eyebrow>
        <h1 className="font-display text-[34px] font-semibold leading-[1.1] text-primary md:text-[44px]">
          Sparat
        </h1>
        {epost !== null ? (
          <p className="text-base text-text-2">
            Inloggad som <strong className="font-semibold text-foreground">{epost}</strong>.
          </p>
        ) : null}
      </div>
      <LinkButton to="/analysera" size="lg">
        Analysera en bostad
      </LinkButton>
    </header>
  );
}

const KORT = "flex flex-1 basis-[360px] flex-col gap-3 rounded-lg border bg-card p-5 sm:p-7";
const KORT_RUBRIK = "mb-2 text-[19px] font-semibold leading-snug text-foreground";

function Kontoinstallningar({
  onLoggaUt,
  onRaderat,
  setFel,
  epost,
}: {
  onLoggaUt: () => Promise<void>;
  onRaderat: () => void;
  setFel: (fel: string | null) => void;
  epost: string | null;
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
    <section id="installningar" className="flex flex-col gap-4">
      <h2 className="font-display text-[28px] font-semibold text-primary">Konto</h2>
      <div className="flex flex-wrap items-stretch gap-5">
        <section className={`${KORT} border-border`}>
          <h3 className={KORT_RUBRIK}>Inloggning</h3>
          {epost !== null ? <p className="text-[15px] text-text-2">{epost}</p> : null}
          <p className="text-sm text-muted-foreground">
            Hit skickar vi länkar för att återställa lösenordet.
          </p>
          <div className="mt-1 flex flex-wrap gap-2.5">
            <Link to="/konto/nytt-losenord" search={{ nuvarande: "ja" }} className={RAD_KNAPP}>
              Byt lösenord
            </Link>
            <Button variant="secondary" onClick={() => void onLoggaUt()}>
              Logga ut
            </Button>
          </div>
        </section>

        <section className={`${KORT} border-border`}>
          <h3 className={KORT_RUBRIK}>Dina uppgifter</h3>
          <p className="text-[15px] text-text-2">
            Ladda ner allt vi har sparat om dig: kontot, uppgifterna du fyllt i för dina analyser,
            sparade värderingar och kalkyler, och hur långt du har kommit i köpguiden.
          </p>
          <div className="mt-1">
            <Button variant="secondary" onClick={() => void ladda()} disabled={laddar}>
              <NedladdningIkon />
              {laddar ? "Hämtar…" : "Ladda ner mina uppgifter"}
            </Button>
          </div>
        </section>

        <section className={`${KORT} border-danger-border`}>
          <h3 className={`${KORT_RUBRIK} text-grade-e`}>Radera konto</h3>
          <p className="text-[15px] text-text-2">
            Raderar kontot och allt som är sparat i det: dina värderingar, bolånekalkyler och
            analyslistan. Föreningsrapporterna finns kvar i Binfos register. Det går inte att ångra.
          </p>
          <div className="mt-1">
            <BekraftaDialog
              knapp="Radera mitt konto"
              utlosare="knapp"
              rubrik="Radera kontot?"
              bekraftaText="Radera kontot"
              text={
                <>
                  <p>Ange ditt lösenord för att bekräfta. Kontot och allt sparat i det raderas.</p>
                  <Field
                    label="Lösenord"
                    type="password"
                    name="losenord"
                    autoComplete="current-password"
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
          <p className="text-[13px] text-muted-foreground">
            Du får ange ditt lösenord för att bekräfta.
          </p>
        </section>
      </div>
    </section>
  );
}
