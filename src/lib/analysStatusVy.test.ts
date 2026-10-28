import { describe, expect, it } from "vitest";
import { STEG_TEXT } from "./analysStatusCopy";
import {
  ATERANVAND_TEXT,
  RAPPORTSTEG_TEXT,
  SKANNAD_UPPTACKT_TEXT,
  VANTAR_PA_RAPPORT_TEXT,
  DESIGNSTEG,
  arSkannadRapport,
  designAndel,
  designSteg,
  klarNotis,
  stegTextFor,
  vantaNotiser,
  vantskarmLiknande,
  vantskarmRubrikrad,
  type StatusRapportSteg,
  type StatusTextlager,
} from "./analysStatusVy";

describe("stegTextFor", () => {
  it("mappar varje rapportsteg till sin svenska text", () => {
    expect(stegTextFor({ stage: "uploaded", rapportSteg: "identifiering" })).toBe(
      "Identifierar föreningen…",
    );
    expect(stegTextFor({ stage: "uploaded", rapportSteg: "transkribering" })).toBe(
      "Läser av de skannade sidorna…",
    );
    expect(stegTextFor({ stage: "uploaded", rapportSteg: "grundning" })).toBe(
      "Läser årsredovisningen…",
    );
    expect(stegTextFor({ stage: "extracting", rapportSteg: "extraktion" })).toBe(
      "Hämtar de sju nyckeltalen…",
    );
    expect(stegTextFor({ stage: "judging", rapportSteg: "bedomning" })).toBe(
      "Analyserar föreningens ekonomi…",
    );
    expect(RAPPORTSTEG_TEXT.klar).toBe(STEG_TEXT.complete);
  });

  it("faller tillbaka på den gamla stage-texten utan rapportSteg", () => {
    expect(stegTextFor({ stage: "extracting" })).toBe(STEG_TEXT.extracting);
    expect(stegTextFor({ stage: "uploaded", textlager: "saknas" })).toBe(STEG_TEXT.uploaded);
  });
});

const lagen = (status: Parameters<typeof designSteg>[0]) => designSteg(status).map((r) => r.lage);

describe("designSteg: de sex stegen på väntskärmen", () => {
  it("har sex steg med rätt rubriker", () => {
    expect(DESIGNSTEG).toEqual([
      "Läser in årsredovisningen",
      "Hämtar de sju nyckeltalen",
      "Jämför dina uppgifter med årsredovisningen",
      "Räknar på avgiften de närmaste två åren",
      "Justerar värderingen för föreningens ekonomi",
      "Skriver frågor till styrelsen",
    ]);
    expect(designSteg({ stage: "uploaded" }).map((r) => r.label)).toEqual([...DESIGNSTEG]);
  });

  it.each<[StatusRapportSteg, number]>([
    ["identifiering", 0],
    ["transkribering", 0],
    ["grundning", 0],
    ["extraktion", 1],
    ["bedomning", 2],
    ["klar", 2],
  ])(
    "rapportsteg %s gör steg %i aktivt, tidigare klara och resten väntande",
    (rapportSteg, aktivt) => {
      const l = lagen({ stage: "uploaded", rapportSteg });
      expect(l).toHaveLength(6);
      l.forEach((lage, i) => {
        expect(lage).toBe(i < aktivt ? "klar" : i === aktivt ? "pagar" : "vantar");
      });
      // Steg 4–6 körs först när rapporten läses: aldrig klara eller pågående här.
      expect(l.slice(3)).toEqual(["vantar", "vantar", "vantar"]);
      expect(designAndel({ stage: "uploaded", rapportSteg })).toBeCloseTo(aktivt / 6);
    },
  );

  it.each<StatusTextlager | undefined>(["ok", "saknas", "trasigt", undefined])(
    "textlager %s ändrar inte stegen (trasigt räknar inget transkriberingssteg)",
    (textlager) => {
      const steg = (rapportSteg: StatusRapportSteg) => ({
        stage: "uploaded" as const,
        textlager,
        rapportSteg,
      });
      expect(designAndel(steg("grundning"))).toBe(0);
      expect(designAndel(steg("extraktion"))).toBeCloseTo(1 / 6);
      expect(designAndel(steg("bedomning"))).toBeCloseTo(2 / 6);
      expect(lagen(steg("extraktion"))).toEqual([
        "klar",
        "pagar",
        "vantar",
        "vantar",
        "vantar",
        "vantar",
      ]);
    },
  );

  it.each([
    ["uploaded", 0],
    ["extracting", 1],
    ["judging", 2],
    ["complete", 2],
  ] as const)("äldre stage %s utan rapportSteg ger steg %i", (stage, aktivt) => {
    const l = lagen({ stage });
    expect(l[aktivt]).toBe("pagar");
    expect(l.filter((x) => x === "klar")).toHaveLength(aktivt);
    expect(designAndel({ stage })).toBeCloseTo(aktivt / 6);
  });

  it("rapportSteg går före stage", () => {
    expect(lagen({ stage: "uploaded", rapportSteg: "extraktion" })[1]).toBe("pagar");
  });
});

