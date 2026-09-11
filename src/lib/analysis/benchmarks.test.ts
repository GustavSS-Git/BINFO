import { describe, expect, it } from "vitest";
import { BENCHMARKS, bedomStatus, berikaNyckeltal } from "./benchmarks";
import { KeyFigureIdSchema } from "./schema";
import type { KeyFigure, KeyFigureId, Status } from "@/types/analysis";

/** Rank for monotonicity assertions. 'okant' is excluded from ordering. */
const RANG: Record<Exclude<Status, "okant">, number> = {
  god: 0,
  acceptabel: 1,
  svag: 2,
  kritisk: 3,
};

describe("BENCHMARKS", () => {
  it("täcker exakt de sju id:n som KeyFigureIdSchema tillåter", () => {
    expect(Object.keys(BENCHMARKS).sort()).toEqual([...KeyFigureIdSchema.options].sort());
  });

  it("varje post har en förklarande källa — tom sträng är aldrig ett svar", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      expect(b.source.length, id).toBeGreaterThan(0);
    }
  });

  it("graderade poster märker sitt referensvärde som overifierat — inget tal får se källbelagt ut", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (b.riktning !== "informativ") {
        expect(b.source.toLowerCase(), id).toContain("overifierad");
      }
    }
  });

  it("graderade nyckeltal har både referensvärde och gränser; informativa har varken", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (b.riktning === "informativ") {
        expect(b.value, id).toBeUndefined();
        expect(b.granser, id).toBeUndefined();
      } else {
        expect(typeof b.value, id).toBe("number");
        expect(b.granser, id).toBeDefined();
      }
    }
  });
});

describe("bedomStatus", () => {
  it("ger 'okant' och inget benchmark när värdet saknas", () => {
    const r = bedomStatus("skuldsattning_per_m2_totalyta", null);
    expect(r.status).toBe("okant");
    expect(r.benchmark).toBeUndefined();
  });

  it("ger alltid 'okant' för informativa nyckeltal, oavsett värde", () => {
    // Avgiftsnivå och avgiftsandel är inte entydigt bättre åt något håll —
    // låg avgift kan betyda eftersatt underhåll, låg avgiftsandel kan betyda
    // oäkta förening. Vi graderar inte det vi inte kan motivera.
    for (const id of ["arsavgift_per_m2_brf_yta", "arsavgift_andel_av_rorelseintakter"] as const) {
      for (const varde of [0, 357, 984, 1275, 99]) {
        const r = bedomStatus(id, varde);
        expect(r.status, `${id} @ ${varde}`).toBe("okant");
        expect(r.benchmark, `${id} @ ${varde}`).toBeUndefined();
      }
    }
  });

  it("returnerar ett benchmark i kontraktets form för graderade nyckeltal", () => {
    const r = bedomStatus("skuldsattning_per_m2_totalyta", 2941);
    expect(r.benchmark).toBeDefined();
    expect(typeof r.benchmark!.value).toBe("number");
    expect(typeof r.benchmark!.label).toBe("string");
    expect(typeof r.benchmark!.source).toBe("string");
  });

  describe("lagre_battre (skuldsättning, räntekänslighet, energikostnad)", () => {
    it("graderar i band, med gränsen inklusive i det bättre bandet", () => {
      const id = "skuldsattning_per_m2_totalyta";
      const { granser } = BENCHMARKS[id];
      expect(bedomStatus(id, granser!.god).status).toBe("god");
      expect(bedomStatus(id, granser!.god + 1).status).toBe("acceptabel");
      expect(bedomStatus(id, granser!.acceptabel).status).toBe("acceptabel");
      expect(bedomStatus(id, granser!.acceptabel + 1).status).toBe("svag");
      expect(bedomStatus(id, granser!.svag).status).toBe("svag");
      expect(bedomStatus(id, granser!.svag + 1).status).toBe("kritisk");
    });
  });

  describe("hogre_battre (sparande)", () => {
    it("graderar spegelvänt — mer sparande är bättre", () => {
      const id = "sparande_per_m2_totalyta";
      const { granser } = BENCHMARKS[id];
      expect(bedomStatus(id, granser!.god).status).toBe("god");
      expect(bedomStatus(id, granser!.god - 1).status).toBe("acceptabel");
      expect(bedomStatus(id, granser!.acceptabel).status).toBe("acceptabel");
      expect(bedomStatus(id, granser!.acceptabel - 1).status).toBe("svag");
      expect(bedomStatus(id, granser!.svag).status).toBe("svag");
      expect(bedomStatus(id, granser!.svag - 1).status).toBe("kritisk");
    });
  });

  describe("regression: de faktiska inversionerna modellen producerade", () => {
    // Alla tre kom från riktiga körningar 2026-09-11 där modellen satte
    // status utan något benchmark att jämföra mot.

    it("2,7x skulden får inte betygsättas bättre (Nabo 7955 vs Riksbyggen 2941)", () => {
      const riksbyggen = bedomStatus("skuldsattning_per_m2_totalyta", 2941).status;
      const nabo = bedomStatus("skuldsattning_per_m2_totalyta", 7955).status;
      expect(RANG[nabo as Exclude<Status, "okant">]).toBeGreaterThan(
        RANG[riksbyggen as Exclude<Status, "okant">],
      );
    });

    it("högre energikostnad får inte betygsättas bättre (Nabo 301 vs Riksbyggen 238)", () => {
      const riksbyggen = bedomStatus("energikostnad_per_m2_totalyta", 238).status;
      const nabo = bedomStatus("energikostnad_per_m2_totalyta", 301).status;
      expect(RANG[nabo as Exclude<Status, "okant">]).toBeGreaterThan(
        RANG[riksbyggen as Exclude<Status, "okant">],
      );
    });

    it("lägre sparande får inte betygsättas bättre (SBC 141 vs Riksbyggen 296)", () => {
      const riksbyggen = bedomStatus("sparande_per_m2_totalyta", 296).status;
      const sbc = bedomStatus("sparande_per_m2_totalyta", 141).status;
      expect(RANG[sbc as Exclude<Status, "okant">]).toBeGreaterThan(
        RANG[riksbyggen as Exclude<Status, "okant">],
      );
    });
  });

  describe("monotonicitet över hela verifierade korpusen", () => {
    // Värden från fixtures/answer-key — sex föreningar, fyra förvaltare.
    const korpus: Partial<Record<KeyFigureId, number[]>> = {
      skuldsattning_per_m2_totalyta: [2039, 2941, 3188, 4465, 7955, 11100],
      skuldsattning_per_m2_brf_yta: [2118, 3186, 3263, 6011, 8990, 11100],
      sparande_per_m2_totalyta: [337, 296, 266, 145, 141, 64],
      rantekanslighet: [3, 3.2, 3.82, 8.7, 9.09, 16.85],
      energikostnad_per_m2_totalyta: [194, 219, 238, 250, 295, 301],
    };

    for (const [id, varden] of Object.entries(korpus)) {
      it(`${id}: statusen blir aldrig bättre när värdet blir sämre`, () => {
        const rang = varden.map(
          (v) => RANG[bedomStatus(id as KeyFigureId, v).status as Exclude<Status, "okant">],
        );
        for (let i = 1; i < rang.length; i++) {
          expect(rang[i]!, `index ${i} (värde ${varden[i]})`).toBeGreaterThanOrEqual(rang[i - 1]!);
        }
      });
    }
  });
});

