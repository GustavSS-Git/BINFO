/**
 * Pure data mapping from AnalysisResult to the PDF's content (redesign v4) — no
 * react-pdf import here on purpose, so this stays trivially unit-testable. It
 * mirrors the web report (AnalysRapport.tsx and src/components/rapport/*) by
 * calling the SAME helpers in src/lib/analysisView.ts, src/lib/prisVy.ts and
 * src/lib/betygVy.ts, so web and PDF say the same thing from the same numbers.
 * AnalysPdfDocument.tsx turns this into JSX; it must not re-decide content.
 *
 * Differences from the web, on purpose: the PDF lists EVERY red flag (the web
 * shows two), has no closing "Sammanfattning" (owner Q10, 2026-10-28), has the
 * collapsed web sections ("Så har vi räknat", "Det här driver …", "Mer ur
 * årsredovisningen") fully open, and replaces the interactive slider by tables.
 */
import { iEllerPaOmrade } from "@/lib/omradeText";
import {
  ENERGI_TEXT,
  KOMPONENT_KORTNAMN,
  MODELL_FAKTORER_INTRO,
  OMRADES_KALLA_RAD,
  PRISEFFEKT_CAVEAT,
  RAKNA_FAKTORER,
  RANTEKANSLIGHET_PRIS_RAD,
  REFI_FASTRAD,
  SKANNAD_NOTIS,
  TRYCK_ETIKETT,
  VARDESPANN_PROCENT,
  andelAvSkuldRad,
  antagenAndelText,
  antalIOrd,
  arOgraderatNyckeltal,
  arSkannad,
  avgiftIngarText,
  avgiftKort,
  avgiftLead,
  avgiftRubrik,
  avrundaKomponentEffekter,
  avrundaVardering,
  byggarMarkor,
  byggarPrisNotis,
  byggdelFotnot,
  byggdelTabell,
  drivareRader,
  foreningFaktaText,
  foreningenRubrik,
  forstaMening,
  formatBoareaKort,
  formatBudpremieText,
  formatDataperiodLang,
  formatFigureVarde,
  formatForandringKr,
  formatProcentTal,
  formatSigneratKr,
  formatSkapadDatum,
  formatVardeAvrundat,
  formatVardespann,
  horisontText,
  kvmPrisForVardering,
  lageMotVardespann,
  lanKallaText,
  lanTabell,
  medVersal,
  modellKallaRad,
  modellVersionText,
  nyckeltalJamforelse,
  komponentPris,
  prisEffektTexter,
  prisRubrik,
  rantestressVy,
  rapportOmrade,
  refiKomponent,
  referensrantaRad,
  refinansieringRader,
  sorteraNyckeltal,
  sparKomponent,
  sparRader,
  sparPrincipText,
  svarssignalDelar,
  tonForTryck,
  vardespann,
  varderingsKallaText,
  varderingsTackningText,
  vattenfall,
  visasNyckeltal,
  visatVarde,
  BYGGDEL_KALLOR,
  type Ton,
} from "@/lib/analysisView";
import { BETYG_TITEL } from "@/lib/betygVy";
import { KONTAKT_EPOST } from "@/lib/kontakt";
import { formatMkr, formatSpannMkr, kvmPris, vanligtBud } from "@/lib/prisVy";
import { kr } from "@/data/mockData";
import type { AnalysisResult, Grade, PageRef, Severity, Status } from "@/types/analysis";

export const STATUS_LABEL: Record<Status, string> = {
  god: "God",
  acceptabel: "Acceptabel",
  svag: "Svag",
  kritisk: "Kritisk",
  okant: "Okänt",
};

/** Label of every red flag in the PDF; the severity only picks the colour. */
export const FLAGGA_ETIKETT = "Att hålla koll på";

const LAGE_TEXT = { under: "under spannet", inom: "inom spannet", over: "över spannet" } as const;

function sida(ref: PageRef | undefined): string | undefined {
  return ref ? `s. ${ref.page}` : undefined;
}

// Several fields are typed `T | undefined` rather than `T?`: exactOptionalPropertyTypes
// forbids assigning an explicit `undefined` to a `?:` field, and several source values
// (e.g. a Figure's optional `ref`) are genuinely absent.

// --------------------------------------------------------------------------- huvud + kort

export interface PdfHuvud {
  eyebrow: string;
  titel: string;
  meta: string;
  /** "Avviker …" line under the meta line (byggår vs årsredovisningen). */
  byggarRad: string | undefined;
}

export interface PdfKort {
  forening: { betyg: Grade; titel: string; text: string };
  varde: { stort: string; rad: string | undefined; text: string };
  avgift: { stort: string; rad: string | undefined; text: string };
}

