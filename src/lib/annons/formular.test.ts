import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annonsFaltVisning,
  annonsTristateText,
  boareaTillTal,
  foreningsHint,
  hamtaAnnonsUppgifter,
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
  ort: "",
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
      ort: "Stockholm",
    });
    expect(r.hiss).toBe("ja");
    expect(r.balkong).toBe("ja");
    for (const falt of ANNONS_FALT) expect(r.lage.ursprung[falt]).toBe("booli");
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

  it("hiss och balkong sätts bara till ja: saknas behåller nuvarande val, aldrig nej", () => {
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
  });

  it("en andra hämtning ersätter hela ursprungstillståndet", () => {
    const forsta = tillampaAnnons(TOM_FORM, TRI, svar(FULLA));
    const markerad = markeraAndrad(forsta.lage, "boarea");
    expect(markerad.ursprung.boarea).toBe("manuellt");
    const andra = tillampaAnnons(
      forsta.form,
      { hiss: forsta.hiss, balkong: forsta.balkong },
      svar(
        { adress: "Annan gata 1", boarea: 60 },
        { url: "https://www.booli.se/bostad/719044", hamtad: "2026-10-24T11:00:00.000Z" },
      ),
    );
    expect(andra.lage.ursprung.boarea).toBe("booli");
    expect(andra.lage.ursprung.adress).toBe("booli");
    expect(andra.lage.ursprung.manadsavgift).toBe("saknas");
    expect(andra.lage.kalla).toEqual({
      url: "https://www.booli.se/bostad/719044",
      hamtad: "2026-10-24T11:00:00.000Z",
    });
    expect(andra.form.boarea).toBe("60");
    // Fält som nya annonsen saknar behåller värdet från den förra.
    expect(andra.form.manadsavgift).toBe("2 618");
    expect(andra.hiss).toBe("ja");
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
    const m = markeraAndrad(lage, "ort");
    expect(markeraAndrad(m, "ort")).toBe(m);
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
        "ort",
      ],
    });
    expect(kalla.oandradeFalt).toEqual(
      ANNONS_FALT.filter((f) => f !== "utgangspris" && f !== "hiss"),
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
