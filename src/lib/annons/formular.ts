/**
 * Pure logic for "Hämta uppgifter" on /analysera: the click flow, applying a
 * listing answer to the form, and per-field provenance (booli / manuellt /
 * saknas). No React, no server imports: the caller injects the two functions
 * the click flow may use (URL check and fetch), so nothing else can be
 * triggered from here (in particular never a valuation or an analysis).
 */

import type { AnalyseraFormFields } from "@/lib/analyseraForm";
import { AnnonsKallaSchema } from "@/lib/analysis/schema";
import {
  ANNONS_FALT,
  ANNONS_MEDDELANDE,
  type AnnonsFalt,
  type AnnonsKalla,
  type AnnonsSvar,
} from "@/lib/annons/typer";
import type { AnnonsUrlUtfall } from "@/lib/annons/url";
import type { Tristate } from "@/types/analysis";

// ---------------------------------------------------------------------------
// Click flow
// ---------------------------------------------------------------------------

export type AnnonsHamtning =
  { typ: "ok"; svar: Extract<AnnonsSvar, { ok: true }> } | { typ: "fel"; meddelande: string };

export interface AnnonsBeroenden {
  kontrollera: (ratt: string) => AnnonsUrlUtfall;
  hamta: (url: string) => Promise<AnnonsSvar>;
}

export const TOM_LANK_MEDDELANDE = "Klistra in en länk från Booli först.";

/** Server error codes whose own (buyer-safe) message is shown verbatim. */
const VISA_SERVERNS_TEXT = new Set(["kvot", "avstangd", "behorighet", "ogiltig_url", "fel_doman"]);

/**
 * Checks the pasted text, fetches once, and returns either the listing answer
 * or a Swedish message to show under the field. Never throws.
 */
export async function hamtaAnnonsUppgifter(
  ratt: string,
  { kontrollera, hamta }: AnnonsBeroenden,
): Promise<AnnonsHamtning> {
  const lank = ratt.trim();
  if (lank === "") return { typ: "fel", meddelande: TOM_LANK_MEDDELANDE };

  const kontroll = kontrollera(lank);
  if (!kontroll.ok) return { typ: "fel", meddelande: ANNONS_MEDDELANDE[kontroll.errorCode] };

  let svar: AnnonsSvar;
  try {
    svar = await hamta(kontroll.url);
  } catch (fel) {
    console.error("[analysera] hamtaAnnonsFn kastade:", fel);
    return { typ: "fel", meddelande: ANNONS_MEDDELANDE.allmant };
  }
  if (svar.ok) return { typ: "ok", svar };
  return {
    typ: "fel",
    meddelande: VISA_SERVERNS_TEXT.has(svar.errorCode)
      ? svar.errorMessage
      : ANNONS_MEDDELANDE.allmant,
  };
}

// ---------------------------------------------------------------------------
// Applying an answer to the form
// ---------------------------------------------------------------------------

export type Ursprung = "booli" | "manuellt" | "saknas";

export interface AnnonsFormLage {
  kalla: {
    url: string;
    maklarUrl?: string;
    forening?: string;
    hamtad: string;
    stadsdel?: string;
  };
  ursprung: Record<AnnonsFalt, Ursprung>;
  /** The postcode came from geocoding the address (OpenStreetMap), not from the listing. */
  postnummerGeokodat: boolean;
  /** The values were read out of the listing text by a model (server fallback), not parsed. */
  tolkatAvModell: boolean;
}

export interface AnnonsTristates {
  hiss: Tristate;
  balkong: Tristate;
}

export interface AnnonsTillampning extends AnnonsTristates {
  form: AnalyseraFormFields;
  lage: AnnonsFormLage;
}

/** Groups digits in threes with a plain space: 4500000 -> "4 500 000". */
function grupperaHeltal(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** One decimal at most, comma as decimal separator: 41.5 -> "41,5", 2 -> "2". */
function formateraDecimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace(".", ",");
}

function formateraPostnummer(raw: string): string {
  const siffror = raw.replace(/\D/g, "");
  return siffror.length === 5 ? `${siffror.slice(0, 3)} ${siffror.slice(3)}` : raw.trim();
}

