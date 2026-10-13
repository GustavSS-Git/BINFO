/**
 * Real `@supabase/supabase-js` implementation of the `AuthPort` (see
 * `./kontoPortar.ts`). Server-side only: the browser never gets a Supabase
 * client (docs/PLAN-v3.md §1.2). Translation only — GoTrue's errors are
 * reduced to `AuthFelOrsak`, and no message from them is ever kept.
 *
 * Two kinds of client, both with `persistSession: false`,
 * `autoRefreshToken: false` and `detectSessionInUrl: false`, and a FRESH one
 * per call (an in-memory session on a shared client must not leak between
 * requests on a long-lived Worker isolate):
 * - publishable key: the user flows — signUp, signInWithPassword, verifyOtp,
 *   resetPasswordForEmail, refreshSession, updateUser;
 * - secret key: admin — getUser(jwt) validation, admin.signOut,
 *   admin.deleteUser.
 *
 * Web-standard only (fetch-based; no Buffer), like `./supabase.ts`.
 */

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { KontoEjKonfigureratError } from "./fel";
import type {
  AuthAnvandare,
  AuthFelOrsak,
  AuthPort,
  AuthResultat,
  AuthSession,
  TokenKontroll,
} from "./kontoPortar";

/** What we read from a GoTrue error (duck-typed: `AuthApiError`,
 *  `AuthRetryableFetchError`, … all carry some of these). */
interface AuthFelLik {
  name?: string;
  status?: number;
  code?: string;
}

function arTillfalligt(fel: AuthFelLik): boolean {
  return (
    fel.name === "AuthRetryableFetchError" ||
    (typeof fel.status === "number" && (fel.status >= 500 || fel.status === 0))
  );
}

const OGILTIG_TOKEN_KODER = new Set([
  "otp_expired",
  "bad_jwt",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "flow_state_not_found",
  "flow_state_expired",
]);

/** GoTrue error → what the caller acts on. The raw message is dropped. */
export function mappaAuthFel(fel: unknown): AuthFelOrsak {
  const f = (fel ?? {}) as AuthFelLik;
  if (arTillfalligt(f)) return "tillfalligt";
  switch (f.code) {
    case "invalid_credentials":
      return "ogiltig_inloggning";
    case "email_not_confirmed":
      return "ej_bekraftad";
    case "weak_password":
    case "same_password":
      return "svagt_losenord";
    case "validation_failed":
    case "email_address_invalid":
    case "email_address_not_authorized":
      return "ogiltig_epost";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "kvot";
  }
  if (f.code !== undefined && OGILTIG_TOKEN_KODER.has(f.code)) return "ogiltig_token";
  if (f.status === 429) return "kvot";
  // A 401/403 with no (known) code: an invalid or expired credential.
  if (f.status === 401 || f.status === 403) return "ogiltig_token";
  return "annat";
}

function tillSession(s: Session): AuthSession {
  return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresIn: s.expires_in };
}

function tillAnvandare(u: { id: string; email?: string | undefined }): AuthAnvandare {
  return { id: u.id, epost: u.email ?? "" };
}

export interface AuthMiljo {
  supabaseUrl: string;
  supabaseSecretKey: string;
  supabasePublishableKey?: string;
}

/** Test seam: how the two kinds of client are made. */
export interface KlientFabrik {
  publik(): SupabaseClient;
  admin(): SupabaseClient;
}

const KLIENT_ALTERNATIV = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function skapaKlientFabrik(env: AuthMiljo): KlientFabrik {
  const publishable = env.supabasePublishableKey;
  if (publishable === undefined || publishable.length === 0) {
    // Accounts need the publishable key; it stays optional in Env generally.
    throw new KontoEjKonfigureratError();
  }
  return {
    publik: () => createClient(env.supabaseUrl, publishable, KLIENT_ALTERNATIV),
    admin: () => createClient(env.supabaseUrl, env.supabaseSecretKey, KLIENT_ALTERNATIV),
  };
}

