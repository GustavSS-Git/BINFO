import { describe, expect, it } from "vitest";
import { analysMedPrognos, analysUtanPrognos } from "@/components/prognosTestdata";
import { buildPdfViewModel, FLAGGA_ETIKETT } from "@/components/pdf/viewModel";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import type { AnalysisResult } from "@/types/analysis";

const flat = (s: string | undefined) => (s ?? "").replace(/\s/g, " ");

describe("buildPdfViewModel: huvud och sammanfattningskort", () => {
  const vm = buildPdfViewModel(sampleAnalysis);

  it("har rapportens eyebrow, adressen som titel och en metarad som webben", () => {
    expect(vm.foreningNamn).toBe("Brf Pontonjären 3");
    expect(vm.huvud.eyebrow).toMatch(/^Rapport · analyserad .*2026/);
    expect(vm.huvud.titel).toBe(sampleAnalysis.input.adress);
    expect(vm.huvud.meta).toContain("Brf Pontonjären 3");
    expect(flat(vm.huvud.meta)).toContain("avgift 3 503 kr/mån");
    expect(vm.huvud.meta).toContain("byggår 1931");
  });

  it("har tre kort: betyg med titel, värdering med spann och avgiften framåt", () => {
    expect(vm.kort.forening).toMatchObject({ betyg: "B", titel: "Stabil ekonomi" });
    expect(vm.kort.forening.text.length).toBeGreaterThan(10);
    expect(vm.kort.varde.stort).toMatch(/^ca \d,\d mkr$/);
    expect(vm.kort.varde.rad).toMatch(/^Spann \d,\d\d–\d,\d\d mkr$/);
    expect(vm.kort.varde.text).toMatch(/^Utgångspriset .* ligger (under|inom|över) spannet\./);
    expect(vm.kort.avgift.stort).toBe("+463 kr/mån");
    expect(flat(vm.kort.avgift.rad)).toBe("3 503 → ca 3 966 kr");
  });

  it("har ingen Sammanfattning-sektion (ägarbeslut Q10)", () => {
    expect(vm).not.toHaveProperty("sammanfattning");
  });

  it("använder adressen raderad-texten och förenings namn som titel när adressen är rensad", () => {
    const anonym = buildPdfViewModel({
      ...sampleAnalysis,
      input: { ...sampleAnalysis.input, adress: "", postnummer: "", orgnr: "" },
    });
    expect(anonym.huvud.titel).toBe("Brf Pontonjären 3");
    expect(anonym.huvud.meta).toContain("Adressen raderad efter 12 månader");
    expect(anonym.huvud.meta).not.toContain(sampleAnalysis.input.adress);
  });

  it("visar byggårsavvikelsen som rad under metaraden", () => {
    const vmP = buildPdfViewModel(analysMedPrognos());
    expect(vmP.huvud.byggarRad).toContain("Årsredovisningen");
    expect(vmP.huvud.byggarRad).toContain("1958");
  });

  it("kortet säger att utgångspris saknas när inget angetts", () => {
    const { utgangspris: _u, ...input } = sampleAnalysis.input;
    const { utgangspris: _pu, prisPerM2: _pp, ...prisanalys } = sampleAnalysis.prisanalys;
    const utan = buildPdfViewModel({ ...sampleAnalysis, input, prisanalys });
    expect(utan.kort.varde.text).toBe(
      "Du angav inget utgångspris, så vi jämför inte priset mot spannet.",
    );
    expect(utan.huvud.meta).not.toContain("utgångspris");
  });
});

