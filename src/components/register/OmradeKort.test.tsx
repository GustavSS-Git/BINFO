import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children: unknown;
    className?: string;
  }) => (
    <a href={params ? to.replace("$omrade", params["omrade"] ?? "") : to} className={className}>
      {children as never}
    </a>
  ),
}));

import { OmradeGrupp, OmradeKort } from "@/components/register/OmradeKort";
import type { RegisterOmradeKort } from "@/lib/registerVy";

const kort = (o: Partial<RegisterOmradeKort>): RegisterOmradeKort => ({
  slug: "norrmalm",
  namn: "Norrmalm",
  grupp: "Innerstaden",
  ordning: 2,
  antal: 1,
  senastUppdaterad: "2026-10-24T10:00:00.000Z",
  ...o,
});

describe("OmradeKort", () => {
  it("1 → '1 förening', flera → 'N föreningar', med datum utan år", () => {
    const ett = renderToStaticMarkup(<OmradeKort o={kort({})} />);
    expect(ett).toContain("1 förening · uppdaterad 24 okt.");
    expect(ett).not.toContain("1 föreningar");
    const flera = renderToStaticMarkup(
      <OmradeKort o={kort({ antal: 3, senastUppdaterad: "2026-10-25T10:00:00.000Z" })} />,
    );
    expect(flera).toContain("3 föreningar · uppdaterad 25 okt.");
  });

  it("länkar till området när det har föreningar", () => {
    expect(renderToStaticMarkup(<OmradeKort o={kort({})} />)).toContain(
      'href="/brf/omrade/norrmalm"',
    );
  });

  it("ett tomt område är ett grått kort utan länk: 'Inga föreningar ännu'", () => {
    const html = renderToStaticMarkup(
      <OmradeKort o={kort({ antal: 0, senastUppdaterad: null })} />,
    );
    expect(html).toContain("Inga föreningar ännu");
    expect(html).not.toContain("<a ");
    expect(html).toContain("bg-divider");
  });

  it("gruppen har rubrik och valfri ledtext", () => {
    const html = renderToStaticMarkup(
      <OmradeGrupp rubrik="Övriga Stockholm" hint="Ledtext." omraden={[kort({})]} />,
    );
    expect(html).toContain("Övriga Stockholm");
    expect(html).toContain("Ledtext.");
  });
});
