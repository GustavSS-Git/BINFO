import { describe, expect, it } from "vitest";
import type { PrisInput, PropertyInput } from "@/types/analysis";
import { assembleraAnalys, tillPrisInput } from "@/lib/analysis/assemble";
import type { AnalysJudgement } from "@/lib/analysis/analyze";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { ModellPrisdatakalla, konfidensUtanPostnummer } from "@/lib/analysis/prisdata";
import { PrisuppskattningResultatSchema } from "@/lib/analysis/schema";
import { hamtaPrisuppskattning, prisuppskattning } from "./prisuppskattning";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "./__fakes__/konto";
import { skapaBehorighet, STANDARD_POLICY, type Policy } from "./behorighet";
import type { Kontext } from "./kontext";
import {
  KVOT_MEDDELANDE,
  kvotNyckel,
  PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME,
  TIMME_SEK,
} from "./kvot";
import type { Anropare } from "./portar";

const NU = new Date("2026-10-09T12:00:00.000Z");

const analys: AnalysJudgement = {
  betyg: "C",
  betygMotivering: "Testbedömning.",
  rodaFlaggor: [],
  fragor: [],
};

const propertyInput: PropertyInput = {
  kind: "bostadsratt",
  utgangspris: 4_950_000,
  boarea: 62,
  antalRum: 3,
  manadsavgift: 4200,
  andelstal: 2.1,
  orgnr: "769612-3456",
  adress: "Kastanjevägen 4",
  postnummer: "11857",
  ort: "Stockholm",
  vaning: 3,
  byggar: 1962,
  hiss: "ja",
  balkong: "nej",
  avgiftInkluderar: { varme: "ja", vatten: "ja", el: "nej", bredband: "ja", tv: "nej" },
  antalPersoner: 2,
};

const prisInput: PrisInput = tillPrisInput(propertyInput);

/** De värderingsfält den fristående priskollen och den fullständiga
 *  analysen måste vara överens om. */
const VARDERINGSFALT = [
  "externVardering",
  "varderingsunderlag",
  "budpremie",
  "konfidens",
  "slutsats",
  "avvikelseMotVardering",
  "utgangspris",
  "prisPerM2",
] as const;

describe("prisuppskattning — paritet med den fullständiga analysen", () => {
  // Stockholms kommun (områdesmodellen), övriga länet (Solna), utanför länet
  // (Göteborg), samt felformaterat och tomt postnummer (ingen värdering).
  const fall: Array<{ namn: string; postnummer: string }> = [
    { namn: "Stockholms kommun (Södermalm)", postnummer: "11857" },
    { namn: "Stockholms län (Solna)", postnummer: "16900" },
    { namn: "utanför länet (Göteborg)", postnummer: "40010" },
    { namn: "felformaterat postnummer", postnummer: "115-32" },
    { namn: "tomt postnummer", postnummer: "" },
  ];

  for (const { namn, postnummer } of fall) {
    it(`ger exakt samma värderingsfält som assembleraAnalys — ${namn}`, async () => {
      const input = { ...propertyInput, postnummer };
      const full = await assembleraAnalys({
        extraction: extraktion,
        input,
        prisdatakalla: new ModellPrisdatakalla(),
        analys,
      });
      const fristaende = await prisuppskattning(tillPrisInput(input), { nu: NU });

      for (const falt of VARDERINGSFALT) {
        expect(fristaende.prisanalys[falt], falt).toEqual(full.prisanalys[falt]);
      }
      // BRF-lagret finns bara i den fullständiga analysen.
      expect("andelAvForeningensSkuld" in fristaende.prisanalys).toBe(false);
      expect(PrisuppskattningResultatSchema.safeParse(fristaende).success).toBe(true);
    });
  }

  it("ger en värdering i alla tre täckningsnivåer", async () => {
    for (const [postnummer, tackning] of [
      ["11857", "stockholm"],
      ["16900", "lan"],
      ["40010", "utanfor_lan"],
    ] as const) {
      const r = await prisuppskattning({ ...prisInput, postnummer }, { nu: NU });
      expect(r.prisanalys.externVardering?.value).not.toBeNull();
      expect(r.prisanalys.varderingsunderlag?.tackning).toBe(tackning);
      expect(r.prisanalys.konfidens.niva).not.toBe("hog");
    }
  });

  it("ogiltigt postnummer: ingen externVardering, konfidens 'lag' och en förklarande slutsats", async () => {
    const r = await prisuppskattning({ ...prisInput, postnummer: "1234" }, { nu: NU });
    expect("externVardering" in r.prisanalys).toBe(false);
    expect(r.prisanalys.konfidens).toEqual(konfidensUtanPostnummer());
    expect(r.prisanalys.slutsats).toMatch(/Postnumret saknas eller är ogiltigt/);
  });
});

