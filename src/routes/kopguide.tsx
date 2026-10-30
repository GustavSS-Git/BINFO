import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { KopguideVy } from "@/components/kopguide/KopguideVy";
import { oppnaEfterMarkering } from "@/components/kopguide/oppna";
import { synligaSteg } from "@/lib/kopguide/framsteg";
import { useKopguide } from "@/lib/kopguide/useKopguide";
import { usePropertyType } from "@/lib/propertyType";

export const Route = createFileRoute("/kopguide")({
  head: () => ({
    meta: [
      { title: "Köpguide: hela bostadsköpet steg för steg — Binfo" },
      {
        name: "description",
        content:
          "Från lånelöfte till tillträde: varje steg i det svenska bostadsköpet med varningar och tips.",
      },
      { property: "og:title", content: "Köpguide: hela bostadsköpet steg för steg — Binfo" },
      {
        property: "og:description",
        content: "Interaktiv tidslinje över köpprocessen för bostadsrätt och hus.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Kopguide,
});

function Kopguide() {
  const [typ, setTyp] = usePropertyType();
  const { klara, vaxla, sparFel } = useKopguide();
  const [oppen, setOppen] = useState<string | null>(synligaSteg(typ)[0]?.id ?? null);

  const klart = new Set(klara);

  return (
    <KopguideVy
      typ={typ}
      onTyp={setTyp}
      klara={klara}
      oppen={oppen}
      sparFel={sparFel}
      onOppna={setOppen}
      onMarkera={(steg) => {
        const blevKlart = !klart.has(steg.id);
        vaxla(steg.id);
        setOppen(oppnaEfterMarkering(typ, oppen, steg.id, blevKlart));
      }}
      onGaTill={(id) => {
        setOppen(id);
        document
          .getElementById(`steg-${id}`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      }}
    />
  );
}
