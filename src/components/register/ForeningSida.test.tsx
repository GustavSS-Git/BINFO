import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { BETYG_TITEL } from "@/lib/betygVy";
import { KONTAKT_EPOST } from "@/lib/kontakt";
import { BETYG_FORKLARING, type RegisterForeningVy } from "@/lib/registerVy";

// Links need a router context; render them as plain anchors here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

import { ForeningSida } from "@/components/register/ForeningSida";

const alla = sampleAnalysis.forening.keyFigures.map((k) => ({
  id: k.id,
  label: k.label,
  figure: k.figure,
  status: k.status,
}));
// Old entries may lack some of the seven: drop räntekänslighet.
const nyckeltal = alla.filter((k) => k.id !== "rantekanslighet");

const vy: RegisterForeningVy = {
  slug: "brf-pontonjaren-3-716420-0599",
  orgnr: "716420-0599",
  namn: "Brf Pontonjären 3",
  omrade: { slug: "kungsholmen", namn: "Kungsholmen" },
  adresser: [{ gatuadress: "Baltzar von Platens gata 6", postnummer: "112 42", ort: "Stockholm" }],
  senaste: {
    rakenskapsar: 2025,
    analysdatum: "2026-10-13T10:00:00.000Z",
    betyg: "C",
    betygMotivering: null,
    nyckeltal,
    skannad: false,
    aldreVersion: false,
  },
  tidigare: [],
};

const rendera = (v: RegisterForeningVy) => renderToStaticMarkup(<ForeningSida vy={v} />);

describe("ForeningSida (publik sammanfattning)", () => {
  const html = rendera(vy);

  it("visar namn, räkenskapsår, betyget och den generella betygsraden", () => {
    expect(html).toContain("Brf Pontonjären 3");
    expect(html).toContain("2025");
    expect(html).toContain(BETYG_TITEL.C);
    expect(html).toContain(">C<");
    expect(html).toContain("Betyg C på skalan A–E, där A är starkast.");
    expect(html).toContain("Adress enligt årsredovisningen");
    expect(html).toContain("Kungsholmen · org.nr 716420-0599 · årsredovisning 2025 · analyserad");
    expect(html).toContain('aria-label="Brödsmulor"');
  });

  it("betyget visas som färgad ruta (88 px), inte som neutral pill", () => {
    expect(html).toContain("bg-grade-c");
    expect(html).toContain("size-[88px]");
    expect(html).toContain('aria-label="Betyg C"');
  });

  it("visar den lagrade motiveringen, annars den generella förklaringen", () => {
    expect(html).toContain(BETYG_FORKLARING);
    const out = rendera({
      ...vy,
      senaste: { ...vy.senaste, betygMotivering: "Låg skuld men lågt sparande." },
    });
    expect(out).toContain("Låg skuld men lågt sparande.");
    expect(out).not.toContain(BETYG_FORKLARING);
  });

  it("visar de nyckeltal som finns, med värde och status, och utelämnar de som saknas", () => {
    for (const k of nyckeltal) expect(html).toContain(k.label);
    expect(html).toMatch(/God|Acceptabel|Svag|Kritisk/);
    const saknad = alla.find((k) => k.id === "rantekanslighet")!;
    expect(html).not.toContain(saknad.label);
  });

  it("visar 'Ingen bedömning' för ett nyckeltal med okänd status", () => {
    const f = nyckeltal[0]!;
    const out = rendera({
      ...vy,
      senaste: { ...vy.senaste, nyckeltal: [{ ...f, status: "okant" }] },
    });
    expect(out).toContain(f.label);
    expect(out).toContain("Ingen bedömning");
    expect(out).not.toMatch(/>(God|Acceptabel|Svag|Kritisk)</);
  });

  it("det sjunde nyckeltalet (andel av rörelseintäkter) visas alltid obedömt", () => {
    const f = alla.find((k) => k.id === "arsavgift_andel_av_rorelseintakter")!;
    const out = rendera({
      ...vy,
      senaste: { ...vy.senaste, nyckeltal: [{ ...f, status: "acceptabel" }] },
    });
    expect(out).toContain(f.label);
    expect(out).toContain("Ingen bedömning");
    expect(out).not.toContain(">Acceptabel<");
  });

  it("visar sidhänvisning och osäker-markering", () => {
    const f = nyckeltal[0]!;
    const out = rendera({
      ...vy,
      senaste: {
        ...vy.senaste,
        nyckeltal: [{ ...f, figure: { ...f.figure, osaker: "Ser fel ut" } }],
      },
    });
    expect(out).toMatch(/s\. \d+/);
    expect(out).toContain("Osäker");
  });

  it("sidokortet länkar till analysen för den här föreningen, och felrapporten är en mailto", () => {
    expect(html).toContain("Ska du köpa här?");
    expect(html).toContain('href="/analysera?forening=brf-pontonjaren-3-716420-0599"');
    expect(html).toContain("Ingen uppladdning behövs.");
    expect(KONTAKT_EPOST).not.toBeNull();
    expect(html).toContain(`href="mailto:${KONTAKT_EPOST}?subject=`);
    expect(html).toContain(encodeURIComponent("Brf Pontonjären 3"));
    expect(html).toContain("Hittar du ett fel?");
  });

  it("länkar till den sparade fullständiga analysen med bokstaven i texten", () => {
    expect(html).toMatch(
      /<a href="\/brf\/brf-pontonjaren-3-716420-0599\/analys\/2025"[^>]*>Se hela analysen för varför föreningen fick betyget C<\/a>/,
    );
  });

  it("visar varken motivering, röda flaggor eller frågor", () => {
    expect(html).not.toContain(sampleAnalysis.betygMotivering);
    for (const f of sampleAnalysis.rodaFlaggor) expect(html).not.toContain(f.titel);
    for (const f of sampleAnalysis.fragor) expect(html).not.toContain(f.fraga);
    expect(html).not.toContain("Frågor att ställa");
    expect(html).not.toContain("Övrig info från årsredovisningen");
  });

  it("visar skannad-notis och äldre-version-text bara när de gäller", () => {
    expect(html).not.toContain("Skannad årsredovisning");
    expect(html).not.toContain("tidigare version av Binfo");
    const out = rendera({ ...vy, senaste: { ...vy.senaste, skannad: true, aldreVersion: true } });
    expect(out).toContain("Skannad årsredovisning");
    expect(out).toContain("tidigare version av Binfo");
  });

  it("tidigare år får egen rad som länkar till sin analys", () => {
    const out = rendera({
      ...vy,
      tidigare: [{ ...vy.senaste, rakenskapsar: 2024, betyg: "D" }],
    });
    expect(out).toContain("Nyckeltal per år");
    expect(out).toContain('href="/brf/brf-pontonjaren-3-716420-0599/analys/2024"');
  });
});
