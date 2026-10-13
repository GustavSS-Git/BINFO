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
 */
import { describe, expect, it } from "vitest";
import fixtur from "./paritet.fixtur.json";
import { beraknaKalkyl } from "./berakna";
import { tomSida, underlagFranSida, type KalkylSida } from "./sida";

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
  ingar: KalkylSida["avgiftInkluderar"];
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

function sidaFran(f: GammaltFall): KalkylSida {
  return {
    ...tomSida(),
    lanebelopp: f.lanebelopp,
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
    egnaKostnader: f.egna,
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
      const { underlag } = underlagFranSida(sidaFran(f));
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
          expect(rad?.schablon).toBe(p.value);
          expect(rad?.ingarIAvgift).toBe(p.ingarIAvgift);
        }
        expect(r.nu.betalarPerManad).toBe(gammalt.betalarPerManad);
        expect(r.skatt.nettoinkomstPerManad).toBeCloseTo(gammalt.nettoinkomstPerManad, 6);
        expect(r.nu.kvarEfterBoende).toBeCloseTo(gammalt.kvarAttLevaPa, 6);
        expect(r.nu.andelAvNettoProcent).toBeCloseTo(gammalt.andelAvNetto, 6);
        expect(r.nu.summor.harSpann).toBe(gammalt.harSpann);
      });

      if (!begransad) {
        it("ränteavdrag och totaler är oförändrade (±1 kr)", () => {
          // Utan inkomst används full sats, precis som förut.
          expect(Math.abs(r.nu.ranteavdragPerManad - gammalt.avdragPerManad)).toBeLessThanOrEqual(
            1,
          );
          expect(Math.abs(r.nu.summor.nettoLag - gammalt.nettoLag)).toBeLessThanOrEqual(1);
          expect(Math.abs(r.nu.summor.nettoHog - gammalt.nettoHog)).toBeLessThanOrEqual(1);
          expect(r.nu.summor.bruttoLag).toBe(gammalt.bruttoLag);
          expect(r.nu.summor.bruttoHog).toBe(gammalt.bruttoHog);
        });
      } else {
        it("avsiktlig skillnad: avdraget begränsas av skatten och stämmer med deklarationen", () => {
          expect(r.nu.ranteavdragPerManad).toBeLessThan(gammalt.avdragPerManad);
          expect(r.nu.summor.nettoLag).toBeGreaterThan(gammalt.nettoLag);
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
