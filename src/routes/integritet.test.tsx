import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KONTAKT_EPOST } from "@/lib/kontakt";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: object) => ({ ...opts }),
  Link: ({ children, to }: { children?: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));

const { Route } = await import("@/routes/integritet");
const Sida = (Route as unknown as { component: () => React.ReactElement }).component;
const html = renderToStaticMarkup(<Sida />).replace(/\s+/g, " ");

describe("/integritet", () => {
  it("nämner cookies, köpguiden, Booli och begränsningsnycklar", () => {
    for (const t of [
      "binfo_enhet",
      "binfo_sa",
      "binfo_sr",
      "binfo_spara",
      "binfo_aterst",
      "binfo:kopguide:v1",
      "Booli",
      "Nominatim",
      "envägskodad kontrollsumma av din e-postadress",
      "Senast ändrad 1 november 2026",
    ]) {
      expect(html).toContain(t);
    }
  });

  it("kontaktadressen är en mailto-länk", () => {
    expect(KONTAKT_EPOST).not.toBeNull();
    expect(html).toContain(`href="mailto:${KONTAKT_EPOST}"`);
    expect(html).not.toContain("kontakta oss");
  });
});
