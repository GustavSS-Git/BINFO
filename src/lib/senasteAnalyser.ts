import { z } from "zod";

/**
 * Kom-ihåg-lista över senast skapade/besökta analyser, sparad enbart i den
 * här webbläsaren (localStorage) — ingen inloggning finns. Ersätter det att
 * "Analysera"-länken i navet alltid pekar på ett tomt formulär: efter att
 * man lämnat en analys och gått vidare (t.ex. till bolånekalkylen) finns
 * ändå en väg tillbaka via /analysera.
 *
 * GDPR-minimering: lagrar ENDAST analysisId, skapad-tidsstämpel och
 * föreningens namn — aldrig adress, postnummer, orgnr eller pris. Servern
 * äger allt annat; den här listan är bara en genväg till en id-länk.
 *
 * Expirerar 30 dagar efter skapad, samma retention som servern använder för
 * uppladdade PDF:er (se CLAUDE.md/SUPABASE.md).
 *
 * `AnalysHistorik` är ett medvetet snävt interface så att en framtida
 * konto-/serverbaserad historik kan ersätta `LocalStorageAnalysHistorik` utan
 * att anropsplatserna (analysera.tsx, förhandsvisning/analys-routerna)
 * behöver ändras.
 */

export interface SenasteAnalys {
  analysisId: string;
  /** ISO 8601 — analysens skapad-tidsstämpel, används för 30-dagars-gränsen. */
  skapad: string;
  foreningsnamn?: string;
}

export interface AnalysHistorik {
  /** Sparar eller uppdaterar en post. Ett `foreningsnamn` som utelämnas
   *  (t.ex. vid skapandet, innan namnet är känt) skriver INTE över ett
   *  redan sparat namn — bara ett explicit angivet namn gör det. */
  spara(entry: SenasteAnalys): void;
  /** Nyast först, max fem poster, utgångna poster (>30 dagar sedan `skapad`,
   *  räknat mot `now`) borttagna. */
  hamta(now?: Date): SenasteAnalys[];
  glom(analysisId: string): void;
}

/** Minimal delmängd av Web Storage-API:t — gör klassen testbar utan jsdom
 *  och gör att SSR (inget `window`) bara innebär att ingen storage hittas. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "binfo:senaste-analyser";
const MAX_POSTER = 5;
const TTL_DAGAR = 30;

const SenasteAnalysSchema = z.object({
  analysisId: z.string().min(1),
  skapad: z.string().min(1),
  foreningsnamn: z.string().min(1).optional(),
});

/** Läser och validerar lagrat innehåll. Otillförlitlig indata (trasig JSON,
 *  fel form, enskilda ogiltiga poster) ger aldrig ett kastat fel — högst en
 *  tom eller kortare lista. En enskild ogiltig post hoppas bara över, så att
 *  en framtida formatändring inte tyst tömmer hela listan. */
function lasAlla(storage: StorageLike): SenasteAnalys[] {
  let ra: string | null;
  try {
    ra = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!ra) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(ra);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const resultat: SenasteAnalys[] = [];
  for (const kandidat of parsed) {
    const utfall = SenasteAnalysSchema.safeParse(kandidat);
    // Zods inferrade typ tillåter `foreningsnamn: string | undefined` (nyckeln
    // finns kvar med värdet `undefined`) — vårt interface, under
    // `exactOptionalPropertyTypes`, kräver att nyckeln UTELÄMNAS istället.
    // Bygger om explicit istället för att pusha `utfall.data` rakt av.
    if (utfall.success) {
      resultat.push({
        analysisId: utfall.data.analysisId,
        skapad: utfall.data.skapad,
        ...(utfall.data.foreningsnamn !== undefined
          ? { foreningsnamn: utfall.data.foreningsnamn }
          : {}),
      });
    }
  }
  return resultat;
}

function skrivAlla(storage: StorageLike, poster: SenasteAnalys[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(poster));
  } catch {
    // Privat läge, full kvot etc. — historiken är en bekvämlighet, aldrig
    // kritisk, så ett skrivfel ska aldrig krascha sidan.
  }
}

function nyastForst(poster: SenasteAnalys[]): SenasteAnalys[] {
  return [...poster].sort((a, b) => new Date(b.skapad).getTime() - new Date(a.skapad).getTime());
}

export class LocalStorageAnalysHistorik implements AnalysHistorik {
  /** `resolveStorage` anropas lazy, per metod — ALDRIG vid modulladdning —
   *  så filen är säker att importera på servern (SSR). */
  constructor(private readonly resolveStorage: () => StorageLike | null) {}

  spara(entry: SenasteAnalys): void {
    const storage = this.resolveStorage();
    if (!storage) return;

    const nuvarande = lasAlla(storage);
    const befintlig = nuvarande.find((a) => a.analysisId === entry.analysisId);
    const ovriga = nuvarande.filter((a) => a.analysisId !== entry.analysisId);

    const ny: SenasteAnalys = {
      analysisId: entry.analysisId,
      skapad: entry.skapad,
      ...(entry.foreningsnamn !== undefined
        ? { foreningsnamn: entry.foreningsnamn }
        : befintlig?.foreningsnamn !== undefined
          ? { foreningsnamn: befintlig.foreningsnamn }
          : {}),
    };

    const uppdaterad = nyastForst([ny, ...ovriga]).slice(0, MAX_POSTER);
    skrivAlla(storage, uppdaterad);
  }

  hamta(now: Date = new Date()): SenasteAnalys[] {
    const storage = this.resolveStorage();
    if (!storage) return [];

    const grans = now.getTime() - TTL_DAGAR * 24 * 60 * 60 * 1000;
    const giltiga = lasAlla(storage).filter((a) => {
      const t = new Date(a.skapad).getTime();
      return Number.isFinite(t) && t >= grans;
    });
    return nyastForst(giltiga).slice(0, MAX_POSTER);
  }

  glom(analysisId: string): void {
    const storage = this.resolveStorage();
    if (!storage) return;

    const kvar = lasAlla(storage).filter((a) => a.analysisId !== analysisId);
    skrivAlla(storage, kvar);
  }
}

/** Standardimplementationen appen faktiskt använder: webbläsarens
 *  localStorage, upplöst lazy så modulen är säker att importera på servern. */
function webblasarStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // t.ex. localStorage avstängt/blockerat av webbläsarinställningar.
    return null;
  }
}

const standardHistorik: AnalysHistorik = new LocalStorageAnalysHistorik(webblasarStorage);

export function sparaAnalys(entry: SenasteAnalys): void {
  standardHistorik.spara(entry);
}

export function hamtaSenasteAnalyser(now?: Date): SenasteAnalys[] {
  return standardHistorik.hamta(now);
}

export function glomAnalys(analysisId: string): void {
  standardHistorik.glom(analysisId);
}
