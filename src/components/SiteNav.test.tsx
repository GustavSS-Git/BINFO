import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: unknown; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));
vi.mock("@/lib/session", () => ({ useSession: () => ({ lage: "utloggad" }) }));

const kontakt = vi.hoisted(() => ({ KONTAKT_EPOST: "test@example.se" as string | null }));
vi.mock("@/lib/kontakt", () => kontakt);

import { SiteFooter, SiteNav } from "@/components/SiteNav";

describe("SiteFooter", () => {
  it("visar Kontakt (mailto) bara när adressen är satt", () => {
    kontakt.KONTAKT_EPOST = "test@example.se";
    const med = renderToStaticMarkup(<SiteFooter />);
    expect(med).toContain('href="mailto:test@example.se"');
    expect(med).toContain(">Kontakt<");

    kontakt.KONTAKT_EPOST = null;
    const utan = renderToStaticMarkup(<SiteFooter />);
    expect(utan).not.toContain("Kontakt");
    expect(utan).not.toContain("mailto:");
  });

  it("har sidfotsnavigering med integritet men utan 'Så räknar vi'", () => {
    const h = renderToStaticMarkup(<SiteFooter />);
    expect(h).toContain('aria-label="Sidfot"');
    expect(h).toContain("Integritet och personuppgifter");
    expect(h).not.toContain("Så räknar vi");
  });
});

describe("SiteNav", () => {
  it("har huvudmeny med fyra länkar och Logga in för utloggad", () => {
    const h = renderToStaticMarkup(<SiteNav />);
    expect(h).toContain('aria-label="Huvudmeny"');
    for (const t of ["Analysera", "BRF-register", "Bolånekalkyl", "Köpguide", "Logga in"]) {
      expect(h).toContain(t);
    }
  });
});
