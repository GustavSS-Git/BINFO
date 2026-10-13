import { describe, expect, it } from "vitest";
import { extraktion } from "@/lib/analysis/__fixtures__/extraktion";
import { REGISTEROMRADEN } from "@/lib/register/omraden";
import {
  REGISTER_SIDSTORLEK,
  foreningBeskrivning,
  type RegisterForeningVy,
} from "@/lib/registerVy";
import { skapaFakeKontoDatabas } from "./__fakes__/konto";
import { skapaFakeLager, type FakeLager } from "./__fakes__/lager";
import {
  REGISTER_LASNINGAR_PER_IP_OCH_TIMME,
  hamtaForening,
  hamtaSitemapPoster,
  kontrolleraRegisterKvot,
  listaForeningar,
  listaOmraden,
  raknaOmraden,
} from "./registerPublik";
import { PIPELINE_VERSION, uppdateraRegisterForOrgnr } from "./register";
import { orgnrFragment, saneraRegisterSok } from "./supabase";

const JUDGEMENT = {
  betyg: "C" as const,
  betygMotivering: "Motivering.",
  rodaFlaggor: [],
  fragor: [
    {
      id: "f1",
      fraga: "Hur ser underhållsplanen ut?",
      ursprung: "analys" as const,
      riktadTill: "styrelsen" as const,
      varfor: "Därför.",
    },
  ],
};

/** A done rapport + register row for one BRF in `kungsholmen` (via postnummer 112 42). */
async function lagg(
  lager: FakeLager,
  o: {
    orgnr: string;
    namn: string;
    ar?: number;
    pipeline?: string;
    betyg?: "A" | "B" | "C" | "D" | "E";
    finished?: string;
    postnummer?: string;
    skuld?: number;
  },
) {
  await lager.db.registreraForening(o.orgnr, o.namn);
  const keyFigures = extraktion.forening.keyFigures.map((k) =>
    k.id === "skuldsattning_per_m2_brf_yta" && o.skuld !== undefined
      ? { ...k, figure: { ...k.figure, value: o.skuld } }
      : k,
  );
  const r = await lager.db.skapaRapport({
    orgnr: o.orgnr,
    rakenskapsar: o.ar ?? 2025,
    pipelineVersion: o.pipeline ?? PIPELINE_VERSION,
    model: "m",
    textlager: "ok",
    status: "done",
    stage: "klar",
    pdfHash: `h-${o.orgnr}-${o.ar ?? 2025}-${o.pipeline ?? "x"}`,
    extraction: {
      ...extraktion,
      forening: {
        ...extraktion.forening,
        namn: o.namn,
        orgnr: o.orgnr,
        keyFigures,
        adresser: [
          {
            gatuadress: "Testgatan 1",
            postnummer: o.postnummer ?? "112 42",
            ort: "Stockholm",
            ref: { page: 2, excerpt: "Testgatan 1" },
          },
        ],
      },
    },
    judgement: { ...JUDGEMENT, betyg: o.betyg ?? "C" },
    finishedAt: o.finished ?? "2026-10-13T10:00:00.000Z",
  });
  expect(r.ok).toBe(true);
  await uppdateraRegisterForOrgnr(lager.db, o.orgnr);
}

function beroenden(lager: FakeLager) {
  return { lasning: lager.db._registerLasning() };
}

describe("listaOmraden", () => {
  it("räknar BRF:er per område, i områdesordning, med 0 för tomma områden", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    await lagg(lager, {
      orgnr: "769616-0253",
      namn: "Brf Granen",
      finished: "2026-10-14T10:00:00Z",
    });
    const svar = await listaOmraden(beroenden(lager));
    if (!("omraden" in svar)) throw new Error("kvot");
    expect(svar.omraden).toHaveLength(REGISTEROMRADEN.length); // no "Övriga" when empty
    const kh = svar.omraden.find((o) => o.slug === "kungsholmen");
    expect(kh?.antal).toBe(2);
    expect(kh?.senastUppdaterad).toBe("2026-10-14T10:00:00Z");
    expect(svar.omraden.filter((o) => o.antal === 0)).toHaveLength(REGISTEROMRADEN.length - 1);
  });

  it("tar med Övriga Stockholm bara när den har föreningar", () => {
    const kort = raknaOmraden([{ registeromrade: "ovriga-stockholm", analysdatum: "2026-01-01" }]);
    expect(kort.at(-1)).toMatchObject({ slug: "ovriga-stockholm", grupp: null, antal: 1 });
  });
});

