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
import { skapaBehorighet, STANDARD_POLICY } from "./behorighet";
import type { Kontext } from "./kontext";
import {
  REGISTER_LASNINGAR_PER_IP_OCH_TIMME,
  REGISTERANALYS_NEKAD_MEDDELANDE,
  hamtaForening,
  hamtaRegisteranalys,
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
    /** Replace the sparande figure (e.g. a printed sign without a value). */
    sparande?: Record<string, unknown>;
    /** Force a (stale) stored status on the sparande key figure. */
    sparandeStatus?: "god" | "acceptabel" | "svag" | "kritisk" | "okant";
  },
) {
  await lager.db.registreraForening(o.orgnr, o.namn);
  const keyFigures = extraktion.forening.keyFigures.map((k) =>
    k.id === "skuldsattning_per_m2_brf_yta" && o.skuld !== undefined
      ? { ...k, figure: { ...k.figure, value: o.skuld } }
      : k.id === "sparande_per_m2_totalyta" && (o.sparande !== undefined || o.sparandeStatus)
        ? {
            ...k,
            ...(o.sparande !== undefined ? { figure: o.sparande } : {}),
            ...(o.sparandeStatus ? { status: o.sparandeStatus } : {}),
          }
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

  it("sammanfattningen bär betyg och de nyckeltal rapporten har, i extraktionens ordning med status", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, {
      orgnr: "716420-0599",
      namn: "Brf Pontonjären 3",
      sparande: {
        value: null,
        unit: "kr/m2",
        source: "arsredovisning",
        tecken: "negativ",
        tryckt: "neg",
        ref: { page: 8, excerpt: "neg" },
      },
    });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    const s = svar.forening.senaste;
    expect(s.betyg).toBe("C");
    expect(s.skannad).toBe(false);
    expect(s.aldreVersion).toBe(false);
    // arsavgift_andel has value null and no sign: left out. Sparande "neg": kept.
    expect(s.nyckeltal.map((n) => n.id)).toEqual(
      extraktion.forening.keyFigures
        .map((k) => k.id)
        .filter((id) => id !== "arsavgift_andel_av_rorelseintakter"),
    );
    const sparande = s.nyckeltal.find((n) => n.id === "sparande_per_m2_totalyta");
    expect(sparande?.figure).toMatchObject({ value: null, tecken: "negativ" });
    expect(sparande?.status).not.toBe("okant");
    const skuld = s.nyckeltal.find((n) => n.id === "skuldsattning_per_m2_brf_yta");
    expect(skuld).toMatchObject({ label: expect.any(String), status: "kritisk" });
    expect(skuld?.figure.ref).toMatchObject({ page: 8 });
  });

  it("omgraderar lagrade status med dagens band: sparande 125 lagrat som 'god' visas 'acceptabel' (sammanfattning och analysvy)", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, {
      orgnr: "716420-0599",
      namn: "Brf Pontonjären 3",
      sparande: {
        value: 125,
        unit: "kr/m2",
        source: "arsredovisning",
        ref: { page: 8, excerpt: "125" },
      },
      sparandeStatus: "god",
    });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    const n = svar.forening.senaste.nyckeltal.find((k) => k.id === "sparande_per_m2_totalyta");
    expect(n?.status).toBe("acceptabel");
    const analys = await hamtaRegisteranalys(
      beroenden(lager),
      "brf-pontonjaren-3-716420-0599",
      2025,
    );
    if (analys.status !== "ok") throw new Error("förväntade ok");
    const k = analys.vy.analys.forening.keyFigures.find((x) => x.id === "sparande_per_m2_totalyta");
    expect(k?.status).toBe("acceptabel");
  });

  it("föredrar nuvarande pipeline-version men visar äldre kompatibla med markering; en ny körning 'skriver över' året", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, {
      orgnr: "716420-0599",
      namn: "Brf Pontonjären 3",
      ar: 2025,
      pipeline: "p1.i1.s1",
      betyg: "B",
      finished: "2026-10-16T10:00:00Z",
    });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    expect(svar.forening.senaste.aldreVersion).toBe(true);
    expect(svar.forening.senaste.betyg).toBe("B");
    // The current-version run of the same year finishes EARLIER than the old
    // one did (finished_at alone would not pick it): the version decides.
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2025, betyg: "D" });
    const nytt = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in nytt)) throw new Error("förväntade ok");
    expect(nytt.forening.senaste.aldreVersion).toBe(false);
    expect(nytt.forening.senaste.betyg).toBe("D");
    expect(nytt.forening.tidigare).toEqual([]);
    const lista = await listaForeningar(beroenden(lager), { omrade: "kungsholmen" });
    if (lista.status !== "ok") throw new Error("förväntade ok");
    expect(lista.rader.map((r) => r.betyg)).toEqual(["D"]);
    const full = await hamtaRegisteranalys(beroenden(lager), "brf-pontonjaren-3-716420-0599", 2025);
    if (full.status !== "ok") throw new Error("förväntade ok");
    expect(full.vy.analys).toMatchObject({ betyg: "D", aldreVersion: false });
  });

  it("ett lagrat betyg från en äldre version visas som lagrat, även bredvid ett kritiskt nyckeltal (ingen omklampning vid läsning)", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, {
      orgnr: "716420-0599",
      namn: "Brf Pontonjären 3",
      pipeline: "p1.i1.s1",
      betyg: "B",
    });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    expect(svar.forening.senaste.nyckeltal.some((n) => n.status === "kritisk")).toBe(true);
    expect(svar.forening.senaste.betyg).toBe("B");
    const full = await hamtaRegisteranalys(beroenden(lager), "brf-pontonjaren-3-716420-0599", 2025);
    if (full.status !== "ok") throw new Error("förväntade ok");
    expect(full.vy.analys).toMatchObject({ betyg: "B", aldreVersion: true });
    expect(lager.db._allaRapporter()).toHaveLength(1);
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
      "nyckeltal",
      "rakenskapsar",
      "skannad",
    ]);
    expect(Object.keys(svar.forening.senaste.nyckeltal[0]!).sort()).toEqual([
      "figure",
      "id",
      "label",
      "status",
    ]);
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

