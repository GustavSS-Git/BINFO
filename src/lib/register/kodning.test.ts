import { describe, expect, it } from "vitest";
import { avkodaLopare, avkodaPostnummerLista, kodaLopare, kodaPostnummerLista } from "./kodning";

describe("postnummer list coding", () => {
  it("round-trips an unsorted list as a sorted one", () => {
    const koda = kodaPostnummerLista(["11630", "10031", "11242"]);
    expect(avkodaPostnummerLista(koda)).toEqual(["10031", "11242", "11630"]);
  });
  it("handles the empty list", () => {
    expect(kodaPostnummerLista([])).toBe("");
    expect(avkodaPostnummerLista("")).toEqual([]);
  });
  it("rejects bad and duplicate postnummer", () => {
    expect(() => kodaPostnummerLista(["1124"])).toThrow();
    expect(() => kodaPostnummerLista(["11242", "11242"])).toThrow();
    expect(() => avkodaPostnummerLista("!")).toThrow();
  });
});

describe("run coding", () => {
  it("round-trips runs", () => {
    const v = [0, 0, 0, 5, 5, 18, 0, 0];
    expect(kodaLopare(v)).toBe("0:3,5:2,i:1,0:2");
    expect(avkodaLopare(kodaLopare(v))).toEqual(v);
  });
  it("handles the empty sequence and rejects negatives", () => {
    expect(kodaLopare([])).toBe("");
    expect(avkodaLopare("")).toEqual([]);
    expect(() => kodaLopare([-1])).toThrow();
  });
});