describe("buildPdfViewModel: 1 Föreningen", () => {
  const vm = buildPdfViewModel(sampleAnalysis);
  const f = vm.foreningen;

  it("bygger rubriken med webbens hjälpare och räknar alla flaggor", () => {
    expect(f.flaggor).toHaveLength(sampleAnalysis.rodaFlaggor.length);
    expect(f.rubrik).toBe("Stabil ekonomi, fyra saker att hålla koll på");
    expect(f.lead).toBe(sampleAnalysis.betygMotivering);
  });

  it("listar varje flagga, allvarligast först, med sidhänvisning; etiketten är 'Att hålla koll på'", () => {
    expect(FLAGGA_ETIKETT).toBe("Att hålla koll på");
    expect(f.flaggor.every((x) => x.ton === "warning")).toBe(true);
    expect(f.flaggor[0]?.pageRef).toBe("s. 7");
    const hog = buildPdfViewModel({
      ...sampleAnalysis,
      rodaFlaggor: [
        { ...sampleAnalysis.rodaFlaggor[0]!, id: "a", severity: "lag" },
        { ...sampleAnalysis.rodaFlaggor[1]!, id: "b", severity: "hog" },
      ],
    });
    expect(hog.foreningen.flaggor.map((x) => [x.id, x.ton])).toEqual([
      ["b", "danger"],
      ["a", "warning"],
    ]);
  });

  it("har tom flagglista och rubrik utan flaggor när modellen inte hittat några", () => {
    const inga = buildPdfViewModel({ ...sampleAnalysis, rodaFlaggor: [] });
    expect(inga.foreningen.flaggor).toEqual([]);
    expect(inga.foreningen.rubrik).toBe("Stabil ekonomi, inga större varningsflaggor");
  });

  it("har sju nyckeltalsrader i webbens ordning; det sjunde är 'Ingen bedömning'", () => {
    expect(f.nyckeltal.map((k) => k.id)).toEqual([
      "sparande_per_m2_totalyta",
      "skuldsattning_per_m2_brf_yta",
      "skuldsattning_per_m2_totalyta",
      "rantekanslighet",
      "arsavgift_per_m2_brf_yta",
      "energikostnad_per_m2_totalyta",
      "arsavgift_andel_av_rorelseintakter",
    ]);
    const sjunde = f.nyckeltal[6]!;
    expect(sjunde.bedomning).toBe("Ingen bedömning");
    expect(sjunde.jamforelse).toBe("Lagstadgat nyckeltal som Binfo inte bedömer");
    expect(sjunde.varde).toContain("99,7");
    expect(sjunde.pageRef).toBe("s. 8");
    expect(f.nyckeltal[0]?.bedomning).toBe("Acceptabel");
  });

  it("jämför sparandet med husets behov när prognosen har ett sparbehov", () => {
    expect(f.nyckeltal[0]?.jamforelse).toBe("Behov för huset: ca 321 kr/m²");
    expect(f.nyckeltal[1]?.jamforelse).toMatch(/^Riksgenomsnitt: /);
  });

  it("döljer ett bedömt nyckeltal med status okänt och det ogradade utan värde", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) =>
          kf.id === "sparande_per_m2_totalyta"
            ? { ...kf, status: "okant" as const }
            : kf.id === "arsavgift_andel_av_rorelseintakter"
              ? { ...kf, figure: { ...kf.figure, value: null } }
              : kf,
        ),
      },
    };
    const ids = buildPdfViewModel(analys).foreningen.nyckeltal.map((k) => k.id);
    expect(ids).not.toContain("sparande_per_m2_totalyta");
    expect(ids).not.toContain("arsavgift_andel_av_rorelseintakter");
  });

  it("bär osäker-skälet och schablonmärkningen", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        keyFigures: sampleAnalysis.forening.keyFigures.map((kf) =>
          kf.id === "skuldsattning_per_m2_brf_yta"
            ? { ...kf, figure: { ...kf.figure, osaker: "Verkar vara i tusental." } }
            : kf,
        ),
      },
    };
    const rad = buildPdfViewModel(analys).foreningen.nyckeltal.find(
      (k) => k.id === "skuldsattning_per_m2_brf_yta",
    );
    expect(rad?.osaker).toBe("Verkar vara i tusental.");
    expect(f.nyckeltal.every((k) => k.isSchablon === false)).toBe(true);
  });

  it("har 'Mer ur årsredovisningen': händelser, 'I avgiften' över alla fem posterna och antalen", () => {
    const m = f.merUr!;
    expect(m.handelser.length).toBe(sampleAnalysis.forening.vasentligaHandelser?.length);
    expect(m.handelser[0]?.pageRef).toBe("s. 7");
    expect(m.ingar).toBe(
      "Värme, vatten och tv ingår (s. 14). El ingår inte (s. 8). Bredband framgår inte.",
    );
    expect(m.fakta).toBe("39 lägenheter, 2 lokaler, 49 medlemmar (s. 4, 7).");
  });

  it("märker en väsentlig händelse utan sida och tar med datakvalitetens skäl", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        vasentligaHandelser: [{ text: "Något hände." }],
      },
      datakvalitet: {
        ...sampleAnalysis.datakvalitet,
        extraktionKonfidens: { niva: "lag", skal: ["Skälet."] },
      },
    };
    const m = buildPdfViewModel(analys).foreningen.merUr!;
    expect(m.handelser).toEqual([{ text: "Något hände.", pageRef: undefined }]);
    expect(m.skal).toEqual(["Skälet."]);
  });

  it("utelämnar 'Mer ur årsredovisningen' när det inte finns något att visa", () => {
    const tom: AnalysisResult = {
      ...sampleAnalysis,
      forening: {
        ...sampleAnalysis.forening,
        vasentligaHandelser: [],
        avgiftInkluderarEnligtForening: undefined as never,
        antalMedlemmar: undefined as never,
        antalLagenheter: undefined as never,
        antalHyresratter: undefined as never,
        antalLokaler: undefined as never,
        byggar: undefined as never,
      },
      datakvalitet: { ...sampleAnalysis.datakvalitet, extraktionKonfidens: { niva: "hog" } },
    };
    expect(buildPdfViewModel(tom).foreningen.merUr).toBeUndefined();
  });

  it("lägger skannad-notisen först när årsredovisningen var skannad, annars ingen", () => {
    const skannad = buildPdfViewModel({
      ...sampleAnalysis,
      datakvalitet: { ...sampleAnalysis.datakvalitet, kalla: "skannad" },
    });
    expect(skannad.foreningen.skannadNotis).toContain("Årsredovisningen var skannad");
    expect(f.skannadNotis).toBeUndefined();
  });
});

