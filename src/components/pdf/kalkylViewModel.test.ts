import { describe, expect, it } from "vitest";
import { EXEMPEL } from "@/components/pdf/kalkylExempel.testdata";
import { beraknaKalkyl } from "@/lib/kalkyl/berakna";
import { REGELVERSION } from "@/lib/kalkyl/regler";
import { KALKYL_UNDERLAG_VERSION } from "@/lib/kalkyl/underlag";
import { buildKalkylViewModel, heltalText, kalkylFilnamn, krText } from "./kalkylViewModel";

describe("buildKalkylViewModel", () => {
  const r = beraknaKalkyl(EXEMPEL);
  const vm = buildKalkylViewModel(EXEMPEL, {
    datum: new Date("2026-10-13T10:00:00Z"),
    etikett: "Lägenhet på Söder",
  });

  it("formaterar tal oberoende av locale", () => {
    expect(heltalText(1234567)).toBe("1 234 567");
    expect(heltalText(-4200)).toBe("−4 200");
    expect(krText(0)).toBe("0 kr");
  });

  it("har datum, etikett och regelversion", () => {
    expect(vm.datum).toBe("2026-10-13");
    expect(vm.etikett).toBe("Lägenhet på Söder");
    expect(vm.regelversion).toBe(REGELVERSION);
    expect(kalkylFilnamn("pdf", new Date("2026-10-13T10:00:00Z"))).toBe(
      "binfo-bolanekalkyl-2026-10-13.pdf",
    );
  });

  it("visar totalen från beraknaKalkyl som ett enda tal (inget spann sedan 2026-10-28)", () => {
    expect(vm.manadskostnad.total?.varde).toBe(krText(r.nu.summor.netto));
    expect(vm.manadskostnad.total?.varde).not.toContain("–");
    expect(vm.manadskostnad.totalNot).toBeNull();
    // Scenariotabellen har också ett tal per rad.
    for (const rad of vm.scenarier?.rader ?? []) expect(rad[4]).not.toContain("–");
    // Ingenstans i PDF:ens indata finns "Vet ej".
    expect(JSON.stringify(vm.indata)).not.toMatch(/Vet ej/);
  });

  it("indata har pris, kontantinsats och lån (pris minus kontantinsats)", () => {
    const rad = (e: string) => vm.indata.find((x) => x.etikett === e)?.varde;
    expect(rad("Pris du räknar med")).toBe(krText(4_200_000));
    expect(rad("Kontantinsats")).toBe(krText(700_000));
    expect(rad("Lån (pris minus kontantinsats)")).toBe(krText(3_500_000));
    expect(rad("Ingår vatten i avgiften?")).toBe("Nej");
    expect(rad("Ingår värme i avgiften?")).toBe("Ja");
  });

  it("märker schabloner och egna värden i drift-raderna", () => {
    const noter = vm.manadskostnad.rader.map((x) => `${x.etikett}|${x.not ?? ""}`).join("\n");
    expect(noter).toContain("Hushållsel|Ditt värde");
    expect(noter).toContain("Schablon (uppskattning)");
    expect(noter).toContain("Värme|Ingår i avgiften");
  });

  it("visar ränteavdrag per person och KALP med tecken", () => {
    expect(vm.ranteavdrag.rader.filter((x) => x.etikett.startsWith("Låntagare"))).toHaveLength(2);
    expect(vm.ranteavdrag.not).toBeNull();
    expect(r.kalp.beraknad).toBe(true);
    expect(vm.kalp.utfall?.tecken).toBe(r.kalp.utfall);
    expect(vm.kalp.utfall?.text).toContain(krText(r.kalp.kvarAttLevaPa!));
  });

  it("amorteringstexten citerar paragrafen", () => {
    expect(vm.amortering.regeltext).toContain("7 §");
    expect(vm.amortering.regeltext).toContain("Lag (2026:226)");
  });

  it("har en scenariorad per scenario", () => {
    expect(vm.scenarier?.rader).toHaveLength(5);
  });

  it("märker antaganden och schabloner i regeltabellen", () => {
    const status = new Set(vm.regler.map((x) => x.status));
    expect(status.has("Schablon (uppskattning)")).toBe(true);
    expect(status.has("Antagande")).toBe(true);
    expect(vm.regler.some((x) => x.namn.includes("Bolånetak"))).toBe(true);
  });

  it("utan inkomst: förutsättningsnoten följer med", () => {
    const { inkomst1: _a, inkomst2: _b, ...utan } = EXEMPEL;
    const v = buildKalkylViewModel(utan);
    expect(v.ranteavdrag.not).toContain("förutsätter att ni betalar tillräckligt med skatt");
    expect(v.kalp.beraknad).toBe(false);
    expect(v.kalp.saknasText).toContain("bruttoinkomst");
  });

  it("tomt underlag kraschar inte och visar streck", () => {
    const v = buildKalkylViewModel({
      version: KALKYL_UNDERLAG_VERSION,
      avgiftInkluderar: { varme: "ja", vatten: "ja", el: "nej", bredband: "nej", tv: "nej" },
      antalLantagare: 1,
      antalPersoner: 1,
      antalVuxna: 1,
      barn: [],
      rantestressPp: 0,
      kalkylrantaProcent: 7,
      egnaKostnader: {},
    });
    expect(v.scenarier).toBeNull();
    expect(v.manadskostnad.total).toBeNull();
    expect(v.indata.find((x) => x.etikett === "Pris du räknar med")?.varde).toBe("—");
    expect(v.indata.find((x) => x.etikett.startsWith("Lån"))?.varde).toBe("—");
  });
});
