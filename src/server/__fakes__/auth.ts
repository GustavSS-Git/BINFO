/**
 * In-memory fake of the `AuthPort` (see `../kontoPortar.ts`): a tiny GoTrue.
 * Models the behaviours our code depends on, not GoTrue's internals:
 * - sign-up never reveals whether the address exists (same `ok`), creates an
 *   UNCONFIRMED user and "sends" a confirmation mail (see `mejl`);
 * - login: unknown user or wrong password → `ogiltig_inloggning` (same for
 *   both); right password but unconfirmed → `ej_bekraftad`;
 * - `bekrafta` consumes a one-time `token_hash` of the right type, confirms the
 *   user and issues a session;
 * - access tokens expire (injectable clock); refresh tokens rotate, and an
 *   already-used one is refused (`ogiltig_token`);
 * - `simuleraAuthNere` makes validation/refresh fail as an outage
 *   (`fel` / `tillfalligt`), to test that cookies are NOT cleared then;
 * - passwords shorter than 10 characters are `svagt_losenord`.
 *
 * Tokens are shaped like what `./sessionCookies.ts` accepts (JWT-like access
 * token, opaque refresh token) so they pass the cookie reader's pattern.
 */

import type {
  AuthAnvandare,
  AuthOtpTyp,
  AuthPort,
  AuthResultat,
  AuthSession,
  TokenKontroll,
} from "../kontoPortar";

export interface FakeAuthAnvandare {
  id: string;
  epost: string;
  losenord: string;
  bekraftad: boolean;
}

export interface FakeMejl {
  till: string;
  typ: AuthOtpTyp;
  tokenHash: string;
}

export interface FakeAuth extends AuthPort {
  readonly anvandare: Map<string, FakeAuthAnvandare>;
  /** Every mail GoTrue would have sent, in order. */
  readonly mejl: FakeMejl[];
  /** Access tokens currently valid (until they expire). */
  readonly accessTokens: Map<string, { userId: string; utgar: number; sessionId: string }>;
  /** Refresh tokens: used ones are kept (and refused). */
  readonly refreshTokens: Map<string, { userId: string; anvand: boolean; sessionId: string }>;
  /** Calls to `valideraAccessToken` / `fornyaSession` fail like an outage. */
  simuleraAuthNere: boolean;
  /** `fornyaSession` answers `kvot` (Auth's 429). */
  simuleraFornyaKvot: boolean;
  /** Creates a confirmed user directly. */
  skapaBekraftadAnvandare(epost: string, losenord: string): FakeAuthAnvandare;
  /** Issues a session for a user without a login (a test shortcut). */
  utfardaSession(userId: string): AuthSession;
  /** Calls made, by method name (for "no call was made" assertions). */
  readonly anrop: string[];
}

export const FAKE_ACCESS_LEVNAD_SEK = 3600;

