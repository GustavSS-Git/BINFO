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
  AVGIFT_FORVAL,
  KALKYL_UNDERLAG_VERSION,
  KalkylUnderlagSchema,
  tillKalkylAvgift,
  type AvgiftPostId,
  type BarnAlder,
  type EgenKostnadId,
  type KalkylAvgiftInkluderar,
  type KalkylUnderlag,
} from "@/lib/kalkyl/underlag";
import type { FeeInclusion } from "@/types/analysis";

export const BARN_ALDRAR: readonly BarnAlder[] = ["0-3", "4-6", "7-10", "11-14", "15-17"];

/** Which prefilled values still carry "Från rapporten": set by `sidaFranSokning`,
 *  removed per field as soon as the user edits it (a chip loses the mark when it
 *  is toggled). Kontantinsats is never marked: it is Binfo's default (10 %), not a
 *  fact from the report. Never saved (not part of the underlag). */
export interface FranRapport {
  pris?: true;
  manadsavgift?: true;
  boarea?: true;
  avgift?: Partial<Record<AvgiftPostId, true>>;
}

export interface KalkylSida {
  pris: string;
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
  avgiftInkluderar: KalkylAvgiftInkluderar;
  rantekanslighetProcent: number | undefined;
  egnaKostnader: Partial<Record<EgenKostnadId, number>>;
  kalla: KalkylUnderlag["kalla"];
  franRapport: FranRapport;
}

export type SidaFalt =
  | "pris"
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

export function tomSida(): KalkylSida {
  return {
    pris: "",
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
    avgiftInkluderar: { ...AVGIFT_FORVAL },
    rantekanslighetProcent: undefined,
    egnaKostnader: {},
    kalla: undefined,
    franRapport: {},
  };
}

/** Förifyllning från sökparametrarna (länk från en analys eller från priskollen på /analysera).
 *  Priset fyller prisfältet direkt; kontantinsatsen förifylls med minsta tillåtna (10 %,
 *  avrundat uppåt). Vad som ingår i avgiften (`ingar`/`ingarEj`) läggs på de förvalda svaren;
 *  nycklar som inte nämns behåller förvalet. */
export function sidaFranSokning(search: BolanekalkylSearch): KalkylSida {
  const sida = tomSida();
  if (search.pris !== undefined) {
    sida.pris = String(search.pris);
    sida.kontantinsats = String(Math.ceil(search.pris * MIN_KONTANTINSATS_ANDEL));
    sida.franRapport.pris = true;
  }
  if (search.manadsavgift !== undefined) {
    sida.manadsavgift = String(search.manadsavgift);
    sida.franRapport.manadsavgift = true;
  }
  if (search.boarea !== undefined) {
    sida.boarea = talTillFalttext(search.boarea);
    sida.franRapport.boarea = true;
  }
  sida.rantekanslighetProcent = search.rantekanslighet;
  const avgift = avgiftFranSokning(search);
  for (const id of AVGIFT_ORDNING) {
    const v = avgift[id];
    if (v === undefined) continue;
    sida.avgiftInkluderar[id] = v;
    (sida.franRapport.avgift ??= {})[id] = true;
  }
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

const AVGIFT_ORDNING: readonly AvgiftPostId[] = ["varme", "vatten", "el", "bredband", "tv"];

/** Avgiftsposterna som sökparametrarna anger: `ingar` -> "ja", `ingarEj` -> "nej". */
export function avgiftFranSokning(
  search: Pick<BolanekalkylSearch, "ingar" | "ingarEj">,
): Partial<KalkylAvgiftInkluderar> {
  const ut: Partial<KalkylAvgiftInkluderar> = {};
  for (const id of search.ingar?.split(",") ?? []) {
    if ((AVGIFT_ORDNING as readonly string[]).includes(id)) ut[id as AvgiftPostId] = "ja";
  }
  for (const id of search.ingarEj?.split(",") ?? []) {
    if ((AVGIFT_ORDNING as readonly string[]).includes(id)) ut[id as AvgiftPostId] = "nej";
  }
  return ut;
}

/** Ändrar ett fält och tar bort dess "Från rapporten"-märke (en chip för en avgiftspost
 *  tappar märket via `andraAvgift`). Rena funktioner så att sidan inte bär logiken. */
export function andraFalt<K extends keyof KalkylSida>(
  sida: KalkylSida,
  nyckel: K,
  varde: KalkylSida[K],
): KalkylSida {
  const { [nyckel as string]: _bort, ...franRapport } = sida.franRapport as Record<string, unknown>;
  return { ...sida, [nyckel]: varde, franRapport: franRapport as FranRapport };
}

export function andraAvgift(
  sida: KalkylSida,
  id: AvgiftPostId,
  varde: KalkylAvgiftInkluderar[AvgiftPostId],
): KalkylSida {
  const { [id]: _bort, ...avgift } = sida.franRapport.avgift ?? {};
  const { avgift: _gammal, ...resten } = sida.franRapport;
  return {
    ...sida,
    avgiftInkluderar: { ...sida.avgiftInkluderar, [id]: varde },
    franRapport: Object.keys(avgift).length > 0 ? { ...resten, avgift } : resten,
  };
}

/** Sidans indata: som `KalkylSida`, men avgiftsposterna får också vara tre-lägesvärden
 *  (den delade butiken `uppgifter` har det); "okant" räknas som "nej". */
export type SidaIndata = Omit<KalkylSida, "avgiftInkluderar" | "franRapport"> & {
  avgiftInkluderar: FeeInclusion;
  franRapport?: FranRapport;
};

export function underlagFranSida(sida: SidaIndata): { underlag: KalkylUnderlag; fel: SidaFel } {
  const fel: SidaFel = {};
  const les = (text: string, falt: SidaFalt, nyckel: GransNyckel): number | undefined => {
    const t = tolkaFalt(text, nyckel);
    if (t.art === "fel") {
      fel[falt] = t.fel;
      return undefined;
    }
    return t.art === "tal" ? t.varde : undefined;
  };

  const pris = les(sida.pris, "pris", "pris");
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
    ...(pris !== undefined ? { pris } : {}),
    ...(kontantinsats !== undefined ? { kontantinsats } : {}),
    ...(ranta !== undefined ? { rantaProcent: ranta } : {}),
    ...(manadsavgift !== undefined ? { manadsavgift } : {}),
    ...(boarea !== undefined ? { boarea } : {}),
    avgiftInkluderar: tillKalkylAvgift(sida.avgiftInkluderar),
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
    pris: s(u.pris),
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
    franRapport: {},
  };
}

/** Sant om underlaget klarar schemat (används i tester och vid återställning). */
export function arGiltigtUnderlag(u: KalkylUnderlag): boolean {
  return KalkylUnderlagSchema.safeParse(u).success;
}

/** Avviker någon av bankens-kalkyl-uppgifterna (KALP) från förvalet? Förvalet är inga barn,
 *  lika många vuxna som låntagare och standardkalkylräntan. */
export function kalpArAndrad(u: KalkylUnderlag): boolean {
  return (
    u.barn.length > 0 ||
    u.antalVuxna !== u.antalLantagare ||
    u.kalkylrantaProcent !== tal("kalkylranta_standard")
  );
}
