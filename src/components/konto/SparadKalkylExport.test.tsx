import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EJ_STOD_TEXT,
  EXPORT_FEL_TEXT,
  SparadKalkylExportVy,
  exporteraSparadKalkyl,
  type ExportLage,
} from "@/components/konto/SparadKalkylExport";
import { KalkylLista } from "@/components/konto/ProfilListor";
import type { HamtaSparadKalkylSvar, SparadKalkyl } from "@/lib/kontoTyper";
import { tomSida, underlagFranSida } from "@/lib/kalkyl/sida";

const noop = () => {};
const vy = (lage: ExportLage) =>
  renderToStaticMarkup(<SparadKalkylExportVy lage={lage} onKlick={noop} />);

const underlag = underlagFranSida({ ...tomSida(), lanebelopp: "2000000", ranta: "4" }).underlag;
const kalkyl = (u: SparadKalkyl["underlag"]): HamtaSparadKalkylSvar => ({
  ok: true,
  kalkyl: {
    id: "k-1",
    etikett: null,
    skapad: "2026-10-03T10:00:00Z",
    uppdaterad: "2026-10-03T10:00:00Z",
    regelversion: "r1",
    sammanfattning: null,
    underlag: u,
  },
});

describe("PDF- och Excel-knappar för en sparad kalkyl", () => {
  it("är aktiva i vilande läge", () => {
    const html = vy({ typ: "vilar" });
    expect(html).toContain(">PDF<");
    expect(html).toContain(">Excel<");
    expect(html).not.toContain('disabled=""');
  });

  it("är avstängda medan filen skapas", () => {
    const html = vy({ typ: "pdf" });
    expect(html).toContain("Skapar PDF…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("är avstängda med förklaring när det sparade formatet inte stöds", () => {
    const html = vy({ typ: "ejStod" });
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain(EJ_STOD_TEXT.slice(0, 40));
  });

  it("visar felet men behåller knapparna aktiva", () => {
    const html = vy({ typ: "fel", meddelande: "Något gick fel." });
    expect(html).toContain("Något gick fel.");
    expect(html).not.toContain('disabled=""');
  });

  it("finns på varje kalkylrad, även när sammanfattningen saknas", () => {
    const html = renderToStaticMarkup(
      <KalkylLista
        kalkyler={[
          {
            id: "k-1",
            etikett: null,
            skapad: "2026-10-03T10:00:00Z",
            uppdaterad: "2026-10-03T10:00:00Z",
            regelversion: "r1",
            sammanfattning: null,
          },
        ]}
        onRadera={async () => {}}
      />,
    );
    expect(html).toContain(">PDF<");
    expect(html).toContain(">Excel<");
    expect(html).toContain(">Öppna<");
  });
});

describe("exporteraSparadKalkyl", () => {
  it("hämtar kalkylen och skapar filen", async () => {
    const ladda = vi.fn(async () => {});
    const lage = await exporteraSparadKalkyl({
      id: "k-1",
      etikett: "Lgh",
      vag: "excel",
      hamta: async () => kalkyl(underlag),
      ladda,
    });
    expect(lage).toEqual({ typ: "vilar" });
    expect(ladda).toHaveBeenCalledWith("excel", underlag, "Lgh");
  });

  it("ger ejStod och skapar ingen fil när underlaget är null", async () => {
    const ladda = vi.fn(async () => {});
    const lage = await exporteraSparadKalkyl({
      id: "k-1",
      etikett: null,
      vag: "pdf",
      hamta: async () => kalkyl(null),
      ladda,
    });
    expect(lage).toEqual({ typ: "ejStod" });
    expect(ladda).not.toHaveBeenCalled();
  });

  it("översätter serverfel och kastade fel till ett läge", async () => {
    const ladda = vi.fn(async () => {});
    expect(
      await exporteraSparadKalkyl({
        id: "k-1",
        etikett: null,
        vag: "pdf",
        hamta: async () => ({ ok: false, felKod: "hittades_inte", meddelande: "Hittades inte." }),
        ladda,
      }),
    ).toEqual({ typ: "fel", meddelande: "Hittades inte." });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await exporteraSparadKalkyl({
        id: "k-1",
        etikett: null,
        vag: "pdf",
        hamta: async () => {
          throw new Error("nät");
        },
        ladda,
      }),
    ).toEqual({ typ: "fel", meddelande: EXPORT_FEL_TEXT });
  });
});
