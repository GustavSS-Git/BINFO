import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AuthAside, AuthSida, FelRuta, InfoRuta, TEXTLANK } from "@/components/konto/AuthSida";
import { GENERELLT_FEL, kontoHead } from "@/components/konto/kontoText";
import { useGaTill } from "@/components/konto/useGaTill";
import { Button, Field } from "@/components/ui/binfo";
import { MIN_LOSENORD_TECKEN } from "@/lib/kontoTyper";
import { sattNyttLosenordFn } from "@/server/analysFn";
import { useSession } from "@/lib/session";
import { inloggningsSok } from "@/lib/till";

export const Route = createFileRoute("/konto/nytt-losenord")({
  head: () => kontoHead("Nytt lösenord"),
  // `nuvarande=ja`: kom från profilens "Byt lösenord" (kräver alltid nuvarande lösenord).
  validateSearch: (s: Record<string, unknown>) =>
    s["nuvarande"] === "ja" ? { nuvarande: "ja" as const } : {},
  component: NyttLosenord,
});

const aside = (
  <AuthAside
    rubrik="Bra att veta"
    punkter={[
      "Kommer du hit från länken i mejlet behöver du inte ange det nuvarande lösenordet.",
      "När lösenordet är bytt loggas du ut på andra enheter.",
    ]}
  />
);

function NyttLosenord() {
  const { nuvarande } = Route.useSearch();
  const gaTill = useGaTill();
  const { lage } = useSession();
  const [nytt, setNytt] = useState("");
  const [gammalt, setGammalt] = useState("");
  const [visaNuvarande, setVisaNuvarande] = useState(nuvarande === "ja");
  const [fel, setFel] = useState<string | null>(null);
  const [skickar, setSkickar] = useState(false);
  const [klart, setKlart] = useState(false);

  // Sidan kräver en session (återställningslänken eller en vanlig inloggning).
  useEffect(() => {
    if (lage === "utloggad") {
      gaTill("/konto/logga-in?till=/konto/nytt-losenord", undefined, "/konto");
    }
  }, [lage]); // eslint-disable-line react-hooks/exhaustive-deps

  const skicka = async (e: FormEvent) => {
    e.preventDefault();
    if (skickar) return;
    if (nytt.length < MIN_LOSENORD_TECKEN) {
      setFel(`Lösenordet måste vara minst ${MIN_LOSENORD_TECKEN} tecken.`);
      return;
    }
    setFel(null);
    setSkickar(true);
    try {
      const svar = await sattNyttLosenordFn({
        data: {
          losenord: nytt,
          ...(visaNuvarande && gammalt !== "" ? { nuvarandeLosenord: gammalt } : {}),
        },
      });
      if (svar.ok) {
        setKlart(true);
      } else {
        if (svar.felKod === "kraver_nuvarande_losenord") setVisaNuvarande(true);
        if (svar.felKod === "ej_inloggad") {
          gaTill("/konto/logga-in?till=/konto/nytt-losenord", undefined, "/konto");
          return;
        }
        setFel(svar.meddelande);
      }
    } catch (error) {
      console.error("[nytt-losenord] sattNyttLosenordFn kastade:", error);
      setFel(GENERELLT_FEL);
    } finally {
      setSkickar(false);
    }
  };

  if (klart) {
    return (
      <AuthSida eyebrow="Mitt konto" title="Lösenordet är ändrat" aside={aside}>
        <InfoRuta>
          <p>Ditt nya lösenord gäller från och med nu.</p>
        </InfoRuta>
        <p className="text-[15px]">
          <Link to="/konto" className={TEXTLANK}>
            Till Mitt konto
          </Link>
        </p>
      </AuthSida>
    );
  }

  return (
    <AuthSida
      eyebrow="Mitt konto"
      title="Välj nytt lösenord"
      lead={`Lösenordet ska vara minst ${MIN_LOSENORD_TECKEN} tecken.`}
      aside={aside}
    >
      <form onSubmit={skicka} className="flex flex-col gap-[18px]">
        {visaNuvarande ? (
          <Field
            label="Nuvarande lösenord"
            type="password"
            name="nuvarande-losenord"
            autoComplete="current-password"
            value={gammalt}
            onChange={setGammalt}
          />
        ) : null}
        <Field
          label="Nytt lösenord"
          type="password"
          name="nytt-losenord"
          autoComplete="new-password"
          value={nytt}
          onChange={setNytt}
          hint={`Minst ${MIN_LOSENORD_TECKEN} tecken.`}
        />
        {fel !== null ? <FelRuta>{fel}</FelRuta> : null}
        <Button type="submit" size="lg" className="w-full" disabled={skickar}>
          {skickar ? "Sparar…" : "Spara nytt lösenord"}
        </Button>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
          <Link to="/konto" className={TEXTLANK}>
            Tillbaka till Mitt konto
          </Link>
          <Link to="/konto/glomt-losenord" className={TEXTLANK}>
            Glömt ditt nuvarande lösenord?
          </Link>
        </div>
      </form>
    </AuthSida>
  );
}
