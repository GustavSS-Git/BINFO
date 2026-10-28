/**
 * Paritet mot den gamla route-matematiken i src/routes/bolanekalkyl.tsx
 * (v3 a2e56a0). `paritet.fixtur.json` är utdata från den koden, fryst INNAN
 * refaktoreringen: varje fall är sidans fältvärden + vad sidan räknade ut.
 *
 * Avsiktliga skillnader (dokumenterade här, inget annat får skilja):
 *  1. Ränteavdraget i månadssumman följer nu skatten per person (samma tal som
 *     "Tillbaka i deklarationen"). Fall där skatten inte räcker (låg inkomst)
 *     får ett lägre avdrag och därmed en högre total. Fall med tillräcklig
 *     skatt är oförändrade (±1 kr: avdraget avrundas per person och år).
 *  2. Saknas inkomst räknas avdraget med full sats som förut, men resultatet
 *     säger nu uttryckligen att det förutsätter skatt.
 *  3. Saknas boarea finns inget schablonvärde (förut: 58 m² från mockData).
 *     Fixturen har alltid boarea, så ingen skillnad här.
 *  4. Driftschablonerna byttes 2026-10-26 (Konsumentverket/Nils Holgersson i
 *     stället för Binfos gamla formler). Fixturen fryser de GAMLA beloppen, så
 *     testet skriver över varje drift-post med fixturens gamla belopp (som "eget
 *     värde") och jämför resten av matematiken: summor och scenarier
 *     förskjuts exakt med skillnaden mot den nya schablonen.
 *  5. Redesign v4 (2026-10-28): pris + kontantinsats i stället för lånebelopp (pris =
 *     fixturens lånebelopp + kontantinsats) och två lägen för "ingår i avgiften".
 *     Fixturens "okant" blir "nej" (kostnaden räknas), vilket är exakt det gamla
 *     "högsta" scenariot: nya totalen jämförs därför med fixturens nettoHog/bruttoHog
 *     (för fall utan "okant" är låg och hög lika).
 */
import { describe, expect, it } from "vitest";
import fixtur from "./paritet.fixtur.json";
import { beraknaKalkyl } from "./berakna";
import { tolkaTal } from "./indata";
import { tomSida, underlagFranSida, type KalkylSida, type SidaIndata } from "./sida";

interface GammaltFall {
  namn: string;
  lanebelopp: string;
  kontantinsats: string;
  ranta: string;
  manadsavgift: string;
  inkomst: string;
  inkomst2: string;
  lantagare: "1" | "2";
  boarea: number;
  antalPersoner: number;
  ingar: SidaIndata["avgiftInkluderar"];
  delta: number;
  rantekanslighet?: number;
  egna: KalkylSida["egnaKostnader"];
}

interface GammaltUtfall {
  flaggor: Record<string, boolean>;
  rantekostnad: number;
  amortering: number;
  avdragPerManad: number;
  manadsavgiftPost: number;
  driftPoster: Array<{ id: string; value: number; ingarIAvgift: boolean }>;
  drift: number;
  nettoLag: number;
  nettoHog: number;
  bruttoLag: number;
  bruttoHog: number;
  harSpann: boolean;
  betalarPerManad: number;
  nettoinkomstPerManad: number;
  andelAvNetto: number;
  kvarAttLevaPa: number;
  hushallRanteavdragPerAr: number;
  hushallForlorat: number;
  belaningsgrad: number;
  skuldkvot: number;
  takt: number;
  overTak: boolean;
  kontantFel: boolean;
}

const fall = fixtur as unknown as Array<{ fall: GammaltFall; ut: GammaltUtfall }>;

/** Skillnad 5: pris = lånebelopp + kontantinsats (båda ifyllda i alla fixturfall, eller ingen). */
function prisFran(f: GammaltFall): string {
  const lan = tolkaTal(f.lanebelopp);
  const kont = tolkaTal(f.kontantinsats);
  return lan.art === "tal" && kont.art === "tal" ? String(lan.varde + kont.varde) : "";
}

function sidaFran(f: GammaltFall, ut: GammaltUtfall): SidaIndata {
  // Skillnad 4: fixturens gamla schablonbelopp som egna värden (egna värden i fixturen vinner).
  const egna: KalkylSida["egnaKostnader"] = {};
  for (const p of ut.driftPoster) egna[p.id as keyof typeof egna] = p.value;
  Object.assign(egna, f.egna);
  return {
    ...tomSida(),
    pris: prisFran(f),
    kontantinsats: f.kontantinsats,
    ranta: f.ranta,
    manadsavgift: f.manadsavgift,
    boarea: String(f.boarea),
    antalLantagare: f.lantagare,
    inkomst1: f.inkomst,
    inkomst2: f.inkomst2,
    antalPersoner: String(f.antalPersoner),
    avgiftInkluderar: f.ingar,
    rantestressPp: f.delta,
    rantekanslighetProcent: f.rantekanslighet,
    egnaKostnader: egna,
  };
}

