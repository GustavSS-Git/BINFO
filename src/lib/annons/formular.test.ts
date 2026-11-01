import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annonsFaltMarkering,
  annonsResultatText,
  annonsTristateMarke,
  antalHamtade,
  annonsFaltVisning,
  annonsTristateText,
  ATTRIBUTION_BOOLI_TEXT,
  ATTRIBUTION_BOOLI_URL,
  booliKallaRad,
  boareaTillTal,
  foreningsHint,
  hamtaAnnonsUppgifter,
  HINT_BOOLI,
  HINT_GEOKODAT,
  HINT_SAKNAS,
  HINT_TOLKAT,
  markeraAndrad,
  tillAnnonsKalla,
  tillampaAnnons,
  TOM_LANK_MEDDELANDE,
  type AnnonsBeroenden,
} from "./formular";
import {
  ANNONS_FALT,
  ANNONS_MEDDELANDE,
  faltStatus,
  type AnnonsSvar,
  type AnnonsUppgifter,
} from "./typer";
import type { AnnonsUrlUtfall } from "./url";
import {
  harValideringsfel,
  validateraAnalyseraForm,
  type AnalyseraFormFields,
} from "@/lib/analyseraForm";
import { PropertyInputSchema } from "@/lib/analysis/schema";
import { buildPropertyInput } from "@/lib/analyseraForm";
import { harVarderingsfel, tillVarderingForm, validateraVarderingForm } from "@/lib/varderingForm";

type OkSvar = Extract<AnnonsSvar, { ok: true }>;

const TOM_FORM: AnalyseraFormFields = {
  utgangspris: "",
  boarea: "",
  vaning: "",
  manadsavgift: "",
  andelstal: "",
  organisationsnummer: "",
  adress: "",
  postnummer: "",
  antalRum: "",
  byggar: "",
};

const FULLA: AnnonsUppgifter = {
  adress: "Sandelsgatan 35",
  postnummer: "115 41",
  ort: "Stockholm",
  utgangspris: 4_500_000,
  manadsavgift: 2618,
  boarea: 41.5,
  antalRum: 2,
  vaning: 3,
  byggar: 1931,
  hiss: "ja",
  balkong: "ja",
  stadsdel: "Östermalm",
  forening: "Brf Exempel",
  maklarUrl: "https://maklare.example/objekt/1",
};

function svar(uppgifter: AnnonsUppgifter, over: Partial<OkSvar> = {}): OkSvar {
  return {
    ok: true,
    kalla: "booli",
    url: "https://www.booli.se/annons/6279984",
    uppgifter,
    status: faltStatus(uppgifter),
    tolkning: "struktur",
    hamtad: "2026-10-24T10:00:00.000Z",
    ...over,
  };
}

/** The listing values without the given keys (the listing didn't state them). */
function utan(u: AnnonsUppgifter, ...falt: (keyof AnnonsUppgifter)[]): AnnonsUppgifter {
  const kopia = { ...u };
  for (const f of falt) delete kopia[f];
  return kopia;
}

const OKEJ_KONTROLL = (ratt: string): AnnonsUrlUtfall => ({
  ok: true,
  url: ratt,
  typ: "annons",
  id: "6279984",
});

afterEach(() => vi.restoreAllMocks());

