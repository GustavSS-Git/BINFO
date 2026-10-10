import { describe, expect, it } from "vitest";
import { buildPdfViewModel } from "@/components/pdf/viewModel";
import { formatFigureVarde } from "@/lib/analysisView";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult, Figure } from "@/types/analysis";

describe("buildPdfViewModel — sample analysis", () => {
  const vm = buildPdfViewModel(sampleAnalysis);

  it("carries the förening name and formatted skapad date", () => {
    expect(vm.foreningNamn).toBe("Brf Granen 10-11");
    expect(vm.skapadLabel).toContain("2026");
  });

  it("includes every red flag, not just the top two, most severe first", () => {
    expect(vm.rodaFlaggor).toHaveLength(sampleAnalysis.rodaFlaggor.length);
    const severities = vm.rodaFlaggor.map((f) => f.severity);
    expect(severities).toEqual(["hog", "hog", "medel", "medel"]);
  });

  it("keeps each red flag's page reference", () => {
    expect(vm.rodaFlaggor[0]?.pageRef).toBe("s. 5");
  });

  it("includes only the six key figures the main analysis shows (visasIHuvudanalys, status !== okant)", () => {
    // arsavgift_andel_av_rorelseintakter has status "okant" in the sample and must be excluded.
    expect(vm.keyFigures.map((kf) => kf.id)).not.toContain("arsavgift_andel_av_rorelseintakter");
    expect(vm.keyFigures).toHaveLength(6);
  });

  it("labels a schablon-sourced key figure distinctly", () => {
    // None of the sample's shown key figures are schablon-sourced; assert the flag is computed at all.
    expect(vm.keyFigures.every((kf) => kf.isSchablon === false)).toBe(true);
  });

  it("labels the schablon-sourced extern värdering as an estimate, never as a fact", () => {
    expect(vm.prisanalys.externVardering?.isSchablon).toBe(true);
    expect(vm.prisanalys.externVardering?.leverantor).toContain("Binfo värderingsmodell");
  });

  it("carries Binfos värderingsunderlag (task 4g) — område, intervall, drivare, databasis, attribution", () => {
    expect(vm.prisanalys.varderingsunderlag).toBeDefined();
    const u = vm.prisanalys.varderingsunderlag;
    expect(u?.omradeText).toContain("Stockholm");
    expect(u?.intervallText).toMatch(/Sannolikt mellan/);
    expect(u?.drivare.length).toBeGreaterThan(0);
    expect(u?.dataBasisText).toMatch(/Bygger på \d/);
    expect(u?.attributionText).toContain("OpenStreetMap");
  });

  it("carries the budpremie text (task 5)", () => {
    expect(vm.prisanalys.budpremieText).toMatch(/Bostäder i/);
  });

  it("includes all four räntestress scenarios (0–3 percentage points), in order", () => {
    expect(vm.rantestress.rader.map((r) => r.okningPe)).toEqual([0, 1, 2, 3]);
    expect(vm.rantestress.rader[3]?.nyManadsavgift).toBe("4 836 kr");
  });

  it("omits totalManadskostnad per row when the analysis has no loan data", () => {
    expect(vm.rantestress.rader.every((r) => r.totalManadskostnad === undefined)).toBe(true);
  });

  it("includes only analysis-derived questions, matching what AnalysRapport shows on screen", () => {
    const analysFragorCount = sampleAnalysis.fragor.filter((f) => f.ursprung === "analys").length;
    expect(vm.fragor).toHaveLength(analysFragorCount);
    expect(vm.fragor.some((f) => f.id === "saknad-hiss")).toBe(false);
  });

  it("carries betyg and motivering verbatim", () => {
    expect(vm.betyg).toBe("D");
    expect(vm.betygMotivering).toBe(sampleAnalysis.betygMotivering);
  });

  it("builds ovrigInfo from the sample's real antalMedlemmar/antalLokaler/avgiftInkluderarKallor/individuellMatning", () => {
    expect(vm.ovrigInfo).toBeDefined();
    const antalMedlemmar = vm.ovrigInfo?.antal.find((a) => a.label === "Antal medlemmar");
    expect(antalMedlemmar?.valueText).toBe("72 st");
    expect(antalMedlemmar?.pageRef).toBe("s. 8");

    const antalLokaler = vm.ovrigInfo?.antal.find((a) => a.label === "Antal lokaler");
    expect(antalLokaler?.valueText).toBe("6 st");

    const el = vm.ovrigInfo?.avgiftPoster.find((p) => p.post === "el");
    expect(el?.statusText).toBe("Ingår");
    expect(el?.pageRef).toBe("s. 15");
    expect(el?.matningText).toBe("Individuell mätning");

    const bredband = vm.ovrigInfo?.avgiftPoster.find((p) => p.post === "bredband");
    expect(bredband?.matningText).toBeUndefined();

    expect(vm.ovrigInfo?.handelser.length).toBe(
      sampleAnalysis.forening.vasentligaHandelser?.length,
    );
    expect(vm.ovrigInfo?.datakvalitetSkal).toEqual([]);
  });
});

