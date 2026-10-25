import { describe, expect, it, vi } from "vitest";
import { extraktion } from "./__fixtures__/extraktion";
import type { ExtractionResult, Grade, Status } from "@/types/analysis";
import {
  klampaBetyg,
  kontrolleraBedomning,
  raknaStatusar,
  SKANNAD_KONFIDENS_SKAL,
  slutforAnalys,
  slutforBedomning,
  slutforExtraktion,
  tillatnaBetyg,
} from "./slutfor";

const ctx = { pdfSaknarTextlager: false, kalla: "textlager" as const };
const rå = () => structuredClone(extraktion) as unknown as Record<string, unknown>;

const bedomning = {
  betyg: "C",
  betygMotivering: "Motivering.",
  rodaFlaggor: [],
  fragor: [],
};

describe("slutforExtraktion", () => {
  it("validerar, graderar och returnerar utan att röra indata", () => {
    const indata = rå();
    const kopia = structuredClone(indata);
    const r = slutforExtraktion(indata, ctx);
    expect(r.ok).toBe(true);
    expect(indata).toEqual(kopia);
  });

  it("tar bort modellens egna osaker-markeringar och skriver över datakvalitet.kalla", () => {
    const indata = rå() as { forening: { keyFigures: Array<{ figure: Record<string, unknown> }> } };
    indata.forening.keyFigures[0]!.figure["osaker"] = "modellen tycker så";
    const r = slutforExtraktion(indata, { ...ctx, kalla: "skannad", pdfSaknarTextlager: true });
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.extraction.forening.keyFigures[0]!.figure.osaker).toBeUndefined();
    expect(r.value.extraction.datakvalitet.kalla).toBe("skannad");
    expect(r.value.extraction.datakvalitet.extraktionKonfidens.skal).toContain(
      SKANNAD_KONFIDENS_SKAL,
    );
  });

  it("returnerar ett valideringsfel i stället för att kasta", () => {
    const r = slutforExtraktion({ forening: {} }, ctx);
    expect(r.ok).toBe(false);
  });

  it("kontrollerar sidhänvisningarna när sidtexter ges", () => {
    const sidtexter = new Map([[1, "en helt annan sida som inte innehåller något av citaten"]]);
    const r = slutforExtraktion(rå(), { ...ctx, sidtexter });
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.sidreferenser.length).toBeGreaterThan(0);
    expect(r.value.extraction.datakvalitet.extraktionKonfidens.niva).not.toBe("hog");
  });
});

describe("slutforBedomning / slutforAnalys", () => {
  it("avvisar en sida som inte finns i extraktionen", () => {
    const fel = {
      ...bedomning,
      rodaFlaggor: [] as unknown[],
      fragor: [
        {
          id: "f",
          fraga: "?",
          ursprung: "analys",
          riktadTill: "styrelsen",
          varfor: "v",
          ref: { page: 99, excerpt: "x" },
        },
      ],
    };
    expect(slutforBedomning(extraktion, fel).ok).toBe(false);
    expect(slutforBedomning(extraktion, bedomning).ok).toBe(true);
  });

  it("slutforAnalys kör båda halvorna och anger vilket steg som föll", () => {
    expect(slutforAnalys(rå(), bedomning, ctx).ok).toBe(true);
    expect(slutforAnalys({}, bedomning, ctx)).toMatchObject({ ok: false, steg: "extraktion" });
    expect(slutforAnalys(rå(), { betyg: "Z" }, ctx)).toMatchObject({
      ok: false,
      steg: "bedomning",
    });
  });
});

/** The fixture extraction with its key figures given these statuses (in order; the rest stay "okant"). */
function medStatusar(statusar: Status[]): ExtractionResult {
  const kopia = structuredClone(extraktion) as ExtractionResult;
  kopia.forening.keyFigures.forEach((kf, i) => {
    kf.status = statusar[i] ?? "okant";
  });
  return kopia;
}

