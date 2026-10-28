import { describe, expect, it } from "vitest";
import {
  antalIOrd,
  avgiftHuvudorsak,
  avgiftIngarText,
  avgiftKort,
  avgiftLead,
  avgiftRubrik,
  avrundaKomponentEffekter,
  byggdelTabell,
  drivareRader,
  foreningFaktaText,
  foreningenRubrik,
  forstaMening,
  horisontText,
  jamforelseNamn,
  lanTabell,
  nyckeltalJamforelse,
  prisRubrik,
  sidhanvisning,
  sorteraNyckeltal,
  sparRader,
  svarssignalDelar,
} from "@/lib/analysisView";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { analysMedPrognos, analysMedSparbehov } from "@/components/prognosTestdata";
import type { AvgiftsKomponent, Avgiftsprognos, KeyFigure } from "@/types/analysis";

/** toLocaleString("sv-SE") skriver tusentalsavgränsaren som hårt mellanslag. */
const vanlig = (t: string | null) => (t ?? "").replace(/\u00a0/g, " ");

const fig = (value: number, page?: number, extra: object = {}) => ({
  value,
  unit: "antal" as const,
  source: "arsredovisning" as const,
  ...(page !== undefined ? { ref: { page } } : {}),
  ...extra,
});

describe("rubriker i ord", () => {
  it("antal i ord", () => {
    expect(antalIOrd(1)).toBe("en");
    expect(antalIOrd(2)).toBe("två");
    expect(antalIOrd(5)).toBe("fem");
    expect(antalIOrd(40)).toBe("40");
  });

  it("avsnitt 1: betygstiteln och antalet flaggor, determinstiskt", () => {
    expect(foreningenRubrik("B", 2)).toBe("Stabil ekonomi, två saker att hålla koll på");
    expect(foreningenRubrik("C", 1)).toBe("Godtagbar, med svagheter, en sak att hålla koll på");
    expect(foreningenRubrik("A", 0)).toBe("Stark ekonomi, inga större varningsflaggor");
  });

  it("avsnitt 2: verdiktet följer läget mot spannet", () => {
    expect(prisRubrik("under")).toBe("Utgångspriset ligger under spannet");
    expect(prisRubrik("inom")).toBe("Utgångspriset ligger inom spannet");
    expect(prisRubrik("over")).toBe("Utgångspriset ligger över spannet");
    expect(prisRubrik(null)).toBe("Binfos värdering");
  });
});

describe("forstaMening", () => {
  it("tar första meningen och kortar långa", () => {
    expect(forstaMening("Låg skuld. Och mer text.")).toBe("Låg skuld.");
    expect(forstaMening("Skulden är 3 617 kr per m². Mer.")).toBe("Skulden är 3 617 kr per m².");
    const lang = forstaMening(`${"ord ".repeat(60)}slut.`);
    expect(lang.length).toBeLessThanOrEqual(151);
    expect(lang.endsWith("…")).toBe(true);
  });
});

describe("nyckeltalens jämförelse", () => {
  const kf = (
    id: KeyFigure["id"],
    status: KeyFigure["status"],
    benchmark?: KeyFigure["benchmark"],
  ) =>
    ({
      id,
      status,
      figure: { value: 7, unit: "kr/m2" as const, source: "arsredovisning" as const },
      ...(benchmark ? { benchmark } : {}),
    }) satisfies Pick<KeyFigure, "id" | "status" | "figure" | "benchmark">;

  it("döper om jämförelsevärdets etikett i vyn", () => {
    expect(jamforelseNamn("Riksgenomsnitt, skuldsättning per m² bostadsrättsyta")).toBe(
      "Riksgenomsnitt",
    );
    expect(jamforelseNamn("Snitt Stockholm, årsavgift per m² bostadsrättsyta")).toBe(
      "Stockholmssnitt",
    );
    const riks = kf("skuldsattning_per_m2_brf_yta", "god", {
      value: 7117,
      label: "Riksgenomsnitt, skuldsättning per m² bostadsrättsyta",
      source: "x",
    });
    expect(vanlig(nyckeltalJamforelse(riks))).toBe("Riksgenomsnitt: 7 117 kr/m²");
  });

  it("sparande: husets behov när det finns, annars tomt; den ej bedömda förklaras", () => {
    expect(nyckeltalJamforelse(kf("sparande_per_m2_totalyta", "svag"), 300)).toBe(
      "Behov för huset: ca 300 kr/m²",
    );
    expect(nyckeltalJamforelse(kf("sparande_per_m2_totalyta", "svag"))).toBe("");
    expect(nyckeltalJamforelse(kf("arsavgift_andel_av_rorelseintakter", "okant"))).toBe(
      "Lagstadgat nyckeltal som Binfo inte bedömer",
    );
  });

  it("sorterar som i tabellen: sparande först, den ej bedömda sist", () => {
    const ids = sorteraNyckeltal(sampleAnalysis.forening.keyFigures).map((k) => k.id);
    expect(ids[0]).toBe("sparande_per_m2_totalyta");
    expect(ids.at(-1)).toBe("arsavgift_andel_av_rorelseintakter");
    expect(ids).toHaveLength(7);
  });
});

