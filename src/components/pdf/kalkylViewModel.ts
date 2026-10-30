/**
 * Ren datamappning från KalkylUnderlag + KalkylResultat till PDF-exportens
 * innehåll (ingen react-pdf här, så den går att enhetstesta). Varje siffra
 * kommer från beraknaKalkyl eller regelregistret: inget hittas på här.
 */
import { beraknaKalkyl, type DriftRad, type KalkylResultat } from "@/lib/kalkyl/berakna";
import {
  KONSUMENTVERKET_2026,
  REGELVERSION,
  REGLER,
  STATUS_ETIKETT,
  hittaRegel,
  type Regel,
} from "@/lib/kalkyl/regler";
import type { BarnAlder, KalkylUnderlag } from "@/lib/kalkyl/underlag";

const NBSP = " ";

/** Heltal med tusentalsavskiljare (hårt mellanslag) och riktigt minustecken. Oberoende av locale. */
export function heltalText(n: number): string {
  const r = Math.round(n);
  const abs = Math.abs(r)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return r < 0 ? `−${abs}` : abs;
}

export const krText = (n: number) => `${heltalText(n)}${NBSP}kr`;

export function decimalText(n: number, decimaler = 1): string {
  const s = n.toFixed(decimaler).replace(".", ",");
  return s.includes(",") ? s.replace(/0+$/, "").replace(/,$/, "") : s;
}

export const procentText = (n: number, decimaler = 1) => `${decimalText(n, decimaler)}${NBSP}%`;

const STRECK = "—";

export interface KalkylPdfRad {
  etikett: string;
  varde: string;
  /** Liten kursiv rad under, t.ex. "Schablon (uppskattning)". */
  not?: string;
  stark?: boolean;
}

export interface KalkylPdfTabell {
  kolumner: string[];
  rader: string[][];
}

export interface KalkylPdfViewModel {
  titel: string;
  datum: string;
  etikett: string | null;
  regelversion: string;
  indata: KalkylPdfRad[];
  manadskostnad: {
    rader: KalkylPdfRad[];
    total: KalkylPdfRad | null;
    totalNot: string | null;
  };
  ranteavdrag: { rader: KalkylPdfRad[]; not: string | null };
  amortering: { rader: KalkylPdfRad[]; regeltext: string };
  scenarier: KalkylPdfTabell | null;
  kalp: {
    beraknad: boolean;
    saknasText: string | null;
    boende: KalkylPdfRad[];
    levnad: KalkylPdfRad[];
    summaRader: KalkylPdfRad[];
    utfall: { tecken: "plus" | "minus"; text: string } | null;
    forutsattningar: string[];
  };
  regler: Array<{
    namn: string;
    varde: string;
    kalla: string;
    gallerFran: string;
    status: string;
    arAntagande: boolean;
  }>;
}

const FEE_TEXT = { ja: "Ja", nej: "Nej" } as const;
const BARN_TEXT: Record<BarnAlder, string> = {
  "0-3": "0–3 år",
  "4-6": "4–6 år",
  "7-10": "7–10 år",
  "11-14": "11–14 år",
  "15-17": "15–17 år",
};

function valOrStreck(v: number | undefined, fmt: (n: number) => string): string {
  return v === undefined ? STRECK : fmt(v);
}

function driftNot(p: DriftRad): string {
  if (p.ingarIAvgift) return "Ingår i avgiften (räknas inte med)";
  if (p.saknarBoarea && !p.egen) return "Boarea saknas, kan inte uppskattas";
  return p.egen ? "Ditt värde" : "Schablon (uppskattning)";
}

function regelVarde(r: Regel): string {
  if (typeof r.varde === "number") {
    const tal = Number.isInteger(r.varde) ? heltalText(r.varde) : decimalText(r.varde, 3);
    return `${tal}${NBSP}${r.enhet}`;
  }
  return r.varde;
}

