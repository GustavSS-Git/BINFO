/**
 * Bevisar EMPIRISKT — mot ett riktigt Supabase-projekt, inte på förtroende
 * — att (a) PROJECT_SECRET_KEY (`sb_secret_...`) förbigår RLS trots
 * "enable row level security" + noll policies, och (b)
 * PROJECT_PUBLISHABLE_KEY korrekt nekas. Stänger den öppna frågan i
 * SUPABASE.md om det nya `sb_secret_...`-nyckelformatet verkligen beter sig
 * som gamla `service_role`.
 *
 * Tre delar:
 *  1. `spend_day` (day/cost_sek/runs) som oskyldig probe-tabell, med ett
 *     datum långt bak i tiden (1999) som aldrig kan krocka med riktig data.
 *  2. v2-tabellerna (register: forening, rapport, rapport_fil, sidtext,
 *     forening_adress; konto: principal, behorighet, kvot; v3: sparad_vardering,
 *     sparad_kalkyl, plus RPC:erna sakerstall_konto_principal,
 *     lista_mina_analyser, radera_min_analys). Secret-nyckeln
 *     skriver en probe-rad i varje (så att "publishable ser 0 rader" betyder
 *     något), publishable ska varken se, skriva, ändra eller radera dem.
 *     Probe-raderna är märkta `verify-rls` och kan aldrig plockas av
 *     workern eller matchas av en uppslagning: rapporten är `failed`/`klar`
 *     med en egen pipeline_version och utan identitet, filens hash är inte
 *     en sha256, orgnr 000000-0000 finns inte. Allt städas bort i `finally`.
 *  3. v2-RPC:erna: publishable ska nekas EXECUTE på alla (och inga
 *     sidoeffekter ska landa); secret-nyckeln ska få köra dem där ett anrop
 *     är ofarligt. `claim_next_rapport_steg` anropas ALDRIG med
 *     secret-nyckeln — mot produktion skulle det klaima ett riktigt jobb.
 *
 * Det här är en säkerhetskritisk kontroll: ett skript som rapporterar falsk
 * trygghet är värre än ett som är högljutt om ett misslyckande. Därför:
 * exit 1 om NÅGOT beter sig annorlunda än förväntat, även om resten gick
 * bra.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envFromProcess } from "../env";

const DAG_SECRET = "1999-01-01";
const DAG_PUBLISHABLE = "1999-01-02";

// Probe identities for the v2 tables. See the file comment for why none of
// them can be picked up by the worker or matched by a register lookup.
const PROBE_ORGNR = "000000-0000";
const PROBE_ORGNR_PUBLISHABLE = "000000-0001";
const PROBE_POSTNUMMER = "00000";
const PROBE_PIPELINE_VERSION = "verify-rls-probe";
const PROBE_PDF_HASH = "verify-rls-probe";
const PROBE_ENHET = "verify-rls-probe";
const PROBE_ENHET_PUBLISHABLE = "verify-rls-probe-publishable";
const PROBE_KVOT = "verify-rls:probe";
const PROBE_KVOT_PUBLISHABLE = "verify-rls:probe-publishable";
// v3 saved items: both tables are probed through their `etikett`.
const PROBE_ETIKETT = "verify-rls-probe";
const PROBE_ETIKETT_PUBLISHABLE = "verify-rls-probe-publishable";

interface Utfall {
  namn: string;
  godkant: boolean;
  detalj: string;
}

function loggaUtfall(u: Utfall): void {
  console.error(`${u.godkant ? "OK  " : "FEL "} ${u.namn}: ${u.detalj}`);
}

function felText(error: unknown): string {
  return JSON.stringify(error);
}

type Klient = SupabaseClient;

/** One v2 table: how to find the secret key's probe row and how the
 *  publishable key tries to write its own. */