describe("berikaNyckeltal", () => {
  const nyckeltal = (id: KeyFigureId, value: number | null): KeyFigure => ({
    id,
    label: id,
    figure: {
      value,
      unit: "kr/m2",
      source: "arsredovisning",
      ref: { page: 8, excerpt: "Testcitat" },
    },
    status: "okant",
    forklaring: "Testförklaring.",
  });

  it("fyller i status och benchmark för graderade nyckeltal", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("skuldsattning_per_m2_totalyta", 2941)]);
    expect(berikad!.status).toBe("god");
    expect(berikad!.benchmark).toBeDefined();
  });

  it("lämnar informativa nyckeltal på 'okant' utan benchmark", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("arsavgift_per_m2_brf_yta", 984)]);
    expect(berikad!.status).toBe("okant");
    expect(berikad!.benchmark).toBeUndefined();
  });

  it("ger 'okant' när figuren saknar värde", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("rantekanslighet", null)]);
    expect(berikad!.status).toBe("okant");
  });

  it("rör inte övriga fält", () => {
    const input = nyckeltal("rantekanslighet", 3.2);
    const [berikad] = berikaNyckeltal([input]);
    expect(berikad!.id).toBe(input.id);
    expect(berikad!.label).toBe(input.label);
    expect(berikad!.figure).toEqual(input.figure);
    expect(berikad!.forklaring).toBe(input.forklaring);
  });

  it("muterar inte indata", () => {
    const input = nyckeltal("skuldsattning_per_m2_totalyta", 2941);
    berikaNyckeltal([input]);
    expect(input.status).toBe("okant");
    expect(input.benchmark).toBeUndefined();
  });
});
