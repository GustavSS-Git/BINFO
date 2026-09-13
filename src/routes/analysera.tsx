import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, Button, Field, Toggle, TristateChoice, PageHeader } from "@/components/ui/binfo";
import { usePropertyType } from "@/lib/propertyType";
import { useUppgifter, setUppgifter, setIngar } from "@/lib/uppgifter";
import { avgiftPoster } from "@/data/mockData";
import {
  buildPropertyInput,
  formateraFilstorlek,
  harValideringsfel,
  kontrolleraPdfFil,
  validateraAnalyseraForm,
  type AnalyseraFormFields,
} from "@/lib/analyseraForm";
import { skapaAnalysFn } from "@/server/analysFn";
import { FELKOD_INNEHALL, type AnalysErrorCode } from "@/lib/analysStatusCopy";

export const Route = createFileRoute("/analysera")({
  head: () => ({
    meta: [
      { title: "Analysera en bostad — Binfo" },
      {
        name: "description",
        content:
          "Ladda upp årsredovisningen och fyll i objektets uppgifter för att få din riskanalys.",
      },
      { property: "og:title", content: "Analysera en bostad — Binfo" },
      {
        property: "og:description",
        content: "Ladda upp årsredovisningen och få riskbetyg, prisbedömning och räntestress.",
      },
    ],
  }),
  component: Analysera,
});

const TOM_FORM: AnalyseraFormFields = {
  utgangspris: "",
  boarea: "",
  vaning: "",
  manadsavgift: "",
  andelstal: "",
  organisationsnummer: "",
  adress: "",
  postnummer: "",
  ort: "",
  antalRum: "",
  byggar: "",
};

/** Ett skickat-fel som INTE navigerar bort — antingen ett synkront `ok: false`
 *  från skapaAnalysFn (t.ex. scanned_pdf, innan något jobb skapats), eller ett
 *  kastat nätverks-/serverfel. Skiljs åt bara för att visa rätt hjälptext. */
type SkickaFel =
  { typ: "kand"; errorCode: AnalysErrorCode; errorMessage: string } | { typ: "okand" };