describe("hamtaAnnonsUppgifter", () => {
  const BOOLI = "https://www.booli.se/annons/6279984";

  function beroenden(over: Partial<AnnonsBeroenden> = {}) {
    const hamta = vi.fn(async (_url: string): Promise<AnnonsSvar> => svar(FULLA));
    const kontrollera = vi.fn(OKEJ_KONTROLL);
    return { kontrollera, hamta, ...over } as AnnonsBeroenden & {
      kontrollera: typeof kontrollera;
      hamta: typeof hamta;
    };
  }

  it("tomt fält ger en uppmaning och inget anrop", async () => {
    const b = beroenden();
    for (const tomt of ["", "   "]) {
      expect(await hamtaAnnonsUppgifter(tomt, b)).toEqual({
        typ: "fel",
        meddelande: TOM_LANK_MEDDELANDE,
      });
    }
    expect(TOM_LANK_MEDDELANDE).toBe("Klistra in en länk från Booli först.");
    expect(b.kontrollera).not.toHaveBeenCalled();
    expect(b.hamta).not.toHaveBeenCalled();
  });

  it.each(["fel_doman", "ogiltig_url"] as const)(
    "%s stoppas lokalt utan serveranrop",
    async (kod) => {
      const b = beroenden({
        kontrollera: vi.fn((): AnnonsUrlUtfall => ({ ok: false, errorCode: kod })),
      });
      expect(await hamtaAnnonsUppgifter("https://exempel.se/x", b)).toEqual({
        typ: "fel",
        meddelande: ANNONS_MEDDELANDE[kod],
      });
      expect(b.hamta).not.toHaveBeenCalled();
    },
  );

  it("anropar hamta exakt en gång med den kontrollerade URL:en och returnerar svaret", async () => {
    const b = beroenden({
      kontrollera: vi.fn((): AnnonsUrlUtfall => ({
        ok: true,
        url: BOOLI,
        typ: "annons",
        id: "6279984",
      })),
    });
    const utfall = await hamtaAnnonsUppgifter(`  ${BOOLI}?utm=1  `, b);
    expect(b.hamta).toHaveBeenCalledTimes(1);
    expect(b.hamta).toHaveBeenCalledWith(BOOLI);
    expect(utfall.typ).toBe("ok");
    if (utfall.typ === "ok") expect(utfall.svar.uppgifter).toEqual(FULLA);
  });

  it.each(["kvot", "avstangd", "ogiltig_url", "fel_doman"] as const)(
    "visar serverns text för %s",
    async (errorCode) => {
      const b = beroenden({
        hamta: vi.fn(async (): Promise<AnnonsSvar> => ({
          ok: false,
          errorCode,
          errorMessage: `Text för ${errorCode}`,
        })),
      });
      expect(await hamtaAnnonsUppgifter(BOOLI, b)).toEqual({
        typ: "fel",
        meddelande: `Text för ${errorCode}`,
      });
    },
  );

  it.each(["blockerad", "hittades_inte", "tolkning", "natverk"] as const)(
    "%s ger den allmänna texten, inte serverns",
    async (errorCode) => {
      const b = beroenden({
        hamta: vi.fn(async (): Promise<AnnonsSvar> => ({
          ok: false,
          errorCode,
          errorMessage: "internt",
        })),
      });
      expect(await hamtaAnnonsUppgifter(BOOLI, b)).toEqual({
        typ: "fel",
        meddelande: ANNONS_MEDDELANDE.allmant,
      });
    },
  );

  it("ett kastat fel loggas och ger den allmänna texten", async () => {
    const logg = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fel = new Error("nät");
    const b = beroenden({
      hamta: vi.fn(async () => {
        throw fel;
      }),
    });
    expect(await hamtaAnnonsUppgifter(BOOLI, b)).toEqual({
      typ: "fel",
      meddelande: ANNONS_MEDDELANDE.allmant,
    });
    expect(logg).toHaveBeenCalledWith("[analysera] hamtaAnnonsFn kastade:", fel);
  });

  it("får bara de två injicerade funktionerna: ingen värdering eller analys kan startas därifrån", async () => {
    const b = beroenden();
    // Hjälparen tar emot exakt { kontrollera, hamta }; allt annat är oåtkomligt för den.
    expect(Object.keys(b).sort()).toEqual(["hamta", "kontrollera"]);
    const andra = { hamtaPrisuppskattningFn: vi.fn(), skapaAnalysFn: vi.fn() };
    await hamtaAnnonsUppgifter(BOOLI, b);
    expect(andra.hamtaPrisuppskattningFn).not.toHaveBeenCalled();
    expect(andra.skapaAnalysFn).not.toHaveBeenCalled();
    expect(b.hamta).toHaveBeenCalledTimes(1);
  });
});

