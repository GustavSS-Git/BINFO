/**
 * LOCAL-ONLY dev seed for the public BRF register (docs/PLAN-v3.md §2).
 *
 * Inserts a handful of done `rapport` rows (+ `forening`, the BRF's cited
 * address, area, slug and `register_sammanfattning`) into a LOCAL Supabase
 * stack so `/brf`, `/brf/omrade/<omrade>` and `/brf/<slug>` have content to
 * render. The first entry is the real Brf Pontonjären 3 sample
 * (src/data/sampleAnalysis.ts); the rest are SYNTHETIC variants whose names
 * all end in "(lokal testdata)" and whose orgnr are generated (valid Luhn,
 * "999xxx-xxxx" range) - they must never reach any shared database.
 *
 * It refuses to run unless PROJECT_URL points at 127.0.0.1 / localhost.
 *
 *   eval "$(npx supabase@2.117.0 status -o env | grep -E '^(API_URL|SECRET_KEY|PUBLISHABLE_KEY)=')"
 *   PROJECT_URL="$API_URL" PROJECT_SECRET_KEY="$SECRET_KEY" PROJECT_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" \
 *   MAX_DAILY_SPEND_SEK=1 ANTHROPIC_API_KEY=dummy ANALYSIS_KILL_SWITCH=on \
 *   node --import tsx scripts/seedLokaltRegister.ts
 *
 * Idempotent: a re-run skips rows that already exist.
 */
import { sampleAnalysis } from "../src/data/sampleAnalysis";
import { envFromProcess } from "../src/server/env";
import { PIPELINE_VERSION, uppdateraRegisterForOrgnr } from "../src/server/register";
import { skapaLager } from "../src/server/supabase";
import type { ExtractionResult, Forening, Grade, KeyFigure } from "../src/types/analysis";

const LOKALA_VARDAR = new Set(["127.0.0.1", "localhost"]);

/** Luhn check digit for a 9-digit base -> a valid 10-digit number. */
function medLuhn(bas9: string): string {
  let summa = 0;
  for (let i = 0; i < 9; i++) {
    let siffra = Number(bas9[i]);
    if (i % 2 === 0) {
      siffra *= 2;
      if (siffra > 9) siffra -= 9;
    }
    summa += siffra;
  }
  return bas9 + String((10 - (summa % 10)) % 10);
}

function syntetisktOrgnr(lopnummer: number): string {
  const tio = medLuhn(`999${String(lopnummer).padStart(6, "0")}`);
  return `${tio.slice(0, 6)}-${tio.slice(6)}`;
}

interface Fro {
  orgnr: string;
  namn: string;
  rakenskapsar: number;
  postnummer: string;
  gata: string;
  ort: string;
  betyg: Grade;
  /** Multipliers on the sample's key figures (a cheap way to get different BRFs). */
  skala: { skuld: number; avgift: number; sparande: number };
  skannad?: boolean;
  syntetisk: boolean;
}

const FROEN: Fro[] = [
  {
    // The real sample report. The address is the sample listing's postnummer
    // (112 42, Kungsholmen) used only to place the BRF in an area locally.
    orgnr: sampleAnalysis.forening.orgnr,
    namn: sampleAnalysis.forening.namn,
    rakenskapsar: sampleAnalysis.forening.rakenskapsar,
    postnummer: "112 42",
    gata: "Baltzar von Platens gata (lokal testadress)",
    ort: "Stockholm",
    betyg: sampleAnalysis.betyg,
    skala: { skuld: 1, avgift: 1, sparande: 1 },
    syntetisk: false,
  },
  {
    orgnr: sampleAnalysis.forening.orgnr,
    namn: sampleAnalysis.forening.namn,
    rakenskapsar: sampleAnalysis.forening.rakenskapsar - 1,
    postnummer: "112 42",
    gata: "Baltzar von Platens gata (lokal testadress)",
    ort: "Stockholm",
    betyg: "C",
    skala: { skuld: 1.12, avgift: 0.94, sparande: 0.7 },
    syntetisk: false,
  },
  {
    orgnr: syntetisktOrgnr(1),
    namn: "Brf Södra Testet (lokal testdata)",
    rakenskapsar: 2025,
    postnummer: "118 57",
    gata: "Testgatan 1",
    ort: "Stockholm",
    betyg: "B",
    skala: { skuld: 0.4, avgift: 0.9, sparande: 1.6 },
    syntetisk: true,
  },
  {
    orgnr: syntetisktOrgnr(2),
    namn: "Brf Östermalmsprovet (lokal testdata)",
    rakenskapsar: 2025,
    postnummer: "114 31",
    gata: "Provgatan 5",
    ort: "Stockholm",
    betyg: "D",
    skala: { skuld: 2.1, avgift: 1.3, sparande: 0.2 },
    syntetisk: true,
  },
  {
    orgnr: syntetisktOrgnr(3),
    namn: "Brf Vasatestet (lokal testdata)",
    rakenskapsar: 2024,
    postnummer: "113 30",
    gata: "Vasagatan 99",
    ort: "Stockholm",
    betyg: "A",
    skala: { skuld: 0.1, avgift: 0.8, sparande: 2.2 },
    syntetisk: true,
  },
  {
    orgnr: syntetisktOrgnr(4),
    namn: "Brf Skannade Provet (lokal testdata)",
    rakenskapsar: 2025,
    postnummer: "168 55",
    gata: "Skanningsvägen 2",
    ort: "Bromma",
    betyg: "C",
    skala: { skuld: 1.5, avgift: 1.1, sparande: 0.9 },
    skannad: true,
    syntetisk: true,
  },
  {
    orgnr: syntetisktOrgnr(5),
    namn: "Brf Kungsholmsprovet (lokal testdata)",
    rakenskapsar: 2025,
    postnummer: "112 20",
    gata: "Provbacken 3",
    ort: "Stockholm",
    betyg: "E",
    skala: { skuld: 3, avgift: 1.5, sparande: 0 },
    syntetisk: true,
  },
];

