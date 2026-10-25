import { describe, expect, it } from "vitest";
import { formateraPostnummer, postnummerInfoText, postnummerSiffror } from "./typer";

describe("postnummerSiffror", () => {
  it("accepts five digits with or without the space", () => {
    expect(postnummerSiffror("112 42")).toBe("11242");
    expect(postnummerSiffror(" 11242 ")).toBe("11242");
  });
  it("rejects anything else", () => {
    for (const s of ["", "1124", "112420", "112-42", "11a42"])
      expect(postnummerSiffror(s)).toBeNull();
  });
  it("formats back with a space", () => {
    expect(formateraPostnummer("11242")).toBe("112 42");
  });
});

describe("postnummerInfoText", () => {
  it("names the Stockholm area", () => {
    expect(
      postnummerInfoText({ status: "omrade", postnummer: "11242", omrade: "Kungsholmen" }),
    ).toEqual({
      text: "Område: Kungsholmen, Stockholm.",
      varning: false,
    });
  });
  it("explains the three kommun tiers without a warning", () => {
    const sthlm = postnummerInfoText({
      status: "kommun",
      postnummer: "14199",
      kommun: "Stockholm",
      tackning: "stockholm",
    });
    expect(sthlm?.text).toContain("hela Stockholm");
    const lan = postnummerInfoText({
      status: "kommun",
      postnummer: "17067",
      kommun: "Solna",
      tackning: "lan",
    });
    expect(lan).toEqual({
      text: "Kommun: Solna. Utanför Stockholms kommun blir värderingen grövre.",
      varning: false,
    });
    const utanfor = postnummerInfoText({
      status: "kommun",
      postnummer: "90325",
      kommun: "Umeå",
      tackning: "utanfor_lan",
    });
    expect(utanfor?.text).toContain("utanför Stockholms län");
    expect(utanfor?.varning).toBe(false);
  });
  it("an unknown postnummer with a likely kommun names it but does not warn", () => {
    const t = postnummerInfoText({ status: "okand", postnummer: "14100", trolig: "Huddinge" });
    expect(t?.text).toContain("Huddinge");
    expect(t?.varning).toBe(false);
  });
  it("a fully unknown postnummer warns", () => {
    expect(
      postnummerInfoText({ status: "okand", postnummer: "99999", trolig: null })?.varning,
    ).toBe(true);
  });
  it("nothing for an invalid value", () => {
    expect(postnummerInfoText({ status: "ogiltig" })).toBeNull();
  });
});
