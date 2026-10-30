import { STEG_TEXT, type AnalysStage } from "@/lib/analysStatusCopy";
import { avrundaVardering } from "@/lib/analysisView";
import { formatMkr } from "@/lib/prisVy";

/**
 * Text och ren logik för väntskärmen/förhandsvisningen utöver det gamla
 * `stage`-fältet (v2, register-länkade analyser): rapportens riktiga steg,
 * skannad årsredovisning, återanvänd och delad körning. Egen fil (inte
 * analysStatusCopy.ts) så att statuskopian kan ändras separat.
 *
 * Unionerna speglar `Textlager`/`RapportStage` i src/server/ för hand — samma
 * skäl som i analysStatusCopy.ts: klientkod får inte importera därifrån.
 */

export type StatusTextlager = "ok" | "saknas" | "trasigt";

export type StatusRapportSteg =
  "identifiering" | "transkribering" | "grundning" | "extraktion" | "bedomning" | "klar";

/** Den del av statussvaret som den här filen läser (strukturellt, så att
 *  `hamtaStatusFn`s svar passar utan import från servern). */
export interface StatusVyIndata {
  stage: AnalysStage;
  textlager?: StatusTextlager | undefined;
  ateranvand?: boolean | undefined;
  vantarPaRapport?: boolean | undefined;
  rapportSteg?: StatusRapportSteg | undefined;
  /** Väntskärmens uppgifter (bara medan jobbet väntar; se AnalysStatusSvar). */
  adress?: string | null | undefined;
  foreningNamn?: string | null | undefined;
  utgangspris?: number | null | undefined;
  liknande?: { varde: number } | null | undefined;
}

export const RAPPORTSTEG_TEXT: Record<StatusRapportSteg, string> = {
  identifiering: "Identifierar föreningen…",
  transkribering: "Läser av de skannade sidorna…",
  grundning: "Läser årsredovisningen…",
  extraktion: "Hämtar de sju nyckeltalen…",
  bedomning: "Analyserar föreningens ekonomi…",
  klar: STEG_TEXT.complete,
};

export const SKANNAD_UPPTACKT_TEXT =
  "Skannad årsredovisning upptäckt – analysen tar lite längre tid.";
export const ATERANVAND_TEXT =
  "Den här årsredovisningen var redan analyserad – din analys är klar direkt.";
export const VANTAR_PA_RAPPORT_TEXT =
  "Samma årsredovisning analyseras just nu – din analys blir klar samtidigt.";

/** Stegtexten: rapportens riktiga steg när det finns, annars den gamla
 *  `stage`-texten. */
export function stegTextFor(status: StatusVyIndata): string {
  return status.rapportSteg ? RAPPORTSTEG_TEXT[status.rapportSteg] : STEG_TEXT[status.stage];
}

// ---------------------------------------------------------------------------
// Väntskärmens sex steg (redesign v4, plan §3.5)
// ---------------------------------------------------------------------------

/** De sex stegen som ritats på väntskärmen, i ordning. */
export const DESIGNSTEG: readonly string[] = [
  "Läser in årsredovisningen",
  "Hämtar de sju nyckeltalen",
  "Jämför dina uppgifter med årsredovisningen",
  "Räknar på avgiften de närmaste två åren",
  "Justerar värderingen för föreningens ekonomi",
  "Skriver frågor till styrelsen",
];

export interface DesignStegRad {
  label: string;
  lage: "klar" | "pagar" | "vantar";
}

/** Vilket av de sex stegen som pågår (0-baserat). Läser, identifiering,
 *  transkribering och grundning är steg 1 (transkribering finns bara för en
 *  skannad rapport, men hör till samma steg); extraktion är steg 2; bedömningen
 *  steg 3. Steg 4–6 körs först när rapporten läses (på under en sekund), så de
 *  är aldrig "pågår" här. Utan rapportSteg avgör den äldre `stage`. */
