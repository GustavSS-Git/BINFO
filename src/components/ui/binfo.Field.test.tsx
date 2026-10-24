import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Field } from "@/components/ui/binfo";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

const rita = (props: { framhav?: boolean; error?: string | null }) =>
  renderToStaticMarkup(
    <Field
      id="x"
      label="Utgångspris"
      value=""
      onChange={() => undefined}
      hint="Fanns inte i annonsen"
      {...(props.framhav !== undefined ? { framhav: props.framhav } : {})}
      {...(props.error !== undefined ? { error: props.error } : {})}
    />,
  );

describe("Field framhav", () => {
  it("använder border-input som standard", () => {
    const html = rita({});
    expect(html).toContain("border-input");
    expect(html).not.toContain("border-warning");
  });

  it("framhav utan fel ger varningsram", () => {
    const html = rita({ framhav: true });
    expect(html).toContain("border-warning");
    expect(html).not.toContain("border-input");
  });

  it("ett valideringsfel går före framhävningen", () => {
    const html = rita({ framhav: true, error: "Ange ett pris." });
    expect(html).toContain("border-danger");
    expect(html).not.toContain("border-warning");
    expect(html).toContain("Ange ett pris.");
  });
});