function buildHuvud(analys: AnalysisResult): PdfHuvud {
  const { input } = analys;
  const byggar = byggarMarkor(
    analys.uppgiftsjamforelse?.find((r) => r.falt === "byggar"),
    input.byggar,
  );
  const adressKvar = input.adress !== "";
  const byggarDel =
    byggar.varde === "Okänt"
      ? undefined
      : byggar.markor?.text === "Värdeår enligt årsredovisningen"
        ? `värdeår ${byggar.varde} enligt årsredovisningen`
        : byggar.markor?.text === "Från årsredovisningen"
          ? `byggår ${byggar.varde} enligt årsredovisningen`
          : `byggår ${byggar.varde}`;
  const delar = [
    adressKvar ? analys.forening.namn : undefined,
    rapportOmrade(analys.prisanalys.varderingsunderlag),
    `${input.antalRum} rum`,
    formatBoareaKort(input.boarea),
    input.vaning !== undefined ? `våning ${input.vaning}` : undefined,
    `avgift ${kr(input.manadsavgift)}/mån`,
    input.utgangspris !== undefined ? `utgångspris ${kr(input.utgangspris)}` : undefined,
    byggarDel,
    adressKvar ? undefined : "Adressen raderad efter 12 månader",
  ].filter((d): d is string => d !== undefined);
  return {
    eyebrow: `Rapport · analyserad ${formatSkapadDatum(analys.skapad)}`,
    titel: adressKvar ? input.adress : analys.forening.namn,
    meta: delar.join(" · "),
    byggarRad: byggar.rad
      ? `${byggar.markor ? `${byggar.markor.text}: ` : ""}${byggar.rad}`
      : undefined,
  };
}

function buildKort(analys: AnalysisResult): PdfKort {
  const p = analys.prisanalys;
  const visat = visatVarde(p);
  const utgangspris = p.utgangspris?.value ?? null;
  const bud = vanligtBud(utgangspris, p.budpremie);
  const lage = visat && utgangspris !== null ? lageMotVardespann(utgangspris, visat.exakt) : null;
  const prisText = !visat
    ? "Postnumret saknas eller är ogiltigt, så lägenheten kan inte värderas."
    : lage === null || utgangspris === null
      ? "Du angav inget utgångspris, så vi jämför inte priset mot spannet."
      : `Utgångspriset ${formatMkr(utgangspris, 2)} ligger ${LAGE_TEXT[lage]}.${
          bud !== null ? ` Ett vanligt bud i området landar runt ${formatMkr(bud, 2)}.` : ""
        }`;
  const avgift = avgiftKort(analys.avgiftsprognos, analys.rantestress.nuvarandeManadsavgift.value);
  return {
    forening: {
      betyg: analys.betyg,
      titel: BETYG_TITEL[analys.betyg],
      text: forstaMening(analys.betygMotivering),
    },
    varde: {
      stort: visat ? `ca ${formatMkr(avrundaVardering(visat.exakt))}` : "Ingen värdering",
      rad: visat ? `Spann ${formatSpannMkr(visat.exakt)}` : undefined,
      text: prisText,
    },
    avgift: { stort: avgift.varde, rad: avgift.rad ?? undefined, text: avgift.text },
  };
}

// --------------------------------------------------------------------------- 1 Föreningen

export interface PdfFlagga {
  id: string;
  titel: string;
  beskrivning: string;
  /** Colour only: hög risk is red, the rest amber. */
  ton: "danger" | "warning";
  pageRef: string | undefined;
}

export interface PdfNyckeltal {
  id: string;
  label: string;
  forklaring: string;
  varde: string;
  osaker: string | undefined;
  /** "God" … or "Ingen bedömning" for the unrated seventh. */
  bedomning: string;
  bedomningTon: Ton;
  jamforelse: string;
  pageRef: string | undefined;
  isSchablon: boolean;
}

export interface PdfMerUr {
  handelser: Array<{ text: string; pageRef: string | undefined }>;
  ingar: string | undefined;
  fakta: string | undefined;
  skal: string[];
}

export interface PdfForening {
  rubrik: string;
  lead: string;
  flaggor: PdfFlagga[];
  skannadNotis: string | undefined;
  nyckeltal: PdfNyckeltal[];
  merUr: PdfMerUr | undefined;
}

const SEVERITY_RANK: Record<Severity, number> = { hog: 0, medel: 1, lag: 2 };