describe("buildPdfViewModel: 2 Priset", () => {
  const p = buildPdfViewModel(sampleAnalysis).priset;

  it("har verdikt-rubrik, lead och en spannstapel med markörer", () => {
    expect(p.rubrik).toMatch(/^Utgångspriset ligger (under|inom|över) spannet$/);
    expect(flat(p.lead)).toContain("Spannet är Binfos värdering ± 10 %");
    expect(p.spann?.markorer.map((m) => m.label)).toEqual(
      expect.arrayContaining(["Utgångspris", "Binfos värdering"]),
    );
    expect(p.spann?.lag).toBeLessThan(p.spann?.hog ?? 0);
  });

  it("har listorna 'Priset i annonsen' och 'Binfos värdering' med webbens etiketter", () => {
    expect(p.annons?.map((r) => r.label)).toEqual(["Utgångspris", "Vanlig budnivå i området"]);
    expect(flat(p.annons?.[0]?.varde)).toBe("4 995 000 kr");
    const etiketter = p.vardering.map((r) => r.label);
    expect(etiketter[0]).toMatch(/^Vad liknande lägenheter säljs för \(Kungsholmen, 112.42\)$/);
    expect(etiketter).toContain("Binfos värdering");
    expect(etiketter.at(-1)).toBe("Rimligt prisspann — Binfos värdering ± 10 %");
    expect(p.vardering.find((r) => r.label === "Binfos värdering")?.total).toBe(true);
  });

  it("lägger kr/m² under värdena och behåller leverantörsraden som PDF:en skriver ut", () => {
    expect(p.vardering[0]?.undertext).toMatch(/^ca [\d\s\u00a0]+ kr\/m²$/);
    expect(p.leverantor).toContain("Binfo värderingsmodell");
    expect(p.uppskattning).toBe(true);
  });

  it("med justering i samplet: 'Föreningens ekonomi' och 'Med föreningens ekonomi inräknad'", () => {
    expect(p.vardering.find((r) => r.label === "Föreningens ekonomi")?.varde).toMatch(/^−\d/);
    expect(p.vardering.find((r) => r.label === "Binfos värdering")?.note).toBe(
      "Med föreningens ekonomi inräknad",
    );
  });

  it("utan justering (gammalt resultat): 'Utan justering för föreningens ekonomi', ingen ekonomirad", () => {
    const gammal = buildPdfViewModel(analysUtanPrognos()).priset;
    expect(gammal.vardering.some((r) => r.label === "Föreningens ekonomi")).toBe(false);
    expect(gammal.vardering.find((r) => r.label === "Binfos värdering")?.note).toBe(
      "Utan justering för föreningens ekonomi",
    );
  });

  it("med prognos: komponenteffekter som egen rad och 'Med föreningens ekonomi inräknad'", () => {
    const pp = buildPdfViewModel(analysMedPrognos()).priset;
    const ekonomi = pp.vardering.find((r) => r.label === "Föreningens ekonomi");
    expect(ekonomi?.varde).toMatch(/^−\d/);
    expect(pp.vardering.find((r) => r.label === "Binfos värdering")?.note).toBe(
      "Med föreningens ekonomi inräknad",
    );
    expect(pp.byggarNotis).toBe(
      "Värderingen räknar med byggår 1958 enligt årsredovisningen, inte 1962 som du angav (s. 3).",
    );
    // The fee-to-price explanation lives in the price card and the fee section, not in "Så har vi räknat".
    expect(pp.rakning).not.toHaveProperty("ekonomi");
  });

  it("utan utgångspris: rubriken 'Binfos värdering', ingen annonslista och ingen budnivå", () => {
    const { utgangspris: _u, ...input } = sampleAnalysis.input;
    const {
      utgangspris: _pu,
      prisPerM2: _pp,
      avvikelseMotVardering: _a,
      ...prisanalys
    } = sampleAnalysis.prisanalys;
    const utan = buildPdfViewModel({ ...sampleAnalysis, input, prisanalys }).priset;
    expect(utan.rubrik).toBe("Binfos värdering");
    expect(utan.annons).toBeUndefined();
    expect(utan.spann?.markorer.map((m) => m.label)).not.toContain("Utgångspris");
  });

  it("utelämnar värderingsraderna och spannet utan värdering (ogiltigt postnummer)", () => {
    const { externVardering: _e, justeradVardering: _j, ...prisanalys } = sampleAnalysis.prisanalys;
    const utan = buildPdfViewModel({ ...sampleAnalysis, prisanalys }).priset;
    expect(utan.harVardering).toBe(false);
    expect(utan.spann).toBeNull();
    expect(utan.vardering).toEqual([]);
    expect(utan.lead).toBe("Utan ett giltigt postnummer kan Binfo inte värdera lägenheten.");
  });

  it("skriver ut andel av föreningens lån med sida och osäker-skäl", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        andelAvForeningensSkuld: {
          value: 485_460,
          unit: "kr",
          source: "berakning",
          ref: { page: 9 },
          osaker: "Skuldsättningen verkar vara i tusental.",
        },
      },
    };
    const s = buildPdfViewModel(analys).priset.skuld;
    expect(s?.text).toContain("Lägenhetens ungefärliga andel av föreningens lån");
    expect(s?.text).toContain("Ingår inte i värderingen");
    expect(s?.pageRef).toBe("s. 9");
    expect(s?.osaker).toBe("Skuldsättningen verkar vara i tusental.");
    expect(p.skuld?.pageRef).toBe("s. 8");
  });

  it("har en täckningsnotis för län och utanför län, annars ingen", () => {
    const u = sampleAnalysis.prisanalys.varderingsunderlag!;
    const med = (tackning: "lan" | "utanfor_lan") =>
      buildPdfViewModel({
        ...sampleAnalysis,
        prisanalys: {
          ...sampleAnalysis.prisanalys,
          varderingsunderlag: {
            ...u,
            omrade: null,
            tackning,
            kommun: "Uppsala",
            prisniva: {
              region: "Uppsala",
              krPerM2: 60000,
              period: { fran: "2026-01-01", till: "2026-08-31" },
              kalla: "Svensk Mäklarstatistik",
            },
          },
        },
      }).priset;
    expect(med("utanfor_lan").tackning).toMatchObject({
      typ: "utanfor_lan",
      titel: "Utanför Binfos täckningsområde",
    });
    expect(med("lan").tackning?.titel).toBe("Värdering utanför Stockholms kommun");
    expect(p.tackning).toBeUndefined();
  });

  it("tar med budpremien som vanlig budnivå, och som mening utan utgångspris", () => {
    expect(p.annons?.[1]?.note).toMatch(/^Utgångspriset plus .* %, vad bostäder på Kungsholmen /);
  });

  it("tar med låg tillförlitlighet bara när nivån är låg", () => {
    const lag = buildPdfViewModel({
      ...sampleAnalysis,
      prisanalys: {
        ...sampleAnalysis.prisanalys,
        konfidens: { niva: "lag", skal: ["Få försäljningar."] },
      },
    }).priset;
    expect(lag.lagTillforlitlighet).toBe("Låg tillförlitlighet: Få försäljningar.");
    expect(
      buildPdfViewModel({
        ...sampleAnalysis,
        prisanalys: {
          ...sampleAnalysis.prisanalys,
          konfidens: { niva: "medel", skal: ["x"] },
        },
      }).priset.lagTillforlitlighet,
    ).toBeUndefined();
  });

  it("har 'Så har vi räknat' med modellens faktorer och källa, utan typiskt fel", () => {
    const m = p.rakning?.modell;
    expect(m?.faktorer.length).toBeGreaterThan(3);
    expect(m?.kalla).toContain("Svensk Mäklarstatistik");
    expect(m?.kalla).toContain("januari–augusti 2026");
    expect(m?.metadata).toMatch(/^\d[\d\s\u00a0]* försäljningar · typiskt fel ±/);
    expect(m).not.toHaveProperty("felText");
    expect(m).not.toHaveProperty("slutsats");
  });
});