describe("tillampaAnnons", () => {
  const TRI = { hiss: "okant", balkong: "okant" } as const;

  it("fyller formuläret från ett komplett svar i de format fälten förväntar sig", () => {
    const r = tillampaAnnons({ ...TOM_FORM, andelstal: "1" }, TRI, svar(FULLA));
    expect(r.form).toEqual({
      ...TOM_FORM,
      andelstal: "1",
      utgangspris: "4 500 000",
      manadsavgift: "2 618",
      boarea: "41,5",
      antalRum: "2",
      postnummer: "115 41",
      vaning: "3",
      byggar: "1931",
      adress: "Sandelsgatan 35",
    });
    expect(r.hiss).toBe("ja");
    expect(r.balkong).toBe("ja");
    for (const falt of ANNONS_FALT.filter((f) => f !== "ort")) {
      expect(r.lage.ursprung[falt]).toBe("booli");
    }
    // Ort has no form field (owner 2026-10-26): never copied in, never shown.
    expect("ort" in r.form).toBe(false);
    expect(r.lage.ursprung.ort).toBe("saknas");
    expect(annonsFaltVisning(r.lage, "ort", "")).toEqual({});
    expect(r.lage.kalla).toEqual({
      url: "https://www.booli.se/annons/6279984",
      hamtad: "2026-10-24T10:00:00.000Z",
      maklarUrl: "https://maklare.example/objekt/1",
      forening: "Brf Exempel",
      stadsdel: "Östermalm",
    });
  });

  it("formaterar halva rum, decimaler, stora belopp och postnummer utan mellanslag", () => {
    const r = tillampaAnnons(
      TOM_FORM,
      TRI,
      svar({
        ...FULLA,
        antalRum: 2.5,
        boarea: 41,
        utgangspris: 12_345_678,
        manadsavgift: 999,
        postnummer: "11541",
        vaning: 0,
      }),
    );
    expect(r.form.antalRum).toBe("2,5");
    expect(r.form.boarea).toBe("41");
    expect(r.form.utgangspris).toBe("12 345 678");
    expect(r.form.manadsavgift).toBe("999");
    expect(r.form.postnummer).toBe("115 41");
    expect(r.form.vaning).toBe("0");
  });

  it("alla hittade fält klarar formulärets och priskollens validering (rundtur)", () => {
    for (const antalRum of [2, 2.5]) {
      for (const boarea of [41, 41.5, 100.3]) {
        const r = tillampaAnnons(TOM_FORM, TRI, svar({ ...FULLA, antalRum, boarea, vaning: 0 }));
        expect(harValideringsfel(validateraAnalyseraForm(r.form))).toBe(false);
        expect(harVarderingsfel(validateraVarderingForm(tillVarderingForm(r.form)))).toBe(false);
      }
    }
  });

  it("ett delvis svar rör inte fält som annonsen saknar", () => {
    const delvis: AnnonsUppgifter = {
      adress: "Torsvikssvängen 39",
      postnummer: "181 34",
      ort: "Lidingö",
      boarea: 100,
      antalRum: 4,
      vaning: 1,
      byggar: 1960,
    };
    const fore: AnalyseraFormFields = {
      ...TOM_FORM,
      utgangspris: "5 000 000",
      manadsavgift: "3 000",
    };
    const r = tillampaAnnons(fore, { hiss: "nej", balkong: "okant" }, svar(delvis));
    expect(r.form.utgangspris).toBe("5 000 000");
    expect(r.form.manadsavgift).toBe("3 000");
    expect(r.form.boarea).toBe("100");
    expect(r.lage.ursprung.utgangspris).toBe("saknas");
    expect(r.lage.ursprung.manadsavgift).toBe("saknas");
    expect(r.lage.ursprung.boarea).toBe("booli");
    expect(r.lage.kalla).not.toHaveProperty("forening");
    expect(r.lage.kalla).not.toHaveProperty("maklarUrl");
    expect(r.lage.kalla).not.toHaveProperty("stadsdel");
  });

  it("hiss och balkong: saknas behåller nuvarande val (okänt är inte nej)", () => {
    const saknas = svar(utan(FULLA, "hiss", "balkong"));
    for (const nu of ["ja", "nej", "okant"] as const) {
      const r = tillampaAnnons(TOM_FORM, { hiss: nu, balkong: nu }, saknas);
      expect(r.hiss).toBe(nu);
      expect(r.balkong).toBe(nu);
      expect(r.lage.ursprung.hiss).toBe("saknas");
      expect(r.lage.ursprung.balkong).toBe("saknas");
    }
    const bara = tillampaAnnons(
      TOM_FORM,
      { hiss: "nej", balkong: "nej" },
      svar(utan(FULLA, "balkong")),
    );
    expect(bara.hiss).toBe("ja");
    expect(bara.balkong).toBe("nej");
  });

  it("hiss och balkong 'nej' från annonsen (API:ts explicita 0) tillämpas med märket Booli", () => {
    const r = tillampaAnnons(
      TOM_FORM,
      { hiss: "okant", balkong: "ja" },
      svar({ ...FULLA, hiss: "nej", balkong: "nej" }),
    );
    expect(r.hiss).toBe("nej");
    expect(r.balkong).toBe("nej");
    expect(r.lage.ursprung.hiss).toBe("booli");
    expect(r.lage.ursprung.balkong).toBe("booli");
    expect(annonsTristateText(r.lage, "hiss", r.hiss)).toBe(HINT_BOOLI);
    expect(annonsTristateMarke(r.lage, "balkong", r.balkong)).toEqual({
      text: "Från annonsen",
      ton: "success",
    });
    expect(antalHamtade(r.lage)).toBe(
      antalHamtade(tillampaAnnons(TOM_FORM, TRI, svar(FULLA)).lage),
    );
    // "nej" från annonsen följer med till den sparade källan som oförändrat fält
    expect(tillAnnonsKalla(r.lage).oandradeFalt).toEqual(
      expect.arrayContaining(["hiss", "balkong"]),
    );
  });

  it("'nej' från en tidigare annons nollställs till okänt när nästa annons saknar uppgiften", () => {
    const forsta = tillampaAnnons(TOM_FORM, TRI, svar({ ...FULLA, hiss: "nej", balkong: "nej" }));
    expect(forsta.hiss).toBe("nej");
    const andra = tillampaAnnons(
      forsta.form,
      { hiss: forsta.hiss, balkong: forsta.balkong },
      svar(utan(FULLA, "hiss", "balkong")),
      forsta.lage,
    );
    expect(andra.hiss).toBe("okant");
    expect(andra.balkong).toBe("okant");
    // Ändrade köparen värdet (manuellt) behålls det.
    const andrad = tillampaAnnons(
      forsta.form,
      { hiss: "ja", balkong: forsta.balkong },
      svar(utan(FULLA, "hiss", "balkong")),
      markeraAndrad(forsta.lage, "hiss"),
    );
    expect(andrad.hiss).toBe("ja");
    expect(andrad.balkong).toBe("okant");
  });

  describe("en andra hämtning (med föregående läge)", () => {
    const ANDRA = svar(
      { adress: "Annan gata 1", boarea: 60 },
      { url: "https://www.booli.se/bostad/719044", hamtad: "2026-10-24T11:00:00.000Z" },
    );

    it("ersätter hela ursprungstillståndet och källan", () => {
      const forsta = tillampaAnnons(TOM_FORM, TRI, svar(FULLA));
      const markerad = markeraAndrad(forsta.lage, "boarea");
      expect(markerad.ursprung.boarea).toBe("manuellt");
      const andra = tillampaAnnons(
        forsta.form,
        { hiss: forsta.hiss, balkong: forsta.balkong },
        ANDRA,
        markerad,
      );
      expect(andra.lage.ursprung.boarea).toBe("booli");
      expect(andra.lage.ursprung.adress).toBe("booli");
      expect(andra.lage.ursprung.manadsavgift).toBe("saknas");
      expect(andra.lage.kalla).toEqual({
        url: "https://www.booli.se/bostad/719044",
        hamtad: "2026-10-24T11:00:00.000Z",
      });
      expect(andra.form.boarea).toBe("60");
    });

    it("fält som nya annonsen saknar och som kom från den förra töms (så hint och markering visas)", () => {
      const forsta = tillampaAnnons(TOM_FORM, TRI, svar(FULLA));
      const andra = tillampaAnnons(
        forsta.form,
        { hiss: forsta.hiss, balkong: forsta.balkong },
        ANDRA,
        forsta.lage,
      );
      for (const falt of [
        "manadsavgift",
        "utgangspris",
        "postnummer",
        "vaning",
        "byggar",
      ] as const) {
        expect(andra.form[falt]).toBe("");
        expect(andra.lage.ursprung[falt]).toBe("saknas");
        expect(annonsFaltVisning(andra.lage, falt, andra.form[falt])).toEqual({
          hint: HINT_SAKNAS,
          framhav: true,
        });
      }
      expect(andra.hiss).toBe("okant");
      expect(andra.balkong).toBe("okant");
      expect(andra.lage.ursprung.hiss).toBe("saknas");
    });

    it("fält som köparen ändrat (manuellt) behåller värdet utan hint", () => {
      const forsta = tillampaAnnons(TOM_FORM, TRI, svar(FULLA));
      const lage = markeraAndrad(
        markeraAndrad(markeraAndrad(forsta.lage, "manadsavgift"), "hiss"),
        "balkong",
      );
      const form = { ...forsta.form, manadsavgift: "3 100" };
      const andra = tillampaAnnons(form, { hiss: "nej", balkong: "nej" }, ANDRA, lage);
      expect(andra.form.manadsavgift).toBe("3 100");
      expect(andra.lage.ursprung.manadsavgift).toBe("saknas");
      expect(annonsFaltVisning(andra.lage, "manadsavgift", andra.form.manadsavgift)).toEqual({});
      expect(andra.hiss).toBe("nej");
      expect(andra.balkong).toBe("nej");
      // Ett fält som aldrig kom från annonsen och köparen fyllt i behålls också.
      expect(andra.form.andelstal).toBe(forsta.form.andelstal);
    });

    it("hiss/balkong från nya annonsen skriver över, även om köparen ändrat dem", () => {
      const forsta = tillampaAnnons(TOM_FORM, TRI, svar(utan(FULLA, "hiss")));
      const lage = markeraAndrad(forsta.lage, "balkong");
      const andra = tillampaAnnons(
        forsta.form,
        { hiss: "okant", balkong: "nej" },
        svar(FULLA),
        lage,
      );
      expect(andra.hiss).toBe("ja");
      expect(andra.balkong).toBe("ja");
      expect(andra.lage.ursprung.balkong).toBe("booli");
    });

    it("utan föregående läge behålls det köparen skrivit (första hämtningen)", () => {
      const fore: AnalyseraFormFields = { ...TOM_FORM, manadsavgift: "3 000" };
      const r = tillampaAnnons(fore, { hiss: "nej", balkong: "ja" }, ANDRA, null);
      expect(r.form.manadsavgift).toBe("3 000");
      expect(r.hiss).toBe("nej");
      expect(r.balkong).toBe("ja");
      expect(r.lage.ursprung.manadsavgift).toBe("saknas");
    });

    it("tolkatAvModell följer svarets tolkning", () => {
      expect(tillampaAnnons(TOM_FORM, TRI, svar(FULLA)).lage.tolkatAvModell).toBe(false);
      expect(
        tillampaAnnons(TOM_FORM, TRI, svar(FULLA, { tolkning: "llm" })).lage.tolkatAvModell,
      ).toBe(true);
    });
  });
});

