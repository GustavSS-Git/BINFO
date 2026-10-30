import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AuthAside, AuthSida, FelRuta, InfoRuta, TEXTLANK } from "@/components/konto/AuthSida";
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
      aside={
        <AuthAside
          rubrik="Bra att veta"
          punkter={[
            "Vi skickar länken till e-postadressen du skapade kontot med.",
            "Länken fungerar en gång och gäller en begränsad tid. Titta i skräpposten om mejlet dröjer.",
            "Det här är för dig som har ett konto. Analyser och värderingar kan du göra utan konto.",
          ]}
        />
      }
    >
      {skickat ? (
        <InfoRuta>
          <p>
            Om adressen finns skickar vi ett mejl med en länk för att välja nytt lösenord. Länken
            gäller en begränsad tid. Titta även i skräpposten.
          </p>
        </InfoRuta>
      ) : (
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
          {fel !== null ? <FelRuta>{fel}</FelRuta> : null}
          <Button type="submit" size="lg" className="w-full" disabled={skickar}>
            {skickar ? "Skickar…" : "Skicka återställningslänk"}
          </Button>
        </form>
      )}
      <p className="border-t border-border pt-4 text-[15px]">
        <Link to="/konto/logga-in" className={TEXTLANK}>
          Tillbaka till inloggning
        </Link>
      </p>
    </AuthSida>
  );
}
