import type { ExtractionResult } from "@/types/analysis";
import { TOM_SIDA_TECKEN } from "./textlager";

/**
 * Page-reference verification (docs/PLAN-v3.md §2.4). Pure and deterministic, no
 * API call.
 *
 * Page numbers in the extraction come from the API's citations (grounding), but
 * the extraction call then re-types them together with an excerpt, so a page
 * number can still end up next to an excerpt that is printed on another page
 * (or nowhere). This function checks every cited item of an extraction against
 * the text of the page it cites:
 *
 *  - excerpt found on the cited page            -> ok;
 *  - not there, found on exactly ONE other page -> the page is corrected
 *    (recorded in `fynd`);
 *  - found nowhere (or on several other pages, so the right one cannot be
 *    told)                                      -> the item is marked
 *    uncertain (`Figure.osaker`, the sanity checks' mechanism), the
 *    confidence is capped at 'medel' with a skäl line. A figure is NEVER dropped.
 *
 * Page texts: pdf.js per page for a text PDF, the stored transcription for a
 * scan (`sidtext`). A page without usable text (fewer than TOM_SIDA_TECKEN
 * characters) cannot refute anything and is reported as 'ej_kontrollerbar', and
 * so is a citation without an excerpt.
 *
 * The new cited items of PROMPT_VERSION 9 (lanebok.lan, planeradeKostnader,
 * underhallsfond, arligAvsattning, rantekostnader, lokaler, energiprojekt,
 * bostadsrattsyta, sparandeUttag) go through the same walk: their Figures are
 * corrected / marked `osaker`. A loan row whose own citation fails keeps its
 * Figures (marked by their refs, which cite the same row) rather than vanishing
 * from the debt picture; a lease, an energy project or the planned-withdrawal
 * claim has no figure to carry the mark, so it is removed (`kontrolleraNyaPoster`).
 * PROMPT_VERSION 12 adds lokaler.kontrakt[].fornyelse (verified like the lease;
 * an unverifiable renewal is dropped, not the lease).
 * PROMPT_VERSION 11 adds forening.avgiftsandringar and lokaler.forlustsignaler:
 * cited items without a Figure of their own to carry a mark, so, like a lease,
 * an item whose citation holds nowhere is removed (a wrong page is corrected).
 * PROMPT_VERSION 10 adds underhallsplan.investeringsbehovPerM2 /
 * rekommenderadAvsattning / planTotal.belopp (Figures: corrected / `osaker` by
 * the generic walk) and forening.genomfordaAtgarder (no figure: an item whose
 * citation holds nowhere is removed, like an energy project).
 *
 * Addresses and fastighetsbeteckningar are not Figures and have no `osaker`
 * slot. They feed the public register's area assignment, so an item whose
 * citation does not hold (or whose street address / beteckning is not on the
 * cited page at all) is left OUT of the result with a skäl line saying so,
 * rather than shipped as if verified.
 */

/** What the check found for one cited item. */
export type SidreferensStatus = "ok" | "korrigerad" | "saknas" | "ej_kontrollerbar";

export interface Sidreferensfynd {
  /** Where in the extraction, e.g. "forening.keyFigures[2].figure.ref". */
  sokvag: string;
  status: SidreferensStatus;
  /** The page the extraction cited. */
  sida: number;
  /** For 'korrigerad': the page the excerpt was actually found on. */
  nySida?: number;
  /** For 'saknas': other pages the excerpt occurs on (empty = nowhere). */
  andraSidor?: number[];
  /** Why 'ej_kontrollerbar' / what exactly was missing. */
  orsak?: string;
  utdrag: string;
}

export interface SidreferensResultat {
  extraction: ExtractionResult;
  fynd: Sidreferensfynd[];
}

export interface SidreferensSammanfattning {
  kontrollerade: number;
  ok: number;
  korrigerade: number;
  saknas: number;
  ejKontrollerbara: number;
}

