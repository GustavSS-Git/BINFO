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

describe("Fragor — Varför och Bra svar / varningssignal under varje fråga", () => {
  it("visar frågan, 'Varför:' med texten i grå kursiv och signalraden i grått", () => {
    const html = rendera([medSignal]);
    expect(html).toContain("Hur ska stambytet finansieras?");
    expect(html).toContain("Varför:");
    expect(html).toContain("Avgiften har inte höjts sedan 2022, men 60 % av lånen förfaller 2026.");
    expect(html).toMatch(
      /<span class="[^"]*\bitalic\b[^"]*\btext-muted-foreground\b[^"]*">Varför:/,
    );
    expect(html).toContain("Bra svar: en plan med pengar avsatta.");
    expect(html).toContain("Varningssignal: att styrelsen inte vet.");
    // Signalen börjar redan med "Bra svar:", så rubriken dubbleras inte.
    expect(html).not.toContain("Bra svar / varningssignal: Bra svar:");
  });

  it("sätter rubriken 'Bra svar / varningssignal:' framför en signal som saknar egna etiketter", () => {
    const html = rendera([{ ...medSignal, svarssignal: "Ett konkret datum är lugnande." }]);
    expect(html).toContain("Bra svar / varningssignal: Ett konkret datum är lugnande.");
  });

  it("visar ingen signalrad för en fråga utan svarssignal, men fortfarande Varför", () => {
    const html = rendera([utanSignal]);
    expect(html).toContain("Varför:");
    expect(html).toContain("Hissen påverkar värdet");
    expect(html).not.toContain("Bra svar / varningssignal");
  });

  it("behåller filtret: bara frågor med ursprung 'analys' visas", () => {
    const html = rendera([medSignal, saknad]);
    expect(html).not.toContain("SKA_INTE_VISAS");
    expect(html).not.toContain("Har lägenheten balkong?");
  });

  it("avstrykningen gäller bara frågetexten (varför ligger utanför line-through-elementet)", () => {
    // Initialt är inget markerat; kontrollera strukturen: frågetexten och
    // varför är syskon, inte förälder/barn.
    const html = rendera([medSignal]);
    const fragaSpan = html.match(/<span class="[^"]*">Hur ska stambytet finansieras\?<\/span>/);
    expect(fragaSpan).not.toBeNull();
  });
});
