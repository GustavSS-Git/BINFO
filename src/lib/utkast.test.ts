import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AnalysUtkastSchema,
  UTKAST_TTL_MS,
  VarderingUtkastSchema,
  lasUtkast,
  lasUtkastMal,
  rensaUtkast,
  skrivUtkast,
  type StorageLike,
  type UtkastLager,
} from "@/lib/utkast";

function minneslager(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const trasigt: StorageLike = {
  getItem: () => {
    throw new Error("spärrad");
  },
  setItem: () => {
    throw new Error("full");
  },
  removeItem: () => {
    throw new Error("spärrad");
  },
};

const utkast = {
  form: {
    utgangspris: "",
    boarea: "58",
    antalRum: "2",
    manadsavgift: "3240",
    postnummer: "11625",
    vaning: "4",
    byggar: "",
  },
  hiss: "ja",
  balkong: "okant",
  etikett: "Hornsgatan",
};

const NU = 1_800_000_000_000;

describe("utkast", () => {
  it("skriver till båda lagren och läser tillbaka", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: minneslager() };
    expect(skrivUtkast("vardering", utkast, "/analysera", lager, NU)).toBe(true);
    const u = lasUtkast("vardering", VarderingUtkastSchema, lager, NU + 1000);
    expect(u?.data).toEqual(utkast);
    expect(u?.till).toBe("/analysera");
  });

  it("hittar utkastet i localStorage-spegeln när sessionStorage är tom (ny flik)", () => {
    const lokal = minneslager();
    skrivUtkast("vardering", utkast, "/analysera", { session: null, lokal }, NU);
    const nyFlik: UtkastLager = { session: minneslager(), lokal };
    expect(lasUtkast("vardering", VarderingUtkastSchema, nyFlik, NU)?.data.etikett).toBe(
      "Hornsgatan",
    );
  });

  it("ignorerar ett utgånget utkast (äldre än 24 timmar)", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: minneslager() };
    skrivUtkast("vardering", utkast, "/analysera", lager, NU);
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU + UTKAST_TTL_MS)).not.toBeNull();
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU + UTKAST_TTL_MS + 1)).toBeNull();
  });

  it("ignorerar ett utkast av fel form (schema matchar inte)", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: minneslager() };
    skrivUtkast("vardering", { annat: true }, "/analysera", lager, NU);
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU)).toBeNull();
  });

  it("ignorerar skräp och fel typ", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: minneslager() };
    lager.session?.setItem("binfo:utkast:vardering", "{inte json");
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU)).toBeNull();
    skrivUtkast("kalkyl", utkast, "/bolanekalkyl", lager, NU);
    // Ett kalkylutkast läses aldrig som värdering.
    expect(
      lasUtkast("vardering", z.unknown(), { session: minneslager(), lokal: null }, NU),
    ).toBeNull();
  });

  it("kastar aldrig när lagringen är spärrad", () => {
    const lager: UtkastLager = { session: trasigt, lokal: trasigt };
    expect(skrivUtkast("vardering", utkast, "/analysera", lager, NU)).toBe(false);
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU)).toBeNull();
    expect(() => rensaUtkast("vardering", lager)).not.toThrow();
  });

  it("lyckas om bara ett lager fungerar", () => {
    const lokal = minneslager();
    expect(skrivUtkast("vardering", utkast, "/analysera", { session: trasigt, lokal }, NU)).toBe(
      true,
    );
    expect(
      lasUtkast("vardering", VarderingUtkastSchema, { session: trasigt, lokal }, NU),
    ).not.toBeNull();
  });

  it("rensa tar bort från båda lagren (så att en omladdning inte sparar två gånger)", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: minneslager() };
    skrivUtkast("vardering", utkast, "/analysera", lager, NU);
    rensaUtkast("vardering", lager);
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU)).toBeNull();
  });

  it("sanerar målet som sparas i utkastet", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: null };
    skrivUtkast("vardering", utkast, "https://evil.example/", lager, NU);
    expect(lasUtkast("vardering", VarderingUtkastSchema, lager, NU)?.till).toBe("/");
  });

  it("lasUtkastMal ger sidan och typen för ett giltigt utkast", () => {
    const lager: UtkastLager = { session: null, lokal: minneslager() };
    expect(lasUtkastMal(lager, NU)).toBeNull();
    skrivUtkast("kalkyl", { x: 1 }, "/bolanekalkyl", lager, NU);
    expect(lasUtkastMal(lager, NU)).toEqual({ typ: "kalkyl", till: "/bolanekalkyl" });
  });
});

describe("utkast för Spara analysen", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  it("skrivs och läses med analys-typen; bara ett uuid godtas", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: minneslager() };
    expect(skrivUtkast("analys", { analysisId: ID }, "/forhandsvisning/" + ID, lager, NU)).toBe(
      true,
    );
    expect(lasUtkast("analys", AnalysUtkastSchema, lager, NU)).toEqual({
      till: "/forhandsvisning/" + ID,
      data: { analysisId: ID },
    });
    skrivUtkast("analys", { analysisId: "inte-ett-id" }, "/analys/x", lager, NU);
    expect(lasUtkast("analys", AnalysUtkastSchema, lager, NU)).toBeNull();
    skrivUtkast("analys", { analysisId: ID, extra: 1 }, "/analys/x", lager, NU);
    expect(lasUtkast("analys", AnalysUtkastSchema, lager, NU)).toBeNull();
  });

  it("lasUtkastMal hittar analysen (bekräftelselänken i en ny flik)", () => {
    const lager: UtkastLager = { session: null, lokal: minneslager() };
    skrivUtkast("analys", { analysisId: ID }, "/analys/" + ID, lager, NU);
    expect(lasUtkastMal(lager, NU)).toEqual({ typ: "analys", till: "/analys/" + ID });
  });

  it("utkastet gäller fortfarande högst 24 timmar", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: null };
    skrivUtkast("analys", { analysisId: ID }, "/analys/" + ID, lager, NU);
    expect(lasUtkast("analys", AnalysUtkastSchema, lager, NU + UTKAST_TTL_MS + 1)).toBeNull();
  });

  it("rensas per typ: ett analys-utkast rör inte värderingens", () => {
    const lager: UtkastLager = { session: minneslager(), lokal: null };
    skrivUtkast("analys", { analysisId: ID }, "/analys/" + ID, lager, NU);
    skrivUtkast("vardering", { x: 1 }, "/analysera", lager, NU);
    rensaUtkast("analys", lager);
    expect(lasUtkast("analys", AnalysUtkastSchema, lager, NU)).toBeNull();
    expect(lasUtkast("vardering", z.unknown(), lager, NU)).not.toBeNull();
  });
});
