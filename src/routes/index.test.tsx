import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sampleAnalysis } from "@/data/sampleAnalysis";
import { byggStartExempel } from "@/lib/startExempel";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: object) => ({ ...opts }),
  Link: ({ children, to }: { children?: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));

const { Route } = await import("@/routes/index");
const Sida = (Route as unknown as { component: () => React.ReactElement }).component;
const html = renderToStaticMarkup(<Sida />).replace(/\s+/g, " ");

describe("/ (startsidan)", () => {
  it("har den ritade rubriken, knapparna och kedjan av länkar", () => {
    expect(html).toContain("Säljaren har en mäklare. Nu har du Binfo.");
    expect(html).toContain("Oberoende beslutsstöd för bostadsköpare");
    for (const href of ["/analysera", "/exempel", "/bolanekalkyl", "/kopguide", "/brf"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain('id="register"');
    expect(html).toContain("Tolv steg");
  });

  it("nämner inte gratis eller valfritt", () => {
    expect(html).not.toMatch(/gratis|valfri/i);
    expect(html).toContain("Inte kopplat till mäklare eller bank");
  });

  it("exempelblocket visar siffrorna från exempelanalysen", () => {
    const e = byggStartExempel(sampleAnalysis);
    for (const t of [
      e.undertext,
      e.forening.titel,
      e.forening.text,
      e.vardering.varde,
      e.vardering.spann,
      e.avgift.varde,
      e.avgift.rad,
      ...e.nyckeltal.map((r) => r.varde),
    ]) {
      expect(t).toBeTruthy();
      expect(html).toContain(String(t).replace(/\s+/g, " ").replace(/&/g, "&amp;"));
    }
  });

  it("länkar inte till ankare som saknas", () => {
    expect(html).not.toMatch(/href="#(foreningen|priset|kostnaden)"/);
  });
});
