/**
 * Report data vs the buyer's input, per field (round 2026-10-24b). Pure.
 *
 * Per-field confidence is DERIVED, not asked of the model:
 *  - 'hog'   = source 'arsredovisning' + a cited excerpt + no `osaker` mark +
 *              not a scan + extraction confidence not 'lag';
 *  - 'lag'   = the figure carries an `osaker` mark;
 *  - 'medel' = everything else (scan, computed value, low extraction confidence).
 *
 * Byggår is the only field the buyer also types, so it is the only one with
 * a status other than 'endast_rapport'. Owner decision 2026-10-26: when the
 * buyer gave a year it is ALWAYS the one used (`anvant`), whatever the report
 * says or its confidence. Within ±1 year the status is 'manuellt'; a larger
 * difference is 'avviker' (noted, the buyer's year still used, no range
 * widening: `byggarAlternativ` is never set). 'bekraftat' and 'osakert' stay in
 * the type but are never produced. With no buyer year the report's year is
 * used ('endast_rapport'), unless its confidence is 'lag'.
 */
import type {
  ExtractionResult,
  Faltjamforelse,
  Figure,
  Forening,
  JamforelseFalt,
  PropertyInput,
} from "@/types/analysis";

type Sakerhet = "hog" | "medel" | "lag";

export function faltSakerhet(f: Figure, datakvalitet: ExtractionResult["datakvalitet"]): Sakerhet {
  if (f.osaker) return "lag";
  if (
    f.source === "arsredovisning" &&
    f.ref?.excerpt &&
    datakvalitet.kalla !== "skannad" &&
    datakvalitet.extraktionKonfidens.niva !== "lag"
  ) {
    return "hog";
  }
  return "medel";
}

function tal(n: number, decimaler = 0): string {
  return n.toLocaleString("sv-SE", {
    minimumFractionDigits: decimaler,
    maximumFractionDigits: decimaler,
  });
}

function medRef(f: Figure | undefined): Pick<Faltjamforelse, "ref"> | Record<string, never> {
  return f?.ref ? { ref: f.ref } : {};
}

export function jamforUppgifter(args: {
  input: PropertyInput;
  forening: Forening;
  datakvalitet: ExtractionResult["datakvalitet"];
}): {
  rader: Faltjamforelse[];
  byggarForVardering: number | undefined;
  byggarAlternativ?: number;
} {
  const { input, forening, datakvalitet } = args;
  const rader: Faltjamforelse[] = [];
  let byggarForVardering: number | undefined;

  // --- byggår ---
  const anv = input.byggar;
  const rapportFigur = forening.byggar;
  const rap = rapportFigur?.value ?? null;
  const sak = rapportFigur && rap !== null ? faltSakerhet(rapportFigur, datakvalitet) : undefined;

  if (anv !== undefined && rap !== null) {
    // The buyer's year is ALWAYS the one used (owner 2026-10-26), whatever the
    // report says or how confident the reading is. A difference is only noted.
    if (Math.abs(anv - rap) <= 1) {
      rader.push({
        falt: "byggar",
        label: "Byggår",
        anvandare: anv,
        rapport: rap,
        status: "manuellt",
        anvant: anv,
        text:
          anv === rap
            ? `Du angav ${anv} och årsredovisningen anger samma år.`
            : `Du angav ${anv} och årsredovisningen anger ${rap}. Det är nästan samma år, vi använder ${anv}.`,
        ...medRef(rapportFigur),
      });
    } else {
      rader.push({
        falt: "byggar",
        label: "Byggår",
        anvandare: anv,
        rapport: rap,
        status: "avviker",
        anvant: anv,
        text:
          `Du angav ${anv}, årsredovisningen anger ${rap}. Vi använder ditt år, ${anv}. ` +
          "Byggår kan skilja sig åt, till exempel vid ombyggnad eller när föreningen har flera hus.",
        ...medRef(rapportFigur),
      });
    }
    byggarForVardering = anv;
  } else if (anv !== undefined) {
    rader.push({
      falt: "byggar",
      label: "Byggår",
      anvandare: anv,
      status: "manuellt",
      anvant: anv,
      text: `Finns inte i årsredovisningen, du angav ${anv}.`,
    });
    byggarForVardering = anv;
  } else if (rap !== null && sak !== undefined) {
    const anvandsEj = sak === "lag";
    rader.push({
      falt: "byggar",
      label: "Byggår",
      rapport: rap,
      status: "endast_rapport",
      anvant: anvandsEj ? null : rap,
      text: anvandsEj
        ? `Årsredovisningen anger ${rap}, men uppgiften är osäker och vi använder den inte.`
        : `Enligt årsredovisningen: ${rap}.`,
      ...medRef(rapportFigur),
    });
    if (!anvandsEj) byggarForVardering = rap;
  }

  // --- förening-level fields the buyer never types ---
  const endast = (
    falt: JamforelseFalt,
    label: string,
    f: Figure | undefined,
    format: (n: number) => string,
  ): void => {
    const v = f?.value ?? null;
    if (f === undefined || v === null) return;
    rader.push({
      falt,
      label,
      rapport: v,
      status: "endast_rapport",
      anvant: v,
      text: `Enligt årsredovisningen: ${format(v)}.${f.osaker ? " Uppgiften är markerad som osäker." : ""}`,
      ...medRef(f),
    });
  };
  endast("antalLagenheter", "Antal lägenheter", forening.antalLagenheter, (n) => tal(n));
  endast("totalyta", "Total yta", forening.totalyta, (n) => `${tal(n, 1)} m²`);
  endast("bostadsrattsyta", "Bostadsrättsyta", forening.bostadsrattsyta, (n) => `${tal(n, 1)} m²`);
  endast("totalSkuld", "Föreningens skuld", forening.lanebok?.totalSkuld, (n) => `${tal(n)} kr`);

  // `byggarAlternativ` stays in the return type for the assembler's range widening
  // but is never set (the buyer's year always decides, owner 2026-10-26).
  return { rader, byggarForVardering };
}
