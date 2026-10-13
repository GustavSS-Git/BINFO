import { KALKYL_UNDERLAG_VERSION, type KalkylUnderlag } from "@/lib/kalkyl/underlag";

/** Ett fullständigt exempelunderlag för PDF-testerna. */
export const EXEMPEL: KalkylUnderlag = {
  version: KALKYL_UNDERLAG_VERSION,
  lanebelopp: 3_500_000,
  kontantinsats: 700_000,
  rantaProcent: 3.6,
  manadsavgift: 4_300,
  boarea: 58,
  avgiftInkluderar: { varme: "ja", vatten: "okant", el: "nej", bredband: "nej", tv: "okant" },
  antalLantagare: 2,
  inkomst1: 520_000,
  inkomst2: 380_000,
  antalPersoner: 3,
  antalVuxna: 2,
  barn: ["4-6"],
  rantestressPp: 1,
  rantekanslighetProcent: 1.5,
  kalkylrantaProcent: 7,
  egnaKostnader: { hushallsel: 600 },
};