describe("prisuppskattning — resultatets form", () => {
  it("validerar mot PrisuppskattningResultatSchema och ekar input", async () => {
    const r = await prisuppskattning(prisInput, { nu: NU });
    expect(PrisuppskattningResultatSchema.safeParse(r).success).toBe(true);
    expect(r.schemaVersion).toBe("1.0.0");
    expect(r.skapad).toBe(NU.toISOString());
    expect(r.input).toEqual(prisInput);
  });

  it("utan utgångspris: värdering men ingen avvikelse, inget utgangspris och inget prisPerM2", async () => {
    const { utgangspris: _utan, ...utanPris } = prisInput;
    const r = await prisuppskattning(utanPris, { nu: NU });
    const med = await prisuppskattning(prisInput, { nu: NU });

    expect(PrisuppskattningResultatSchema.safeParse(r).success).toBe(true);
    expect("utgangspris" in r.prisanalys).toBe(false);
    expect("prisPerM2" in r.prisanalys).toBe(false);
    expect("avvikelseMotVardering" in r.prisanalys).toBe(false);
    // Samma värdering, samma underlag, samma konfidens — bara jämförelsen saknas.
    expect(r.prisanalys.externVardering).toEqual(med.prisanalys.externVardering);
    expect(r.prisanalys.varderingsunderlag).toEqual(med.prisanalys.varderingsunderlag);
    expect(r.prisanalys.konfidens).toEqual(med.prisanalys.konfidens);
    expect(r.prisanalys.slutsats).toMatch(/Inget utgångspris har angetts/);
    expect(r.prisanalys.slutsats).not.toMatch(/intervall/);
  });

  it("utan utgångspris och utan giltigt postnummer: slutsatsen nämner inget utgångspris", async () => {
    const { utgangspris: _utan, ...utanPris } = prisInput;
    const r = await prisuppskattning({ ...utanPris, postnummer: "" }, { nu: NU });
    expect(r.prisanalys.slutsats).toMatch(/Postnumret saknas eller är ogiltigt/);
    expect(r.prisanalys.slutsats).not.toMatch(/utgångspris/);
  });

  it("använder en injicerad prisdatakälla", async () => {
    const kalla = {
      hamtaVardering: async () => ({
        value: 5_000_000,
        unit: "kr" as const,
        source: "extern" as const,
        leverantor: "Testleverantör",
      }),
      hamtaForsaljningarIForeningen: async () => [],
      hamtaOmradeMedian: async () => null,
    };
    const r = await prisuppskattning(prisInput, { prisdatakalla: kalla, nu: NU });
    expect(r.prisanalys.externVardering?.leverantor).toBe("Testleverantör");
    expect(r.prisanalys.avvikelseMotVardering).toBe(-1);
  });

  it("skickar ingen orgnr eller ort till prisdatakällan (den fristående priskollen känner inte föreningen)", async () => {
    let sedd: unknown;
    const kalla = {
      hamtaVardering: async (f: unknown) => {
        sedd = f;
        return null;
      },
      hamtaForsaljningarIForeningen: async () => [],
      hamtaOmradeMedian: async () => null,
    };
    await prisuppskattning(prisInput, { prisdatakalla: kalla, nu: NU });
    expect(sedd).not.toHaveProperty("orgnr");
    expect(sedd).not.toHaveProperty("ort");
  });
});

