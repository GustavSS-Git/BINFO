/**
 * Deterministic refinancing flag (round 2026-10-26). The judging model writes
 * its red flags ONCE, date-independent, so it cannot know which loans have
 * already matured or what a reset costs at today's rate. Binfo computes that
 * per read (`calc/avgiftsprognos.ts`); this module turns the SAME numbers
 * (`prognos.refinansiering` + the `refinansiering` component) into the flag
 * and one summary sentence. Pure; no model output, nothing invented.
 *
 * `arRefinansieringsflagga` recognises a MODEL flag about refinancing so the
 * caller can drop it on read when the deterministic flag replaces it (older
 * stored results still contain such flags).
 */
import type {
  AvgiftsKomponent,
  Avgiftsprognos,
  RedFlag,
  RefinansieringsLan,
  Severity,
} from "@/types/analysis";
import { datumText } from "./calc/lokalrisk";

/** Below this |kr/month| the effect is described as "påverkar avgiften knappt".
 *  Owner wording 2026-10-26 ("under 10 kr/mån"). */
export const KNAPP_PAVERKAN_KR_PER_MANAD = 10;

/** No flag at all when less than this share of the debt resets within the
 *  horizon (or matured) AND the effect is negligible. */
// TODO: unverified placeholder (round 2026-10-26)
export const REFI_FLAGGA_MIN_ANDEL = 0.1;

/** A share of the debt at or above this (resetting or matured) raises the
 *  severity to 'medel' when the effect is a rise of at least
 *  KNAPP_PAVERKAN_KR_PER_MANAD, or when matured (unknown terms). */
// TODO: unverified placeholder (round 2026-10-26)
export const REFI_FLAGGA_MEDEL_ANDEL = 0.5;

export const REFINANSIERINGSFLAGGA_ID = "refinansiering-berakning";

function kr(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString("sv-SE");
}

