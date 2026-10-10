import { STEG_TEXT, stegAndel, type AnalysStage } from "@/lib/analysStatusCopy";

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

/** Stegen i den ordning de inträffar. `transkribering` ingår bara för en
 *  skannad rapport — annars hoppas steget över och ska inte räknas in. */
function stegOrdning(textlager: StatusTextlager | undefined): StatusRapportSteg[] {
  const skannad = textlager === "saknas" || textlager === "trasigt";
  return skannad
    ? ["identifiering", "transkribering", "grundning", "extraktion", "bedomning", "klar"]
    : ["identifiering", "grundning", "extraktion", "bedomning", "klar"];
}

/** Stegtexten: rapportens riktiga steg när det finns, annars den gamla
 *  `stage`-texten. */
export function stegTextFor(status: StatusVyIndata): string {
  return status.rapportSteg ? RAPPORTSTEG_TEXT[status.rapportSteg] : STEG_TEXT[status.stage];
}

/** Förloppsandel 0–1 (aldrig 0). Följer rapportens steg när det finns. */
export function stegAndelFor(status: StatusVyIndata): number {
  if (!status.rapportSteg) return stegAndel(status.stage);
  const ordning = stegOrdning(status.textlager);
  const index = ordning.indexOf(status.rapportSteg);
  // Ett steg som inte hör till ordningen (transkribering utan känt textlager)
  // ska hellre ge ett litet än ett felaktigt stort förlopp.
  if (index === -1) return stegAndel(status.stage);
  return (index + 1) / ordning.length;
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
