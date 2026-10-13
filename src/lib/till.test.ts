import { describe, expect, it } from "vitest";
import {
  inloggningsSok,
  medSparaParam,
  parseKontoSok,
  parseSparaTyp,
  saneraTill,
  sessionLage,
} from "@/lib/till";

describe("saneraTill (open redirect)", () => {
  it.each(["/", "/konto", "/vardering", "/vardering?sparad=abc-123", "/analys/abc#del"])(
    "släpper igenom en egen sökväg: %s",
    (t) => {
      expect(saneraTill(t)).toBe(t);
    },
  );

  it.each([
    "https://evil.example/",
    "http://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "evil.example",
    "konto",
    "",
    "   ",
    "/ok\nhttps://evil.example",
    "/o\tk",
  ])("avvisar %j och ger reserven", (t) => {
    expect(saneraTill(t)).toBe("/konto");
  });

  it("avvisar icke-strängar och för långa värden", () => {
    expect(saneraTill(undefined)).toBe("/konto");
    expect(saneraTill(123)).toBe("/konto");
    expect(saneraTill({})).toBe("/konto");
    expect(saneraTill("/" + "a".repeat(400))).toBe("/konto");
  });

  it("använder angiven reserv", () => {
    expect(saneraTill("https://x.se", "/")).toBe("/");
  });
});

describe("medSparaParam", () => {
  it("lägger till spara på en ren sökväg", () => {
    expect(medSparaParam("/vardering", "vardering")).toBe("/vardering?spara=vardering");
  });
  it("behåller befintliga parametrar och ersätter spara", () => {
    expect(medSparaParam("/x?a=1&spara=kalkyl", "vardering")).toBe("/x?a=1&spara=vardering");
  });
  it("ändrar inget utan spara och saneras alltid", () => {
    expect(medSparaParam("/vardering", undefined)).toBe("/vardering");
    expect(medSparaParam("https://evil.example", "vardering")).toBe("/konto?spara=vardering");
  });
});

describe("sökparametrar", () => {
  it("parseSparaTyp släpper bara de två kända värdena", () => {
    expect(parseSparaTyp("vardering")).toBe("vardering");
    expect(parseSparaTyp("kalkyl")).toBe("kalkyl");
    expect(parseSparaTyp("annat")).toBeUndefined();
    expect(parseSparaTyp(1)).toBeUndefined();
  });
  it("parseKontoSok sanerar till och utelämnar saknade nycklar", () => {
    expect(parseKontoSok({})).toEqual({});
    expect(parseKontoSok({ till: "//evil.example", spara: "vardering" })).toEqual({
      till: "/konto",
      spara: "vardering",
    });
    expect(parseKontoSok({ till: "/vardering" })).toEqual({ till: "/vardering" });
  });
  it("inloggningsSok utelämnar tomma nycklar", () => {
    expect(inloggningsSok(undefined, undefined)).toEqual({});
    expect(inloggningsSok("/a", "kalkyl")).toEqual({ till: "/a", spara: "kalkyl" });
  });
});

describe("sessionLage", () => {
  it("tolkar frågeläget", () => {
    expect(sessionLage({ data: undefined, isError: false })).toBe("laddar");
    expect(sessionLage({ data: undefined, isError: true })).toBe("utloggad");
    expect(sessionLage({ data: { inloggad: false }, isError: false })).toBe("utloggad");
    expect(
      sessionLage({ data: { inloggad: true, epost: "a@b.se", principalId: "p" }, isError: false }),
    ).toBe("inloggad");
  });
});
