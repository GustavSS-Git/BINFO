import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: object) => ({ ...opts }),
  Link: ({ children, to, className }: { children?: unknown; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

const { Route } = await import("@/routes/om-oss");
const Sida = (Route as unknown as { component: () => React.ReactElement }).component;
const html = renderToStaticMarkup(<Sida />).replace(/\s+/g, " ");

describe("/om-oss", () => {
  it("har rubrik, löften och teamets bild", () => {
    for (const t of [
      "Säljaren har en expert. Nu har köparen också det.",
      "Varför vi skapade Binfo",
      "Inget att sälja",
      "Full transparens",
      "Ingen betalvägg",
      'src="/bilder/om-oss.jpg"',
    ]) {
      expect(html).toContain(t);
    }
  });

  it("kontaktadressen är Binfos gemensamma, inte privata adresser", () => {
    expect(html).toContain('href="mailto:contactbinfohere@gmail.com"');
    expect(html).not.toContain("kth.se");
  });

  it("säger aldrig att något är gratis", () => {
    expect(html.toLowerCase()).not.toContain("gratis");
  });

  it("länkar till sidor som finns", () => {
    for (const to of ["/analysera", "/kopguide"]) {
      expect(html).toContain(`href="${to}"`);
    }
  });
});
