import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, Button, Field, Toggle, PageHeader } from "@/components/ui/binfo";
import { usePropertyType } from "@/lib/propertyType";
import { property } from "@/data/mockData";

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

function Analysera() {
  const navigate = useNavigate();
  const [typ, setTyp] = usePropertyType();
  const [dragging, setDragging] = useState(false);
  const [fil, setFil] = useState<string | null>("Årsredovisning_Brf_Lindgården_2025.pdf");

  const [form, setForm] = useState({
    utgangspris: String(property.utgangspris),
    boarea: String(property.boarea),
    vaning: String(property.vaning),
    manadsavgift: String(property.manadsavgift),
    andelstal: String(property.andelstal),
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

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

      <Card>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Utgångspris" suffix="kr" value={form.utgangspris} onChange={set("utgangspris")} />
          <Field label="Boarea" suffix="m²" value={form.boarea} onChange={set("boarea")} />
          <Field label="Våning" value={form.vaning} onChange={set("vaning")} />
          <Field label="Månadsavgift" suffix="kr/mån" value={form.manadsavgift} onChange={set("manadsavgift")} />
          <Field label="Andelstal" suffix="%" value={form.andelstal} onChange={set("andelstal")} />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={() => navigate({ to: "/forhandsvisning" })}>
            Analysera
          </Button>
          <span className="text-sm text-muted-foreground">Tar ungefär en minut.</span>
        </div>
      </Card>
    </div>
  );
}