describe("hamtaPrisuppskattning — serverfunktionens indatavalidering", () => {
  const giltig = {
    boarea: 62,
    antalRum: 3,
    manadsavgift: 4200,
    postnummer: "118 57",
    hiss: "ja",
    balkong: "nej",
  };

  it("returnerar ett resultat för giltig indata (postnummer med blanksteg godtas)", async () => {
    const svar = await hamtaPrisuppskattning(giltig, { nu: NU });
    expect(svar.ok).toBe(true);
    if (svar.ok) {
      expect(svar.resultat.prisanalys.externVardering?.value).not.toBeNull();
      expect(svar.resultat.prisanalys.varderingsunderlag?.omrade).toBe("Södermalm");
    }
  });

  it.each([
    ["fyra siffror", "1234"],
    ["bindestreck", "115-32"],
    ["bokstäver", "115a2"],
    ["tom sträng", ""],
  ])("avvisar ett felformaterat postnummer (%s) med ett köparsäkert fel", async (_namn, pnr) => {
    const svar = await hamtaPrisuppskattning({ ...giltig, postnummer: pnr });
    expect(svar).toEqual({
      ok: false,
      errorCode: "validation",
      errorMessage: expect.stringMatching(/Postnumret måste bestå av fem siffror/),
    });
  });

  it("avvisar ett postnummer som inte är en sträng", async () => {
    const svar = await hamtaPrisuppskattning({ ...giltig, postnummer: 11857 });
    expect(svar.ok).toBe(false);
    if (!svar.ok) expect(svar.errorMessage).toMatch(/Postnumret/);
  });

  it("avvisar negativ boarea", async () => {
    const svar = await hamtaPrisuppskattning({ ...giltig, boarea: -10 });
    expect(svar).toEqual({
      ok: false,
      errorCode: "validation",
      errorMessage: expect.stringMatching(/ogiltiga/),
    });
  });

  it.each([
    ["null", null],
    ["en sträng", "hej"],
    ["okänt fält", { ...giltig, orgnr: "769612-3456" }],
    ["ogiltig Tristate", { ...giltig, hiss: "kanske" }],
    ["utgångspris 0", { ...giltig, utgangspris: 0 }],
  ])("avvisar ogiltig indata (%s)", async (_namn, data) => {
    const svar = await hamtaPrisuppskattning(data);
    expect(svar.ok).toBe(false);
    if (!svar.ok) expect(svar.errorCode).toBe("validation");
  });

  it("felmeddelandet läcker aldrig Zod-detaljer", async () => {
    const svar = await hamtaPrisuppskattning({ ...giltig, boarea: -10 });
    if (svar.ok) throw new Error("väntade valideringsfel");
    expect(svar.errorMessage).not.toMatch(/number|expected|too_small|greater than/i);
  });
});

describe("hamtaPrisuppskattning — behörighet och kvot (anropare)", () => {
  const giltig = {
    boarea: 62,
    antalRum: 3,
    manadsavgift: 4200,
    postnummer: "11857",
    hiss: "ja",
    balkong: "nej",
  };
  const IP_HASH = "cd".repeat(32);
  const ENHET = "BBBBBBBBBBBBBBBBBBBBBB";

  function anropare(
    konto: FakeKontoDatabas,
    policy: Partial<Policy> = {},
    kontext: Partial<Kontext> = {},
  ): Anropare {
    return {
      kontext: { enhetId: ENHET, principalId: null, ipHash: IP_HASH, ...kontext },
      konto,
      behorighet: skapaBehorighet({ ...STANDARD_POLICY, ...policy }),
    };
  }

  function anvant(konto: FakeKontoDatabas, nyckel: string): number {
    return [...konto.kvot.values()]
      .filter((r) => r.nyckel === nyckel)
      .reduce((summa, r) => summa + r.antal, 0);
  }

  it("nekad behörighet (prisuppskattning) → behorighet, utan att röra kvoten", async () => {
    const konto = skapaFakeKontoDatabas();
    const svar = await hamtaPrisuppskattning(giltig, {
      nu: NU,
      anropare: anropare(konto, { prisuppskattning: () => false }),
    });
    expect(svar).toEqual({
      ok: false,
      errorCode: "behorighet",
      errorMessage: "Du har inte tillgång till den här funktionen just nu.",
    });
    expect(konto.kvot.size).toBe(0);
  });

  it("räknar en användning per anrop på IP-nyckeln, och värderar som vanligt", async () => {
    const konto = skapaFakeKontoDatabas();
    const svar = await hamtaPrisuppskattning(giltig, { nu: NU, anropare: anropare(konto) });
    expect(svar.ok).toBe(true);
    expect(anvant(konto, kvotNyckel("prisuppskattning", "ip", IP_HASH))).toBe(1);
  });

  it("kvoten slut → kvot med prisuppskattningens meddelande, före all validering", async () => {
    const konto = skapaFakeKontoDatabas();
    const nyckel = kvotNyckel("prisuppskattning", "ip", IP_HASH);
    for (let i = 0; i < PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME; i++) {
      await konto.taKvot(nyckel, TIMME_SEK, PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME);
    }
    const forvantat = {
      ok: false,
      errorCode: "kvot",
      errorMessage: KVOT_MEDDELANDE.prisuppskattning,
    };
    expect(await hamtaPrisuppskattning(giltig, { nu: NU, anropare: anropare(konto) })).toEqual(
      forvantat,
    );
    // Även skräpdata räknas mot (och stoppas av) kvoten.
    expect(await hamtaPrisuppskattning(null, { anropare: anropare(konto) })).toEqual(forvantat);
  });

  it("utan IP används enhetens nyckel", async () => {
    const konto = skapaFakeKontoDatabas();
    await hamtaPrisuppskattning(giltig, {
      nu: NU,
      anropare: anropare(konto, {}, { ipHash: null }),
    });
    expect(anvant(konto, kvotNyckel("prisuppskattning", "enhet", ENHET))).toBe(1);
  });
});