/** All red flags, most severe first (same ranking as toppRodaFlaggor, none dropped). */
function allaFlaggor(flaggor: AnalysisResult["rodaFlaggor"]): PdfFlagga[] {
  return flaggor
    .map((flagga, index) => ({ flagga, index }))
    .sort((a, b) => {
      const diff = SEVERITY_RANK[a.flagga.severity] - SEVERITY_RANK[b.flagga.severity];
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ flagga }) => ({
      id: flagga.id,
      titel: flagga.titel,
      beskrivning: flagga.beskrivning,
      ton: flagga.severity === "hog" ? ("danger" as const) : ("warning" as const),
      pageRef: sida(flagga.ref),
    }));
}

const STATUS_TON: Record<Status, Ton> = {
  god: "success",
  acceptabel: "success",
  svag: "warning",
  kritisk: "danger",
  okant: "neutral",
};

function buildForening(analys: AnalysisResult): PdfForening {
  const flaggor = allaFlaggor(analys.rodaFlaggor);
  const sparbehovMal = analys.avgiftsprognos?.sparbehov?.malKrPerM2;
  const nyckeltal = sorteraNyckeltal(analys.forening.keyFigures.filter(visasNyckeltal)).map(
    (kf): PdfNyckeltal => {
      const ograderat = arOgraderatNyckeltal(kf);
      return {
        id: kf.id,
        label: kf.label,
        forklaring: kf.forklaring,
        varde: formatFigureVarde(kf.figure),
        osaker: kf.figure.osaker,
        bedomning: ograderat ? "Ingen bedömning" : STATUS_LABEL[kf.status],
        bedomningTon: ograderat ? "neutral" : STATUS_TON[kf.status],
        jamforelse: nyckeltalJamforelse(kf, sparbehovMal),
        pageRef: sida(kf.figure.ref),
        isSchablon: kf.figure.source === "schablon",
      };
    },
  );

  const f = analys.forening;
  const handelser = (f.vasentligaHandelser ?? []).map((h) => ({
    text: h.text,
    pageRef: sida(h.ref),
  }));
  const ingar = avgiftIngarText(f);
  const fakta = foreningFaktaText(f);
  const skal = analys.datakvalitet.extraktionKonfidens.skal ?? [];
  const merUr =
    handelser.length === 0 && !ingar && !fakta && skal.length === 0
      ? undefined
      : { handelser, ingar, fakta, skal };

  return {
    rubrik: foreningenRubrik(analys.betyg, flaggor.length),
    lead: analys.betygMotivering,
    flaggor,
    skannadNotis: arSkannad(analys) ? SKANNAD_NOTIS : undefined,
    nyckeltal,
    merUr,
  };
}

// --------------------------------------------------------------------------- 2 Priset

export interface PdfRad {
  label: string;
  note: string | undefined;
  varde: string;
  undertext: string | undefined;
  total: boolean;
}

export interface PdfSpannMarkor {
  label: string;
  varde: number;
  text: string;
  ton: "utgangspris" | "bud" | "vardering" | "liknande";
}

export interface PdfPriset {
  rubrik: string;
  lead: string;
  /** Coverage note: 'utanfor_lan' (a warning) or 'lan' (a notice), rendered first. */
  tackning: { typ: "utanfor_lan" | "lan"; titel: string; text: string } | undefined;
  /** Null without a valuation (invalid postnummer). */
  spann: { lag: number; hog: number; markorer: PdfSpannMarkor[]; underrubrik: string } | null;
  /** "Priset i annonsen"; undefined without an asking price. */
  annons: PdfRad[] | undefined;
  /** "Binfos värdering"; empty without a valuation. */
  vardering: PdfRad[];
  harVardering: boolean;
  /** The valuation is an estimate (model schablon), shown as a tag. */
  uppskattning: boolean;
  leverantor: string | undefined;
  byggarNotis: string | undefined;
  skuld: { text: string; pageRef: string | undefined; osaker: string | undefined } | undefined;
  lagTillforlitlighet: string | undefined;
  /** "Så har vi räknat", always open in the PDF. */
  rakning: PdfPrisRakning | undefined;
}

export interface PdfPrisRakning {
  modell:
    | {
        intro: string;
        faktorer: string[];
        kalla: string;
        spannText: string | undefined;
        metadata: string;
        omradeText: string;
        metodText: string | undefined;
      }
    | undefined;
}

function spannKvm(spann: { low: number; high: number } | null, boarea: number): string | undefined {
  if (!spann || !(boarea > 0)) return undefined;
  const per = (v: number) => (Math.round(v / boarea / 100) * 100).toLocaleString("sv-SE");
  return `${per(spann.low)} – ${per(spann.high)} kr/m²`;
}

