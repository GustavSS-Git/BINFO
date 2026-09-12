import { describe, expect, it } from "vitest";
import { BENCHMARKS, bedomStatus, berikaNyckeltal, visasIHuvudanalys } from "./benchmarks";
import { KeyFigureIdSchema } from "./schema";
import type { KeyFigure, KeyFigureId, Status } from "@/types/analysis";

/** Rank for monotonicity assertions. 'okant' is excluded from ordering. */
const RANG: Record<Exclude<Status, "okant">, number> = {
  god: 0,
  acceptabel: 1,
  svag: 2,
  kritisk: 3,
};

/** The four figures BENCHMARKS.md cites a population reference point for. */
const MED_REFERENSPUNKT: KeyFigureId[] = [
  "arsavgift_per_m2_brf_yta",
  "skuldsattning_per_m2_brf_yta",
  "rantekanslighet",
  "energikostnad_per_m2_totalyta",
];

describe("BENCHMARKS", () => {
  it("täcker exakt de sju id:n som KeyFigureIdSchema tillåter", () => {
    expect(Object.keys(BENCHMARKS).sort()).toEqual([...KeyFigureIdSchema.options].sort());
  });

  it("varje post har en förklarande källa — tom sträng är aldrig ett svar", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      expect(b.source.length, id).toBeGreaterThan(0);
    }
  });

  it("graderade poster anger BENCHMARKS.md som ursprung till tröskelvärdena", () => {
    // Trösklarna är ett produktbeslut, inte statistik. Källsträngen ska säga
    // var beslutet är fattat — och får aldrig få trösklarna att se ut som
    // hämtade ur SCB-data.
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (b.riktning !== "informativ") {
        expect(b.source, id).toContain("BENCHMARKS.md");
        expect(b.source.toLowerCase(), id).not.toContain("overifierad");
      }
    }
  });

  it("poster med referenspunkt namnger den citerade källan i source", () => {
    for (const id of MED_REFERENSPUNKT) {
      expect(BENCHMARKS[id].source, id).toContain("Referenspunkt");
    }
  });

  it("graderade nyckeltal har band; informativa har varken band eller referensvärde", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (b.riktning === "informativ") {
        expect(b.band, id).toBeUndefined();
        expect(b.value, id).toBeUndefined();
        expect(b.label, id).toBeUndefined();
      } else {
        expect(b.band, id).toBeDefined();
        expect(b.band!.length, id).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("referensvärde finns bara för de fyra nyckeltal BENCHMARKS.md citerar ett för", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (MED_REFERENSPUNKT.includes(id as KeyFigureId)) {
        expect(typeof b.value, id).toBe("number");
        expect(typeof b.label, id).toBe("string");
      } else {
        expect(b.value, id).toBeUndefined();
        expect(b.label, id).toBeUndefined();
      }
    }
  });

  it("varje bandlista slutar i ett villkorslöst band — inget värde får falla igenom", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (!b.band) continue;
      const sista = b.band[b.band.length - 1]!;
      expect("jamforelse" in sista, id).toBe(false);
      for (const band of b.band.slice(0, -1)) {
        expect("jamforelse" in band, id).toBe(true);
      }
    }
  });

  it("sparande har exakt två band; övriga graderade har fyra", () => {
    // BENCHMARKS.md ger sparande bara God/Svag — ingen acceptabel, ingen
    // kritisk. Modellen måste kunna uttrycka det.
    expect(BENCHMARKS.sparande_per_m2_totalyta.band!.map((b) => b.status)).toEqual(["god", "svag"]);
    for (const id of [
      "arsavgift_per_m2_brf_yta",
      "skuldsattning_per_m2_totalyta",
      "skuldsattning_per_m2_brf_yta",
      "rantekanslighet",
      "energikostnad_per_m2_totalyta",
    ] as const) {
      expect(
        BENCHMARKS[id].band!.map((b) => b.status),
        id,
      ).toEqual(["god", "acceptabel", "svag", "kritisk"]);
    }
  });
});