describe("tillatnaBetyg", () => {
  it("0 svag, 0 kritisk -> A, B, C", () => {
    expect(tillatnaBetyg({ svag: 0, kritisk: 0 })).toEqual(["A", "B", "C"]);
  });

  it("1 svag, 0 kritisk -> B, C", () => {
    expect(tillatnaBetyg({ svag: 1, kritisk: 0 })).toEqual(["B", "C"]);
  });

  it(">=2 svag, 0 kritisk -> C only (boundary 2, and the maximum of 7)", () => {
    expect(tillatnaBetyg({ svag: 2, kritisk: 0 })).toEqual(["C"]);
    expect(tillatnaBetyg({ svag: 3, kritisk: 0 })).toEqual(["C"]);
    expect(tillatnaBetyg({ svag: 7, kritisk: 0 })).toEqual(["C"]);
  });

  it("any kritisk -> C, D, E regardless of the number of svag", () => {
    for (const svag of [0, 1, 2, 5]) {
      for (const kritisk of [1, 2, 7]) {
        expect(tillatnaBetyg({ svag, kritisk })).toEqual(["C", "D", "E"]);
      }
    }
  });
});

describe("raknaStatusar", () => {
  it("counts svag and kritisk of the key figures, ignoring the rest", () => {
    const e = medStatusar(["god", "svag", "svag", "kritisk", "okant", "acceptabel", "god"]);
    expect(raknaStatusar(e)).toEqual({ svag: 2, kritisk: 1 });
    expect(raknaStatusar(medStatusar([]))).toEqual({ svag: 0, kritisk: 0 });
  });
});

describe("klampaBetyg", () => {
  const ingen = tillatnaBetyg({ svag: 0, kritisk: 0 }); // A-C
  const enSvag = tillatnaBetyg({ svag: 1, kritisk: 0 }); // B-C
  const flerSvaga = tillatnaBetyg({ svag: 2, kritisk: 0 }); // C
  const medKritisk = tillatnaBetyg({ svag: 1, kritisk: 1 }); // C-E

  it("clamps D and E down to the top of the no-kritisk bands", () => {
    expect(klampaBetyg("D", ingen)).toBe("C");
    expect(klampaBetyg("E", ingen)).toBe("C");
    expect(klampaBetyg("D", enSvag)).toBe("C");
    expect(klampaBetyg("E", flerSvaga)).toBe("C");
  });

  it("clamps A up to B with exactly one svag, and to C with two or more", () => {
    expect(klampaBetyg("A", enSvag)).toBe("B");
    expect(klampaBetyg("A", flerSvaga)).toBe("C");
    expect(klampaBetyg("B", flerSvaga)).toBe("C");
  });

  it("clamps A and B up to C with a kritisk figure", () => {
    expect(klampaBetyg("A", medKritisk)).toBe("C");
    expect(klampaBetyg("B", medKritisk)).toBe("C");
  });

  it("leaves letters inside the set untouched", () => {
    for (const g of ["A", "B", "C"] as Grade[]) expect(klampaBetyg(g, ingen)).toBe(g);
    for (const g of ["B", "C"] as Grade[]) expect(klampaBetyg(g, enSvag)).toBe(g);
    expect(klampaBetyg("C", flerSvaga)).toBe("C");
    for (const g of ["C", "D", "E"] as Grade[]) expect(klampaBetyg(g, medKritisk)).toBe(g);
  });
});

