import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AuthAside,
  AuthSida,
  FelRuta,
  LANKKNAPP_SEKUNDAR,
  TEXTLANK,
} from "@/components/konto/AuthSida";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { useGaTill } from "@/components/konto/useGaTill";
import { Button, Field } from "@/components/ui/binfo";
import { loggaInFn } from "@/server/analysFn";
import { useSession, useSessionAtgarder } from "@/lib/session";
import { inloggningsSok, parseKontoSok } from "@/lib/till";

export const Route = createFileRoute("/konto/logga-in")({
  head: () => kontoHead("Logga in"),
  validateSearch: parseKontoSok,
  component: LoggaIn,
});

function LoggaIn() {
  const { till, spara } = Route.useSearch();
  const gaTill = useGaTill();
  const { lage } = useSession();
  const { sattInloggad } = useSessionAtgarder();
  const [epost, setEpost] = useState("");
  const [losenord, setLosenord] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [skickar, setSkickar] = useState(false);
  const egenNavigering = useRef(false);

  // Redan inloggad (t.ex. bekräftat i en annan flik): gå vidare utan att slutföra
  // något sparande här, det gör den flik som tog emot bekräftelsen.
  useEffect(() => {
    if (lage === "inloggad" && !egenNavigering.current) gaTill(till);
  }, [lage]); // eslint-disable-line react-hooks/exhaustive-deps

  const skicka = async (e: FormEvent) => {
    e.preventDefault();
    if (skickar) return;
    setFel(null);
    setSkickar(true);
    try {
      const svar = await loggaInFn({ data: { epost: epost.trim(), losenord } });
      if (svar.ok) {
        egenNavigering.current = true;
        sattInloggad(svar.epost, svar.principalId);
        gaTill(till, spara);
      } else {
        setFel(svar.meddelande);
      }
    } catch (error) {
      console.error("[logga-in] loggaInFn kastade:", error);
      setFel(GENERELLT_FEL);
    } finally {
      setSkickar(false);
    }
  };

  const sok = inloggningsSok(till, spara);

  return (
    <AuthSida
      eyebrow="Mitt konto"
      title="Logga in"
      lead={
        spara !== undefined
          ? "Logga in för att spara. Dina uppgifter finns kvar när du kommer tillbaka."
          : "Logga in för att se dina sparade analyser, värderingar och kalkyler."
      }
      aside={
        <AuthAside
          rubrik="Det här sparas på ditt konto"
          punkter={[
            "Dina analyser, så att du hittar tillbaka till rapporterna",
            "Sparade värderingar, som du kan räkna om senare",
            "Namngivna kalkyler från bolånekalkylen",
            "Hur långt du har kommit i köpguiden",
          ]}
          not={
            <>
              Du behöver inget konto för att analysera en bostad.{" "}
              <Link to="/analysera" className={TEXTLANK}>
                Analysera utan att logga in
              </Link>
            </>
          }
        />
      }
    >
      <form onSubmit={skicka} className="flex flex-col gap-[18px]">
        <Field
          label="E-post"
          type="email"
          name="epost"
          autoComplete="email"
          placeholder="namn@exempel.se"
          value={epost}
          onChange={setEpost}
        />
        <Field
          label="Lösenord"
          type="password"
          name="losenord"
          autoComplete="current-password"
          value={losenord}
          onChange={setLosenord}
        />
        {fel !== null ? <FelRuta>{fel}</FelRuta> : null}
        <Button type="submit" size="lg" className="w-full" disabled={skickar}>
          {skickar ? "Loggar in…" : "Logga in"}
        </Button>
        <Link to="/konto/glomt-losenord" className={`${TEXTLANK} self-start text-[15px]`}>
          Glömt lösenordet?
        </Link>
      </form>
      <div className="flex flex-col gap-2.5 border-t border-border pt-4">
        <p className="text-[15px] text-text-2">Har du inget konto?</p>
        <Link to="/konto/skapa" search={sok} className={LANKKNAPP_SEKUNDAR}>
          Skapa konto
        </Link>
      </div>
    </AuthSida>
  );
}
