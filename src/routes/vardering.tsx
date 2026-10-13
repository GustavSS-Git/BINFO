import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  PageHeader,
  TristateChoice,
} from "@/components/ui/binfo";
import { Prisrimlighet } from "@/components/AnalysRapport";
import { InfoRuta, FelRuta } from "@/components/konto/AuthSida";
import { SparaKnapp } from "@/components/konto/SparaKnapp";
import { useAterstallUtkast } from "@/components/konto/useAterstallUtkast";
import { formatSkapadDatum } from "@/lib/analysisView";
import { MAX_ETIKETT_TECKEN } from "@/lib/kontoTyper";
import { inloggningsSok, parseSparaTyp } from "@/lib/till";
import { VarderingUtkastSchema, skrivUtkast, type VarderingUtkast } from "@/lib/utkast";
import { useUppgifter, setUppgifter } from "@/lib/uppgifter";
import {
  TOM_VARDERING_FORM,
  buildPrisInput,
  harVarderingsfel,
  tillAnalyseraPrefill,
  validateraVarderingForm,
  type VarderingFormFields,
} from "@/lib/varderingForm";
import {
  hamtaPrisuppskattningFn,
  hamtaSparadVarderingFn,
  sparaVarderingFn,
} from "@/server/analysFn";
import type { PrisInput, PrisuppskattningResultat } from "@/types/analysis";

export const Route = createFileRoute("/vardering")({
  head: () => ({
    meta: [
      { title: "Bara priskoll — Binfo" },
      {
        name: "description",
        content:
          "Gratis och direkt: se vad Binfos värderingsmodell tror att lägenheten är värd, utan att ladda upp någon årsredovisning.",
      },
      { property: "og:title", content: "Bara priskoll — Binfo" },
      {
        property: "og:description",
        content: "Gratis och direkt: Binfos värdering av lägenheten, utan årsredovisning.",
      },
    ],
  }),
  // `sparad`: öppna en sparad värdering. `spara`: slutför ett väntande Spara efter inloggning.
  validateSearch: (s: Record<string, unknown>) => {
    const spara = parseSparaTyp(s["spara"]);
    return {
      ...(typeof s["sparad"] === "string" && s["sparad"] !== "" ? { sparad: s["sparad"] } : {}),
      ...(spara !== undefined ? { spara } : {}),
    };
  },
  component: VarderingSida,
});

/** Antingen ett lyckat svar eller ett fel att visa ordagrant. `serverfel`
 *  är ett kastat nätverks-/serverfel (inget köparsäkert meddelande finns). */
type Utfall =
  | { typ: "ok"; resultat: PrisuppskattningResultat; skickatFormular: VarderingFormFields }
  | { typ: "fel"; errorMessage: string }
  | { typ: "serverfel" };

function VarderingSida() {
  const { sparad } = Route.useSearch();
  return sparad !== undefined ? <SparadVardering id={sparad} /> : <Vardering />;
}

const SERVERFEL_TEXT = "Något gick fel. Försök igen om en stund.";