function pct(n: number): string {
  return n.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function pct2(n: number): string {
  return n.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
}

interface Sammanstallning {
  horisont: number;
  /** Fixed-rate loans resetting within the horizon (dated, priced). */
  omsatt: number;
  /** Of `omsatt`: dated fixed-rate loans (the rest is rörlig). */
  fast: number;
  antalOmsatt: number;
  /** Rörlig-rate loans (reprice continuously). */
  rorlig: number;
  /** Matured loans (reset date on or before the calculation date). */
  forfallet: number;
  forfalletDatum: string[];
  /** Later-phase loans (month 25–60) that add to the component's kr/mån. */
  senare: number;
  /** Undated debt: a share is assumed to reprice (also in the component's kr/mån). */
  antagen: boolean;
  total: number;
  /** null = the prognosis has no usable component amount. */
  krPerManad: number | null;
  krPerAr: number | null;
  nuvarandeRanta: number | null;
  nyRanta: number;
  komponent: AvgiftsKomponent | undefined;
}

function sammanstall(
  prognos: Avgiftsprognos,
  totalSkuld: number | null | undefined,
): Sammanstallning | null {
  const u = prognos.refinansiering;
  const rader: RefinansieringsLan[] = u?.lan ?? [];
  // Without per-loan rows the horizon amount is an ASSUMED share of the debt:
  // nothing factual to flag.
  if (!u || rader.length === 0) return null;
  const komponent = prognos.komponenter.find((k) => k.id === "refinansiering");
  const fasta = rader.filter((r) => r.fas === "inom_horisont" && !r.rorlig);
  const rorliga = rader.filter((r) => r.fas === "inom_horisont" && r.rorlig);
  const forfallna = rader.filter((r) => r.fas === "forfallit");
  const summa = (xs: RefinansieringsLan[]) => xs.reduce((s, r) => s + r.belopp, 0);
  const radSumma = summa(rader);
  const total =
    totalSkuld !== null && totalSkuld !== undefined && totalSkuld > 0 ? totalSkuld : radSumma;
  const beraknad = komponent?.status === "beraknad";
  return {
    horisont: prognos.horisontManader,
    // Same amount the component prices: dated fixed loans + rörlig loans
    // within the horizon (the kr/mån is computed on both).
    omsatt: summa(fasta) + summa(rorliga),
    fast: summa(fasta),
    antalOmsatt: fasta.length + rorliga.length,
    rorlig: summa(rorliga),
    forfallet: summa(forfallna),
    forfalletDatum: forfallna.flatMap((r) =>
      r.dag ? [r.endastAr ? `under ${r.dag.slice(0, 4)}` : datumText(r.dag)] : [],
    ),
    senare: summa(rader.filter((r) => r.fas === "senare")),
    antagen: u.antagenAndelProcent !== undefined,
    total,
    krPerManad: beraknad ? (komponent?.krPerManad ?? null) : null,
    krPerAr: beraknad ? (komponent?.foreningKrPerAr ?? null) : null,
    nuvarandeRanta: u.nuvarandeRantaProcent,
    nyRanta: u.nyRantaProcent,
    komponent,
  };
}

function lista(delar: string[]): string {
  return delar.length <= 1
    ? (delar[0] ?? "")
    : `${delar.slice(0, -1).join(", ")} och ${delar[delar.length - 1]}`;
}

/** True when anything is priced: dated/rörlig loans within the horizon, later-phase loans or an assumed share. */
function harPrisat(s: Sammanstallning): boolean {
  return s.omsatt > 0 || s.senare > 0 || s.antagen;
}

/** What the component's kr/mån covers beyond the `omsatt` amount, or "" when it is exactly that amount. */
function ocksaMedText(s: Sammanstallning): string {
  const delar: string[] = [];
  if (s.senare > 0) {
    delar.push(`lån på ${kr(s.senare)} kr som omsätts senare (månad 25–60, med minskad vikt)`);
  }
  if (s.antagen) delar.push("en antagen andel av skuld utan angivet datum");
  return lista(delar);
}

/** "höjer avgiften med ca 120 kr/mån" / "sänker …" / "påverkar avgiften knappt (ca 3 kr/mån)". */
function riktningText(s: Sammanstallning): string | null {
  if (s.krPerManad === null) return null;
  if (Math.abs(s.krPerManad) < KNAPP_PAVERKAN_KR_PER_MANAD) {
    return `påverkar avgiften knappt (ca ${kr(s.krPerManad)} kr/mån)`;
  }
  return `${s.krPerManad < 0 ? "sänker" : "höjer"} avgiften med ca ${kr(s.krPerManad)} kr/mån`;
}

function andelAv(del: number, s: Sammanstallning): number {
  return s.total > 0 ? del / s.total : 0;
}

/** One sentence from the same numbers as the flag; null when there is nothing factual to say. */
export function refinansieringsMening(
  prognos: Avgiftsprognos,
  totalSkuld?: number | null,
): string | null {
  const s = sammanstall(prognos, totalSkuld);
  if (!s || (s.omsatt <= 0 && s.forfallet <= 0)) return null;
  const delar: string[] = [];
  const rikt = harPrisat(s) ? riktningText(s) : null;
  const ocksa = ocksaMedText(s);
  if (s.omsatt > 0) {
    delar.push(
      `${pct(andelAv(s.omsatt, s) * 100)} % av lånen (${kr(s.omsatt)} kr) får ny ränta inom ${s.horisont} månader` +
        (rikt
          ? `, vilket vid dagens ränta ${rikt}${ocksa ? ` totalt, inklusive ${ocksa}` : ""}`
          : ""),
    );
  } else if (rikt) {
    delar.push(`Lån som omsätts senare eller utan angivet datum ${rikt} vid dagens ränta`);
  }
  if (s.forfallet > 0) {
    delar.push(
      `lån på ${kr(s.forfallet)} kr har troligen redan fått nya villkor som vi inte känner till`,
    );
  }
  const text = delar.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * The flag, from the refinancing component and its per-loan rows only.
 * Severity (deterministic):
 * - 'medel': at least REFI_FLAGGA_MEDEL_ANDEL of the debt resets within the
 *   horizon AND the effect is a rise of at least KNAPP_PAVERKAN_KR_PER_MANAD;
 *   or the component's own fee-pressure colour is yellow; or at least
 *   REFI_FLAGGA_MEDEL_ANDEL of the debt has matured (terms unknown);
 * - 'hog': the component's fee-pressure colour is red (rise > 10 % of the fee);
 * - else 'lag'.
 * No flag when nothing resets or has matured, or when under
 * REFI_FLAGGA_MIN_ANDEL of the debt is involved and the effect is negligible.
 */
export function byggRefinansieringsflagga(
  prognos: Avgiftsprognos,
  totalSkuld?: number | null,
): RedFlag | null {
  const s = sammanstall(prognos, totalSkuld);
  if (!s || (s.omsatt <= 0 && s.forfallet <= 0)) return null;
  const andelOmsatt = andelAv(s.omsatt, s);
  const andelForfallet = andelAv(s.forfallet, s);
  const knapp = s.krPerManad !== null && Math.abs(s.krPerManad) < KNAPP_PAVERKAN_KR_PER_MANAD;
  if (andelOmsatt < REFI_FLAGGA_MIN_ANDEL && andelForfallet < REFI_FLAGGA_MIN_ANDEL && knapp) {
    return null;
  }

  let severity: Severity = "lag";
  const tryck = s.komponent?.tryck;
  if (tryck === "rod") severity = "hog";
  else if (
    tryck === "gul" ||
    andelForfallet >= REFI_FLAGGA_MEDEL_ANDEL ||
    (andelOmsatt >= REFI_FLAGGA_MEDEL_ANDEL &&
      s.krPerManad !== null &&
      s.krPerManad >= KNAPP_PAVERKAN_KR_PER_MANAD)
  ) {
    severity = "medel";
  }

  const titel =
    s.omsatt > 0
      ? `${pct(andelOmsatt * 100)} % av lånen får ny ränta inom ${s.horisont} månader`
      : `Lån på ${kr(s.forfallet)} kr har troligen redan fått nya villkor`;

  const delar: string[] = [];
  if (s.omsatt > 0) {
    const ranta =
      s.nuvarandeRanta !== null
        ? ` Räntan går från i snitt ${pct2(s.nuvarandeRanta)} % till ${pct2(s.nyRanta)} %.`
        : ` Den nya räntan räknar vi till ${pct2(s.nyRanta)} %.`;
    const uppdelning =
      s.rorlig > 0 && s.fast > 0
        ? `: rörliga lån på ${kr(s.rorlig)} kr, som följer marknaden löpande, och lån på ${kr(s.fast)} kr med villkorsändringsdag inom perioden`
        : s.rorlig > 0
          ? " (rörliga lån, som följer marknaden löpande)"
          : "";
    delar.push(
      `${kr(s.omsatt)} kr av föreningens lån (${pct(andelOmsatt * 100)} % av skulden på ${kr(s.total)} kr) ` +
        `får ny ränta inom ${s.horisont} månader från ${datumText(prognos.berakningsdatum)}${uppdelning}.` +
        ranta,
    );
  }
  if (s.forfallet > 0) {
    delar.push(
      `Lån på ${kr(s.forfallet)} kr${s.forfalletDatum.length > 0 ? ` (villkorsändringsdag ${lista(s.forfalletDatum)})` : ""} ` +
        "har troligen redan fått nya villkor som vi inte känner till; de räknas inte i beräkningen.",
    );
  }
  if (harPrisat(s)) {
    const rikt = riktningText(s);
    const ocksa = ocksaMedText(s);
    delar.push(
      rikt
        ? `Vid dagens ränta ${rikt.replace(/^(höjer|sänker|påverkar) /, "$1 det ")} enligt Binfos beräkning${ocksa ? `, totalt inklusive ${ocksa}` : ""}.`
        : "Vad omsättningen kostar kan vi inte räkna ut, eftersom räntan på lånen saknas.",
    );
  } else {
    delar.push("Vi kan därför inte räkna ut hur de nya villkoren påverkar avgiften.");
  }

  const ref = s.komponent?.ref ?? prognos.refinansiering?.lan?.find((r) => r.ref)?.ref;
  return {
    id: REFINANSIERINGSFLAGGA_ID,
    titel,
    beskrivning: delar.join(" "),
    severity,
    ...(ref ? { ref } : {}),
    harledsFran: ["rantekanslighet", "skuldsattning_per_m2_totalyta"],
  };
}

// ---------------------------------------------------------------------------
// Recognising a model flag about refinancing
// ---------------------------------------------------------------------------

// Unambiguous: only ever about loans.
const REFI_ENTYDIG =
  /(?<![a-zåäö])(?:refinansi\w*|villkorsändr\w*|bindningstid\w*|räntebindning\w*|ränteomläggning\w*|omförhandl\w*)/i;
// Ambiguous: "omsätt*" is also revenue ("nettoomsättning"), "förfall" also decay
// ("risk för förfall"). The lookbehind rejects compounds (nettoomsättning); förfall
// counts only as förfaller/förfallit/förfallna/förfallo*.
const REFI_TVETYDIG = /(?<![a-zåäö])(?:omsätt\w*|omsatt\w*|förfall(?:er|it|na|o\w*))/i;
const LAN_ORD = /(?<![a-zåäö])(?:lån\w*|kredit\w*|ränt\w*|villkor\w*|bolån\w*)/i;

/**
 * True for a MODEL flag about loan maturities / refinancing, decided on the
 * TITLE only (a description that merely mentions maturities, e.g. a "Hög
 * skuldsättning" flag, is never deleted). A term only ever about loans
 * (refinansiering, villkorsändring, bindningstid, räntebindning) is enough; an
 * ambiguous one (omsätt*, förfall*) needs a loan word in the same title and a
 * debt/rate figure in `harledsFran`. Favours false negatives: a model flag
 * that stays is better than a real flag deleted.
 */
export function arRefinansieringsflagga(f: RedFlag): boolean {
  if (f.id === REFINANSIERINGSFLAGGA_ID) return false;
  if (REFI_ENTYDIG.test(f.titel)) return true;
  const skuldEllerRanta = f.harledsFran.some(
    (id) => id === "rantekanslighet" || id.startsWith("skuldsattning_"),
  );
  return skuldEllerRanta && REFI_TVETYDIG.test(f.titel) && LAN_ORD.test(f.titel);
}