function buildPriset(analys: AnalysisResult): PdfPriset {
  const p = analys.prisanalys;
  const input = analys.input;
  const u = p.varderingsunderlag;
  const prognos = analys.avgiftsprognos;
  const tackningTxt = u ? varderingsTackningText(u) : null;
  const visat = visatVarde(p);
  const utgangspris = p.utgangspris?.value ?? null;
  const bud = vanligtBud(utgangspris, p.budpremie);
  const lage = visat && utgangspris !== null ? lageMotVardespann(utgangspris, visat.exakt) : null;
  const budLage = visat && bud !== null ? lageMotVardespann(bud, visat.exakt) : null;
  const bas = p.externVardering?.value ?? null;
  const harJusterat = visat?.kalla === "justerad" && bas !== null;
  const liknandeSkiljer =
    harJusterat && bas !== null && avrundaVardering(bas) !== avrundaVardering(visat.exakt);
  const omrade = rapportOmrade(u) ?? u?.prisniva?.region;
  const spann = visat ? vardespann(visat.exakt) : null;
  const byggarJamforelse = analys.uppgiftsjamforelse?.find((r) => r.falt === "byggar");
  const byggarNotis = byggarPrisNotis(byggarJamforelse);
  const skuld = andelAvSkuldRad(analys);

  const lead = visat
    ? `Spannet är Binfos värdering ± ${VARDESPANN_PROCENT} %, alltså ${formatSpannMkr(visat.exakt)}.${
        budLage ? ` Ett vanligt bud för området hamnar ${LAGE_TEXT[budLage]}.` : ""
      }${utgangspris === null && p.budpremie ? ` ${formatBudpremieText(p.budpremie)}` : ""}`
    : "Utan ett giltigt postnummer kan Binfo inte värdera lägenheten.";

  // Component effects on the price, rounded to 1 000 kr so they sum to the total.
  const justering = p.justeringar?.find((x) => x.id === "forvantad_avgiftshojning");
  const ekonomi = (() => {
    if (!prognos || !justering || justering.belopp.value === null) return null;
    const { bidrag } = komponentPris(p, prognos);
    const { effekter, total } = avrundaKomponentEffekter(bidrag, justering.belopp.value);
    const delar = prognos.komponenter
      .filter((k) => effekter[k.id] !== undefined && effekter[k.id] !== 0)
      .map((k) => `${KOMPONENT_KORTNAMN[k.id]} ${formatSigneratKr(effekter[k.id] ?? 0)}`);
    return { text: medVersal(delar.join(" · ")), total: formatSigneratKr(total) };
  })();

  const kvmRad = (v: number | null | undefined) => kvmPrisForVardering(v, input.boarea);
  const budpremieOmrade = p.budpremie ? (p.budpremie.omrade ?? "Stockholm") : null;
  const procentSigned = p.budpremie
    ? Math.abs(p.budpremie.medianProcent).toLocaleString("sv-SE", { maximumFractionDigits: 1 })
    : "";

  const annons: PdfRad[] | undefined =
    utgangspris !== null
      ? [
          {
            label: "Utgångspris",
            note: undefined,
            varde: kr(utgangspris),
            undertext: kvmPris(utgangspris, input.boarea) ?? undefined,
            total: false,
          },
          ...(bud !== null && p.budpremie
            ? [
                {
                  label: "Vanlig budnivå i området",
                  note: `Utgångspriset ${p.budpremie.medianProcent < 0 ? "minus" : "plus"} ${procentSigned} %, vad bostäder ${iEllerPaOmrade(p.budpremie.omrade)} brukar gå för ${p.budpremie.medianProcent < 0 ? "under" : "över"} utgångspris`,
                  varde: `ca ${kr(bud)}`,
                  undertext: kvmPris(bud, input.boarea) ?? undefined,
                  total: false,
                },
              ]
            : []),
        ]
      : undefined;

  const vardering: PdfRad[] = visat
    ? [
        ...(bas !== null
          ? [
              {
                label: `Vad liknande lägenheter säljs för${omrade ? ` (${omrade}${input.postnummer ? `, ${input.postnummer.replace(/ /g, " ")}` : ""})` : ""}`,
                note: u
                  ? `Binfos värderingsmodell, tränad på bostadsrättsförsäljningar i Stockholm ${formatDataperiodLang(u.dataperiod)} med data från Svensk Mäklarstatistik.`
                  : undefined,
                varde: `ca ${formatVardeAvrundat(bas)}`,
                undertext: kvmRad(bas),
                total: false,
              },
            ]
          : []),
        ...(harJusterat && ekonomi
          ? [
              {
                label: "Föreningens ekonomi",
                note: ekonomi.text,
                varde: ekonomi.total,
                undertext: undefined,
                total: false,
              },
            ]
          : []),
        {
          label: "Binfos värdering",
          note: harJusterat
            ? "Med föreningens ekonomi inräknad"
            : "Utan justering för föreningens ekonomi",
          varde: `ca ${formatVardeAvrundat(visat.exakt)}`,
          undertext: kvmRad(visat.exakt),
          total: true,
        },
        {
          label: `Rimligt prisspann — Binfos värdering ± ${VARDESPANN_PROCENT} %`,
          note: undefined,
          varde: formatVardespann(visat.exakt),
          undertext: spannKvm(spann, input.boarea),
          total: false,
        },
      ]
    : [];

  const markorer: PdfSpannMarkor[] = visat
    ? [
        ...(utgangspris !== null
          ? [
              {
                label: "Utgångspris",
                varde: utgangspris,
                text: formatMkr(utgangspris, 2),
                ton: "utgangspris" as const,
              },
            ]
          : []),
        ...(bud !== null
          ? [{ label: "Vanligt bud", varde: bud, text: formatMkr(bud, 2), ton: "bud" as const }]
          : []),
        {
          label: "Binfos värdering",
          varde: avrundaVardering(visat.exakt),
          text: formatMkr(avrundaVardering(visat.exakt), 2),
          ton: "vardering" as const,
        },
        ...(liknandeSkiljer && bas !== null
          ? [
              {
                label: "Liknande lägenheter",
                varde: avrundaVardering(bas),
                text: formatMkr(avrundaVardering(bas), 2),
                ton: "liknande" as const,
              },
            ]
          : []),
      ]
    : [];

  const modell =
    u && visat
      ? {
          intro: `Binfos värderingsmodell (version ${modellVersionText(u.modellVersion)}) bygger på tidigare försäljningar av bostadsrätter. ${MODELL_FAKTORER_INTRO}`,
          faktorer: RAKNA_FAKTORER,
          kalla: varderingsKallaText(u.dataperiod),
          spannText: `Spannet ${formatSpannMkr(visat.exakt)} är Binfos värdering ± ${VARDESPANN_PROCENT} %. Det visar hur långt från värderingen ett pris kan ligga och ändå vara rimligt, och är inget statistiskt konfidensintervall.`,
          metadata: `${u.antalForsaljningar.toLocaleString("sv-SE")} försäljningar · typiskt fel ±${u.typisktFelProcent.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} % · modell ${u.modellVersion}`,
          omradeText: `Område: ${omrade ?? "Stockholm (postnumret saknas i vår områdesindelning)"}`,
          metodText: tackningTxt?.typ === "lan" ? tackningTxt.text : undefined,
        }
      : undefined;

  return {
    rubrik: prisRubrik(lage),
    lead,
    tackning: tackningTxt
      ? {
          typ: tackningTxt.typ,
          titel:
            tackningTxt.typ === "utanfor_lan"
              ? (tackningTxt.titel ?? "Utanför täckningsområdet")
              : "Värdering utanför Stockholms kommun",
          text: tackningTxt.text,
        }
      : undefined,
    spann:
      visat && spann
        ? {
            lag: spann.low,
            hog: spann.high,
            markorer,
            underrubrik: `Binfos värdering ± ${VARDESPANN_PROCENT} %${utgangspris !== null ? ", och var utgångspriset" : ""}${bud !== null ? " och ett vanligt bud hamnar" : utgangspris !== null ? " hamnar" : ""}`,
          }
        : null,
    annons,
    vardering,
    harVardering: visat !== null,
    uppskattning: p.externVardering?.source === "schablon",
    leverantor: p.externVardering?.leverantor,
    byggarNotis: byggarNotis
      ? byggarNotis.sida
        ? `${byggarNotis.text.replace(/\.$/, "")} (${byggarNotis.sida}).`
        : byggarNotis.text
      : undefined,
    skuld: skuld ? { text: skuld.text, pageRef: sida(skuld.ref), osaker: skuld.osaker } : undefined,
    lagTillforlitlighet:
      p.konfidens.niva === "lag" && p.konfidens.skal && p.konfidens.skal.length > 0
        ? `Låg tillförlitlighet: ${p.konfidens.skal.join(" ")}`
        : undefined,
    rakning: modell ? { modell } : undefined,
  };
}

