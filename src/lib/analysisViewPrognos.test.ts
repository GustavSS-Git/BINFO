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

  it("delar proportionellt när faktorn saknas", () => {
    const { krPerKrManad: _k, ...j } = a.prisanalys.justeringar![0]!;
    const { bidrag, proportionell } = komponentPris({ justeringar: [j] }, pg);
    expect(proportionell).toBe(true);
    expect(bidrag["spargap"]).toBeCloseTo(-90_000);
    expect(bidrag["refinansiering"]).toBeCloseTo(-150_000);
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
    expect(formatDag("2029-06-01")).toBe("1 juni 2029");
  });
});