describe("buildPdfViewModel — ovrigInfo edge cases", () => {
  it("is undefined when the analysis has nothing new to show — the PDF must skip the whole section", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        namn: sampleAnalysis.forening.namn,
        orgnr: sampleAnalysis.forening.orgnr,
        akta: sampleAnalysis.forening.akta,
        rakenskapsar: sampleAnalysis.forening.rakenskapsar,
        keyFigures: sampleAnalysis.forening.keyFigures,
      },
      datakvalitet: { ...sampleAnalysis.datakvalitet, extraktionKonfidens: { niva: "hog" } },
    };
    expect(buildPdfViewModel(analys).ovrigInfo).toBeUndefined();
  });

  it("shows 'Framgår inte av årsredovisningen' for an 'okant' or unaddressed fee item, never 'nej'", () => {
    // Omit (not set to undefined — exactOptionalPropertyTypes forbids that)
    // avgiftInkluderarKallor/individuellMatning from the base sample, so this
    // case only exercises avgiftInkluderarEnligtForening's own statuses.
    const {
      avgiftInkluderarKallor: _kallor,
      individuellMatning: _matning,
      ...foreningUtanKallor
    } = sampleAnalysis.forening;
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...foreningUtanKallor,
        avgiftInkluderarEnligtForening: {
          varme: "ja",
          vatten: "nej",
          el: "okant",
          bredband: "okant",
          tv: "okant",
        },
      },
    };
    const vm = buildPdfViewModel(analys);
    const el = vm.ovrigInfo?.avgiftPoster.find((p) => p.post === "el");
    expect(el?.statusText).toBe("Framgår inte av årsredovisningen");
    const vatten = vm.ovrigInfo?.avgiftPoster.find((p) => p.post === "vatten");
    expect(vatten?.statusText).toBe("Ingår ej");
  });

  it("marks a väsentlig händelse without a ref distinctly (undefined pageRef), never invents a page", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        namn: sampleAnalysis.forening.namn,
        orgnr: sampleAnalysis.forening.orgnr,
        akta: sampleAnalysis.forening.akta,
        rakenskapsar: sampleAnalysis.forening.rakenskapsar,
        keyFigures: sampleAnalysis.forening.keyFigures,
        vasentligaHandelser: [{ text: "Något hänt, ospecifik sida." }],
      },
      datakvalitet: { ...sampleAnalysis.datakvalitet, extraktionKonfidens: { niva: "hog" } },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.ovrigInfo?.handelser).toEqual([
      { text: "Något hänt, ospecifik sida.", pageRef: undefined },
    ]);
  });

  it("surfaces datakvalitet.extraktionKonfidens.skal even with nothing else to show", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        namn: sampleAnalysis.forening.namn,
        orgnr: sampleAnalysis.forening.orgnr,
        akta: sampleAnalysis.forening.akta,
        rakenskapsar: sampleAnalysis.forening.rakenskapsar,
        keyFigures: sampleAnalysis.forening.keyFigures,
      },
      datakvalitet: {
        ...sampleAnalysis.datakvalitet,
        extraktionKonfidens: { niva: "medel", skal: ["Ett fynd var tvetydigt."] },
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.ovrigInfo?.datakvalitetSkal).toEqual(["Ett fynd var tvetydigt."]);
  });
});