/** Form text for a found value, formatted the way the field's parser and placeholder expect. */
type Formaterare = (u: Extract<AnnonsSvar, { ok: true }>["uppgifter"]) => string | undefined;

const tal = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
const renText = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

const TEXTFALT: Record<Exclude<AnnonsFalt, "hiss" | "balkong" | "ort">, Formaterare> = {
  boarea: (u) => (tal(u.boarea) ? formateraDecimal(u.boarea) : undefined),
  antalRum: (u) => (tal(u.antalRum) ? formateraDecimal(u.antalRum) : undefined),
  manadsavgift: (u) => (tal(u.manadsavgift) ? grupperaHeltal(u.manadsavgift) : undefined),
  postnummer: (u) => {
    const p = renText(u.postnummer);
    return p === undefined ? undefined : formateraPostnummer(p);
  },
  vaning: (u) => (tal(u.vaning) ? String(Math.trunc(u.vaning)) : undefined),
  byggar: (u) => (tal(u.byggar) ? String(Math.trunc(u.byggar)) : undefined),
  utgangspris: (u) => (tal(u.utgangspris) ? grupperaHeltal(u.utgangspris) : undefined),
  adress: (u) => renText(u.adress),
};

/**
 * New form strings, Tristates and provenance for a successful answer. A field
 * the listing has overwrites the form value. For a field it lacks (ursprung
 * "saknas"), `fore` (the state after the previous fetch, null on the first)
 * decides:
 * - the value still came from the previous listing ("booli"): it is cleared
 *   (text) or reset to "okant" (hiss/balkong), so a stale value never passes
 *   for this listing's;
 * - the buyer typed or changed it ("manuellt", "saknas"), or there was no
 *   previous fetch: it is kept.
 * hiss/balkong become "ja" when the listing says so and are otherwise never
 * "nej": a missing amenity is unknown. A second fetch replaces the whole
 * provenance state.
 */
export function tillampaAnnons(
  form: AnalyseraFormFields,
  tristates: AnnonsTristates,
  svar: Extract<AnnonsSvar, { ok: true }>,
  fore: AnnonsFormLage | null = null,
): AnnonsTillampning {
  const u = svar.uppgifter;
  const nyForm: AnalyseraFormFields = { ...form };
  const ursprung = {} as Record<AnnonsFalt, Ursprung>;
  const nyaTristates: AnnonsTristates = { hiss: tristates.hiss, balkong: tristates.balkong };

  for (const falt of ANNONS_FALT) {
    const varFranForraAnnonsen = fore?.ursprung[falt] === "booli";
    if (falt === "hiss" || falt === "balkong") {
      if (u[falt] === "ja") {
        nyaTristates[falt] = "ja";
        ursprung[falt] = "booli";
      } else {
        if (varFranForraAnnonsen) nyaTristates[falt] = "okant";
        ursprung[falt] = "saknas";
      }
      continue;
    }
    if (falt === "ort") {
      // The form has no Ort field (owner 2026-10-26): the listing's ort is only used by the
      // server's geocoder. Never shown, never copied into the form.
      ursprung[falt] = "saknas";
      continue;
    }
    const varde = TEXTFALT[falt](u);
    if (varde === undefined) {
      if (varFranForraAnnonsen) nyForm[falt] = "";
      ursprung[falt] = "saknas";
    } else {
      nyForm[falt] = varde;
      ursprung[falt] = "booli";
    }
  }

  const maklarUrl = renText(u.maklarUrl);
  const forening = renText(u.forening);
  const stadsdel = renText(u.stadsdel);
  const kalla: AnnonsFormLage["kalla"] = {
    url: svar.url,
    hamtad: svar.hamtad,
    ...(maklarUrl !== undefined ? { maklarUrl } : {}),
    ...(forening !== undefined ? { forening } : {}),
    ...(stadsdel !== undefined ? { stadsdel } : {}),
  };

  return {
    form: nyForm,
    hiss: nyaTristates.hiss,
    balkong: nyaTristates.balkong,
    lage: {
      kalla,
      ursprung,
      postnummerGeokodat: svar.postnummerKalla === "geokodning",
      tolkatAvModell: svar.tolkning === "llm",
    },
  };
}