describe("listaForeningar", () => {
  async function tre() {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", betyg: "B", skuld: 4800 });
    await lagg(lager, {
      orgnr: "769616-0253",
      namn: "Brf Granen",
      betyg: "D",
      skuld: 9000,
      finished: "2026-10-15T10:00:00Z",
    });
    await lagg(lager, { orgnr: "769600-0001", namn: "Brf Eken", betyg: "A", skuld: 1000 });
    return lager;
  }

  it("sorterar på skuld per kvm i båda riktningarna", async () => {
    const lager = await tre();
    const asc = await listaForeningar(beroenden(lager), {
      omrade: "kungsholmen",
      sortering: "skuld_brf",
      riktning: "asc",
    });
    const desc = await listaForeningar(beroenden(lager), {
      omrade: "kungsholmen",
      sortering: "skuld_brf",
      riktning: "desc",
    });
    if (asc.status !== "ok" || desc.status !== "ok") throw new Error("förväntade ok");
    expect(asc.rader.map((r) => r.namn)).toEqual(["Brf Eken", "Brf Pontonjären 3", "Brf Granen"]);
    expect(desc.rader.map((r) => r.namn)).toEqual(["Brf Granen", "Brf Pontonjären 3", "Brf Eken"]);
  });

  it("sorterar på betyg (A först) och på analysdatum (nyast först som standard)", async () => {
    const lager = await tre();
    const betyg = await listaForeningar(beroenden(lager), {
      omrade: "kungsholmen",
      sortering: "betyg",
    });
    const standard = await listaForeningar(beroenden(lager), { omrade: "kungsholmen" });
    if (betyg.status !== "ok" || standard.status !== "ok") throw new Error("förväntade ok");
    expect(betyg.rader.map((r) => r.betyg)).toEqual(["A", "B", "D"]);
    expect(standard.sortering).toBe("analysdatum");
    expect(standard.riktning).toBe("desc");
    expect(standard.rader[0]?.namn).toBe("Brf Granen");
  });

  it("söker på namn (utan hänsyn till versaler) och på orgnr med eller utan bindestreck", async () => {
    const lager = await tre();
    const namn = await listaForeningar(beroenden(lager), { sok: "pontonjären" });
    const orgnr = await listaForeningar(beroenden(lager), { sok: "7164200599" });
    const orgnrBindestreck = await listaForeningar(beroenden(lager), { sok: "716420-0599" });
    const ingen = await listaForeningar(beroenden(lager), { sok: "finnsinte" });
    for (const s of [namn, orgnr, orgnrBindestreck]) {
      if (s.status !== "ok") throw new Error("förväntade ok");
      expect(s.rader.map((r) => r.slug)).toEqual(["brf-pontonjaren-3-716420-0599"]);
    }
    if (ingen.status !== "ok") throw new Error("förväntade ok");
    expect(ingen.totalt).toBe(0);
  });

  it("paginerar med 50 rader per sida och rapporterar totalen", async () => {
    const lager = skapaFakeLager();
    for (let i = 0; i < 53; i++) {
      const sista = String(i).padStart(4, "0");
      await lagg(lager, { orgnr: `769600-${sista}`, namn: `Brf Test ${sista}`, skuld: 1000 + i });
    }
    const s1 = await listaForeningar(beroenden(lager), {
      omrade: "kungsholmen",
      sortering: "skuld_brf",
    });
    const s2 = await listaForeningar(beroenden(lager), {
      omrade: "kungsholmen",
      sortering: "skuld_brf",
      sida: 2,
    });
    if (s1.status !== "ok" || s2.status !== "ok") throw new Error("förväntade ok");
    expect(s1.rader).toHaveLength(REGISTER_SIDSTORLEK);
    expect(s2.rader).toHaveLength(3);
    expect(s1.totalt).toBe(53);
    expect(s2.sida).toBe(2);
  });

  it("okänt område -> saknas; skräp i sortering/sida faller tillbaka på standard", async () => {
    const lager = await tre();
    expect(await listaForeningar(beroenden(lager), { omrade: "atlantis" })).toEqual({
      status: "saknas",
    });
    const s = await listaForeningar(beroenden(lager), {
      omrade: "kungsholmen",
      sortering: "'; drop table" as never,
      sida: -4,
    });
    if (s.status !== "ok") throw new Error("förväntade ok");
    expect(s.sortering).toBe("analysdatum");
    expect(s.sida).toBe(1);
  });

  it("listar bara föreningar med ett listat område", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    // Malmö postnummer: no register area -> never listed
    await lagg(lager, { orgnr: "769600-0002", namn: "Brf Malmö", postnummer: "211 20" });
    const s = await listaForeningar(beroenden(lager), {});
    if (s.status !== "ok") throw new Error("förväntade ok");
    expect(s.rader.map((r) => r.namn)).toEqual(["Brf Pontonjären 3"]);
    expect(await hamtaForening(beroenden(lager), "brf-malmo-769600-0002")).toEqual({
      status: "saknas",
    });
  });
});