interface TabellProbe {
  tabell: string;
  /** Column + value that identifies the secret key's probe row. */
  nyckel: [string, string];
  /** A row the publishable key tries to insert (must be denied). */
  publishableRad: Record<string, unknown>;
  /** Column + value identifying that row, to check it never landed. */
  publishableNyckel: [string, string];
  /** A harmless column for the update attempt (`set col = value`). */
  uppdatering: Record<string, unknown>;
}

async function main() {
  const env = envFromProcess();

  if (!env.supabasePublishableKey) {
    console.error(
      "PROJECT_PUBLISHABLE_KEY saknas i .env.local. Den är valfri i Env generellt (se " +
        "src/server/env.ts), men KRÄVS för det här skriptet — utan den kan vi inte visa att en " +
        "icke-secret nyckel faktiskt nekas av RLS. Lägg till den och försök igen.",
    );
    process.exitCode = 1;
    return;
  }

  console.error(`Mål: ${new URL(env.supabaseUrl).host}`);

  const secretClient = createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false },
  });
  const publishableClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false },
  });

  const utfall: Utfall[] = [];

  try {
    await provaSpendDay(secretClient, publishableClient, utfall);
    await provaV2Tabeller(secretClient, publishableClient, utfall);
    await provaV2Rpcer(secretClient, publishableClient, utfall);
  } finally {
    await stada(secretClient);
  }

  for (const u of utfall) loggaUtfall(u);

  const secretForbigarRls = utfall
    .filter((u) => u.namn.startsWith("secret"))
    .every((u) => u.godkant);
  const publishableNekas = utfall
    .filter((u) => u.namn.startsWith("publishable"))
    .every((u) => u.godkant);
  const allaGodkanda = utfall.every((u) => u.godkant);

  console.log("");
  console.log("=== Slutresultat: RLS-verifiering (spend_day + v2-tabeller + v2-RPC:er) ===");
  console.log(`Mål: ${new URL(env.supabaseUrl).host}`);
  console.log(
    `Secret-nyckeln förbigår RLS / får köra RPC:erna: ${secretForbigarRls ? "JA" : "NEJ"}`,
  );
  console.log(`Publishable-nyckeln nekas överallt: ${publishableNekas ? "JA" : "NEJ"}`);
  console.log(`Totalt: ${allaGodkanda ? "GODKÄNT" : "UNDERKÄNT"} (${utfall.length} kontroller)`);
  console.log("");
  for (const u of utfall) {
    console.log(`  ${u.godkant ? "OK  " : "FEL "} ${u.namn} — ${u.detalj}`);
  }

  if (!allaGodkanda) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 1. spend_day (the original probe)
// ---------------------------------------------------------------------------

async function provaSpendDay(secretClient: Klient, publishableClient: Klient, utfall: Utfall[]) {
  console.error(`Skriver probe-rad (${DAG_SECRET}) med secret-nyckeln...`);
  const insertSecret = await secretClient
    .from("spend_day")
    .upsert({ day: DAG_SECRET, cost_sek: 0, runs: 0 }, { onConflict: "day" });
  utfall.push({
    namn: "secret-nyckeln kan skriva spend_day",
    godkant: insertSecret.error === null,
    detalj: insertSecret.error ? `fel: ${felText(insertSecret.error)}` : "upsert lyckades utan fel",
  });

  const selectSecret = await secretClient.from("spend_day").select("*").eq("day", DAG_SECRET);
  const secretFickRad = selectSecret.error === null && (selectSecret.data?.length ?? 0) === 1;
  utfall.push({
    namn: "secret-nyckeln kan läsa tillbaka spend_day-raden",
    godkant: secretFickRad,
    detalj: selectSecret.error
      ? `fel: ${felText(selectSecret.error)}`
      : `data: ${JSON.stringify(selectSecret.data)}`,
  });

  // RLS-denied selects often answer { data: [], error: null } rather than an
  // error — check the row count, not only the presence of an error.
  const selectPublishable = await publishableClient
    .from("spend_day")
    .select("*")
    .eq("day", DAG_SECRET);
  utfall.push({
    namn: "publishable-nyckeln nekas select på spend_day",
    godkant: selectPublishable.error !== null || (selectPublishable.data?.length ?? 0) === 0,
    detalj: selectPublishable.error
      ? `nekad med fel: ${felText(selectPublishable.error)}`
      : `svar utan fel, ${selectPublishable.data?.length ?? 0} rader`,
  });

  const insertPublishable = await publishableClient
    .from("spend_day")
    .insert({ day: DAG_PUBLISHABLE, cost_sek: 0, runs: 0 });
  // A success-looking answer is no proof that nothing was written — check
  // with the secret key whether the row actually landed.
  const kontroll = await secretClient.from("spend_day").select("*").eq("day", DAG_PUBLISHABLE);
  utfall.push({
    namn: "publishable-nyckeln nekas insert på spend_day",
    godkant: insertPublishable.error !== null || (kontroll.data?.length ?? 0) === 0,
    detalj: insertPublishable.error
      ? `nekad med fel: ${felText(insertPublishable.error)}`
      : `svar utan fel; ${kontroll.data?.length ?? 0} rader hittades i efterhand`,
  });
}