describe("avgiftIngarText: en mening över alla fem posterna", () => {
  it("grupperar efter status med sidhänvisning", () => {
    const text = avgiftIngarText({
      avgiftInkluderarEnligtForening: {
        varme: "ja",
        vatten: "ja",
        el: "nej",
        bredband: "okant",
        tv: "ja",
      },
      avgiftInkluderarKallor: {
        varme: { page: 14 },
        vatten: { page: 14 },
        el: { page: 8 },
        tv: { page: 14 },
      },
    });
    expect(text).toBe(
      "Värme, vatten och tv ingår (s. 14). El ingår inte (s. 8). Bredband framgår inte.",
    );
  });

  it("nämner individuell mätning och är undefined utan uppgift", () => {
    const text = avgiftIngarText({
      avgiftInkluderarEnligtForening: {
        varme: "okant",
        vatten: "okant",
        el: "ja",
        bredband: "okant",
        tv: "okant",
      },
      individuellMatning: { el: { matning: "ja", ref: { page: 9 } } },
    });
    expect(text).toContain("El ingår.");
    expect(text).toContain("Värme, vatten, bredband och tv framgår inte.");
    expect(text).toContain("Individuell mätning av el (s. 9).");
    expect(avgiftIngarText({})).toBeUndefined();
  });
});

describe("foreningFaktaText", () => {
  it("antal med sidor och värdeår enligt utdraget", () => {
    const text = foreningFaktaText({
      antalLagenheter: fig(39, 4),
      antalLokaler: fig(2, 4),
      antalMedlemmar: fig(49, 7),
      byggar: { ...fig(1931, 4), unit: "ar", ref: { page: 4, excerpt: "Värdeåret är 1931" } },
    });
    expect(text).toBe("39 lägenheter, 2 lokaler, 49 medlemmar (s. 4, 7). Värdeår 1931 (s. 4).");
  });

  it("hyresrätter, ental och osäkra värden", () => {
    const text = foreningFaktaText({
      antalLagenheter: fig(1, 3),
      antalHyresratter: fig(1, 3),
      antalLokaler: fig(5, 3, { osaker: "stämmer inte" }),
    });
    expect(text).toBe("1 lägenhet (varav 1 hyresrätt), 5 lokaler (osäkert: stämmer inte) (s. 3).");
    expect(foreningFaktaText({})).toBeUndefined();
  });

  it("sidhanvisning ger unika sidor i ordning", () => {
    expect(sidhanvisning([7, 4, 4, undefined])).toBe("s. 4, 7");
    expect(sidhanvisning([])).toBe("");
  });
});

describe("svarssignalDelar", () => {
  it("delar i två rader när båda etiketterna finns", () => {
    expect(
      svarssignalDelar("Bra svar: en plan med pengar. Varningssignal: att ingen vet."),
    ).toEqual({ typ: "tva", bra: "en plan med pengar.", varning: "att ingen vet." });
  });

  it("annars en rad som förut", () => {
    expect(svarssignalDelar("Bra svar: bara det.")).toEqual({
      typ: "en",
      text: "Bra svar: bara det.",
    });
    expect(svarssignalDelar("Ett datum lugnar.")).toEqual({
      typ: "en",
      text: "Bra svar / varningssignal: Ett datum lugnar.",
    });
  });
});