/** Fall där skatten inte räcker till hela ränteavdraget: avsiktlig skillnad 1. */
const SKATTEN_RACKER_INTE = new Set([
  "lag-inkomst-1-lantagare",
  "lag-inkomst-2-lantagare-olika",
  "lag-inkomst-2-lantagare-bada-lag",
]);

describe("paritet med gamla route-matematiken", () => {
  for (const { fall: f, ut: gammalt } of fall) {
    describe(f.namn, () => {
      const { underlag } = underlagFranSida(sidaFran(f, gammalt));
      const r = beraknaKalkyl(underlag);
      const begransad = SKATTEN_RACKER_INTE.has(f.namn);

      it("ifyllda fält", () => {
        expect(r.fyllt.ranta).toBe(gammalt.flaggor["harRanta"]);
        expect(r.fyllt.ranteunderlag).toBe(gammalt.flaggor["harRanteunderlag"]);
        expect(r.fyllt.lan).toBe(gammalt.flaggor["harLan"]);
        expect(r.fyllt.inkomst).toBe(gammalt.flaggor["harInkomst"]);
        expect(r.fyllt.avgift).toBe(gammalt.flaggor["harAvgift"]);
        expect(r.fyllt.total).toBe(gammalt.flaggor["harTotal"]);
      });

      it("lån, belåningsgrad, amorteringstakt och kontantinsats", () => {
        expect(Math.round(r.lan.belaningsgradProcent * 10) / 10).toBe(gammalt.belaningsgrad);
        expect(r.lan.skuldkvot).toBe(gammalt.skuldkvot);
        expect(r.lan.amorteringstaktProcent).toBe(gammalt.takt);
        expect(r.lan.overBankernasTypiskaTak).toBe(gammalt.overTak);
        expect(r.lan.kontantinsatsFel !== null).toBe(gammalt.kontantFel);
      });

      it("månadsposter och drift", () => {
        expect(r.nu.rantekostnad).toBe(gammalt.rantekostnad);
        expect(r.nu.amortering).toBe(gammalt.amortering);
        expect(r.nu.manadsavgift).toBe(gammalt.manadsavgiftPost);
        expect(r.nu.drift).toBe(gammalt.drift);
        for (const p of gammalt.driftPoster) {
          const rad = r.drift.find((x) => x.id === p.id);
          // Skillnad 4: schablonen är ny; beloppet som räknas är fixturens gamla (eller eget).
          expect(rad?.belopp).toBe((f.egna as Record<string, number>)[p.id] ?? p.value);
          expect(rad?.ingarIAvgift).toBe(p.ingarIAvgift);
        }
        expect(r.nu.betalarPerManad).toBe(gammalt.betalarPerManad);
        expect(r.skatt.nettoinkomstPerManad).toBeCloseTo(gammalt.nettoinkomstPerManad, 6);
        expect(r.nu.kvarEfterBoende).toBeCloseTo(gammalt.kvarAttLevaPa, 6);
        expect(r.nu.andelAvNettoProcent).toBeCloseTo(gammalt.andelAvNetto, 6);
      });

      if (!begransad) {
        it("ränteavdrag och totaler är oförändrade (±1 kr)", () => {
          // Utan inkomst används full sats, precis som förut.
          expect(Math.abs(r.nu.ranteavdragPerManad - gammalt.avdragPerManad)).toBeLessThanOrEqual(
            1,
          );
          expect(Math.abs(r.nu.summor.netto - gammalt.nettoHog)).toBeLessThanOrEqual(1);
          expect(r.nu.summor.brutto).toBe(gammalt.bruttoHog);
        });
      } else {
        it("avsiktlig skillnad: avdraget begränsas av skatten och stämmer med deklarationen", () => {
          expect(r.nu.ranteavdragPerManad).toBeLessThan(gammalt.avdragPerManad);
          expect(r.nu.summor.netto).toBeGreaterThan(gammalt.nettoHog);
          // Nu i hela kronor (öretal faller bort, 67 kap. 1 § IL): högst 2 kr från gamla decimaltalet.
          expect(Math.abs(r.nu.ranteavdragPerAr - gammalt.hushallRanteavdragPerAr)).toBeLessThan(2);
          expect(
            Math.abs(r.nu.ranteavdragPerManad - r.nu.ranteavdragPerAr / 12),
          ).toBeLessThanOrEqual(0.5);
          expect(Math.abs(r.nu.ranteavdragForloratPerAr - gammalt.hushallForlorat)).toBeLessThan(2);
        });
      }

      it("månadssumman och 'Tillbaka i deklarationen' är samma tal när inkomst finns", () => {
        if (!r.fyllt.inkomst) return;
        expect(Math.abs(r.nu.ranteavdragPerManad * 12 - r.ranteavdrag.perAr)).toBeLessThanOrEqual(
          6,
        );
        expect(r.ranteavdrag.forutsatterSkatt).toBe(false);
      });
    });
  }
});
