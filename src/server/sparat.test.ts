import { describe, expect, it } from "vitest";
import type { PrisInput, PropertyInput } from "@/types/analysis";
import type { KalkylSammanfattning, KalkylUnderlag } from "@/lib/kalkyl/underlag";
import { skapaFakeKontoDatabas, type FakeKontoDatabas } from "./__fakes__/konto";
import type { Kontext } from "./kontext";
import { PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME } from "./kvot";
import {
  KontoAtkomstError,
  MAX_SPARADE_PER_TYP,
  hamtaMinaUppgifter,
  hamtaSparadKalkyl,
  hamtaSparadVardering,
  kravAgare,
  listaSparat,
  raderaSparadKalkyl,
  raderaSparadVardering,
  sparaKalkyl,
  sparaVardering,
  taBortAnalysFranLista,
  type KalkylBeroenden,
  type SparatBeroenden,
} from "./sparat";

const prisInput: PrisInput = {
  boarea: 62,
  antalRum: 3,
  manadsavgift: 4200,
  postnummer: "11857",
  vaning: 3,
  byggar: 1962,
  hiss: "ja",
  balkong: "nej",
  utgangspris: 4_950_000,
};

const underlag: KalkylUnderlag = {
  version: 2,
  pris: 3_000_000,
  rantaProcent: 3.6,
  manadsavgift: 4200,
  avgiftInkluderar: { varme: "ja", vatten: "ja", el: "nej", bredband: "ja", tv: "nej" },
  antalLantagare: 1,
  inkomst1: 600_000,
  antalPersoner: 2,
  antalVuxna: 1,
  barn: [],
  rantestressPp: 0,
  kalkylrantaProcent: 7,
  egnaKostnader: {},
};

const sammanfattning: KalkylSammanfattning = {
  totalPerManad: 12_345,
  belaningsgradProcent: 60,
  amorteringstaktProcent: 1,
  kvarAttLevaPaKalp: null,
};

const kb: KalkylBeroenden = {
  beraknaSammanfattning: () => sammanfattning,
  regelversion: "regler-test-1",
};

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";

function konto(principalId: string, ipHash = "ip-1"): Kontext {
  return {
    enhetId: "enhet-" + principalId,
    principalId,
    ipHash,
    konto: { authUserId: "auth-" + principalId, epost: principalId + "@example.se" },
  };
}
const anonym: Kontext = { enhetId: "e", principalId: null, ipHash: "ip-1" };

/** Two accounts (A, B) in one store. */
async function bygg() {
  const db = skapaFakeKontoDatabas({ nu: () => new Date("2026-10-13T12:00:00Z") });
  const a = (await db.sakerstallKontoPrincipal("ua", null)).principalId;
  const b = (await db.sakerstallKontoPrincipal("ub", null)).principalId;
  const beroenden = (kontext: Kontext): SparatBeroenden => ({
    kontext,
    db,
    nu: () => new Date("2026-10-13T12:00:00Z"),
  });
  return { db, a, b, bA: beroenden(konto(a)), bB: beroenden(konto(b)), bAnonym: beroenden(anonym) };
}

async function sparaEn(b: SparatBeroenden) {
  const r = await sparaVardering(b, { prisInput, etikett: "  Min lägenhet  " });
  if (!r.ok) throw new Error(r.meddelande);
  return r.vardering;
}
async function sparaEnKalkyl(b: SparatBeroenden) {
  const r = await sparaKalkyl(b, { underlag, etikett: "Kalkyl 1" }, kb);
  if (!r.ok) throw new Error(r.meddelande);
  return r.kalkyl;
}

