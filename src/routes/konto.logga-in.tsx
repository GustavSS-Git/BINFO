import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthSida, FelRuta } from "@/components/konto/AuthSida";
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
    >
      <form onSubmit={skicka} className="space-y-5">
        <Field
          label="E-postadress"
          type="email"
          placeholder="namn@exempel.se"
          value={epost}
          onChange={setEpost}
        />
        <Field label="Lösenord" type="password" value={losenord} onChange={setLosenord} />
        {fel !== null ? <FelRuta>{fel}</FelRuta> : null}
        <Button type="submit" size="lg" className="w-full" disabled={skickar}>
          {skickar ? "Loggar in…" : "Logga in"}
        </Button>
      </form>
      <div className="mt-6 space-y-2 text-sm text-muted-foreground">
        <p>
          <Link
            to="/konto/glomt-losenord"
            className="font-medium text-primary underline underline-offset-2"
          >
            Glömt lösenordet?
          </Link>
        </p>
        <p>
          Har du inget konto?{" "}
          <Link
            to="/konto/skapa"
            search={sok}
            className="font-medium text-primary underline underline-offset-2"
          >
            Skapa konto
          </Link>
        </p>
      </div>
    </AuthSida>
  );
}