// --------------------------------------------------------------------------- 3 Avgiften framåt

export interface PdfRantaBox {
  vanster: { etikett: string; varde: string; under: string; tryck: string | undefined };
  hoger:
    | { etikett: string; varde: string; under: string; saknas: undefined }
    | { etikett: string; saknas: string };
}

export interface PdfPrognosTabell {
  rader: Array<{ label: string; manadsavgift: string; forandring: string }>;
  kommentar: string;
}

export interface PdfRantestressRad {
  okningPe: 0 | 1 | 2 | 3;
  nyManadsavgift: string;
  avgiftsokning: string;
  totalManadskostnad?: string;
}

export interface PdfRantestress {
  nuvarandeManadsavgift: string;
  /** Empty when rantekanslighetProcent is null. */
  rader: PdfRantestressRad[];
  kommentar: string;
  ejBeraknbar: boolean;
  /** New reports: today / expected / +1 / +2 pp table (replaces the scenario table). */
  prognosTabell: PdfPrognosTabell | undefined;
  /** "Dagens avgift" vs "Med högre ränta" (+1 p.e.), once per base (today, expected). */
  boxar: PdfRantaBox[];
}

export interface PdfDrivare {
  label: string;
  forklaring: string;
  pageRef: string | undefined;
  varde: string;
  ton: Ton;
  dimmad: boolean;
}