describe("kravAgare", () => {
  it("kräver en inloggad kontext", () => {
    expect(() => kravAgare(anonym)).toThrow(KontoAtkomstError);
    expect(kravAgare(konto("p1"))).toBe("p1");
  });
  it("neka en rad som tillhör någon annan eller saknas", () => {
    expect(kravAgare(konto("p1"), { principalId: "p1", x: 1 })).toEqual({
      principalId: "p1",
      x: 1,
    });
    expect(() => kravAgare(konto("p1"), { principalId: "p2" })).toThrow(KontoAtkomstError);
    expect(() => kravAgare(konto("p1"), null)).toThrow(KontoAtkomstError);
  });
  it("en kontext med principalId men utan konto (anonym enhet) räknas inte", () => {
    expect(() => kravAgare({ enhetId: "e", principalId: "p1", ipHash: null })).toThrow(
      KontoAtkomstError,
    );
  });
});

describe("sparaVardering", () => {
  it("räknar om värderingen på servern och sparar snapshot + modellversion", async () => {
    const t = await bygg();
    const v = await sparaEn(t.bA);
    expect(v.etikett).toBe("Min lägenhet");
    expect(v.input).toMatchObject({ boarea: 62, postnummer: "11857" });
    expect(v.resultat?.prisanalys.externVardering?.value).toEqual(expect.any(Number));
    expect(v.modellVersion).toBe(v.resultat?.prisanalys.varderingsunderlag?.modellVersion);
    expect(t.db.sparadeVarderingar.size).toBe(1);
  });

  it("ett klient-skickat resultat ignoreras", async () => {
    const t = await bygg();
    const r = await sparaVardering(t.bA, {
      prisInput,
      resultat: { prisanalys: { externVardering: { value: 1 } } },
    });
    expect(r.ok).toBe(true);
    const lagrat = [...t.db.sparadeVarderingar.values()][0]!;
    expect(JSON.stringify(lagrat.resultat)).not.toContain('"value":1,');
  });

  it("ogiltig indata: ogiltig_indata med servern textade postnummerfel", async () => {
    const t = await bygg();
    const r = await sparaVardering(t.bA, { prisInput: { ...prisInput, postnummer: "12" } });
    expect(r).toMatchObject({ ok: false, felKod: "ogiltig_indata" });
    expect(t.db.sparadeVarderingar.size).toBe(0);
  });

  it("etikett över 120 tecken eller med styrtecken nekas; tom blir null", async () => {
    const t = await bygg();
    expect(await sparaVardering(t.bA, { prisInput, etikett: "x".repeat(121) })).toMatchObject({
      felKod: "ogiltig_indata",
    });
    expect(await sparaVardering(t.bA, { prisInput, etikett: "a\u0000b" })).toMatchObject({
      felKod: "ogiltig_indata",
    });
    const r = await sparaVardering(t.bA, { prisInput, etikett: "   " });
    expect(r.ok && r.vardering.etikett).toBeNull();
  });

  it("utloggad: ej_inloggad och inget sparas", async () => {
    const t = await bygg();
    expect(await sparaVardering(t.bAnonym, { prisInput })).toMatchObject({ felKod: "ej_inloggad" });
    expect(t.db.sparadeVarderingar.size).toBe(0);
  });

  it("per-konto-tak och prisuppskattningskvot", async () => {
    const t = await bygg();
    for (let i = 0; i < MAX_SPARADE_PER_TYP; i++) {
      await t.db.skapaSparadVardering({
        principalId: t.a,
        etikett: null,
        input: prisInput,
        resultat: {} as never,
        modellVersion: "m",
      });
    }
    expect(await sparaVardering(t.bA, { prisInput })).toMatchObject({
      felKod: "for_manga_sparade",
    });
    // Quota: a fresh account on a busy network.
    const t2 = await bygg();
    for (let i = 0; i < PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME; i++) {
      await t2.db.taKvot("prisuppskattning:ip:ip-1", 3600, PRISUPPSKATTNINGAR_PER_IP_OCH_TIMME);
    }
    expect(await sparaVardering(t2.bA, { prisInput })).toMatchObject({ felKod: "kvot" });
  });
});

