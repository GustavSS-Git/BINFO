import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthSida, FelRuta, InfoRuta } from "@/components/konto/AuthSida";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { Button, Field } from "@/components/ui/binfo";
import { begarAterstallningFn } from "@/server/analysFn";

export const Route = createFileRoute("/konto/glomt-losenord")({
  head: () => kontoHead("Glömt lösenord"),
  component: GlomtLosenord,
});

function GlomtLosenord() {
  const [epost, setEpost] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [skickar, setSkickar] = useState(false);
  const [skickat, setSkickat] = useState(false);

  const skicka = async (e: FormEvent) => {
    e.preventDefault();
    if (skickar) return;
    setFel(null);
    setSkickar(true);
    try {
      const svar = await begarAterstallningFn({ data: { epost: epost.trim() } });
      if (svar.ok) setSkickat(true);
      else setFel(svar.meddelande);
    } catch (error) {
      console.error("[glomt-losenord] begarAterstallningFn kastade:", error);
      setFel(GENERELLT_FEL);
    } finally {
      setSkickar(false);
    }
  };

  return (
    <AuthSida
      eyebrow="Mitt konto"
      title="Glömt lösenord"
      lead="Ange e-postadressen till ditt konto så skickar vi en länk för att välja ett nytt lösenord."
    >
      {skickat ? (
        <InfoRuta>
          <p>
            Om adressen finns skickar vi ett mejl med en länk för att välja nytt lösenord. Länken
            gäller en begränsad tid. Titta även i skräpposten.
          </p>
        </InfoRuta>
      ) : (
        <form onSubmit={skicka} className="space-y-5">
          <Field
            label="E-postadress"
            type="email"
            placeholder="namn@exempel.se"
            value={epost}
            onChange={setEpost}
          />
          {fel !== null ? <FelRuta>{fel}</FelRuta> : null}
          <Button type="submit" size="lg" className="w-full" disabled={skickar}>
            {skickar ? "Skickar…" : "Skicka återställningslänk"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        <Link
          to="/konto/logga-in"
          className="font-medium text-primary underline underline-offset-2"
        >
          Tillbaka till inloggning
        </Link>
      </p>
    </AuthSida>
  );
}