// ---------------------------------------------------------------------------
// 2. v2 tables
// ---------------------------------------------------------------------------

/** Writes one probe row per v2 table with the secret key. Returns the probe
 *  rapport and principal ids (needed as foreign keys), or null on failure
 *  (recorded in `utfall`). */
async function skrivProbeRader(
  secretClient: Klient,
  utfall: Utfall[],
): Promise<{ rapportId: string; principalId: string } | null> {
  const steg: Array<[string, () => PromiseLike<{ error: unknown }>]> = [];
  let rapportId: string | null = null;
  let principalId: string | null = null;

  const forening = await secretClient
    .from("forening")
    .insert({ orgnr: PROBE_ORGNR, namn: "verify-rls probe" });
  // status 'failed' + stage 'klar' + own pipeline_version + no identity:
  // never claimable, never found by a register lookup.
  const rapport = await secretClient
    .from("rapport")
    .insert({
      pipeline_version: PROBE_PIPELINE_VERSION,
      model: "verify-rls-probe",
      textlager: "ok",
      status: "failed",
      stage: "klar",
      error_code: "ogiltigforklarad",
      error_message: "verify-rls probe",
    })
    .select("id")
    .single();
  rapportId = (rapport.data as { id: string } | null)?.id ?? null;
  const principal = await secretClient
    .from("principal")
    .insert({ typ: "anonym", enhet_id: PROBE_ENHET })
    .select("id")
    .single();
  principalId = (principal.data as { id: string } | null)?.id ?? null;

  const resultat: Array<[string, unknown]> = [
    ["forening", forening.error],
    ["rapport", rapport.error],
    ["principal", principal.error],
  ];

  if (rapportId !== null && principalId !== null) {
    const rid = rapportId;
    const pid = principalId;
    steg.push(
      [
        "rapport_fil",
        () =>
          secretClient.from("rapport_fil").insert({
            pdf_hash: PROBE_PDF_HASH,
            rapport_id: rid,
            pdf_path: "verify-rls-probe.pdf",
          }),
      ],
      [
        "sidtext",
        () =>
          secretClient
            .from("sidtext")
            .insert({ rapport_id: rid, sida: 1, text: "verify-rls probe", kalla: "verify-rls" }),
      ],
      [
        "forening_adress",
        () =>
          secretClient
            .from("forening_adress")
            .insert({ orgnr: PROBE_ORGNR, postnummer: PROBE_POSTNUMMER, kalla: "anvandare" }),
      ],
      [
        "behorighet",
        () =>
          secretClient
            .from("behorighet")
            .insert({ principal_id: pid, formaga: "verify-rls", kalla: "gratis" }),
      ],
      [
        "kvot",
        () =>
          secretClient
            .from("kvot")
            .insert({ nyckel: PROBE_KVOT, fonster_start: "1999-01-01T00:00:00Z", antal: 0 }),
      ],
      [
        "sparad_vardering",
        () =>
          secretClient.from("sparad_vardering").insert({
            principal_id: pid,
            etikett: PROBE_ETIKETT,
            input: {},
            resultat: {},
            modell_version: "verify-rls",
          }),
      ],
      [
        "sparad_kalkyl",
        () =>
          secretClient.from("sparad_kalkyl").insert({
            principal_id: pid,
            etikett: PROBE_ETIKETT,
            input: {},
            sammanfattning: {},
            regelversion: "verify-rls",
          }),
      ],
    );
    for (const [tabell, gor] of steg) {
      const { error } = await gor();
      resultat.push([tabell, error]);
    }
  }

  for (const [tabell, error] of resultat) {
    utfall.push({
      namn: `secret-nyckeln kan skriva ${tabell}`,
      godkant: error === null,
      detalj: error === null ? "probe-rad skriven" : `fel: ${felText(error)}`,
    });
  }
  if (rapportId === null || principalId === null) return null;
  return { rapportId, principalId };
}

