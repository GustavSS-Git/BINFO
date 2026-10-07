import { describe, expect, it } from "vitest";
import { avkodaPostnummerLista, kodaPostnummerLista } from "./kommunKodning";

describe("kommunKodning", () => {
  it("round-trips an unsorted list into sorted 5-digit postnummer", () => {
    const ut = avkodaPostnummerLista(kodaPostnummerLista(["41101", "10004", "99999", "10005"]));
    expect(ut).toEqual(["10004", "10005", "41101", "99999"]);
  });

  it("handles the empty list", () => {
    expect(kodaPostnummerLista([])).toBe("");
    expect(avkodaPostnummerLista("")).toEqual([]);
  });

  it("rejects malformed and duplicate postnummer instead of encoding them", () => {
    expect(() => kodaPostnummerLista(["1234"])).toThrow();
    expect(() => kodaPostnummerLista(["10004", "10004"])).toThrow();
    expect(() => avkodaPostnummerLista("zz,!!")).toThrow();
  });
});
