import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));

import { KopguideVy } from "@/components/kopguide/KopguideVy";
import { oppnaEfterMarkering } from "@/components/kopguide/oppna";
import { KOPGUIDE_FASER, KOPGUIDE_STEG } from "@/lib/kopguide/steg";

const flat = (html: string) => html.replace(/\s+/g, " ");
const noop = () => {};

function rendera(p: Partial<Parameters<typeof KopguideVy>[0]> = {}) {
  return renderToStaticMarkup(
    <KopguideVy
      typ="brf"
      onTyp={noop}
      klara={[]}
      oppen="lanelofte"
      sparFel={null}
      onOppna={noop}
      onMarkera={noop}
      onGaTill={noop}
      {...p}
    />,
  );
}

describe("KopguideVy", () => {
  it("visar framsteg, nästa steg och tre faser med antal klara", () => {
    const html = flat(rendera({ klara: ["lanelofte", "sok"] }));
    expect(html).toContain("2 av 12 steg klara");
    expect(html).toContain("Nästa steg:");
    expect(html).toContain("Visning →");
    for (const fas of KOPGUIDE_FASER) expect(html).toContain(fas.titel);
    expect(html).toContain("2 av 4 klara");
    expect(html).toContain("Tolv steg från lånelöfte till tillträde.");
  });

  it("alla steg klara: gratulation i stället för nästa steg", () => {
    const html = flat(rendera({ klara: KOPGUIDE_STEG.filter((s) => !s.only).map((s) => s.id) }));
    expect(html).toContain("12 av 12 steg klara");
    expect(html).toContain("Alla steg klara. Grattis till bostaden!");
    expect(html).not.toContain("Nästa steg:");
  });

  it("ett steg öppet i taget, kopplat med aria-expanded och aria-controls", () => {
    const html = rendera({ oppen: "sok" });
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(11);
    expect(html).toContain('aria-controls="steg-sok-innehall"');
    expect(html).toContain('id="steg-sok-innehall"');
    expect(html.match(/<div id="steg-[a-z]+-innehall" hidden=""/g)).toHaveLength(11);
  });

  it("avbockade steg får 'Ångra', övriga 'Markera klar'", () => {
    const html = rendera({ klara: ["lanelofte"] });
    expect(html).toContain("Ångra: Förberedelse");
    expect(html).toContain("Markera klar: Sök");
  });

  it("flaggor och tips visas; tips med bara länk visar enbart länken", () => {
    const html = flat(rendera({ oppen: "lanelofte" }));
    expect(html).toContain("Viktiga flaggor");
    expect(html).toContain("Tips");
    expect(html).toContain('<li><a href="/bolanekalkyl"');
    expect(html).toContain("Räkna på din månadskostnad här");
  });

  it("det dolda Hus/Bostadsrätt-valet finns kvar i DOM:en, dolt", () => {
    const html = rendera();
    expect(html).toMatch(/<div class="hidden"><div role="radiogroup"/);
    expect(html).toContain("Bostadsrätt");
    expect(html).toContain("Hus");
  });

  it("hus: lagfartssteget visas och numreringen följer synliga steg", () => {
    const brf = flat(rendera({ typ: "brf" }));
    const hus = flat(rendera({ typ: "hus" }));
    expect(brf).not.toContain("Lagfart");
    expect(hus).toContain("Lagfart");
    expect(hus).toContain("0 av 13 steg klara");
    expect(hus).toContain("Tretton steg");
  });

  it("visar sparfelet som varning", () => {
    const html = rendera({ sparFel: "Det gick inte att spara ditt framsteg just nu." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Det gick inte att spara ditt framsteg just nu.");
  });

  it("avslutande uppmaning till analysen", () => {
    const html = flat(rendera());
    expect(html).toContain("Hittat en bostad?");
    expect(html).toContain("Se vad den är värd och hur föreningen mår innan du budar.");
    expect(html).toContain('href="/analysera"');
  });
});

describe("oppnaEfterMarkering", () => {
  it("markerar man det öppna steget klart öppnas nästa", () => {
    expect(oppnaEfterMarkering("brf", "lanelofte", "lanelofte", true)).toBe("sok");
  });
  it("ångra, eller ett annat steg än det öppna, ändrar ingenting", () => {
    expect(oppnaEfterMarkering("brf", "lanelofte", "lanelofte", false)).toBe("lanelofte");
    expect(oppnaEfterMarkering("brf", "sok", "lanelofte", true)).toBe("sok");
  });
  it("sista steget stänger; i husläget följer lagfart efter medlemskap", () => {
    const sista = KOPGUIDE_FASER.at(-1)!.stegIds.at(-1)!;
    expect(oppnaEfterMarkering("brf", sista, sista, true)).toBeNull();
    expect(oppnaEfterMarkering("brf", "medlemskap", "medlemskap", true)).toBe("tilltrade");
    expect(oppnaEfterMarkering("hus", "medlemskap", "medlemskap", true)).toBe("lagfart");
  });
});