describe("hamtaForening", () => {
  it("ger BRF-nivå för senaste året och tidigare år, ett per räkenskapsår", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2025 });
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2024, betyg: "D" });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    const f = svar.forening;
    expect(f.senaste.rakenskapsar).toBe(2025);
    expect(f.tidigare.map((t) => t.rakenskapsar)).toEqual([2024]);
    expect(f.tidigare[0]?.betyg).toBe("D");
    expect(f.omrade).toEqual({ slug: "kungsholmen", namn: "Kungsholmen" });
    expect(f.adresser).toEqual([
      { gatuadress: "Testgatan 1", postnummer: "112 42", ort: "Stockholm" },
    ]);
  });

  it("visar frågor med ursprung analys (aldrig köparens luckor)", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    const fragor = svar.forening.senaste.fragor;
    expect(fragor.every((f) => f.ursprung === "analys")).toBe(true);
    expect(fragor.map((f) => f.id)).toContain("f1");
  });

  it("föredrar nuvarande pipeline-version men visar äldre kompatibla med markering", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, {
      orgnr: "716420-0599",
      namn: "Brf Pontonjären 3",
      ar: 2025,
      pipeline: "p1.i1.s1",
      finished: "2026-10-16T10:00:00Z",
    });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    expect(svar.forening.senaste.aldreVersion).toBe(true);
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2025 });
    const nytt = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in nytt)) throw new Error("förväntade ok");
    expect(nytt.forening.senaste.aldreVersion).toBe(false);
  });

  it("okänd slug -> saknas; ett omdöpt namn -> omdirigera till nya sluggen", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    expect(await hamtaForening(beroenden(lager), "brf-finns-inte-111111-1111")).toEqual({
      status: "saknas",
    });
    await lager.db.registreraForening("716420-0599", "Brf Pontonjären Tre");
    await uppdateraRegisterForOrgnr(lager.db, "716420-0599");
    expect(await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599")).toEqual({
      status: "omdirigera",
      slug: "brf-pontonjaren-tre-716420-0599",
    });
    const ny = await hamtaForening(beroenden(lager), "brf-pontonjaren-tre-716420-0599");
    expect(ny.status).toBe("ok");
  });

  it("en förening utan servbar rapport är inte synlig", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    const [rapport] = lager.db._allaRapporter();
    await lager.db.uppdateraRapport(rapport!.id, { status: "failed" });
    expect(await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599")).toEqual({
      status: "saknas",
    });
  });
});

/** The list of keys at every depth, "a.b.c" with array indexes dropped. */
function nycklar(v: unknown, prefix = "", ut = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) nycklar(x, prefix, ut);
  } else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      const sokvag = prefix === "" ? k : `${prefix}.${k}`;
      ut.add(sokvag);
      nycklar(x, sokvag, ut);
    }
  }
  return ut;
}

