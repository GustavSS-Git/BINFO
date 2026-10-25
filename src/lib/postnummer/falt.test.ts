import { describe, expect, it } from "vitest";
import { postnummerFaltVisning } from "./falt";
import type { PostnummerInfo } from "./typer";

const omrade: PostnummerInfo = { status: "omrade", postnummer: "11625", omrade: "Södermalm" };
const okand: PostnummerInfo = { status: "okand", postnummer: "99999", trolig: null };

describe("postnummerFaltVisning", () => {
  it("returns nothing when there is nothing to show", () => {
    expect(postnummerFaltVisning({ info: null, annons: {} })).toEqual({});
    expect(postnummerFaltVisning({ info: { status: "ogiltig" }, annons: {} })).toEqual({});
  });
  it("shows the area text alone", () => {
    expect(postnummerFaltVisning({ info: omrade, annons: {} })).toEqual({
      hint: "Område: Södermalm, Stockholm.",
    });
  });
  it("joins area text and Booli text, keeps the Booli highlight", () => {
    expect(
      postnummerFaltVisning({
        info: omrade,
        annons: { hint: "Hämtat från Booli", framhav: true },
      }),
    ).toEqual({ hint: "Område: Södermalm, Stockholm. Hämtat från Booli", framhav: true });
  });
  it("a warning sets framhav", () => {
    const r = postnummerFaltVisning({ info: okand, annons: {} });
    expect(r.framhav).toBe(true);
    expect(r.hint).toContain("Kontrollera att det stämmer");
  });
});