describe("boareaTillTal", () => {
  it("tolkar som Boarea-fältets onChange", () => {
    expect(boareaTillTal("41,5")).toBe(41.5);
    expect(boareaTillTal("")).toBe(0);
    expect(boareaTillTal("abc")).toBe(0);
  });
});

describe("markeraAndrad", () => {
  const lage = tillampaAnnons(
    TOM_FORM,
    { hiss: "okant", balkong: "okant" },
    svar(utan(FULLA, "byggar")),
  ).lage;

  it("booli blir manuellt vid ändring, utan att röra andra fält", () => {
    const ny = markeraAndrad(lage, "boarea");
    expect(ny.ursprung.boarea).toBe("manuellt");
    expect(ny.ursprung.adress).toBe("booli");
    expect(lage.ursprung.boarea).toBe("booli"); // oföränderligt
  });

  it("hiss och balkong markeras som övriga fält", () => {
    expect(markeraAndrad(lage, "hiss").ursprung.hiss).toBe("manuellt");
    expect(markeraAndrad(lage, "balkong").ursprung.balkong).toBe("manuellt");
  });

  it("saknas förblir saknas, och manuellt förblir manuellt", () => {
    expect(lage.ursprung.byggar).toBe("saknas");
    expect(markeraAndrad(lage, "byggar")).toBe(lage);
    const m = markeraAndrad(lage, "adress");
    expect(markeraAndrad(m, "adress")).toBe(m);
  });

  it("fält utanför annonsen (andelstal) ändrar inget", () => {
    expect(markeraAndrad(lage, "andelstal")).toBe(lage);
  });
});

