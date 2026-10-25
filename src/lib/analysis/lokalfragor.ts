/**
 * Deterministic questions for the styrelse about lokal rent at risk (owner
 * decision 2026-10-25). Pure; assembled on every read next to the fee
 * prognosis, from the same classification (`calc/lokalrisk.ts`): one question
 * for each lease ending in [balansdag, horizon end] that the report does not
 * say is renewed, and one for each cited loss signal. Skipped as a whole when
 * the model's own questions already ask about lokaler / hyresavtal /
 * hyresgäster (same dedupe idea as `harRedanFragaOmRantekanslighet`).
 * At most MAX_LOKALFRAGOR questions, the largest rents first (owner
 * 2026-10-25); items without a rent figure come last, in report order.
 */
import type { Forening, Fraga } from "@/types/analysis";
import { HORISONT_MANADER } from "./calc/prognosantaganden";
import { laggTillManader } from "./calc/avgiftsprognos";
import { datumText, klassificeraLokaler } from "./calc/lokalrisk";

const NAMNER = /lokal|hyresavtal|hyresgäst/i;

/** Owner decision 2026-10-25: at most three lokal questions, largest rents first. */
export const MAX_LOKALFRAGOR = 3;

function kr(n: number): string {
  return Math.round(n).toLocaleString("sv-SE");
}

function pct(n: number): string {
  return n.toLocaleString("sv-SE", { maximumFractionDigits: 1 });
}

function kortaText(t: string, max = 110): string {
  const ren = t.trim().replace(/[.!\s]+$/, "");
  return ren.length <= max ? ren : `${ren.slice(0, max - 1).trimEnd()}…`;
}

export interface LokalFragorInput {
  forening: Forening;
  /** Sum of the föreningen's årsavgifter (kr/year), when known. */
  arsavgifter?: number | undefined;
  /** Today, YYYY-MM-DD (the prognosis' berakningsdatum). */
  idag: string;
  /** The questions already on the report (the model's and other deterministic ones). */
  befintliga: readonly Fraga[];
}

export function lokalFragor({
  forening,
  arsavgifter,
  idag,
  befintliga,
}: LokalFragorInput): Fraga[] {
  if (befintliga.some((f) => NAMNER.test(f.fraga) || NAMNER.test(f.varfor))) return [];
  const balansdag = forening.balansdag ?? `${forening.rakenskapsar}-12-31`;
  const kl = klassificeraLokaler({
    lokaler: forening.lokaler,
    antalLokaler: forening.antalLokaler?.value ?? 0,
    balansdag,
    horisontSlut: laggTillManader(idag, HORISONT_MANADER),
  });
  const andelText = (belopp: number): string =>
    arsavgifter !== undefined && arsavgifter > 0
      ? `, ${pct((belopp / arsavgifter) * 100)} % av föreningens årsavgifter`
      : "";

  const fragor: Array<{ fraga: Fraga; hyra: number | null }> = [];
  kl.signaler.forEach((s, i) => {
    if (s.hyra === 0) return;
    const hyra = s.hyra !== null ? `Hyran är ${kr(s.hyra)} kr per år${andelText(s.hyra)}. ` : "";
    fragor.push({
      hyra: s.hyra,
      fraga: {
        id: `lokal-signal-${i}`,
        fraga:
          "Hur planerar föreningen att ersätta lokalhyran som enligt årsredovisningen faller bort, och när kan lokalen vara uthyrd igen?",
        ursprung: "analys",
        riktadTill: "styrelsen",
        varfor: `Årsredovisningen nämner: ”${kortaText(s.text)}”. ${hyra}Bortfallet kan behöva täckas med högre avgifter.`,
        svarssignal:
          "Bra svar: en ny hyresgäst är klar, eller föreningen har en konkret plan och budget för lokalen. Varningssignal: att ingen vet när lokalen kan hyras ut igen.",
        ref: s.ref,
      },
    });
  });
  kl.avtal.forEach((a, i) => {
    if (a.utfall !== "osakert" || a.hyra === 0) return;
    const hyra =
      kl.hyresintakter !== null
        ? `Lokalhyrorna var ${kr(kl.hyresintakter)} kr under räkenskapsåret ${forening.rakenskapsar}${andelText(kl.hyresintakter)}. `
        : a.hyra !== null
          ? `Hyran för lokalen är ${kr(a.hyra)} kr per år${andelText(a.hyra)}. `
          : "";
    fragor.push({
      hyra: a.hyra,
      fraga: {
        id: `lokal-avtal-${i}`,
        fraga:
          `Vad händer med hyresavtalet för ${a.namn} som ${a.slutdatum < idag ? "löpte" : "löper"} ut ${datumText(a.slutdatum)}? ` +
          "Har föreningen och hyresgästen kommit överens om att förlänga, eller finns en ny hyresgäst?",
        ursprung: "analys",
        riktadTill: "styrelsen",
        varfor: `${hyra}Årsredovisningen säger inget om att avtalet förlängs.`,
        svarssignal:
          "Bra svar: avtalet är förlängt eller en ny hyresgäst har skrivit på, till ungefär samma hyra. Varningssignal: hyresgästen har sagt upp eller lokalen står tom.",
        ref: a.ref,
      },
    });
  });
  // Stable sort: largest rent first, unknown rent last (report order kept).
  return fragor
    .map((f, i) => ({ ...f, i }))
    .sort((x, y) => (y.hyra ?? -1) - (x.hyra ?? -1) || x.i - y.i)
    .slice(0, MAX_LOKALFRAGOR)
    .map((f) => f.fraga);
}
