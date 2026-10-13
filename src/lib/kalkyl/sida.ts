/**
 * Kalkylsidans fälttillstånd (text) <-> KalkylUnderlag. Samma omvandling
 * används av sidan, "Spara"/återställning av sparade kalkyler och exporterna.
 *
 * Tomma fält blir undefined (aldrig 0). Ogiltig text blir också undefined och
 * ger ett felmeddelande per fält i `fel`. Tomt "antal personer" betyder
 * antal vuxna + barn, tomt "antal vuxna" betyder antal låntagare.
 */
import type { BolanekalkylSearch } from "@/lib/bolanekalkyl";
import { talTillFalttext, tolkaFalt, type GransNyckel } from "@/lib/kalkyl/indata";
import { MIN_KONTANTINSATS_ANDEL, tal } from "@/lib/kalkyl/regler";
import {
  KALKYL_UNDERLAG_VERSION,
  KalkylUnderlagSchema,
  type BarnAlder,
  type EgenKostnadId,
  type KalkylUnderlag,
} from "@/lib/kalkyl/underlag";
import type { FeeInclusion } from "@/types/analysis";

export const BARN_ALDRAR: readonly BarnAlder[] = ["0-3", "4-6", "7-10", "11-14", "15-17"];

export interface KalkylSida {
  lanebelopp: string;
  kontantinsats: string;
  ranta: string;
  manadsavgift: string;
  boarea: string;
  antalLantagare: "1" | "2";
  inkomst1: string;
  inkomst2: string;
  antalPersoner: string;
  antalVuxna: string;
  /** Antal barn per åldersgrupp, som text. */
  barn: Record<BarnAlder, string>;
  rantestressPp: number;
  kalkylranta: string;
  avgiftInkluderar: FeeInclusion;
  rantekanslighetProcent: number | undefined;
  egnaKostnader: Partial<Record<EgenKostnadId, number>>;
  kalla: KalkylUnderlag["kalla"];
}

export type SidaFalt =
  | "lanebelopp"
  | "kontantinsats"
  | "ranta"
  | "manadsavgift"
  | "boarea"
  | "inkomst1"
  | "inkomst2"
  | "antalPersoner"
  | "antalVuxna"
  | "kalkylranta"
  | `barn:${BarnAlder}`;

export type SidaFel = Partial<Record<SidaFalt, string>>;

const OKANT_ALLA: FeeInclusion = {
  varme: "okant",
  vatten: "okant",
  el: "okant",
  bredband: "okant",
  tv: "okant",
};

export function tomSida(): KalkylSida {
  return {
    lanebelopp: "",
    kontantinsats: "",
    ranta: "",
    manadsavgift: "",
    boarea: "",
    antalLantagare: "2",
    inkomst1: "",
    inkomst2: "",
    antalPersoner: "",
    antalVuxna: "",
    barn: { "0-3": "", "4-6": "", "7-10": "", "11-14": "", "15-17": "" },
    rantestressPp: 0,
    kalkylranta: talTillFalttext(tal("kalkylranta_standard")),
    avgiftInkluderar: { ...OKANT_ALLA },
    rantekanslighetProcent: undefined,
    egnaKostnader: {},
    kalla: undefined,
  };
}

/** Förifyllning från sökparametrarna (länk från en analys eller från /vardering). */
export function sidaFranSokning(
  search: BolanekalkylSearch,
  avgiftInkluderar?: FeeInclusion,
): KalkylSida {
  const sida = tomSida();
  if (avgiftInkluderar) sida.avgiftInkluderar = { ...avgiftInkluderar };
  if (search.pris !== undefined) {
    // Kalkylen har inget prisfält: priset delas i minsta kontantinsats och resten som lån.
    const kontant = Math.ceil(search.pris * MIN_KONTANTINSATS_ANDEL);
    sida.kontantinsats = String(kontant);
    sida.lanebelopp = String(search.pris - kontant);
  }
  if (search.manadsavgift !== undefined) sida.manadsavgift = String(search.manadsavgift);
  if (search.boarea !== undefined) sida.boarea = talTillFalttext(search.boarea);
  sida.rantekanslighetProcent = search.rantekanslighet;
  if (search.pris !== undefined) {
    sida.kalla = {
      pris: search.pris,
      ...(search.prisUppskattning !== undefined
        ? { prisArUppskattning: search.prisUppskattning }
        : {}),
    };
  }
  return sida;
}

