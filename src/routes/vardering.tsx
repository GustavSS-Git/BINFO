import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Callout, Card, Field, PageHeader, TristateChoice } from "@/components/ui/binfo";
import { Prisrimlighet } from "@/components/AnalysRapport";
import { useUppgifter, setUppgifter } from "@/lib/uppgifter";
import {
  TOM_VARDERING_FORM,
  buildPrisInput,
  harVarderingsfel,
  tillAnalyseraPrefill,
  validateraVarderingForm,
  type VarderingFormFields,
} from "@/lib/varderingForm";
import { hamtaPrisuppskattningFn } from "@/server/analysFn";
import type { PrisuppskattningResultat } from "@/types/analysis";

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
  component: Vardering,
});

/** Antingen ett lyckat svar eller ett fel att visa ordagrant. `serverfel`
 *  är ett kastat nätverks-/serverfel (inget köparsäkert meddelande finns). */
type Utfall =
  | { typ: "ok"; resultat: PrisuppskattningResultat; skickatFormular: VarderingFormFields }
  | { typ: "fel"; errorMessage: string }
  | { typ: "serverfel" };

function Vardering() {
  const navigate = useNavigate();
  const [form, setForm] = useState<VarderingFormFields>(TOM_VARDERING_FORM);
  const [visaFel, setVisaFel] = useState(false);
  const [skickar, setSkickar] = useState(false);
  const [utfall, setUtfall] = useState<Utfall | null>(null);
  const uppgifter = useUppgifter();

  const set = (k: keyof VarderingFormFields) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fel = validateraVarderingForm(form);
  const harFel = harVarderingsfel(fel);

  const kor = async () => {
    if (skickar) return; // förhindra dubbelskick
    if (harFel) {
      setVisaFel(true);
      return;
    }
    const input = buildPrisInput(form, { hiss: uppgifter.hiss, balkong: uppgifter.balkong });
    setSkickar(true);
    setUtfall(null);
    try {
      const svar = await hamtaPrisuppskattningFn({ data: input });
      if (svar.ok) {
        setUtfall({ typ: "ok", resultat: svar.resultat, skickatFormular: form });
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

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Gratis och direkt"
        title="Bara priskoll"
        lead="Fyll i lägenhetens uppgifter så får du Binfos värdering direkt — utan att ladda upp någon årsredovisning."
      />

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
            Något gick fel — kontrollera din internetuppkoppling och försök igen.
          </p>
        </div>
      ) : null}

      {utfall?.typ === "ok" ? (
        <div className="mt-10">
          <div className="mb-6">
            <Callout variant="tip" title="Uppskattning utan årsredovisning">
              <p>
                Det här är en uppskattning som bara bygger på lägenhetens egna uppgifter. Vi har
                inte läst föreningens årsredovisning, så föreningens ekonomi och lån ingår inte.
              </p>
            </Callout>
          </div>

          <Prisrimlighet prisanalys={utfall.resultat.prisanalys} />

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