function regeltextAmortering(): string {
  const l = hittaRegel("amortering_troskel_lag");
  const h = hittaRegel("amortering_troskel_hog");
  const ref = l?.referens ?? "";
  const kalla = l?.kalla.titel ?? "";
  return (
    `Belåningsgrad över ${String(h?.varde)} %: ${String(hittaRegel("amortering_takt_hog")?.varde)} % av lånet per år. ` +
    `Över ${String(l?.varde)} % till och med ${String(h?.varde)} %: ${String(hittaRegel("amortering_takt_mellan")?.varde)} % per år. ` +
    `${String(l?.varde)} % eller lägre: ingen amortering. Gränserna är ”överstiger”, så exakt ${String(l?.varde)} % ger ingen amortering och exakt ${String(h?.varde)} % ger ${String(hittaRegel("amortering_takt_mellan")?.varde)} %. ` +
    `Källa: ${kalla}, ${ref}.`
  );
}

export function buildKalkylViewModel(
  u: KalkylUnderlag,
  alt: { etikett?: string; datum?: Date; resultat?: KalkylResultat } = {},
): KalkylPdfViewModel {
  const r = alt.resultat ?? beraknaKalkyl(u);
  const datum = (alt.datum ?? new Date()).toISOString().slice(0, 10);
  const nu = r.nu;
  const kr = krText;

  // Indata
  const barnText =
    u.barn.length === 0
      ? "Inga barn"
      : (Object.keys(BARN_TEXT) as BarnAlder[])
          .map((a) => [a, u.barn.filter((b) => b === a).length] as const)
          .filter(([, n]) => n > 0)
          .map(([a, n]) => `${n} st ${BARN_TEXT[a]}`)
          .join(", ");
  const indata: KalkylPdfRad[] = [
    { etikett: "Pris du räknar med", varde: valOrStreck(u.pris, kr) },
    { etikett: "Kontantinsats", varde: valOrStreck(u.kontantinsats, kr) },
    {
      etikett: "Lån (pris minus kontantinsats)",
      varde: r.fyllt.belaning ? kr(r.lan.lanebelopp) : STRECK,
    },
    { etikett: "Din ränta", varde: valOrStreck(u.rantaProcent, (n) => procentText(n, 2)) },
    { etikett: "Månadsavgift", varde: valOrStreck(u.manadsavgift, kr) },
    { etikett: "Boarea", varde: valOrStreck(u.boarea, (n) => `${decimalText(n)}${NBSP}m²`) },
    ...(u.kalla?.pris !== undefined && u.kalla.pris !== u.pris
      ? [
          {
            etikett:
              u.kalla.prisArUppskattning === true
                ? "Pris i analysen (Binfos uppskattning)"
                : "Pris i analysen",
            varde: kr(u.kalla.pris),
          },
        ]
      : []),
    { etikett: "Antal låntagare", varde: String(u.antalLantagare) },
    {
      etikett: "Bruttoinkomst, låntagare 1",
      varde: valOrStreck(u.inkomst1, (n) => `${kr(n)} per år`),
    },
    ...(u.antalLantagare === 2
      ? [
          {
            etikett: "Bruttoinkomst, låntagare 2",
            varde: valOrStreck(u.inkomst2, (n) => `${kr(n)} per år`),
          },
        ]
      : []),
    { etikett: "Personer i hushållet", varde: String(u.antalPersoner) },
    { etikett: "Vuxna", varde: String(u.antalVuxna) },
    { etikett: "Barn", varde: barnText },
    { etikett: "Ingår värme i avgiften?", varde: FEE_TEXT[u.avgiftInkluderar.varme] },
    { etikett: "Ingår vatten i avgiften?", varde: FEE_TEXT[u.avgiftInkluderar.vatten] },
    { etikett: "Ingår hushållsel i avgiften?", varde: FEE_TEXT[u.avgiftInkluderar.el] },
    { etikett: "Ingår bredband i avgiften?", varde: FEE_TEXT[u.avgiftInkluderar.bredband] },
    { etikett: "Ingår TV i avgiften?", varde: FEE_TEXT[u.avgiftInkluderar.tv] },
    {
      etikett: "Räntehöjning i huvudscenariot",
      varde: `${decimalText(u.rantestressPp)}${NBSP}procentenheter`,
    },
    {
      etikett: "Föreningens räntekänslighet",
      varde: valOrStreck(
        u.rantekanslighetProcent,
        (n) => `${decimalText(n, 2)}${NBSP}% per procentenhet`,
      ),
    },
    { etikett: "Bankens kalkylränta (KALP)", varde: procentText(u.kalkylrantaProcent, 2) },
    ...(Object.entries(u.egnaKostnader) as Array<[string, number]>).map(([id, v]) => ({
      etikett: `Eget belopp: ${r.drift.find((p) => p.id === id)?.namn ?? id}`,
      varde: `${kr(v)} per månad`,
    })),
  ];

  // Månadskostnad
  const ranteRad: KalkylPdfRad[] = [];
  if (r.fyllt.ranteunderlag) {
    ranteRad.push(
      { etikett: "Ränta före ränteavdrag", varde: kr(nu.rantekostnad) },
      { etikett: "Ränteavdrag", varde: kr(-nu.ranteavdragPerManad) },
    );
  } else {
    ranteRad.push({ etikett: "Ränta före ränteavdrag", varde: STRECK });
  }
  const driftRader: KalkylPdfRad[] = r.drift.map((p) => ({
    etikett: p.namn,
    varde: p.ingarIAvgift ? "0 kr" : p.belopp === null ? STRECK : kr(p.belopp),
    not: driftNot(p),
  }));
  const manadsrader: KalkylPdfRad[] = [
    ...ranteRad,
    { etikett: "Amortering", varde: r.fyllt.lan ? kr(nu.amortering) : STRECK },
    { etikett: "Månadsavgift", varde: r.fyllt.avgift ? kr(nu.manadsavgift) : STRECK },
    ...driftRader,
  ];
  let total: KalkylPdfRad | null = null;
  let totalNot: string | null = null;
  if (r.fyllt.total) {
    const s = nu.summor;
    total = {
      etikett: "Total månadskostnad efter ränteavdrag",
      varde: kr(s.netto),
      stark: true,
    };
  } else {
    totalNot = "Totalen visas när pris, kontantinsats, ränta, månadsavgift och boarea är ifyllda.";
  }

  // Ränteavdrag
  const ranteavdragRader: KalkylPdfRad[] = [];
  if (r.fyllt.ranteunderlag) {
    r.skatt.hushall.personer.forEach((p, i) => {
      ranteavdragRader.push({
        etikett: `Låntagare ${i + 1}: ränteavdrag per år`,
        varde: kr(p.faktisktRanteavdragPerAr),
        ...(p.ranteavdragForloratPerAr > 0
          ? {
              not: `Skatten räcker inte till: ${kr(p.ranteavdragForloratPerAr)} av avdraget (${kr(p.beraknatRanteavdragPerAr)}) kan inte användas`,
            }
          : {}),
      });
    });
    ranteavdragRader.push({
      etikett: "Ränteavdrag, hela hushållet",
      varde: `${kr(r.ranteavdrag.perAr)} per år (${kr(r.ranteavdrag.perManad)} per månad)`,
      stark: true,
    });
  } else {
    ranteavdragRader.push({ etikett: "Ränteavdrag", varde: STRECK });
  }

  // Amortering
  const amorteringsrader: KalkylPdfRad[] = [
    {
      etikett: "Belåningsgrad",
      varde: r.fyllt.belaning ? procentText(r.lan.belaningsgradProcent, 1) : STRECK,
    },
    {
      etikett: "Amorteringstakt",
      varde: r.fyllt.belaning ? `${r.lan.amorteringstaktProcent}${NBSP}% av lånet per år` : STRECK,
    },
    ...(r.fyllt.belaning
      ? [
          {
            etikett: "Lägsta kontantinsats enligt bolånetaket",
            varde: kr(r.lan.minKontantinsats),
            ...(r.lan.kontantinsatsFel !== null ? { not: r.lan.kontantinsatsFel } : {}),
          },
        ]
      : []),
  ];

  // Scenarier
  const scenarier: KalkylPdfTabell | null =
    r.scenarier.length === 0
      ? null
      : {
          kolumner: [
            "Scenario",
            "Ränta",
            "Ränta före avdrag",
            "Månadsavgift",
            "Total efter avdrag",
            "Kvar efter boendet, före levnadskostnader",
          ],
          rader: r.scenarier.map((s) => [
            s.namn,
            procentText(s.rantaProcent, 2),
            kr(s.rantekostnad),
            kr(s.manadsavgift),
            kr(s.summor.netto),
            r.skatt.nettoinkomstPerManad > 0 && r.fyllt.boarea ? kr(s.kvarEfterBoende) : STRECK,
          ]),
        };

  // KALP
  const k = r.kalp;
  const lev = k.levnadskostnader;
  const kalp: KalkylPdfViewModel["kalp"] = {
    beraknad: k.beraknad,
    saknasText: k.beraknad
      ? null
      : k.hushalletForStort
        ? `Hushållet är större än Konsumentverkets tabell (${KONSUMENTVERKET_2026.maxPersoner} personer), så KALP kan inte räknas.`
        : `Saknas: ${k.saknas.join(", ")}.`,
    boende: k.boendeRader.map((b) => ({
      etikett: b.namn,
      varde: kr(b.belopp),
      ...(b.anmarkning !== undefined
        ? { not: b.anmarkning === "schablon" ? "Schablon (uppskattning)" : "Ditt värde" }
        : {}),
    })),
    levnad:
      k.beraknad && lev !== null
        ? lev.rader.map((l) => ({
            etikett: l.namn,
            varde: kr(l.belopp),
            ...(l.ingarIAvgift === true ? { not: "Ingår i månadsavgiften" } : {}),
          }))
        : [],
    summaRader:
      k.beraknad && k.summaKostnader !== null
        ? [
            { etikett: "Bankens kalkylerade kostnader", varde: kr(k.summaKostnader), stark: true },
            { etikett: "Nettoinkomst per månad", varde: kr(k.nettoinkomstPerManad) },
          ]
        : [],
    utfall:
      k.kvarAttLevaPa !== null && k.utfall !== null
        ? {
            tecken: k.utfall,
            text:
              k.utfall === "plus"
                ? `Plus: ${kr(k.kvarAttLevaPa)} kvar att leva på per månad`
                : `Minus: ${kr(k.kvarAttLevaPa)} per månad`,
          }
        : null,
    forutsattningar: k.forutsattningar,
  };

  // Regler: allt utom Konsumentverkets enskilda tabellvärden, som sammanfattas.
  const KV_GRUPP = "Levnadskostnader (KALP)";
  const reglerRader = REGLER.filter(
    (x) => x.grupp !== KV_GRUPP || x.id === "kalp_barn_under_8_avdrag",
  ).map((x) => ({
    namn: x.referens !== undefined ? `${x.namn} (${x.referens})` : x.namn,
    varde: regelVarde(x),
    kalla: x.kalla.titel,
    gallerFran: x.gallerFran,
    status: STATUS_ETIKETT[x.status],
    arAntagande: x.status === "antagande" || x.status === "schablon",
  }));
  const kv = REGLER.find((x) => x.grupp === KV_GRUPP && x.id.startsWith("kv_"));
  if (kv !== undefined) {
    reglerRader.push({
      namn: "Levnadskostnader per åldersgrupp och hushållsstorlek (alla tabellvärden)",
      varde: "Se uppdelningen under bankens kalkyl",
      kalla: kv.kalla.titel,
      gallerFran: kv.gallerFran,
      status: STATUS_ETIKETT[kv.status],
      arAntagande: false,
    });
  }

  return {
    titel: "Bolånekalkyl",
    datum,
    etikett: alt.etikett !== undefined && alt.etikett !== "" ? alt.etikett : null,
    regelversion: REGELVERSION,
    indata,
    manadskostnad: { rader: manadsrader, total, totalNot },
    ranteavdrag: { rader: ranteavdragRader, not: r.ranteavdrag.not },
    amortering: { rader: amorteringsrader, regeltext: regeltextAmortering() },
    scenarier,
    kalp,
    regler: reglerRader,
  };
}

/** Filnamn: binfo-bolanekalkyl-YYYY-MM-DD.<ändelse> */
export function kalkylFilnamn(andelse: "pdf" | "xlsx", datum: Date = new Date()): string {
  return `binfo-bolanekalkyl-${datum.toISOString().slice(0, 10)}.${andelse}`;
}
