import { describe, expect, it } from "vitest";
import { stripMarkdownFence, toBase64 } from "./runExtraction";

describe("toBase64", () => {
  // Buffer är Node-only och finns inte i Cloudflare Workers, dit appen
  // byggs. Kodningen måste därför göras med webbstandard (btoa) — men den
  // måste ge exakt samma resultat som Buffer gjorde, annars skickas en
  // trasig PDF till API:et. Buffer används här enbart som facit i testet.
  it("ger samma resultat som Buffer för en enkel byte-sekvens", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("ger samma resultat som Buffer för godtyckliga bytes", () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("hanterar tom indata", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
  });

  it.each([1, 2, 3, 4, 5])("hanterar längd %i (base64-padding)", (n) => {
    const bytes = new Uint8Array(n).fill(200);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  // En årsredovisning i korpusen är 11,4 MB. En naiv
  // String.fromCharCode(...bytes) spräcker anropsstacken långt innan dess,
  // så chunkningen måste bevisas på en realistisk storlek.
  it("klarar en 12 MB-buffert utan att spräcka anropsstacken", () => {
    const bytes = new Uint8Array(12 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i += 997) bytes[i] = i % 256;
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("stripMarkdownFence", () => {
  it("lämnar text utan kodstaket orörd", () => {
    expect(stripMarkdownFence('{"a":1}')).toBe('{"a":1}');
  });

  it("tar bort ett komplett ```json ... ``` kodstaket", () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it("tar bort ett komplett bart ``` kodstaket (utan 'json')", () => {
    const input = '```\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it("tar bort ett inledande kodstaket även utan avslutande — en avbruten (max_tokens) respons har annars ingen avslutande ``` alls", () => {
    const input = '```json\n{"a": 1, "b": "ofull';
    expect(stripMarkdownFence(input)).toBe('{"a": 1, "b": "ofull');
  });

  it("hanterar whitespace kring kodstaketen", () => {
    const input = '  ```json\n{"a":1}\n```  ';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });
});