async function provaV2Tabeller(secretClient: Klient, publishableClient: Klient, utfall: Utfall[]) {
  // A leftover from an aborted earlier run would make the inserts conflict.
  await stada(secretClient);
  console.error("Skriver probe-rader i v2-tabellerna med secret-nyckeln...");
  const ids = await skrivProbeRader(secretClient, utfall);
  if (ids === null) {
    utfall.push({
      namn: "secret-nyckeln kan skriva v2-probe-rader",
      godkant: false,
      detalj:
        "rapport/principal-proben kunde inte skrivas; resten av v2-tabellkontrollerna hoppas över",
    });
    return;
  }

  const probes: TabellProbe[] = [
    {
      tabell: "forening",
      nyckel: ["orgnr", PROBE_ORGNR],
      publishableRad: { orgnr: PROBE_ORGNR_PUBLISHABLE, namn: "verify-rls publishable" },
      publishableNyckel: ["orgnr", PROBE_ORGNR_PUBLISHABLE],
      uppdatering: { namn: "verify-rls hijack" },
    },
    {
      tabell: "rapport",
      nyckel: ["id", ids.rapportId],
      publishableRad: {
        pipeline_version: PROBE_PIPELINE_VERSION + "-publishable",
        model: "verify-rls-probe",
        textlager: "ok",
        status: "failed",
        stage: "klar",
      },
      publishableNyckel: ["pipeline_version", PROBE_PIPELINE_VERSION + "-publishable"],
      uppdatering: { model: "verify-rls hijack" },
    },
    {
      tabell: "rapport_fil",
      nyckel: ["pdf_hash", PROBE_PDF_HASH],
      publishableRad: {
        pdf_hash: PROBE_PDF_HASH + "-publishable",
        rapport_id: ids.rapportId,
        pdf_path: "x.pdf",
      },
      publishableNyckel: ["pdf_hash", PROBE_PDF_HASH + "-publishable"],
      uppdatering: { pdf_path: "verify-rls-hijack.pdf" },
    },
    {
      tabell: "sidtext",
      nyckel: ["rapport_id", ids.rapportId],
      publishableRad: { rapport_id: ids.rapportId, sida: 2, text: "x", kalla: "verify-rls" },
      publishableNyckel: ["rapport_id", ids.rapportId],
      uppdatering: { text: "verify-rls hijack" },
    },
    {
      tabell: "forening_adress",
      nyckel: ["orgnr", PROBE_ORGNR],
      publishableRad: { orgnr: PROBE_ORGNR, postnummer: "00001", kalla: "anvandare" },
      publishableNyckel: ["postnummer", "00001"],
      uppdatering: { omrade: "verify-rls hijack" },
    },
    {
      tabell: "principal",
      nyckel: ["id", ids.principalId],
      publishableRad: { typ: "anonym", enhet_id: PROBE_ENHET_PUBLISHABLE },
      publishableNyckel: ["enhet_id", PROBE_ENHET_PUBLISHABLE],
      uppdatering: { typ: "konto" },
    },
    {
      tabell: "behorighet",
      nyckel: ["principal_id", ids.principalId],
      publishableRad: {
        principal_id: ids.principalId,
        formaga: "verify-rls-publishable",
        kalla: "kop",
      },
      publishableNyckel: ["formaga", "verify-rls-publishable"],
      uppdatering: { kalla: "kop" },
    },
    {
      tabell: "kvot",
      nyckel: ["nyckel", PROBE_KVOT],
      publishableRad: {
        nyckel: PROBE_KVOT_PUBLISHABLE,
        fonster_start: "1999-01-01T00:00:00Z",
        antal: 0,
      },
      publishableNyckel: ["nyckel", PROBE_KVOT_PUBLISHABLE],
      uppdatering: { antal: 999 },
    },
    {
      tabell: "sparad_vardering",
      nyckel: ["etikett", PROBE_ETIKETT],
      publishableRad: {
        principal_id: ids.principalId,
        etikett: PROBE_ETIKETT_PUBLISHABLE,
        input: {},
        resultat: {},
        modell_version: "verify-rls",
      },
      publishableNyckel: ["etikett", PROBE_ETIKETT_PUBLISHABLE],
      uppdatering: { modell_version: "verify-rls hijack" },
    },
    {
      tabell: "sparad_kalkyl",
      nyckel: ["etikett", PROBE_ETIKETT],
      publishableRad: {
        principal_id: ids.principalId,
        etikett: PROBE_ETIKETT_PUBLISHABLE,
        input: {},
        sammanfattning: {},
        regelversion: "verify-rls",
      },
      publishableNyckel: ["etikett", PROBE_ETIKETT_PUBLISHABLE],
      uppdatering: { regelversion: "verify-rls hijack" },
    },
  ];

  for (const p of probes) {
    const [kol, varde] = p.nyckel;
    console.error(`Provar ${p.tabell}...`);

    const fore = await secretClient.from(p.tabell).select("*").eq(kol, varde);
    const foreRader = (fore.data ?? []) as Array<Record<string, unknown>>;
    utfall.push({
      namn: `secret-nyckeln kan läsa ${p.tabell}`,
      godkant: fore.error === null && foreRader.length >= 1,
      detalj: fore.error ? `fel: ${felText(fore.error)}` : `${foreRader.length} probe-rad(er)`,
    });

    const sel = await publishableClient.from(p.tabell).select("*").eq(kol, varde);
    utfall.push({
      namn: `publishable-nyckeln nekas select på ${p.tabell}`,
      godkant: sel.error !== null || (sel.data?.length ?? 0) === 0,
      detalj: sel.error
        ? `nekad med fel: ${felText(sel.error)}`
        : `svar utan fel, ${sel.data?.length ?? 0} rader (probe-raden finns)`,
    });

    const ins = await publishableClient.from(p.tabell).insert(p.publishableRad);
    const [pkol, pvarde] = p.publishableNyckel;
    // sidtext's key column matches the secret probe too; compare counts.
    const efterIns = await secretClient.from(p.tabell).select("*").eq(pkol, pvarde);
    const landade =
      p.tabell === "sidtext"
        ? (efterIns.data?.length ?? 0) > foreRader.length
        : (efterIns.data?.length ?? 0) > 0;
    utfall.push({
      namn: `publishable-nyckeln nekas insert på ${p.tabell}`,
      godkant: !landade,
      detalj: ins.error
        ? `nekad med fel: ${felText(ins.error)}`
        : `svar utan fel; landade i efterhand: ${landade ? "JA" : "nej"}`,
    });

    const upd = await publishableClient.from(p.tabell).update(p.uppdatering).eq(kol, varde);
    const del = await publishableClient.from(p.tabell).delete().eq(kol, varde);
    const efter = await secretClient.from(p.tabell).select("*").eq(kol, varde);
    const efterRader = (efter.data ?? []) as Array<Record<string, unknown>>;
    const oforandrad = JSON.stringify(efterRader) === JSON.stringify(foreRader);
    utfall.push({
      namn: `publishable-nyckeln nekas update/delete på ${p.tabell}`,
      godkant: efter.error === null && oforandrad,
      detalj:
        `update: ${upd.error ? "fel" : "inget fel"}, delete: ${del.error ? "fel" : "inget fel"}; ` +
        `probe-raden ${oforandrad ? "oförändrad" : "ÄNDRAD/BORTA"} enligt secret-nyckeln`,
    });
  }
}