export function sammanfattaSidreferenser(
  fynd: readonly Sidreferensfynd[],
): SidreferensSammanfattning {
  const antal = (s: SidreferensStatus) => fynd.filter((f) => f.status === s).length;
  const ok = antal("ok");
  const korrigerade = antal("korrigerad");
  const saknas = antal("saknas");
  return {
    kontrollerade: ok + korrigerade + saknas,
    ok,
    korrigerade,
    saknas,
    ejKontrollerbara: antal("ej_kontrollerbar"),
  };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Marks a minus sign (a hyphen glued to a digit at a token start) so the
 *  hyphen removal below does not turn "-1 200" into "1200". */
const MINUS = "\u0001";

/**
 * Canonical form of a text for matching: what survives is letters, digits and
 * the punctuation that carries meaning inside numbers. Everything pdf.js, the
 * API's own text extraction and the model disagree about is removed:
 * whitespace of any kind (digit-grouping spaces "1 234" = "1234", line breaks,
 * NBSP and narrow NBSP), soft hyphens and zero-width characters, hyphens and
 * dashes (line-break hyphenation "bostads-\nrätt" = "bostadsrätt", "el-anläggning"
 * = "elanläggning"; a minus sign directly in front of a digit is kept), quotation
 * marks, bullets and the "|" the transcription uses between table cells. Case is
 * folded. NFKC maps ligatures, "²" and fullwidth forms to plain characters.
 */
export function kanoniseraText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(new RegExp("[\\u00ad\\u200b-\\u200d\\u2060\\ufeff]", "g"), "")
    .replace(/[‐-―−]/g, "-")
    .replace(/(^|[^\p{L}\p{N}])-(?=\d)/gu, `$1${MINUS}`)
    .replace(/-/g, "")
    .replace(/[\s"'`´“”„‘’‚«»•·▪●|]/gu, "")
    .replaceAll(MINUS, "-")
    .replace(/\p{Co}+/gu, LUCKA);
}

/**
 * A gap in a broken text layer. Some PDF producers (Nabo's årsredovisningar,
 * 2026) map the ligature glyphs "t", "ti", "tt", "fi", "fl", "ft" to
 * private-use code points, so pdf.js reads "Värdeåret" as "Värdeåre\uE035" and
 * "Fastighet" as "Fas\uE03Fghe\uE035". Every run of private-use characters
 * becomes this one marker; `finnsIOrdning` lets it stand for 1–3 of those
 * letters, or for nothing when the excerpt was copied from the broken layer.
 */
const LUCKA = "\uE000";
/** Letters a ligature gap can swallow. */
const LUCKBOKSTAVER = new Set(["f", "i", "l", "t"]);

function regexTecken(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Matches `del` on a page with gaps: before each character an optional gap,
 *  and a gap letter may be the gap itself or be swallowed by the gap before it. */
function luckMonster(del: string): RegExp {
  const delar = [...del].map((c) =>
    LUCKBOKSTAVER.has(c)
      ? `${LUCKA}?(?:${regexTecken(c)}|${LUCKA}|(?<=${LUCKA}))`
      : `${LUCKA}?${regexTecken(c)}`,
  );
  return new RegExp(delar.join(""), "gu");
}

/** Pieces of an excerpt joined with an ellipsis ("SBAB 3,2 % … 25 000 000,00")
 *  must each be found, in order, on the page. */
function delaUtdrag(utdrag: string): string[] {
  const delar = utdrag
    .split(/…|\.{3,}/)
    .map((d) => kanoniseraText(d).replaceAll(LUCKA, ""))
    .filter((d) => d.length > 0);
  if (delar.length <= 1) return delar;
  // A stray fragment of a few characters ("kr") proves nothing and only makes the
  // check fail on a page break the model compressed; keep the substantial ones.
  const betydande = delar.filter((d) => d.length >= 4);
  return betydande.length > 0 ? betydande : delar;
}

/** True when every fragment occurs in `sida`, each after the previous one. */
function finnsIOrdning(delar: readonly string[], sida: string): boolean {
  const medLuckor = sida.includes(LUCKA);
  let fran = 0;
  for (const del of delar) {
    if (!medLuckor) {
      const i = sida.indexOf(del, fran);
      if (i === -1) return false;
      fran = i + del.length;
      continue;
    }
    const m = luckMonster(del);
    m.lastIndex = fran;
    const traff = m.exec(sida);
    if (traff === null) return false;
    fran = traff.index + traff[0].length;
  }
  return true;
}

/** An excerpt shorter than this (canonical characters) is too generic to pick
 *  out ONE other page ("670" is printed on many pages), so it never corrects a
 *  page; it can only confirm the cited one. */
const MIN_TECKEN_FOR_KORRIGERING = 12;

// ---------------------------------------------------------------------------
// Checking one reference
// ---------------------------------------------------------------------------

class Sidor {
  private readonly kanon = new Map<number, string>();
  constructor(private readonly texter: ReadonlyMap<number, string>) {}

  /** Canonical text of a page, or undefined when the page is unknown. */
  text(sida: number): string | undefined {
    const cachad = this.kanon.get(sida);
    if (cachad !== undefined) return cachad;
    const ratt = this.texter.get(sida);
    if (ratt === undefined) return undefined;
    const k = kanoniseraText(ratt);
    this.kanon.set(sida, k);
    return k;
  }

  /** True when the page has too little text to refute a citation. */
  arTom(sida: number): boolean {
    const ratt = this.texter.get(sida);
    return ratt === undefined || ratt.trim().length < TOM_SIDA_TECKEN;
  }

  alla(): number[] {
    return [...this.texter.keys()].sort((a, b) => a - b);
  }
}

interface Bedomning {
  fynd: Omit<Sidreferensfynd, "sokvag">;
}

function kortaNer(text: string, max = 70): string {
  const ren = text.replace(/\s+/g, " ").trim();
  return ren.length > max ? `${ren.slice(0, max - 1)}…` : ren;
}

function kontrolleraRef(sidor: Sidor, page: number, excerpt: string | undefined): Bedomning {
  const utdrag = excerpt ?? "";
  const ej = (orsak: string): Bedomning => ({
    fynd: { status: "ej_kontrollerbar", sida: page, orsak, utdrag },
  });
  if (excerpt === undefined || excerpt.trim() === "") return ej("citatet saknar utdrag");
  const delar = delaUtdrag(excerpt);
  if (delar.length === 0) return ej("citatet har ingen jämförbar text");

  const sidText = sidor.text(page);
  if (sidText === undefined) {
    // The cited page does not exist among the page texts at all: a page number
    // outside the document is as wrong as a reference can be, UNLESS we simply
    // have no texts (handled by the caller, which skips the whole check).
    const andra = sidor.alla().filter((n) => finnsIOrdning(delar, sidor.text(n) ?? ""));
    return andraSidorBedomning(page, utdrag, delar, andra, `sidan ${page} finns inte i dokumentet`);
  }
  if (finnsIOrdning(delar, sidText)) return { fynd: { status: "ok", sida: page, utdrag } };
  if (sidor.arTom(page)) return ej(`sidan ${page} har ingen läsbar text att jämföra mot`);

  const andra = sidor.alla().filter((n) => n !== page && finnsIOrdning(delar, sidor.text(n) ?? ""));
  return andraSidorBedomning(page, utdrag, delar, andra, `hittades inte på sidan ${page}`);
}

function andraSidorBedomning(
  page: number,
  utdrag: string,
  delar: readonly string[],
  andra: readonly number[],
  utgangspunkt: string,
): Bedomning {
  const langd = delar.reduce((s, d) => s + d.length, 0);
  if (andra.length === 1 && langd >= MIN_TECKEN_FOR_KORRIGERING) {
    return { fynd: { status: "korrigerad", sida: page, nySida: andra[0]!, utdrag } };
  }
  return {
    fynd: {
      status: "saknas",
      sida: page,
      andraSidor: [...andra],
      orsak: utgangspunkt,
      utdrag,
    },
  };
}

function osakerText(f: Sidreferensfynd): string {
  const citat = `"${kortaNer(f.utdrag)}"`;
  if (f.andraSidor && f.andraSidor.length > 1) {
    return (
      `Sidhänvisningen stämmer inte säkert: citatet ${citat} finns inte på sidan ${f.sida} ` +
      `utan på flera andra sidor (${f.andraSidor.join(", ")}), så rätt sida kan inte avgöras.`
    );
  }
  if (f.andraSidor && f.andraSidor.length === 1) {
    return (
      `Sidhänvisningen stämmer inte säkert: citatet ${citat} finns inte på sidan ${f.sida} ` +
      `men på sidan ${f.andraSidor[0]}, och är för kort för att med säkerhet peka ut sidan.`
    );
  }
  return `Sidhänvisningen kunde inte styrkas: citatet ${citat} hittades inte på sidan ${f.sida} eller någon annan sida i årsredovisningen.`;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function arObjekt(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function arSidref(v: unknown): v is { page: number; excerpt?: string } {
  return (
    arObjekt(v) &&
    typeof v["page"] === "number" &&
    (v["excerpt"] === undefined || typeof v["excerpt"] === "string")
  );
}

/** A Figure has a unit and a source next to its (nullable) value. */
function arFigur(v: Record<string, unknown>): boolean {
  return "unit" in v && "source" in v && "value" in v;
}

interface Kontext {
  sidor: Sidor;
  fynd: Sidreferensfynd[];
  /** Skäl lines for items that cannot carry an `osaker` marker. */
  skal: string[];
}

/** Items handled separately (by `kontrolleraAdresser` / `kontrolleraNyaPoster`)
 *  because a citation that does not hold removes the item instead of marking it. */
const SARBEHANDLADE = new Set([
  "forening.adresser",
  "forening.fastighetsbeteckningar",
  "forening.sparandeUttag",
  "forening.energiprojekt",
  "forening.lokaler.kontrakt",
  "forening.lokaler.forlustsignaler",
  "forening.genomfordaAtgarder",
  "forening.avgiftsandringar",
]);

function verifieraNod(nod: unknown, sokvag: string, k: Kontext): unknown {
  if (Array.isArray(nod)) return nod.map((v, i) => verifieraNod(v, `${sokvag}[${i}]`, k));
  if (!arObjekt(nod)) return nod;

  const figur = arFigur(nod);
  let osaker: string | undefined;
  const ut: Record<string, unknown> = {};

  for (const [nyckel, varde] of Object.entries(nod)) {
    if (SARBEHANDLADE.has(`${sokvag}.${nyckel}`)) {
      ut[nyckel] = varde; // done by kontrolleraAdresser / kontrolleraNyaPoster
      continue;
    }
    const arKallaPost = sokvag.endsWith("avgiftInkluderarKallor");
    if ((nyckel === "ref" || arKallaPost) && arSidref(varde)) {
      const stig = `${sokvag}.${nyckel}`;
      const { fynd } = kontrolleraRef(k.sidor, varde.page, varde.excerpt);
      const post: Sidreferensfynd = { sokvag: stig, ...fynd };
      k.fynd.push(post);
      if (post.status === "korrigerad") {
        ut[nyckel] = { ...varde, page: post.nySida! };
      } else {
        ut[nyckel] = varde;
        if (post.status === "saknas") {
          if (figur) osaker = osakerText(post);
          else k.skal.push(`${stig}: ${osakerText(post)}`);
        }
      }
      continue;
    }
    ut[nyckel] = verifieraNod(varde, sokvag === "" ? nyckel : `${sokvag}.${nyckel}`, k);
  }
  if (osaker !== undefined && ut["osaker"] === undefined) ut["osaker"] = osaker;
  return ut;
}

/** True when `varde` (a street address, a beteckning, a postnummer) is printed
 *  on `sida` — compared in canonical form. */
function finnsPaSidan(sidor: Sidor, sida: number, varde: string): boolean {
  const kanon = kanoniseraText(varde).replaceAll(LUCKA, "");
  return kanon.length > 0 && finnsIOrdning([kanon], sidor.text(sida) ?? "");
}

function kontrolleraAdresser(
  forening: Record<string, unknown>,
  k: Kontext,
): Record<string, unknown> {
  const ut = { ...forening };

  const adresser = forening["adresser"];
  if (Array.isArray(adresser)) {
    const behalls: unknown[] = [];
    adresser.forEach((a, i) => {
      if (!arObjekt(a) || !arSidref(a["ref"]) || typeof a["gatuadress"] !== "string") {
        behalls.push(a);
        return;
      }
      const stig = `forening.adresser[${i}]`;
      const ref = a["ref"];
      const { fynd } = kontrolleraRef(k.sidor, ref.page, ref.excerpt);
      const post: Sidreferensfynd = { sokvag: `${stig}.ref`, ...fynd };
      k.fynd.push(post);
      const sida = post.status === "korrigerad" ? post.nySida! : ref.page;
      const kontrollerbar = post.status === "ok" || post.status === "korrigerad";
      if (
        post.status === "saknas" ||
        (kontrollerbar && !finnsPaSidan(k.sidor, sida, a["gatuadress"]))
      ) {
        k.skal.push(
          `Adressen "${kortaNer(a["gatuadress"])}" kunde inte styrkas mot årsredovisningens text och ` +
            "utelämnades.",
        );
        post.status = "saknas";
        return;
      }
      const ny: Record<string, unknown> = {
        ...a,
        ref: post.status === "korrigerad" ? { ...ref, page: sida } : ref,
      };
      if (kontrollerbar) {
        for (const falt of ["postnummer", "ort"] as const) {
          const v = a[falt];
          if (typeof v === "string" && !finnsPaSidan(k.sidor, sida, v)) {
            delete ny[falt];
            k.skal.push(
              `${falt === "ort" ? "Orten" : "Postnumret"} "${v}" vid adressen "${kortaNer(a["gatuadress"])}" står inte på den citerade sidan och utelämnades.`,
            );
          }
        }
      }
      behalls.push(ny);
    });
    ut["adresser"] = behalls;
  }

  const beteckningar = forening["fastighetsbeteckningar"];
  if (Array.isArray(beteckningar)) {
    const behalls: unknown[] = [];
    beteckningar.forEach((b, i) => {
      if (!arObjekt(b) || !arSidref(b["ref"]) || typeof b["beteckning"] !== "string") {
        behalls.push(b);
        return;
      }
      const ref = b["ref"];
      const { fynd } = kontrolleraRef(k.sidor, ref.page, ref.excerpt);
      const post: Sidreferensfynd = {
        sokvag: `forening.fastighetsbeteckningar[${i}].ref`,
        ...fynd,
      };
      k.fynd.push(post);
      const sida = post.status === "korrigerad" ? post.nySida! : ref.page;
      const kontrollerbar = post.status === "ok" || post.status === "korrigerad";
      if (
        post.status === "saknas" ||
        (kontrollerbar && !finnsPaSidan(k.sidor, sida, b["beteckning"]))
      ) {
        k.skal.push(
          `Fastighetsbeteckningen "${kortaNer(b["beteckning"])}" kunde inte styrkas mot årsredovisningens text och utelämnades.`,
        );
        post.status = "saknas";
        return;
      }
      behalls.push(post.status === "korrigerad" ? { ...b, ref: { ...ref, page: sida } } : b);
    });
    ut["fastighetsbeteckningar"] = behalls;
  }
  return ut;
}

/**
 * One cited item that is not a Figure (a lease, an energy project, the planned
 * withdrawal): its own `ref` is checked; a wrong page is corrected, a citation
 * that holds nowhere removes the item (returns undefined) with a skäl line. The
 * item's Figures are verified like any other (marked `osaker` when not found).
 */
function kontrolleraPost(
  post: unknown,
  stig: string,
  beskrivning: string,
  k: Kontext,
): unknown | undefined {
  if (!arObjekt(post)) return post;
  const ref = post["ref"];
  let ny: Record<string, unknown> = post;
  if (arSidref(ref)) {
    const { fynd } = kontrolleraRef(k.sidor, ref.page, ref.excerpt);
    const fynd1: Sidreferensfynd = { sokvag: `${stig}.ref`, ...fynd };
    k.fynd.push(fynd1);
    if (fynd1.status === "saknas") {
      k.skal.push(`${beskrivning} kunde inte styrkas mot årsredovisningens text och utelämnades.`);
      return undefined;
    }
    if (fynd1.status === "korrigerad") ny = { ...post, ref: { ...ref, page: fynd1.nySida! } };
  }
  const ut: Record<string, unknown> = {};
  for (const [nyckel, varde] of Object.entries(ny)) {
    ut[nyckel] = nyckel === "ref" ? varde : verifieraNod(varde, `${stig}.${nyckel}`, k);
  }
  return ut;
}

function kontrolleraNyaPoster(
  forening: Record<string, unknown>,
  k: Kontext,
): Record<string, unknown> {
  const ut = { ...forening };

  if ("sparandeUttag" in forening) {
    const post = kontrolleraPost(
      forening["sparandeUttag"],
      "forening.sparandeUttag",
      "Uppgiften om planerat uttag och dess finansiering",
      k,
    );
    if (post === undefined) delete ut["sparandeUttag"];
    else ut["sparandeUttag"] = post;
  }

  const projekt = forening["energiprojekt"];
  if (Array.isArray(projekt)) {
    const kvar = projekt
      .map((p, i) =>
        kontrolleraPost(
          p,
          `forening.energiprojekt[${i}]`,
          `Energiprojektet "${arObjekt(p) && typeof p["text"] === "string" ? kortaNer(p["text"], 50) : ""}"`,
          k,
        ),
      )
      .filter((p) => p !== undefined);
    if (kvar.length > 0) ut["energiprojekt"] = kvar;
    else delete ut["energiprojekt"];
  }

  const atgarder = forening["genomfordaAtgarder"];
  if (Array.isArray(atgarder)) {
    const kvar = atgarder
      .map((a, i) =>
        kontrolleraPost(
          a,
          `forening.genomfordaAtgarder[${i}]`,
          `Den genomförda åtgärden "${arObjekt(a) && typeof a["text"] === "string" ? kortaNer(a["text"], 50) : ""}"`,
          k,
        ),
      )
      .filter((a) => a !== undefined);
    if (kvar.length > 0) ut["genomfordaAtgarder"] = kvar;
    else delete ut["genomfordaAtgarder"];
  }

  const andringar = forening["avgiftsandringar"];
  if (Array.isArray(andringar)) {
    const kvar = andringar
      .map((a, i) => {
        const p = arObjekt(a) && arObjekt(a["procent"]) ? a["procent"]["value"] : undefined;
        return kontrolleraPost(
          a,
          `forening.avgiftsandringar[${i}]`,
          `Höjningen av årsavgiften${typeof p === "number" ? ` på ${p} %` : ""}`,
          k,
        );
      })
      .filter((a) => a !== undefined);
    if (kvar.length > 0) ut["avgiftsandringar"] = kvar;
    else delete ut["avgiftsandringar"];
  }

  const lokaler = forening["lokaler"];
  if (
    arObjekt(lokaler) &&
    (Array.isArray(lokaler["kontrakt"]) || Array.isArray(lokaler["forlustsignaler"]))
  ) {
    const { kontrakt: _k, forlustsignaler: _f, ...resten } = lokaler;
    const nyLokaler: Record<string, unknown> = { ...resten };
    if (Array.isArray(lokaler["kontrakt"])) {
      const kvar = lokaler["kontrakt"]
        .map((c, i) => {
          const stig = `forening.lokaler.kontrakt[${i}]`;
          if (!arObjekt(c)) return kontrolleraPost(c, stig, "Ett lokalkontrakt", k);
          const slut = typeof c["slutdatum"] === "string" ? ` (slutdatum ${c["slutdatum"]})` : "";
          // PROMPT_VERSION 12: the lease's own `fornyelse` is verified like the
          // lease; if its citation holds nowhere only the renewal is dropped.
          const { fornyelse, ...utanFornyelse } = c;
          const post = kontrolleraPost(utanFornyelse, stig, `Ett lokalkontrakt${slut}`, k);
          if (post === undefined || fornyelse === undefined) return post;
          const f = kontrolleraPost(
            fornyelse,
            `${stig}.fornyelse`,
            `Uppgiften om förlängning eller ny hyresgäst för ett lokalkontrakt${slut}`,
            k,
          );
          return f === undefined ? post : { ...(post as Record<string, unknown>), fornyelse: f };
        })
        .filter((c) => c !== undefined);
      if (kvar.length > 0) nyLokaler["kontrakt"] = kvar;
    }
    if (Array.isArray(lokaler["forlustsignaler"])) {
      const kvar = lokaler["forlustsignaler"]
        .map((sig, i) =>
          kontrolleraPost(
            sig,
            `forening.lokaler.forlustsignaler[${i}]`,
            `Uppgiften "${arObjekt(sig) && typeof sig["text"] === "string" ? kortaNer(sig["text"], 50) : ""}" om lokalhyran`,
            k,
          ),
        )
        .filter((sig) => sig !== undefined);
      if (kvar.length > 0) nyLokaler["forlustsignaler"] = kvar;
    }
    ut["lokaler"] = nyLokaler;
  }
  return ut;
}

/**
 * Verifies every cited item of `extraction` against `sidtexter` (1-based page
 * number -> the page's text). Returns a new extraction (the input is not
 * modified) and one finding per checked reference.
 *
 * An empty `sidtexter` map means "no page texts available": nothing is checked
 * (all references are reported as 'ej_kontrollerbar' by omission: `fynd` is
 * empty) rather than every figure being marked uncertain.
 */
export function verifieraSidreferenser(
  extraction: ExtractionResult,
  sidtexter: ReadonlyMap<number, string>,
): SidreferensResultat {
  if (sidtexter.size === 0) return { extraction, fynd: [] };

  const k: Kontext = { sidor: new Sidor(sidtexter), fynd: [], skal: [] };
  const raw = extraction as unknown as Record<string, unknown>;
  const ut: Record<string, unknown> = {};
  for (const [nyckel, varde] of Object.entries(raw)) {
    ut[nyckel] = verifieraNod(varde, nyckel, k);
  }
  if (arObjekt(ut["forening"])) {
    ut["forening"] = kontrolleraNyaPoster(kontrolleraAdresser(ut["forening"], k), k);
  }

  const saknas = k.fynd.filter((f) => f.status === "saknas");
  const resultat = ut as unknown as ExtractionResult;
  if (saknas.length === 0 && k.skal.length === 0) return { extraction: resultat, fynd: k.fynd };

  const konfidens = resultat.datakvalitet.extraktionKonfidens;
  const sammanfattning =
    saknas.length > 0
      ? [
          `${saknas.length} sidhänvisning${saknas.length === 1 ? "" : "ar"} kunde inte styrkas mot årsredovisningens text; berörda uppgifter är markerade som osäkra.`,
        ]
      : [];
  return {
    extraction: {
      ...resultat,
      datakvalitet: {
        ...resultat.datakvalitet,
        extraktionKonfidens: {
          // Capped at 'medel', never raised (a 'lag' stays 'lag').
          niva: konfidens.niva === "hog" ? "medel" : konfidens.niva,
          skal: [...(konfidens.skal ?? []), ...sammanfattning, ...k.skal],
        },
      },
    },
    fynd: k.fynd,
  };
}
