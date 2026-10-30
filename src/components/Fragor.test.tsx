import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Fragor } from "@/components/AnalysRapport";
import type { Fraga } from "@/types/analysis";

const medSignal: Fraga = {
  id: "f-med",
  fraga: "Hur ska stambytet finansieras?",
  ursprung: "analys",
  riktadTill: "styrelsen",
  varfor: "Avgiften har inte höjts sedan 2022, men 60 % av lånen förfaller 2026.",
  svarssignal: "Bra svar: en plan med pengar avsatta. Varningssignal: att styrelsen inte vet.",
};

const utanSignal: Fraga = {
  id: "f-utan",
  fraga: "Finns det hiss i huset?",
  ursprung: "analys",
  riktadTill: "maklaren",
  varfor: "Hissen påverkar värdet och hur lätt lägenheten är att sälja.",
};

const saknad: Fraga = {
  id: "f-saknad",
  fraga: "Har lägenheten balkong?",
  ursprung: "saknad_uppgift",
  riktadTill: "maklaren",
  varfor: "SKA_INTE_VISAS",
};

const rendera = (fragor: Fraga[]) => renderToStaticMarkup(<Fragor analys={{ fragor }} />);

describe("Fragor — Varför och Bra svar / Varningssignal under varje fråga", () => {
  it("visar frågan med checkbox och etikett, 'Varför:' och signalen som två rader med fetade rubriker", () => {
    const html = rendera([medSignal]);
    expect(html).toContain("Hur ska stambytet finansieras?");
    expect(html).toMatch(/<input id="[^"]+" type="checkbox"/);
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Hur ska stambytet finansieras\?<\/label>/);
    expect(html).toContain("Avgiften har inte höjts sedan 2022, men 60 % av lånen förfaller 2026.");
    expect(html).toMatch(/<span class="[^"]*\bfont-semibold\b[^"]*">Varför: <\/span>/);
    expect(html).toMatch(
      /<span class="[^"]*\bfont-semibold\b[^"]*">Bra svar: <\/span>en plan med pengar avsatta\./,
    );
    expect(html).toMatch(
      /<span class="[^"]*\bfont-semibold\b[^"]*">Varningssignal: <\/span>att styrelsen inte vet\./,
    );
    // Två egna rader, ingen dubblerad rubrik.
    expect(html).not.toContain("Bra svar / varningssignal");
    expect((html.match(/Bra svar:/g) ?? []).length).toBe(1);
  });

  it("sätter rubriken 'Bra svar / varningssignal:' framför en signal som saknar egna etiketter (en rad)", () => {
    const html = rendera([{ ...medSignal, svarssignal: "Ett konkret datum är lugnande." }]);
    expect(html).toContain("Bra svar / varningssignal: Ett konkret datum är lugnande.");
    expect(html).not.toContain("Varningssignal: </span>");
  });

  it("en signal med bara 'Bra svar:' förblir en rad som förut", () => {
    const html = rendera([{ ...medSignal, svarssignal: "Bra svar: ett datum." }]);
    expect(html).toContain("Bra svar: ett datum.");
    expect(html).not.toContain("Bra svar / varningssignal");
  });

  it("visar ingen signalrad för en fråga utan svarssignal, men fortfarande Varför", () => {
    const html = rendera([utanSignal]);
    expect(html).toContain("Varför:");
    expect(html).toContain("Hissen påverkar värdet");
    expect(html).not.toContain("Bra svar");
  });

  it("behåller filtret: bara frågor med ursprung 'analys' visas, och rubriken räknar dem", () => {
    const html = rendera([medSignal, saknad]);
    expect(html).not.toContain("SKA_INTE_VISAS");
    expect(html).not.toContain("Har lägenheten balkong?");
    expect(html).toContain("En fråga till mäklaren och styrelsen");
    expect(rendera([medSignal, utanSignal])).toContain("Två frågor till mäklaren och styrelsen");
  });

  it("utan analysfrågor visas inget avsnitt", () => {
    expect(rendera([saknad])).toBe("");
  });

  it("avstrykningen gäller bara frågetexten (varför ligger utanför etiketten)", () => {
    const html = rendera([medSignal]);
    const etikett = html.match(/<label [^>]*>Hur ska stambytet finansieras\?<\/label>/);
    expect(etikett).not.toBeNull();
    expect(etikett?.[0]).not.toContain("Varför");
  });

  it("ingressen nämner avgiftsprognosen bara när rapporten har en", () => {
    const med = renderToStaticMarkup(<Fragor analys={{ fragor: [medSignal] }} />);
    expect(med).toContain("betyget och avgiftsprognosen håller");
    const utan = renderToStaticMarkup(
      <Fragor analys={{ fragor: [medSignal] }} medPrognos={false} />,
    );
    expect(utan).toContain("Svaren avgör om betyget håller.");
  });
});