export function skapaFakeAuth(nu: () => number = () => Date.now()): FakeAuth {
  const anvandare = new Map<string, FakeAuthAnvandare>();
  const mejl: FakeMejl[] = [];
  const accessTokens = new Map<string, { userId: string; utgar: number; sessionId: string }>();
  const refreshTokens = new Map<string, { userId: string; anvand: boolean; sessionId: string }>();
  const engangstokens = new Map<string, { userId: string; typ: AuthOtpTyp; anvand: boolean }>();
  const anrop: string[] = [];
  let nasta = 1;

  const normalisera = (epost: string) => epost.trim().toLowerCase();
  const hittaPaEpost = (epost: string) =>
    [...anvandare.values()].find((u) => u.epost === normalisera(epost));
  const tillAnvandare = (u: FakeAuthAnvandare): AuthAnvandare => ({ id: u.id, epost: u.epost });

  // A refresh keeps the session id (as in GoTrue); a login makes a new one.
  function utfarda(userId: string, sessionId?: string): AuthSession {
    const n = nasta++;
    const sid = sessionId ?? `session-${n}`;
    const accessToken = `fakeh${n}.fakep${n}-${userId}.fakesig${n}`;
    const refreshToken = `fakerefresh${n}x`;
    accessTokens.set(accessToken, {
      userId,
      utgar: nu() + FAKE_ACCESS_LEVNAD_SEK * 1000,
      sessionId: sid,
    });
    refreshTokens.set(refreshToken, { userId, anvand: false, sessionId: sid });
    return { accessToken, refreshToken, expiresIn: FAKE_ACCESS_LEVNAD_SEK };
  }

  function skickaMejl(u: FakeAuthAnvandare, typ: AuthOtpTyp): void {
    const tokenHash = `tokenhash${nasta++}abcdef0123456789`;
    engangstokens.set(tokenHash, { userId: u.id, typ, anvand: false });
    mejl.push({ till: u.epost, typ, tokenHash });
  }

  function skapa(epost: string, losenord: string, bekraftad: boolean): FakeAuthAnvandare {
    const u: FakeAuthAnvandare = {
      id: `00000000-0000-4000-8000-${(nasta++).toString(16).padStart(12, "0")}`,
      epost: normalisera(epost),
      losenord,
      bekraftad,
    };
    anvandare.set(u.id, u);
    return u;
  }

  const fake: FakeAuth = {
    anvandare,
    mejl,
    accessTokens,
    refreshTokens,
    simuleraAuthNere: false,
    simuleraFornyaKvot: false,
    anrop,

    skapaBekraftadAnvandare: (epost, losenord) => skapa(epost, losenord, true),
    utfardaSession: utfarda,

    async registrera(epost, losenord): Promise<AuthResultat> {
      anrop.push("registrera");
      if (losenord.length < 10) return { ok: false, orsak: "svagt_losenord" };
      const finns = hittaPaEpost(epost);
      if (finns === undefined) skickaMejl(skapa(epost, losenord, false), "signup");
      else if (!finns.bekraftad) skickaMejl(finns, "signup");
      // An existing confirmed address: GoTrue answers like a new one.
      return { ok: true };
    },

    async loggaIn(epost, losenord) {
      anrop.push("loggaIn");
      const u = hittaPaEpost(epost);
      if (u === undefined || u.losenord !== losenord) {
        return { ok: false, orsak: "ogiltig_inloggning" };
      }
      if (!u.bekraftad) return { ok: false, orsak: "ej_bekraftad" };
      return { ok: true, session: utfarda(u.id), anvandare: tillAnvandare(u) };
    },

    async bekrafta(tokenHash, typ) {
      anrop.push("bekrafta");
      const t = engangstokens.get(tokenHash);
      if (t === undefined || t.anvand || t.typ !== typ)
        return { ok: false, orsak: "ogiltig_token" };
      t.anvand = true;
      const u = anvandare.get(t.userId);
      if (u === undefined) return { ok: false, orsak: "ogiltig_token" };
      u.bekraftad = true;
      return { ok: true, session: utfarda(u.id), anvandare: tillAnvandare(u) };
    },

    async begarAterstallning(epost): Promise<AuthResultat> {
      anrop.push("begarAterstallning");
      const u = hittaPaEpost(epost);
      if (u !== undefined && u.bekraftad) skickaMejl(u, "recovery");
      return { ok: true };
    },

    async valideraAccessToken(accessToken): Promise<TokenKontroll> {
      anrop.push("valideraAccessToken");
      if (fake.simuleraAuthNere) return { status: "fel" };
      const t = accessTokens.get(accessToken);
      if (t === undefined || t.utgar <= nu()) return { status: "ogiltig" };
      const u = anvandare.get(t.userId);
      if (u === undefined) return { status: "ogiltig" };
      return { status: "ok", anvandare: tillAnvandare(u) };
    },

    async fornyaSession(refreshToken) {
      anrop.push("fornyaSession");
      if (fake.simuleraAuthNere) return { ok: false, orsak: "tillfalligt" };
      if (fake.simuleraFornyaKvot) return { ok: false, orsak: "kvot" };
      const r = refreshTokens.get(refreshToken);
      if (r === undefined || r.anvand) return { ok: false, orsak: "ogiltig_token" };
      const u = anvandare.get(r.userId);
      if (u === undefined) return { ok: false, orsak: "ogiltig_token" };
      r.anvand = true;
      return { ok: true, session: utfarda(u.id, r.sessionId), anvandare: tillAnvandare(u) };
    },

    async uppdateraLosenord(tokens, nyttLosenord) {
      anrop.push("uppdateraLosenord");
      let rotera: AuthSession | null = null;
      let t = accessTokens.get(tokens.accessToken);
      if (t === undefined || t.utgar <= nu()) {
        const r = refreshTokens.get(tokens.refreshToken);
        if (r === undefined || r.anvand) return { ok: false, orsak: "ogiltig_token" };
        r.anvand = true;
        rotera = utfarda(r.userId, r.sessionId);
        t = accessTokens.get(rotera.accessToken);
      }
      if (t === undefined) return { ok: false, orsak: "ogiltig_token" };
      const u = anvandare.get(t.userId);
      if (u === undefined) return { ok: false, orsak: "ogiltig_token" };
      if (nyttLosenord.length < 10 || nyttLosenord === u.losenord) {
        return { ok: false, orsak: "svagt_losenord" };
      }
      u.losenord = nyttLosenord;
      return { ok: true, session: rotera };
    },

    async loggaUt(accessToken): Promise<void> {
      anrop.push("loggaUt");
      accessTokens.delete(accessToken);
    },

    async loggaUtAndraSessioner(accessToken): Promise<void> {
      anrop.push("loggaUtAndraSessioner");
      const t = accessTokens.get(accessToken);
      if (t === undefined) return;
      for (const [k, v] of accessTokens) {
        if (v.userId === t.userId && v.sessionId !== t.sessionId) accessTokens.delete(k);
      }
      for (const [k, v] of refreshTokens) {
        if (v.userId === t.userId && v.sessionId !== t.sessionId) refreshTokens.delete(k);
      }
    },

    async raderaAnvandare(userId): Promise<void> {
      anrop.push("raderaAnvandare");
      anvandare.delete(userId);
      for (const [k, v] of accessTokens) if (v.userId === userId) accessTokens.delete(k);
      for (const [k, v] of refreshTokens) if (v.userId === userId) refreshTokens.delete(k);
    },
  };
  return fake;
}
