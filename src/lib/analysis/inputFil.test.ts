import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { kontrolleraInputfil, kontrolleraInputfilText } from "./inputFil";

const exempel = (): { input: Record<string, unknown> } =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "fixtures", "property-input-example.json"), "utf-8"),
  );

describe("kontrolleraInputfil", () => {
  it("accepts the committed example file without warnings about required fields", () => {
    const r = kontrolleraInputfil(exempel());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.orgnr).toBe("769616-0253");
      // The example has utgangspris but no byggår/våning, and hiss is okant.
      expect(r.varningar.some((v) => v.startsWith("input.byggar"))).toBe(true);
      expect(r.varningar.some((v) => v.startsWith("input.hiss"))).toBe(true);
      expect(r.varningar.some((v) => v.startsWith("input.utgangspris"))).toBe(false);
    }
  });

  it("refuses what the schema refuses: the real failure (missing andelstal and orgnr)", () => {
    const f = exempel();
    delete f.input["andelstal"];
    delete f.input["orgnr"];
    const r = kontrolleraInputfil(f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fel).toEqual(["input.andelstal: Required", "input.orgnr: Required"]);
    }
  });

  it("refuses a wrong type and an unknown key (a typo in an optional field must not vanish)", () => {
    const f = exempel();
    f.input["boarea"] = "54";
    f.input["byggår"] = 1962;
    const r = kontrolleraInputfil(f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fel.join("\n")).toContain("input.boarea");
      expect(r.fel.join("\n")).toContain("Unrecognized key");
    }
    expect(kontrolleraInputfil({ input: exempel().input, extra: 1 }).ok).toBe(false);
    expect(kontrolleraInputfil({}).ok).toBe(false);
    expect(kontrolleraInputfil(null).ok).toBe(false);
  });

  it("an absent optional field is only a warning; a fully specified file has none", () => {
    const f = exempel();
    delete f.input["utgangspris"];
    const utan = kontrolleraInputfil(f);
    expect(utan.ok).toBe(true);
    if (utan.ok) expect(utan.varningar.some((v) => v.startsWith("input.utgangspris"))).toBe(true);

    const full = exempel();
    Object.assign(full.input, { byggar: 1962, vaning: 3, hiss: "ja", balkong: "nej" });
    const r = kontrolleraInputfil(full);
    expect(r).toMatchObject({ ok: true, varningar: [] });
  });
});

describe("kontrolleraInputfilText", () => {
  it("reports invalid JSON as an error instead of throwing", () => {
    const r = kontrolleraInputfilText("{ inte json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fel[0]).toContain("inte giltig JSON");
  });

  it("parses and validates valid text", () => {
    expect(kontrolleraInputfilText(JSON.stringify(exempel())).ok).toBe(true);
  });
});