describe("buildPdfViewModel — edge cases", () => {
  it("shows the anonymisation notice, not a dangling ', <ort>', once adress/postnummer/orgnr are cleared", () => {
    // Mirrors src/components/PropertySummary.tsx's exact rendering: after 30
    // days the server clears adress/postnummer/orgnr (ort is retained), and
    // the on-screen report falls back to a notice instead of `"${adress}, ${ort}"`.
    const anonymAnalys: AnalysisResult = {
      ...sampleAnalysis,
      input: { ...sampleAnalysis.input, adress: "", postnummer: "", orgnr: "" },
    };
    const vm = buildPdfViewModel(anonymAnalys);
    const adressRad = vm.summary.find((row) => row.label === "Adress");
    expect(adressRad?.value).toBe("Adressen raderad efter 12 månader · Stockholm");
    expect(adressRad?.value).not.toContain(", Stockholm");
  });

  it("still prints '<adress>, <ort>' when the address has not been anonymised", () => {
    const adressRad = buildPdfViewModel(sampleAnalysis).summary.find(
      (row) => row.label === "Adress",
    );
    expect(adressRad?.value).toBe("Granstigen 10, Stockholm");
  });

  it("renders a figure with value null + tecken negativ via formatFigureVarde, not as 'Uppgift saknas'", () => {
    const negativFigure: Figure = {
      value: null,
      unit: "kr/m2",
      source: "arsredovisning",
      tecken: "negativ",
      tryckt: "neg",
    };
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) =>
          kf.id === "sparande_per_m2_totalyta" ? { ...kf, figure: negativFigure } : kf,
        ),
      },
    };
    const vm = buildPdfViewModel(analys);
    const sparande = vm.keyFigures.find((kf) => kf.id === "sparande_per_m2_totalyta");
    expect(sparande?.valueText).toBe('Negativt ("neg" i årsredovisningen)');
  });

  it("omits externVardering entirely when the analysis has none", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        utgangspris: sampleAnalysis.prisanalys.utgangspris,
        prisPerM2: sampleAnalysis.prisanalys.prisPerM2,
        slutsats: "Ingen extern värdering tillgänglig.",
        konfidens: { niva: "medel" },
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.prisanalys.externVardering).toBeUndefined();
    expect(vm.prisanalys.avvikelseText).toBeUndefined();
    expect(vm.prisanalys.varderingsunderlag).toBeUndefined();
    expect(vm.prisanalys.budpremieText).toBeUndefined();
  });

  it("returns an empty red flags list, rather than throwing, when there are none", () => {
    const analys: AnalysisResult = { ...sampleAnalysis, rodaFlaggor: [] };
    const vm = buildPdfViewModel(analys);
    expect(vm.rodaFlaggor).toEqual([]);
  });

  it("only surfaces low-confidence reasons when konfidens.niva is 'lag', matching AnalysRapport", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        konfidens: { niva: "hog", skal: ["Skulle inte visas"] },
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.prisanalys.konfidensSkal).toEqual([]);
  });

  it("omits a key figure's page reference when the figure has none", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) => {
          if (kf.id !== "sparande_per_m2_totalyta") return kf;
          const { ref: _ref, ...figureUtanRef } = kf.figure;
          return { ...kf, figure: figureUtanRef };
        }),
      },
    };
    const vm = buildPdfViewModel(analys);
    const sparande = vm.keyFigures.find((kf) => kf.id === "sparande_per_m2_totalyta");
    expect(sparande?.pageRef).toBeUndefined();
  });
});

describe("buildPdfViewModel — rantestress with rantekanslighetProcent null", () => {
  it("renders no scenario rows and flags ejBeraknbar when the report doesn't state räntekänslighet", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      rantestress: {
        rantekanslighetProcent: null,
        nuvarandeManadsavgift: sampleAnalysis.rantestress.nuvarandeManadsavgift,
        scenarier: [],
        kommentar: "Räntekänslighet saknas i årsredovisningen — räntestressen kan inte beräknas.",
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.rantestress.ejBeraknbar).toBe(true);
    expect(vm.rantestress.rader).toEqual([]);
    expect(vm.rantestress.kommentar).toBe(analys.rantestress.kommentar);
    expect(vm.rantestress.nuvarandeManadsavgift).toBe(
      formatFigureVarde(sampleAnalysis.rantestress.nuvarandeManadsavgift),
    );
  });
});