describe("sparaKalkyl", () => {
  it("sparar validerat underlag med injicerad sammanfattning och regelversion", async () => {
    const t = await bygg();
    const k = await sparaEnKalkyl(t.bA);
    expect(k.underlag).toEqual(underlag);
    expect(k.sammanfattning).toEqual(sammanfattning);
    expect(k.regelversion).toBe("regler-test-1");
  });

  it("avvisar felformat underlag: okänd nyckel, fel version, negativt belopp, skräp", async () => {
    const t = await bygg();
    for (const u of [
      { ...underlag, extra: 1 },
      { ...underlag, version: 1 },
      { ...underlag, version: 3 },
      { ...underlag, pris: -1 },
      { ...underlag, lanebelopp: 1_000_000 }, // fältet finns bara i version 1
      { ...underlag, avgiftInkluderar: { ...underlag.avgiftInkluderar, el: "okant" } },
      { ...underlag, antalLantagare: 3 },
      { ...underlag, barn: ["99-100"] },
      "x",
      null,
      undefined,
    ]) {
      expect(await sparaKalkyl(t.bA, { underlag: u }, kb)).toMatchObject({
        ok: false,
        felKod: "ogiltig_indata",
      });
    }
    expect(t.db.sparadeKalkyler.size).toBe(0);
  });

  it("en ogiltig sammanfattning från räknaren är ett synligt fel, inte en tyst lagring", async () => {
    const t = await bygg();
    const trasig: KalkylBeroenden = {
      regelversion: "r",
      beraknaSammanfattning: () => ({ totalPerManad: Number.NaN }) as never,
    };
    await expect(sparaKalkyl(t.bA, { underlag }, trasig)).rejects.toThrow();
    expect(t.db.sparadeKalkyler.size).toBe(0);
  });

  it("uppdatering med id behåller etiketten om den utelämnas, och rör inte skapad", async () => {
    const t = await bygg();
    const k = await sparaEnKalkyl(t.bA);
    const r = await sparaKalkyl(t.bA, { id: k.id, underlag: { ...underlag, rantaProcent: 4 } }, kb);
    expect(r.ok && r.kalkyl.id).toBe(k.id);
    expect(r.ok && r.kalkyl.etikett).toBe("Kalkyl 1");
    expect(r.ok && r.kalkyl.underlag?.rantaProcent).toBe(4);
    expect(t.db.sparadeKalkyler.size).toBe(1);
    const byt = await sparaKalkyl(t.bA, { id: k.id, underlag, etikett: "" }, kb);
    expect(byt.ok && byt.kalkyl.etikett).toBeNull();
  });

  it("ett sparat underlag av okänd version läses som underlag: null", async () => {
    const t = await bygg();
    const rad = await t.db.skapaSparadKalkyl({
      principalId: t.a,
      etikett: null,
      input: { version: 0 },
      sammanfattning: sammanfattning,
      regelversion: "gammal",
    });
    const r = await hamtaSparadKalkyl(t.bA, { id: rad.id });
    expect(r.ok && r.kalkyl.underlag).toBeNull();
  });
});