/** Boarea as the store (setUppgifter) wants it, parsed like the Boarea field's onChange. */
export function boareaTillTal(boarea: string): number {
  return Number(boarea.replace(",", ".")) || 0;
}

/** An edit of a fetched field makes it "manuellt"; other origins are unchanged. */
export function markeraAndrad(lage: AnnonsFormLage, falt: string): AnnonsFormLage {
  const nyckel = ANNONS_FALT.find((f) => f === falt);
  if (nyckel === undefined || lage.ursprung[nyckel] !== "booli") return lage;
  return { ...lage, ursprung: { ...lage.ursprung, [nyckel]: "manuellt" } };
}

/**
 * The `kalla` stored with the analysis: fields still holding the fetched value,
 * in form order. The optional texts come from the listing and are untrusted:
 * one that breaks the strict schema (`AnnonsKallaSchema`) is dropped, never
 * truncated, so it can't make the whole analysis fail.
 */
export function tillAnnonsKalla(lage: AnnonsFormLage): AnnonsKalla {
  const bas = {
    typ: "booli" as const,
    url: lage.kalla.url,
    hamtad: lage.kalla.hamtad,
    oandradeFalt: ANNONS_FALT.filter((f) => lage.ursprung[f] === "booli"),
  };
  const { maklarUrl, forening } = lage.kalla;
  const giltig = (extra: { maklarUrl?: string; forening?: string }): AnnonsKalla | null => {
    const kandidat = {
      typ: bas.typ,
      url: bas.url,
      ...extra,
      hamtad: bas.hamtad,
      oandradeFalt: bas.oandradeFalt,
    };
    return AnnonsKallaSchema.safeParse(kandidat).success ? kandidat : null;
  };
  const med = {
    ...(maklarUrl !== undefined ? { maklarUrl } : {}),
    ...(forening !== undefined ? { forening } : {}),
  };
  const utanMaklarUrl = forening !== undefined ? { forening } : {};
  const utanForening = maklarUrl !== undefined ? { maklarUrl } : {};
  // Keep as much as is valid: both, then each alone, then neither.
  return giltig(med) ?? giltig(utanMaklarUrl) ?? giltig(utanForening) ?? { ...bas };
}

// ---------------------------------------------------------------------------
// Per-field display
// ---------------------------------------------------------------------------

export const HINT_BOOLI = "Hämtat från Booli";
/** ODbL attribution: the postcode was looked up in OpenStreetMap data. */
export const HINT_GEOKODAT = "Uppslaget från adressen (© OpenStreetMap-bidragsgivare)";
/** The model fallback read the values out of the listing text: not a Booli fact. */
export const HINT_TOLKAT = "Tolkat från annonsens text – kontrollera";
export const HINT_MANUELLT = "Ändrat manuellt";
export const HINT_SAKNAS = "Fanns inte i annonsen, fyll i själv";
export const HINT_SAKNAS_VALFRITT = "Framgår inte av annonsen";

/** `Field` props for a text field: hint and highlight (keys omitted when unused). */
export function annonsFaltVisning(
  lage: AnnonsFormLage | null,
  falt: AnnonsFalt,
  varde: string,
): { hint?: string; framhav?: boolean } {
  if (lage === null || falt === "ort") return {}; // Ort has no form field
  switch (lage.ursprung[falt]) {
    case "booli":
      return {
        hint:
          falt === "postnummer" && lage.postnummerGeokodat
            ? HINT_GEOKODAT
            : lage.tolkatAvModell
              ? HINT_TOLKAT
              : HINT_BOOLI,
      };
    case "manuellt":
      return { hint: HINT_MANUELLT };
    case "saknas":
      return varde.trim() === "" ? { hint: HINT_SAKNAS, framhav: true } : {};
  }
}