describe("tillAnnonsKalla", () => {
  it("tar med url, förening, mäklarlänk och hamtad; oandradeFalt i formulärordning", () => {
    const { lage } = tillampaAnnons(TOM_FORM, { hiss: "okant", balkong: "okant" }, svar(FULLA));
    const andrad = markeraAndrad(markeraAndrad(lage, "utgangspris"), "hiss");
    const kalla = tillAnnonsKalla(andrad);
    expect(kalla).toEqual({
      typ: "booli",
      url: "https://www.booli.se/annons/6279984",
      maklarUrl: "https://maklare.example/objekt/1",
      forening: "Brf Exempel",
      hamtad: "2026-10-24T10:00:00.000Z",
      oandradeFalt: [
        "boarea",
        "antalRum",
        "manadsavgift",
        "postnummer",
        "vaning",
        "byggar",
        "balkong",
        "adress",
      ],
    });
    expect(kalla.oandradeFalt).toEqual(
      ANNONS_FALT.filter((f) => f !== "utgangspris" && f !== "hiss" && f !== "ort"),
    );
  });

  it("utelämnar valfria nycklar som saknas och saknade fält ingår inte i oandradeFalt", () => {
    const { lage } = tillampaAnnons(
      TOM_FORM,
      { hiss: "okant", balkong: "okant" },
      svar({ adress: "A 1", boarea: 50 }),
    );
    const kalla = tillAnnonsKalla(lage);
    expect(kalla).not.toHaveProperty("maklarUrl");
    expect(kalla).not.toHaveProperty("forening");
    expect(kalla.oandradeFalt).toEqual(["boarea", "adress"]);
  });
});