describe("ägarskap: konto B når aldrig konto A:s saker", () => {
  it("hamtaSparadVardering / raderaSparadVardering", async () => {
    const t = await bygg();
    const v = await sparaEn(t.bA);
    expect(await hamtaSparadVardering(t.bB, { id: v.id })).toMatchObject({
      ok: false,
      felKod: "hittades_inte",
    });
    expect(await raderaSparadVardering(t.bB, { id: v.id })).toMatchObject({
      ok: false,
      felKod: "hittades_inte",
    });
    expect(t.db.sparadeVarderingar.size).toBe(1);
    expect((await hamtaSparadVardering(t.bA, { id: v.id })).ok).toBe(true);
    expect(await raderaSparadVardering(t.bA, { id: v.id })).toEqual({ ok: true });
    expect(t.db.sparadeVarderingar.size).toBe(0);
  });

  it("hamtaSparadKalkyl / raderaSparadKalkyl", async () => {
    const t = await bygg();
    const k = await sparaEnKalkyl(t.bA);
    expect(await hamtaSparadKalkyl(t.bB, { id: k.id })).toMatchObject({ felKod: "hittades_inte" });
    expect(await raderaSparadKalkyl(t.bB, { id: k.id })).toMatchObject({ felKod: "hittades_inte" });
    expect(t.db.sparadeKalkyler.size).toBe(1);
    expect(await raderaSparadKalkyl(t.bA, { id: k.id })).toEqual({ ok: true });
  });

  it("sparaKalkyl med någon annans id ändrar ingenting", async () => {
    const t = await bygg();
    const k = await sparaEnKalkyl(t.bA);
    const r = await sparaKalkyl(t.bB, { id: k.id, underlag: { ...underlag, rantaProcent: 9 } }, kb);
    expect(r).toMatchObject({ ok: false, felKod: "hittades_inte" });
    expect([...t.db.sparadeKalkyler.values()][0]?.input).toEqual(underlag);
    expect(t.db.sparadeKalkyler.size).toBe(1);
  });

  it("listaSparat visar bara kontots egna", async () => {
    const t = await bygg();
    await sparaEn(t.bA);
    await sparaEnKalkyl(t.bA);
    const lb = await listaSparat(t.bB);
    expect(lb).toEqual({ ok: true, analyser: [], varderingar: [], kalkyler: [] });
    const la = await listaSparat(t.bA);
    expect(la.ok && [la.varderingar.length, la.kalkyler.length]).toEqual([1, 1]);
  });

  it("taBortAnalysFranLista tar bara bort den egna analysen", async () => {
    const t = await bygg();
    t.db.laggTillAnalys({
      id: ID_A,
      principalId: t.a,
      propertyInput: {} as PropertyInput,
      rapportId: null,
    });
    expect(await taBortAnalysFranLista(t.bB, { analysisId: ID_A })).toMatchObject({
      ok: false,
      felKod: "hittades_inte",
    });
    expect(t.db.analyser.has(ID_A)).toBe(true);
    expect(await taBortAnalysFranLista(t.bA, { analysisId: ID_A })).toEqual({ ok: true });
    expect(t.db.analyser.has(ID_A)).toBe(false);
    expect(t.db.raderadeAnalyser).toEqual([ID_A]);
  });

  it("hamtaMinaUppgifter innehåller bara det egna", async () => {
    const t = await bygg();
    await sparaEn(t.bA);
    await sparaEnKalkyl(t.bA);
    t.db.laggTillAnalys({
      id: ID_A,
      principalId: t.a,
      propertyInput: { adress: "A" } as never,
      rapportId: null,
    });
    t.db.laggTillAnalys({
      id: ID_B,
      principalId: t.b,
      propertyInput: { adress: "B" } as never,
      rapportId: null,
    });
    const ub = await hamtaMinaUppgifter(t.bB);
    expect(ub.ok && ub.uppgifter.sparadeVarderingar).toEqual([]);
    expect(ub.ok && ub.uppgifter.analyser.map((a) => a.id)).toEqual([ID_B]);
    const ua = await hamtaMinaUppgifter(t.bA);
    expect(ua.ok && ua.uppgifter.konto.epost).toBe(t.a + "@example.se");
    expect(
      ua.ok && [ua.uppgifter.sparadeVarderingar.length, ua.uppgifter.sparadeKalkyler.length],
    ).toEqual([1, 1]);
    expect(JSON.stringify(ua)).not.toContain('"adress":"B"');
  });

  it("skräp-id (inte uuid) ger hittades_inte, aldrig ett databasfel", async () => {
    const t = await bygg();
    for (const id of ["1; drop table", "", 5, null, undefined, "../x"]) {
      expect(await hamtaSparadVardering(t.bA, { id })).toMatchObject({ felKod: "hittades_inte" });
      expect(await raderaSparadKalkyl(t.bA, { id })).toMatchObject({ felKod: "hittades_inte" });
      expect(await taBortAnalysFranLista(t.bA, { analysisId: id })).toMatchObject({
        felKod: "hittades_inte",
      });
    }
  });
});