describe("buildPdfViewModel: 3 Avgiften framåt", () => {
  it("utan prognos: webbens rubrik, scenariotabellen och inga drivare", () => {
    const vm = buildPdfViewModel(analysUtanPrognos());
    const a = vm.avgiften;
    expect(a.rubrik).toBe("Vad händer om räntan stiger?");
    expect(a.drivare).toBeUndefined();
    expect(a.spar).toBeUndefined();
    expect(a.lan).toBeUndefined();
    expect(a.tryck).toBeUndefined();
    expect(a.rantestress.rader.map((r) => r.okningPe)).toEqual([0, 1, 2, 3]);
    expect(flat(a.rantestress.rader[3]?.nyManadsavgift)).toBe("3 944 kr");
    expect(a.rantestress.rader.every((r) => r.totalManadskostnad === undefined)).toBe(true);
    expect(a.rantestress.prognosTabell).toBeUndefined();
    expect(a.rantestress.boxar).toHaveLength(1);
  });

  it("märker avgiften med tryck när prognosen har det", () => {
    expect(buildPdfViewModel(sampleAnalysis).avgiften.tryck).toMatchObject({
      etikett: "Tydlig avgiftshöjning väntas",
      ton: "danger",
    });
  });

  it("har rutorna 'Dagens avgift' och 'Med högre ränta' för båda baserna med prognos", () => {
    const b = buildPdfViewModel(sampleAnalysis).avgiften.rantestress.boxar;
    expect(b.map((x) => x.vanster.etikett)).toEqual(["Dagens avgift", "Förväntad avgift"]);
    expect(b.every((x) => x.hoger.etikett === "Med högre ränta")).toBe(true);
  });

  it("har ingen stressad avgift när räntekänsligheten saknas", () => {
    const analys: AnalysisResult = {
      ...sampleAnalysis,
      rantestress: {
        ...sampleAnalysis.rantestress,
        rantekanslighetProcent: null,
        scenarier: [],
        kommentar: "Saknas.",
      },
    };
    const r = buildPdfViewModel(analys).avgiften.rantestress;
    expect(r.ejBeraknbar).toBe(true);
    expect(r.rader).toEqual([]);
    expect(r.boxar[0]?.hoger).toEqual({
      etikett: "Med högre ränta",
      saknas: "Inte möjligt att räkna då räntekänslighet saknas i rapporten.",
    });
  });

  it("med prognos: rubrik, tryck, avgiftstabellen och drivartabellen med 'Okänt' och '0 kr/mån'", () => {
    const a = buildPdfViewModel(analysMedPrognos()).avgiften;
    expect(a.rubrik).toContain("500 kr mer i månaden");
    expect(a.rantestress.prognosTabell?.rader).toHaveLength(4);
    expect(a.rantestress.prognosTabell?.rader[1]?.forandring).toBe("+500");
    const varden = a.drivare?.rader.map((r) => r.varde) ?? [];
    expect(varden).toContain("Okänt");
    expect(varden.some((v) => /^0 kr\/mån$|^\+\d/.test(flat(v)))).toBe(true);
    expect(a.drivare?.forvantad).toMatch(/^Förväntad avgift om två år: ca /);
  });

  it("sparsteg, byggdelar och lån med webbens Läge-texter", async () => {
    const { analysMedSparbehov } = await import("@/components/prognosTestdata");
    const a = buildPdfViewModel(analysMedSparbehov()).avgiften;
    expect(a.spar?.rubrik).toBe("Husets byggdelar");
    expect(a.spar?.byggdelar.map((b) => b.lage)).toEqual([
      "Troligen eftersatt",
      "Nyligen",
      "Ok",
      "Okänt",
    ]);
    expect(a.spar?.byggdelKalla).toContain("FAR 2025 och SIB M84:10");
    expect(a.spar?.rader.at(-1)?.total).toBe(true);
    expect(a.lan?.rader).toHaveLength(3);
    expect(a.lan?.rader[2]?.lage).toBe("År 3–5 · väger 50 %");
    expect(a.lan?.fastrad).toContain("medvetet försiktigt val");
    expect(a.lan?.forandring.at(-1)?.label).toBe("Din andel");
  });
});

