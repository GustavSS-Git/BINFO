import { describe, expect, it } from "vitest";
import type { ExtractionResult, Figure, Forening, PropertyInput } from "@/types/analysis";
import { jamforUppgifter } from "./uppgiftsjamforelse";

const fig = (value: number | null, extra: Partial<Figure> = {}): Figure => ({
  value,
  unit: "ar",
  source: "arsredovisning",
  ref: { page: 4, excerpt: "Byggår 1958" },
  ...extra,
});
const forening = (extra: Partial<Forening> = {}): Forening => ({
  namn: "Brf Test",
  orgnr: "769600-0000",
  akta: "ja",
  rakenskapsar: 2025,
  keyFigures: [],
  ...extra,
});
const dk = (
  niva: "hog" | "medel" | "lag" = "hog",
  kalla: "textlager" | "skannad" = "textlager",
): ExtractionResult["datakvalitet"] => ({
  pdfSaknarTextlager: kalla === "skannad",
  extraktionKonfidens: { niva },
  saknadeFalt: [],
  kalla,
});
const input = (byggar?: number) =>
  ({ ...(byggar !== undefined ? { byggar } : {}) }) as unknown as PropertyInput;

function kor(byggar: number | undefined, f: Forening, d = dk()) {
  return jamforUppgifter({ input: input(byggar), forening: f, datakvalitet: d });
}
const byggarRad = (r: ReturnType<typeof kor>) => r.rader.find((x) => x.falt === "byggar");

describe("byggår", () => {
  it("none on either side: no row, nothing to feed", () => {
    const r = kor(undefined, forening());
    expect(byggarRad(r)).toBeUndefined();
    expect(r.byggarForVardering).toBeUndefined();
  });
  it("same year: manuellt (never bekräftat), buyer's year used", () => {
    const r = kor(1958, forening({ byggar: fig(1958) }));
    expect(byggarRad(r)).toMatchObject({
      status: "manuellt",
      anvant: 1958,
      anvandare: 1958,
      rapport: 1958,
    });
    expect(byggarRad(r)?.ref?.page).toBe(4);
    expect(r.byggarForVardering).toBe(1958);
  });
  it("one year apart at hög: manuellt, the buyer's year used (not the report's)", () => {
    const r = kor(1959, forening({ byggar: fig(1958) }));
    expect(byggarRad(r)).toMatchObject({ status: "manuellt", anvant: 1959 });
    expect(r.byggarForVardering).toBe(1959);
  });
  it("one year apart on a scan: manuellt, buyer's year used", () => {
    const r = kor(1959, forening({ byggar: fig(1958) }), dk("hog", "skannad"));
    expect(byggarRad(r)).toMatchObject({ status: "manuellt", anvant: 1959 });
    expect(r.byggarForVardering).toBe(1959);
  });
  it("differs at hög: avviker, BUYER's year used, no range widening", () => {
    const r = kor(1962, forening({ byggar: fig(1958) }));
    const rad = byggarRad(r);
    expect(rad).toMatchObject({ status: "avviker", anvant: 1962, anvandare: 1962, rapport: 1958 });
    expect(rad?.text).toContain("Du angav 1962, årsredovisningen anger 1958.");
    expect(rad?.text).toContain("Vi använder ditt år, 1962.");
    expect(rad?.text).toMatch(/ombyggnad/);
    expect(r.byggarForVardering).toBe(1962);
    expect(r.byggarAlternativ).toBeUndefined();
  });
  it("differs, whatever the report's confidence: avviker, buyer's year, never osäkert", () => {
    const fall: Array<[string, Forening, ReturnType<typeof dk>]> = [
      ["scan", forening({ byggar: fig(1958) }), dk("hog", "skannad")],
      ["låg extraction confidence", forening({ byggar: fig(1958) }), dk("lag")],
      ["derived value", forening({ byggar: fig(1958, { source: "berakning" }) }), dk()],
      ["osaker mark", forening({ byggar: fig(1958, { osaker: "Värdeår" }) }), dk()],
      [
        "no excerpt",
        forening({ byggar: { value: 1958, unit: "ar", source: "arsredovisning" } }),
        dk(),
      ],
    ];
    for (const [namn, f, d] of fall) {
      const r = kor(1962, f, d);
      expect(byggarRad(r), namn).toMatchObject({ status: "avviker", anvant: 1962 });
      expect(r.byggarForVardering, namn).toBe(1962);
      expect(r.byggarAlternativ, namn).toBeUndefined();
    }
  });
  it("never produces bekraftat or osakert", () => {
    for (const [a, b] of [
      [1958, 1958],
      [1959, 1958],
      [1962, 1958],
    ] as const) {
      const status = byggarRad(kor(a, forening({ byggar: fig(b) })))?.status;
      expect(status).not.toBe("bekraftat");
      expect(status).not.toBe("osakert");
    }
  });
  it("user only: manuellt", () => {
    const r = kor(1962, forening());
    expect(byggarRad(r)).toMatchObject({
      status: "manuellt",
      anvant: 1962,
      text: "Finns inte i årsredovisningen, du angav 1962.",
    });
    expect(r.byggarForVardering).toBe(1962);
  });
  it("report figure with null value counts as missing", () => {
    expect(byggarRad(kor(1962, forening({ byggar: fig(null) })))?.status).toBe("manuellt");
  });
  it("report only, hög: endast_rapport, used", () => {
    const r = kor(undefined, forening({ byggar: fig(1958) }));
    expect(byggarRad(r)).toMatchObject({ status: "endast_rapport", anvant: 1958 });
    expect(r.byggarForVardering).toBe(1958);
  });
  it("report only, medel (scan): used", () => {
    const r = kor(undefined, forening({ byggar: fig(1958) }), dk("hog", "skannad"));
    expect(r.byggarForVardering).toBe(1958);
  });
  it("report only, låg: shown but not used", () => {
    const r = kor(undefined, forening({ byggar: fig(1958, { osaker: "x" }) }));
    expect(byggarRad(r)).toMatchObject({ status: "endast_rapport", anvant: null });
    expect(r.byggarForVardering).toBeUndefined();
  });
});