// ---------------------------------------------------------------------------
// 3. v2 RPCs
// ---------------------------------------------------------------------------

interface RpcProbe {
  namn: string;
  args: Record<string, unknown>;
  /** Checked with the secret key after the publishable call: true = a side
   *  effect landed (a failure even if the call itself errored). */
  sidoeffekt?: () => Promise<boolean>;
  /** An error matching this is the function's OWN validation, which means the
   *  call was allowed to run: not a denial. */
  egetFel?: RegExp;
}

async function finnsRad(
  secretClient: Klient,
  tabell: string,
  kol: string,
  varde: string,
): Promise<boolean> {
  const { data } = await secretClient.from(tabell).select("*").eq(kol, varde);
  return (data?.length ?? 0) > 0;
}

async function provaV2Rpcer(secretClient: Klient, publishableClient: Klient, utfall: Utfall[]) {
  const slumpId = crypto.randomUUID();
  const publishableProbes: RpcProbe[] = [
    // Harmless even if it were allowed: security invoker + RLS means the
    // anon role's update matches no rows.
    { namn: "claim_next_rapport_steg", args: { p_lease_sekunder: 1 } },
    { namn: "slapp_rapport_steg", args: { p_id: slumpId, p_ateranvand_forsok: true } },
    {
      namn: "ta_kvot",
      args: { p_nyckel: PROBE_KVOT_PUBLISHABLE, p_fonster_sek: 60, p_max: 1 },
      sidoeffekt: () => finnsRad(secretClient, "kvot", "nyckel", PROBE_KVOT_PUBLISHABLE),
    },
    { namn: "aterlamna_kvot", args: { p_nyckel: PROBE_KVOT, p_fonster_sek: 60 } },
    { namn: "kvot_fonster_start", args: { p_fonster_sek: 60 } },
    {
      namn: "sakerstall_principal",
      args: { p_enhet_id: PROBE_ENHET_PUBLISHABLE },
      sidoeffekt: () => finnsRad(secretClient, "principal", "enhet_id", PROBE_ENHET_PUBLISHABLE),
    },
    { namn: "sla_samman_principal", args: { p_fran: slumpId, p_till: crypto.randomUUID() } },
    { namn: "radera_principal", args: { p_id: slumpId } },
    // v3. A null auth user id makes the function raise its OWN "is required"
    // error if it is allowed to run, so a denial is told apart from that (a
    // random uuid would fail on the auth.users foreign key either way).
    {
      namn: "sakerstall_konto_principal",
      args: { p_auth_user_id: null, p_enhet_id: null },
      egetFel: /is required/,
    },
    { namn: "lista_mina_analyser", args: { p_principal: slumpId } },
    { namn: "radera_min_analys", args: { p_principal: slumpId, p_analys: crypto.randomUUID() } },
    {
      namn: "registrera_forening",
      args: { p_orgnr: PROBE_ORGNR_PUBLISHABLE, p_namn: "verify-rls publishable" },
      sidoeffekt: () => finnsRad(secretClient, "forening", "orgnr", PROBE_ORGNR_PUBLISHABLE),
    },
    {
      namn: "registrera_forening_adress",
      args: {
        p_orgnr: PROBE_ORGNR,
        p_postnummer: "00002",
        p_kommun_kod: null,
        p_omrade: null,
        p_adress: null,
        p_kalla: "anvandare",
      },
      sidoeffekt: () => finnsRad(secretClient, "forening_adress", "postnummer", "00002"),
    },
  ];

  for (const p of publishableProbes) {
    console.error(`Anropar ${p.namn} med publishable-nyckeln (ska nekas)...`);
    const svar = await publishableClient.rpc(p.namn, p.args);
    const landade = p.sidoeffekt ? await p.sidoeffekt() : false;
    const kordes =
      svar.error !== null && p.egetFel !== undefined && p.egetFel.test(svar.error.message);
    utfall.push({
      namn: `publishable-nyckeln nekas rpc ${p.namn}`,
      godkant: svar.error !== null && !landade && !kordes,
      detalj: svar.error
        ? `nekad: ${svar.error.code ?? ""} ${svar.error.message}` +
          (landade ? " — MEN en sidoeffekt landade" : "")
        : `TILLÅTEN, svar: ${JSON.stringify(svar.data)}`,
    });
  }

  // Secret key: allowed where a call is harmless. Never claim_next_rapport_steg.
  const secretProbes: Array<{
    namn: string;
    args: Record<string, unknown>;
    ok: (d: unknown) => boolean;
    forvantatFel?: RegExp;
  }> = [
    { namn: "kvot_fonster_start", args: { p_fonster_sek: 60 }, ok: (d) => typeof d === "string" },
    {
      namn: "ta_kvot",
      args: { p_nyckel: PROBE_KVOT, p_fonster_sek: 60, p_max: 1 },
      ok: (d) => d === true,
    },
    { namn: "aterlamna_kvot", args: { p_nyckel: PROBE_KVOT, p_fonster_sek: 60 }, ok: () => true },
    {
      namn: "slapp_rapport_steg",
      args: { p_id: crypto.randomUUID(), p_ateranvand_forsok: false },
      ok: () => true,
    },
    { namn: "registrera_forening", args: { p_orgnr: PROBE_ORGNR, p_namn: null }, ok: () => true },
    {
      namn: "registrera_forening_adress",
      args: {
        p_orgnr: PROBE_ORGNR,
        p_postnummer: PROBE_POSTNUMMER,
        p_kommun_kod: null,
        p_omrade: null,
        p_adress: null,
        p_kalla: "anvandare",
      },
      ok: () => true,
    },
    {
      namn: "sakerstall_principal",
      args: { p_enhet_id: PROBE_ENHET },
      ok: (d) => typeof d === "string",
    },
    // Two unknown ids: the function's own check raises — which proves it ran.
    {
      namn: "sla_samman_principal",
      args: { p_fran: crypto.randomUUID(), p_till: crypto.randomUUID() },
      ok: () => false,
      forvantatFel: /unknown principal/,
    },
    {
      namn: "radera_principal",
      args: { p_id: crypto.randomUUID() },
      ok: (d) =>
        typeof d === "object" && d !== null && (d as { principaler?: number }).principaler === 0,
    },
    // v3: the function's own validation answering proves it ran.
    {
      namn: "sakerstall_konto_principal",
      args: { p_auth_user_id: null, p_enhet_id: null },
      ok: () => false,
      forvantatFel: /is required/,
    },
    {
      namn: "lista_mina_analyser",
      args: { p_principal: crypto.randomUUID() },
      ok: (d) => Array.isArray(d) && d.length === 0,
    },
    {
      namn: "radera_min_analys",
      args: { p_principal: crypto.randomUUID(), p_analys: crypto.randomUUID() },
      ok: (d) =>
        typeof d === "object" && d !== null && (d as { borttagen?: boolean }).borttagen === false,
    },
  ];

  for (const p of secretProbes) {
    console.error(`Anropar ${p.namn} med secret-nyckeln (ska tillåtas)...`);
    const svar = await secretClient.rpc(p.namn, p.args);
    const godkant = svar.error
      ? p.forvantatFel !== undefined && p.forvantatFel.test(svar.error.message)
      : p.ok(svar.data);
    utfall.push({
      namn: `secret-nyckeln får köra rpc ${p.namn}`,
      godkant,
      detalj: svar.error
        ? `${p.forvantatFel ? "funktionens egen kontroll svarade" : "fel"}: ${svar.error.message}`
        : `svar: ${JSON.stringify(svar.data)}`,
    });
  }
  utfall.push({
    namn: "secret-nyckeln: claim_next_rapport_steg anropas inte",
    godkant: true,
    detalj: "medvetet — mot produktion skulle anropet klaima ett riktigt jobb",
  });
}