function aktivtDesignsteg(status: StatusVyIndata): number {
  switch (status.rapportSteg) {
    case "identifiering":
    case "transkribering":
    case "grundning":
      return 0;
    case "extraktion":
      return 1;
    case "bedomning":
    case "klar":
      return 2;
    case undefined:
      break;
  }
  switch (status.stage) {
    case "uploaded":
      return 0;
    case "extracting":
      return 1;
    case "judging":
    case "complete":
      return 2;
  }
}

/** Raderna till `ProgressList`: stegen före det aktiva är klara, det aktiva
 *  pågår, resten väntar. */
export function designSteg(status: StatusVyIndata): DesignStegRad[] {
  const aktivt = aktivtDesignsteg(status);
  return DESIGNSTEG.map((label, i) => ({
    label,
    lage: i < aktivt ? "klar" : i === aktivt ? "pagar" : "vantar",
  }));
}

/** Förloppsandel 0–1 = klara steg ÷ sex. */
export function designAndel(status: StatusVyIndata): number {
  return aktivtDesignsteg(status) / DESIGNSTEG.length;
}

/** Skannad = textlagret saknas. ('trasigt' är en annan sak: texten finns men
 *  är oläslig, och får inte kallas "skannad" i klartext.) */
export function arSkannadRapport(status: Pick<StatusVyIndata, "textlager">): boolean {
  return status.textlager === "saknas";
}

/** Ett meddelande i en Callout: kort rubrik + meningen köparen ska läsa. */
export interface StatusNotis {
  titel: string;
  text: string;
}

/** Meddelanden som visas ovanför förloppet medan analysen pågår. */
export function vantaNotiser(status: StatusVyIndata): StatusNotis[] {
  const notiser: StatusNotis[] = [];
  if (arSkannadRapport(status)) {
    notiser.push({ titel: "Skannad årsredovisning", text: SKANNAD_UPPTACKT_TEXT });
  }
  if (status.vantarPaRapport) {
    notiser.push({ titel: "Analyseras redan", text: VANTAR_PA_RAPPORT_TEXT });
  }
  return notiser;
}

/** Meddelande på förhandsvisningen när rapporten redan fanns. */
export function klarNotis(status: Pick<StatusVyIndata, "ateranvand">): StatusNotis | undefined {
  return status.ateranvand ? { titel: "Redan analyserad", text: ATERANVAND_TEXT } : undefined;
}

// ---------------------------------------------------------------------------
// Väntskärmens sidoruta och rubrikrad
// ---------------------------------------------------------------------------

/** "<adress> · <förening>" med de delar som saknas utelagda; null om båda saknas. */
export function vantskarmRubrikrad(
  status: Pick<StatusVyIndata, "adress" | "foreningNamn">,
): string | null {
  const delar = [status.adress, status.foreningNamn]
    .map((d) => d?.trim() ?? "")
    .filter((d) => d !== "");
  return delar.length > 0 ? delar.join(" · ") : null;
}

/** "Liknande lägenheter" medan du väntar: värdet (avrundat som överallt) och
 *  meningen under. Null utan värdering. Det här är modellens värde UTAN hänsyn
 *  till föreningen; det med föreningens ekonomi kommer i rapporten. */
export function vantskarmLiknande(
  status: Pick<StatusVyIndata, "liknande" | "utgangspris">,
): { varde: string; text: string } | null {
  if (!status.liknande || !(status.liknande.varde > 0)) return null;
  const pris =
    status.utgangspris !== null && status.utgangspris !== undefined && status.utgangspris > 0
      ? ` Utgångspris ${formatMkr(avrundaVardering(status.utgangspris))}.`
      : "";
  return {
    varde: `ca ${formatMkr(avrundaVardering(status.liknande.varde))}`,
    text: `Utan hänsyn till föreningen.${pris} Värdet med föreningens ekonomi inräknad kommer i rapporten.`,
  };
}

export const VANTSKARM_TIPS =
  "Fråga mäklaren om det finns beslut om avgiftshöjning som inte syns i årsredovisningen ännu.";
