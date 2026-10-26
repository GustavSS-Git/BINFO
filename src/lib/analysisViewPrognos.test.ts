import { describe, expect, it } from "vitest";
import { analysMedPlanMal, analysMedSparbehov } from "@/components/prognosTestdata";
import {
  byggdelRader,
  formatDag,
  komponentPris,
  lanRader,
  sparKedja,
  TRYCK_STATUS,
  TRYCK_TON,
  vattenfall,
} from "@/lib/analysisView";

const a = analysMedSparbehov();
const pg = a.avgiftsprognos!;

describe("analysisView — visuell prognos", () => {
  it("mappar tryck till nyckeltalens statusar och toner", () => {
    expect(TRYCK_STATUS).toEqual({ gron: "god", gul: "svag", rod: "kritisk" });
    expect(TRYCK_TON).toEqual({ gron: "success", gul: "warning", rod: "danger" });
  });

  it("delar prisjusteringen per komponent med kr-per-kr-faktorn", () => {
    const { bidrag, proportionell } = komponentPris(a.prisanalys, pg);
    expect(bidrag).toEqual({ spargap: -90_000, refinansiering: -150_000 });
    expect(proportionell).toBe(false);
  });

  it("delar justeringen med den exakta faktorn även när kr-per-kr-fältet saknas", () => {
    const { krPerKrManad: _k, ...j } = a.prisanalys.justeringar![0]!;
    const { bidrag, proportionell } = komponentPris({ justeringar: [j] }, pg);
    expect(proportionell).toBe(false);
    expect(bidrag).toEqual({ spargap: -90_000, refinansiering: -150_000 });
  });

  it("komponenterna summerar exakt till justeringen; restavrundningen går till största posten", () => {
    // belopp −116 583 ≈ factor 145,72 per kr/mån; the parts round to 10 kr and the
    // remainder lands once on the largest component.
    const j = {
      ...a.prisanalys.justeringar![0]!,
      belopp: { value: -116_583, unit: "kr" as const, source: "schablon" as const },
    };
    const p3 = {
      ...pg,
      totalKrPerManad: 800,
      komponenter: pg.komponenter.map((k) =>
        k.id === "spargap"
          ? { ...k, krPerManad: 301 }
          : k.id === "refinansiering"
            ? { ...k, krPerManad: 499 }
            : k,
      ),
    };
    const { bidrag } = komponentPris({ justeringar: [j] }, p3);
    const summa = Object.values(bidrag).reduce((x, y) => x + y, 0);
    expect(summa).toBe(-116_583);
    // Everything but the largest step is a multiple of 10 kr.
    expect(Math.abs(bidrag["spargap"]!) % 10).toBe(0);
  });

  it("kortet, vattenfallet och kedjan visar samma belopp per komponent", () => {
    const { bidrag } = komponentPris(a.prisanalys, pg);
    const v = vattenfall(a.prisanalys, pg)!;
    const steg = v.rader.filter((r) => r.typ === "steg").map((r) => r.beloppText);
    expect(steg).toEqual(
      pg.komponenter
        .filter((k) => bidrag[k.id] !== undefined)
        .map((k) => `−${Math.abs(bidrag[k.id]!).toLocaleString("sv-SE")} kr`),
    );
    const kedja = sparKedja(pg, a.prisanalys)!;
    expect(kedja.steg.find((x) => x.id === "pris")?.varde).toBe(
      `−${Math.abs(bidrag["spargap"]!).toLocaleString("sv-SE")} kr`,
    );
  });

  it("bygger vattenfallet från baslinje till justerat värde", () => {
    const v = vattenfall(a.prisanalys, pg)!;
    expect(v.rader.map((r) => r.typ)).toEqual(["bas", "steg", "steg", "slut"]);
    expect(v.rader[1]!.ton).toBe("warning");
    expect(v.rader[2]!.ton).toBe("danger");
    for (const r of v.rader) {
      expect(r.vansterPct).toBeGreaterThanOrEqual(-1);
      expect(r.vansterPct + r.breddPct).toBeLessThanOrEqual(101);
    }
  });

  it("ingen kedja utan sparbehov", () => {
    const utan = { ...pg };
    delete utan.sparbehov;
    expect(sparKedja(utan, a.prisanalys)).toBeUndefined();
  });

  it("överskott blir 'Överskott' i kedjan", () => {
    const sb = { ...pg.sparbehov!, sparandeKrPerM2: 400, glappKrPerM2: -90 };
    const k = sparKedja({ ...pg, sparbehov: sb }, a.prisanalys)!;
    expect(k.steg.find((s) => s.id === "glapp")).toMatchObject({
      rubrik: "Överskott",
      varde: "90 kr/m²",
      ton: "success",
    });
  });

  it("planmål saknar dämpningstagg", () => {
    expect(
      sparKedja(analysMedPlanMal().avgiftsprognos!, a.prisanalys)!.dampningTag,
    ).toBeUndefined();
  });

  it("byggdelsrader och lånerader", () => {
    const rader = byggdelRader(pg.sparbehov!);
    expect(rader.map((r) => r.statusEtikett)).toEqual(["Eftersatt", "Nyligen", "Ok", "Okänt"]);
    expect(rader[3]!.senast).toBe("okänt");
    const lan = lanRader(pg.refinansiering!, 24);
    expect(lan.map((l) => l.senare)).toEqual([false, false, true]);
    expect(lan[2]!.fas).toBe("År 3–5 · väger 50 %");
    expect(lan[0]!.effekt.replace(/\s/g, " ")).toBe("+36 000 kr/år");
    const flat = lanRader(pg.refinansiering!, 24, 0.01);
    expect(flat[0]!.effekt).toBe("+30 kr/mån");
    expect(flat[0]!.effektForening?.replace(/\s/g, " ")).toBe("+36 000 kr/år");
    expect(formatDag("2029-06-01")).toBe("1 juni 2029");
  });

  it("rörligt lån visas som 'Rörlig ränta' utan datum; endastAr ger 'under <år>'", () => {
    const refi = pg.refinansiering!;
    const bas = {
      belopp: 1_000_000,
      rantaProcent: 3,
      rorlig: false,
      vikt: 1,
      foreningKrPerAr: 1000,
    };
    const rader = lanRader(
      {
        ...refi,
        lan: [
          { ...bas, rorlig: true, dag: "2026-01-05", fas: "inom_horisont" },
          { ...bas, dag: "2027-07-01", endastAr: true, fas: "inom_horisont" },
          { ...bas, dag: "2026-07-01", endastAr: true, fas: "forfallit", foreningKrPerAr: null },
        ],
      },
      24,
    );
    expect(rader[0]!.forfaller).toBe("Rörlig ränta");
    expect(rader[1]!.forfaller).toBe("under 2027");
    expect(rader[2]!.forfaller).toBe("Förföll under 2026");
  });

  it("ett förfallet lån visas som 'Förföll … – omsatt till villkor vi inte känner till', utan effekt", () => {
    const refi = pg.refinansiering!;
    const forfallet = {
      belopp: 1_500_000,
      rantaProcent: 4.49,
      dag: "2026-09-28",
      rorlig: false,
      fas: "forfallit" as const,
      vikt: 0,
      foreningKrPerAr: null,
    };
    const rader = lanRader({ ...refi, lan: [forfallet, ...(refi.lan ?? [])] }, 24, 0.01);
    expect(rader[0]).toMatchObject({
      forfallit: true,
      senare: false,
      forfaller: "Förföll 28 september 2026",
      effekt: "–",
      text: "Förföll 28 september 2026 – omsatt till villkor vi inte känner till",
    });
    expect(rader[0]!.effektForening).toBeUndefined();
    expect(rader.slice(1).every((l) => !l.forfallit)).toBe(true);
  });
});
