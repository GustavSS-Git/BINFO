import { describe, expect, it } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { AnalysisResultSchema, ExtractionResultSchema, ForeningSchema } from "./schema";
import { extraktion } from "./__fixtures__/extraktion";

// Round 2026-10-24b: every new field is optional, so results stored before it
// must still parse, and the new shapes must be strict like the rest.

const citat = (page: number, excerpt: string) => ({ page, excerpt });
const kr = (value: number, page: number, excerpt: string) => ({
  value,
  unit: "kr" as const,
  source: "arsredovisning" as const,
  ref: citat(page, excerpt),
});

const nyaForeningsfalt = {
  bostadsrattsyta: {
    value: 3100,
    unit: "m2" as const,
    source: "arsredovisning" as const,
    ref: citat(3, "Bostadsrättsyta 3 100 kvm"),
  },
  balansdag: "2025-12-31",
  sparandeUttag: { planerat: "ja" as const, finansierat: "ja" as const, text: "Uttag ur fonden" },
  lokaler: {
    hyresintakter: kr(240000, 9, "Hyresintäkter lokaler 240 000"),
    kontrakt: [{ slutdatum: "2026-06-30", ref: citat(4, "avtalet löper ut 2026-06-30") }],
  },
  energiprojekt: [{ text: "Solceller", finansierat: "okant" as const }],
};

describe("schema, round 2026-10-24b", () => {
  it("the stored /exempel snapshot (made before the round) still parses", () => {
    expect(AnalysisResultSchema.safeParse(sampleAnalysis).success).toBe(true);
  });

  it("an extraction without the new fields still parses", () => {
    expect(ExtractionResultSchema.safeParse(extraktion).success).toBe(true);
  });

  it("accepts the new förening fields, loans and maintenance amounts", () => {
    const ex = structuredClone(extraktion);
    const forening = {
      ...ex.forening,
      ...nyaForeningsfalt,
      lanebok: {
        totalSkuld: kr(10_000_000, 10, "Summa 10 000 000"),
        lan: [
          {
            kreditgivare: "SEB",
            belopp: kr(4_000_000, 10, "SEB 2026-03-28 2,53 % 4 000 000"),
            ranta: {
              value: 2.53,
              unit: "procent" as const,
              source: "arsredovisning" as const,
              ref: citat(10, "SEB 2026-03-28 2,53 % 4 000 000"),
            },
            villkorsandringsdag: "2026-03-28",
            rantetyp: "rorlig" as const,
            ref: citat(10, "SEB 2026-03-28 2,53 % 4 000 000"),
          },
        ],
        rantekostnader: kr(310_000, 6, "Räntekostnader 310 000"),
      },
      underhallsplan: {
        finns: "ja" as const,
        planeradeKostnader: [
          {
            text: "Stambyte",
            fran: 2027,
            belopp: kr(6_000_000, 4, "stambyte 2027 ca 6 mkr"),
            finansiering: "okant" as const,
          },
        ],
        underhallsfond: kr(800_000, 12, "Fond för yttre underhåll 800 000"),
      },
    };
    const res = ForeningSchema.safeParse(forening);
    expect(res.error?.issues ?? []).toEqual([]);
  });

  it("rejects an unknown key inside a loan and a malformed date", () => {
    const ex = structuredClone(extraktion);
    const lan = {
      belopp: kr(1, 1, "x"),
      rantetyp: "okant",
      ref: citat(1, "x"),
      villkorsandringsdag: "2026-13-01",
    };
    const fel = ForeningSchema.safeParse({
      ...ex.forening,
      lanebok: { totalSkuld: kr(1, 1, "x"), lan: [{ ...lan, extra: true }] },
    });
    expect(fel.success).toBe(false);
    const paths = fel.error!.issues.map((i) => i.path.join("."));
    expect(paths.some((p) => p.endsWith("villkorsandringsdag"))).toBe(true);
    expect(fel.error!.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
  });

  it("a loan needs a citation with an excerpt", () => {
    const ex = structuredClone(extraktion);
    const res = ForeningSchema.safeParse({
      ...ex.forening,
      lanebok: {
        totalSkuld: kr(1, 1, "x"),
        lan: [{ belopp: kr(1, 1, "x"), rantetyp: "okant", ref: { page: 1 } }],
      },
    });
    expect(res.success).toBe(false);
  });
});