describe("buildPdfViewModel — valuation coverage tier", () => {
  const u0 = sampleAnalysis.prisanalys.varderingsunderlag;
  if (!u0) throw new Error("sample has no varderingsunderlag");
  const prisniva = {
    region: "Riket",
    krPerM2: 60000,
    period: { fran: "2026-01-01", till: "2026-08-31" },
    kalla: "Svensk Mäklarstatistik",
  };
  const med = (extra: Record<string, unknown>): AnalysisResult => ({
    ...sampleAnalysis,
    prisanalys: {
      ...sampleAnalysis.prisanalys,
      varderingsunderlag: { ...u0, ...extra },
    },
  });

  it("has no coverage text for Stockholm / old analyses", () => {
    const u = buildPdfViewModel(sampleAnalysis).prisanalys.varderingsunderlag;
    expect(u?.disclaimerText).toBeUndefined();
    expect(u?.metodText).toBeUndefined();
  });

  it("carries the disclaimer for utanfor_lan", () => {
    const u = buildPdfViewModel(med({ tackning: "utanfor_lan", omrade: null, prisniva })).prisanalys
      .varderingsunderlag;
    expect(u?.tackningTitel).toBe("Utanför Binfos täckningsområde");
    expect(u?.disclaimerText).toContain("utanför Stockholms län");
    expect(u?.metodText).toBeUndefined();
    expect(u?.omradeText).toBe("Riket");
  });

  it("carries the method note for lan", () => {
    const u = buildPdfViewModel(
      med({
        tackning: "lan",
        kommun: "Nacka",
        omrade: null,
        prisniva: { ...prisniva, region: "Nacka" },
      }),
    ).prisanalys.varderingsunderlag;
    expect(u?.metodText).toContain("Nacka");
    expect(u?.disclaimerText).toBeUndefined();
    expect(u?.omradeText).toBe("Nacka");
  });
});

describe("buildPdfViewModel — andel av föreningens lån (v2)", () => {
  const medAndel = (andel: Figure | undefined): AnalysisResult => {
    const { andelAvForeningensSkuld: _borta, ...utanAndel } = sampleAnalysis.prisanalys;
    return {
      ...sampleAnalysis,
      prisanalys: { ...utanAndel, ...(andel ? { andelAvForeningensSkuld: andel } : {}) },
    };
  };

  it("has no debt row when the analysis has no andelAvForeningensSkuld", () => {
    expect(buildPdfViewModel(medAndel(undefined)).prisanalys.andelAvSkuld).toBeUndefined();
    expect(buildPdfViewModel(sampleAnalysis).prisanalys.andelAvSkuld).toBeUndefined();
  });

  it("writes skuld/m² × boarea (from the nyckeltal), says it is not part of the valuation, and cites the page", () => {
    // sample: 8 990 kr/m² (nyckeltalet) × 54 m² = 485 460 kr
    const vm = buildPdfViewModel(
      medAndel({
        value: 485_460,
        unit: "kr",
        source: "berakning",
        ref: { page: 9, excerpt: "Skuldsättning / kvm upplåten bostadsrätt, kr 8 990" },
      }),
    );
    // sv-SE separates thousands with a non-breaking space; compare with plain spaces.
    expect(vm.prisanalys.andelAvSkuld?.text.replace(/\s/g, " ")).toBe(
      "Lägenhetens ungefärliga andel av föreningens lån: ca 485 460 kr " +
        "(8 990 kr/m² × 54,0 m²). Ingår inte i värderingen.",
    );
    expect(vm.prisanalys.andelAvSkuld?.pageRef).toBe("s. 9");
    expect(vm.prisanalys.andelAvSkuld?.osaker).toBeUndefined();
  });

  it("reads 0 kr as a debt-free association, not as '0 kr'", () => {
    const vm = buildPdfViewModel(
      medAndel({ value: 0, unit: "kr", source: "berakning", ref: { page: 12 } }),
    );
    expect(vm.prisanalys.andelAvSkuld?.text).toBe(
      "Föreningen har inga räntebärande lån enligt årsredovisningen.",
    );
    expect(vm.prisanalys.andelAvSkuld?.pageRef).toBe("s. 12");
  });

  it("omits the row when the figure has no value", () => {
    const vm = buildPdfViewModel(medAndel({ value: null, unit: "kr", source: "berakning" }));
    expect(vm.prisanalys.andelAvSkuld).toBeUndefined();
  });

  it("never changes the valuation text", () => {
    const utan = buildPdfViewModel(medAndel(undefined)).prisanalys;
    const med = buildPdfViewModel(
      medAndel({ value: 485_460, unit: "kr", source: "berakning", ref: { page: 9 } }),
    ).prisanalys;
    expect(med.externVardering).toEqual(utan.externVardering);
    expect(med.avvikelseText).toBe(utan.avvikelseText);
    expect(med.slutsats).toBe(utan.slutsats);
  });
});