describe("alla funktioner kräver inloggning", () => {
  it("ej_inloggad överallt", async () => {
    const t = await bygg();
    const id = { id: ID_A };
    const svar = await Promise.all([
      sparaVardering(t.bAnonym, { prisInput }),
      hamtaSparadVardering(t.bAnonym, id),
      raderaSparadVardering(t.bAnonym, id),
      sparaKalkyl(t.bAnonym, { underlag }, kb),
      hamtaSparadKalkyl(t.bAnonym, id),
      raderaSparadKalkyl(t.bAnonym, id),
      listaSparat(t.bAnonym),
      taBortAnalysFranLista(t.bAnonym, { analysisId: ID_A }),
      hamtaMinaUppgifter(t.bAnonym),
    ]);
    for (const r of svar) expect(r).toMatchObject({ ok: false, felKod: "ej_inloggad" });
  });
});

describe("listan över analyser", () => {
  it("joinar rapport för namn, år, betyg och status; pågående har inget betyg", async () => {
    const t = await bygg();
    t.db.laggTillRapport({
      id: "r1",
      orgnr: "716420-0599",
      foreningNamn: "Brf Pontonjären 3",
      rakenskapsar: 2025,
      status: "done",
      stage: "klar",
      errorCode: null,
      betyg: "B",
    });
    t.db.laggTillRapport({
      id: "r2",
      orgnr: null,
      foreningNamn: null,
      rakenskapsar: null,
      status: "running",
      stage: "grundning",
      errorCode: null,
      betyg: "A",
    });
    t.db.laggTillAnalys({
      id: ID_A,
      principalId: t.a,
      propertyInput: { adress: "Gatan 1", utgangspris: 4_000_000 } as never,
      rapportId: "r1",
      createdAt: "2026-10-12T10:00:00Z",
    });
    t.db.laggTillAnalys({
      id: ID_B,
      principalId: t.a,
      propertyInput: { adress: "" } as never,
      rapportId: "r2",
      createdAt: "2026-10-13T10:00:00Z",
    });
    const l = await listaSparat(t.bA);
    expect(l.ok && l.analyser).toEqual([
      {
        analysisId: ID_B,
        skapad: "2026-10-13T10:00:00Z",
        status: "pagar",
        foreningNamn: null,
        orgnr: null,
        rakenskapsar: null,
        betyg: null,
        adress: null,
        utgangspris: null,
      },
      {
        analysisId: ID_A,
        skapad: "2026-10-12T10:00:00Z",
        status: "klar",
        foreningNamn: "Brf Pontonjären 3",
        orgnr: "716420-0599",
        rakenskapsar: 2025,
        betyg: "B",
        adress: "Gatan 1",
        utgangspris: 4_000_000,
      },
    ]);
  });
});

describe("fake: sparade objekt följer SQL-semantiken", () => {
  it("radera_principal tar sparade objekt (cascade) och rapporterar antal; export har dem", async () => {
    const t = await bygg();
    await sparaEn(t.bA);
    await sparaEnKalkyl(t.bA);
    await sparaEnKalkyl(t.bB);
    const exp = await (t.db as FakeKontoDatabas).exporteraPrincipal(t.a);
    expect(exp?.sparadeVarderingar).toHaveLength(1);
    expect(exp?.sparadeKalkyler).toHaveLength(1);
    const res = await t.db.raderaPrincipal(t.a);
    expect(res).toMatchObject({ principaler: 1, sparadeVarderingar: 1, sparadeKalkyler: 1 });
    expect(t.db.sparadeKalkyler.size).toBe(1);
  });

  it("sla_samman flyttar sparade objekt", async () => {
    const t = await bygg();
    const enhet = await t.db.sakerstallPrincipal("dev");
    await t.db.skapaSparadKalkyl({
      principalId: enhet,
      etikett: null,
      input: {},
      sammanfattning: {},
      regelversion: "r",
    });
    await t.db.slaSammanPrincipal(enhet, t.a);
    expect(await t.db.raknaSparadeKalkyler(t.a)).toBe(1);
  });
});