export interface PdfByggdel {
  label: string;
  senast: string;
  pageRef: string | undefined;
  /** A life-extending renovation, with its page (owner 2026-10-30). */
  forlangning: string | undefined;
  livslangd: string;
  lage: string;
  lageTon: "success" | "warning" | "neutral";
}

export interface PdfLan {
  forfaller: string;
  belopp: string;
  ranta: string;
  lage: string;
  lageTon: "success" | "warning" | "info" | "neutral";
}

export interface PdfAvgiften {
  rubrik: string;
  lead: string;
  tryck: { etikett: string; ton: Ton } | undefined;
  osaker: string | undefined;
  rantestress: PdfRantestress;
  drivare:
    | {
        rader: PdfDrivare[];
        forvantad: string | undefined;
        energiText: string;
      }
    | undefined;
  spar:
    | {
        rubrik: string;
        tryck: { etikett: string; ton: Ton } | undefined;
        byggdelar: PdfByggdel[];
        byggdelKalla: string | undefined;
        princip: string | undefined;
        rader: Array<{ label: string; note: string; varde: string; total: boolean }>;
      }
    | undefined;
  lan:
    | {
        rader: PdfLan[];
        kalla: string | undefined;
        fastrad: string | undefined;
        refinansiering: Array<{ label: string; value: string }>;
        antagenAndel: string | undefined;
        forandring: PdfRad[];
        pageRef: string | undefined;
      }
    | undefined;
}

function tryckInfo(
  tryck: NonNullable<AnalysisResult["avgiftsprognos"]>["tryck"] | undefined,
): { etikett: string; ton: Ton } | undefined {
  return tryck ? { etikett: TRYCK_ETIKETT[tryck], ton: tonForTryck(tryck) } : undefined;
}

/** Every scenario, not just the one a screen-only slider currently shows. */
function buildRantestress(analys: AnalysisResult): PdfRantestress {
  const r = analys.rantestress;
  const baser: Array<"idag" | "forvantad"> =
    analys.avgiftsprognos && typeof analys.avgiftsprognos.totalKrPerManad === "number"
      ? ["idag", "forvantad"]
      : ["idag"];
  return {
    nuvarandeManadsavgift: formatFigureVarde(r.nuvarandeManadsavgift),
    rader: [...r.scenarier]
      .sort((a, b) => a.okningPe - b.okningPe)
      .map((s) => ({
        okningPe: s.okningPe,
        nyManadsavgift: formatFigureVarde(s.nyManadsavgift),
        avgiftsokning: formatFigureVarde(s.avgiftsokningKrPerManad),
        ...(s.totalManadskostnad
          ? { totalManadskostnad: formatFigureVarde(s.totalManadskostnad) }
          : {}),
      })),
    kommentar: r.kommentar,
    ejBeraknbar: r.rantekanslighetProcent === null,
    prognosTabell: r.prognosTabell
      ? {
          rader: r.prognosTabell.rader.map((rad) => ({
            label: rad.label,
            manadsavgift: Math.round(rad.manadsavgift).toLocaleString("sv-SE"),
            forandring: rad.id === "idag" ? "–" : formatForandringKr(rad.forandringKr),
          })),
          kommentar: r.prognosTabell.kommentar,
        }
      : undefined,
    boxar: baser.map((flik) => {
      const vy = rantestressVy(analys, flik, 1);
      return {
        vanster: {
          etikett: vy.vanster.etikett,
          varde: vy.vanster.varde,
          under: vy.vanster.under,
          tryck: vy.vanster.tryck ? TRYCK_ETIKETT[vy.vanster.tryck] : undefined,
        },
        hoger:
          "saknas" in vy.hoger
            ? { etikett: "Med högre ränta", saknas: vy.hoger.saknas }
            : {
                etikett: "Med högre ränta",
                varde: vy.hoger.varde,
                under: vy.hoger.under,
                saknas: undefined,
              },
      };
    }),
  };
}