/** Short text beside the Hiss/Balkong label (no highlight: both are optional). */
export function annonsTristateText(
  lage: AnnonsFormLage | null,
  falt: "hiss" | "balkong",
  varde: Tristate,
): string | undefined {
  if (lage === null) return undefined;
  switch (lage.ursprung[falt]) {
    case "booli":
      return lage.tolkatAvModell ? HINT_TOLKAT : HINT_BOOLI;
    case "manuellt":
      return HINT_MANUELLT;
    case "saknas":
      return varde === "okant" ? HINT_SAKNAS_VALFRITT : undefined;
  }
}

/** Step 2 hint when the listing names the association. */
export function foreningsHint(lage: AnnonsFormLage | null): string | null {
  const forening = lage?.kalla.forening;
  return forening === undefined
    ? null
    : `Booli anger föreningen: ${forening}. Kontrollera att årsredovisningen gäller den.`;
}

// ---------------------------------------------------------------------------
// Redesign v4: märken (badge) bredvid fältetiketten och antalet ifyllda uppgifter
// ---------------------------------------------------------------------------

export const MARKE_ANNONS = "Från annonsen";
export const MARKE_GEOKODAT = "Från OpenStreetMap";
export const MARKE_TOLKAT = "Tolkat från annonsen";
export const MARKE_MANUELLT = "Ändrat manuellt";
const HINT_KONTROLLERA = "Kontrollera att det stämmer.";

export interface AnnonsMarke {
  text: string;
  ton: "success" | "neutral" | "warning";
}

/**
 * Hur många uppgifter som faktiskt fylldes i från annonsen: fälten med ursprung "booli"
 * (Ort har inget fält och räknas aldrig; Hiss/Balkong räknas bara när annonsen sa "ja").
 */
export function antalHamtade(lage: AnnonsFormLage): number {
  return ANNONS_FALT.filter((f) => f !== "ort" && lage.ursprung[f] === "booli").length;
}

/** Texten under länkfältet efter en lyckad hämtning. */
export function annonsResultatText(antal: number): string {
  if (antal === 0) return "Vi hittade inga uppgifter i annonsen. Fyll i dem nedan.";
  return `Vi fyllde i ${antal} ${antal === 1 ? "uppgift" : "uppgifter"} från annonsen. Kontrollera dem nedan.`;
}

/** `Field`-props för ett textfält: märke bredvid etiketten, hint och markering. Nycklar utelämnas när de inte används. */
export function annonsFaltMarkering(
  lage: AnnonsFormLage | null,
  falt: AnnonsFalt,
  varde: string,
): { marke?: AnnonsMarke; hint?: string; framhav?: boolean } {
  if (lage === null || falt === "ort") return {};
  switch (lage.ursprung[falt]) {
    case "booli":
      if (falt === "postnummer" && lage.postnummerGeokodat) {
        return { marke: { text: MARKE_GEOKODAT, ton: "success" }, hint: HINT_GEOKODAT };
      }
      return lage.tolkatAvModell
        ? { marke: { text: MARKE_TOLKAT, ton: "warning" }, hint: HINT_KONTROLLERA }
        : { marke: { text: MARKE_ANNONS, ton: "success" } };
    case "manuellt":
      return { marke: { text: MARKE_MANUELLT, ton: "neutral" } };
    case "saknas":
      return varde.trim() === "" ? { hint: HINT_SAKNAS, framhav: true } : {};
  }
}

/** Märket bredvid Hiss/Balkong (båda kan lämnas som "Vet ej", så ingen markering). */
export function annonsTristateMarke(
  lage: AnnonsFormLage | null,
  falt: "hiss" | "balkong",
  varde: Tristate,
): AnnonsMarke | undefined {
  if (lage === null) return undefined;
  switch (lage.ursprung[falt]) {
    case "booli":
      return lage.tolkatAvModell
        ? { text: MARKE_TOLKAT, ton: "warning" }
        : { text: MARKE_ANNONS, ton: "success" };
    case "manuellt":
      return { text: MARKE_MANUELLT, ton: "neutral" };
    case "saknas":
      return varde === "okant" ? { text: HINT_SAKNAS_VALFRITT, ton: "neutral" } : undefined;
  }
}
