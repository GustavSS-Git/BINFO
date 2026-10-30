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

describe("verifieraSidreferenser: nya poster (PROMPT_VERSION 9)", () => {
  const RAD = "SEB 2,5 % 2026-03-28 683 080";
  const SIDA_LAN = `Not 15 Skulder till kreditinstitut\n${RAD}\nSumma 683 080`;
  const ref = (page: number, excerpt: string) => ({ page, excerpt });
  const fig = (value: number, unit: "kr" | "procent", r: ReturnType<typeof ref>) => ({
    value,
    unit,
    source: "arsredovisning" as const,
    ref: r,
  });

  function medNytt(nytt: Partial<ExtractionResult["forening"]>): ExtractionResult {
    return { ...extraktion, forening: { ...extraktion.forening, ...nytt } };
  }
  const lanMed = (page: number, excerpt: string) => ({
    kreditgivare: "SEB",
    belopp: fig(683080, "kr", ref(page, excerpt)),
    ranta: fig(2.5, "procent", ref(page, excerpt)),
    villkorsandringsdag: "2026-03-28",
    rantetyp: "okant" as const,
    ref: ref(page, excerpt),
  });
  // Sidan 3 bär lånenoten; sida 1-2 och 4 är fyllnad.
  const texter = sidor(FYLL, FYLL, SIDA_LAN, FYLL);

  it("godtar ett lån vars rad står på den citerade sidan", () => {
    const e = medNytt({
      lanebok: { ...extraktion.forening.lanebok!, lan: [lanMed(3, RAD)] },
    });
    const r = verifieraSidreferenser(e, texter);
    expect(r.extraction.forening.lanebok!.lan![0]!.belopp.osaker).toBeUndefined();
    expect(r.fynd.filter((f) => f.sokvag.includes(".lan[0]")).map((f) => f.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
  });

  it("rättar fel sida för lånet och dess belopp/ranta", () => {
    const e = medNytt({
      lanebok: { ...extraktion.forening.lanebok!, lan: [lanMed(2, RAD)] },
    });
    const l = verifieraSidreferenser(e, texter).extraction.forening.lanebok!.lan![0]!;
    expect(l.ref.page).toBe(3);
    expect(l.belopp.ref?.page).toBe(3);
    expect(l.ranta?.ref?.page).toBe(3);
  });

  it("markerar lånets belopp osäkert när raden inte finns, men tappar inte lånet", () => {
    const e = medNytt({
      lanebok: { ...extraktion.forening.lanebok!, lan: [lanMed(3, "Nordea 9,9 % 1999-01-01")] },
    });
    const r = verifieraSidreferenser(e, texter);
    const l = r.extraction.forening.lanebok!.lan![0]!;
    expect(l.belopp.osaker).toMatch(/kunde inte styrkas/);
    expect(l.ranta?.osaker).toBeDefined();
    expect(r.extraction.datakvalitet.extraktionKonfidens.niva).not.toBe("hog");
  });

  it("markerar räntekostnader, fond och avsättning osäkra när citatet saknas, rättar sidan annars", () => {
    const e = medNytt({
      lanebok: {
        ...extraktion.forening.lanebok!,
        rantekostnader: fig(
          417473,
          "kr",
          ref(1, "Räntekostnader och liknande resultatposter -417 473"),
        ),
      },
      underhallsplan: {
        finns: "ja",
        underhallsfond: fig(850000, "kr", ref(1, "Fond för yttre underhåll 850 000")),
        arligAvsattning: fig(300000, "kr", ref(1, "Avsättning 300 000 per år finns ingenstans")),
      },
    });
    const t = sidor(
      FYLL,
      "Resultaträkning\nRäntekostnader och liknande resultatposter -417 473",
      "Balans\nFond för yttre underhåll 850 000",
    );
    const f = verifieraSidreferenser(e, t).extraction.forening;
    expect(f.lanebok!.rantekostnader!.ref?.page).toBe(2);
    expect(f.lanebok!.rantekostnader!.osaker).toBeUndefined();
    expect(f.underhallsplan!.underhallsfond!.ref?.page).toBe(3);
    expect(f.underhallsplan!.arligAvsattning!.osaker).toMatch(/kunde inte styrkas/);
  });

  describe("PROMPT_VERSION 11: avgiftsandringar och förlustsignaler", () => {
    const andring = (page: number, excerpt: string, procentPage = page) => ({
      procent: fig(25, "procent", ref(procentPage, excerpt)),
      fran: "2024-05-01",
      status: "beslutad" as const,
      text: "Höjning av årsavgiften",
      ref: ref(page, excerpt),
    });
    const t = sidor(
      FYLL,
      "Väsentliga händelser\nföreningen har beslutat om en hyreshöjning med 25% från 1 maj 2024",
      "Lokaler\nHyresgästen har sagt upp sitt avtal",
    );

    it("keeps a change on the right page, corrects a wrong page, drops one whose citation is nowhere", () => {
      const e = medNytt({
        avgiftsandringar: [
          andring(2, "hyreshöjning med 25% från 1 maj 2024"),
          andring(3, "hyreshöjning med 25% från 1 maj 2024"), // wrong page
          andring(2, "höjning med 99% som aldrig stod här"),
        ],
      });
      const r = verifieraSidreferenser(e, t);
      expect(r.extraction.forening.avgiftsandringar!.map((a) => a.ref.page)).toEqual([2, 2]);
      expect(r.extraction.forening.avgiftsandringar![1]!.procent.ref?.page).toBe(2);
      expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(
        /Höjningen av årsavgiften/,
      );
    });

    it("all changes dropped → the field disappears", () => {
      const e = medNytt({ avgiftsandringar: [andring(2, "står inte här")] });
      expect(verifieraSidreferenser(e, t).extraction.forening.avgiftsandringar).toBeUndefined();
    });

    it("förlustsignaler: right page kept, wrong page corrected, uncitable dropped; lokaler stays", () => {
      const sig = (page: number, excerpt: string) => ({
        text: "Hyresgästen har sagt upp",
        ref: ref(page, excerpt),
      });
      const e = medNytt({
        lokaler: {
          forlustsignaler: [
            sig(3, "Hyresgästen har sagt upp sitt avtal"),
            sig(2, "Hyresgästen har sagt upp sitt avtal"), // wrong page
            sig(3, "Lokalen står tom sedan i våras"), // nowhere
          ],
        },
      });
      const l = verifieraSidreferenser(e, t).extraction.forening.lokaler!;
      expect(l.forlustsignaler!.map((x) => x.ref.page)).toEqual([3, 3]);
    });

    describe("PROMPT_VERSION 12: kontrakt[].fornyelse", () => {
      const tt = sidor(
        FYLL,
        "Kontoret hyrs ut till 2026-12-31",
        "Avtalet för kontoret har förlängts till 2029-12-31",
      );
      const kontrakt = (fornyelseRef: ReturnType<typeof ref>) => ({
        slutdatum: "2026-12-31",
        ref: ref(2, "Kontoret hyrs ut till 2026-12-31"),
        fornyelse: { text: "Förlängt", nyttSlutdatum: "2029-12-31", ref: fornyelseRef },
      });
      it("a renewal on the right page is kept", () => {
        const e = medNytt({
          lokaler: { kontrakt: [kontrakt(ref(3, "har förlängts till 2029-12-31"))] },
        });
        const k = verifieraSidreferenser(e, tt).extraction.forening.lokaler!.kontrakt!;
        expect(k).toHaveLength(1);
        expect(k[0]!.fornyelse?.ref.page).toBe(3);
      });
      it("a renewal on the wrong page is corrected", () => {
        const e = medNytt({
          lokaler: { kontrakt: [kontrakt(ref(2, "har förlängts till 2029-12-31"))] },
        });
        const k = verifieraSidreferenser(e, tt).extraction.forening.lokaler!.kontrakt!;
        expect(k[0]!.fornyelse?.ref.page).toBe(3);
      });
      it("a renewal whose citation is nowhere is dropped, the lease stays", () => {
        const e = medNytt({
          lokaler: { kontrakt: [kontrakt(ref(3, "ny hyresgäst har skrivit på"))] },
        });
        const r = verifieraSidreferenser(e, tt);
        const k = r.extraction.forening.lokaler!.kontrakt!;
        expect(k).toHaveLength(1);
        expect(k[0]!.fornyelse).toBeUndefined();
        expect(k[0]!.slutdatum).toBe("2026-12-31");
        expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(
          /förlängning eller ny hyresgäst/,
        );
      });
      it("a lease whose own citation fails is dropped with its renewal", () => {
        const e = medNytt({
          lokaler: {
            kontrakt: [
              {
                ...kontrakt(ref(3, "har förlängts till 2029-12-31")),
                ref: ref(2, "finns inte alls"),
              },
            ],
          },
        });
        expect(verifieraSidreferenser(e, tt).extraction.forening.lokaler?.kontrakt).toBeUndefined();
      });
    });

    it("all signals dropped → forlustsignaler removed, other lokaler data kept", () => {
      const e = medNytt({
        lokaler: {
          hyresintakter: fig(100, "kr", ref(3, "Hyresgästen har sagt upp sitt avtal")),
          forlustsignaler: [{ text: "x", ref: ref(3, "finns inte") }],
        },
      });
      const l = verifieraSidreferenser(e, t).extraction.forening.lokaler!;
      expect(l.forlustsignaler).toBeUndefined();
      expect(l.hyresintakter?.value).toBe(100);
    });
  });

  describe("PROMPT_VERSION 10: underhåll och genomförda åtgärder", () => {
    const atgard = (byggdel: "tak" | "stambyte", ar: number, page: number, excerpt: string) => ({
      byggdel,
      ar,
      text: `Åtgärd ${byggdel}`,
      ref: ref(page, excerpt),
    });
    const t = sidor(FYLL, "Tidigare åtgärder\n2019 takomläggning\n2021 stambyte relining", FYLL);

    it("godtar en åtgärd på rätt sida, rättar fel sida och släpper en vars citat inte finns", () => {
      const e = medNytt({
        genomfordaAtgarder: [
          atgard("tak", 2019, 2, "2019 takomläggning"),
          atgard("stambyte", 2021, 3, "2021 stambyte relining"), // fel sida
          atgard("tak", 2005, 2, "2005 tak byttes av grannen"), // finns ingenstans
        ],
      });
      const r = verifieraSidreferenser(e, t);
      expect(
        r.extraction.forening.genomfordaAtgarder!.map((a) => [a.byggdel, a.ar, a.ref.page]),
      ).toEqual([
        ["tak", 2019, 2],
        ["stambyte", 2021, 2],
      ]);
      expect(r.extraction.datakvalitet.extraktionKonfidens.skal?.join(" ")).toMatch(
        /genomförda åtgärden/,
      );
    });

    it("trasigt textlager med privata tecken (Nabo, Brf Ingemar 8): citat i ren och trasig form godtas", () => {
      // pdf.js text of Brf Ingemar 8 2025, p. 5–6: "t"/"ti"/"tt"/"fl" glyphs read as U+E0xx.
      const luckor = sidor(
        FYLL,
        "Tak: Omlag\uE035\nEls\uE03Fgar u\uE035by\uE035a och \uE035ake\uE035 omlag\uE035\n" +
          "Värdeåre\uE035 är 1929.\nKassa\uE001ödesanalys\nFörval\uE035ningsberä\uE035else",
        "Renovering och s\uE035amby\uE035e i \uE035vä\uE035s\uE035ugan källaren. " +
          "S\uE035amby\uE035e av alla s\uE035ammar i källare",
      );
      const e = medNytt({
        genomfordaAtgarder: [
          atgard("tak", 1986, 2, "Tak: Omlagt"),
          atgard("tak", 1986, 2, "Elstigar utbytta och taket omlagt"),
          atgard("stambyte", 2024, 3, "Stambyte av alla stammar i källare"),
          atgard("stambyte", 2024, 3, "Renovering och sambye i vätsugan källaren."),
          atgard("tak", 2014, 2, "Ommålning taket gathus"), // finns inte på sidan
        ],
      });
      const r = verifieraSidreferenser(e, luckor);
      expect(r.extraction.forening.genomfordaAtgarder!.map((a) => a.ref.excerpt)).toEqual([
        "Tak: Omlagt",
        "Elstigar utbytta och taket omlagt",
        "Stambyte av alla stammar i källare",
        "Renovering och sambye i vätsugan källaren.",
      ]);
      const v = verifieraSidreferenser(medAvgiftsRef(2, "Värdeåret är 1929."), luckor);
      expect(v.fynd.find((f) => f.sokvag.includes("keyFigures[0]"))?.status).toBe("ok");
      const k = verifieraSidreferenser(medAvgiftsRef(2, "Kassaflödesanalys"), luckor);
      expect(k.fynd.find((f) => f.sokvag.includes("keyFigures[0]"))?.status).toBe("ok");
      // A gap swallows only f/i/l/t: other letters must still match.
      const fel = verifieraSidreferenser(medAvgiftsRef(2, "Värdeåren är 1929."), luckor);
      expect(fel.fynd.find((f) => f.sokvag.includes("keyFigures[0]"))?.status).toBe("saknas");
    });

    it("alla åtgärder släppta -> fältet försvinner", () => {
      const e = medNytt({ genomfordaAtgarder: [atgard("tak", 2005, 2, "finns inte alls här")] });
      expect(verifieraSidreferenser(e, t).extraction.forening.genomfordaAtgarder).toBeUndefined();
    });

    it("investeringsbehov och plantotal: sidan rättas, saknat citat markerar osäkert", () => {
      const e = medNytt({
        underhallsplan: {
          finns: "ja",
          investeringsbehovPerM2: {
            value: 310,
            unit: "kr/m2",
            source: "arsredovisning",
            ref: ref(1, "Tidigare åtgärder"),
          },
          rekommenderadAvsattning: fig(1_100_000, "kr", ref(2, "bör avsättas hittepå")),
          planTotal: { belopp: fig(45_000_000, "kr", ref(2, "2019 takomläggning")), ar: 30 },
        },
      });
      const p = verifieraSidreferenser(e, t).extraction.forening.underhallsplan!;
      expect(p.investeringsbehovPerM2!.ref?.page).toBe(2);
      expect(p.investeringsbehovPerM2!.osaker).toBeUndefined();
      expect(p.rekommenderadAvsattning!.osaker).toMatch(/kunde inte styrkas/);
      expect(p.planTotal!.belopp.ref?.page).toBe(2);
    });
  });

  it("markerar bostadsrattsyta osäker när citatet inte finns", () => {
    const e = medNytt({
      bostadsrattsyta: { ...fig(3750, "kr", ref(1, "Bostadsrättsarea 3 750 kvm")), unit: "m2" },
    });
    const f = verifieraSidreferenser(e, sidor(FYLL, FYLL)).extraction.forening;
    expect(f.bostadsrattsyta!.osaker).toBeDefined();
  });

  it("tar bort ett lokalkontrakt, ett energiprojekt och sparandeUttag vars citat inte håller", () => {
    const e = medNytt({
      lokaler: {
        hyresintakter: fig(480000, "kr", ref(2, "Hyresintäkter lokaler 480 000")),
        kontrakt: [
          { slutdatum: "2026-09-30", ref: ref(2, "avtalet löper till 2026-09-30") },
          { slutdatum: "2027-01-01", ref: ref(2, "avtal som inte finns") },
        ],
      },
      energiprojekt: [
        { text: "Solceller", finansierat: "ja", ref: ref(2, "Solceller installeras 2026") },
        { text: "Bergvärme", finansierat: "ja", ref: ref(2, "finns inte alls") },
      ],
      sparandeUttag: { planerat: "ja", finansierat: "ja", ref: ref(2, "påhittat uttag") },
    });
    const t = sidor(
      FYLL,
      "Hyresintäkter lokaler 480 000. Butiken: avtalet löper till 2026-09-30. Solceller installeras 2026.",
    );
    const r = verifieraSidreferenser(e, t);
    const f = r.extraction.forening;
    expect(f.lokaler!.kontrakt!.map((c) => c.slutdatum)).toEqual(["2026-09-30"]);
    expect(f.lokaler!.hyresintakter!.osaker).toBeUndefined();
    expect(f.energiprojekt!.map((p) => p.text)).toEqual(["Solceller"]);
    expect(f.sparandeUttag).toBeUndefined();
    const skal = r.extraction.datakvalitet.extraktionKonfidens.skal ?? [];
    expect(skal.some((s) => /lokalkontrakt/i.test(s))).toBe(true);
    expect(skal.some((s) => /Bergvärme/.test(s))).toBe(true);
    expect(skal.some((s) => /planerat uttag/.test(s))).toBe(true);
    expect(r.extraction.datakvalitet.extraktionKonfidens.niva).not.toBe("hog");
  });

  it("rättar sidan på ett lokalkontrakt som står på en annan sida", () => {
    const e = medNytt({
      lokaler: {
        kontrakt: [{ slutdatum: "2026-09-30", ref: ref(1, "Butiken hyrs ut till 2026-09-30") }],
      },
    });
    const t = sidor(FYLL, "Butiken hyrs ut till 2026-09-30, avtalet förlängs");
    const k = verifieraSidreferenser(e, t).extraction.forening.lokaler!.kontrakt!;
    expect(k[0]!.ref.page).toBe(2);
  });
});