describe("tillAnnonsKalla mot det strikta schemat", () => {
  const TRI = { hiss: "okant", balkong: "okant" } as const;

  function lageMed(over: Partial<AnnonsUppgifter>) {
    return tillampaAnnons(TOM_FORM, TRI, svar({ ...FULLA, ...over })).lage;
  }

  function propertyInput(lage: ReturnType<typeof lageMed>) {
    return buildPropertyInput(
      "brf",
      {
        ...TOM_FORM,
        boarea: "41,5",
        antalRum: "2",
        manadsavgift: "2 618",
        adress: "A 1",
      },
      {
        hiss: "okant",
        balkong: "okant",
        avgiftInkluderar: {
          varme: "okant",
          vatten: "okant",
          el: "okant",
          bredband: "okant",
          tv: "okant",
        },
        antalPersoner: 2,
      },
      tillAnnonsKalla(lage),
    );
  }

  it("giltiga värden tas med oförändrade", () => {
    const kalla = tillAnnonsKalla(lageMed({}));
    expect(kalla.maklarUrl).toBe("https://maklare.example/objekt/1");
    expect(kalla.forening).toBe("Brf Exempel");
    expect(PropertyInputSchema.safeParse(propertyInput(lageMed({}))).success).toBe(true);
  });

  it.each([
    ["URL med mellanslag", { maklarUrl: "https://maklare.example/a b" }],
    ["javascript:-URL", { maklarUrl: "javascript:alert(1)" }],
    ["för lång URL", { maklarUrl: `https://maklare.example/${"a".repeat(2000)}` }],
  ])("%s utelämnas men förening behålls och schemat godtar", (_namn, over) => {
    const lage = lageMed(over);
    const kalla = tillAnnonsKalla(lage);
    expect(kalla).not.toHaveProperty("maklarUrl");
    expect(kalla.forening).toBe("Brf Exempel");
    expect(PropertyInputSchema.safeParse(propertyInput(lage)).success).toBe(true);
  });

  it("för lång förening (201 tecken) utelämnas, mäklarlänken behålls, ingen trunkering", () => {
    const lage = lageMed({ forening: "B".repeat(201) });
    const kalla = tillAnnonsKalla(lage);
    expect(kalla).not.toHaveProperty("forening");
    expect(kalla.maklarUrl).toBe("https://maklare.example/objekt/1");
    expect(PropertyInputSchema.safeParse(propertyInput(lage)).success).toBe(true);
    expect(tillAnnonsKalla(lageMed({ forening: "B".repeat(200) })).forening).toHaveLength(200);
  });

  it("båda ogiltiga: båda utelämnas", () => {
    const lage = lageMed({ maklarUrl: "ftp://x", forening: "B".repeat(201) });
    const kalla = tillAnnonsKalla(lage);
    expect(kalla).not.toHaveProperty("maklarUrl");
    expect(kalla).not.toHaveProperty("forening");
    expect(PropertyInputSchema.safeParse(propertyInput(lage)).success).toBe(true);
  });
});

describe("visning per fält", () => {
  const { lage } = tillampaAnnons(
    TOM_FORM,
    { hiss: "okant", balkong: "okant" },
    svar(utan(FULLA, "utgangspris", "hiss")),
  );

  it("utan hämtning visas ingenting", () => {
    expect(annonsFaltVisning(null, "boarea", "")).toEqual({});
    expect(annonsTristateText(null, "hiss", "okant")).toBeUndefined();
    expect(foreningsHint(null)).toBeNull();
  });

  it("booli och manuellt ger respektive hint, utan markering", () => {
    expect(annonsFaltVisning(lage, "boarea", "41,5")).toEqual({ hint: "Hämtat från Booli" });
    expect(annonsFaltVisning(markeraAndrad(lage, "boarea"), "boarea", "50")).toEqual({
      hint: "Ändrat manuellt",
    });
  });

  it("saknas och tomt ger hint plus markering; saknas med värde ger ingenting", () => {
    expect(annonsFaltVisning(lage, "utgangspris", "")).toEqual({
      hint: "Fanns inte i annonsen, fyll i själv",
      framhav: true,
    });
    expect(annonsFaltVisning(lage, "utgangspris", "  ")).toMatchObject({ framhav: true });
    expect(annonsFaltVisning(lage, "utgangspris", "4 000 000")).toEqual({});
  });

  it("hiss/balkong: texter, och 'Framgår inte' bara medan valet är Vet ej", () => {
    expect(annonsTristateText(lage, "balkong", "ja")).toBe("Hämtat från Booli");
    expect(annonsTristateText(markeraAndrad(lage, "balkong"), "balkong", "nej")).toBe(
      "Ändrat manuellt",
    );
    expect(annonsTristateText(lage, "hiss", "okant")).toBe("Framgår inte av annonsen");
    expect(annonsTristateText(lage, "hiss", "ja")).toBeUndefined();
  });

  it("föreningstexten för steg 2", () => {
    expect(foreningsHint(lage)).toBe(
      "Booli anger föreningen: Brf Exempel. Kontrollera att årsredovisningen gäller den.",
    );
    const utan = tillampaAnnons(
      TOM_FORM,
      { hiss: "okant", balkong: "okant" },
      svar({ adress: "A 1" }),
    ).lage;
    expect(foreningsHint(utan)).toBeNull();
  });
});