export function skapaAuthPortFranFabrik(fabrik: KlientFabrik): AuthPort {
  return {
    async registrera(epost, losenord): Promise<AuthResultat> {
      const { data, error } = await fabrik
        .publik()
        .auth.signUp({ email: epost, password: losenord });
      if (error) return { ok: false, orsak: mappaAuthFel(error) };
      if (data.session) {
        // Email confirmations are OFF on this project: the account is usable
        // without verifying. The session is deliberately ignored (we never
        // log anyone in from sign-up), but this is a misconfiguration.
        console.warn(
          "[auth] signUp returnerade en session: e-postbekräftelse verkar vara avstängd i Supabase Auth.",
        );
      }
      return { ok: true };
    },

    async loggaIn(epost, losenord) {
      const { data, error } = await fabrik
        .publik()
        .auth.signInWithPassword({ email: epost, password: losenord });
      if (error) return { ok: false, orsak: mappaAuthFel(error) };
      if (!data.session || !data.user) return { ok: false, orsak: "annat" };
      return { ok: true, session: tillSession(data.session), anvandare: tillAnvandare(data.user) };
    },

    async bekrafta(tokenHash, typ) {
      const { data, error } = await fabrik
        .publik()
        .auth.verifyOtp({ token_hash: tokenHash, type: typ });
      if (error) {
        const orsak = mappaAuthFel(error);
        // A bad link is a 4xx without a stable code on some GoTrue versions.
        return { ok: false, orsak: orsak === "annat" ? "ogiltig_token" : orsak };
      }
      if (!data.session || !data.user) return { ok: false, orsak: "ogiltig_token" };
      return { ok: true, session: tillSession(data.session), anvandare: tillAnvandare(data.user) };
    },

    async begarAterstallning(epost): Promise<AuthResultat> {
      const { error } = await fabrik.publik().auth.resetPasswordForEmail(epost);
      if (error) return { ok: false, orsak: mappaAuthFel(error) };
      return { ok: true };
    },

    async valideraAccessToken(accessToken): Promise<TokenKontroll> {
      const { data, error } = await fabrik.admin().auth.getUser(accessToken);
      if (error) {
        return mappaAuthFel(error) === "tillfalligt" ? { status: "fel" } : { status: "ogiltig" };
      }
      if (!data.user) return { status: "ogiltig" };
      return { status: "ok", anvandare: tillAnvandare(data.user) };
    },

    async fornyaSession(refreshToken) {
      const { data, error } = await fabrik
        .publik()
        .auth.refreshSession({ refresh_token: refreshToken });
      if (error) {
        const orsak = mappaAuthFel(error);
        return { ok: false, orsak: orsak === "annat" ? "ogiltig_token" : orsak };
      }
      if (!data.session || !data.user) return { ok: false, orsak: "ogiltig_token" };
      return { ok: true, session: tillSession(data.session), anvandare: tillAnvandare(data.user) };
    },

    async uppdateraLosenord(tokens, nyttLosenord) {
      const sb = fabrik.publik();
      // setSession refreshes first if the access token has expired; the
      // rotated tokens are handed back so the cookies can follow.
      const { data: satt, error: sattFel } = await sb.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (sattFel) {
        const orsak = mappaAuthFel(sattFel);
        return { ok: false, orsak: orsak === "annat" ? "ogiltig_token" : orsak };
      }
      if (!satt.session) return { ok: false, orsak: "ogiltig_token" };
      const { error } = await sb.auth.updateUser({ password: nyttLosenord });
      if (error) return { ok: false, orsak: mappaAuthFel(error) };
      const roterad = satt.session.access_token !== tokens.accessToken;
      return { ok: true, session: roterad ? tillSession(satt.session) : null };
    },

    async loggaUt(accessToken): Promise<void> {
      try {
        // 'local': ends THIS session only, not the user's other devices.
        await fabrik.admin().auth.admin.signOut(accessToken, "local");
      } catch (fel) {
        console.warn(
          "[auth] signOut misslyckades: " + (fel instanceof Error ? fel.message : String(fel)),
        );
      }
    },

    async raderaAnvandare(userId): Promise<void> {
      const { error } = await fabrik.admin().auth.admin.deleteUser(userId);
      if (error) throw new Error(`raderaAnvandare misslyckades: ${error.message}`);
    },
  };
}

/** Throws `KontoEjKonfigureratError` when `PROJECT_PUBLISHABLE_KEY` is unset. */
export function skapaAuthPort(env: AuthMiljo): AuthPort {
  return skapaAuthPortFranFabrik(skapaKlientFabrik(env));
}
