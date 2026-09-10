import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Card,
  Button,
  Field,
  Toggle,
  TristateChoice,
  PageHeader,
} from "@/components/ui/binfo";
import { usePropertyType } from "@/lib/propertyType";
import { useUppgifter, setUppgifter, setIngar } from "@/lib/uppgifter";
import { property, foreningsUppgifter, avgiftPoster } from "@/data/mockData";

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

const orgnrRegex = /^\d{6}-\d{4}$/;

function Analysera() {
  const navigate = useNavigate();
  const [typ, setTyp] = usePropertyType();
  const [dragging, setDragging] = useState(false);
  const [fil, setFil] = useState<string | null>("Årsredovisning_Brf_Lindgården_2025.pdf");
  const [visaFel, setVisaFel] = useState(false);

  const [form, setForm] = useState({
    utgangspris: String(property.utgangspris),
    boarea: String(property.boarea),
    vaning: String(property.vaning),
    manadsavgift: String(property.manadsavgift),
    andelstal: String(property.andelstal),
    // Om föreningen — speglar foreningsUppgifter i mockData.
    organisationsnummer: foreningsUppgifter.organisationsnummer,
    adress: foreningsUppgifter.adress,
    postnummer: foreningsUppgifter.postnummer,
    ort: foreningsUppgifter.ort,
    antalRum: foreningsUppgifter.antalRum,
    byggar: foreningsUppgifter.byggar,
  });
  const [hiss, setHiss] = useState<"ja" | "nej">(foreningsUppgifter.hiss ? "ja" : "nej");
  const [balkong, setBalkong] = useState<"ja" | "nej">(
    foreningsUppgifter.balkong ? "ja" : "nej",
  );
  const [ingar, setIngar] = useState<string[]>(foreningsUppgifter.ingarIAvgiften);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleIngar = (v: string) =>
    setIngar((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]));

  const fel = {
    organisationsnummer: !orgnrRegex.test(form.organisationsnummer.trim())
      ? "Ange organisationsnummer i formatet XXXXXX-XXXX."
      : null,
    adress: form.adress.trim() === "" ? "Ange adress." : null,
    postnummer: form.postnummer.trim() === "" ? "Ange postnummer." : null,
    ort: form.ort.trim() === "" ? "Ange ort." : null,
    antalRum: form.antalRum.trim() === "" ? "Ange antal rum." : null,
  };
  const harFel = Object.values(fel).some(Boolean);

  const analysera = () => {
    if (harFel) {
      setVisaFel(true);
      return;
    }
    // TODO(pipeline): skicka formuläret till PDF-parsern/analyspipelinen.
    navigate({ to: "/forhandsvisning" });
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
        {/* Visuell uppladdningsyta. TODO(pipeline): koppla mot PDF-parsern. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFil(e.dataTransfer.files?.[0]?.name ?? "Årsredovisning.pdf");
          }}
          className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border bg-secondary/40"
          }`}
        >
          <p className="font-medium text-foreground">
            Dra och släpp årsredovisningen här
          </p>
          <p className="mt-1 text-sm text-muted-foreground">PDF, max 25 MB</p>
          {fil ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm text-foreground">
              <span className="size-2 rounded-full bg-success" /> {fil}
            </p>
          ) : null}
        </div>
      </Card>

      <Card className="mb-6">
        <h2 className="font-display text-2xl text-foreground">Objektets uppgifter</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Field label="Utgångspris" suffix="kr" value={form.utgangspris} onChange={set("utgangspris")} />
          <Field label="Boarea" suffix="m²" value={form.boarea} onChange={set("boarea")} />
          <Field label="Våning" value={form.vaning} onChange={set("vaning")} />
          <Field label="Månadsavgift" suffix="kr/mån" value={form.manadsavgift} onChange={set("manadsavgift")} />
          <Field label="Andelstal" suffix="%" value={form.andelstal} onChange={set("andelstal")} />
          <Field
            label="Antal rum"
            value={form.antalRum}
            onChange={set("antalRum")}
            error={visaFel ? fel.antalRum : null}
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
            value={form.adress}
            onChange={set("adress")}
            error={visaFel ? fel.adress : null}
          />
          <Field
            label="Postnummer"
            type="text"
            value={form.postnummer}
            onChange={set("postnummer")}
            error={visaFel ? fel.postnummer : null}
          />
          <Field
            label="Ort"
            type="text"
            value={form.ort}
            onChange={set("ort")}
            error={visaFel ? fel.ort : null}
          />
          <Field label="Byggår" optional value={form.byggar} onChange={set("byggar")} />
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Hiss <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
            </span>
            <Toggle
              value={hiss}
              onChange={setHiss}
              options={[
                { value: "ja", label: "Ja" },
                { value: "nej", label: "Nej" },
              ]}
            />
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">
              Balkong <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
            </span>
            <Toggle
              value={balkong}
              onChange={setBalkong}
              options={[
                { value: "ja", label: "Ja" },
                { value: "nej", label: "Nej" },
              ]}
            />
          </div>
        </div>

        <div className="mt-6">
          <span className="mb-2 block text-sm font-medium text-foreground">
            Vad ingår i avgiften?{" "}
            <span className="ml-1 text-xs font-normal text-muted-foreground">(valfritt)</span>
          </span>
          <ChipGroup options={avgiftIngarOptions} values={ingar} onToggle={toggleIngar} />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={analysera}>
            Analysera
          </Button>
          <span className="text-sm text-muted-foreground">
            {visaFel && harFel ? "Fyll i de obligatoriska fälten." : "Tar ungefär en minut."}
          </span>
        </div>
      </Card>
    </div>
  );
}
