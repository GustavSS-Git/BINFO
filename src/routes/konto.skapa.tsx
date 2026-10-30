import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AuthAside, AuthSida, FelRuta, InfoRuta, TEXTLANK } from "@/components/konto/AuthSida";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { useGaTill } from "@/components/konto/useGaTill";
import { Button, Field } from "@/components/ui/binfo";
import { MIN_LOSENORD_TECKEN } from "@/lib/kontoTyper";
import { registreraKontoFn } from "@/server/analysFn";
import { useSession, useSessionAtgarder } from "@/lib/session";
import { inloggningsSok, parseKontoSok } from "@/lib/till";

export const Route = createFileRoute("/konto/skapa")({
  head: () => kontoHead("Skapa konto"),
  validateSearch: parseKontoSok,
  component: SkapaKonto,
});

function SkapaKonto() {
  const { till, spara } = Route.useSearch();
  const gaTill = useGaTill();
  const { lage } = useSession();
  const { uppdatera } = useSessionAtgarder();
  const [epost, setEpost] = useState("");
  const [losenord, setLosenord] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [skickar, setSkickar] = useState(false);
  const [skickat, setSkickat] = useState<string | null>(null);

  // Bekräftelselänken öppnas ofta i en ny flik. Cookies delas, så när den här
  // fliken får fokus igen hämtas sessionen om och vi går vidare. Det sparande som
  // hör till utkastet slutförs i den flik som tog emot bekräftelsen.
  useEffect(() => {
    if (lage === "inloggad") gaTill(till);
  }, [lage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skickat === null) return;
    const vidFokus = () => void uppdatera();
    window.addEventListener("focus", vidFokus);
    return () => window.removeEventListener("focus", vidFokus);
  }, [skickat]); // eslint-disable-line react-hooks/exhaustive-deps

  const skicka = async (e: FormEvent) => {
    e.preventDefault();
    if (skickar) return;
    if (losenord.length < MIN_LOSENORD_TECKEN) {
      setFel(`Lösenordet måste vara minst ${MIN_LOSENORD_TECKEN} tecken.`);
      return;
    }
    setFel(null);
    setSkickar(true);
    try {
      const svar = await registreraKontoFn({ data: { epost: epost.trim(), losenord } });
      if (svar.ok) setSkickat(epost.trim());
      else setFel(svar.meddelande);
    } catch (error) {
      console.error("[skapa] registreraKontoFn kastade:", error);
      setFel(GENERELLT_FEL);
    } finally {
      setSkickar(false);
    }
  };

  if (skickat !== null) {
    return (
      <AuthSida
        eyebrow="Mitt konto"
        title="Kolla din e-post"
        aside={
          <AuthAside
            rubrik="Bra att veta"
            punkter={[
              "Länken i mejlet fungerar en gång och gäller en begränsad tid.",
              "Kommer inget mejl? Titta i skräpposten och kontrollera att adressen är rätt skriven.",
              "Du kan öppna länken i en ny flik. Den här sidan går vidare när kontot är bekräftat.",
            ]}
          />
        }
      >
        <InfoRuta>
          <p>
            Om adressen {skickat} går att använda har vi skickat ett mejl med en länk för att
            bekräfta kontot. Det brukar komma inom någon minut. Titta även i skräpposten.
          </p>
          <p>Du kan öppna länken i en ny flik. Den här sidan går vidare när kontot är bekräftat.</p>
        </InfoRuta>
        <p className="border-t border-border pt-4 text-[15px] text-text-2">
          Redan bekräftat?{" "}
          <Link to="/konto/logga-in" search={inloggningsSok(till, spara)} className={TEXTLANK}>
            Logga in
          </Link>
        </p>
      </AuthSida>
    );
  }

  return (
    <AuthSida
      eyebrow="Mitt konto"
      title="Skapa konto"
      lead="Med ett konto kan du spara värderingar och bolånekalkyler och hitta tillbaka till dina analyser."
      aside={
        <AuthAside
          rubrik="Det här sparas på ditt konto"
          punkter={[
            "Dina analyser, så att du hittar tillbaka till rapporterna",
            "Sparade värderingar, som du kan räkna om senare",
            "Namngivna kalkyler från bolånekalkylen",
            "Hur långt du har kommit i köpguiden",
          ]}
          not="Du behöver inget konto för att analysera en bostad."
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
          autoComplete="new-password"
          value={losenord}
          onChange={setLosenord}
          hint={`Minst ${MIN_LOSENORD_TECKEN} tecken.`}
        />
        {fel !== null ? <FelRuta>{fel}</FelRuta> : null}
        <Button type="submit" size="lg" className="w-full" disabled={skickar}>
          {skickar ? "Skapar konto…" : "Skapa konto"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Läs hur vi hanterar dina uppgifter i{" "}
        <Link to="/integritet" className={TEXTLANK}>
          integritetspolicyn
        </Link>
        .
      </p>
      <p className="border-t border-border pt-4 text-[15px] text-text-2">
        Har du redan ett konto?{" "}
        <Link to="/konto/logga-in" search={inloggningsSok(till, spara)} className={TEXTLANK}>
          Logga in
        </Link>
      </p>
    </AuthSida>
  );
}