describe("vantskarmRubrikrad", () => {
  it("sätter ihop adress och förening, med saknade delar utelämnade", () => {
    expect(
      vantskarmRubrikrad({
        adress: "Baltzar von Platens gata 6",
        foreningNamn: "Brf Pontonjären 3",
      }),
    ).toBe("Baltzar von Platens gata 6 · Brf Pontonjären 3");
    expect(vantskarmRubrikrad({ adress: "Storgatan 1", foreningNamn: null })).toBe("Storgatan 1");
    expect(vantskarmRubrikrad({ adress: null, foreningNamn: "Brf X" })).toBe("Brf X");
    expect(vantskarmRubrikrad({ adress: " ", foreningNamn: undefined })).toBeNull();
  });
});

describe("vantskarmLiknande", () => {
  it("avrundar som överallt och nämner utgångspriset bara när det finns", () => {
    expect(vantskarmLiknande({ liknande: { varde: 5_681_607 }, utgangspris: 4_995_000 })).toEqual({
      varde: "ca 5,7 mkr",
      text: "Utan hänsyn till föreningen. Utgångspris 5,0 mkr. Värdet med föreningens ekonomi inräknad kommer i rapporten.",
    });
    expect(vantskarmLiknande({ liknande: { varde: 5_681_607 }, utgangspris: null })?.text).toBe(
      "Utan hänsyn till föreningen. Värdet med föreningens ekonomi inräknad kommer i rapporten.",
    );
  });

  it("utelämnar hela blocket utan värdering", () => {
    expect(vantskarmLiknande({ liknande: null, utgangspris: 5_000_000 })).toBeNull();
    expect(vantskarmLiknande({})).toBeNull();
  });
});

describe("vantaNotiser", () => {
  it("visar skannad-notisen bara när textlagret saknas", () => {
    expect(vantaNotiser({ stage: "uploaded", textlager: "saknas" }).map((n) => n.text)).toEqual([
      SKANNAD_UPPTACKT_TEXT,
    ]);
    expect(vantaNotiser({ stage: "uploaded", textlager: "ok" })).toEqual([]);
    expect(vantaNotiser({ stage: "uploaded", textlager: "trasigt" })).toEqual([]);
    expect(vantaNotiser({ stage: "uploaded" })).toEqual([]);
  });

  it("visar att samma rapport analyseras just nu", () => {
    expect(vantaNotiser({ stage: "uploaded", vantarPaRapport: true }).map((n) => n.text)).toEqual([
      VANTAR_PA_RAPPORT_TEXT,
    ]);
    expect(vantaNotiser({ stage: "uploaded", vantarPaRapport: false })).toEqual([]);
  });

  it("kan visa båda", () => {
    expect(
      vantaNotiser({ stage: "uploaded", textlager: "saknas", vantarPaRapport: true }),
    ).toHaveLength(2);
  });

  it("har exakt den överenskomna svenska texten", () => {
    expect(SKANNAD_UPPTACKT_TEXT).toBe(
      "Skannad årsredovisning upptäckt – analysen tar lite längre tid.",
    );
    expect(VANTAR_PA_RAPPORT_TEXT).toBe(
      "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt.",
    );
  });
});

describe("klarNotis", () => {
  it("visas bara för en återanvänd rapport", () => {
    expect(klarNotis({ ateranvand: true })?.text).toBe(ATERANVAND_TEXT);
    expect(ATERANVAND_TEXT).toBe(
      "Den här årsredovisningen var redan analyserad – din analys är klar direkt.",
    );
    expect(klarNotis({ ateranvand: false })).toBeUndefined();
    expect(klarNotis({})).toBeUndefined();
  });
});

describe("arSkannadRapport", () => {
  it("är sant bara för textlager 'saknas'", () => {
    expect(arSkannadRapport({ textlager: "saknas" })).toBe(true);
    expect(arSkannadRapport({ textlager: "trasigt" })).toBe(false);
    expect(arSkannadRapport({ textlager: "ok" })).toBe(false);
    expect(arSkannadRapport({})).toBe(false);
  });
});