describe("slutforBedomning: deterministic grade check", () => {
  const med = (betyg: string) => ({ ...bedomning, betyg });

  it("clamps an impossible letter, returns ok and logs once with the context", () => {
    const loggar: unknown[][] = [];
    const e = medStatusar(["svag", "svag", "god"]);
    const r = slutforBedomning(e, med("E"), (...args) => loggar.push(args));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.betyg).toBe("C");
    expect(r.value.betygMotivering).toBe("Motivering.");
    expect(loggar).toHaveLength(1);
    const rad = JSON.stringify(loggar[0]);
    expect(rad).toContain("E");
    expect(rad).toContain("C");
    expect(rad).toContain("Brf Kastanjen");
    expect(rad).toContain("769612-3456");
    expect(rad).toContain('"svag":2');
    expect(rad).toContain('"kritisk":0');
  });

  it("clamps A with a kritisk figure", () => {
    const loggar: unknown[][] = [];
    const e = medStatusar(["kritisk", "god"]);
    const r = slutforBedomning(e, med("A"), (...args) => loggar.push(args));
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.betyg).toBe("C");
    expect(loggar).toHaveLength(1);
  });

  it("does not log or change a letter inside the set", () => {
    const loggar: unknown[][] = [];
    const e = medStatusar(["kritisk"]);
    const r = slutforBedomning(e, med("D"), (...args) => loggar.push(args));
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.betyg).toBe("D");
    expect(loggar).toHaveLength(0);
  });

  it("still fails on a Zod error, without logging", () => {
    const loggar: unknown[][] = [];
    const r = slutforBedomning(medStatusar([]), med("Z"), (...args) => loggar.push(args));
    expect(r.ok).toBe(false);
    expect(loggar).toHaveLength(0);
  });

  it("slutforAnalys applies the check through its composition", () => {
    // The fixture graded by berikaNyckeltal may or may not contain kritisk;
    // either way the result must be inside the allowed set.
    const varna = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = slutforAnalys(rå(), med("E"), ctx);
    varna.mockRestore();
    if (!r.ok) throw new Error("ogiltig");
    const tillatna = tillatnaBetyg(raknaStatusar(r.value.extraction));
    expect(tillatna).toContain(r.value.judgement.betyg);
  });
});