export function underlagFranSida(sida: KalkylSida): { underlag: KalkylUnderlag; fel: SidaFel } {
  const fel: SidaFel = {};
  const les = (text: string, falt: SidaFalt, nyckel: GransNyckel): number | undefined => {
    const t = tolkaFalt(text, nyckel);
    if (t.art === "fel") {
      fel[falt] = t.fel;
      return undefined;
    }
    return t.art === "tal" ? t.varde : undefined;
  };

  const lanebelopp = les(sida.lanebelopp, "lanebelopp", "lanebelopp");
  const kontantinsats = les(sida.kontantinsats, "kontantinsats", "kontantinsats");
  const ranta = les(sida.ranta, "ranta", "ranta");
  const manadsavgift = les(sida.manadsavgift, "manadsavgift", "manadsavgift");
  const boarea = les(sida.boarea, "boarea", "boarea");
  const inkomst1 = les(sida.inkomst1, "inkomst1", "inkomst");
  const inkomst2 = les(sida.inkomst2, "inkomst2", "inkomst");
  const antalLantagare = sida.antalLantagare === "2" ? 2 : 1;

  const barn: BarnAlder[] = [];
  for (const alder of BARN_ALDRAR) {
    const n = les(sida.barn[alder], `barn:${alder}`, "barnPerAlder") ?? 0;
    for (let i = 0; i < n; i++) barn.push(alder);
  }
  const vuxna = les(sida.antalVuxna, "antalVuxna", "antalVuxna") ?? antalLantagare;
  const personer = les(sida.antalPersoner, "antalPersoner", "antalPersoner");
  const kalkylranta =
    les(sida.kalkylranta, "kalkylranta", "kalkylranta") ?? tal("kalkylranta_standard");

  const underlag: KalkylUnderlag = {
    version: KALKYL_UNDERLAG_VERSION,
    ...(lanebelopp !== undefined ? { lanebelopp } : {}),
    ...(kontantinsats !== undefined ? { kontantinsats } : {}),
    ...(ranta !== undefined ? { rantaProcent: ranta } : {}),
    ...(manadsavgift !== undefined ? { manadsavgift } : {}),
    ...(boarea !== undefined ? { boarea } : {}),
    avgiftInkluderar: { ...sida.avgiftInkluderar },
    antalLantagare,
    ...(inkomst1 !== undefined ? { inkomst1 } : {}),
    ...(inkomst2 !== undefined ? { inkomst2 } : {}),
    antalPersoner: personer ?? Math.min(20, vuxna + barn.length),
    antalVuxna: vuxna,
    barn,
    rantestressPp: sida.rantestressPp,
    ...(sida.rantekanslighetProcent !== undefined
      ? { rantekanslighetProcent: sida.rantekanslighetProcent }
      : {}),
    kalkylrantaProcent: kalkylranta,
    egnaKostnader: { ...sida.egnaKostnader },
    ...(sida.kalla !== undefined ? { kalla: sida.kalla } : {}),
  };
  return { underlag, fel };
}

export function sidaFranUnderlag(u: KalkylUnderlag): KalkylSida {
  const s = (n: number | undefined) => (n === undefined ? "" : talTillFalttext(n));
  const barn = tomSida().barn;
  for (const alder of u.barn) barn[alder] = String(Number(barn[alder] || "0") + 1);
  return {
    lanebelopp: s(u.lanebelopp),
    kontantinsats: s(u.kontantinsats),
    ranta: s(u.rantaProcent),
    manadsavgift: s(u.manadsavgift),
    boarea: s(u.boarea),
    antalLantagare: u.antalLantagare === 2 ? "2" : "1",
    inkomst1: s(u.inkomst1),
    inkomst2: s(u.inkomst2),
    antalPersoner: String(u.antalPersoner),
    antalVuxna: String(u.antalVuxna),
    barn,
    rantestressPp: u.rantestressPp,
    kalkylranta: talTillFalttext(u.kalkylrantaProcent),
    avgiftInkluderar: { ...u.avgiftInkluderar },
    rantekanslighetProcent: u.rantekanslighetProcent,
    egnaKostnader: { ...u.egnaKostnader },
    kalla: u.kalla,
  };
}

/** Sant om underlaget klarar schemat (används i tester och vid återställning). */
export function arGiltigtUnderlag(u: KalkylUnderlag): boolean {
  return KalkylUnderlagSchema.safeParse(u).success;
}
