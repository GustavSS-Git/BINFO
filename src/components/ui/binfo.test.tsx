import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Länkarna renderas utanför en router i testet; useId stubbas så att komponenten
// kan anropas som en vanlig funktion när vi vill läsa dess element.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useId: () => "test-id",
}));

import {
  Badge,
  Button,
  Field,
  GRADE_FARG,
  GradeBadge,
  GradeLegend,
  GradeScale,
  Logo,
  SpanBar,
  StatusPill,
  TristateChoice,
} from "@/components/ui/binfo";

const html = (n: ReactNode) => renderToStaticMarkup(<>{n}</>);

function hittaInputs(nod: ReactNode, ut: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(nod)) nod.forEach((n) => hittaInputs(n, ut));
  else if (isValidElement(nod)) {
    const el = nod as ReactElement<Record<string, unknown>>;
    if (el.type === "input") ut.push(el);
    hittaInputs(el.props["children"] as ReactNode, ut);
  }
  return ut;
}

describe("GradeBadge", () => {
  it.each(["A", "B", "C", "D", "E"] as const)("betyg %s: namn, bokstav och egen färgklass", (b) => {
    const h = html(<GradeBadge grade={b} />);
    expect(h).toContain(`aria-label="Betyg ${b}"`);
    expect(h).toContain(`>${b}</span>`);
    expect(h).toContain(GRADE_FARG[b]);
    expect(h).toContain(`bg-grade-${b.toLowerCase()}`);
  });

  it("betygen har fem olika färgklasser", () => {
    expect(new Set(Object.values(GRADE_FARG)).size).toBe(5);
  });

  it("null visar ett neutralt streck utan betygsfärg", () => {
    const h = html(<GradeBadge grade={null} />);
    expect(h).toContain("–");
    expect(h).toContain('aria-label="Inget betyg"');
    expect(h).not.toContain("bg-grade-");
  });

  it("storlekarna är 28, 32 och 88 px", () => {
    expect(html(<GradeBadge grade="A" size="sm" />)).toContain("size-7");
    expect(html(<GradeBadge grade="A" size="md" />)).toContain("size-8");
    expect(html(<GradeBadge grade="A" size="lg" />)).toContain("size-[88px]");
  });
});

describe("GradeScale och GradeLegend", () => {
  it("GradeScale har skalans beskrivning som aria-label", () => {
    expect(html(<GradeScale grade="B" />)).toContain(
      'aria-label="Betyg B på skalan A till E, där A är starkast"',
    );
  });

  it("GradeLegend förklarar skalan", () => {
    const h = html(<GradeLegend />);
    expect(h).toContain("Betygsskala:");
    expect(h).toContain("A starkast, E svagast.");
    for (const b of ["A", "B", "C", "D", "E"]) expect(h).toContain(`aria-label="Betyg ${b}"`);
  });
});

describe("StatusPill", () => {
  it("okänd status visas som 'Ingen bedömning'", () => {
    expect(html(<StatusPill status="okant" />)).toContain("Ingen bedömning");
  });

  it("status ger sin standardetikett och tone en fri etikett", () => {
    expect(html(<StatusPill status="svag" />)).toContain(">Svag<");
    const fri = html(<StatusPill tone="warning" label="Troligen eftersatt" />);
    expect(fri).toContain("Troligen eftersatt");
    expect(fri).toContain("bg-warning-tint");
  });
});

describe("Field", () => {
  it("visar badge bredvid etiketten och aldrig '(valfritt)'", () => {
    const h = html(
      <Field
        label="Adress"
        value=""
        onChange={() => {}}
        type="text"
        optional
        badge={<Badge tone="success">Från annonsen</Badge>}
      />,
    );
    expect(h).toContain("Från annonsen");
    expect(h).not.toContain("valfritt");
  });

  it("länkar etikett, hint och fel till inputen", () => {
    const h = html(
      <Field label="Boarea" value="" onChange={() => {}} id="boarea" hint="m²" error="För lågt" />,
    );
    expect(h).toContain('for="boarea"');
    expect(h).toContain('aria-describedby="boarea-beskrivning"');
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain("För lågt");
  });

  it("skickar vidare name och autoComplete", () => {
    const h = html(
      <Field label="E-post" value="" onChange={() => {}} name="epost" autoComplete="email" />,
    );
    expect(h).toContain('name="epost"');
    expect(h).toContain('autoComplete="email"');
  });
});

describe("TristateChoice", () => {
  it("renderar tre radioknappar med gemensamt namn och rätt vald", () => {
    const h = html(<TristateChoice value="nej" onChange={() => {}} ariaLabel="Hiss" />);
    expect(h).toContain('role="radiogroup"');
    expect(h.match(/type="radio"/g)).toHaveLength(3);
    expect(h.match(/name="test-id"/g)).toHaveLength(3);
    expect(h).toContain("Vet ej");
    expect(h.match(/checked=""/g)).toHaveLength(1);
  });

  it("ändrar värde när en radio väljs", () => {
    const onChange = vi.fn();
    const inputs = hittaInputs(TristateChoice({ value: "okant", onChange }));
    expect(inputs.map((i) => i.props["value"])).toEqual(["ja", "nej", "okant"]);
    (inputs[0]?.props["onChange"] as () => void)();
    (inputs[1]?.props["onChange"] as () => void)();
    expect(onChange.mock.calls).toEqual([["ja"], ["nej"]]);
  });
});

describe("SpanBar", () => {
  const props = {
    lag: 5_110_000,
    hog: 6_250_000,
    ariaLabel: "Värdespann 5,11 till 6,25 miljoner kronor.",
    markorer: [
      { label: "Utgångspris", varde: 5_000_000, text: "5,0 mkr", ton: "utgangspris" as const },
      { label: "Binfos värdering", varde: 5_680_000, text: "5,7 mkr", ton: "vardering" as const },
    ],
  };

  it("har aria-label och synliga markörtexter", () => {
    const h = html(<SpanBar {...props} />);
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="Värdespann 5,11 till 6,25 miljoner kronor."');
    expect(h).toContain("Utgångspris");
    expect(h).toContain("5,0 mkr");
    expect(h).toContain("Binfos värdering");
    expect(h).toContain("5,7 mkr");
  });

  it("placerar markörer inom 0–100 % även när de ligger utanför spannet", () => {
    const h = html(<SpanBar {...props} />);
    const procent = [...h.matchAll(/left:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(procent.length).toBeGreaterThan(0);
    for (const p of procent) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("klarar ett spann utan bredd", () => {
    expect(() =>
      html(<SpanBar {...props} lag={5_000_000} hog={5_000_000} markorer={[]} />),
    ).not.toThrow();
  });
});

describe("Button och Logo", () => {
  it("danger-varianten finns och 48 px-storleken heter lg", () => {
    const h = html(
      <Button variant="danger" size="lg">
        Radera mitt konto
      </Button>,
    );
    expect(h).toContain("border-danger-border");
    expect(h).toContain("min-h-12");
  });

  it("Logo har dekorativ ikon och texten Binfo", () => {
    const h = html(<Logo />);
    expect(h).toContain('aria-hidden="true"');
    expect(h).toContain("Binfo");
  });
});