function buildAvgiften(analys: AnalysisResult): PdfAvgiften {
  const prognos = analys.avgiftsprognos;
  const base = {
    rubrik: avgiftRubrik(prognos),
    lead: avgiftLead(prognos),
    tryck: tryckInfo(prognos?.tryck),
    osaker: prognos?.osaker,
    rantestress: buildRantestress(analys),
  };
  if (!prognos) return { ...base, drivare: undefined, spar: undefined, lan: undefined };

  const dagens = analys.rantestress.nuvarandeManadsavgift.value;
  const total = prognos.totalKrPerManad;
  const tid = horisontText(prognos.horisontManader);
  const forvantad =
    dagens !== null && total !== null
      ? `Förväntad avgift om ${tid}: ca ${kr(Math.round(dagens + total))} (${formatForandringKr(total)})`
      : undefined;

  const sb = prognos.sparbehov;
  const sparrader = sparRader(prognos);
  const byggdelar = sb ? byggdelTabell(sb) : [];
  const spar = sparKomponent(prognos);
  const refi = prognos.refinansiering;
  const refiKomp = refiKomponent(prognos);
  const lan = refi ? lanTabell(refi, prognos.horisontManader) : [];
  const omsatta = (refi?.lan ?? []).filter((l) => l.fas === "forfallit").length;

  return {
    ...base,
    drivare: {
      rader: drivareRader(prognos).map((r) => ({
        label: r.label,
        forklaring: r.forklaring,
        pageRef: sida(r.ref),
        varde: r.varde,
        ton: r.ton,
        dimmad: r.dimmad,
      })),
      forvantad,
      energiText: ENERGI_TEXT,
    },
    spar: sparrader
      ? {
          rubrik: byggdelar.length > 0 ? "Husets byggdelar" : "Sparande mot underhållsbehov",
          tryck: tryckInfo(spar?.tryck),
          byggdelar: byggdelar.map((b) => ({
            label: b.label,
            senast: b.senast,
            pageRef: b.sida !== undefined ? `s. ${b.sida}` : undefined,
            forlangning: b.forlangning
              ? `${b.forlangning.text} (s. ${b.forlangning.sida})`
              : undefined,
            livslangd: b.livslangd,
            lage: b.lage.text,
            lageTon: b.lage.ton,
          })),
          byggdelKalla: byggdelar.length > 0 ? byggdelFotnot(byggdelar) : undefined,
          rader: sparrader.map((r) => ({
            label: r.label,
            note: r.note,
            varde: r.varde,
            total: r.total === true,
          })),
          princip: sparPrincipText(prognos),
        }
      : undefined,
    lan:
      refi || refiKomp
        ? {
            rader: lan.map((l) => ({
              forfaller: l.forfaller,
              belopp: l.belopp,
              ranta: l.ranta,
              lage: l.lage.text,
              lageTon: l.lage.ton,
            })),
            kalla: refi
              ? `${referensrantaRad(refi)}.${lanKallaText(refi) ? ` ${lanKallaText(refi)}` : ""}`
              : undefined,
            fastrad: lan.some((l) => l.lage.text.startsWith("År ")) ? REFI_FASTRAD : undefined,
            refinansiering: refi ? refinansieringRader(refi) : [],
            antagenAndel: refi ? antagenAndelText(refi) : undefined,
            forandring: refiKomp
              ? [
                  ...(refi && refiKomp.foreningKrPerAr !== null
                    ? [
                        {
                          label: "Förväntad förändring i föreningens årliga räntekostnader",
                          note: `Om lånen som förfaller inom ${tid} får ca ${formatProcentTal(refi.nyRantaProcent)}.${
                            omsatta > 0
                              ? ` ${omsatta === 1 ? "Ett lån är" : `${antalIOrd(omsatta)} lån är`} redan omsatt till okänd ränta.`
                              : ""
                          }`,
                          varde: `ca ${formatSigneratKr(refiKomp.foreningKrPerAr, "kr per år")}`,
                          undertext: undefined,
                          total: false,
                        },
                      ]
                    : []),
                  ...(refiKomp.krPerManad !== null
                    ? [
                        {
                          label: "Din andel",
                          note: `Det här är raden ”${refiKomp.label}” i den förväntade avgiften`,
                          varde: `ca ${formatSigneratKr(refiKomp.krPerManad, "kr/mån")}`,
                          undertext: undefined,
                          total: true,
                        },
                      ]
                    : []),
                ]
              : [],
            pageRef: refiKomp?.ref ? `Årsredovisning s. ${refiKomp.ref.page}` : undefined,
          }
        : undefined,
  };
}