describe("den publika sammanfattningen bär inget ur analysen utöver betyg och nyckeltal", () => {
  it("varken motivering, röda flaggor, frågor, föreningsblocket eller datakvalitet — på någon nivå, för något år", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2025 });
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2024 });
    const svar = await hamtaForening(beroenden(lager), "brf-pontonjaren-3-716420-0599");
    if (!("forening" in svar)) throw new Error("förväntade ok");
    expect(svar.forening.tidigare).toHaveLength(1);
    const alla = [...nycklar(svar)];
    for (const forbjuden of [
      "betygMotivering",
      "rodaFlaggor",
      "fragor",
      "forening",
      "datakvalitet",
      "sektioner",
      "forklaring",
      "benchmark",
      "vasentligaHandelser",
      "underhall",
      "lan",
    ]) {
      // The first segment is the response envelope `forening` itself.
      expect(alla.filter((k) => k.split(".").slice(1).includes(forbjuden))).toEqual([]);
    }
  });
});

describe("hamtaRegisteranalys (den lagrade fullständiga analysen av ett år)", () => {
  const SLUG = "brf-pontonjaren-3-716420-0599";
  const kontext: Kontext = { enhetId: "AAAAAAAAAAAAAAAAAAAAAA", principalId: null, ipHash: null };

  it("ger hela BRF-nivåanalysen för året, med frågor med ursprung analys (aldrig köparens luckor)", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2025 });
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3", ar: 2024, betyg: "D" });
    const svar = await hamtaRegisteranalys(beroenden(lager), SLUG, 2024, {
      kontext,
      behorighet: skapaBehorighet(),
    });
    if (svar.status !== "ok") throw new Error("förväntade ok");
    expect(svar.vy).toMatchObject({
      slug: SLUG,
      orgnr: "716420-0599",
      namn: "Brf Pontonjären 3",
      omrade: { slug: "kungsholmen", namn: "Kungsholmen" },
    });
    expect(svar.vy.analys).toMatchObject({
      rakenskapsar: 2024,
      betyg: "D",
      betygMotivering: "Motivering.",
      aldreVersion: false,
    });
    expect(svar.vy.analys.fragor.every((f) => f.ursprung === "analys")).toBe(true);
    expect(svar.vy.analys.fragor.map((f) => f.id)).toContain("f1");
    const alla = [...nycklar(svar)];
    for (const forbjuden of ["input", "prisanalys", "rantestress", "analysisId", "pdfHash"]) {
      expect(alla.filter((k) => k.split(".").includes(forbjuden))).toEqual([]);
    }
  });

  it("okänt år, skräpår, okänd slug → saknas; ett gammalt slug → omdirigera", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    for (const ar of [2019, Number.NaN, 2025.5, -1, 99999]) {
      expect(await hamtaRegisteranalys(beroenden(lager), SLUG, ar)).toEqual({ status: "saknas" });
    }
    expect(await hamtaRegisteranalys(beroenden(lager), "brf-finns-inte-111111-1111", 2025)).toEqual(
      { status: "saknas" },
    );
    await lager.db.registreraForening("716420-0599", "Brf Pontonjären Tre");
    await uppdateraRegisterForOrgnr(lager.db, "716420-0599");
    expect(await hamtaRegisteranalys(beroenden(lager), SLUG, 2025)).toEqual({
      status: "omdirigera",
      slug: "brf-pontonjaren-tre-716420-0599",
    });
  });

  it("nekad behörighet (se_registeranalys) → nekad, före allt läsarbete och utan kvot", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    const lasning = lager.db._registerLasning();
    const lasningar: string[] = [];
    const spionLasning = new Proxy(lasning, {
      get(target, prop, mottagare) {
        lasningar.push(String(prop));
        return Reflect.get(target, prop, mottagare);
      },
    });
    const konto = skapaFakeKontoDatabas({});
    const svar = await hamtaRegisteranalys(
      { lasning: spionLasning, kvot: { konto, ipHash: "d".repeat(64) } },
      SLUG,
      2025,
      {
        kontext,
        behorighet: skapaBehorighet({ ...STANDARD_POLICY, se_registeranalys: () => false }),
      },
    );
    expect(svar).toEqual({ status: "nekad", meddelande: REGISTERANALYS_NEKAD_MEDDELANDE });
    expect(lasningar).toEqual([]);
    expect(konto.kvot.size).toBe(0);
  });

  it("en policyregel som kastar släpps igenom som fel (fail closed)", async () => {
    const lager = skapaFakeLager();
    await expect(
      hamtaRegisteranalys(beroenden(lager), SLUG, 2025, {
        kontext,
        behorighet: skapaBehorighet({
          ...STANDARD_POLICY,
          se_registeranalys: () => {
            throw new Error("policy nere");
          },
        }),
      }),
    ).rejects.toThrow("policy nere");
  });

  it("samma kvot per IP som de andra registerläsningarna", async () => {
    const lager = skapaFakeLager();
    await lagg(lager, { orgnr: "716420-0599", namn: "Brf Pontonjären 3" });
    const konto = skapaFakeKontoDatabas({});
    const b = { lasning: lager.db._registerLasning(), kvot: { konto, ipHash: "e".repeat(64) } };
    for (let i = 0; i < REGISTER_LASNINGAR_PER_IP_OCH_TIMME; i++) await listaOmraden(b);
    expect(await hamtaRegisteranalys(b, SLUG, 2025)).toMatchObject({ status: "kvot" });
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
        nyckeltal: [],
      },
    } as unknown as RegisterForeningVy;
    expect(foreningBeskrivning(vy).length).toBeLessThanOrEqual(160);
  });
});

describe("rader utan slug är inte publika (områdesräkning och sitemap, som listorna)", () => {
  const lasning = {
    listaOmradeRader: async () => [
      { slug: "brf-a-1", registeromrade: "kungsholmen", analysdatum: "2026-01-01" },
      { slug: null, registeromrade: "kungsholmen", analysdatum: "2026-02-02" },
    ],
  } as unknown as ReturnType<FakeLager["db"]["_registerLasning"]>;

  it("listaOmraden räknar bara rader med slug", async () => {
    const svar = await listaOmraden({ lasning });
    if (!("omraden" in svar)) throw new Error("kvot");
    const kh = svar.omraden.find((o) => o.slug === "kungsholmen");
    expect(kh).toMatchObject({ antal: 1, senastUppdaterad: "2026-01-01" });
  });

  it("sitemap tar inte med den slug-lösa raden, varken som sida eller i lastmod", async () => {
    const poster = await hamtaSitemapPoster(lasning);
    expect(poster).toEqual([
      { path: "/brf", lastmod: "2026-01-01" },
      { path: "/brf/omrade/kungsholmen", lastmod: "2026-01-01" },
      { path: "/brf/brf-a-1", lastmod: "2026-01-01" },
    ]);
  });
});