// ---------------------------------------------------------------------------
// Cleanup — always, defensively, so the script never leaves probes behind.
// ---------------------------------------------------------------------------

async function stada(secretClient: Klient): Promise<void> {
  console.error("Städar bort probe-raderna med secret-nyckeln...");
  const fel: string[] = [];
  const notera = (steg: string, error: unknown) => {
    if (error) fel.push(`${steg}: ${felText(error)}`);
  };

  notera(
    "spend_day",
    (await secretClient.from("spend_day").delete().in("day", [DAG_SECRET, DAG_PUBLISHABLE])).error,
  );

  const rapporter = await secretClient
    .from("rapport")
    .select("id")
    .in("pipeline_version", [PROBE_PIPELINE_VERSION, PROBE_PIPELINE_VERSION + "-publishable"]);
  const rapportIds = ((rapporter.data ?? []) as Array<{ id: string }>).map((r) => r.id);
  const principaler = await secretClient
    .from("principal")
    .select("id")
    .in("enhet_id", [PROBE_ENHET, PROBE_ENHET_PUBLISHABLE]);
  const principalIds = ((principaler.data ?? []) as Array<{ id: string }>).map((r) => r.id);

  if (rapportIds.length > 0) {
    notera(
      "sidtext",
      (await secretClient.from("sidtext").delete().in("rapport_id", rapportIds)).error,
    );
    notera(
      "rapport_fil",
      (await secretClient.from("rapport_fil").delete().in("rapport_id", rapportIds)).error,
    );
  }
  if (principalIds.length > 0) {
    notera(
      "sparad_vardering",
      (await secretClient.from("sparad_vardering").delete().in("principal_id", principalIds)).error,
    );
    notera(
      "sparad_kalkyl",
      (await secretClient.from("sparad_kalkyl").delete().in("principal_id", principalIds)).error,
    );
    notera(
      "behorighet",
      (await secretClient.from("behorighet").delete().in("principal_id", principalIds)).error,
    );
    notera(
      "principal",
      (await secretClient.from("principal").delete().in("id", principalIds)).error,
    );
  }
  if (rapportIds.length > 0) {
    notera("rapport", (await secretClient.from("rapport").delete().in("id", rapportIds)).error);
  }
  notera(
    "forening_adress",
    (
      await secretClient
        .from("forening_adress")
        .delete()
        .in("orgnr", [PROBE_ORGNR, PROBE_ORGNR_PUBLISHABLE])
    ).error,
  );
  notera(
    "forening",
    (
      await secretClient
        .from("forening")
        .delete()
        .in("orgnr", [PROBE_ORGNR, PROBE_ORGNR_PUBLISHABLE])
    ).error,
  );
  notera(
    "kvot",
    (await secretClient.from("kvot").delete().in("nyckel", [PROBE_KVOT, PROBE_KVOT_PUBLISHABLE]))
      .error,
  );

  if (fel.length > 0) {
    console.error(`Varning: städning misslyckades delvis: ${fel.join("; ")}`);
  }
}

main().catch((error: unknown) => {
  console.error("Oväntat fel:", error);
  process.exitCode = 1;
});