// --------------------------------------------------------------------------- 4 Frågor, källor, slut

export interface PdfFraga {
  id: string;
  fraga: string;
  /** "Varför: …" text, shown under the question. */
  varfor: string;
  /** "Bra svar" + "Varningssignal", or one line (free text gets its label put in front). */
  svarssignal:
    { typ: "tva"; bra: string; varning: string } | { typ: "en"; text: string } | undefined;
}

export interface PdfFragor {
  rubrik: string;
  lead: string;
  fragor: PdfFraga[];
}

/** Same subset the web shows: questions derived from the analysis. Undefined when none. */
function buildFragor(analys: AnalysisResult): PdfFragor | undefined {
  const fragor = analys.fragor.filter((f) => f.ursprung === "analys");
  if (fragor.length === 0) return undefined;
  const medPrognos = analys.avgiftsprognos !== undefined;
  return {
    rubrik: `${medVersal(antalIOrd(fragor.length))} ${fragor.length === 1 ? "fråga" : "frågor"} till mäklaren och styrelsen`,
    lead: `Svaren avgör om betyget${medPrognos ? " och avgiftsprognosen" : ""} håller.`,
    fragor: fragor.map((f) => ({
      id: f.id,
      fraga: f.fraga,
      varfor: f.varfor,
      svarssignal: f.svarssignal?.trim() ? svarssignalDelar(f.svarssignal) : undefined,
    })),
  };
}

function buildKallor(analys: AnalysisResult): { intro: string; rader: string[] } {
  const u = analys.prisanalys.varderingsunderlag;
  const prognos = analys.avgiftsprognos;
  const refi = prognos?.refinansiering;
  const rader: string[] = [];
  if (u) rader.push(`Värdering: ${modellKallaRad(u)}`);
  if (u?.prisniva) {
    rader.push(
      `Prisnivå för ${u.prisniva.region}: ${u.prisniva.kalla}, ${u.prisniva.krPerM2.toLocaleString("sv-SE")} kr/m².`,
    );
  }
  if (prognos?.sparbehov?.byggdelar) rader.push(`Byggdelarnas livslängd: ${BYGGDEL_KALLOR}.`);
  if (refi) {
    rader.push(
      `Antagen ny ränta för föreningens lån: ${refi.referensranta.namn} ${formatSkapadDatum(refi.referensranta.datum)} plus föreningens marginal.`,
    );
  }
  if (u) rader.push(`Områdesindelning: ${OMRADES_KALLA_RAD}`);
  return {
    intro: `Uppgifterna om föreningen kommer från årsredovisningen för ${analys.forening.rakenskapsar}, med sidhänvisning vid varje siffra. Hur vi har räknat förklaras under respektive avsnitt ovan.`,
    rader,
  };
}

// --------------------------------------------------------------------------- whole model

export interface PdfViewModel {
  foreningNamn: string;
  skapadLabel: string;
  huvud: PdfHuvud;
  kort: PdfKort;
  foreningen: PdfForening;
  priset: PdfPriset;
  avgiften: PdfAvgiften;
  fragor: PdfFragor | undefined;
  kallor: { intro: string; rader: string[] };
  friskrivning: string;
  /** The contact address for "Hittar du ett fel?", or null when none is set. */
  kontakt: string | null;
}

export function buildPdfViewModel(analys: AnalysisResult): PdfViewModel {
  return {
    foreningNamn: analys.forening.namn,
    skapadLabel: formatSkapadDatum(analys.skapad),
    huvud: buildHuvud(analys),
    kort: buildKort(analys),
    foreningen: buildForening(analys),
    priset: buildPriset(analys),
    avgiften: buildAvgiften(analys),
    fragor: buildFragor(analys),
    kallor: buildKallor(analys),
    friskrivning: `Rapporten är beslutsstöd, inte råd. Siffrorna kommer från föreningens årsredovisning för ${analys.forening.rakenskapsar} och kan innehålla tolkningsfel.`,
    kontakt: KONTAKT_EPOST,
  };
}