describe("buildPdfViewModel — osäker-markering (v2)", () => {
  it("carries a key figure's osaker reason, and undefined when there is none", () => {
    const forst = sampleAnalysis.forening.keyFigures.find((kf) => kf.status !== "okant");
    if (!forst) throw new Error("sample has no shown key figure");
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) =>
          kf.id === forst.id
            ? { ...kf, figure: { ...kf.figure, osaker: "Stämmer inte med årsavgifterna." } }
            : kf,
        ),
      },
    };
    const vm = buildPdfViewModel(analys);
    expect(vm.keyFigures.find((kf) => kf.id === forst.id)?.osaker).toBe(
      "Stämmer inte med årsavgifterna.",
    );
    expect(
      vm.keyFigures.filter((kf) => kf.id !== forst.id).every((kf) => kf.osaker === undefined),
    ).toBe(true);
  });

  it("carries osaker on an antal figure", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        antalMedlemmar: {
          value: 72,
          unit: "antal",
          source: "arsredovisning",
          ref: { page: 8 },
          osaker: "Skiljer sig från antalet lägenheter.",
        },
      },
    };
    const antal = buildPdfViewModel(analys).ovrigInfo?.antal.find(
      (a) => a.label === "Antal medlemmar",
    );
    expect(antal?.osaker).toBe("Skiljer sig från antalet lägenheter.");
  });

  it("flags the debt row as osäker when the figure is", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        andelAvForeningensSkuld: {
          value: 100_000,
          unit: "kr",
          source: "berakning",
          osaker: "Skuldsättningen verkar vara i tusental kronor.",
        },
      },
    };
    expect(buildPdfViewModel(analys).prisanalys.andelAvSkuld?.osaker).toBe(
      "Skuldsättningen verkar vara i tusental kronor.",
    );
  });
});

describe("buildPdfViewModel — skannad årsredovisning (v2)", () => {
  const SKANNAD =
    "Årsredovisningen var skannad; siffrorna är avlästa från sidbilderna och kan innehålla fel – " +
    "kontrollera de viktigaste mot rapporten.";

  it("adds the notice when datakvalitet.kalla is 'skannad'", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      datakvalitet: { ...sampleAnalysis.datakvalitet, kalla: "skannad" },
    };
    expect(buildPdfViewModel(analys).ovrigInfo?.skannadNotis).toBe(SKANNAD);
  });

  it("shows the section for a scanned report even when nothing else would be shown", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        namn: sampleAnalysis.forening.namn,
        orgnr: sampleAnalysis.forening.orgnr,
        akta: sampleAnalysis.forening.akta,
        rakenskapsar: sampleAnalysis.forening.rakenskapsar,
        keyFigures: sampleAnalysis.forening.keyFigures,
      },
      datakvalitet: {
        ...sampleAnalysis.datakvalitet,
        extraktionKonfidens: { niva: "hog" },
        kalla: "skannad",
      },
    };
    const ovrig = buildPdfViewModel(analys).ovrigInfo;
    expect(ovrig).toBeDefined();
    expect(ovrig?.skannadNotis).toBe(SKANNAD);
  });

  it("has no notice for a text-layer report or when kalla is absent (old analyses)", () => {
    expect(buildPdfViewModel(sampleAnalysis).ovrigInfo?.skannadNotis).toBeUndefined();
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      datakvalitet: { ...sampleAnalysis.datakvalitet, kalla: "textlager" },
    };
    expect(buildPdfViewModel(analys).ovrigInfo?.skannadNotis).toBeUndefined();
  });
});
