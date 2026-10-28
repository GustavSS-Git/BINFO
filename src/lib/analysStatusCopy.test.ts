import { describe, expect, it } from "vitest";
import {
  arAnalysHittadesInteFel,
  FELKOD_INNEHALL,
  kontaktDelar,
  STEG_ORDNING,
  STEG_TEXT,
  stegAndel,
  type AnalysErrorCode,
  type AnalysStage,
} from "./analysStatusCopy";

const ALLA_STEG: AnalysStage[] = ["uploaded", "extracting", "judging", "complete"];
// `satisfies Record<AnalysErrorCode, true>` makes this list exhaustive at
// compile time: a code added to the union without being added here fails
// typecheck, so the tests below really cover every code.
const FELKODER_KONTROLL = {
  scanned_pdf: true,
  cost_cap: true,
  daily_cap: true,
  validation: true,
  saknar_rantekanslighet: true,
  versionskonflikt: true,
  kvot: true,
  behorighet: true,
  unknown: true,
} satisfies Record<AnalysErrorCode, true>;
const ALLA_FELKODER = Object.keys(FELKODER_KONTROLL) as AnalysErrorCode[];

describe("STEG_TEXT", () => {
  it("har text för varje steg, ingen tom sträng", () => {
    for (const steg of ALLA_STEG) {
      expect(STEG_TEXT[steg].length).toBeGreaterThan(0);
    }
  });

  it("lovar aldrig att det går snabbt", () => {
    for (const text of Object.values(STEG_TEXT)) {
      expect(text.toLowerCase()).not.toMatch(/snart|några sekunder|en liten stund|en minut\b/);
    }
  });

  it("STEG_ORDNING täcker exakt samma steg som STEG_TEXT, en gång var", () => {
    expect([...STEG_ORDNING].sort()).toEqual([...ALLA_STEG].sort());
  });
});

describe("stegAndel", () => {
  it("ökar strikt monotont genom stegordningen", () => {
    const andelar = STEG_ORDNING.map(stegAndel);
    for (let i = 1; i < andelar.length; i++) {
      expect(andelar[i]).toBeGreaterThan(andelar[i - 1]!);
    }
  });

  it("når 100% vid sista steget", () => {
    expect(stegAndel(STEG_ORDNING.at(-1)!)).toBe(1);
  });

  it("är aldrig 0 (ens första steget har gjorts något)", () => {
    expect(stegAndel(STEG_ORDNING.at(0)!)).toBeGreaterThan(0);
  });
});

describe("FELKOD_INNEHALL", () => {
  it("har innehåll för exakt varje AnalysErrorCode, ingen fallthrough", () => {
    expect(Object.keys(FELKOD_INNEHALL).sort()).toEqual([...ALLA_FELKODER].sort());
  });

  it("varje felkod har en ifylld rubrik, förklaring och åtgärd", () => {
    for (const kod of ALLA_FELKODER) {
      const innehall = FELKOD_INNEHALL[kod];
      expect(innehall.rubrik.length).toBeGreaterThan(0);
      expect(innehall.forklaring.length).toBeGreaterThan(0);
      expect(innehall.atgard.length).toBeGreaterThan(0);
    }
  });

  it("scanned_pdf säger inte att skanningar stöds inte, och pekar mot en digital version", () => {
    const { forklaring, atgard } = FELKOD_INNEHALL.scanned_pdf;
    expect(forklaring).toBe("Vi kunde inte läsa av den här årsredovisningen tillförlitligt.");
    expect(atgard).toBe(
      "Försök med en digital version (med textlager) om du kan få en från mäklaren eller styrelsen.",
    );
    expect(`${forklaring} ${atgard}`).not.toMatch(/går inte att läsa maskinellt|var åttonde/i);
  });

  it("daily_cap och cost_cap läses som 'det är vi, inte du'", () => {
    expect(FELKOD_INNEHALL.daily_cap.forklaring).toMatch(/inte.*din|beror inte på dig/i);
    expect(FELKOD_INNEHALL.cost_cap.forklaring).toMatch(/inte.*din|vår sida|beror inte på dig/i);
  });

  it("validation pekar tillbaka mot formuläret", () => {
    expect(FELKOD_INNEHALL.validation.atgard).toMatch(/formulär/i);
  });

  it("kvot läses som 'det är inte du' och säger åt köparen att vänta", () => {
    expect(FELKOD_INNEHALL.kvot.forklaring).toMatch(/beror inte på din/i);
    expect(FELKOD_INNEHALL.kvot.atgard).toMatch(/försök igen senare/i);
  });

  it("versionskonflikt läses som 'det är vi, inte du' och pekar tillbaka mot formuläret", () => {
    expect(FELKOD_INNEHALL.versionskonflikt.forklaring).toMatch(/inte.*din|beror inte på dig/i);
    expect(FELKOD_INNEHALL.versionskonflikt.atgard).toMatch(/formulär/i);
  });
});

describe("arAnalysHittadesInteFel", () => {
  it("känner igen ett fel med name AnalysHittadesInteError", () => {
    const fel = new Error("Ingen analys hittades med id x.");
    fel.name = "AnalysHittadesInteError";
    expect(arAnalysHittadesInteFel(fel)).toBe(true);
  });

  it("returnerar false för andra fel", () => {
    expect(arAnalysHittadesInteFel(new Error("nätverksfel"))).toBe(false);
  });

  it("returnerar false för icke-Error-värden", () => {
    expect(arAnalysHittadesInteFel("sträng")).toBe(false);
    expect(arAnalysHittadesInteFel(null)).toBe(false);
    expect(arAnalysHittadesInteFel(undefined)).toBe(false);
  });
});

describe("kontaktDelar", () => {
  it("gör frasen till en mailto-länk när adressen finns", () => {
    expect(
      kontaktDelar("Kvarstår felet, hör av dig till oss så tittar vi på det.", "a@b.se"),
    ).toEqual([
      "Kvarstår felet, ",
      { href: "mailto:a@b.se", text: "hör av dig till oss" },
      " så tittar vi på det.",
    ]);
    expect(kontaktDelar("Försök igen. Kvarstår det, kontakta oss.", "a@b.se")).toContainEqual({
      href: "mailto:a@b.se",
      text: "kontakta oss",
    });
  });

  it("utan adress tas meningen med kontaktfrasen bort, så att inget löfte lämnas", () => {
    expect(kontaktDelar("Försök igen om en stund. Kvarstår det, kontakta oss.", null)).toEqual([
      "Försök igen om en stund.",
    ]);
    expect(kontaktDelar("Ingen länk här.", null)).toEqual(["Ingen länk här."]);
  });

  it("varje felkods åtgärd är ren text utan kontaktlöfte när adressen saknas", () => {
    for (const kod of ALLA_FELKODER) {
      const delar = kontaktDelar(FELKOD_INNEHALL[kod].atgard, null);
      expect(delar.every((d) => typeof d === "string")).toBe(true);
      expect(delar.join("")).not.toMatch(/hör av dig|kontakta oss/i);
    }
  });
});
