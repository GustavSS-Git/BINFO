import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "@/types/analysis";
import { extraktion } from "./__fixtures__/extraktion";
import { extractPdfText } from "./pdf";
import { kanoniseraText, sammanfattaSidreferenser, verifieraSidreferenser } from "./sidreferenser";

const FYLL = "fylltext som saknar alla citat men är lång nog";
const sidor = (...texter: string[]) => new Map(texter.map((t, i) => [i + 1, t]));

function medAvgiftsRef(page: number, excerpt: string): ExtractionResult {
  return {
    ...extraktion,
    forening: {
      ...extraktion.forening,
      keyFigures: extraktion.forening.keyFigures.map((kf) =>
        kf.id === "arsavgift_per_m2_brf_yta"
          ? { ...kf, figure: { ...kf.figure, ref: { page, excerpt } } }
          : kf,
      ),
    },
  };
}
const avgift = (e: ExtractionResult) =>
  e.forening.keyFigures.find((k) => k.id === "arsavgift_per_m2_brf_yta")!.figure;

describe("kanoniseraText", () => {
  it.each([
    ["1 234", "1234"],
    ["1 234", "1234"],
    ["1 234,50", "1234,50"],
    ["bostads-\nrätt", "bostadsrätt"],
    ["bostads­rätt", "bostadsrätt"],
    ["Årsavgift KR/kvm", "årsavgiftkr/kvm"],
    ["a | b", "ab"],
    ["”citat”", "citat"],
  ])("%j -> %j", (a, b) => expect(kanoniseraText(a)).toBe(b));

  it("behåller minustecknet framför en siffra men inte bindestreck", () => {
    expect(kanoniseraText("Sparande -1 200")).toBe("sparande-1200");
    expect(kanoniseraText("el-anläggning 10-11")).toBe("elanläggning1011");
  });
});

