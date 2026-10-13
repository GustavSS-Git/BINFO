import { describe, expect, it, vi } from "vitest";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { skapaFakeLager } from "./__fakes__/lager";
import {
  INGET_REGISTEROMRADE,
  PIPELINE_VERSION,
  slugForForening,
  uppdateraRegisterForOrgnr,
} from "./register";
import { loggaStegfel } from "./stegLogg";

describe("slugForForening", () => {
  it.each([
    ["Brf Pontonjären 3", "716420-0599", "brf-pontonjaren-3-716420-0599"],
    ["Brf Östermalmshöjden", "769600-1234", "brf-ostermalmshojden-769600-1234"],
    ["Brf Ålidhem Å Ä Ö", "769600-1234", "brf-alidhem-a-a-o-769600-1234"],
    ["Brf Café Élan", "769600-1234", "brf-cafe-elan-769600-1234"],
    ["  Brf  Granen 10-11 ", "769616-0253", "brf-granen-10-11-769616-0253"],
    ["Brf Lindgården (Malmö)", "769600-1234", "brf-lindgarden-malmo-769600-1234"],
    ["", "769600-1234", "brf-769600-1234"],
  ])("%j -> %s", (namn, orgnr, slug) => expect(slugForForening(namn, orgnr)).toBe(slug));

  it("ger olika slugs åt två föreningar med samma namn (orgnr-suffix)", () => {
    expect(slugForForening("Brf Granen", "769600-0001")).not.toBe(
      slugForForening("Brf Granen", "769600-0002"),
    );
  });

  it("påståenden om null-namn faller tillbaka på 'brf'", () => {
    expect(slugForForening(null, "769600-0001")).toBe("brf-769600-0001");
  });
});

const ORGNR = "769616-0253";

async function lagerMedKlarRapport(adresser: unknown) {
  const lager = skapaFakeLager();
  await lager.db.registreraForening(ORGNR, "Brf Granen 10-11");
  const skapad = await lager.db.skapaRapport({
    orgnr: ORGNR,
    rakenskapsar: 2025,
    pipelineVersion: PIPELINE_VERSION,
    model: "claude-sonnet-5-5",
    textlager: "ok",
    status: "done",
    stage: "klar",
    pdfHash: "h",
    extraction: { ...extraktion, forening: { ...extraktion.forening, adresser } },
    judgement: {
      betyg: "C",
      betygMotivering: "Motivering.",
      rodaFlaggor: [],
      fragor: [],
    },
    finishedAt: "2026-10-13T10:00:00.000Z",
  });
  expect(skapad.ok).toBe(true);
  return lager;
}

describe("uppdateraRegisterForOrgnr", () => {
  const adresser = [
    {
      gatuadress: "Baltzar von Platens gata 6",
      postnummer: "112 42",
      ort: "Stockholm",
      ref: { page: 3, excerpt: "Baltzar von Platens gata 6" },
    },
  ];

  it("skriver rapportens adresser (postnummer med fem siffror), slug och sammanfattning", async () => {
    const lager = await lagerMedKlarRapport(adresser);
    await uppdateraRegisterForOrgnr(lager.db, ORGNR);

    expect(lager.db._allaAdresser()).toMatchObject([
      { orgnr: ORGNR, postnummer: "11242", adress: "Baltzar von Platens gata 6", kalla: "rapport" },
    ]);
    expect(lager.db._foreningOmrade(ORGNR)).toMatchObject({
      slug: "brf-granen-10-11-769616-0253",
      // Default resolver = the real register taxonomy: 112 42 is Kungsholmen.
      registeromrade: "kungsholmen",
      omradeKalla: "rapport_adress",
    });
    const [rad] = lager.db._registerSammanfattning();
    expect(rad).toMatchObject({
      orgnr: ORGNR,
      rakenskapsar: 2025,
      betyg: "C",
      slug: "brf-granen-10-11-769616-0253",
    });
    expect(rad?.nyckeltal["rantekanslighet"]).toBe(9.2);
  });

  it("använder resolvern: rapportens adress först, köparens postnummer som reserv", async () => {
    const lager = await lagerMedKlarRapport(adresser);
    const los = vi.fn((pn: string[]) => ({ omrade: pn.includes("11242") ? "Kungsholmen" : null }));
    await uppdateraRegisterForOrgnr(lager.db, ORGNR, los);
    expect(los).toHaveBeenCalledWith(["11242"], "rapport_adress");
    expect(lager.db._foreningOmrade(ORGNR)).toMatchObject({
      registeromrade: "Kungsholmen",
      omradeKalla: "rapport_adress",
    });

    const utanAdress = await lagerMedKlarRapport(undefined);
    await utanAdress.db.registreraForeningAdress({
      orgnr: ORGNR,
      postnummer: "11242",
      kommunKod: null,
      omrade: null,
      adress: null,
      kalla: "anvandare",
    });
    await uppdateraRegisterForOrgnr(utanAdress.db, ORGNR, los);
    expect(utanAdress.db._foreningOmrade(ORGNR)).toMatchObject({
      registeromrade: "Kungsholmen",
      omradeKalla: "anvandare",
    });
  });

  it("ett nytt namn ger ny slug och den gamla sparas för omdirigering; ett okänt område raderar inget", async () => {
    const lager = await lagerMedKlarRapport(adresser);
    await uppdateraRegisterForOrgnr(lager.db, ORGNR, () => ({ omrade: "Kungsholmen" }));
    await lager.db.registreraForening(ORGNR, "Brf Granen Nya");
    await uppdateraRegisterForOrgnr(lager.db, ORGNR, INGET_REGISTEROMRADE);
    expect(lager.db._slugHistorik()).toEqual([
      { slug: "brf-granen-10-11-769616-0253", orgnr: ORGNR },
    ]);
    expect(lager.db._foreningOmrade(ORGNR)).toMatchObject({
      slug: "brf-granen-nya-769616-0253",
      registeromrade: "Kungsholmen",
    });
  });

  it("är idempotent och tar bort sammanfattningen när ingen klar rapport finns", async () => {
    const lager = await lagerMedKlarRapport(adresser);
    await uppdateraRegisterForOrgnr(lager.db, ORGNR);
    await uppdateraRegisterForOrgnr(lager.db, ORGNR);
    expect(lager.db._registerSammanfattning()).toHaveLength(1);
    expect(lager.db._allaAdresser()).toHaveLength(1);
    const [r] = lager.db._allaRapporter();
    await lager.db.uppdateraRapport(r!.id, { status: "failed" });
    await uppdateraRegisterForOrgnr(lager.db, ORGNR);
    expect(lager.db._registerSammanfattning()).toEqual([]);
  });

  it("kastar aldrig, även om databasen fallerar", async () => {
    const lager = await lagerMedKlarRapport(adresser);
    lager.db.sattForeningOmrade = () => Promise.reject(new Error("db nere"));
    const varna = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(uppdateraRegisterForOrgnr(lager.db, ORGNR)).resolves.toBeUndefined();
    expect(varna).toHaveBeenCalled();
    varna.mockRestore();
  });
});