describe("visasIHuvudanalys", () => {
  it("döljer exakt ett nyckeltal i huvudanalysen: avgiftsandelen", () => {
    const dolda = (Object.keys(BENCHMARKS) as KeyFigureId[]).filter((id) => !visasIHuvudanalys(id));
    expect(dolda).toEqual(["arsavgift_andel_av_rorelseintakter"]);
  });

  it("visar de övriga sex", () => {
    const visade = (Object.keys(BENCHMARKS) as KeyFigureId[]).filter((id) => visasIHuvudanalys(id));
    expect(visade.length).toBe(6);
    expect(visade).not.toContain("arsavgift_andel_av_rorelseintakter");
  });

  it("det dolda nyckeltalet finns kvar i tabellen och bedöms som vanligt", () => {
    // Att dölja ett kort är presentation; att inte gradera är bedömning. De
    // två sammanfaller för just det här talet idag, men är oberoende.
    expect(BENCHMARKS.arsavgift_andel_av_rorelseintakter).toBeDefined();
    expect(bedomStatus("arsavgift_andel_av_rorelseintakter", 90).status).toBe("okant");
  });

  it("skiljer visning från gradering — alla graderade nyckeltal visas, och ett visat får vara informativt", () => {
    for (const [id, b] of Object.entries(BENCHMARKS)) {
      if (b.riktning !== "informativ") {
        expect(visasIHuvudanalys(id as KeyFigureId), id).toBe(true);
      }
    }
  });
});

describe("kommentarer", () => {
  it("sparande bär BENCHMARKS.md:s förbehåll om planerat uttag ur kassan", () => {
    const k = BENCHMARKS.sparande_per_m2_totalyta.kommentar;
    expect(k).toBeDefined();
    expect(k).toMatch(/underhållsplan|vasentligaHandelser|väsentliga händelser/i);
  });

  it("energikostnad bär BENCHMARKS.md:s förbehåll om äldre hus", () => {
    const k = BENCHMARKS.energikostnad_per_m2_totalyta.kommentar;
    expect(k).toBeDefined();
    expect(k).toMatch(/1960/);
  });

  it("kommentarerna påverkar inte graderingen", () => {
    // Ett negativt sparande är fortfarande 'svag' — kommentaren är underlag
    // för senare steg, inte en tröskel.
    expect(bedomStatus("sparande_per_m2_totalyta", -50).status).toBe("svag");
    expect(bedomStatus("energikostnad_per_m2_totalyta", 600).status).toBe("kritisk");
  });
});