describe("modelltolkade värden", () => {
  const tom = { hiss: "okant", balkong: "okant" } as const;

  it("visar 'Tolkat från annonsens text' i stället för 'Hämtat från Booli'", () => {
    expect(HINT_TOLKAT).toBe("Tolkat från annonsens text – kontrollera");
    const { lage } = tillampaAnnons(TOM_FORM, tom, svar(FULLA, { tolkning: "llm" }));
    expect(annonsFaltVisning(lage, "boarea", "41,5")).toEqual({ hint: HINT_TOLKAT });
    expect(annonsTristateText(lage, "hiss", "ja")).toBe(HINT_TOLKAT);
    expect(annonsFaltVisning(markeraAndrad(lage, "boarea"), "boarea", "50")).toEqual({
      hint: "Ändrat manuellt",
    });
  });

  it("geokodat postnummer behåller OSM-attributionen", () => {
    const { lage } = tillampaAnnons(
      TOM_FORM,
      tom,
      svar({ postnummer: "112 39" }, { tolkning: "llm", postnummerKalla: "geokodning" }),
    );
    expect(annonsFaltVisning(lage, "postnummer", "112 39")).toEqual({ hint: HINT_GEOKODAT });
  });

  it("strukturerade svar visar fortsatt 'Hämtat från Booli'", () => {
    const { lage } = tillampaAnnons(TOM_FORM, tom, svar(FULLA));
    expect(annonsFaltVisning(lage, "boarea", "41,5")).toEqual({ hint: HINT_BOOLI });
  });
});

describe("geokodat postnummer (OpenStreetMap)", () => {
  const tom = { hiss: "okant", balkong: "okant" } as const;

  it("märks med OSM-attribution i stället för 'Hämtat från Booli'", () => {
    const { lage } = tillampaAnnons(
      { ...TOM_FORM },
      tom,
      svar(
        { postnummer: "112 39", adress: "Sankt Eriksgatan 31A" },
        { postnummerKalla: "geokodning" },
      ),
    );
    expect(lage.postnummerGeokodat).toBe(true);
    expect(annonsFaltVisning(lage, "postnummer", "112 39")).toEqual({ hint: HINT_GEOKODAT });
    expect(annonsFaltVisning(lage, "adress", "Sankt Eriksgatan 31A")).toEqual({ hint: HINT_BOOLI });
  });

  it("postnummer från annonsen märks som vanligt", () => {
    const { lage } = tillampaAnnons(
      { ...TOM_FORM },
      tom,
      svar({ postnummer: "112 39" }, { postnummerKalla: "annons" }),
    );
    expect(lage.postnummerGeokodat).toBe(false);
    expect(annonsFaltVisning(lage, "postnummer", "112 39")).toEqual({ hint: HINT_BOOLI });
  });
});

describe("behörighetsfel från servern", () => {
  it("visar serverns text", async () => {
    const r = await hamtaAnnonsUppgifter("https://www.booli.se/annons/1", {
      kontrollera: () => ({
        ok: true,
        url: "https://www.booli.se/annons/1",
        typ: "annons",
        id: "1",
      }),
      hamta: async () => ({ ok: false, errorCode: "behorighet", errorMessage: "Nej." }),
    });
    expect(r).toEqual({ typ: "fel", meddelande: "Nej." });
  });
});