function skalad(kf: KeyFigure, s: Fro["skala"]): KeyFigure {
  const faktor =
    kf.id === "skuldsattning_per_m2_brf_yta" || kf.id === "skuldsattning_per_m2_totalyta"
      ? s.skuld
      : kf.id === "arsavgift_per_m2_brf_yta"
        ? s.avgift
        : kf.id === "sparande_per_m2_totalyta"
          ? s.sparande
          : 1;
  if (faktor === 1 || kf.figure.value === null) return kf;
  return { ...kf, figure: { ...kf.figure, value: Math.round(kf.figure.value * faktor) } };
}

function byggExtraktion(f: Fro): ExtractionResult {
  const original = sampleAnalysis.forening;
  const forening: Forening = {
    ...original,
    namn: f.namn,
    orgnr: f.orgnr,
    rakenskapsar: f.rakenskapsar,
    keyFigures: original.keyFigures.map((kf) => skalad(kf, f.skala)),
    adresser: [
      {
        gatuadress: f.gata,
        postnummer: f.postnummer,
        ort: f.ort,
        ref: { page: 3, excerpt: f.gata },
      },
    ],
  };
  return {
    schemaVersion: "1.0.0",
    forening,
    datakvalitet: {
      pdfSaknarTextlager: f.skannad === true,
      extraktionKonfidens: sampleAnalysis.datakvalitet.extraktionKonfidens,
      saknadeFalt: [],
      ...(f.skannad ? { kalla: "skannad" as const } : {}),
    },
  };
}

function byggBedomning(f: Fro) {
  return {
    betyg: f.betyg,
    betygMotivering: f.syntetisk
      ? "Syntetisk lokal testdata: betyget är påhittat och bygger inte på någon årsredovisning."
      : sampleAnalysis.betygMotivering,
    rodaFlaggor: sampleAnalysis.rodaFlaggor,
    fragor: sampleAnalysis.fragor.filter((q) => q.ursprung === "analys"),
  };
}

async function main() {
  const env = envFromProcess();
  const host = new URL(env.supabaseUrl).hostname;
  if (!LOKALA_VARDAR.has(host)) {
    console.error(
      `Vägrar köra: PROJECT_URL pekar på "${host}", inte en lokal Supabase (127.0.0.1/localhost). ` +
        "Det här seedet skriver testdata och får aldrig köras mot en delad databas.",
    );
    process.exitCode = 1;
    return;
  }

  const { db } = skapaLager(env);
  const orgnrKlara = new Set<string>();
  for (const f of FROEN) {
    await db.registreraForening(f.orgnr, f.namn);
    const skapad = await db.skapaRapport({
      orgnr: f.orgnr,
      rakenskapsar: f.rakenskapsar,
      pipelineVersion: PIPELINE_VERSION,
      model: "lokal-seed",
      textlager: f.skannad ? "saknas" : "ok",
      status: "done",
      stage: "klar",
      pdfHash: `lokal-seed-${f.orgnr}-${f.rakenskapsar}`,
      extraction: byggExtraktion(f),
      judgement: byggBedomning(f),
      finishedAt: new Date().toISOString(),
    });
    console.error(
      `${skapad.ok ? "Skapade " : "Fanns redan"} ${f.namn} ${f.rakenskapsar} (${f.orgnr})`,
    );
    orgnrKlara.add(f.orgnr);
  }
  for (const orgnr of orgnrKlara) await uppdateraRegisterForOrgnr(db, orgnr);
  console.error(`Klart: ${orgnrKlara.size} föreningar i ${new URL(env.supabaseUrl).host}.`);
}

main().catch((fel) => {
  console.error(fel);
  process.exitCode = 1;
});