describe("avgiften framåt: kort, rubrik och drivare", () => {
  const komp = (
    id: AvgiftsKomponent["id"],
    status: AvgiftsKomponent["status"],
    krPerManad: number | null,
  ): AvgiftsKomponent => ({
    id,
    label: id,
    status,
    foreningKrPerAr: null,
    krPerManad,
    forklaring: `förklaring ${id}`,
  });
  const prognos = (komponenter: AvgiftsKomponent[], total: number | null): Avgiftsprognos => ({
    horisontManader: 24,
    berakningsdatum: "2026-10-28",
    andel: { varde: 0.01, metod: "avgiftsandel" },
    komponenter,
    totalKrPerManad: total,
  });

  it("kortet: tal, avgift före och efter och huvudorsak med 'kan bli mer'", () => {
    const p = prognos(
      [
        komp("spargap", "beraknad", 400),
        komp("refinansiering", "beraknad", -30),
        komp("underhall", "saknar_underlag", null),
      ],
      370,
    );
    const kort = avgiftKort(p, 3503);
    expect(kort.varde).toBe("+370 kr/mån");
    expect(vanlig(kort.rad)).toBe("3 503 → ca 3 873 kr");
    expect(kort.text).toBe(
      "Främst för att föreningen sparar för lite till underhåll. Kan bli mer: kommande underhåll saknar belopp.",
    );
    expect(avgiftHuvudorsak(p)?.id).toBe("spargap");
  });

  it("varianter: ingen prognos, okänd andel, ingen tydlig förändring", () => {
    expect(avgiftKort(undefined, 3503).varde).toBe("Kan inte uppskattas");
    expect(avgiftKort(prognos([], null), 3503)).toMatchObject({
      varde: "Kan inte uppskattas",
      rad: null,
    });
    expect(avgiftKort(prognos([], 4), 3503)).toMatchObject({
      varde: "Ingen tydlig förändring",
      rad: null,
    });
  });

  it("rubrik och ingress", () => {
    const p = prognos(
      [komp("spargap", "beraknad", 400), komp("refinansiering", "beraknad", 50)],
      450,
    );
    expect(avgiftRubrik(p)).toBe("Räkna med ca 450 kr mer i månaden inom två år");
    expect(avgiftLead(p)).toBe(
      "Det mesta beror på att föreningen sparar för lite till underhåll. Hur mycket räntan påverkar ser du längre ner.",
    );
    expect(avgiftRubrik(prognos([], null))).toBe("Vi kan inte uppskatta hur avgiften utvecklas");
    expect(avgiftRubrik(prognos([], 3))).toBe("Ingen tydlig förändring av avgiften inom två år");
    expect(avgiftRubrik(undefined)).toBe("Vad händer om räntan stiger?");
    expect(horisontText(12)).toBe("ett år");
    expect(horisontText(18)).toBe("18 månader");
  });

  it("drivare: de ej aktuella slås ihop bara när alla är ej aktuella", () => {
    const alla = drivareRader({
      komponenter: [
        komp("spargap", "beraknad", 400),
        komp("lokaler", "ej_aktuell", null),
        komp("energi", "ej_aktuell", null),
        komp("beslutad_hojning", "ej_aktuell", null),
        komp("underhall", "saknar_underlag", null),
      ],
    });
    expect(alla.map((r) => r.label)).toEqual([
      "spargap",
      "Beslutade höjningar, lokalhyra, energiprojekt",
      "underhall",
    ]);
    expect(alla.map((r) => r.varde)).toEqual(["+400 kr/mån", "0 kr/mån", "Okänt"]);

    const blandat = drivareRader({
      komponenter: [
        komp("lokaler", "beraknad", 40),
        komp("energi", "ej_aktuell", null),
        komp("beslutad_hojning", "ej_aktuell", null),
      ],
    });
    expect(blandat).toHaveLength(3);
    expect(blandat[0]?.varde).toBe("+40 kr/mån");
  });
});