function Analysera() {
  const navigate = useNavigate();
  const [typ, setTyp] = usePropertyType();
  const [dragging, setDragging] = useState(false);
  const [fil, setFil] = useState<File | null>(null);
  const [filFel, setFilFel] = useState<string | null>(null);
  const [visaFel, setVisaFel] = useState(false);
  const [skickar, setSkickar] = useState(false);
  const [skickaFel, setSkickaFel] = useState<SkickaFel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<AnalyseraFormFields>(TOM_FORM);
  const uppgifter = useUppgifter();

  // Klick på säkerhetsmätaren i rapporten länkar hit med #vet-ej.
  useEffect(() => {
    if (window.location.hash === "#vet-ej") {
      document.getElementById("vet-ej")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const fel = validateraAnalyseraForm(form);
  const harFel = harValideringsfel(fel);

  const valjFil = (candidate: File | undefined | null) => {
    if (!candidate) return;
    setSkickaFel(null);
    const fel = kontrolleraPdfFil(candidate);
    setFilFel(fel);
    setFil(fel ? null : candidate);
  };

  const taBortFil = () => {
    setFil(null);
    setFilFel(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const analysera = async () => {
    if (skickar) return; // förhindra dubbelskick

    const filfelNu = kontrolleraPdfFil(fil);
    setFilFel(filfelNu);

    if (harFel || filfelNu) {
      setVisaFel(true);
      return;
    }

    // fil är garanterat non-null här: kontrolleraPdfFil(null) returnerar alltid ett fel.
    const propertyInput = buildPropertyInput(typ, form, {
      hiss: uppgifter.hiss,
      balkong: uppgifter.balkong,
      avgiftInkluderar: uppgifter.ingar,
      antalPersoner: uppgifter.antalPersoner,
    });

    const formData = new FormData();
    formData.set("pdf", fil as File);
    formData.set("propertyInput", JSON.stringify(propertyInput));

    setSkickar(true);
    setSkickaFel(null);
    try {
      const resultat = await skapaAnalysFn({ data: formData });
      if (resultat.ok) {
        navigate({ to: "/analys/$analysisId", params: { analysisId: resultat.analysisId } });
        return;
      }
      setSkickaFel({
        typ: "kand",
        errorCode: resultat.errorCode,
        errorMessage: resultat.errorMessage,
      });
    } catch (fel) {
      // Köparen får en generisk text, men orsaken ska aldrig försvinna tyst —
      // ett nätverksfel eller en 500:a här är exakt det man vill kunna se i
      // konsolen när någon rapporterar "det gick inte att skicka in".
      console.error("[analysera] skapaAnalysFn kastade:", fel);
      setSkickaFel({ typ: "okand" });
    } finally {
      setSkickar(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <PageHeader
        eyebrow="Steg 1 av 3"
        title="Analysera en bostad"
        lead="Ladda upp föreningens senaste årsredovisning och fyll i objektets uppgifter."
      />

      <div className="mb-8">
        <Toggle
          value={typ}
          onChange={setTyp}
          options={[
            { value: "brf", label: "Bostadsrätt" },
            { value: "hus", label: "Hus" },
          ]}
        />
        <p className="mt-3 text-sm text-muted-foreground">
          {typ === "brf"
            ? "Analysen utgår från föreningens ekonomi och din andel av skulden."
            : "För hus granskar vi i stället driftkostnader, besiktning samt lagfart och pantbrev."}
        </p>
      </div>

      <Card className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => valjFil(e.target.files?.[0])}
        />
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            valjFil(e.dataTransfer.files?.[0]);
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border bg-secondary/40"
          }`}
        >
          <p className="font-medium text-foreground">
            Dra och släpp årsredovisningen här, eller klicka för att välja fil
          </p>
          <p className="mt-1 text-sm text-muted-foreground">PDF, max 25 MB</p>
          {fil ? (
            <p className="mt-4 inline-flex items-center gap-3 rounded-full bg-card px-4 py-2 text-sm text-foreground">
              <span className="size-2 rounded-full bg-success" />
              {fil.name} ({formateraFilstorlek(fil.size)})
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  taBortFil();
                }}
                className="text-muted-foreground underline hover:text-foreground"
              >
                Ta bort
              </button>
            </p>
          ) : null}
        </div>
        {visaFel && filFel ? <p className="mt-3 text-sm text-danger">{filFel}</p> : null}
      </Card>

      <Card className="mb-6">
        <h2 className="font-display text-2xl text-foreground">Objektets uppgifter</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field
            label="Utgångspris"
            type="text"
            suffix="kr"
            placeholder="4 950 000"
            value={form.utgangspris}
            onChange={set("utgangspris")}
            error={visaFel ? fel.utgangspris : null}
          />
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
            label="Våning"
            optional
            placeholder="4"
            value={form.vaning}
            onChange={set("vaning")}
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
            label="Andelstal"
            type="text"
            suffix="%"
            placeholder="2,1"
            value={form.andelstal}
            onChange={set("andelstal")}
            error={visaFel ? fel.andelstal : null}
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
            label="Antal personer i hushållet"
            value={String(uppgifter.antalPersoner)}
            onChange={(v) => setUppgifter({ antalPersoner: Math.max(1, Number(v) || 1) })}
            hint="Används för schablonen för vattenkostnad."
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-2xl text-foreground">Om föreningen</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Uppgifterna används för att hitta rätt förening och jämförbara försäljningar.
        </p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field
            label="Föreningens organisationsnummer"
            type="text"
            placeholder="769612-3456"
            value={form.organisationsnummer}
            onChange={set("organisationsnummer")}
            error={visaFel ? fel.organisationsnummer : null}
            hint="Format: XXXXXX-XXXX"
          />
          <Field
            label="Adress"
            type="text"
            placeholder="Kapellgränd 12"
            value={form.adress}
            onChange={set("adress")}
            error={visaFel ? fel.adress : null}
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
            label="Ort"
            type="text"
            placeholder="Stockholm"
            value={form.ort}
            onChange={set("ort")}
            error={visaFel ? fel.ort : null}
          />
          <Field
            label="Byggår"
            optional
            placeholder="1931"
            value={form.byggar}
            onChange={set("byggar")}
          />
        </div>

        <div id="vet-ej" className="mt-8 scroll-mt-24 grid gap-6 md:grid-cols-2">
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

        <div className="mt-8">
          <span className="block text-sm font-medium text-foreground">Vad ingår i avgiften?</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Vet du inte? Låt stå på ”Vet ej” — då visar vi totalen som ett spann i stället för att
            gissa.
          </p>
          <div className="mt-4 space-y-3">
            {avgiftPoster.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <span className="text-sm text-foreground">{p.label}</span>
                <TristateChoice
                  value={uppgifter.ingar[p.id]}
                  onChange={(v) => setIngar(p.id, v)}
                  labels={{ ja: "Ingår", nej: "Ingår ej" }}
                />
              </div>
            ))}
          </div>
        </div>

        {skickaFel ? (
          <div className="mt-8 rounded-lg border border-danger/30 bg-danger/5 p-4">
            {skickaFel.typ === "kand" ? (
              <>
                <p className="font-medium text-foreground">
                  {FELKOD_INNEHALL[skickaFel.errorCode].rubrik}
                </p>
                <p className="mt-2 text-sm text-foreground">{skickaFel.errorMessage}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {FELKOD_INNEHALL[skickaFel.errorCode].atgard}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">Kunde inte skicka in analysen</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Något gick fel vid uppladdningen — kontrollera din internetuppkoppling och försök
                  igen.
                </p>
              </>
            )}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={analysera} disabled={skickar}>
            {skickar ? "Skickar in…" : "Analysera"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {visaFel && (harFel || filFel)
              ? "Fyll i de obligatoriska fälten."
              : skickar
                ? "Laddar upp och startar analysen…"
                : "Analysen tar några minuter — du följer den på nästa sida."}
          </span>
        </div>
      </Card>
    </div>
  );
}