describe("verifieraSidreferenser", () => {
  const SIDA =
    "Förvaltningsberättelse\nÅrsavgift kr/kvm upplåten\nbostadsrätt 780 kr, ytan är stor.";

  it("godtar ett citat på den citerade sidan trots radbrytning och blanksteg", () => {
    const e = medAvgiftsRef(2, "Årsavgift kr/kvm upplåten bostadsrätt 780");
    const r = verifieraSidreferenser(e, sidor("annat", SIDA));
    expect(r.fynd.filter((f) => f.sokvag.includes("keyFigures[0]"))[0]?.status).toBe("ok");
    expect(avgift(r.extraction).osaker).toBeUndefined();
  });

  it("rättar sidan när citatet står på exakt en annan sida", () => {
    const e = medAvgiftsRef(1, "Årsavgift kr/kvm upplåten bostadsrätt 780");
    const r = verifieraSidreferenser(e, sidor(FYLL, SIDA));
    const f = r.fynd.find((x) => x.sokvag.includes("keyFigures[0]"))!;
    expect(f).toMatchObject({ status: "korrigerad", sida: 1, nySida: 2 });
    expect(avgift(r.extraction).ref?.page).toBe(2);
    expect(avgift(r.extraction).osaker).toBeUndefined();
  });

  it("markerar siffran osäker (men tar inte bort den) när citatet finns ingenstans, och kapar konfidensen", () => {
    const e = medAvgiftsRef(2, "Årsavgift kr/kvm upplåten bostadsrätt 999");
    const r = verifieraSidreferenser(e, sidor(FYLL, SIDA));
    expect(avgift(r.extraction).value).toBe(780);
    expect(avgift(r.extraction).osaker).toMatch(/kunde inte styrkas/);
    expect(r.extraction.datakvalitet.extraktionKonfidens.niva).toBe("medel");
    expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(/sidhänvisning/);
    expect(sammanfattaSidreferenser(r.fynd).saknas).toBeGreaterThanOrEqual(1);
  });

  it("citatet på flera andra sidor går inte att avgöra: osäker, ingen rättning", () => {
    const e = medAvgiftsRef(1, "Årsavgift kr/kvm upplåten bostadsrätt 780");
    const r = verifieraSidreferenser(e, sidor(FYLL, SIDA, SIDA));
    expect(avgift(r.extraction).osaker).toMatch(/flera andra sidor/);
    expect(avgift(r.extraction).ref?.page).toBe(1);
  });

  it("ett kort citat rättar aldrig sidan", () => {
    const e = medAvgiftsRef(1, "780 kr");
    const r = verifieraSidreferenser(e, sidor(FYLL, SIDA));
    expect(avgift(r.extraction).osaker).toBeDefined();
    expect(avgift(r.extraction).ref?.page).toBe(1);
  });

  it("en tom sida kan inte vederlägga något: ej kontrollerbar, inte osäker", () => {
    const e = medAvgiftsRef(1, "Årsavgift kr/kvm upplåten bostadsrätt 780");
    const r = verifieraSidreferenser(e, sidor("", SIDA));
    expect(avgift(r.extraction).osaker).toBeUndefined();
    expect(sammanfattaSidreferenser(r.fynd).ejKontrollerbara).toBeGreaterThanOrEqual(1);
  });

  it("ellipsen i ett citat kräver att varje del finns, i ordning", () => {
    const text = "SBAB 3,2 % 2027-02-25 villkor 25 000 000,00";
    const ok = verifieraSidreferenser(
      medAvgiftsRef(1, "SBAB 3,2 % 2027-02-25 ... 25 000 000,00"),
      sidor(text),
    );
    expect(avgift(ok.extraction).osaker).toBeUndefined();
    const fel = verifieraSidreferenser(
      medAvgiftsRef(1, "25 000 000,00 ... SBAB 3,2 % 2027-02-25"),
      sidor(text),
    );
    expect(avgift(fel.extraction).osaker).toBeDefined();
  });

  it("utan sidtexter kontrolleras inget", () => {
    const e = medAvgiftsRef(2, "påhittat");
    const r = verifieraSidreferenser(e, new Map());
    expect(r.fynd).toEqual([]);
    expect(r.extraction).toBe(e);
  });

  it("ändrar inte indata", () => {
    const e = medAvgiftsRef(1, "Årsavgift kr/kvm upplåten bostadsrätt 780");
    const kopia = structuredClone(e);
    verifieraSidreferenser(e, sidor(FYLL, SIDA));
    expect(e).toEqual(kopia);
  });

  it("icke-Figure-referenser (källor, händelser) får en skäl-rad i stället för osaker", () => {
    const e: ExtractionResult = {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        avgiftInkluderarKallor: { varme: { page: 1, excerpt: "Värme ingår i avgiften" } },
      },
    };
    const r = verifieraSidreferenser(e, sidor("helt annan text utan något som liknar citatet"));
    expect(r.extraction.forening.avgiftInkluderarKallor?.varme).toEqual({
      page: 1,
      excerpt: "Värme ingår i avgiften",
    });
    expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(
      /avgiftInkluderarKallor\.varme/,
    );
  });

  describe("adresser och fastighetsbeteckningar", () => {
    const TEXT =
      "Föreningen äger fastigheten Pontonjären 3 på Baltzar von Platens gata 6, 112 42 Stockholm.";
    const med = (adresser: unknown, beteckningar?: unknown): ExtractionResult =>
      ({
        ...extraktion,
        forening: { ...extraktion.forening, adresser, fastighetsbeteckningar: beteckningar },
      }) as ExtractionResult;
    const ref = {
      page: 1,
      excerpt: "fastigheten Pontonjären 3 på Baltzar von Platens gata 6, 112 42",
    };

    it("behåller en verifierad adress och beteckning", () => {
      const r = verifieraSidreferenser(
        med(
          [
            {
              gatuadress: "Baltzar von Platens gata 6",
              postnummer: "112 42",
              ort: "Stockholm",
              ref,
            },
          ],
          [{ beteckning: "Pontonjären 3", ref }],
        ),
        sidor(TEXT),
      );
      expect(r.extraction.forening.adresser).toHaveLength(1);
      expect(r.extraction.forening.fastighetsbeteckningar).toHaveLength(1);
    });

    it("utelämnar en adress vars gata inte står på sidan, med en skäl-rad", () => {
      const r = verifieraSidreferenser(med([{ gatuadress: "Sveavägen 1", ref }]), sidor(TEXT));
      expect(r.extraction.forening.adresser).toEqual([]);
      expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(/Sveavägen 1/);
    });

    it("utelämnar en adress vars citat inte finns, och en beteckning som inte står på sidan", () => {
      const r = verifieraSidreferenser(
        med(
          [
            {
              gatuadress: "Baltzar von Platens gata 6",
              ref: { page: 1, excerpt: "påhittat citat om gatan" },
            },
          ],
          [{ beteckning: "Annan 9", ref }],
        ),
        sidor(TEXT),
      );
      expect(r.extraction.forening.adresser).toEqual([]);
      expect(r.extraction.forening.fastighetsbeteckningar).toEqual([]);
    });

    it("tar bort ett postnummer som inte står på sidan men behåller adressen", () => {
      const r = verifieraSidreferenser(
        med([{ gatuadress: "Baltzar von Platens gata 6", postnummer: "999 99", ref }]),
        sidor(TEXT),
      );
      expect(r.extraction.forening.adresser?.[0]?.postnummer).toBeUndefined();
    });
  });
});

// Real page texts: every window of every page of each local PDF must verify on
// its own page (after perturbing whitespace) -- exercises the normalisation on
// real pdf.js output. Skipped when the (gitignored) PDFs are absent.
const PDF_DIR =
  process.env["BINFO_PDF_DIR"] ?? path.resolve(__dirname, "../../../annual reports examples");
async function lokalaPdf(): Promise<string[]> {
  try {
    return (await readdir(PDF_DIR))
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => path.join(PDF_DIR, f));
  } catch {
    return [];
  }
}

describe("verifieraSidreferenser på riktiga sidtexter", async () => {
  const filer = await lokalaPdf();
  it.skipIf(filer.length === 0)(
    "varje textfönster hittas på sin egen sida",
    async () => {
      let kontrollerade = 0;
      for (const fil of filer) {
        const { pages } = await extractPdfText(new Uint8Array(await readFile(fil)));
        const karta = new Map(pages.map((t, i) => [i + 1, t]));
        pages.forEach((text, i) => {
          const ord = text.split(/\s+/).filter(Boolean);
          for (let start = 0; start + 8 <= ord.length; start += 40) {
            // Re-join with different whitespace than pdf.js produced.
            const utdrag = ord.slice(start, start + 8).join(" ");
            const r = verifieraSidreferenser(medAvgiftsRef(i + 1, utdrag), karta);
            const f = r.fynd.find((x) => x.sokvag.includes("keyFigures[0]"))!;
            expect(f.status, `${path.basename(fil)} s${i + 1}: ${utdrag}`).not.toBe("saknas");
            kontrollerade++;
          }
        });
      }
      expect(kontrollerade).toBeGreaterThan(0);
    },
    120_000,
  );
});