describe("förening-level fields", () => {
  it("rows only for present values, with Swedish labels and refs", () => {
    const r = kor(
      undefined,
      forening({
        antalLagenheter: fig(46, { unit: "antal" }),
        totalyta: fig(3500.5, { unit: "m2" }),
        bostadsrattsyta: fig(3100, { unit: "m2", osaker: "avviker" }),
        lanebok: { totalSkuld: fig(12_345_678, { unit: "kr" }) },
      }),
    );
    expect(r.rader.map((x) => [x.falt, x.label, x.status, x.anvant])).toEqual([
      ["antalLagenheter", "Antal lägenheter", "endast_rapport", 46],
      ["totalyta", "Total yta", "endast_rapport", 3500.5],
      ["bostadsrattsyta", "Bostadsrättsyta", "endast_rapport", 3100],
      ["totalSkuld", "Föreningens skuld", "endast_rapport", 12_345_678],
    ]);
    const norm = (s: string) => s.replace(/\s/g, " ");
    expect(norm(r.rader[0]!.text)).toBe("Enligt årsredovisningen: 46.");
    expect(norm(r.rader[1]!.text)).toBe("Enligt årsredovisningen: 3 500,5 m².");
    expect(norm(r.rader[2]!.text)).toMatch(/osäker/);
    expect(norm(r.rader[3]!.text)).toBe("Enligt årsredovisningen: 12 345 678 kr.");
    expect(r.rader[0]?.ref?.page).toBe(4);
  });
  it("no row when the value is missing", () => {
    const r = kor(
      undefined,
      forening({
        antalLagenheter: fig(null, { unit: "antal" }),
        lanebok: { totalSkuld: fig(null) },
      }),
    );
    expect(r.rader).toEqual([]);
  });
  it("a debt-free 0 is a value", () => {
    const r = kor(undefined, forening({ lanebok: { totalSkuld: fig(0, { unit: "kr" }) } }));
    expect(r.rader[0]).toMatchObject({ falt: "totalSkuld", anvant: 0 });
  });
});