describe("kontrolleraBedomning: clamp metadata", () => {
  const med = (betyg: string) => ({ ...bedomning, betyg });
  const tyst = () => {};

  it("reports the clamp (model letter, new letter, band, counts) so the caller can fix the motivation", () => {
    const e = medStatusar(["svag", "svag", "god"]);
    const r = kontrolleraBedomning(e, med("B"), tyst);
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.judgement.betyg).toBe("C");
    expect(r.value.klampning).toEqual({
      modellensBetyg: "B",
      nyttBetyg: "C",
      tillatna: ["C"],
      antal: { svag: 2, kritisk: 0 },
    });
  });

  it("clamps up from A with exactly one svag", () => {
    const r = kontrolleraBedomning(medStatusar(["svag"]), med("A"), tyst);
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.judgement.betyg).toBe("B");
    expect(r.value.klampning?.modellensBetyg).toBe("A");
  });

  it("clamps down from E without any kritisk", () => {
    const r = kontrolleraBedomning(medStatusar(["god"]), med("E"), tyst);
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.judgement.betyg).toBe("C");
    expect(r.value.klampning).not.toBeNull();
  });

  it("returns klampning null when the letter is allowed", () => {
    const r = kontrolleraBedomning(medStatusar(["svag"]), med("B"), tyst);
    if (!r.ok) throw new Error("ogiltig");
    expect(r.value.klampning).toBeNull();
  });

  it("a Zod failure stays a failure", () => {
    expect(kontrolleraBedomning(medStatusar([]), { betyg: "Z" }, tyst).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The new optional fields of PROMPT_VERSION 9
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw model JSON in tests
type Rad = Record<string, any>;
const fig = (value: number | null, unit: string, page = 12, excerpt = "lånerad"): Rad => ({
  value,
  unit,
  source: "arsredovisning",
  ref: { page, excerpt },
});
const lanRad = (belopp: number, dag: string | undefined, extra: Rad = {}): Rad => ({
  kreditgivare: "SEB",
  belopp: fig(belopp, "kr"),
  ranta: fig(2.5, "procent"),
  ...(dag ? { villkorsandringsdag: dag } : {}),
  rantetyp: "okant",
  ref: { page: 12, excerpt: "lånerad" },
  ...extra,
});

function ok(raw: unknown) {
  const r = slutforExtraktion(raw, ctx);
  if (!r.ok) throw new Error(`ogiltig: ${r.zodError.message}`);
  return r.value.extraction;
}

describe("slutforExtraktion: lån (lanebok.lan)", () => {
  function medLan(lan: Rad[], forening: Rad = {}) {
    const a = rå() as Rad;
    delete a["forening"]["lanebok"]["forfalloprofil"];
    a["forening"]["lanebok"]["lan"] = lan;
    Object.assign(a["forening"], forening);
    return a;
  }

  it("härleder forfalloprofil ur lan och sätter rantetyp efter balansdagen", () => {
    const e = ok(
      medLan([lanRad(31_000_000, "2026-03-01"), lanRad(21_000_000, "2029-09-30")], {
        balansdag: "2025-12-31",
      }),
    );
    const lb = e.forening.lanebok!;
    expect(lb.lan!.map((l) => l.rantetyp)).toEqual(["rorlig", "okant"]);
    expect(lb.forfalloprofil!.map((p) => [p.ar, p.belopp.value])).toEqual([
      [2026, 31_000_000],
      [2029, 21_000_000],
    ]);
  });

  it("modellens rantetyp rorlig/bunden vinner över datumregeln", () => {
    const e = ok(medLan([lanRad(52_000_000, "2031-01-01", { rantetyp: "rorlig" })]));
    expect(e.forening.lanebok!.lan![0]!.rantetyp).toBe("rorlig");
  });

  it("släpper ett lån utan citat (tomt excerpt) i stället för att underkänna hela svaret", () => {
    const e = ok(
      medLan([
        lanRad(31_000_000, "2026-03-01"),
        lanRad(21_000_000, "2029-09-30", { ref: { page: 12, excerpt: "" } }),
        lanRad(1, "2029-09-30", { ref: { page: 12 } }),
      ]),
    );
    expect(e.forening.lanebok!.lan).toHaveLength(1);
    expect(e.forening.lanebok!.forfalloprofil).toHaveLength(1);
  });

  it("lånebelopp utan egen ref lånar lånradens ref; ogiltigt datum och okänd rantetyp rensas", () => {
    const rad = lanRad(31_000_000, "2026-13-45", { rantetyp: "fast" });
    delete rad["belopp"]["ref"];
    const e = ok(medLan([rad]));
    const l = e.forening.lanebok!.lan![0]!;
    expect(l.belopp.ref).toEqual({ page: 12, excerpt: "lånerad" });
    expect(l.villkorsandringsdag).toBeUndefined();
    expect(l.rantetyp).toBe("okant");
    expect(e.forening.lanebok!.forfalloprofil).toBeUndefined();
  });

  it("ett lån med belopp null släpps; är alla släppta försvinner lan och modellens forfalloprofil gäller", () => {
    const a = rå() as Rad;
    a["forening"]["lanebok"]["lan"] = [lanRad(1, "2026-03-01", { belopp: fig(null, "kr") })];
    const e = ok(a);
    expect(e.forening.lanebok!.lan).toBeUndefined();
    expect(e.forening.lanebok!.forfalloprofil).toHaveLength(2); // fixturens, orörd
  });

  it("utan lan behålls modellens forfalloprofil (gammalt beteende)", () => {
    const e = ok(rå());
    expect(e.forening.lanebok!.forfalloprofil!.map((p) => p.ar)).toEqual([2026, 2029]);
  });
});

describe("slutforExtraktion: övriga nya fält", () => {
  const med = (forening: Rad) => {
    const a = rå() as Rad;
    Object.assign(a["forening"], forening);
    return a;
  };

  it("balansdag: giltig behålls, ogiltig tas bort", () => {
    expect(ok(med({ balansdag: "2025-08-31" })).forening.balansdag).toBe("2025-08-31");
    expect(ok(med({ balansdag: "31/8 2025" })).forening.balansdag).toBeUndefined();
    expect(ok(med({ balansdag: "2025-02-31x" })).forening.balansdag).toBeUndefined();
  });

  it("bostadsrattsyta: kopieras till kontrollsummor (och tvärtom) när bara en finns", () => {
    const a = med({ bostadsrattsyta: fig(3750, "m2", 3, "Bostadsrättsarea 3 750 kvm") });
    const e = ok(a);
    expect(e.kontrollsummor?.bostadsrattsyta?.value).toBe(3750);

    const b = rå() as Rad;
    delete b["forening"]["bostadsrattsyta"];
    b["kontrollsummor"] = { bostadsrattsyta: fig(3200, "m2", 3, "Bostadsrättsarea 3 200 kvm") };
    expect(ok(b).forening.bostadsrattsyta?.value).toBe(3200);
  });

  it("planeradeKostnader: bara poster med belopp; okänd finansiering blir okant; underhallsfond behålls", () => {
    const e = ok(
      med({
        underhallsplan: {
          finns: "ja",
          planeradeKostnader: [
            {
              text: "Stambyte",
              fran: 2027,
              till: 2029,
              belopp: fig(12_000_000, "kr", 6, "Stambyte 12 mkr"),
              finansiering: "lan",
              ref: { page: 6, excerpt: "Stambyte 12 mkr" },
            },
            { text: "Fasad", belopp: fig(null, "kr"), finansiering: "okant" },
            { text: "Tak", finansiering: "okant" },
            {
              text: "Hiss",
              belopp: fig(500_000, "kr", 6, "Hiss 500 000"),
              finansiering: "kanske",
              fran: 2027.5,
            },
          ],
          underhallsfond: fig(850_000, "kr", 11, "Fond för yttre underhåll 850 000"),
          arligAvsattning: fig(null, "kr"),
        },
      }),
    );
    const plan = e.forening.underhallsplan!;
    expect(plan.planeradeKostnader!.map((k) => k.text)).toEqual(["Stambyte", "Hiss"]);
    expect(plan.planeradeKostnader![1]).toMatchObject({ finansiering: "okant" });
    expect(plan.planeradeKostnader![1]!.fran).toBeUndefined();
    expect(plan.underhallsfond?.value).toBe(850_000);
    expect(plan.arligAvsattning).toBeUndefined(); // null-värde = inget att behålla
  });

  it("sparandeUttag utan citat tas bort; med citat behålls", () => {
    expect(
      ok(med({ sparandeUttag: { planerat: "ja", finansierat: "ja" } })).forening.sparandeUttag,
    ).toBeUndefined();
    const e = ok(
      med({
        sparandeUttag: {
          planerat: "ja",
          finansierat: "ja",
          text: "Täcks av fonden.",
          ref: { page: 4, excerpt: "uttag ur fonden" },
        },
      }),
    );
    expect(e.forening.sparandeUttag).toMatchObject({ planerat: "ja", finansierat: "ja" });
  });

  it("lokaler: kontrakt utan citat släpps, tomt objekt försvinner; slutdatum valideras", () => {
    const e = ok(
      med({
        lokaler: {
          hyresintakter: fig(480_000, "kr", 9, "Hyresintäkter lokaler 480 000"),
          kontrakt: [
            { slutdatum: "2026-09-30", ref: { page: 5, excerpt: "avtalet löper till 2026-09-30" } },
            { slutdatum: "2027-01-01", ref: { page: 5 } },
            { slutdatum: "snart", ref: { page: 5, excerpt: "avtalet löper ut" } },
          ],
        },
      }),
    );
    expect(e.forening.lokaler!.hyresintakter?.value).toBe(480_000);
    expect(e.forening.lokaler!.kontrakt).toHaveLength(2);
    expect(e.forening.lokaler!.kontrakt![1]!.slutdatum).toBeUndefined();

    expect(
      ok(med({ lokaler: { kontrakt: [{ ref: { page: 5 } }] } })).forening.lokaler,
    ).toBeUndefined();
  });

  it("lokaler.kontrakt[].fornyelse (PROMPT_VERSION 12): uncited → dropped, bad nyttSlutdatum removed, lease kept", () => {
    const lease = (fornyelse: unknown) => ({
      slutdatum: "2026-12-31",
      ref: { page: 5, excerpt: "avtalet löper till 2026-12-31" },
      fornyelse,
    });
    const kontrakt = ok(
      med({
        lokaler: {
          kontrakt: [
            lease({
              text: "Avtalet har förlängts",
              nyttSlutdatum: "2029-12-31",
              ref: { page: 5, excerpt: "förlängts till 2029-12-31" },
            }),
            lease({ text: "Förlängt", ref: { page: 5 } }), // no excerpt
            lease({ text: "", ref: { page: 5, excerpt: "x" } }), // no text
            lease("förlängt"), // wrong shape
            lease({
              text: "Ny hyresgäst",
              nyttSlutdatum: "snart",
              ref: { page: 6, excerpt: "ny hyresgäst har skrivit på" },
              extra: 1,
            }),
          ],
        },
      }),
    ).forening.lokaler!.kontrakt!;
    expect(kontrakt).toHaveLength(5);
    expect(kontrakt[0]!.fornyelse).toEqual({
      text: "Avtalet har förlängts",
      nyttSlutdatum: "2029-12-31",
      ref: { page: 5, excerpt: "förlängts till 2029-12-31" },
    });
    expect(kontrakt[1]!.fornyelse).toBeUndefined();
    expect(kontrakt[2]!.fornyelse).toBeUndefined();
    expect(kontrakt[3]!.fornyelse).toBeUndefined();
    expect(kontrakt[4]!.fornyelse).toEqual({
      text: "Ny hyresgäst",
      ref: { page: 6, excerpt: "ny hyresgäst har skrivit på" },
    });
  });

  it("energiprojekt: finansierat utan citat blir okant; post utan text släpps", () => {
    const e = ok(
      med({
        energiprojekt: [
          { text: "Solceller", finansierat: "ja" },
          {
            text: "Bergvärme",
            finansierat: "ja",
            ref: { page: 5, excerpt: "bergvärme finansieras med lån" },
            belopp: fig(2_000_000, "kr", 5, "bergvärme 2 mkr"),
          },
          { text: "", finansierat: "nej" },
        ],
      }),
    );
    expect(e.forening.energiprojekt!.map((p) => [p.text, p.finansierat])).toEqual([
      ["Solceller", "okant"],
      ["Bergvärme", "ja"],
    ]);
  });

  it("lokaler.forlustsignaler (PROMPT_VERSION 11): uncited/empty items dropped, arshyra kept only when positive", () => {
    const e = ok(
      med({
        lokaler: {
          forlustsignaler: [
            {
              text: "Hyresgästen har sagt upp avtalet",
              arshyra: fig(200_000, "kr", 5, "hyra 200 000"),
              ref: { page: 5, excerpt: "hyresgästen har sagt upp" },
            },
            { text: "Lokalen står tom", ref: { page: 5 } }, // no excerpt
            { text: "", ref: { page: 5, excerpt: "tom" } },
            {
              text: "Hyresnedsättning",
              arshyra: fig(-5, "kr", 5, "x"),
              ref: { page: 6, excerpt: "hyran sänks" },
            },
          ],
        },
      }),
    );
    const sig = e.forening.lokaler!.forlustsignaler!;
    expect(sig.map((x) => x.text)).toEqual([
      "Hyresgästen har sagt upp avtalet",
      "Hyresnedsättning",
    ]);
    expect(sig[0]!.arshyra?.value).toBe(200_000);
    expect(sig[1]!.arshyra).toBeUndefined();
  });

  it("lokaler.forlustsignaler alone keeps lokaler; a wrong shape is dropped without failing", () => {
    expect(
      ok(
        med({
          lokaler: {
            forlustsignaler: [{ text: "Vakant", ref: { page: 2, excerpt: "lokalen är vakant" } }],
          },
        }),
      ).forening.lokaler?.forlustsignaler,
    ).toHaveLength(1);
    expect(
      ok(med({ lokaler: { forlustsignaler: "uppsagd", hyresintakter: fig(1, "kr", 2, "x") } }))
        .forening.lokaler,
    ).toEqual({ hyresintakter: expect.objectContaining({ value: 1 }) });
  });

  describe("avgiftsandringar (PROMPT_VERSION 11)", () => {
    const post = (extra: Rad = {}): Rad => ({
      procent: fig(25, "procent", 3, "hyreshöjning med 25%"),
      fran: "2024-05-01",
      status: "beslutad",
      text: "Höjning av årsavgiften med 25 % från 1 maj 2024",
      ref: { page: 3, excerpt: "hyreshöjning med 25% från 1 maj 2024" },
      ...extra,
    });
    const kor = (poster: unknown) =>
      ok(med({ avgiftsandringar: poster })).forening.avgiftsandringar;

    it("a good item is kept as is", () => {
      expect(kor([post()])).toEqual([post()]);
    });

    it("uncited, textless and malformed items are dropped", () => {
      const r = kor([
        post(),
        post({ ref: { page: 3 } }),
        post({ ref: undefined }),
        post({ text: " " }),
        post({ status: "kanske" }),
        post({ procent: fig(null, "procent") }),
        post({ procent: "25" }),
        "text",
      ]);
      expect(r).toHaveLength(1);
    });

    it("an invalid fran is removed (the item stays)", () => {
      const r = kor([
        post({ fran: "1 maj 2024" }),
        post({ fran: "2024-13-01", procent: fig(5, "procent", 3, "x") }),
      ]);
      expect(r).toHaveLength(2);
      expect(r![0]!.fran).toBeUndefined();
      expect(r![1]!.fran).toBeUndefined();
    });

    it("|procent| > 50 drops the item and logs; 50 and −10 are kept", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const r = kor([
        post({ procent: fig(51, "procent", 3, "x"), fran: "2025-01-01" }),
        post({ procent: fig(50, "procent", 3, "x"), fran: "2025-02-01" }),
        post({ procent: fig(-10, "procent", 3, "x"), fran: "2025-03-01" }),
        post({ procent: fig(-50.5, "procent", 3, "x"), fran: "2025-04-01" }),
      ]);
      expect(r!.map((x) => x.procent.value)).toEqual([50, -10]);
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it("a procent in another unit is dropped (kr is not a percentage)", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(kor([post({ procent: fig(25, "kr", 3, "x") })])).toBeUndefined();
      warn.mockRestore();
    });

    it("the same procent + fran twice counts once", () => {
      expect(
        kor([
          post(),
          post({ text: "Samma höjning på en annan sida", ref: { page: 8, excerpt: "25%" } }),
        ]),
      ).toHaveLength(1);
    });

    it("an empty or missing list removes the field", () => {
      expect(kor([])).toBeUndefined();
      expect(kor("nej")).toBeUndefined();
      const utan = rå() as Rad;
      delete utan["forening"]["avgiftsandringar"];
      expect(ok(utan).forening.avgiftsandringar).toBeUndefined();
    });

    it("procent without its own ref borrows the item's citation", () => {
      const r = kor([post({ procent: { value: 8, unit: "procent", source: "arsredovisning" } })]);
      expect(r![0]!.procent.ref).toEqual({
        page: 3,
        excerpt: "hyreshöjning med 25% från 1 maj 2024",
      });
    });
  });

  it("byggår saknas skrivs aldrig vidare som konfidensskäl", () => {
    const a = rå() as Rad;
    a["datakvalitet"]["extraktionKonfidens"] = {
      niva: "medel",
      skal: ["Byggår saknas i rapporten.", "Räntekänsligheten är svårläst."],
    };
    const e = ok(a);
    expect(e.datakvalitet.extraktionKonfidens.skal).toEqual(["Räntekänsligheten är svårläst."]);
  });
});

describe("slutforExtraktion: underhåll och genomförda åtgärder (PROMPT_VERSION 10)", () => {
  const med = (forening: Rad) => {
    const a = rå() as Rad;
    Object.assign(a["forening"], forening);
    return a;
  };
  const atgard = (byggdel: string, ar: unknown, extra: Rad = {}): Rad => ({
    byggdel,
    ar,
    text: `Åtgärd ${byggdel}`,
    ref: { page: 5, excerpt: `${byggdel} ${String(ar)}` },
    ...extra,
  });

  it("behåller giltiga åtgärder och släpper de ociterade, okända, framtida, för gamla och dubbletter", () => {
    // fixturen: byggår 1962, balansdag 2025-12-31
    const e = ok(
      med({
        genomfordaAtgarder: [
          atgard("tak", 2019),
          atgard("stambyte", 2021),
          atgard("stambyte", 2021, { text: "Relining igen" }), // dubblett
          atgard("fasad", 2020, { ref: { page: 5 } }), // ingen excerpt
          atgard("fasad", 2020, { ref: { page: 5, excerpt: "  " } }),
          atgard("balkong", 2020), // ej spårad byggdel
          atgard("hiss", 2026), // efter balansdagen: planerat, inte gjort
          atgard("el", 1940), // mer än 10 år före byggår
          atgard("ventilation", 2018.5),
          atgard("fonster", "2018"),
          atgard("el", 1952), // exakt byggår - 10: behålls
        ],
      }),
    );
    expect(e.forening.genomfordaAtgarder!.map((a) => [a.byggdel, a.ar])).toEqual([
      ["tak", 2019],
      ["stambyte", 2021],
      ["el", 1952],
    ]);
  });

  it("utan byggår gäller bara övre gränsen; utan balansdag används räkenskapsåret", () => {
    const a = med({ genomfordaAtgarder: [atgard("tak", 1930), atgard("hiss", 2026)] });
    delete a["forening"]["byggar"];
    delete a["forening"]["balansdag"];
    const e = ok(a);
    expect(e.forening.genomfordaAtgarder!.map((x) => x.ar)).toEqual([1930]);
  });

  it("ingen kvar -> fältet försvinner; icke-array -> fältet försvinner", () => {
    expect(
      ok(med({ genomfordaAtgarder: [atgard("tak", 2030)] })).forening.genomfordaAtgarder,
    ).toBeUndefined();
    expect(ok(med({ genomfordaAtgarder: "tak 2019" })).forening.genomfordaAtgarder).toBeUndefined();
  });

  it("investeringsbehov, rekommenderad avsättning och plantotal: giltiga behålls", () => {
    const e = ok(
      med({
        underhallsplan: {
          finns: "ja",
          investeringsbehovPerM2: fig(310, "kr/m2", 8, "Investeringsbehov kr/kvm 310"),
          rekommenderadAvsattning: fig(1_100_000, "kr", 6, "bör avsättas 1 100 000"),
          planTotal: { belopp: fig(45_000_000, "kr", 6, "45 Mkr under 30 år"), ar: 30 },
        },
      }),
    );
    const p = e.forening.underhallsplan!;
    expect(p.investeringsbehovPerM2?.value).toBe(310);
    expect(p.rekommenderadAvsattning?.value).toBe(1_100_000);
    expect(p.planTotal).toMatchObject({ ar: 30 });
    expect(p.planTotal!.belopp.value).toBe(45_000_000);
  });

  it("icke-positiva värden och plantotal med ar <= 0 eller utan belopp tas bort", () => {
    const planer = [
      {
        investeringsbehovPerM2: fig(0, "kr/m2", 8, "x"),
        rekommenderadAvsattning: fig(-5, "kr", 6, "x"),
        planTotal: { belopp: fig(45_000_000, "kr", 6, "x"), ar: 0 },
      },
      {
        investeringsbehovPerM2: fig(null, "kr/m2", 8, "x"),
        planTotal: { belopp: fig(null, "kr", 6, "x"), ar: 30 },
      },
      { planTotal: { belopp: fig(45_000_000, "kr", 6, "x"), ar: 29.5 } },
      { planTotal: "45 Mkr" },
    ];
    for (const p of planer) {
      const e = ok(med({ underhallsplan: { finns: "ja", ...p } })).forening.underhallsplan!;
      expect(e.investeringsbehovPerM2).toBeUndefined();
      expect(e.rekommenderadAvsattning).toBeUndefined();
      expect(e.planTotal).toBeUndefined();
    }
  });

  it("ett orimligt men positivt investeringsbehov markeras osäkert (inte borttaget) av rimlighetskontrollen", () => {
    const r = slutforExtraktion(
      med({
        underhallsplan: {
          finns: "ja",
          investeringsbehovPerM2: fig(310_000, "kr/m2", 8, "Investeringsbehov 310 000"),
        },
      }),
      ctx,
    );
    if (!r.ok) throw new Error(r.zodError.message);
    const f = r.value.extraction.forening.underhallsplan!.investeringsbehovPerM2!;
    expect(f.value).toBe(310_000);
    expect(f.osaker).toMatch(/rimliga intervallet/);
  });
});