describe("redesign v4: märken och antal ifyllda uppgifter", () => {
  const tom = { hiss: "okant", balkong: "okant" } as const;

  it("antalHamtade räknar bara fält som faktiskt fylldes i (ort, saknade och hiss/balkong utan 'ja' räknas inte)", () => {
    const full = tillampaAnnons(TOM_FORM, tom, svar(FULLA)).lage;
    // adress, postnummer, utgångspris, avgift, boarea, rum, våning, byggår, hiss, balkong
    expect(antalHamtade(full)).toBe(10);
    const delvis = tillampaAnnons(
      TOM_FORM,
      tom,
      svar(utan(FULLA, "utgangspris", "hiss", "balkong", "byggar", "vaning")),
    ).lage;
    expect(antalHamtade(delvis)).toBe(5);
    expect(antalHamtade(markeraAndrad(delvis, "boarea"))).toBe(4);
  });

  it("resultattexten", () => {
    expect(annonsResultatText(8)).toBe(
      "Vi fyllde i 8 uppgifter från annonsen. Kontrollera dem nedan.",
    );
    expect(annonsResultatText(1)).toBe(
      "Vi fyllde i 1 uppgift från annonsen. Kontrollera dem nedan.",
    );
    expect(annonsResultatText(0)).toBe("Vi hittade inga uppgifter i annonsen. Fyll i dem nedan.");
  });

  it("märken: Från annonsen, Ändrat manuellt, Från OpenStreetMap, Tolkat från annonsen", () => {
    const { lage } = tillampaAnnons(TOM_FORM, tom, svar(utan(FULLA, "utgangspris")));
    expect(annonsFaltMarkering(lage, "boarea", "41,5")).toEqual({
      marke: { text: "Från annonsen", ton: "success" },
    });
    expect(annonsFaltMarkering(markeraAndrad(lage, "boarea"), "boarea", "50")).toEqual({
      marke: { text: "Ändrat manuellt", ton: "neutral" },
    });
    const geo = tillampaAnnons(
      TOM_FORM,
      tom,
      svar({ postnummer: "112 39" }, { postnummerKalla: "geokodning" }),
    ).lage;
    expect(annonsFaltMarkering(geo, "postnummer", "112 39")).toEqual({
      marke: { text: "Från OpenStreetMap", ton: "success" },
      hint: HINT_GEOKODAT,
    });
    const llm = tillampaAnnons(TOM_FORM, tom, svar(FULLA, { tolkning: "llm" })).lage;
    expect(annonsFaltMarkering(llm, "boarea", "41,5").marke).toEqual({
      text: "Tolkat från annonsen",
      ton: "warning",
    });
  });

  it("saknad + tom ger 'Fanns inte i annonsen, fyll i själv' och markering, inget märke", () => {
    const { lage } = tillampaAnnons(TOM_FORM, tom, svar(utan(FULLA, "byggar")));
    expect(annonsFaltMarkering(lage, "byggar", "")).toEqual({
      hint: HINT_SAKNAS,
      framhav: true,
    });
    expect(annonsFaltMarkering(lage, "byggar", "1965")).toEqual({});
    expect(annonsFaltMarkering(null, "byggar", "")).toEqual({});
    expect(annonsFaltMarkering(lage, "ort", "")).toEqual({});
  });

  it("hiss/balkong: märke vid 'ja' från annonsen, manuellt efter ändring, 'Framgår inte' vid okänt", () => {
    const { lage } = tillampaAnnons(TOM_FORM, tom, svar(utan(FULLA, "balkong")));
    expect(annonsTristateMarke(lage, "hiss", "ja")).toEqual({
      text: "Från annonsen",
      ton: "success",
    });
    expect(annonsTristateMarke(markeraAndrad(lage, "hiss"), "hiss", "nej")).toEqual({
      text: "Ändrat manuellt",
      ton: "neutral",
    });
    expect(annonsTristateMarke(lage, "balkong", "okant")).toEqual({
      text: "Framgår inte av annonsen",
      ton: "neutral",
    });
    expect(annonsTristateMarke(lage, "balkong", "ja")).toBeUndefined();
    expect(annonsTristateMarke(null, "hiss", "ja")).toBeUndefined();
  });
});

describe("attribution: Uppgifter från Booli", () => {
  it("texten och länken", () => {
    expect(ATTRIBUTION_BOOLI_TEXT).toBe("Uppgifter från Booli");
    expect(ATTRIBUTION_BOOLI_URL).toBe("https://www.booli.se");
  });

  it("källraden för rapporten finns bara när källan är Booli", () => {
    const kalla = {
      typ: "booli" as const,
      url: "https://www.booli.se/annons/6279984",
      hamtad: "2026-10-24T10:00:00.000Z",
      oandradeFalt: [],
    };
    expect(booliKallaRad(kalla)).toBe(
      "Uppgifter om bostaden hämtades från Booli (booli.se) den 24 okt. 2026.",
    );
    expect(booliKallaRad(undefined)).toBeNull();
  });

  it("raden nämner aldrig Boolis egen värdering", () => {
    const rad = booliKallaRad({
      typ: "booli",
      url: "https://www.booli.se/annons/1",
      hamtad: "2026-10-24T10:00:00.000Z",
      oandradeFalt: [],
    });
    expect(rad).not.toMatch(/uppskatt|värdering|estimate/i);
  });
});