describe("ingen köpardata i payloaden", () => {
  it("BRF-sidans nycklar innehåller varken input, prisanalys, räntestress eller köparfält", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    const lista = await listaForeningar(beroenden(lager), {});
    const omraden = await listaOmraden(beroenden(lager));
    const alla = [...nycklar(svar), ...nycklar(lista), ...nycklar(omraden)];
    for (const forbjuden of [
      "input",
      "prisanalys",
      "rantestress",
      "propertyInput",
      "property_input",
      "utgangspris",
      "manadsavgift",
      "boarea",
      "principalId",
      "principal_id",
      "analysisId",
      "pdfHash",
      "pdfPath",
    ]) {
      expect(alla.filter((k) => k.split(".").includes(forbjuden))).toEqual([]);
    }
    // Snapshot of the top-level shape: any new field is a conscious decision.
    if (!("forening" in svar)) throw new Error("förväntade ok");
    expect(Object.keys(svar.forening).sort()).toEqual([
      "adresser",
      "namn",
      "omrade",
      "orgnr",
      "senaste",
      "slug",
      "tidigare",
    ]);
    expect(Object.keys(svar.forening.senaste).sort()).toEqual([
      "aldreVersion",
      "analysdatum",
      "betyg",
      "betygMotivering",
      "datakvalitet",
      "forening",
      "fragor",
      "rakenskapsar",
      "rodaFlaggor",
    ]);
    expect(Object.keys(svar.forening.senaste.datakvalitet).sort()).toEqual(
      ["extraktionKonfidens", "kalla", "pdfSaknarTextlager", "saknadeFalt"].filter(
        (k) => k in svar.forening.senaste.datakvalitet,
      ),
    );
    if (lista.status !== "ok") throw new Error("förväntade ok");
    expect(Object.keys(lista.rader[0]!).sort()).toEqual(
      [
        "analysdatum",
        "avgiftPerM2",
        "betyg",
        "namn",
        "omradeNamn",
        "omradeSlug",
        "orgnr",
        "rakenskapsar",
        "slug",
        "skuldPerM2Brf",
        "sparandePerM2",
      ].sort(),
    );
  });
});

describe("hastighetsbegränsning (300 per IP och timme)", () => {
  it("släpper igenom 300 läsningar och nekar den 301:a, per IP", async () => {
    const konto = skapaFakeKontoDatabas({});
    for (let i = 0; i < REGISTER_LASNINGAR_PER_IP_OCH_TIMME; i++) {
      expect(await kontrolleraRegisterKvot({ konto, ipHash: "a".repeat(64) })).toBe(true);
    }
    expect(await kontrolleraRegisterKvot({ konto, ipHash: "a".repeat(64) })).toBe(false);
    expect(await kontrolleraRegisterKvot({ konto, ipHash: "b".repeat(64) })).toBe(true);
  });

  it("returnerar ett kvot-svar i stället för data när gränsen är nådd", async () => {
    const lager = skapaFakeLager();
    const konto = skapaFakeKontoDatabas({});
    const b = { lasning: lager.db._registerLasning(), kvot: { konto, ipHash: "c".repeat(64) } };
    for (let i = 0; i < REGISTER_LASNINGAR_PER_IP_OCH_TIMME; i++) await listaOmraden(b);
    const svar = await listaOmraden(b);
    expect(svar).toMatchObject({ status: "kvot" });
  });
});

describe("sitemap-poster", () => {
  it("innehåller /brf, områden med minst en BRF och varje listad BRF med lastmod", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    await lagg(lager, { orgnr: "769600-0002", namn: "Brf Malmö", postnummer: "211 20" });
    const poster = await hamtaSitemapPoster(lager.db._registerLasning());
    expect(poster.map((p) => p.path)).toEqual([
      "/brf",
      "/brf/omrade/kungsholmen",
      "/brf/brf-pontonjaren-3-716420-0599",
    ]);
    expect(poster.every((p) => p.lastmod !== null)).toBe(true);
  });
});

describe("söksanering (supabase-adaptern)", () => {
  it("tar bort tecken som kan ändra ett PostgREST-filter", () => {
    expect(saneraRegisterSok('a,b(c).d*e%f_g"h\\i')).toBe("a b c d e f g h i");
    expect(saneraRegisterSok("Brf Pontonjären 3")).toBe("Brf Pontonjären 3");
  });

  it("gör en siffersökning till ett orgnr-fragment", () => {
    expect(orgnrFragment("7164200599")).toBe("716420-0599");
    expect(orgnrFragment("716420-0599")).toBe("716420-0599");
    expect(orgnrFragment("7164")).toBe("7164");
    expect(orgnrFragment("12")).toBeNull();
    expect(orgnrFragment("Brf 3")).toBeNull();
  });
});

describe("beskrivning", () => {
  it("håller sig under 160 tecken", () => {
    const vy = {
      namn: "Brf ".padEnd(120, "Långt "),
      senaste: {
        rakenskapsar: 2025,
        betyg: "C",
        rodaFlaggor: [{}],
        forening: { keyFigures: [] },
      },
    } as unknown as RegisterForeningVy;
    expect(foreningBeskrivning(vy).length).toBeLessThanOrEqual(160);
  });
});