describe("loggaStegfel", () => {
  it("loggar felklass, status och meddelande och maskerar nycklar", () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fel = Object.assign(new Error("401 invalid x-api-key sk-ant-api03-SECRET_123"), {
      name: "AuthenticationError",
      status: 401,
    });
    loggaStegfel("rapport r1 steg grundning", "unknown", fel);
    const rad = String(logg.mock.calls[0]?.[0]);
    expect(rad).toContain("AuthenticationError (HTTP 401)");
    expect(rad).toContain("unknown");
    expect(rad).not.toContain("SECRET_123");
    logg.mockRestore();
  });
});

describe("uppdateraRegisterForOrgnr: adresser från senaste räkenskapsåret", () => {
  const adr = (gata: string, pn: string) => [
    { gatuadress: gata, postnummer: pn, ort: "Stockholm", ref: { page: 1, excerpt: gata } },
  ];

  async function skapa(
    lager: ReturnType<typeof skapaFakeLager>,
    ar: number,
    gata: string,
    klar: string,
    pdfHash: string,
  ) {
    const r = await lager.db.skapaRapport({
      orgnr: ORGNR,
      rakenskapsar: ar,
      pipelineVersion: PIPELINE_VERSION,
      model: "claude-sonnet-5-5",
      textlager: "ok",
      status: "done",
      stage: "klar",
      pdfHash,
      extraction: {
        ...extraktion,
        forening: { ...extraktion.forening, adresser: adr(gata, "11242") },
      },
      judgement: { betyg: "C", betygMotivering: "M.", rodaFlaggor: [], fragor: [] },
      finishedAt: klar,
    });
    expect(r.ok).toBe(true);
  }

  it("väljer högsta räkenskapsår oavsett när det blev klart eller i vilken ordning de skapades", async () => {
    const lager = skapaFakeLager();
    await lager.db.registreraForening(ORGNR, "Brf Granen 10-11");
    // The older year finished LAST and was created first/last in both orders below.
    await skapa(lager, 2025, "Nya gatan 1", "2026-10-01T10:00:00.000Z", "h25");
    await skapa(lager, 2024, "Gamla gatan 9", "2026-10-12T10:00:00.000Z", "h24");
    await uppdateraRegisterForOrgnr(lager.db, ORGNR);
    expect(lager.db._allaAdresser().map((a) => a.adress)).toEqual(["Nya gatan 1"]);

    const omvand = skapaFakeLager();
    await omvand.db.registreraForening(ORGNR, "Brf Granen 10-11");
    await skapa(omvand, 2024, "Gamla gatan 9", "2026-10-12T10:00:00.000Z", "h24");
    await skapa(omvand, 2025, "Nya gatan 1", "2026-10-01T10:00:00.000Z", "h25");
    await uppdateraRegisterForOrgnr(omvand.db, ORGNR);
    expect(omvand.db._allaAdresser().map((a) => a.adress)).toEqual(["Nya gatan 1"]);
  });
});