describe("bedomStatus", () => {
  it("ger 'okant' och inget benchmark när värdet saknas", () => {
    const r = bedomStatus("skuldsattning_per_m2_totalyta", null);
    expect(r.status).toBe("okant");
    expect(r.benchmark).toBeUndefined();
  });

  it("ger alltid 'okant' för det informativa nyckeltalet, oavsett värde", () => {
    // Avgiftsandelen graderas inte: en låg andel kan betyda betydande
    // hyresintäkter, inte sämre ekonomi. BENCHMARKS.md ger inga trösklar.
    for (const varde of [0, 28.9, 90, 98.7, 150]) {
      const r = bedomStatus("arsavgift_andel_av_rorelseintakter", varde);
      expect(r.status, `@ ${varde}`).toBe("okant");
      expect(r.benchmark, `@ ${varde}`).toBeUndefined();
    }
  });

  it("returnerar ett benchmark i kontraktets form när en referenspunkt finns", () => {
    const r = bedomStatus("rantekanslighet", 9.09);
    expect(r.benchmark).toBeDefined();
    expect(typeof r.benchmark!.value).toBe("number");
    expect(typeof r.benchmark!.label).toBe("string");
    expect(typeof r.benchmark!.source).toBe("string");
  });

  it("returnerar status utan benchmark när BENCHMARKS.md saknar referenspunkt", () => {
    // Hellre inget riktvärde än ett påhittat.
    for (const id of ["skuldsattning_per_m2_totalyta", "sparande_per_m2_totalyta"] as const) {
      const r = bedomStatus(id, 3000);
      expect(r.status, id).not.toBe("okant");
      expect(r.benchmark, id).toBeUndefined();
    }
  });

  describe("gränsvärden, band för band (första träffen vinner)", () => {
    // BENCHMARKS.md är motsägelsefull i ändpunkterna ("God < 500" följt av
    // "Acceptabel 500–1000"). Första träffen vinner avgör det entydigt, och
    // varje tröskeltal testas explicit på båda sidor.

    it("arsavgift_per_m2_brf_yta: 500 / 1000 / 1500", () => {
      const id = "arsavgift_per_m2_brf_yta";
      expect(bedomStatus(id, 499).status).toBe("god");
      expect(bedomStatus(id, 500).status).toBe("acceptabel");
      expect(bedomStatus(id, 999).status).toBe("acceptabel");
      expect(bedomStatus(id, 1000).status).toBe("acceptabel");
      expect(bedomStatus(id, 1001).status).toBe("svag");
      expect(bedomStatus(id, 1500).status).toBe("svag");
      expect(bedomStatus(id, 1501).status).toBe("kritisk");
    });

    it("skuldsattning_per_m2_totalyta: 2000 / 5000 / 10000", () => {
      const id = "skuldsattning_per_m2_totalyta";
      expect(bedomStatus(id, 1999).status).toBe("god");
      expect(bedomStatus(id, 2000).status).toBe("acceptabel");
      expect(bedomStatus(id, 4999).status).toBe("acceptabel");
      expect(bedomStatus(id, 5000).status).toBe("acceptabel");
      expect(bedomStatus(id, 5001).status).toBe("svag");
      expect(bedomStatus(id, 10000).status).toBe("svag");
      expect(bedomStatus(id, 10001).status).toBe("kritisk");
    });

    it("skuldsattning_per_m2_brf_yta: samma trösklar som totalytan", () => {
      const id = "skuldsattning_per_m2_brf_yta";
      expect(bedomStatus(id, 1999).status).toBe("god");
      expect(bedomStatus(id, 2000).status).toBe("acceptabel");
      expect(bedomStatus(id, 5000).status).toBe("acceptabel");
      expect(bedomStatus(id, 5001).status).toBe("svag");
      expect(bedomStatus(id, 10000).status).toBe("svag");
      expect(bedomStatus(id, 10001).status).toBe("kritisk");
    });

    it("sparande_per_m2_totalyta: noll räknas som svag", () => {
      // BENCHMARKS.md lämnar exakt 0 ospecificerat (God > 0, Svag < 0).
      // Beslutad läsning: inget sparande är inte gott sparande.
      const id = "sparande_per_m2_totalyta";
      expect(bedomStatus(id, 1).status).toBe("god");
      expect(bedomStatus(id, 0).status).toBe("svag");
      expect(bedomStatus(id, -1).status).toBe("svag");
    });

    it("sparande_per_m2_totalyta ger aldrig 'acceptabel' eller 'kritisk'", () => {
      for (const v of [-100000, -1, 0, 1, 64, 337, 100000]) {
        expect(["god", "svag"], `@ ${v}`).toContain(
          bedomStatus("sparande_per_m2_totalyta", v).status,
        );
      }
    });

    it("rantekanslighet: 2 / 5 / 15", () => {
      const id = "rantekanslighet";
      expect(bedomStatus(id, 1.9).status).toBe("god");
      expect(bedomStatus(id, 2).status).toBe("acceptabel");
      expect(bedomStatus(id, 5).status).toBe("acceptabel");
      expect(bedomStatus(id, 5.1).status).toBe("svag");
      expect(bedomStatus(id, 15).status).toBe("svag");
      expect(bedomStatus(id, 15.1).status).toBe("kritisk");
    });

    it("energikostnad_per_m2_totalyta: 100 / 250 / 500", () => {
      const id = "energikostnad_per_m2_totalyta";
      expect(bedomStatus(id, 99).status).toBe("god");
      expect(bedomStatus(id, 100).status).toBe("acceptabel");
      expect(bedomStatus(id, 250).status).toBe("acceptabel");
      expect(bedomStatus(id, 251).status).toBe("svag");
      expect(bedomStatus(id, 500).status).toBe("svag");
      expect(bedomStatus(id, 501).status).toBe("kritisk");
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
      // Med BENCHMARKS.md:s tvåbandsmodell är båda 'god' — inversionen är
      // utesluten, men skillnaden syns inte längre i statusen.
      const riksbyggen = bedomStatus("sparande_per_m2_totalyta", 296).status;
      const sbc = bedomStatus("sparande_per_m2_totalyta", 141).status;
      expect(RANG[sbc as Exclude<Status, "okant">]).toBeGreaterThanOrEqual(
        RANG[riksbyggen as Exclude<Status, "okant">],
      );
      expect(sbc).toBe("god");
      expect(riksbyggen).toBe("god");
    });
  });

  describe("monotonicitet över hela verifierade korpusen", () => {
    // Värden från fixtures/answer-key — sex föreningar, fyra förvaltare.
    const korpus: Partial<Record<KeyFigureId, number[]>> = {
      arsavgift_per_m2_brf_yta: [357, 784, 834, 984, 1006, 1275],
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

    it("korpusen ger de förväntade statusarna för de nya trösklarna", () => {
      expect(
        [357, 784, 834, 984, 1006, 1275].map(
          (v) => bedomStatus("arsavgift_per_m2_brf_yta", v).status,
        ),
      ).toEqual(["god", "acceptabel", "acceptabel", "acceptabel", "svag", "svag"]);
      expect(
        [3, 3.2, 3.82, 8.7, 9.09, 16.85].map((v) => bedomStatus("rantekanslighet", v).status),
      ).toEqual(["acceptabel", "acceptabel", "acceptabel", "svag", "svag", "kritisk"]);
      expect(
        [194, 219, 238, 250, 295, 301].map(
          (v) => bedomStatus("energikostnad_per_m2_totalyta", v).status,
        ),
      ).toEqual(["acceptabel", "acceptabel", "acceptabel", "acceptabel", "svag", "svag"]);
    });
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

  it("fyller i status och benchmark för graderade nyckeltal med referenspunkt", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("rantekanslighet", 3.2)]);
    expect(berikad!.status).toBe("acceptabel");
    expect(berikad!.benchmark).toBeDefined();
  });

  it("fyller i status men inget benchmark när referenspunkt saknas", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("skuldsattning_per_m2_totalyta", 2941)]);
    expect(berikad!.status).toBe("acceptabel");
    expect(berikad!.benchmark).toBeUndefined();
  });

  it("graderar numera avgiftsnivån, som BENCHMARKS.md kräver", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("arsavgift_per_m2_brf_yta", 984)]);
    expect(berikad!.status).toBe("acceptabel");
    expect(berikad!.benchmark).toBeDefined();
  });

  it("lämnar det informativa nyckeltalet på 'okant' utan benchmark", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("arsavgift_andel_av_rorelseintakter", 90)]);
    expect(berikad!.status).toBe("okant");
    expect(berikad!.benchmark).toBeUndefined();
  });

  it("ger 'okant' när figuren saknar värde", () => {
    const [berikad] = berikaNyckeltal([nyckeltal("rantekanslighet", null)]);
    expect(berikad!.status).toBe("okant");
  });

  it("kastar ett gammalt benchmark som inte längre gäller", () => {
    const input: KeyFigure = {
      ...nyckeltal("skuldsattning_per_m2_totalyta", 2941),
      benchmark: { value: 1, label: "Gammalt", source: "Gammal källa" },
    };
    const [berikad] = berikaNyckeltal([input]);
    expect(berikad!.benchmark).toBeUndefined();
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