describe("byggdelar, sparande och lån", () => {
  const p = analysMedSparbehov().avgiftsprognos!;

  it("byggdelstabellen med läge, sida och brukar-hålla", () => {
    const rader = byggdelTabell(p.sparbehov!);
    const tak = rader.find((r) => r.key === "tak")!;
    expect(tak).toMatchObject({ senast: "2019", sida: 6, livslangd: "20–60 år" });
    expect(tak.lage).toEqual({ text: "Nyligen", ton: "success" });
    const stam = rader.find((r) => r.key === "stambyte")!;
    expect(stam.senast).toBe("Inget nämnt, troligen original (1958)");
    expect(stam.lage).toEqual({ text: "Troligen eftersatt", ton: "warning" });
    expect(rader.find((r) => r.key === "fasad")?.lage).toEqual({ text: "Ok", ton: "success" });
    expect(rader.find((r) => r.key === "hiss")?.lage).toEqual({ text: "Okänt", ton: "neutral" });
  });

  it("sparrader: behov, sparar, glapp och formeln för din avgift", () => {
    const rader = sparRader(p)!;
    expect(rader.map((r) => r.label)).toEqual([
      "Indikerat underhållsbehov",
      "Föreningen sparar i dag",
      "Sparar för lite",
      "Så blir det din avgift",
    ]);
    expect(rader[0]?.varde).toBe("ca 310 kr/m² per år");
    expect(rader[3]?.note).toContain("190 kr/m² × 50 %");
    expect(rader[3]?.varde).toBe("ca +300 kr/mån");
  });

  it("lånetabellen: läge per fas och ton efter ränteriktning", () => {
    const refi = p.refinansiering!;
    const rader = lanTabell(
      {
        ...refi,
        nyRantaProcent: 2.65,
        lan: [
          {
            belopp: 1,
            rantaProcent: 4.49,
            dag: "2026-09-28",
            rorlig: false,
            fas: "forfallit",
            vikt: 0,
            foreningKrPerAr: null,
          },
          {
            belopp: 2,
            rantaProcent: 2.51,
            dag: "2026-11-28",
            rorlig: false,
            fas: "inom_horisont",
            vikt: 1,
            foreningKrPerAr: 1,
          },
          {
            belopp: 3,
            rantaProcent: 3.4,
            dag: "2026-12-28",
            rorlig: false,
            fas: "inom_horisont",
            vikt: 1,
            foreningKrPerAr: 1,
          },
          {
            belopp: 4,
            rantaProcent: 2.2,
            dag: "2028-12-28",
            rorlig: false,
            fas: "senare",
            vikt: 0.5,
            foreningKrPerAr: 1,
          },
        ],
      },
      24,
    );
    expect(rader[0]).toMatchObject({
      forfaller: "28 september 2026",
      ranta: "4,49 %",
      lage: { text: "Redan omsatt, ny ränta okänd", ton: "info" },
    });
    expect(rader[1]?.lage).toEqual({ text: "Ca 2,65 % väntas", ton: "warning" });
    expect(rader[2]?.lage).toEqual({ text: "Ca 2,65 % väntas", ton: "success" });
    expect(rader[3]?.lage.ton).toBe("neutral");
  });

  it("effekter på priset avrundas till 1 000 kr och summerar till totalen", () => {
    const { effekter, total } = avrundaKomponentEffekter(
      { spargap: -130_339, refinansiering: -3_770 },
      -134_109,
    );
    expect(effekter).toEqual({ spargap: -130_000, refinansiering: -4_000 });
    expect(total).toBe(-134_000);
    const skev = avrundaKomponentEffekter({ a: -100_400, b: -100_400 }, -200_800);
    expect(Object.values(skev.effekter).reduce((a, b) => a + b, 0)).toBe(skev.total);
  });

  it("prognosdata utan nya fält ger inga sparrader", () => {
    expect(sparRader(analysMedPrognos().avgiftsprognos!)).toBeUndefined();
  });
});