function SparadVardering({ id }: { id: string }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["sparad-vardering", id],
    queryFn: () => hamtaSparadVarderingFn({ data: { id } }),
    retry: false,
  });
  const [nyttResultat, setNyttResultat] = useState<PrisuppskattningResultat | null>(null);
  const [raknarOm, setRaknarOm] = useState(false);
  const [omFel, setOmFel] = useState<string | null>(null);

  const kravInloggning = q.data !== undefined && !q.data.ok && q.data.felKod === "ej_inloggad";
  useEffect(() => {
    if (kravInloggning) {
      void navigate({
        to: "/konto/logga-in",
        search: inloggningsSok(`/vardering?sparad=${encodeURIComponent(id)}`, undefined),
      });
    }
  }, [kravInloggning, id, navigate]);

  const raknaOm = async (input: PrisInput) => {
    if (raknarOm) return;
    setRaknarOm(true);
    setOmFel(null);
    try {
      const svar = await hamtaPrisuppskattningFn({ data: input });
      if (svar.ok) setNyttResultat(svar.resultat);
      else setOmFel(svar.errorMessage);
    } catch (error) {
      console.error("[vardering] omräkning kastade:", error);
      setOmFel(SERVERFEL_TEXT);
    } finally {
      setRaknarOm(false);
    }
  };

  let innehall;
  if (q.isPending || kravInloggning) {
    innehall = <p className="text-sm text-muted-foreground">Hämtar den sparade värderingen…</p>;
  } else if (q.isError) {
    innehall = <FelRuta>{SERVERFEL_TEXT}</FelRuta>;
  } else if (!q.data.ok) {
    innehall = (
      <FelRuta>
        {q.data.felKod === "hittades_inte" ? "Värderingen hittades inte." : q.data.meddelande}
      </FelRuta>
    );
  } else {
    const v = q.data.vardering;
    const input = v.input;
    innehall = (
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl text-foreground">
              {v.etikett ?? "Sparad värdering"}
            </h2>
            <Badge>Sparad {formatSkapadDatum(v.skapad)}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Så här såg värderingen ut när du sparade den (modell {v.modellVersion}). Modellen
            uppdateras över tid; räkna om för att se vad dagens modell säger.
          </p>
          {input !== null ? (
            <div className="mt-4">
              <Button onClick={() => void raknaOm(input)} disabled={raknarOm}>
                {raknarOm ? "Räknar om…" : "Räkna om med dagens modell"}
              </Button>
            </div>
          ) : null}
          {omFel !== null ? (
            <div className="mt-4">
              <FelRuta>{omFel}</FelRuta>
            </div>
          ) : null}
        </Card>

        {v.resultat !== null ? (
          <Prisrimlighet prisanalys={v.resultat.prisanalys} />
        ) : (
          <Callout variant="flag" title="Kan inte visas som den sparades">
            <p>
              Den sparade värderingen har ett format som inte längre stöds.
              {input !== null
                ? " Du kan räkna om den med uppgifterna du angav."
                : " Uppgifterna går inte heller att läsa, så den kan inte öppnas."}
            </p>
          </Callout>
        )}

        {nyttResultat !== null ? (
          <div>
            <h2 className="mb-4 font-display text-2xl text-foreground">
              Omräknat med dagens modell
            </h2>
            <Prisrimlighet prisanalys={nyttResultat.prisanalys} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader eyebrow="Sparad värdering" title="Bara priskoll" />
      {innehall}
      <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
        <Link
          to="/vardering"
          search={{}}
          className="font-medium text-primary underline underline-offset-2"
        >
          Gör en ny värdering
        </Link>
        <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
          Till Mitt konto
        </Link>
      </div>
    </div>
  );
}

function Vardering() {
  const navigate = useNavigate();
  const { spara: sparaParam } = Route.useSearch();
  const [etikett, setEtikett] = useState("");
  const [form, setForm] = useState<VarderingFormFields>(TOM_VARDERING_FORM);
  const [visaFel, setVisaFel] = useState(false);
  const [skickar, setSkickar] = useState(false);
  const [utfall, setUtfall] = useState<Utfall | null>(null);
  const uppgifter = useUppgifter();

  const set = (k: keyof VarderingFormFields) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fel = validateraVarderingForm(form);
  const harFel = harVarderingsfel(fel);

  /** Kör värderingen för ett redan byggt underlag och visar resultatet. */
  const varderaOchVisa = async (input: PrisInput, skickatFormular: VarderingFormFields) => {
    setSkickar(true);
    setUtfall(null);
    try {
      const svar = await hamtaPrisuppskattningFn({ data: input });
      if (svar.ok) {
        setUtfall({ typ: "ok", resultat: svar.resultat, skickatFormular });
      } else {
        // Serverns meddelande är köparsäkert och visas ordagrant (även vid
        // validation/kvot/behorighet).
        setUtfall({ typ: "fel", errorMessage: svar.errorMessage });
      }
    } catch (error) {
      console.error("[vardering] hamtaPrisuppskattningFn kastade:", error);
      setUtfall({ typ: "serverfel" });
    } finally {
      setSkickar(false);
    }
  };

  const kor = async () => {
    if (skickar) return; // förhindra dubbelskick
    if (harFel) {
      setVisaFel(true);
      return;
    }
    const input = buildPrisInput(form, { hiss: uppgifter.hiss, balkong: uppgifter.balkong });
    await varderaOchVisa(input, form);
  };

  const sparaStatus = useAterstallUtkast<VarderingUtkast>({
    typ: "vardering",
    spara: sparaParam,
    schema: VarderingUtkastSchema,
    rensaParam: () =>
      void navigate({
        to: "/vardering",
        search: {},
        replace: true,
      }),
    aterstall: async (utkast) => {
      setForm(utkast.form);
      setEtikett(utkast.etikett);
      setUppgifter({ hiss: utkast.hiss, balkong: utkast.balkong });
      if (harVarderingsfel(validateraVarderingForm(utkast.form))) {
        setVisaFel(true);
        return { ok: false, meddelande: "Uppgifterna du fyllde i är inte kompletta längre." };
      }
      const input = buildPrisInput(utkast.form, { hiss: utkast.hiss, balkong: utkast.balkong });
      const etikettText = utkast.etikett.trim();
      const svar = await sparaVarderingFn({
        data: { prisInput: input, ...(etikettText !== "" ? { etikett: etikettText } : {}) },
      });
      void varderaOchVisa(input, utkast.form);
      return svar.ok ? { ok: true } : svar;
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Gratis och direkt"
        title="Bara priskoll"
        lead="Fyll i lägenhetens uppgifter så får du Binfos värdering direkt — utan att ladda upp någon årsredovisning."
      />

      {sparaStatus.typ === "kraver_inloggning" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Logga in för att spara">
            <p>
              Du behöver vara inloggad för att slutföra sparandet.{" "}
              <Link
                to="/konto/logga-in"
                search={inloggningsSok("/vardering", "vardering")}
                className="font-medium text-primary underline underline-offset-2"
              >
                Logga in
              </Link>
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "saknas" ? (
        <div className="mb-6">
          <Callout variant="tip" title="Utkastet finns inte kvar">
            <p>
              Uppgifterna du fyllde i före inloggningen hittades inte (de sparas högst ett dygn, och
              bara i den här webbläsaren). Fyll i dem igen och tryck på Spara.
            </p>
          </Callout>
        </div>
      ) : null}
      {sparaStatus.typ === "sparar" ? (
        <div className="mb-6">
          <InfoRuta>
            <p>Sparar din värdering…</p>
          </InfoRuta>
        </div>
      ) : null}
      {sparaStatus.typ === "sparad" ? (
        <div className="mb-6">
          <InfoRuta>
            <p className="font-medium">Din värdering är sparad i ditt konto.</p>
            <p>
              <Link to="/konto" className="font-medium text-primary underline underline-offset-2">
                Se den i Mitt konto
              </Link>
            </p>
          </InfoRuta>
        </div>
      ) : null}
      {sparaStatus.typ === "fel" ? (
        <div className="mb-6">
          <FelRuta>Värderingen kunde inte sparas: {sparaStatus.meddelande}</FelRuta>
        </div>
      ) : null}

      <Card>
        <h2 className="font-display text-2xl text-foreground">Lägenhetens uppgifter</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Utgångspriset är valfritt. Fyller du i det jämförs det med värderingen.
        </p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field
            label="Boarea"
            type="text"
            suffix="m²"
            placeholder="58"
            value={form.boarea}
            onChange={(v) => {
              set("boarea")(v);
              setUppgifter({ boarea: Number(v.replace(",", ".")) || 0 });
            }}
            error={visaFel ? fel.boarea : null}
          />
          <Field
            label="Antal rum"
            type="text"
            placeholder="3"
            value={form.antalRum}
            onChange={set("antalRum")}
            error={visaFel ? fel.antalRum : null}
          />
          <Field
            label="Månadsavgift"
            type="text"
            suffix="kr/mån"
            placeholder="3 240"
            value={form.manadsavgift}
            onChange={set("manadsavgift")}
            error={visaFel ? fel.manadsavgift : null}
          />
          <Field
            label="Postnummer"
            type="text"
            placeholder="116 25"
            value={form.postnummer}
            onChange={set("postnummer")}
            error={visaFel ? fel.postnummer : null}
          />
          <Field
            label="Våning"
            placeholder="4"
            value={form.vaning}
            onChange={set("vaning")}
            error={visaFel ? fel.vaning : null}
          />
          <Field
            label="Byggår"
            optional
            placeholder="1931"
            value={form.byggar}
            onChange={set("byggar")}
          />
          <Field
            label="Utgångspris"
            optional
            type="text"
            suffix="kr"
            placeholder="4 950 000"
            value={form.utgangspris}
            onChange={set("utgangspris")}
            error={visaFel ? fel.utgangspris : null}
          />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Hiss{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
            </span>
            <TristateChoice value={uppgifter.hiss} onChange={(v) => setUppgifter({ hiss: v })} />
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Balkong{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
            </span>
            <TristateChoice
              value={uppgifter.balkong}
              onChange={(v) => setUppgifter({ balkong: v })}
            />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={kor} disabled={skickar}>
            {skickar ? "Värderar…" : "Se värderingen"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {visaFel && harFel ? "Fyll i de obligatoriska fälten." : "Ingen uppladdning behövs."}
          </span>
        </div>
      </Card>

      {utfall?.typ === "fel" ? (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="font-medium text-foreground">Det gick inte att göra värderingen</p>
          <p className="mt-2 text-sm text-foreground">{utfall.errorMessage}</p>
        </div>
      ) : null}

      {utfall?.typ === "serverfel" ? (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger/5 p-4" role="alert">
          <p className="font-medium text-foreground">Det gick inte att göra värderingen</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Något gick fel. Försök igen om en stund.
          </p>
        </div>
      ) : null}

      {utfall?.typ === "ok" ? (
        <div className="mt-10">
          <Prisrimlighet prisanalys={utfall.resultat.prisanalys} />

          {sparaStatus.typ === "sparad" ? null : (
            <Card className="mb-6">
              <h2 className="font-display text-2xl text-foreground">Spara värderingen</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Spara den i ditt konto för att hitta tillbaka till den och kunna räkna om den
                senare.
              </p>
              <div className="mt-4 max-w-sm">
                <Field
                  label="Namn"
                  optional
                  type="text"
                  placeholder="Till exempel adressen"
                  value={etikett}
                  onChange={(v) => setEtikett(v.slice(0, MAX_ETIKETT_TECKEN))}
                />
              </div>
              <div className="mt-5">
                <SparaKnapp
                  key={utfall.resultat.skapad}
                  typ="vardering"
                  etikettKnapp="Spara värderingen"
                  till="/vardering"
                  spara={() => {
                    const e = etikett.trim();
                    return sparaVarderingFn({
                      data: {
                        prisInput: utfall.resultat.input,
                        ...(e !== "" ? { etikett: e } : {}),
                      },
                    });
                  }}
                  skrivUtkast={() =>
                    skrivUtkast(
                      "vardering",
                      {
                        form: utfall.skickatFormular,
                        hiss: utfall.resultat.input.hiss,
                        balkong: utfall.resultat.input.balkong,
                        etikett,
                      } satisfies VarderingUtkast,
                      "/vardering",
                    )
                  }
                />
              </div>
            </Card>
          )}

          <Card className="bg-primary text-primary-foreground">
            <h2 className="font-display text-2xl md:text-3xl">Granska även föreningen</h2>
            <p className="mt-3 max-w-xl text-sm text-primary-foreground/80">
              Med årsredovisningen får du de sju nyckeltalen, räntestresstest och frågor att ställa
              till styrelsen.
            </p>
            <Button
              variant="secondary"
              size="lg"
              className="mt-6"
              onClick={() =>
                navigate({
                  to: "/analysera",
                  search: tillAnalyseraPrefill(utfall.skickatFormular),
                })
              }
            >
              Ladda upp årsredovisningen för en fullständig analys
            </Button>
          </Card>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Vill du granska föreningen också?{" "}
          <Link to="/analysera" className="font-medium text-primary underline underline-offset-2">
            Ladda upp årsredovisningen för en fullständig analys
          </Link>
          .
        </p>
      )}
    </div>
  );
}
