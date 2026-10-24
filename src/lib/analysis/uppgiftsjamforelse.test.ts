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
  it("same year at hög confidence: bekräftat, report used", () => {
    const r = kor(1958, forening({ byggar: fig(1958) }));
    expect(byggarRad(r)).toMatchObject({
      status: "bekraftat",
      anvant: 1958,
      anvandare: 1958,
      rapport: 1958,
    });
    expect(byggarRad(r)?.ref?.page).toBe(4);
    expect(r.byggarForVardering).toBe(1958);
  });
  it("one year apart at hög: bekräftat, report year used", () => {
    const r = kor(1959, forening({ byggar: fig(1958) }));
    expect(byggarRad(r)).toMatchObject({ status: "bekraftat", anvant: 1958 });
  });
  it("medium confidence match (scan): bekräftat, user's year used", () => {
    const r = kor(1959, forening({ byggar: fig(1958) }), dk("hog", "skannad"));
    expect(byggarRad(r)).toMatchObject({ status: "bekraftat", anvant: 1959 });
    expect(r.byggarForVardering).toBe(1959);
  });
  it("differs at hög: avviker, report used, with the standard sentence", () => {
    const r = kor(1962, forening({ byggar: fig(1958) }));
    const rad = byggarRad(r);
    expect(rad).toMatchObject({ status: "avviker", anvant: 1958 });
    expect(rad?.text).toContain("Du angav 1962, årsredovisningen anger 1958, vi använder 1958.");
    expect(rad?.text).toMatch(/ombyggnad/);
    expect(r.byggarForVardering).toBe(1958);
    expect(r.byggarAlternativ).toBeUndefined();
  });
  it("differs at medel (scan): osäkert, user's year used, alternative = report", () => {
    const r = kor(1962, forening({ byggar: fig(1958) }), dk("hog", "skannad"));
    const rad = byggarRad(r);
    expect(rad).toMatchObject({ status: "osakert", anvant: 1962 });
    expect(rad?.text).toMatch(/1962/);
    expect(rad?.text).toMatch(/1958/);
    expect(rad?.text).toMatch(/bredare/);
    expect(r.byggarForVardering).toBe(1962);
    expect(r.byggarAlternativ).toBe(1958);
  });
  it("differs with low extraction confidence or a derived value: osäkert", () => {
    expect(byggarRad(kor(1962, forening({ byggar: fig(1958) }), dk("lag")))?.status).toBe(
      "osakert",
    );
    expect(
      byggarRad(kor(1962, forening({ byggar: fig(1958, { source: "berakning" }) })))?.status,
    ).toBe("osakert");
  });
  it("differs with an excerpt-less report figure: medel → osäkert", () => {
    const f = fig(1958);
    delete f.ref;
    expect(byggarRad(kor(1962, forening({ byggar: f })))?.status).toBe("osakert");
  });
  it("differs at låg (osaker mark): osäkert", () => {
    const r = kor(1962, forening({ byggar: fig(1958, { osaker: "Värdeår" }) }));
    expect(byggarRad(r)).toMatchObject({ status: "osakert", anvant: 1962 });
    expect(r.byggarAlternativ).toBe(1958);
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