describe("buildPdfViewModel: 4 Inför visningen, källor och slut", () => {
  const vm = buildPdfViewModel(sampleAnalysis);

  it("bara analysfrågor, rubrik med antalet i ord, 'Varför' på varje", () => {
    const n = sampleAnalysis.fragor.filter((f) => f.ursprung === "analys").length;
    expect(vm.fragor?.fragor).toHaveLength(n);
    expect(vm.fragor?.rubrik).toBe("Fem frågor till mäklaren och styrelsen");
    expect(vm.fragor?.fragor.some((f) => f.id === "saknad-hiss")).toBe(false);
    for (const f of vm.fragor!.fragor) {
      expect(f.varfor).toBe(sampleAnalysis.fragor.find((x) => x.id === f.id)!.varfor);
    }
  });

  it("delar svarssignalen i 'Bra svar' och 'Varningssignal' som webben, annars en rad", () => {
    const { svarssignal: _signal, ...fragaUtanSignal } = sampleAnalysis.fragor[0]!;
    const med: AnalysisResult = {
      ...sampleAnalysis,
      fragor: [
        {
          ...sampleAnalysis.fragor[0]!,
          id: "a",
          ursprung: "analys",
          svarssignal: "Bra svar: x. Varningssignal: y.",
        },
        {
          ...sampleAnalysis.fragor[0]!,
          id: "b",
          ursprung: "analys",
          svarssignal: "  Ett datum.  ",
        },
        { ...fragaUtanSignal, id: "c", ursprung: "analys" as const },
        { ...sampleAnalysis.fragor[0]!, id: "d", ursprung: "saknad_uppgift", svarssignal: "Nej." },
      ],
    };
    const f = buildPdfViewModel(med).fragor!;
    expect(f.fragor.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(f.fragor[0]?.svarssignal).toEqual({ typ: "tva", bra: "x.", varning: "y." });
    expect(f.fragor[1]?.svarssignal).toEqual({
      typ: "en",
      text: "Bra svar / varningssignal: Ett datum.",
    });
    expect(f.fragor[2]?.svarssignal).toBeUndefined();
    expect(f.rubrik).toBe("Tre frågor till mäklaren och styrelsen");
  });

  it("utelämnar avsnittet utan analysfrågor", () => {
    expect(buildPdfViewModel({ ...sampleAnalysis, fragor: [] }).fragor).toBeUndefined();
  });

  it("har källor och metod med webbens rader, och friskrivningen med räkenskapsåret", () => {
    expect(vm.kallor.intro).toContain("årsredovisningen för 2025");
    expect(vm.kallor.rader[0]).toMatch(/^Värdering: Binfos värderingsmodell \(version 3\.1\)/);
    expect(vm.kallor.rader.at(-1)).toMatch(/^Områdesindelning: /);
    expect(vm.friskrivning).toBe(
      "Rapporten är beslutsstöd, inte råd. Siffrorna kommer från föreningens årsredovisning för 2025 och kan innehålla tolkningsfel.",
    );
    expect(vm.kontakt).toBe("contactbinfohere@gmail.com");
  });

  it("nämner Booli i källorna bara när uppgifterna hämtats från en Booli-annons", () => {
    expect(vm.kallor.rader.some((r) => r.includes("Booli"))).toBe(false);
    const medBooli: AnalysisResult = {
      ...sampleAnalysis,
      input: {
        ...sampleAnalysis.input,
        kalla: {
          typ: "booli",
          url: "https://www.booli.se/annons/6279984",
          hamtad: "2026-10-24T10:00:00.000Z",
          oandradeFalt: ["boarea"],
        },
      },
    };
    expect(buildPdfViewModel(medBooli).kallor.rader[0]).toBe(
      "Uppgifter om bostaden hämtades från Booli (booli.se) den 24 okt. 2026.",
    );
  });
});
